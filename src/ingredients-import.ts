import { compile, displayFormula, supportedFunctions, type Ast } from './formula';
import { clone, key, mapAst, translate, uid, uniqueName, type Cell, type ReferenceSource, type Sheet, type Table, type Workbook } from './model';
import { validateBook } from './storage';
import { dropdownCatalog,matchesDropdownCatalog } from './dropdown-catalog';
import { referenceChoices,referenceFormula } from './references';

const aliases: Record<string,string> = { Ingredient:'Ingredients', 'Calories per g':'Calories2' };
export interface IngredientsImport {
  book: Workbook; sheet: string; rows: number; columns: number; retainedRows: number;
  dependencyTables: number; unresolvedReferences: number;
  linkedDropdownCells: number; preservedFormulaCells: number; preservedRecordLabels: number;
}

export function mergeIngredients(current:Workbook,source:Workbook):IngredientsImport {
  validateBook(current);validateBook(source);
  const roots=source.tables.filter(t=>t.name.toLowerCase()==='ingredients');
  if(roots.length!==1)throw Error('The source must contain exactly one Ingredients table.');
  const root=roots[0],origin=source.sheets.find(s=>s.id===root.sheet)!;
  const targets=current.tables.filter(t=>t.name.toLowerCase()==='ingredients');
  if(targets.length>1)throw Error('Resolve the multiple existing Ingredients tables before importing. Other sheets will not be replaced.');
  const book=clone(current);
  let target=book.tables.find(t=>t.id===targets[0]?.id),sheet=target?book.sheets.find(s=>s.id===target!.sheet):undefined;
  if(!target){
    const header=clone(origin.rows.find(r=>r.id===root.header)!);header.id=uid();
    sheet={...clone(origin),id:uid(),name:uniqueName(book.sheets.map(s=>s.name),origin.name),rows:[header],columns:[],cells:{},groups:[],validations:[]};
    target={...clone(root),id:uid(),sheet:sheet.id,header:header.id,rows:[],columns:[]};
    book.sheets.push(sheet);book.tables.push(target);
  }
  if(!sheet)throw Error('The existing Ingredients sheet is missing.');
  const ids=new Map<string,string>([[root.id,target.id],[origin.id,sheet.id],[root.header,target.header]]);
  const tables=new Map<string,Table>([[root.id,root]]),names=new Set<string>(),unresolved=new Set<string>();
  const owned=(t:Table)=>new Set([t.header,...t.rows]);
  const sourceAst=(text:string,s:Sheet,row:string,col:string):Ast=>text.startsWith('{')?JSON.parse(text) as Ast:compile(text,source,s.id,row,col);
  const bindIndirect=(ast:Ast,s:Sheet,row:string,col:string):Ast=>mapAst(ast,node=>{
    if(node.kind==='call'&&node.name==='INDIRECT'&&node.args[0]?.kind==='literal'&&typeof node.args[0].value==='string')
      return compile(node.args[0].value,source,s.id,row,col);
    return node;
  });
  const liveLists=(current.references??[]).filter(r=>!r.archived&&r.kind==='list');
  const choiceCache=new Map<string,ReturnType<typeof referenceChoices>>();
  const choices=(r:ReferenceSource)=>{
    let result=choiceCache.get(r.id);
    if(!result){result=referenceChoices(current,r,false,true);choiceCache.set(r.id,result);}
    return result;
  };
  const matchingLists=(t:Table,field:string):ReferenceSource[]=>liveLists.filter(r=>{
    const column=t.columns.find(c=>c.id===field);
    const backing=current.tables.find(table=>table.id===r.table),liveColumn=backing?.columns.find(c=>c.id===r.column);
    if(!column)return false;
    const same=(a:string|undefined,b:string)=>a?.toLowerCase()===b.toLowerCase();
    const spec=dropdownCatalog.lists.find(spec=>same(spec.name,t.name));
    if(r.catalog?.id===dropdownCatalog.id&&same(r.catalog.table,t.name)&&spec?.field===column.name)return true;
    if(same(r.origin?.table,t.name)&&t.columns.length===1)return true;
    return (same(backing?.name,t.name)||same(r.name,t.name))&&(liveColumn?.name===column.name||t.columns.length===1);
  });
  const validationTables=(ast:Ast,context:Sheet,visited=new Set<string>()):Array<{table:Table;field:string}>=>{
    const result:Array<{table:Table;field:string}>=[];
    mapAst(bindIndirect(ast,context,context.rows[0].id,context.columns[0].id),node=>{
      if(node.kind==='structured'){
        const table=source.tables.find(t=>t.id===node.table);
        if(table)node.columns.forEach(field=>result.push({table,field}));
      }else if(node.kind==='name'){
        if(visited.has(node.id))throw Error('Circular named dropdown source. Existing data was not changed.');
        const named=source.names.find(n=>n.id===node.id);
        if(named){
          const next=new Set(visited);next.add(node.id);
          result.push(...validationTables(named.formula,source.sheets.find(s=>s.id===named.context)!,next));
        }
      }
      return node;
    });
    return result;
  };
  const validationLists=new Map<string,ReferenceSource[]>(),linkedCells=new Map<string,NonNullable<Cell['binding']>>();
  const preservedFormulas=new Set<string>(),preservedLabels=new Set<string>();
  const rootRows=new Set(root.rows),rootColumns=new Map(root.columns.map(c=>[c.column,c]));
  for(const v of origin.validations){
    const rows=v.rows.filter(r=>rootRows.has(r)),columns=v.columns.filter(c=>rootColumns.has(c));
    if(!rows.length||!columns.length)continue;
    const definitions=v.values?[]:validationTables(sourceAst(v.source,origin,v.rows[0],v.columns[0]),origin);
    const providers=[...new Map(definitions.flatMap(({table,field})=>{
      const candidates=matchingLists(table,field);
      if(candidates.length>1)throw Error(`Multiple website DDs identify "${table.name}". Resolve the source ambiguity before importing.`);
      if(!candidates.length&&liveLists.length&&source.sheets.find(s=>s.id===table.sheet)?.name.toLowerCase()==='dropdowns')
        throw Error(`The Excel dropdown "${table.name}" has no matching active website DD. Restore or reconnect that DD before importing.`);
      return candidates;
    }).map(r=>[r.id,r])).values()];
    if(!providers.length&&!v.values){
      for(const r of rows)for(const c of columns)if(c===root.columns[0].column&&origin.cells[key(r,c)]?.value!=null)preservedLabels.add(key(r,c));
      continue;
    }
    if(!providers.length&&!liveLists.length)continue;
    const declaredProviders=[...providers];
    for(const r of rows)for(const c of columns){
      const cell=origin.cells[key(r,c)],k=key(r,c);
      if(cell?.formula){preservedFormulas.add(k);continue;}
      if(cell?.value==null||cell.value==='')continue;
      const value=String(cell.value);
      let matches=declaredProviders.flatMap(provider=>choices(provider).filter(choice=>choice.value===value).map(choice=>({provider,choice})));
      if(!matches.length)matches=liveLists.flatMap(provider=>choices(provider).filter(choice=>choice.value===value).map(choice=>({provider,choice})));
      if(matches.length!==1)throw Error(`Ingredients "${rootColumns.get(c)!.name}", source row ${origin.rows.findIndex(row=>row.id===r)+1}: ${matches.length?'ambiguous':'unmatched'} DD value. Match it to exactly one active website DD record before importing; no text fallback was saved.`);
      const {provider,choice}=matches[0],previous=linkedCells.get(k);
      if(previous&&(previous.table!==choice.binding.table||previous.row!==choice.binding.row||previous.column!==choice.binding.column))
        throw Error('Overlapping Excel validations select different DD records for the same cell. Resolve the conflict before importing.');
      linkedCells.set(k,choice.binding);
      if(!providers.some(r=>r.id===provider.id))providers.push(provider);
    }
    if(providers.length)validationLists.set(v.id,providers);
  }
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
      for(const v of s.validations)if(v.rows.some(r=>rows.has(r))&&v.columns.some(c=>columns.has(c))&&!v.values&&!validationLists.has(v.id))
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
  const catalogTables=new Set<string>(),originalCatalog=matchesDropdownCatalog(source),separateSources:string[]=[];
  for(const t of tables.values()){
    if(t.id===root.id)continue;
    const connected=[...new Map(t.columns.flatMap(c=>matchingLists(t,c.id)).map(r=>[r.id,r])).values()];
    if(connected.length===1){
      const provider=connected[0],backing=book.tables.find(table=>table.id===provider.table),column=backing?.columns.find(c=>c.id===provider.column);
      if(!backing||!column)throw Error('The website DD backing field is missing. Restore it before importing.');
      ids.set(t.id,backing.id);ids.set(t.sheet,backing.sheet);ids.set(t.header,backing.header);
      for(const field of t.columns){
        const mapped=t.columns.length===1?column:backing.columns.find(c=>c.name===field.name);
        if(mapped){ids.set(field.id,mapped.id);ids.set(field.column,mapped.column);}
      }
      if(originalCatalog&&provider.catalog?.id===dropdownCatalog.id&&provider.catalog.rows?.length===t.rows.length)
        t.rows.forEach((row,i)=>ids.set(row,provider.catalog!.rows![i]));
      else for(const row of t.rows){
          const value=source.sheets.find(s=>s.id===t.sheet)!.cells[key(row,t.columns[0].column)]?.value;
          const matches=choices(provider).filter(choice=>choice.value===String(value??''));
          if(matches.length===1)ids.set(row,matches[0].binding.row);
        }
      catalogTables.add(t.id);continue;
    }
    const catalog=originalCatalog?book.references?.find(r=>r.catalog?.id===dropdownCatalog.id&&r.catalog.table===t.name&&r.catalog.rows?.length===t.rows.length):undefined;
    if(catalog){
      const target=book.tables.find(table=>table.id===catalog.table),column=target?.columns.find(c=>c.id===catalog.column);
      if(!target||!column)throw Error('A bundled catalog backing table was removed. Restore it before importing Ingredients.');
      ids.set(t.id,target.id);ids.set(t.sheet,target.sheet);ids.set(t.header,target.header);ids.set(t.columns[0].id,column.id);ids.set(t.columns[0].column,column.column);
      t.rows.forEach((row,i)=>ids.set(row,catalog.catalog!.rows![i]));catalogTables.add(t.id);continue;
    }
    const collision=book.tables.find(existing=>existing.name.toLowerCase()===t.name.toLowerCase());
    let copiedTable=clone(t);
    if(collision){
      if(!book.references?.some(r=>r.table===collision.id&&r.catalog?.id===dropdownCatalog.id))throw Error(`Dropdown table "${t.name}" already exists. Resolve the name collision before importing; it will not be silently relinked.`);
      copiedTable.name=uniqueName(book.tables.map(table=>table.name),t.name);
      separateSources.push(`Different imported source ${t.name} retained separately as ${copiedTable.name}; no catalog links were guessed.`);
    }
    if(!dependencySheets.has(t.sheet)){
      const original=source.sheets.find(s=>s.id===t.sheet)!;
      if(book.sheets.some(s=>s.name.toLowerCase()===original.name.toLowerCase()))throw Error('A Dropdowns sheet already exists. Resolve that collision before importing; its contents will not be overwritten.');
      const copied={...clone(original),cells:{},groups:[],validations:[]} as Sheet;
      dependencySheets.set(t.sheet,copied);book.sheets.push(copied);
    }
    book.tables.push(copiedTable);
  }
  const remap=(id:string)=>ids.get(id)??id;
  const remapAst=(ast:Ast):Ast=>mapAst(ast,node=>{
    if(node.kind==='ref'){
      const owner=[...tables.values()].find(t=>t.sheet===node.sheet&&owned(t).has(node.row)&&t.columns.some(c=>c.column===node.column));
      const destination=owner?book.tables.find(t=>t.id===remap(owner.id)):undefined;
      return {...node,sheet:destination?.sheet??remap(node.sheet),row:remap(node.row),column:remap(node.column)};
    }
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
    if(catalogTables.has(t.id))continue;
    const from=source.sheets.find(s=>s.id===t.sheet)!,to=t.id===root.id?sheet:dependencySheets.get(t.sheet)!;
    const rows=owned(t),columns=new Set(t.columns.map(c=>c.column));
    for(const r of rows)for(const c of columns){
      const original=from.cells[key(r,c)];if(!original)continue;
      const k=key(remap(r),remap(c)),copied=copyCell(original);
      const binding=t.id===root.id?linkedCells.get(key(r,c)):undefined;
      if(binding){copied.binding=clone(binding);delete copied.value;}
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
      const providers=validationLists.get(v.id);
      if(providers){
        copied.originalSource=v.values?v.source:displayFormula(sourceAst(v.source,from,v.rows[0],v.columns[0]),source);
        const asts=providers.map(referenceFormula);
        copied.source=JSON.stringify(asts.length===1?asts[0]:{kind:'call',name:'VSTACK',args:asts});
        delete copied.values;
      }else if(!v.values){
        const ast=sourceAst(v.source,from,v.rows[0],v.columns[0]);
        copied.originalSource=displayFormula(ast,source);
        copied.source=JSON.stringify(remapAst(bindIndirect(ast,from,v.rows[0],v.columns[0])));
      }
      to.validations.push(copied);
    }
    for(const g of from.groups){
      if(g.kind==='summary'&&!(g.axis==='row'?rows:columns).has(g.members[0]))continue;
      const members=g.members.filter(id=>g.axis==='row'?rows.has(id):columns.has(id)).map(remap);
      if((g.kind==='summary'?members.length>1:members.length)&&!to.groups.some(existing=>existing.id===g.id))to.groups.push({...clone(g),members});
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
    entries:[...new Set([...(book.importReport?.entries??[]),...(source.importReport?.entries??[]),...separateSources,
      `Imported ${root.rows.length} Ingredients records and ${tables.size-1} referenced Dropdowns tables. Existing records and all other sheets were retained.`,
      `${linkedCells.size} validated cell values linked to existing active website DD records by exact value; existing DD identities, labels and archives were retained.`,
      ...(preservedFormulas.size?[`${preservedFormulas.size} validated formula cells kept their formulas, rather than replacing nutrition calculations with DD labels.`]:[]),
      ...(preservedLabels.size?[`${preservedLabels.size} ingredient-name inputs with self/external validation kept their record labels. No circular self-links or invented external DD links were created.`]:[]),
      ...(unresolved.size?[`${unresolved.size} source dependency/dependencies outside Ingredients/Dropdowns were not imported. Those references remain explicit #REF! errors, not links to example tables.`]:[])])]};
  book.revision++;
  validateBook(book);
  return {book,sheet:sheet.id,rows:root.rows.length,columns:root.columns.length,retainedRows:oldRows.length,dependencyTables:tables.size-1,unresolvedReferences:unresolved.size,
    linkedDropdownCells:linkedCells.size,preservedFormulaCells:preservedFormulas.size,preservedRecordLabels:preservedLabels.size};
}
