import {expect,it} from 'vitest';
import {migrateDropdownData,moveReferencesToWorkbook} from '../src/dd-storage';
import {allSheets,allTables,clone,createDemo,getCell,key,letters,setInput,type Workbook} from '../src/model';
import {seedDropdownCatalog} from '../src/dropdown-catalog';
import {addReferenceValue,createReference,duplicateReference,referenceChoices,referenceNavigation,referenceTable,renameReferenceValue} from '../src/references';
import {compile,Engine,scalar} from '../src/formula';
import {appendReferenceOption,conversionEditImpact,referenceView} from '../src/reference-grid';
import {validateBook} from '../src/storage';

function fixture(){
  const book=seedDropdownCatalog(createDemo()).book,source=book.references!.find(source=>source.catalog?.table==='IngredientType')!,{table,sheet}=referenceTable(book,source);
  const target=book.sheets.find(sheet=>sheet.name==='Notebook')!;
  target.cells[key(target.rows[0].id,target.columns[0].id)]={binding:{table:table.id,row:table.rows[0],column:table.columns[0].id}};
  setInput(book,target,target.rows[1].id,target.columns[0].id,`=XLOOKUP("Seasoning",IngredientType[Ingredient type],IngredientType[Ingredient type],"")`);
  const address=letters(sheet.columns.findIndex(column=>column.id===table.columns[0].column))+(sheet.rows.findIndex(row=>row.id===table.rows[0])+1);
  setInput(book,target,target.rows[2].id,target.columns[0].id,`='${sheet.name}'!${address}`);
  setInput(book,target,target.rows[3].id,target.columns[0].id,'=INDEX(INDIRECT("IngredientType[Ingredient type]"),1)');
  book.names.push({id:'dd-name-test',name:'FirstType',context:sheet.id,formula:compile('=IngredientType[Ingredient type]',book,sheet.id,table.header,table.columns[0].column),original:'=IngredientType[Ingredient type]'});
  const derived=createReference(book,'Actual meal names','derived');derived.derived={table:book.tables.find(t=>t.name==='Meals')!.id,column:book.tables.find(t=>t.name==='Meals')!.columns[0].id};
  return{book,source,table,sheet,target};
}
const contents=(book:Workbook)=>allSheets(book).map(sheet=>[sheet.id,sheet]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
const results=(book:Workbook,sheet:string)=>{const s=allSheets(book).find(s=>s.id===sheet)!,engine=new Engine(book);return s.rows.slice(0,4).map(row=>scalar(engine.cell(s.id,row.id,s.columns[0].id)));};

it('moves actual source rows, cells and tables into DD ownership without rewriting any identities, references or values',()=>{
  const {book,source,table,sheet,target}=fixture(),before=clone(book),values=results(book,target.id);
  const moved=migrateDropdownData(book);expect(moved.changed).toBe(true);
  expect(book).toEqual(before);expect(moved.book.sheets.some(s=>s.id===sheet.id)).toBe(false);expect(moved.book.tables.some(t=>t.id===table.id)).toBe(false);
  expect(moved.book.dropdownData!.sheets.some(s=>s.id===sheet.id)).toBe(true);expect(moved.book.dropdownData!.tables.find(t=>t.id===table.id)).toEqual(table);
  expect(contents(moved.book)).toEqual(contents(before));expect(moved.book.names).toEqual(before.names);expect(moved.book.references).toEqual(before.references);
  expect(results(moved.book,target.id)).toEqual(values);expect(values).toEqual(['Seasoning','Seasoning','Seasoning','Seasoning']);
  expect(referenceChoices(moved.book,source)).toEqual(referenceChoices(before,source));expect(moved.book.tables.some(table=>table.name==='Meals')).toBe(true);
  expect(migrateDropdownData(moved.book)).toEqual({book:moved.book,changed:false});validateBook(moved.book);
});

it('edits, appends, creates and duplicates DD records in DD storage and keeps live workbook links attached',()=>{
  const original=fixture(),book=migrateDropdownData(original.book).book,source=book.references!.find(s=>s.id===original.source.id)!,{table,sheet}=referenceTable(book,source);
  renameReferenceValue(book,source,table.rows[0],'Renamed type');expect(results(book,original.target.id)[0]).toBe('Renamed type');
  const row=appendReferenceOption(book,source,table.columns[0].column,'Extra');expect(getCell(sheet,row,table.columns[0].column).value).toBe('Extra');
  const created=createReference(book,'Fresh DD');addReferenceValue(book,created,'Fresh value');const createdView=referenceView(book,created);
  expect(book.dropdownData!.tables.some(t=>t.id===created.table)).toBe(true);expect(book.tables.some(t=>t.id===created.table)).toBe(false);expect(createdView.rows).toHaveLength(2);
  const copy=duplicateReference(book,source);expect(book.dropdownData!.tables.some(t=>t.id===copy.table)).toBe(true);
  expect(referenceChoices(book,copy).map(choice=>choice.value)).toEqual(referenceChoices(book,source).map(choice=>choice.value));
  expect(referenceChoices(book,copy)[0].binding).not.toEqual(referenceChoices(book,source)[0].binding);validateBook(book);
});

it('keeps conversion tables in DD with conversion checks and structured references intact',()=>{
  const {book,target}=fixture(),source=createReference(book,'Test conversion','conversions'),view=referenceTable(book,source),row=appendReferenceOption(book,source,view.table.columns[0].column,'unit-a');
  setInput(book,view.sheet,row,view.table.columns[1].column,'unit-b');setInput(book,view.sheet,row,view.table.columns[2].column,'2');
  setInput(book,target,target.rows[5].id,target.columns[0].id,'=SUM(Test_conversion[Conversion Factor])'.replace('Test_conversion','TestConversion'));
  view.table.name='TestConversion';
  const moved=migrateDropdownData(book).book;expect(moved.dropdownData!.tables.some(t=>t.id===source.table)).toBe(true);
  expect(referenceView(moved,source).error).toBe('');
  const before=clone(moved),current=referenceTable(moved,source);setInput(moved,current.sheet,row,current.table.columns[2].column,'-1');
  expect(()=>conversionEditImpact(before,moved)).toThrow(/positive/);
});

it('refuses mixed worksheet ownership atomically rather than moving unrelated tables or discarding cells',()=>{
  const {book,table,sheet}=fixture(),other=clone(table);other.id='ordinary-neighbor';other.name='Neighbor';other.columns=other.columns.map(column=>({...column,id:'neighbor-field'}));book.tables.push(other);
  const before=clone(book);expect(()=>migrateDropdownData(book)).toThrow(/ordinary workbook tables/);expect(book).toEqual(before);expect(book.sheets.some(s=>s.id===sheet.id)).toBe(true);
});

it('retains ordinary workbook tables when a dropdown reads one of their columns',()=>{
  const {book}=fixture(),ingredients=book.tables.find(table=>table.name==='Ingredients')!;
  book.references!.push({id:'ingredients-picker',name:'Ingredient choices',kind:'list',table:ingredients.id,column:ingredients.columns[0].id,archivedRows:[]});
  const moved=migrateDropdownData(book).book;
  expect(moved.tables.find(table=>table.id===ingredients.id)).toEqual(ingredients);
  expect(moved.sheets.some(sheet=>sheet.id===ingredients.sheet)).toBe(true);
});

it('rejects duplicated DD identities and malformed DD storage on restore',()=>{
  const {book}=fixture(),moved=migrateDropdownData(book).book;
  const invalid=clone(moved);invalid.dropdownData!.sheets.push(clone(invalid.sheets[0]));expect(()=>validateBook(invalid)).toThrow(/duplicate identity/);
  const duplicate=clone(moved);duplicate.tables.push(clone(duplicate.dropdownData!.tables[0]));expect(()=>validateBook(duplicate)).toThrow(/owning sheet/);
  expect(allTables(moved)).toHaveLength(allTables(book).length);
});

it('shows selected backing tables only in workbook navigation without losing records, formulas or dropdown bindings on reload',()=>{
  const book=createDemo(),target=book.sheets.find(sheet=>sheet.name==='Notebook')!;
  const units=createReference(book,'Units','units'),conversion=createReference(book,'Convert','conversions'),ingredients=book.tables.find(table=>table.name==='Ingredients')!;
  const picker={id:'ingredients-main-picker',name:'Ingredients',kind:'list' as const,table:ingredients.id,column:ingredients.columns[0].id,archivedRows:[]};book.references!.push(picker);
  addReferenceValue(book,units,'unit-a');const convert=referenceTable(book,conversion),row=appendReferenceOption(book,conversion,convert.table.columns[0].column,'unit-a');
  setInput(book,convert.sheet,row,convert.table.columns[1].column,'unit-b');setInput(book,convert.sheet,row,convert.table.columns[2].column,'2');
  setInput(book,target,target.rows[6].id,target.columns[0].id,`=SUM(${convert.table.name}[Conversion Factor])`);
  const before=migrateDropdownData(book).book,unchanged=clone(before),choices=referenceChoices(before,units),value=scalar(new Engine(before).cell(target.id,target.rows[6].id,target.columns[0].id));
  const moved=moveReferencesToWorkbook(before,[picker.id,units.id,conversion.id]);
  const records=(value:Workbook)=>allTables(value).map(table=>{
    const owner=allSheets(value).find(sheet=>sheet.id===table.sheet)!;
    return{...table,sheet:undefined,columns:table.columns.map(({column,...field})=>field),cells:[table.header,...table.rows].map(row=>table.columns.map(column=>getCell(owner,row,column.column)))};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  expect(before).toEqual(unchanged);expect(records(moved)).toEqual(records(before));
  expect(referenceChoices(moved,moved.references!.find(source=>source.id===units.id)!)).toEqual(choices);
  expect(moved.tables.some(table=>table.id===units.table)).toBe(true);expect(moved.tables.some(table=>table.id===conversion.table)).toBe(true);
  const navigation=referenceNavigation(moved).flatMap(group=>group.members.map(source=>source.id));
  expect(navigation).not.toContain(picker.id);expect(navigation).not.toContain(units.id);expect(navigation).not.toContain(conversion.id);
  expect(scalar(new Engine(moved).cell(target.id,target.rows[6].id,target.columns[0].id))).toBe(value);expect(value).toBe(2);
  expect(migrateDropdownData(clone(moved))).toEqual({book:moved,changed:false});validateBook(moved);
  const invalid=clone(moved);invalid.references![0].workbookOnly='true' as never;expect(()=>validateBook(invalid)).toThrow(/navigation preference/);
});

it('refuses to move a backing table whose rows also belong to another DD table',()=>{
  const {book,source}=fixture(),moved=migrateDropdownData(book).book,neighbor=clone(referenceTable(moved,source).table);
  neighbor.id='overlapping-dd-table';neighbor.name='Neighbor';neighbor.columns=neighbor.columns.map((column,i)=>({...column,id:'neighbor-field-'+i}));moved.dropdownData!.tables.push(neighbor);
  const before=clone(moved);expect(()=>moveReferencesToWorkbook(moved,[source.id])).toThrow(/other tables/);expect(moved).toEqual(before);
});
