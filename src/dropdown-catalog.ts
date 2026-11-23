import { allTables,allSheets, addRow,clone,key,renameColumn,uniqueName,type Cell,type Workbook } from './model';
import { createReference,referenceLabel,referenceTable,setReferencePresentation } from './references';
import { validateBook,type Backup } from './storage';

interface CatalogList {name:string;field:string;range:string;values:readonly (string|null)[]}
export const dropdownCatalog:{id:string;sheet:string;lists:readonly CatalogList[]}={
  id:'original-dropdowns-v1',sheet:'Dropdowns',
  lists:[
    {name:'IngredientType',field:'Ingredient type',range:'A1:A5',values:['Seasoning','Staple','Whole','Premade']},
    {name:'Period',field:'Period',range:'A10:A13',values:[null,'Spotting','Yes']},
    {name:'AnimalType',field:'Animal',range:'A17:A21',values:['🐔 Chicken','🦃 Turkey','🐮 Beef','🐷 Pork']},
    {name:'Table14',field:'Type',range:'A23:A25',values:['🍦 Snack',' ']},
    {name:'SnackCountry',field:'Country',range:'A28:A32',values:['Taiwan','Japan','Canada','USA']},
    {name:'SnackFlavour',field:'Flavour',range:'A35:A38',values:['Savoury','Sweet','Mixed']},
    {name:'SnackCategory',field:'Category',range:'A42:A50',values:['Chocolate','Gummy','Chip/Noodle','Cookie','Pastry','Biscuit','Bread','Pudding/Custard']}
  ]
};
export const dropdownFormatMigration='original-dropdown-formats-v1';
export const dropdownGroupMigration='snack-navigation-v1';
function seedGroups(book:Workbook):void{
  for(const [name,label] of [['SnackCountry','Country'],['SnackFlavour','Flavour'],['SnackCategory','Category']]){
    for(const source of book.references?.filter(s=>s.catalog?.table===name&&!s.group)??[]){
      const originalName=source.name===name||source.name.startsWith(name+'_')&&/^\d+$/.test(source.name.slice(name.length+1)),display=source.label??(originalName?label:source.name);
      setReferencePresentation(book,source,uniqueName(book.references?.filter(s=>s.id!==source.id&&s.group==='Snack').map(referenceLabel)??[],display),'Snack');
    }
  }
  book.catalogMigrations=[...book.catalogMigrations??[],dropdownGroupMigration];
}
const originalFormat:NonNullable<Cell['format']>={bold:false,underline:false,wrap:false,excelNumberFormat:'General',number:''};
function seedFormats(book:Workbook):void{
  for(const source of book.references??[]){
    if(source.catalog?.id!==dropdownCatalog.id||!source.catalog.rows)continue;
    const list=dropdownCatalog.lists.find(l=>l.name===source.catalog!.table),table=allTables(book).find(t=>t.id===source.table),sheet=allSheets(book).find(s=>s.id===table?.sheet),column=table?.columns.find(c=>c.id===source.column);
    if(!list||!table||!sheet||!column)continue;
    const header=sheet.cells[key(table.header,column.column)];if(header&&!header.format)header.format={...originalFormat};
    source.catalog.rows.forEach((row,i)=>{
      const cell=sheet.cells[key(row,column.column)],value=list.values[i];
      if(table.rows.includes(row)&&cell&&!cell.format&&value!==null&&cell.value===value&&!cell.formula)cell.format={...originalFormat,...(list.name==='AnimalType'&&i===1?{color:'#242424'}:{})};
    });
  }
  book.catalogMigrations=[...book.catalogMigrations??[],dropdownFormatMigration];
}

export function matchesDropdownCatalog(book:Workbook):boolean{
  return dropdownCatalog.lists.every(list=>{
    const tables=allTables(book).filter(t=>t.name===list.name),table=tables[0],sheet=allSheets(book).find(s=>s.id===table?.sheet);
    if(tables.length!==1||sheet?.name!==dropdownCatalog.sheet||table.columns.length!==1||table.columns[0].name!==list.field||table.rows.length!==list.values.length)return false;
    const column=table.columns[0].column,first=Number(list.range.split(':')[0].slice(1));
    return sheet.rows.findIndex(r=>r.id===table.header)===first-1&&table.rows.every((row,i)=>
      sheet.rows.findIndex(r=>r.id===row)===first+i&&(sheet.cells[key(row,column)]?.value??null)===list.values[i]);
  });
}

export async function verifiedCatalogOrigins(backup:Backup):Promise<Set<string>>{
  const ids=new Set(backup.state.book.references?.filter(r=>r.origin?.table&&dropdownCatalog.lists.some(l=>l.name===r.origin!.table)).map(r=>r.origin!.original));
  const verified=new Set<string>();
  if(!ids.size)return verified;
  const {importXlsx}=await import('./xlsx');
  for(const id of ids){
    const original=backup.originals.find(o=>o.id===id);
    if(!original)throw Error('A supporting original is missing. Restore a complete backup before updating its catalogs.');
    const bytes=Uint8Array.from(atob(original.data),c=>c.charCodeAt(0));
    const imported=await importXlsx(bytes.buffer,original.name,{sheets:[dropdownCatalog.sheet]});
    if(matchesDropdownCatalog(imported.book))verified.add(id);
  }
  return verified;
}

export function seedDropdownCatalog(current:Workbook,verifiedOrigins:ReadonlySet<string>=new Set()):{book:Workbook;changed:boolean}{
  validateBook(current);
  if(current.catalogMigrations?.includes(dropdownCatalog.id)){
    if(current.catalogMigrations.includes(dropdownFormatMigration)&&current.catalogMigrations.includes(dropdownGroupMigration))return{book:current,changed:false};
    const book=clone(current);if(!current.catalogMigrations.includes(dropdownFormatMigration))seedFormats(book);if(!current.catalogMigrations.includes(dropdownGroupMigration))seedGroups(book);book.revision++;validateBook(book);return{book,changed:true};
  }
  const book=clone(current);
  for(const list of dropdownCatalog.lists){
    const existing=book.references?.filter(r=>r.catalog?.id===dropdownCatalog.id&&r.catalog.table===list.name||
      r.origin?.table===list.name&&verifiedOrigins.has(r.origin.original))??[];
    if(existing.length){
      // Provenance identifies the source; current labels, archives and bindings stay untouched.
      for(const source of existing)source.catalog={...source.catalog,id:dropdownCatalog.id,table:list.name};
      continue;
    }
    const name=uniqueName(book.references?.map(r=>r.name)??[],list.name);
    const source=createReference(book,name),{table,sheet}=referenceTable(book,source);
    source.catalog={id:dropdownCatalog.id,table:list.name,rows:[]};
    table.name=uniqueName(allTables(book).filter(t=>t!==table).map(t=>t.name),list.name);
    renameColumn(book,table,table.columns[0].id,list.field);
    for(const value of list.values){
      const at=sheet.rows.findIndex(r=>r.id===(table.rows.at(-1)??table.header))+1;
      const row=addRow(book,sheet,at,table);
      sheet.cells[key(row.id,table.columns[0].column)]={value};
      source.catalog.rows!.push(row.id);
    }
  }
  book.catalogMigrations=[...book.catalogMigrations??[],dropdownCatalog.id];
  seedFormats(book);
  seedGroups(book);
  book.revision++;validateBook(book);
  return{book,changed:true};
}
