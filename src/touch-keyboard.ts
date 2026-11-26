import {allTables,type Workbook} from './model';

export const virtualKeyboard=typeof navigator==='undefined'?undefined:(navigator as Navigator&{virtualKeyboard?:EventTarget&{readonly boundingRect:DOMRectReadOnly}}).virtualKeyboard;

const numericFields=new Map<string,ReadonlySet<string>>([
  ['master',new Set(['weight','amount (g)','amount'])],
  ['meals',new Set(['amount (g)','amount'])],
  ['ingredients',new Set(['serving (g)','conversion amount','calories (kcal)','protein (g)','fat (g)','carbs (g)','sugar (g)','sodium (mg)'])],
]);
export function numericKeyboardFields(book:Workbook,remembered:ReadonlySet<string>=new Set()):Set<string>{
  const fields=new Set<string>();
  for(const table of allTables(book)){
    const logging=book.sheets.find(sheet=>sheet.dayLogging?.table===table.id)?.dayLogging;
    const defaults=numericFields.get(logging?'master':table.name.trim().toLowerCase());
    for(const field of table.columns){
      const id=`${table.id}:${field.id}`;
      if(remembered.has(id)||defaults?.has(field.name.trim().toLowerCase().replace(/\s+/g,' '))||logging?.label===field.id)fields.add(id);
    }
  }
  return fields;
}
export function numericKeyboardCell(book:Workbook,sheet:string,row:string,column:string,fields:ReadonlySet<string>):boolean{
  return allTables(book).some(table=>table.sheet===sheet&&table.header!==row&&table.rows.includes(row)&&table.columns.some(field=>field.column===column&&fields.has(`${table.id}:${field.id}`)));
}
