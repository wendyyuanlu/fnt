import { compare,compile,displayFormula,Engine,scalar,type Ast } from './formula';
import { addRow,blankSheet,clone,deleteRows,getCell,isFault,key,mapAst,move,setInput,uid,uniqueName,type ReferenceSource,type Scalar,type Sheet,type Table,type Workbook } from './model';

export interface ReferenceChoice {row:string;value:string;binding:{table:string;row:string;column:string}}
export function referenceTable(book:Workbook,source:ReferenceSource):{table:Table;sheet:Sheet}{
  const table=book.tables.find(t=>t.id===source.table),sheet=book.sheets.find(s=>s.id===table?.sheet);
  if(!table||!sheet)throw Error('The original reference table is missing. Restore or reconnect it explicitly.');
  return{table,sheet};
}
export function referenceChoices(book:Workbook,source:ReferenceSource,includeArchived=false,includeBlank=false):ReferenceChoice[]{
  if(source.archived&&!includeArchived)return[];
  const derived=source.kind==='derived'?source.derived:undefined;
  const table=book.tables.find(t=>t.id===(derived?.table??source.table)),column=table?.columns.find(c=>c.id===(derived?.column??source.column));
  if(!table||!column)throw Error(source.kind==='derived'?'Original derived source unavailable. Choose a source explicitly; example Meals are not substituted.':'The original list or field is missing.');
  const filter=derived?.filter,filterColumn=filter?table.columns.find(c=>c.id===filter.column):undefined;
  if(filter&&!filterColumn)throw Error('The original derived filter field is missing.');
  const engine=new Engine(book),result:ReferenceChoice[]=[];
  for(const row of table.rows){
    if(!includeArchived&&source.archivedRows.includes(row))continue;
    if(filter){
      const value=scalar(engine.cell(table.sheet,row,filterColumn!.column));
      if(isFault(value))throw Error(`Derived filter cannot be calculated: ${value.error}`);
      if(compare(value,filter.value)!==0)continue;
    }
    const value=scalar(engine.cell(table.sheet,row,column.column));
    if(isFault(value))throw Error(`List value cannot be calculated: ${value.error}`);
    if(includeBlank||value!==null&&value!=='')result.push({row,value:String(value??''),binding:{table:table.id,row,column:column.id}});
  }
  return result;
}
export function validationReference(book:Workbook,ast:Ast,context:string,visited=new Set<string>()):ReferenceSource|undefined{
  if(ast.kind==='name'){
    if(!book.names.some(n=>n.id===ast.id))throw Error('#REF!: the named dropdown source was deleted. Restore it or choose a source explicitly.');
    const source=book.references?.find(s=>s.nameId===ast.id);if(source)return source;
    if(visited.has(ast.id))throw Error('Circular named dropdown source.');
    visited.add(ast.id);const named=book.names.find(n=>n.id===ast.id);
    return named?validationReference(book,named.formula,named.context,visited):undefined;
  }
  if(ast.kind==='call'&&ast.name==='INDIRECT'&&ast.args[0]?.kind==='literal'&&typeof ast.args[0].value==='string'){
    const s=book.sheets.find(s=>s.id===context);if(!s)throw Error('Dropdown context is missing.');
    return validationReference(book,compile(ast.args[0].value,book,context,s.rows[0].id,s.columns[0].id),context,visited);
  }
  if(ast.kind==='structured'&&ast.columns.length===1)return book.references?.find(s=>s.table===ast.table&&s.column===ast.columns[0]&&s.kind!=='conversions');
}
export function createReference(book:Workbook,name:string,kind:ReferenceSource['kind']='list'):ReferenceSource{
  if(!name.trim()||(book.references??[]).some(s=>s.name.toLowerCase()===name.trim().toLowerCase()))throw Error('Choose a nonempty, unique reference name.');
  const source:ReferenceSource={id:uid(),name:name.trim(),kind,archivedRows:[]};
  book.references??=[];book.references.push(source);
  if(kind==='derived'){
    source.nameId=uid();book.names.push({id:source.nameId,name:'Source_'+source.id.replace(/-/g,'_'),context:book.sheets[0].id,original:'=#REF!',formula:{kind:'error',value:{error:'#REF!',detail:'Choose the derived list source explicitly.'}}});return source;
  }
  let sheet=book.sheets.find(s=>s.supporting&&s.name==='Lists');
  if(!sheet){sheet=blankSheet(uniqueName(book.sheets.map(s=>s.name),'Lists'),100,6);sheet.supporting=true;book.sheets.push(sheet);}
  const end=Math.max(-3,...book.tables.filter(t=>t.sheet===sheet.id).flatMap(t=>[t.header,...t.rows].map(id=>sheet!.rows.findIndex(r=>r.id===id))),...Object.keys(sheet.cells).map(k=>sheet!.rows.findIndex(r=>r.id===k.split(':')[0])));
  const at=end+3;while(sheet.rows.length<=at+2)sheet.rows.push({id:uid()});
  const fields=kind==='conversions'?['From Unit','To Unit','Conversion Factor']:['Value'];
  const table:Table={id:uid(),name:'List_'+uid().replace(/-/g,'_'),sheet:sheet.id,header:sheet.rows[at].id,rows:[],columns:fields.map((name,i)=>({id:uid(),column:sheet!.columns[i].id,name}))};
  source.table=table.id;source.column=table.columns[0].id;
  if(kind==='conversions')source.conversion={from:table.columns[0].id,to:table.columns[1].id,factor:table.columns[2].id};
  book.tables.push(table);for(const c of table.columns)setInput(book,sheet,table.header,c.column,c.name);
  return source;
}
export function addReferenceValue(book:Workbook,source:ReferenceSource,label:string):string{
  if(!label.trim()||source.kind==='derived'||source.kind==='conversions')throw Error('Enter a nonempty value in an editable list.');
  const {table,sheet}=referenceTable(book,source),column=table.columns.find(c=>c.id===source.column)!;
  if(source.kind==='units'&&referenceChoices(book,source,true).some(o=>o.value===label.trim()))throw Error('This unit label already exists. Select its existing identity.');
  const at=Math.max(sheet.rows.findIndex(r=>r.id===table.header),...table.rows.map(id=>sheet.rows.findIndex(r=>r.id===id)))+1;
  const row=addRow(book,sheet,at,table);setInput(book,sheet,row.id,column.column,"'"+label.trim());return row.id;
}
export function renameReferenceValue(book:Workbook,source:ReferenceSource,row:string,label:string):void{
  if(!label.trim())throw Error('List labels cannot be blank. Archive or delete the option explicitly.');
  const{table,sheet}=referenceTable(book,source),column=table.columns.find(c=>c.id===source.column);
  if(!column||!table.rows.includes(row)||source.kind==='derived'||source.kind==='conversions')throw Error('Choose an editable list option.');
  if(source.kind==='units'&&referenceChoices(book,source,true).some(o=>o.row!==row&&o.value===label.trim()))throw Error('That unit label already has an identity. Replace links explicitly instead.');
  setInput(book,sheet,row,column.column,"'"+label.trim());
}
export function referenceUsages(book:Workbook,source:ReferenceSource,row?:string):{linked:number;formulas:number;manual:number;dropdowns:number}{
  const target=source.derived?.table??source.table,labels=row?referenceChoices(book,source,true).filter(o=>o.row===row).map(o=>o.value):[];
  let linked=0,formulas=0,manual=0,dropdowns=0;
  const sourceSheet=referenceSheet(book,source),table=book.tables.find(t=>t.id===target),records=new Set(table?[table.header,...table.rows]:[]),columns=new Set(table?.columns.map(c=>c.column));
  const references=(ast:Ast,visited=new Set<string>()):boolean=>{
    let found=false;mapAst(ast,n=>{
      if(n.kind==='structured'&&n.table===target||n.kind==='ref'&&n.sheet===sourceSheet&&records.has(n.row)&&columns.has(n.column))found=true;
      if(n.kind==='name'&&!visited.has(n.id)){visited.add(n.id);const named=book.names.find(name=>name.id===n.id);if(named&&references(named.formula,visited))found=true;}
      return n;
    });return found;
  };
  for(const s of book.sheets){
    for(const c of Object.values(s.cells)){
      if(c.binding&&c.binding.table===target&&(!row||c.binding.row===row))linked++;
      if(c.formula&&references(c.formula)||c.calculation&&references(c.calculation))formulas++;
      if(s.id!==sourceSheet&&!c.binding&&typeof c.value==='string'&&labels.includes(c.value))manual++;
    }
    for(const v of s.validations)if(!v.values){
      const ast=v.source.startsWith('{')?JSON.parse(v.source) as Ast:compile(v.source,book,v.sheet,v.rows[0],v.columns[0]);
      if(references(ast)){
        if(validationReference(book,ast,v.sheet)?.id===source.id)dropdowns++;
        else formulas++;
      }
    }
  }
  for(const n of book.names)if(references(n.formula))formulas++;
  return{linked,formulas,manual,dropdowns};
}
function referenceSheet(book:Workbook,source:ReferenceSource):string|undefined{return book.tables.find(t=>t.id===(source.derived?.table??source.table))?.sheet;}
function exclusiveRow(book:Workbook,sheet:Sheet,table:Table,row:string):void{
  if(book.tables.some(t=>t.id!==table.id&&t.sheet===sheet.id&&(t.header===row||t.rows.includes(row))))throw Error('Another table shares this row. Archive the option instead.');
  const columns=new Set(table.columns.map(c=>c.column));
  if(Object.entries(sheet.cells).some(([address,c])=>address.startsWith(row+':')&&!columns.has(address.split(':')[1])&&(c.value!=null||c.formula||c.binding||c.note||c.link)))throw Error('This row contains unrelated freeform data. Archive the option instead.');
}
export function moveReferenceValue(book:Workbook,source:ReferenceSource,row:string,direction:-1|1):void{
  const{table,sheet}=referenceTable(book,source),from=table.rows.indexOf(row),to=from+direction;
  if(from<0||to<0||to>=table.rows.length)throw Error('This option is already at the list boundary.');
  const other=table.rows[to];exclusiveRow(book,sheet,table,row);exclusiveRow(book,sheet,table,other);
  if(Math.abs(sheet.rows.findIndex(r=>r.id===row)-sheet.rows.findIndex(r=>r.id===other))!==1)throw Error('Non-list rows separate these options. Rearrange the backing sheet explicitly instead.');
  move(sheet.rows,sheet.rows.findIndex(r=>r.id===row),sheet.rows.findIndex(r=>r.id===other));move(table.rows,from,to);
}
export function removeReferenceValue(book:Workbook,source:ReferenceSource,row:string,replacement?:string):void{
  if(source.kind==='derived')throw Error('Edit the derived source, not a generated option.');
  const usage=referenceUsages(book,source,row),{table,sheet}=referenceTable(book,source);
  if(usage.formulas||usage.manual)throw Error('Formula/text lookups may use this value. Archive it, or update those references explicitly before deleting.');
  if(usage.linked&&!replacement)throw Error('This option is linked. Replace its links, archive it, or cancel.');
  if(replacement&&(!table.rows.includes(replacement)||replacement===row||source.archivedRows.includes(replacement)))throw Error('Choose a different active replacement from this list.');
  exclusiveRow(book,sheet,table,row);
  for(const s of book.sheets)for(const[k,c]of Object.entries(s.cells))if(c.binding?.table===table.id&&c.binding.row===row)s.cells[k]={...c,binding:{...c.binding,row:replacement!}};
  deleteRows(book,sheet,[row]);source.archivedRows=source.archivedRows.filter(id=>id!==row);
}
export function setDerivedSource(book:Workbook,source:ReferenceSource,tableId:string,columnId:string,filterColumn?:string,value:Scalar=true):void{
  const table=book.tables.find(t=>t.id===tableId),column=table?.columns.find(c=>c.id===columnId),filter=table?.columns.find(c=>c.id===filterColumn);
  if(source.kind!=='derived'||!table||!column||filterColumn&&!filter)throw Error('Choose an existing source and fields explicitly.');
  source.derived={table:tableId,column:columnId,...(filter?{filter:{column:filter.id,value}}:{})};
  const data:Ast={kind:'structured',table:table.id,columns:[column.id],mode:'data'};
  const formula:Ast=filter?{kind:'call',name:'FILTER',args:[data,{kind:'binary',op:'=',left:{kind:'structured',table:table.id,columns:[filter.id],mode:'data'},right:{kind:'literal',value}}]}:data;
  const named=book.names.find(n=>n.id===source.nameId);if(named){named.formula=clone(formula);named.original=displayFormula(formula,book);}
  if(source.anchor){const s=book.sheets.find(s=>s.id===source.anchor!.sheet);if(s)s.cells[key(source.anchor.row,source.anchor.column)]={...getCell(s,source.anchor.row,source.anchor.column),formula:clone(formula),value:undefined,spillHint:true};}
}
export function referenceFormula(source:ReferenceSource):Ast{
  if(source.nameId)return{kind:'name',id:source.nameId};
  if(source.table&&source.column)return{kind:'structured',table:source.table,columns:[source.column],mode:'data'};
  throw Error('Configure this source before using it as a dropdown.');
}
export function unitsSource(book:Workbook):ReferenceSource{
  return book.references?.find(s=>s.kind==='units'&&!s.archived)??createReference(book,uniqueName((book.references??[]).map(s=>s.name),'Units'),'units');
}
export function upsertConversion(book:Workbook,source:ReferenceSource,row:string|undefined,from:string,to:string,factorText:string,confirmed=false):string{
  const units=unitsSource(book),choices=referenceChoices(book,units,true),a=choices.find(o=>o.row===from),b=choices.find(o=>o.row===to);
  if(!a||!b)throw Error('Choose explicit named unit identities.');
  const {table,sheet}=referenceTable(book,source),roles=source.conversion;
  if(source.kind!=='conversions'||!roles||row&&!table.rows.includes(row))throw Error('Choose an existing conversion source and rule.');
  const fields={from:table.columns.find(c=>c.id===roles.from),to:table.columns.find(c=>c.id===roles.to),factor:table.columns.find(c=>c.id===roles.factor)};
  if(!fields.from||!fields.to||!fields.factor)throw Error('A conversion field was deleted. Restore its original identity.');
  factorText=factorText.trim();
  if(!factorText.startsWith('=')&&!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(factorText))throw Error('Enter a numeric conversion factor, or start a formula with =.');
  const engine=new Engine(book),at=row??table.header,input=compile(factorText.startsWith('=')?factorText:'='+factorText,book,sheet.id,at,fields.factor.column),factor=scalar(engine.evaluate(input,sheet.id,at,fields.factor.column));
  if(typeof factor!=='number'||!Number.isFinite(factor)||factor<=0)throw Error('Conversion factors must calculate to a positive finite number.');
  const value=(r:string,c:string)=>scalar(engine.cell(sheet.id,r,c));
  if(table.rows.some(r=>r!==row&&value(r,fields.from!.column)===a.value&&value(r,fields.to!.column)===b.value))throw Error('This unit pair already has a rule. Edit that exact rule instead of adding an ambiguous duplicate.');
  if(row&&!confirmed){
    const previous=getCell(sheet,row,fields.factor.column),changed=(previous.formula?previous.original!==factorText:value(row,fields.factor.column)!==factor)||value(row,fields.from.column)!==a.value||value(row,fields.to.column)!==b.value;
    const usages=referenceUsages(book,source);
    if(changed&&(usages.formulas||usages.linked))throw Error(`Confirm conversion change: ${usages.formulas} formula/source and ${usages.linked} linked cell usages may recalculate, including historical records. No values are frozen automatically.`);
  }
  if(!row){const at=Math.max(sheet.rows.findIndex(r=>r.id===table.header),...table.rows.map(id=>sheet.rows.findIndex(r=>r.id===id)))+1;row=addRow(book,sheet,at,table).id;}
  for(const [field,choice]of [[fields.from,a],[fields.to,b]] as const)sheet.cells[key(row,field.column)]={...getCell(sheet,row,field.column),value:undefined,formula:undefined,binding:choice.binding};
  setInput(book,sheet,row,fields.factor.column,factorText);
  return row;
}
