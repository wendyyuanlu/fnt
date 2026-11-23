import {allSheets,allTables,blankSheet,clone,type Workbook} from './model';
import {validateBook} from './storage';

export function migrateDropdownData(current:Workbook):{book:Workbook;changed:boolean}{
  validateBook(current);
  const owned=new Set(current.references?.filter(source=>source.kind!=='derived').map(source=>source.table).filter((id):id is string=>!!id));
  const anchors=new Set(current.references?.filter(source=>source.kind==='derived').map(source=>source.anchor?.sheet));
  const sheets=new Set<string>();
  for(const sheet of current.sheets){
    const tables=current.tables.filter(table=>table.sheet===sheet.id);
    if(!sheet.supporting&&!current.references?.some(source=>source.kind==='conversions'&&tables.some(table=>table.id===source.table)))continue;
    if(tables.some(table=>owned.has(table.id))){
      if(tables.some(table=>!owned.has(table.id)))throw Error(`Cannot move dropdown storage: ${sheet.name} also contains ordinary workbook tables. Separate those tables before migrating; nothing was changed.`);
      sheets.add(sheet.id);
    }else if(!tables.length&&sheet.supporting&&anchors.has(sheet.id))sheets.add(sheet.id);
  }
  if(current.dropdownData&&!sheets.size)return{book:current,changed:false};
  const book=clone(current);book.dropdownData??={sheets:[],tables:[]};
  book.dropdownData.sheets.push(...book.sheets.filter(sheet=>sheets.has(sheet.id)));
  book.dropdownData.tables.push(...book.tables.filter(table=>sheets.has(table.sheet)));
  book.sheets=book.sheets.filter(sheet=>!sheets.has(sheet.id));
  book.tables=book.tables.filter(table=>!sheets.has(table.sheet));
  if(!book.sheets.length)book.sheets.push(blankSheet('Notebook'));
  validateBook(book);
  if(allTables(book).length!==allTables(current).length||allSheets(book).length<allSheets(current).length)throw Error('Dropdown migration failed its preservation check. Original workbook retained.');
  return{book,changed:true};
}
