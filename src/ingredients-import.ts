import { compile, displayFormula, supportedFunctions, type Ast } from './formula';
import { clone, key, mapAst, translate, uid, type Cell, type Sheet, type Table, type Workbook } from './model';
import { validateBook } from './storage';

const aliases: Record<string,string> = { Ingredient:'Ingredients', 'Calories per g':'Calories2' };
export interface IngredientsImport {
  book: Workbook; sheet: string; rows: number; columns: number; retainedRows: number;
  dependencyTables: number; unresolvedReferences: number;
}

export function mergeIngredients(current:Workbook,source:Workbook):IngredientsImport {
  validateBook(current);validateBook(source);
  const roots=source.tables.filter(t=>t.name.toLowerCase()==='ingredients');
  if(roots.length!==1)throw Error('The source must contain exactly one Ingredients table.');
  const root=roots[0],origin=source.sheets.find(s=>s.id===root.sheet)!;
  const targets=current.tables.filter(t=>t.name.toLowerCase()==='ingredients');
  if(targets.length!==1)throw Error('Choose a workbook with exactly one existing Ingredients table. Other sheets will not be replaced.');
  const book=clone(current),target=book.tables.find(t=>t.id===targets[0].id)!,sheet=book.sheets.find(s=>s.id===target.sheet)!;
  const ids=new Map<string,string>([[root.id,target.id],[origin.id,sheet.id],[root.header,target.header]]);
  const tables=new Map<string,Table>([[root.id,root]]),names=new Set<string>(),unresolved=new Set<string>();
  const owned=(t:Table)=>new Set([t.header,...t.rows]);
  const sourceAst=(text:string,s:Sheet,row:string,col:string):Ast=>text.startsWith('{')?JSON.parse(text) as Ast:compile(text,source,s.id,row,col);
  const bindIndirect=(ast:Ast,s:Sheet,row:string,col:string):Ast=>mapAst(ast,node=>{
    if(node.kind==='call'&&node.name==='INDIRECT'&&node.args[0]?.kind==='literal'&&typeof node.args[0].value==='string')
      return compile(node.args[0].value,source,s.id,row,col);
    return node;
  });
  const include=(ast:Ast):void=>{
    mapAst(ast,node=>{
      if(node.kind==='structured'){
        const t=source.tables.find(t=>t.id===node.table);
        if(t&&!tables.has(t.id)){
          if(source.sheets.find(s=>s.id===t.sheet)?.name.toLowerCase()==='dropdowns')tables.set(t.id,t);
          else unresolved.add(t.id);
        }
      }else if(node.kind==='name'&&!names.has(node.id)){
        const name=source.names.find(n=>n.id===node.id);
        if(name){names.add(name.id);include(name.formula);}
        else unresolved.add(node.id);
      }else if(node.kind==='ref'&&node.sheet!==origin.id){
        if(source.sheets.find(s=>s.id===node.sheet)?.name.toLowerCase()==='dropdowns'){
          const matches=source.tables.filter(t=>t.sheet===node.sheet&&(t.header===node.row||t.rows.includes(node.row))&&t.columns.some(c=>c.column===node.column));
          if(!matches.length)throw Error('A required Dropdowns reference points outside a source table. Import needs an explicit freeform dependency selection; existing data was not changed.');
          matches.forEach(t=>tables.set(t.id,t));
        }else unresolved.add(node.sheet);
      }
      return node;
    });
  };
  const scanned=new Set<string>();
  while([...tables.keys()].some(id=>!scanned.has(id))){
    for(const t of [...tables.values()]){
      if(scanned.has(t.id))continue;scanned.add(t.id);
      const s=source.sheets.find(s=>s.id===t.sheet)!,rows=owned(t),columns=new Set(t.columns.map(c=>c.column));
      for(const r of rows)for(const c of columns){const cell=s.cells[key(r,c)];if(cell?.formula)include(cell.formula);}
      for(const v of s.validations)if(v.rows.some(r=>rows.has(r))&&v.columns.some(c=>columns.has(c))&&!v.values)
        include(bindIndirect(sourceAst(v.source,s,v.rows[0],v.columns[0]),s,v.rows[0],v.columns[0]));
    }
  }
  const previousColumns=[...target.columns],mappedColumns= root.columns.map(c=>{
    const matches=previousColumns.filter(old=>old.name===c.name||aliases[old.name]===c.name);
    if(matches.length>1)throw Error('Ambiguous existing Ingredients columns. Resolve duplicate/alias columns before importing.');
    const old=matches[0];
    if(old){ids.set(c.id,old.id);ids.set(c.column,old.column);return {...old,name:c.name};}
    return clone(c);
  });
  const used=new Set(mappedColumns.map(c=>c.column)),extras=previousColumns.filter(c=>!used.has(c.column));
  const oldRows=[...target.rows],header=sheet.rows.findIndex(r=>r.id===target.header);
  const importedRows=root.rows.map(r=>clone(origin.rows.find(row=>row.id===r)!));
  if(sheet.rows.length+importedRows.length>100000)throw Error('Import would exceed the safe 100,000-row limit. Existing data was not changed.');
  sheet.rows.splice(header+1,0,...importedRows);
  const oldColumnObjects=new Map(sheet.columns.map(c=>[c.id,c]));
  const importedColumns=root.columns.map(c=>{
    const id=ids.get(c.column)??c.column,original=origin.columns.find(col=>col.id===c.column)!;
    return {...clone(original),id,label:oldColumnObjects.get(id)?.label??original.label};
  });
  sheet.columns=[...importedColumns,...sheet.columns.filter(c=>!used.has(c.id)&&!importedColumns.some(newCol=>newCol.id===c.id))];
  if(sheet.columns.length>512)throw Error('Import would exceed the safe 512-column limit. Existing data was not changed.');
  target.columns=[...mappedColumns,...extras];target.rows=[...root.rows,...oldRows];
  const dependencySheets=new Map<string,Sheet>();
  for(const t of tables.values()){
    if(t.id===root.id)continue;
    if(book.tables.some(existing=>existing.name.toLowerCase()===t.name.toLowerCase()))throw Error(`Dropdown table "${t.name}" already exists. Resolve the name collision before importing; it will not be silently relinked.`);
    if(!dependencySheets.has(t.sheet)){
      const original=source.sheets.find(s=>s.id===t.sheet)!;
      if(book.sheets.some(s=>s.name.toLowerCase()===original.name.toLowerCase()))throw Error('A Dropdowns sheet already exists. Resolve that collision before importing; its contents will not be overwritten.');
      const copied={...clone(original),cells:{},groups:[],validations:[]} as Sheet;
      dependencySheets.set(t.sheet,copied);book.sheets.push(copied);
    }
    book.tables.push(clone(t));
  }
  const remap=(id:string)=>ids.get(id)??id;
  const remapAst=(ast:Ast):Ast=>mapAst(ast,node=>{
    if(node.kind==='ref')return {...node,sheet:remap(node.sheet),row:remap(node.row),column:remap(node.column)};
    if(node.kind==='structured')return {...node,table:remap(node.table),columns:node.columns.map(remap)};
    if(node.kind==='name')return {...node,id:remap(node.id)};
    return node;
  });
  const copiedFormulas=new WeakMap<Ast,Ast>();
  const copyCell=(cell:Cell):Cell=>{
    const copied=clone(cell);
    if(cell.formula){
      let ast=copiedFormulas.get(cell.formula);
      if(!ast){ast=remapAst(cell.formula);copiedFormulas.set(cell.formula,ast);}
      copied.formula=ast;
    }
    if(cell.binding)copied.binding={table:remap(cell.binding.table),row:remap(cell.binding.row),column:remap(cell.binding.column)};
    if(cell.calculation)copied.calculation=remapAst(cell.calculation);
    return copied;
  };
  for(const t of tables.values()){
    const from=source.sheets.find(s=>s.id===t.sheet)!,to=t.id===root.id?sheet:dependencySheets.get(t.sheet)!;
    const rows=owned(t),columns=new Set(t.columns.map(c=>c.column));
    for(const r of rows)for(const c of columns){
      const original=from.cells[key(r,c)];if(!original)continue;
      const k=key(remap(r),remap(c)),copied=copyCell(original);
      if(t.id===root.id&&r===root.header){
        const previous=to.cells[k];
        if(previous?.note&&!copied.note)copied.note=previous.note;
        if(previous?.link&&!copied.link)copied.link=previous.link;
      }
      to.cells[k]=copied;
    }
    for(const v of from.validations){
      const matchedRows=v.rows.filter(r=>rows.has(r)),matchedCols=v.columns.filter(c=>columns.has(c));
      if(!matchedRows.length||!matchedCols.length)continue;
      const copied={...clone(v),id:uid(),rows:matchedRows.map(remap),columns:matchedCols.map(remap),sheet:to.id};
      if(!v.values){
        const ast=sourceAst(v.source,from,v.rows[0],v.columns[0]);
        copied.originalSource=displayFormula(ast,source);
        copied.source=JSON.stringify(remapAst(bindIndirect(ast,from,v.rows[0],v.columns[0])));
      }
      to.validations.push(copied);
    }
    for(const g of from.groups){
      const members=g.members.filter(id=>g.axis==='row'?rows.has(id):columns.has(id)).map(remap);
      if(members.length&&!to.groups.some(existing=>existing.id===g.id))to.groups.push({...clone(g),members});
    }
  }
  for(const c of extras){
    const templateRow=oldRows.find(r=>sheet.cells[key(r,c.column)]?.formula),template=templateRow?sheet.cells[key(templateRow,c.column)]:undefined;
    if(template?.formula)for(const r of root.rows)sheet.cells[key(r,c.column)]={format:clone(template.format),formula:translate(template.formula,book,sheet.id,templateRow!,c.column,r,c.column)};
    for(const v of [...sheet.validations])if(v.columns.includes(c.column)&&v.rows.some(r=>oldRows.includes(r)))v.rows.push(...root.rows);
  }
  for(const id of names){
    const name=source.names.find(n=>n.id===id)!;
    const scope=name.sheet?remap(name.sheet):undefined;
    if(book.names.some(n=>n.name.toLowerCase()===name.name.toLowerCase()&&n.sheet===scope))throw Error('A required named source already exists. Resolve its collision before importing.');
    book.names.push({...clone(name),sheet:scope,context:remap(name.context),formula:remapAst(name.formula)});
  }
  const unsupported:Record<string,number>={};
  const formulaCount=[...tables.values()].reduce((count,t)=>{
    const from=source.sheets.find(s=>s.id===t.sheet)!;
    return count+[t.header,...t.rows].reduce((sum,r)=>sum+t.columns.filter(c=>{
      const ast=from.cells[key(r,c.column)]?.formula;if(!ast)return false;
      mapAst(ast,node=>{
        if(node.kind==='call'&&!supportedFunctions.has(node.name))unsupported[node.name]=(unsupported[node.name]??0)+1;
        if(node.kind==='error'&&node.value.error==='#UNSUPPORTED!')unsupported['Unparsed formulas']=(unsupported['Unparsed formulas']??0)+1;
        return node;
      });return true;
    }).length,0);
  },0);
  book.importReport={originalId:source.importReport?.originalId??'',formulaCount,unsupported,
    entries:[...new Set([...(book.importReport?.entries??[]),...(source.importReport?.entries??[]),
      `Imported ${root.rows.length} Ingredients records and ${tables.size-1} referenced Dropdowns tables. Existing records and all other sheets were retained.`,
      'Imported validation references bind their original source IDs; original dropdown expressions are retained. Same-named existing tables are never substituted.',
      ...(unresolved.size?[`${unresolved.size} source dependency/dependencies outside Ingredients/Dropdowns were not imported. Those references remain explicit #REF! errors, not links to example tables.`]:[])])]};
  book.revision++;
  validateBook(book);
  return {book,sheet:sheet.id,rows:root.rows.length,columns:root.columns.length,retainedRows:oldRows.length,dependencyTables:tables.size-1,unresolvedReferences:unresolved.size};
}
