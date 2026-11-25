import {allSheets,allTables,blankSheet,clone,uniqueName,type Workbook} from './model';
import {validateBook} from './storage';

export function migrateDropdownData(current:Workbook):{book:Workbook;changed:boolean}{
  validateBook(current);
  const workbookTables=new Set(current.references?.filter(source=>source.workbookOnly).map(source=>source.table));
  const owned=new Set(current.references?.filter(source=>source.kind!=='derived'&&!workbookTables.has(source.table)).map(source=>source.table).filter((id):id is string=>!!id));
  const anchors=new Set(current.references?.filter(source=>source.kind==='derived').map(source=>source.anchor?.sheet));
  const sheets=new Set<string>();
  for(const sheet of current.sheets){
    const tables=current.tables.filter(table=>table.sheet===sheet.id);
    if(!sheet.supporting&&!current.references?.some(source=>source.kind==='conversions'&&!source.workbookOnly&&tables.some(table=>table.id===source.table)))continue;
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

export function moveReferencesToWorkbook(current:Workbook,ids:string[]):Workbook{
  validateBook(current);
  const book=clone(current),sources=ids.map(id=>book.references?.find(source=>source.id===id));
  if(!ids.length||new Set(ids).size!==ids.length||sources.some(source=>!source||source.kind==='derived'||!source.table))
    throw Error('Choose existing backing-table sources to show in the workbook.');
  const selected=new Set(sources.map(source=>source!.table!)),tables=allTables(book),sheets=allSheets(book),moving=new Set<string>();
  for(const source of sources){
    const table=tables.find(table=>table.id===source!.table),sheet=sheets.find(sheet=>sheet.id===table?.sheet);
    if(!table||!sheet)throw Error('A selected backing table is missing. No navigation was changed.');
    source!.workbookOnly=true;
    if(book.sheets.some(owner=>owner.id===sheet.id))continue;
    if(tables.some(other=>other.sheet===sheet.id&&!selected.has(other.id)))
      throw Error('A selected DD backing sheet also contains other tables. Separate those tables before moving its navigation.');
    if(!moving.has(sheet.id)){
      sheet.name=uniqueName(book.sheets.map(owner=>owner.name),source!.label??source!.name);
      sheet.supporting=false;book.sheets.push(sheet);moving.add(sheet.id);
    }
  }
  if(book.dropdownData){
    book.tables.push(...book.dropdownData.tables.filter(table=>moving.has(table.sheet)));
    book.dropdownData.tables=book.dropdownData.tables.filter(table=>!moving.has(table.sheet));
    book.dropdownData.sheets=book.dropdownData.sheets.filter(sheet=>!moving.has(sheet.id));
  }
  validateBook(book);
  return book;
}
