import {expect,it} from 'vitest';
import {createTable,recordTableEdits,recordTableVisit,renameTable,sortedTables} from '../src/table-management';
import {clone,createDemo,getCell,key,moveColumns,renameColumn,setInput} from '../src/model';
import {compile,displayFormula,Engine} from '../src/formula';
import {validateBook} from '../src/storage';

function fixture(){
  const book=createDemo(),sheet=book.sheets[3];sheet.cells={};
  const put=(r:number,c:number,value:string)=>setInput(book,sheet,sheet.rows[r].id,sheet.columns[c].id,value);
  return{book,sheet,put};
}

it('uses unique first-row headers, retains formats and stable references through table and field renames and column moves',()=>{
  const {book,sheet,put}=fixture();put(0,0,'Item');put(0,1,'Qty');put(0,2,'qty');put(1,0,'Invented');put(1,1,'5');
  getCell(sheet,sheet.rows[0].id,sheet.columns[0].id).format={bold:true,wrap:false};
  const table=createTable(book,sheet.id,{r1:0,r2:1,c1:0,c2:2},'Pantry',true),field=table.columns[1];
  expect(table.columns.map(field=>field.name)).toEqual(['Item','Qty','qty_2']);
  expect(getCell(sheet,table.header,table.columns[0].column).format).toEqual({bold:true,wrap:false});
  put(3,5,'=SUM(Pantry[Qty])');const row=sheet.rows[3].id,column=sheet.columns[5].id;
  sheet.cells[key(sheet.rows[4].id,column)]={binding:{table:table.id,row:table.rows[0],column:field.id}};
  renameTable(book,table.id,'Pantry_New');renameColumn(book,table,field.id,'Amount');moveColumns(book,sheet,[field.column],4);
  const engine=new Engine(book);
  expect(engine.cell(sheet.id,row,column)).toBe(5);
  expect(engine.cell(sheet.id,sheet.rows[4].id,column)).toBe(5);
  expect(displayFormula(getCell(sheet,row,column).formula!,book)).toBe('=SUM(Pantry_New[Amount])');
});

it('inserts generated headers without losing the first record, neighboring data, notes, validations or direct and named references',()=>{
  const {book,sheet,put}=fixture();put(1,0,'Invented');put(1,1,'5');put(2,0,'Other');put(2,1,'7');put(5,0,'Below');
  put(0,5,'=SUM(B2:B3)');put(1,4,'Neighbor');
  getCell(sheet,sheet.rows[1].id,sheet.columns[0].id).note='Keep this note';
  const named=compile('=B2',book,sheet.id,sheet.rows[0].id,sheet.columns[5].id);
  book.names.push({id:'selected-amount',name:'SelectedAmount',context:sheet.id,formula:named,original:'=B2'});
  sheet.validations.push({id:'local-options',rows:[sheet.rows[1].id],columns:[sheet.columns[0].id],sheet:sheet.id,source:'="Invented,Other"',values:['Invented','Other']});
  const neighbor=clone(getCell(sheet,sheet.rows[1].id,sheet.columns[4].id));
  const table=createTable(book,sheet.id,{r1:1,r2:2,c1:0,c2:1},'No_Headers',false);
  expect(table.columns.map(field=>field.name)).toEqual(['Column1','Column2']);expect(table.rows).toHaveLength(2);
  expect(getCell(sheet,table.rows[0],table.columns[0].column)).toMatchObject({value:'Invented',note:'Keep this note'});
  expect(getCell(sheet,sheet.rows[6].id,sheet.columns[0].id).value).toBe('Below');
  expect(getCell(sheet,sheet.rows[1].id,sheet.columns[4].id)).toEqual(neighbor);
  expect(sheet.validations[0].rows).toEqual([table.rows[0]]);
  const engine=new Engine(book);expect(engine.cell(sheet.id,sheet.rows[0].id,sheet.columns[5].id)).toBe(12);
  expect(engine.evaluate(book.names[0].formula,sheet.id,table.header,table.columns[0].column)).toBe(5);
});

it('rejects overlaps, invalid or duplicate names and unsafe generated-header shifts without partial changes',()=>{
  const {book,sheet,put}=fixture();put(5,0,'Name');put(6,0,'Record');
  const table=createTable(book,sheet.id,{r1:5,r2:6,c1:0,c2:0},'Existing',true),before=clone(book);
  expect(()=>createTable(book,sheet.id,{r1:5,r2:7,c1:0,c2:1},'Overlap',true)).toThrow(/overlap/);
  expect(()=>createTable(book,sheet.id,{r1:0,r2:1,c1:0,c2:0},'existing',true)).toThrow(/already in use/);
  expect(()=>renameTable(book,table.id,'A1')).toThrow(/cell address/);
  expect(()=>createTable(book,sheet.id,{r1:0,r2:1,c1:0,c2:0},'Above',false)).toThrow(/table records/);
  expect(book).toEqual(before);
});

