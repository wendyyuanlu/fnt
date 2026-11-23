import {shiftCells,type CellRange} from './cell-operations';
import {Engine,scalar} from './formula';
import { allTables,allSheets,getCell,isFault,key,uid,uniqueName,type Table,type TableSort,type Workbook} from './model';

export function sortedTables(book:Workbook,sort:TableSort):Table[]{
  const alphabetical=(a:Table,b:Table)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base',numeric:true})||a.id.localeCompare(b.id);
  return [...book.tables].sort((a,b)=>{
    if(sort==='za')return alphabetical(b,a);
    if(sort==='az')return alphabetical(a,b);
    const metric=sort==='activity'?'editedAt':'visits';
    return (book.tableActivity?.[b.id]?.[metric]??0)-(book.tableActivity?.[a.id]?.[metric]??0)||alphabetical(a,b);
  });
}

export function recordTableVisit(book:Workbook,id:string):void{
  const previous=book.tableActivity?.[id];
  book.tableActivity={...book.tableActivity,[id]:{...previous,visits:Math.min(Number.MAX_SAFE_INTEGER,(previous?.visits??0)+1)}};
}

export function recordTableEdits(before:Workbook,after:Workbook,changes?:readonly {sheet:string;key:string}[],at=Date.now()):void{
  const previousTables=new Map(allTables(before).map(table=>[table.id,table])),previousSheets=new Map(allSheets(before).map(sheet=>[sheet.id,sheet])),sheets=new Map(allSheets(after).map(sheet=>[sheet.id,sheet]));
  const changed=new Map<string,Set<string>>();
  for(const change of changes??[]){let keys=changed.get(change.sheet);if(!keys)changed.set(change.sheet,keys=new Set());keys.add(change.key);}
  for(const table of allTables(after)){
    const previous=previousTables.get(table.id);
    const edited=!previous||[table,previous].some(bounds=>{
      if(changes&&!changed.has(bounds.sheet))return false;
      const old=previousSheets.get(bounds.sheet),current=sheets.get(bounds.sheet),rows=new Set([bounds.header,...bounds.rows]),columns=new Set(bounds.columns.map(field=>field.column));
      const keys=changes?changed.get(bounds.sheet)!:(function*(){for(const row of rows)for(const column of columns)yield key(row,column);})();
      for(const address of keys){
        const [row,column]=address.split(':');
        if(rows.has(row)&&columns.has(column)&&JSON.stringify(old?.cells[address]??{})!==JSON.stringify(current?.cells[address]??{}))return true;
      }
      return false;
    });
    if(edited)after.tableActivity={...after.tableActivity,[table.id]:{...after.tableActivity?.[table.id],editedAt:at}};
  }
}

function tableName(book:Workbook,name:string,id?:string):string{
  const trimmed=name.trim();
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)||/^[A-Za-z]+\d+$/.test(trimmed))throw Error('Use a name such as Pantry or Meal_Prep, not a cell address.');
  if(allTables(book).some(table=>table.id!==id&&table.name.toLowerCase()===trimmed.toLowerCase()))throw Error('Table name is already in use.');
  return trimmed;
}

export function renameTable(book:Workbook,id:string,name:string):void{
  const table=allTables(book).find(table=>table.id===id);
  if(!table)throw Error('This table no longer exists.');
  table.name=tableName(book,name,id);
}

export function createTable(book:Workbook,sheetId:string,range:CellRange,name:string,hasHeaders:boolean):Table{
  const sheet=allSheets(book).find(sheet=>sheet.id===sheetId);
  if(!sheet)throw Error('This sheet no longer exists.');
  const validName=tableName(book,name),{r1,r2,c1,c2}=range;
  if(!Object.values(range).every(Number.isInteger)||r1<0||c1<0||r2<r1||c2<c1||r2>=sheet.rows.length||c2>=sheet.columns.length)throw Error('Select one rectangular range inside the sheet.');
  if((r2-r1+1)*(c2-c1+1)>200_000)throw Error('Table creation exceeds the safe cell limit. Select a smaller range.');
  const rows=sheet.rows.slice(r1,r2+1).map(row=>row.id),columns=sheet.columns.slice(c1,c2+1);
  if(allTables(book).some(table=>table.sheet===sheet.id&&[table.header,...table.rows].some(row=>rows.includes(row))&&table.columns.some(field=>columns.some(column=>column.id===field.column))))throw Error('Tables cannot overlap.');
  const names:string[]=[],engine=new Engine(book);
  for(const [index,column]of columns.entries()){
    const header=getCell(sheet,rows[0],column.id);
    if(hasHeaders&&(header.formula||header.binding))throw Error('The first row contains formulas or linked values. Uncheck My table has headers to keep them as records.');
    const value=hasHeaders?scalar(engine.cell(sheet.id,rows[0],column.id)):null;
    if(isFault(value))throw Error('A header contains a calculation error. Fix it or uncheck My table has headers.');
    const name=uniqueName(names,String(value??'').trim()||`Column${index+1}`);names.push(name);
  }
  if(!hasHeaders)shiftCells(book,sheet,{r1,r2:r1,c1,c2},'down');
  const table:Table={id:uid(),name:validName,sheet:sheet.id,header:sheet.rows[r1].id,
    rows:sheet.rows.slice(r1+1,r2+(hasHeaders?1:2)).map(row=>row.id),
    columns:columns.map((column,index)=>({id:uid(),column:column.id,name:names[index]}))};
  for(const field of table.columns)sheet.cells[key(table.header,field.column)]={...getCell(sheet,table.header,field.column),value:field.name,formula:undefined,binding:undefined,calculation:undefined,spillHint:undefined,original:undefined};
  (book.dropdownData?.sheets.some(s=>s.id===sheet.id)?book.dropdownData.tables:book.tables).push(table);return table;
}
