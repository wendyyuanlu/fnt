import { allSheets,allTables,letters,uid,type Sheet,type Workbook} from './model';

export function isMasterSheet(book:Workbook,sheet:Sheet):boolean{
  return sheet.name==='Master'||allTables(book).some(table=>table.sheet===sheet.id&&(table.name==='Master'||table.id===sheet.dayLogging?.table));
}
export function sheetTableTail(book:Workbook,sheet:Sheet,count:number):number[]{
  const owned=new Set(allTables(book).filter(table=>table.sheet===sheet.id).flatMap(table=>[table.header,...table.rows]));
  const end=sheet.rows.reduce((last,row,index)=>owned.has(row.id)?index:last,-1);
  return end<0?[]:sheet.rows.slice(end+1,end+count+1).map((_,i)=>end+1+i);
}

export function ensureTableSheetSpace(book:Workbook):boolean{
  let changed=false;
  for(const sheet of allSheets(book)){
    const tables=allTables(book).filter(table=>table.sheet===sheet.id);if(!tables.length)continue;
    const rows=new Set(tables.flatMap(table=>[table.header,...table.rows])),columns=new Set(tables.flatMap(table=>table.columns.map(field=>field.column)));
    const lastRow=sheet.rows.reduce((last,row,index)=>rows.has(row.id)?index:last,-1),lastColumn=sheet.columns.reduce((last,column,index)=>columns.has(column.id)?index:last,-1);
    const master=isMasterSheet(book,sheet);
    if(master&&lastRow+21>100_000)throw Error('There is not enough worksheet space for 20 plain rows below Master.');
    const rowCount=Math.min(100_000,lastRow+(master?21:5)),columnCount=Math.min(512,lastColumn+3);
    while(sheet.rows.length<rowCount){sheet.rows.push({id:uid()});changed=true;}
    while(sheet.columns.length<columnCount){sheet.columns.push({id:uid(),label:letters(sheet.columns.length),width:145});changed=true;}
  }
  return changed;
}
