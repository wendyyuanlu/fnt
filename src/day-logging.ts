import {Engine,scalar} from './formula';
import {dateSerial} from './date-pagination';
import {excelDate,maxDateSerial} from './dates';
import {addRow,adjacentTableForCell,allTables,getCell,inheritTableRow,isFault,key,setInput,uid,type Sheet,type Workbook} from './model';
import {defaultHeaderFormula} from './meal-block';
import {hypotheticalProjection} from './grouping';

export interface DayLogging{
  table:string;date:string;marker:string;label:string;food?:string;totals:string[];
  nextDate:number|null;direction:'forward'|'backward';
}
export function localToday(now=new Date()):number{
  const date=excelDate(now.getFullYear(),now.getMonth()+1,now.getDate());
  if(date===undefined)throw Error('The device calendar date is outside the supported range.');
  return date;
}
export function validateDayLogging(config:DayLogging):void{
  const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(value);
  if(!config||![config.table,config.date,config.marker,config.label].every(id)||config.food!==undefined&&!id(config.food)||!Array.isArray(config.totals)||config.totals.length>512||!config.totals.every(id)||new Set(config.totals).size!==config.totals.length||!['forward','backward'].includes(config.direction)||config.nextDate!==null&&(!Number.isSafeInteger(config.nextDate)||config.nextDate<1||config.nextDate>maxDateSerial))throw Error('New day settings require valid field identities, a calendar date and a logging direction.');
}
export function masterLogging(book:Workbook,sheet:Sheet){
  const saved=sheet.dayLogging,table=saved?allTables(book).find(table=>table.sheet===sheet.id&&table.id===saved.table):allTables(book).find(table=>table.sheet===sheet.id&&table.name==='Master')??allTables(book).find(table=>table.sheet===sheet.id&&table.id===sheet.pagination?.table);
  if(!table)throw Error('The Master logging table is missing.');
  const field=(id:string|undefined,name:string)=>id?table.columns.find(field=>field.id===id):table.columns.find(field=>field.name.toLowerCase()===name.toLowerCase());
  const page=sheet.pagination?.table===table.id?sheet.pagination:undefined;
  const date=field(saved?.date??page?.column,'Date'),marker=field(saved?.marker,'isDay')??(!saved?field(page?.marker,'isDay'):undefined),label=field(saved?.label,'Weight'),food=field(saved?.food,'Food');
  if(!date||!marker||!label)throw Error('Master logging needs its Date, isDay and Weight fields. Restore a removed field with Undo or from a backup before logging.');
  const config:DayLogging=saved??{table:table.id,date:date.id,marker:marker.id,label:label.id,...(food?{food:food.id}:{}),totals:table.columns.filter(field=>/^(Calories(?: \(kcal\))?|(?:Fat|Carbs|Sugar|Protein)(?: \(g\))?|Sodium(?: \(mg\))?)$/i.test(field.name)).map(field=>field.id),nextDate:localToday(),direction:'forward'};
  validateDayLogging(config);
  return{table,date,marker,label,food,config};
}
export function masterDayBlocks(book:Workbook,sheet:Sheet){
  const context=masterLogging(book,sheet),engine=new Engine(book),blocks:{header:string;rows:string[];date?:number;isDay:boolean}[]=[];
  for(const row of context.table.rows){
    const flag=scalar(engine.cell(sheet.id,row,context.marker.column));
    if(isFault(flag))throw Error('A Master day marker has an error. Fix it before changing day organization.');
    const isDay=flag===true||typeof flag==='number'&&flag!==0||typeof flag==='string'&&flag!=='';
    if(isDay||!blocks.length){
      const cell=getCell(sheet,row,context.date.column);
      blocks.push({header:row,rows:[],isDay,date:isDay?dateSerial(scalar(engine.cell(sheet.id,row,context.date.column)),cell.dateLiteral):undefined});
    }
    blocks.at(-1)!.rows.push(row);
  }
  return blocks;
}
export function sortMasterDays(book:Workbook,sheet:Sheet):void{
  const {table}=masterLogging(book,sheet),blocks=masterDayBlocks(book,sheet);
  const ordered=[...blocks].sort((a,b)=>(a.date??Infinity)-(b.date??Infinity)).flatMap(block=>block.rows);
  if(ordered.every((id,i)=>id===table.rows[i]))return;
  const owned=new Set(table.rows);
  if(allTables(book).some(other=>other.sheet===sheet.id&&other.id!==table.id&&[other.header,...other.rows].some(id=>owned.has(id))))throw Error('Date sorting would also move another table on these sheet rows. Separate that table before sorting Master days.');
  const byId=new Map(sheet.rows.map(row=>[row.id,row]));let at=0;
  sheet.rows=sheet.rows.map(row=>owned.has(row.id)?byId.get(ordered[at++])!:row);
  table.rows=ordered;
}
function advance(config:DayLogging):void{
  if(config.nextDate===null)throw Error('Choose a next logging date in New day settings.');
  const next=config.nextDate+(config.direction==='forward'?1:-1);
  config.nextDate=next<1||next>maxDateSerial?null:next;
}
function explicitDate(sheet:Sheet,row:string,column:string,value:number|null):void{
  const previous=getCell(sheet,row,column);
  sheet.cells[key(row,column)]={...previous,value,formula:undefined,calculation:previous.formula??previous.calculation,spillHint:undefined,dateLiteral:undefined,format:{...previous.format,number:'date'}};
}
function initializeTotals(book:Workbook,sheet:Sheet,row:string,preserveOverrides=false):void{
  const {table,marker,config}=masterLogging(book,sheet);
  for(const id of config.totals){
    const column=table.columns.find(field=>field.id===id);
    if(!column)throw Error('A configured Master total field was removed. Restore it before creating a new day.');
    const cell=getCell(sheet,row,column.column);
    if(preserveOverrides&&!cell.formula&&cell.value!==undefined&&cell.value!==null&&cell.value!=='')continue;
    setInput(book,sheet,row,column.column,defaultHeaderFormula(book,table,id,{marker:marker.id,boolean:true}));
  }
}
function foodDate(sheet:Sheet,row:string,column:string,header:string,table:string):void{
  const previous=getCell(sheet,row,column);
  sheet.cells[key(row,column)]={...previous,value:undefined,calculation:previous.formula??previous.calculation,formula:{kind:'ref',sheet:sheet.id,row:header,column,absRow:true,absCol:true},spillHint:undefined,dateLiteral:undefined,dayDateTable:table};
}
export function refreshMasterFoodDates(book:Workbook,sheetId?:string):void{
  for(const sheet of book.sheets){
    if(!sheet.dayLogging||sheetId&&sheet.id!==sheetId)continue;
    const owner=allTables(book).find(table=>table.sheet===sheet.id&&table.id===sheet.dayLogging!.table);
    if(!owner||[sheet.dayLogging.date,sheet.dayLogging.marker,sheet.dayLogging.label].some(id=>!owner.columns.some(field=>field.id===id)))continue;
    const {table,date}=masterLogging(book,sheet);
    if(!table.rows.some(row=>getCell(sheet,row,date.column).dayDateTable===table.id))continue;
    for(const block of masterDayBlocks(book,sheet))if(block.isDay)for(const row of block.rows.slice(1)){
      const cell=getCell(sheet,row,date.column);
      if(cell.dayDateTable===table.id&&cell.formula?.kind==='ref'&&cell.formula.row!==block.header)sheet.cells[key(row,date.column)]={...cell,formula:{...cell.formula,row:block.header}};
    }
  }
}
function inheritFood(book:Workbook,sheet:Sheet,row:string,templates:Set<string>):void{
  const {table}=masterLogging(book,sheet);
  if(templates.size)inheritTableRow(book,sheet,table,row,table.rows.indexOf(row),false,templates);
  else for(const field of table.columns){
    const old=getCell(sheet,row,field.column);
    sheet.cells[key(row,field.column)]={format:old.format};
    if(field.formulaDefault)setInput(book,sheet,row,field.column,field.formulaDefault);
  }
  for(const field of table.columns)if(field.formulaDefault&&!getCell(sheet,row,field.column).formula)setInput(book,sheet,row,field.column,field.formulaDefault);
}
function attachFood(sheet:Sheet,table:string,block:{header:string;rows:string[]},row:string):void{
  for(const group of sheet.groups)if(group.axis==='row'&&(!group.table||group.table===table)&&group.members.includes(block.header)&&!group.members.includes(row))group.members.push(row);
  if(!sheet.groups.some(group=>group.axis==='row'&&group.kind==='summary'&&(!group.table||group.table===table)&&group.members[0]===block.header))sheet.groups.push({id:uid(),axis:'row',kind:'summary',table,members:[...block.rows,row],collapsed:false,label:'Day details'});
  for(const group of sheet.groups)if(group.axis==='row'&&group.members[0]===block.header)group.collapsed=false;
}
export function createMasterDay(book:Workbook,sheet:Sheet,hypothetical=false,tableScope=false,options?:{date?:number;advance?:boolean}):{row:string;created:boolean}{
  const {table,date,marker,label,food,config}=masterLogging(book,sheet);
  const loggingDate=options?.date??config.nextDate;
  if(!hypothetical&&(loggingDate===null||!Number.isSafeInteger(loggingDate)||loggingDate<1||loggingDate>maxDateSerial))throw Error('Choose a valid logging date in New day settings.');
  const blocks=masterDayBlocks(book,sheet),hypo=hypotheticalProjection(book,sheet,'row');
  const existing=!hypothetical?blocks.find(block=>block.isDay&&block.date===loggingDate&&!hypo(block.header,date.column)):undefined;
  if(existing)return{row:existing.header,created:false};
  if(sheet.rows.length>99998)throw Error('There is not enough worksheet space to create a day and its first food row.');
  if(config.totals.some(id=>!table.columns.some(field=>field.id===id)))throw Error('A configured Master total field was removed. Restore it before creating a new day.');
  anchorMasterDates(book,sheet);
  const at=table.rows.length?sheet.rows.findIndex(row=>row.id===table.rows.at(-1))+1:sheet.rows.findIndex(row=>row.id===table.header)+1;
  const header=addRow(book,sheet,at,table);
  setInput(book,sheet,header.id,label.column,hypothetical?'Hypothetical':'x');
  if(!getCell(sheet,header.id,marker.column).formula)setInput(book,sheet,header.id,marker.column,'TRUE');
  if(food)setInput(book,sheet,header.id,food.column,'');
  explicitDate(sheet,header.id,date.column,hypothetical?null:loggingDate);
  initializeTotals(book,sheet,header.id);
  if(hypothetical){if(tableScope)header.hypotheticalTables={[table.id]:true};else header.hypothetical=true;}
  const detail=addRow(book,sheet,at+1,table);
  inheritFood(book,sheet,detail.id,new Set(blocks.flatMap(block=>block.rows.slice(block.isDay?1:0))));
  if(!getCell(sheet,detail.id,marker.column).formula)setInput(book,sheet,detail.id,marker.column,'FALSE');
  foodDate(sheet,detail.id,date.column,header.id,table.id);
  sheet.groups.push({id:uid(),axis:'row',kind:'summary',...(tableScope?{table:table.id}:{}),members:[header.id,detail.id],collapsed:false,label:hypothetical?'Hypothetical day':'Day details'});
  sheet.dayLogging={...config,totals:[...config.totals]};
  if(!hypothetical&&options?.advance!==false&&sheet.dayLogging.nextDate!==null)advance(sheet.dayLogging);
  sortMasterDays(book,sheet);
  return{row:header.id,created:true};
}
export function addMasterFood(book:Workbook,sheet:Sheet,selectedRow?:string):string{
  const {table,date,marker,food,config}=masterLogging(book,sheet);
  if(!food)throw Error('Restore the Master Food field before adding food.');
  const blocks=masterDayBlocks(book,sheet),block=blocks.find(block=>block.isDay&&block.rows.includes(selectedRow??''))??blocks.filter(block=>block.isDay&&block.date!==undefined).sort((a,b)=>b.date!-a.date!)[0];
  if(!block)throw Error('Create or select a day before adding food.');
  if(sheet.rows.length>=100000)throw Error('This sheet has reached its row limit.');
  const at=sheet.rows.findIndex(row=>row.id===block.rows.at(-1))+1,templates=new Set(blocks.flatMap(block=>block.rows.slice(block.isDay?1:0)));
  const row=addRow(book,sheet,at,table);
  inheritFood(book,sheet,row.id,templates);
  if(!getCell(sheet,row.id,marker.column).formula)setInput(book,sheet,row.id,marker.column,'FALSE');
  foodDate(sheet,row.id,date.column,block.header,table.id);attachFood(sheet,table.id,block,row.id);
  sheet.dayLogging??={...config,totals:[...config.totals]};
  return row.id;
}
export function isMasterDayInput(book:Workbook,sheet:Sheet,row:string,column:string):boolean{
  const table=sheet.dayLogging?allTables(book).find(table=>table.sheet===sheet.id&&table.id===sheet.dayLogging!.table):allTables(book).find(table=>table.sheet===sheet.id&&table.name==='Master')??allTables(book).find(table=>table.sheet===sheet.id&&table.id===sheet.pagination?.table);
  if(!table||row===table.header||!table.rows.includes(row)&&adjacentTableForCell(book,sheet,row,column)?.id!==table.id)return false;
  const date=table.columns.find(field=>field.id===(sheet.dayLogging?.date??sheet.pagination?.column)||!sheet.dayLogging&&field.name==='Date'),label=table.columns.find(field=>field.id===sheet.dayLogging?.label||!sheet.dayLogging&&field.name==='Weight');
  if(column!==date?.column&&column!==label?.column)return false;
  const context=masterLogging(book,sheet),flag=scalar(new Engine(book).cell(sheet.id,row,context.marker.column));
  return column===label?.column||flag===true||typeof flag==='number'&&flag!==0||typeof flag==='string'&&flag!=='';
}
export function editMasterDayInput(book:Workbook,sheet:Sheet,row:string,column:string,write:()=>void):void{
  editMasterDayInputs(book,sheet,[{row,column}],write);
}
export function editMasterDayInputs(book:Workbook,sheet:Sheet,updates:{row:string;column:string}[],write:()=>void):void{
  const context=masterLogging(book,sheet),before=new Set(masterDayBlocks(book,sheet).filter(block=>block.isDay).map(block=>block.header));
  anchorMasterDates(book,sheet);
  write();
  const after=masterDayBlocks(book,sheet),changedDates=new Set(updates.filter(update=>update.column===context.date.column).map(update=>update.row));
  sheet.dayLogging??={...context.config,totals:[...context.config.totals]};
  const hypo=hypotheticalProjection(book,sheet,'row');
  for(const block of after)if(block.isDay){
    const row=block.header;
    if(!before.has(row)){
      initializeTotals(book,sheet,row,true);
      if(hypo(row,context.date.column))explicitDate(sheet,row,context.date.column,null);
      else{
        if(!changedDates.has(row))explicitDate(sheet,row,context.date.column,sheet.dayLogging.nextDate);
        if(!changedDates.has(row)||block.date!==undefined)advance(sheet.dayLogging);
      }
    }
    if(changedDates.has(row)){
      const cell=getCell(sheet,row,context.date.column);
      if(cell.value!==null&&cell.value!==''&&cell.value!==undefined&&block.date===undefined&&!cell.formula)throw Error('Use a valid day date, or clear it to leave the group undated.');
    }
  }
  anchorMasterDates(book,sheet);
  if(after.some(block=>block.isDay&&(!before.has(block.header)||changedDates.has(block.header))))sortMasterDays(book,sheet);
}

