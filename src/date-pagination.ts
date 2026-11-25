import {excelDateParts,parseDateInput} from './dates';
import {allTables,getCell,type Sheet,type Workbook} from './model';
import {scalar,type Engine} from './formula';

export interface DatePagination {mode:'one'|'calendar';days:number;table:string;column:string;marker?:string}
export interface DatePages {
  pages:number[][];ranges:{start:number;end:number}[];unassigned:number[];rowPage:Map<number,number>;header:number;
}
export function paginationDefault(book:Workbook,sheet:Sheet):DatePagination|undefined{
  const table=allTables(book).find(t=>t.sheet===sheet.id&&t.name==='Master'),date=table?.columns.find(c=>c.name==='Date');
  return table&&date?{mode:'calendar',days:90,table:table.id,column:date.id,marker:table.columns.find(c=>c.name==='isDay')?.id}:undefined;
}
export function dateSerial(value:unknown,literal=false):number|undefined{
  if(literal)return;
  const serial=typeof value==='number'?Math.floor(value):typeof value==='string'?parseDateInput(value):undefined;
  return serial!==undefined&&excelDateParts(serial)?serial:undefined;
}
export function validatePagination(value:DatePagination):void{
  if(!value||!['one','calendar'].includes(value.mode)||!Number.isSafeInteger(value.days)||value.days<1||value.days>2958466||
    typeof value.table!=='string'||!/^[a-zA-Z0-9_.-]{1,128}$/.test(value.table)||typeof value.column!=='string'||!/^[a-zA-Z0-9_.-]{1,128}$/.test(value.column)||value.marker!==undefined&&(typeof value.marker!=='string'||!/^[a-zA-Z0-9_.-]{1,128}$/.test(value.marker)))
    throw Error('Page settings require a date table, date field and a positive whole number of calendar days.');
}
export function buildDatePages(book:Workbook,sheet:Sheet,config:DatePagination,engine:Engine):DatePages{
  validatePagination(config);
  const table=allTables(book).find(t=>t.id===config.table&&t.sheet===sheet.id),field=table?.columns.find(c=>c.id===config.column),marker=config.marker?table?.columns.find(c=>c.id===config.marker):undefined;
  if(!table||!field||config.marker&&!marker)throw Error('Date page table or field is missing. Open Page settings to reconnect it, or use One page.');
  const indices=new Map(sheet.rows.map((r,i)=>[r.id,i])),entries:{date?:number;rows:number[]}[]=[];
  let entry:typeof entries[number]|undefined;
  for(const row of table.rows){
    const index=indices.get(row);if(index===undefined)throw Error('A date page record is missing from the sheet.');
    const cell=getCell(sheet,row,field.column),date=dateSerial(scalar(engine.cell(sheet.id,row,field.column)),cell.dateLiteral);
    const flag=marker?scalar(engine.cell(sheet.id,row,marker.column)):undefined;
    if(marker&&flag&&typeof flag==='object'&&'error'in flag)throw Error('A day header marker has a calculation error. Repair it, or use One page.');
    const header=marker?(flag===true||typeof flag==='number'&&flag!==0||typeof flag==='string'&&flag!==''):true;
    if(header||!entry){entry={date,rows:[]};entries.push(entry);}
    entry.rows.push(index);
  }
  const dated=entries.filter((e):e is typeof e&{date:number}=>e.date!==undefined),latest=dated.length?dated.reduce((n,e)=>Math.max(n,e.date),dated[0].date):undefined;
  const earliest=dated.length?dated.reduce((n,e)=>Math.min(n,e.date),dated[0].date):undefined;
  const count=latest===undefined||earliest===undefined?0:Math.ceil((latest-earliest+1)/config.days);
  if(count>100000)throw Error('This date range would create more than 100,000 pages. Increase calendar days per page.');
  const ranges=Array.from({length:count},(_,i)=>({end:latest!-i*config.days,start:Math.max(earliest!,latest!-(i+1)*config.days+1)}));
  const pages=ranges.map(()=>[] as number[]),rowPage=new Map<number,number>(),unassigned=entries.filter(e=>e.date===undefined).flatMap(e=>e.rows);
  for(const entry of [...dated].sort((a,b)=>a.date-b.date||a.rows[0]-b.rows[0])){
    const page=Math.floor((latest!-entry.date)/config.days);pages[page].push(...entry.rows);for(const row of entry.rows)rowPage.set(row,page);
  }
  const owned=new Set(table.rows),header=indices.get(table.header);if(header===undefined)throw Error('The date table header is missing.');
  const used=new Set(Object.entries(sheet.cells).filter(([,c])=>c.value!=null&&c.value!==''||c.formula||c.binding||c.note).map(([key])=>key.split(':')[0]));
  for(const row of sheet.rows)if(row.id!==table.header&&!owned.has(row.id)&&used.has(row.id))unassigned.push(indices.get(row.id)!);
  for(const row of unassigned)rowPage.set(row,pages.length);
  return{pages,ranges,unassigned,rowPage,header};
}
export function pageForDate(plan:DatePages,date:number):number{
  return plan.ranges.findIndex(range=>date>=range.start&&date<=range.end);
}
export const datePagesIcon='<svg class="date-pages-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M7 3H20V17H17M4 7H17V21H4Z"/><path d="M7 11H14M7 15H14"/></svg>';
export const onePageIcon='<svg class="one-page-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M5 3H19V21H5Z"/><path d="M8 8H16M8 12H16M8 16H14"/></svg>';
