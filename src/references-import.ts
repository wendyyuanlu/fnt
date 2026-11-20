import { compile,type Ast } from './formula';
import { clone,key,mapAst,uid,type Named,type ReferenceSource,type Sheet,type Workbook } from './model';
import { addReferenceValue,referenceChoices,unitsSource } from './references';
import { validateBook } from './storage';
import { dropdownCatalog,matchesDropdownCatalog } from './dropdown-catalog';

const auxiliary=(s:Sheet)=>['dropdowns','convert','mealdd'].includes(s.name.toLowerCase());
const sourceNames=['IngredientType','Period','AnimalType','Table14','SnackCountry','SnackFlavour','SnackCategory','Convert'];
function sameImportedCell(incoming:unknown,existing:unknown):boolean{
  const left=clone(incoming) as {format?:{excelNumberFormat?:string}},right=existing as typeof left;
  // Older imports modeled formatting without retaining the original Excel code.
  if(left.format&&right.format&&right.format.excelNumberFormat===undefined)delete left.format.excelNumberFormat;
  const stable=(value:unknown)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  return stable(left)===stable(right);
}
export function mergeReferences(current:Workbook,source:Workbook,original:string,verifiedAttached=false):{book:Workbook;changed:boolean;counts:{name:string;rows:number;columns:number}[];derivedUnavailable:boolean}{
  validateBook(current);validateBook(source);
  const expected=source.tables.filter(t=>sourceNames.includes(t.name)&&source.sheets.some(s=>s.id===t.sheet&&auxiliary(s)));
  if(expected.length!==8||new Set(expected.map(t=>t.name)).size!==8)throw Error('The original seven Dropdowns lists and three-column Convert table are required. No partial source import was applied.');
  const counts=expected.map(t=>({name:t.name,rows:t.rows.length,columns:t.columns.length}));
  const prior=current.references??[];
  if(sourceNames.every(name=>prior.some(r=>r.origin?.original===original&&r.origin.table===name))&&prior.some(r=>r.kind==='derived'&&r.origin?.original===original))return{book:clone(current),changed:false,counts,derivedUnavailable:!current.tables.some(t=>t.id===prior.find(r=>r.kind==='derived'&&r.origin?.original===original)?.derived?.table)};
  const book=clone(current),ids=new Map<string,string>(),known=verifiedAttached&&current.importReport?.originalId===original;
  book.references??=[];
  const existingIngredient=book.tables.filter(t=>t.name==='Ingredients'),incomingIngredient=source.tables.find(t=>t.name==='Ingredients');
  if(known&&existingIngredient.length===1&&incomingIngredient){
    ids.set(incomingIngredient.id,existingIngredient[0].id);
    for(const c of incomingIngredient.columns){const target=existingIngredient[0].columns.find(x=>x.name===c.name);if(target){ids.set(c.id,target.id);ids.set(c.column,target.column);}}
  }
  const destination=new Map<string,Sheet>(),reused=new Set<string>();
  const catalogs=new Map<string,ReferenceSource>(),catalogCells=new Map<string,{sheet:string;row:string;column:string}>();
  if(matchesDropdownCatalog(source))for(const t of expected){
    const ref=book.references.find(r=>r.catalog?.id===dropdownCatalog.id&&r.catalog.table===t.name&&r.catalog.rows?.length===t.rows.length);
    if(!ref)continue;
    const target=book.tables.find(table=>table.id===ref.table);
    if(!target||!target.columns.some(c=>c.id===ref.column))throw Error('A bundled catalog backing table was removed. Restore it or resolve the import explicitly.');
    const column=target.columns.find(c=>c.id===ref.column)!;
    catalogs.set(t.id,ref);reused.add(t.id);ids.set(t.id,target.id);ids.set(t.columns[0].id,column.id);
    for(const[row,to]of [[t.header,target.header],...t.rows.map((row,i)=>[row,ref.catalog!.rows![i]])])catalogCells.set(key(row,t.columns[0].column),{sheet:target.sheet,row:to,column:column.column});
  }
  for(const s of source.sheets.filter(auxiliary)){
    const matches=book.sheets.filter(x=>x.name.toLowerCase()===s.name.toLowerCase());
    if(matches.length>1)throw Error('Ambiguous supporting sheet name. Resolve it explicitly before import.');
    const target=matches[0];
    if(target){
      if(!known||s.name.toLowerCase()!=='dropdowns'||target.rows.length!==s.rows.length||target.columns.length!==s.columns.length)throw Error('An existing supporting sheet collides with this import. It was not overwritten or relinked.');
      ids.set(s.id,target.id);s.rows.forEach((r,i)=>ids.set(r.id,target.rows[i].id));s.columns.forEach((c,i)=>ids.set(c.id,target.columns[i].id));
      destination.set(s.id,target);
    }else{
      const copied={...clone(s),cells:{},validations:[],groups:[]};book.sheets.push(copied);destination.set(s.id,copied);
    }
  }
  for(const t of expected){
    if(catalogs.has(t.id))continue;
    const matches=book.tables.filter(x=>x.name.toLowerCase()===t.name.toLowerCase()),target=matches[0],s=source.sheets.find(s=>s.id===t.sheet)!,to=destination.get(t.sheet)!;
    if(matches.length>1)throw Error('Ambiguous reference table name. Resolve it explicitly.');
    if(target){
      if(!known||target.sheet!==to.id||target.header!==(ids.get(t.header)??t.header)||target.rows.length!==t.rows.length||target.columns.length!==t.columns.length)throw Error(`Reference table "${t.name}" already exists with different provenance or shape.`);
      for(let i=0;i<t.columns.length;i++){
        const c=t.columns[i],old=target.columns[i];if(c.name!==old.name||old.column!==(ids.get(c.column)??c.column))throw Error('Existing reference columns were edited. Choose a merge explicitly.');
        ids.set(c.id,old.id);
        for(let j=0;j<=t.rows.length;j++){
          const r=j?t.rows[j-1]:t.header,existing=j?target.rows[j-1]:target.header;
          if(existing!==(ids.get(r)??r)||!sameImportedCell(s.cells[key(r,c.column)]??{},to.cells[key(existing,old.column)]??{}))throw Error('Existing reference values or formatting were edited. They were not overwritten.');
        }
      }
      ids.set(t.id,target.id);reused.add(t.id);
    }
  }
  const remap=(id:string)=>ids.get(id)??id;
  const remapAst=(ast:Ast):Ast=>mapAst(ast,n=>{
    if(n.kind==='ref'){
      const cell=catalogCells.get(key(n.row,n.column));
      return cell?{...n,...cell}:{...n,sheet:remap(n.sheet),row:remap(n.row),column:remap(n.column)};
    }
    if(n.kind==='structured')return{...n,table:remap(n.table),columns:n.columns.map(remap)};
    if(n.kind==='name')return{...n,id:remap(n.id)};
    return n;
  });
  const globals=source.names.filter(n=>!n.sheet&&['IngredientDD','MealDD'].includes(n.name));
  for(const n of globals){
    const matches=book.names.filter(x=>!x.sheet&&x.name===n.name);
    if(matches.length>1||matches[0]&&(!known||matches[0].original!==n.original))throw Error('An existing named dropdown was edited or has another origin. Resolve it explicitly.');
    if(matches[0]){
      ids.set(n.id,matches[0].id);
      const before:Extract<Ast,{kind:'structured'}>[]=[],after:Extract<Ast,{kind:'structured'}>[]=[];
      mapAst(n.formula,node=>{if(node.kind==='structured')before.push(node);return node;});mapAst(matches[0].formula,node=>{if(node.kind==='structured')after.push(node);return node;});
      if(before.length===after.length)before.forEach((node,i)=>{
        const old=after[i];
        if(!book.tables.some(t=>t.id===old.table)&&node.columns.length===old.columns.length){ids.set(node.table,old.table);node.columns.forEach((c,j)=>ids.set(c,old.columns[j]));}
      });
    }
  }
  for(const t of expected){
    const catalog=catalogs.get(t.id);
    if(catalog){catalog.origin={original,table:t.name};continue;}
    const copied={...clone(t),id:remap(t.id),sheet:remap(t.sheet),header:remap(t.header),rows:t.rows.map(remap),columns:t.columns.map(c=>({...c,id:remap(c.id),column:remap(c.column)}))};
    if(!reused.has(t.id))book.tables.push(copied);
    const s=source.sheets.find(s=>s.id===t.sheet)!,to=destination.get(t.sheet)!;
    for(const r of[t.header,...t.rows])for(const c of t.columns){
      const cell=s.cells[key(r,c.column)];if(!cell)continue;
      const address=key(remap(r),remap(c.column)),existing=to.cells[address];
      if(!reused.has(t.id)&&existing&&JSON.stringify(existing)!==JSON.stringify(cell))throw Error('Supporting import intersects existing cells. Existing edits were retained.');
      if(!reused.has(t.id))to.cells[address]={...clone(cell),...(cell.formula?{formula:remapAst(cell.formula)}:{})};
    }
    const ref:ReferenceSource={id:uid(),name:t.name,kind:t.name==='Convert'?'conversions':'list',table:copied.id,column:copied.columns[0].id,archivedRows:[],origin:{original,table:t.name}};
    if(book.references.some(old=>old.name.toLowerCase()===ref.name.toLowerCase()))throw Error('A managed source with this name already exists. Choose a merge explicitly.');
    if(t.name==='Convert'){
      const fields=['From Unit','To Unit','Conversion Factor'].map(name=>copied.columns.find(c=>c.name===name));
      if(fields.some(c=>!c)||copied.columns.length!==3)throw Error('Convert must retain its original three fields.');
      ref.conversion={from:fields[0]!.id,to:fields[1]!.id,factor:fields[2]!.id};
    }else if(copied.columns.length!==1)throw Error('Dropdown reference lists must contain one column.');
    book.references.push(ref);to.supporting=true;
    const owned=new Set([t.header,...t.rows]),columns=new Set(t.columns.map(c=>c.column));
    for(const v of s.validations)if(v.rows.some(r=>owned.has(r))&&v.columns.some(c=>columns.has(c)))to.validations.push({...clone(v),id:uid(),sheet:to.id,rows:v.rows.filter(r=>owned.has(r)).map(remap),columns:v.columns.filter(c=>columns.has(c)).map(remap),source:v.source.startsWith('{')?JSON.stringify(remapAst(JSON.parse(v.source) as Ast)):v.source});
    for(const g of s.groups){const members=g.members.filter(id=>g.axis==='row'?owned.has(id):columns.has(id)).map(remap);if(members.length&&!to.groups.some(old=>old.id===g.id))to.groups.push({...clone(g),members});}
  }
  for(const n of globals)if(!book.names.some(old=>old.id===remap(n.id)))book.names.push({...clone(n),id:remap(n.id),context:remap(n.context),formula:remapAst(n.formula)});
  const meal=source.sheets.find(s=>s.name.toLowerCase()==='mealdd');
  if(!meal)throw Error('The original MealDD definition is missing.');
  const anchor=Object.entries(meal.cells).find(([,c])=>c.formula);
  if(!anchor)throw Error('MealDD must contain its original live formula; cached values were not substituted.');
  const[r,c]=anchor[0].split(':'),to=destination.get(meal.id)!,formula=remapAst(anchor[1].formula!);
  to.cells[key(remap(r),remap(c))]={...clone(anchor[1]),formula,value:undefined,spillHint:true};to.supporting=true;
  const name=globals.find(n=>n.name==='MealDD'),nodes:Extract<Ast,{kind:'structured'}>[]=[];
  mapAst(formula,n=>{if(n.kind==='structured')nodes.push(n);return n;});
  if(nodes.length<2||nodes[0].table!==nodes[1].table)throw Error('MealDD has an unfamiliar source/filter definition. It needs an explicit source selection.');
  const deferredNames:Named[]=source.names.filter(n=>n.sheet&&['MealDD','IngredientDD'].includes(n.name)).map(n=>({...clone(n),formula:remapAst(n.formula)}));
  const derived:ReferenceSource={id:uid(),name:'MealDD',kind:'derived',archivedRows:[],origin:{original,definition:anchor[1].original},derived:{table:nodes[0].table,column:nodes[0].columns[0],filter:{column:nodes[1].columns[0],value:true}},anchor:{sheet:to.id,row:remap(r),column:remap(c)},nameId:name?remap(name.id):undefined,deferredNames};
  book.references.push(derived);
  const unitList=unitsSource(book),units=new Map(referenceChoices(book,unitList,true).map(choice=>[choice.value,choice.binding]));
  for(const ref of book.references.filter(ref=>ref.kind==='conversions'&&ref.origin?.original===original)){
    const table=book.tables.find(t=>t.id===ref.table)!,sheet=book.sheets.find(s=>s.id===table.sheet)!;
    for(const row of table.rows)for(const id of[ref.conversion!.from,ref.conversion!.to]){
      const column=table.columns.find(c=>c.id===id)!.column,cell=sheet.cells[key(row,column)],label=cell?.value;
      if(typeof label!=='string'||!label)continue;
      if(!units.has(label)){const record=addReferenceValue(book,unitList,label);units.set(label,{table:unitList.table!,row:record,column:unitList.column!});}
      sheet.cells[key(row,column)]={...cell,value:undefined,binding:units.get(label)};
    }
  }
  for(const s of book.sheets)for(const v of s.validations)if(v.originalSource){
    // Rebind only named/table auxiliary sources from the byte-verified original.
    if(!known)continue;
    const originalSheet=source.sheets.find(original=>original.name===s.name);if(!originalSheet)continue;
    const ast=mapAst(compile(v.originalSource,source,originalSheet.id,originalSheet.rows[0].id,originalSheet.columns[0].id),n=>{
      if(n.kind==='call'&&n.name==='INDIRECT'&&n.args[0]?.kind==='literal'&&typeof n.args[0].value==='string')return compile(n.args[0].value,source,originalSheet.id,originalSheet.rows[0].id,originalSheet.columns[0].id);
      return n;
    });
    v.source=JSON.stringify(remapAst(ast));
  }
  for(const table of book.tables){
    for(const column of table.columns.filter(c=>['Unit','Conversion Unit'].includes(c.name))){
      book.pickerSources[`${table.sheet}:${column.column}`]??=`${unitList.table}:${unitList.column}`;
    }
  }
  book.revision++;validateBook(book);
  return{book,changed:true,counts,derivedUnavailable:!book.tables.some(t=>t.id===derived.derived!.table)};
}
