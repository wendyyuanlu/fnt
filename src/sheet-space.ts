import { allSheets,allTables,letters,uid,type Workbook} from './model';

export function ensureTableSheetSpace(book:Workbook):boolean{
  let changed=false;
  for(const sheet of allSheets(book)){
    const tables=allTables(book).filter(table=>table.sheet===sheet.id);if(!tables.length)continue;
    const rows=new Set(tables.flatMap(table=>[table.header,...table.rows])),columns=new Set(tables.flatMap(table=>table.columns.map(field=>field.column)));
    const lastRow=sheet.rows.reduce((last,row,index)=>rows.has(row.id)?index:last,-1),lastColumn=sheet.columns.reduce((last,column,index)=>columns.has(column.id)?index:last,-1);
    const rowCount=Math.min(100_000,lastRow+5),columnCount=Math.min(512,lastColumn+3);
    while(sheet.rows.length<rowCount){sheet.rows.push({id:uid()});changed=true;}
    while(sheet.columns.length<columnCount){sheet.columns.push({id:uid(),label:letters(sheet.columns.length),width:145});changed=true;}
  }
  return changed;
}