it('never replaces a first-row formula with a header label and preserves it when generated headers are requested',()=>{
  const {book,sheet,put}=fixture();put(0,0,'=2+3');put(1,0,'7');put(0,5,'=A1');
  const before=clone(book);
  expect(()=>createTable(book,sheet.id,{r1:0,r2:1,c1:0,c2:0},'Formula_Records',true)).toThrow(/contains formulas/);
  expect(book).toEqual(before);
  const table=createTable(book,sheet.id,{r1:0,r2:1,c1:0,c2:0},'Formula_Records',false),engine=new Engine(book);
  expect(getCell(sheet,table.rows[0],table.columns[0].column).formula).toBeDefined();
  expect(engine.cell(sheet.id,table.rows[0],table.columns[0].column)).toBe(5);
  expect(engine.cell(sheet.id,sheet.rows[0].id,sheet.columns[5].id)).toBe(5);
});

it('records only actual changed table cells, including clears, formatting and structural edits, not outside edits or renames',()=>{
  const {book,sheet,put}=fixture();put(0,0,'Item');put(1,0,'One');
  const table=createTable(book,sheet.id,{r1:0,r2:1,c1:0,c2:0},'Tracked',true),address=key(table.rows[0],table.columns[0].column);
  let before=clone(book);put(1,0,'Two');recordTableEdits(before,book,[{sheet:sheet.id,key:address}],100);
  expect(book.tableActivity?.[table.id]?.editedAt).toBe(100);
  before=clone(book);put(1,0,'Two');put(3,5,'Outside');recordTableEdits(before,book,[{sheet:sheet.id,key:address},{sheet:sheet.id,key:key(sheet.rows[3].id,sheet.columns[5].id)}],200);
  expect(book.tableActivity?.[table.id]?.editedAt).toBe(100);
  before=clone(book);getCell(sheet,table.rows[0],table.columns[0].column).format={bold:true};recordTableEdits(before,book,undefined,300);
  expect(book.tableActivity?.[table.id]?.editedAt).toBe(300);
  before=clone(book);renameTable(book,table.id,'New_Name');recordTableEdits(before,book,undefined,400);expect(book.tableActivity?.[table.id]?.editedAt).toBe(300);
  before=clone(book);delete sheet.cells[address];recordTableEdits(before,book,[{sheet:sheet.id,key:address}],500);expect(book.tableActivity?.[table.id]?.editedAt).toBe(500);
  before=clone(book);table.rows=[];recordTableEdits(before,book,undefined,600);expect(book.tableActivity?.[table.id]?.editedAt).toBe(500);
});

it('sorts without moving table definitions and preserves history across stable table renames',()=>{
  const {book,sheet,put}=fixture();put(0,0,'First');put(1,0,'One');put(3,0,'Second');put(4,0,'Two');
  const alpha=createTable(book,sheet.id,{r1:0,r2:1,c1:0,c2:0},'Alpha',true),zulu=createTable(book,sheet.id,{r1:3,r2:4,c1:0,c2:0},'Zulu',true);
  book.tables=[zulu,alpha];const before=clone(book.tables);
  expect(sortedTables(book,'az').map(t=>t.id)).toEqual([alpha.id,zulu.id]);expect(sortedTables(book,'za').map(t=>t.id)).toEqual([zulu.id,alpha.id]);
  expect(sortedTables(book,'activity').map(t=>t.id)).toEqual([alpha.id,zulu.id]);
  book.tableActivity={[zulu.id]:{editedAt:100,visits:1},[alpha.id]:{editedAt:50,visits:2}};
  expect(sortedTables(book,'activity')[0].id).toBe(zulu.id);expect(sortedTables(book,'frequent')[0].id).toBe(alpha.id);expect(book.tables).toEqual(before);
  recordTableVisit(book,zulu.id);recordTableVisit(book,zulu.id);renameTable(book,zulu.id,'Renamed');expect(sortedTables(book,'frequent')[0].id).toBe(zulu.id);expect(book.tableActivity[zulu.id]).toEqual({editedAt:100,visits:3});
});

it('validates persisted table history without requiring it in older workbooks',()=>{
  const {book}=fixture();expect(()=>validateBook(book)).not.toThrow();
  book.tableManagerSort='frequent';book.tableActivity={[book.tables[0].id]:{editedAt:100,visits:3}};expect(()=>validateBook(book)).not.toThrow();
  const invalid=clone(book);invalid.tableActivity![book.tables[0].id].visits=-1;expect(()=>validateBook(invalid)).toThrow(/table activity/);
});
