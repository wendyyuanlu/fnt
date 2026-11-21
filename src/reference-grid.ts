import { Engine,scalar } from './formula';
import { addRow,clone,getCell,key,setInput,uid,type ReferenceSource,type Sheet,type Workbook } from './model';
import { referenceChoices,referenceUsages,renameReferenceValue } from './references';

export function referenceView(book:Workbook,source:ReferenceSource){
  const table=book.tables.find(t=>t.id===(source.derived?.table??source.table));
  const sheet=book.sheets.find(s=>s.id===table?.sheet);
  if(!table||!sheet)return{table,sheet,rows:[] as string[],columns:[] as string[],error:'Original source unavailable. Choose its connection explicitly.'};
  try{
    const rows=source.kind==='derived'?referenceChoices(book,source,true,true).map(c=>c.row):table.rows;
    const columns=source.kind==='derived'?table.columns.filter(c=>c.id===source.derived?.column):table.columns;
    return{table,sheet,rows:[table.header,...rows],columns:columns.map(c=>c.column),error:''};
  }catch(e){return{table,sheet,rows:[] as string[],columns:[] as string[],error:e instanceof Error?e.message:String(e)};}
}
export function writeGridCell(book:Workbook,sheet:Sheet,row:string,column:string,text:string,literal=false):void{
  const source=book.references?.find(r=>r.kind==='units'&&r.table&&book.tables.some(t=>t.id===r.table&&t.sheet===sheet.id&&t.rows.includes(row)&&t.columns.some(c=>c.id===r.column&&c.column===column)));
  if(source&&text.trim()&&(literal||!text.startsWith('=')))renameReferenceValue(book,source,row,text);
  else setInput(book,sheet,row,column,literal?"'"+text:text);
}
export function appendReferenceOption(book:Workbook,source:ReferenceSource,column:string,text:string):string{
  if(source.archived||source.kind==='derived')throw Error('Add options to an available editable DD.');
  if(!text)throw Error('Enter an option before adding a row.');
  const view=referenceView(book,source),{table,sheet}=view;
  if(!table||!sheet||view.error)throw Error(view.error||'The original list is unavailable.');
  if(!table.columns.some(c=>c.column===column))throw Error('This field no longer belongs to the list.');
  const at=Math.max(sheet.rows.findIndex(r=>r.id===table.header),...table.rows.map(id=>sheet.rows.findIndex(r=>r.id===id)))+1,row=addRow(book,sheet,at,table);
  writeGridCell(book,sheet,row.id,column,text);return row.id;
}
export function conversionEditImpact(before:Workbook,after:Workbook):string{
  let oldEngine:Engine|undefined,newEngine:Engine|undefined;
  const changed:ReferenceSource[]=[];
  for(const source of after.references??[]){
    if(source.kind!=='conversions'||!source.conversion)continue;
    const table=after.tables.find(t=>t.id===source.table),sheet=after.sheets.find(s=>s.id===table?.sheet),column=table?.columns.find(c=>c.id===source.conversion!.factor);
    const oldTable=before.tables.find(t=>t.id===source.table),oldSheet=before.sheets.find(s=>s.id===oldTable?.sheet),oldColumn=oldTable?.columns.find(c=>c.id===source.conversion!.factor);
    if(!table||!sheet||!column)continue;
    for(const row of table.rows){
      const cell=getCell(sheet,row,column.column),old=oldSheet&&oldColumn?getCell(oldSheet,row,oldColumn.column):{};
      if(JSON.stringify([cell.value,cell.formula,cell.binding])===JSON.stringify([old.value,old.formula,old.binding]))continue;
      const value=scalar((newEngine??=new Engine(after)).cell(sheet.id,row,column.column));
      if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<=0))throw Error('Conversion factors must be positive numbers or formulas calculating to positive numbers.');
      if(oldSheet&&oldColumn&&oldTable?.rows.includes(row)&&scalar((oldEngine??=new Engine(before)).cell(oldSheet.id,row,oldColumn.column))!==value)changed.push(source);
    }
    const from=table.columns.find(c=>c.id===source.conversion!.from),to=table.columns.find(c=>c.id===source.conversion!.to);
    if(from&&to)for(const row of table.rows){
      const pair=[getCell(sheet,row,from.column),getCell(sheet,row,to.column)],previous=oldSheet?[getCell(oldSheet,row,from.column),getCell(oldSheet,row,to.column)]:[{},{}];
      if(JSON.stringify(pair.map(c=>[c.value,c.binding,c.formula]))===JSON.stringify(previous.map(c=>[c.value,c.binding,c.formula])))continue;
      const engine=newEngine??=new Engine(after),values=[from,to].map(c=>scalar(engine.cell(sheet.id,row,c.column)));
      if(values.some(value=>value!==null&&value!==''&&(typeof value!=='string'||!value.trim())))throw Error('Conversion unit names must be text.');
      if(values.every(value=>typeof value==='string'&&value.trim())&&table.rows.some(other=>other!==row&&!source.archivedRows.includes(other)&&scalar(engine.cell(sheet.id,other,from.column))===values[0]&&scalar(engine.cell(sheet.id,other,to.column))===values[1]))throw Error('A conversion for these units already exists. Edit its factor instead.');
      if(oldSheet&&oldTable?.rows.includes(row)&&[from,to].some((c,i)=>scalar((oldEngine??=new Engine(before)).cell(oldSheet.id,row,c.column))!==values[i]))changed.push(source);
    }
  }
  return [...new Set(changed)].map(source=>{const u=referenceUsages(before,source);return u.formulas||u.linked?`${source.name}: ${u.formulas} formula/source and ${u.linked} linked usages may recalculate, including historical records.`:'';}).filter(Boolean).join(' ');
}
export function deleteReferenceColumns(book:Workbook,source:ReferenceSource,columns:string[]):void{
  const table=book.tables.find(t=>t.id===source.table),sheet=book.sheets.find(s=>s.id===table?.sheet);
  if(!table||!sheet)throw Error('Original source unavailable.');
  const owned=new Set([table.header,...table.rows]),removed=new Set(columns);
  for(const row of owned)for(const column of removed)delete sheet.cells[key(row,column)];
  table.columns=table.columns.filter(c=>!removed.has(c.column));
  if(!table.columns.length)book.tables=book.tables.filter(t=>t.id!==table.id);
  sheet.validations=sheet.validations.flatMap(v=>{
    const outside=v.rows.filter(r=>!owned.has(r)),inside=v.rows.filter(r=>owned.has(r)),remaining=v.columns.filter(c=>!removed.has(c));
    return[...(outside.length?[{...clone(v),rows:outside}]:[]),...(inside.length&&remaining.length?[{...clone(v),id:uid(),rows:inside,columns:remaining}]:[])];
  });
}