export function anchorMasterDates(book:Workbook,sheet:Sheet,engine=new Engine(book)):number{
  const saved=sheet.dayLogging,table=saved?allTables(book).find(table=>table.sheet===sheet.id&&table.id===saved.table):allTables(book).find(table=>table.sheet===sheet.id&&table.name==='Master')??allTables(book).find(table=>table.sheet===sheet.id&&table.id===sheet.pagination?.table);
  const config=saved?{column:saved.date,marker:saved.marker}:sheet.pagination?.table===table?.id?sheet.pagination:undefined;
  const date=config?.column?table?.columns.find(field=>field.id===config.column):table?.columns.find(field=>field.name==='Date');
  const marker=saved?table?.columns.find(field=>field.id===saved.marker):table?.columns.find(field=>field.name==='isDay')??table?.columns.find(field=>field.id===config?.marker);
  if(!table||!date||!marker)throw Error('Reconnect the Master Date and day-header fields in Page settings before moving its rows.');
  const anchors:{row:string;date:number}[]=[];
  for(const row of table.rows){
    const cell=getCell(sheet,row,date.column);if(!cell.formula)continue;
    const flag=scalar(engine.cell(sheet.id,row,marker.column));
    if(flag&&typeof flag==='object'&&'error'in flag)throw Error('A Master day-header calculation has an error. Its rows have not been moved.');
    if(!(flag===true||typeof flag==='number'&&flag!==0||typeof flag==='string'&&flag!==''))continue;
    const value=dateSerial(scalar(engine.cell(sheet.id,row,date.column)),cell.dateLiteral);
    if(value===undefined||value<1||value>maxDateSerial)throw Error('A Master day-header formula has no valid calculated date. Its rows have not been moved.');
    anchors.push({row,date:value});
  }
  for(const anchor of anchors){
    const address=key(anchor.row,date.column),cell=sheet.cells[address];
    sheet.cells[address]={...cell,value:anchor.date,calculation:cell.formula,formula:undefined,spillHint:undefined};
  }
  return anchors.length;
}
