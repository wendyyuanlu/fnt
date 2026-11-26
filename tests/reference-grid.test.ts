import { expect,it } from 'vitest';
import { blankSheet,clone,createDemo,getCell,insertColumn,key,moveRows,setInput } from '../src/model';
import { addReferenceValue,createReference,moveReferenceValue,referenceTable,unitsSource,upsertConversion } from '../src/references';
import { conversionEditImpact,deleteReferenceColumns,referenceView,writeGridCell } from '../src/reference-grid';
import { dropdownCatalog,dropdownFormatMigration,seedDropdownCatalog } from '../src/dropdown-catalog';

it('checks shared data only on rows actually reordered, retaining rejection and atomicity for affected rows',()=>{
  const book=createDemo(),source=createReference(book,'Scoped move'),[a,b,c]=['A','B','C'].map(value=>addReferenceValue(book,source,value)),{sheet,table}=referenceTable(book,source);
  sheet.cells[key(c,sheet.columns.find(column=>!table.columns.some(field=>field.column===column.id))!.id)]={value:'Unrelated sheet-only data'};
  moveRows(book,sheet,[b],sheet.rows.findIndex(row=>row.id===a),table);expect(table.rows).toEqual([b,a,c]);
  const before=clone(sheet);
  expect(()=>moveRows(book,sheet,[a],sheet.rows.findIndex(row=>row.id===c)+1,table)).toThrow('share other data');
  expect(sheet).toEqual(before);
});
it('reorders a Master-sized scoped table without rescanning all cells for every record',()=>{
  const book=createDemo(),sheet=blankSheet('Invented large move',6001,14);book.sheets.push(sheet);
  const table={id:'large-move',name:'LargeMove',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1).map(row=>row.id),columns:sheet.columns.map((column,i)=>({id:'field-'+i,name:'Field '+i,column:column.id}))};book.tables.push(table);
  for(const row of table.rows)for(const column of sheet.columns)sheet.cells[key(row,column.id)]={value:'Invented'};
  const moving=table.rows.at(-1)!,neighbor=table.rows.at(-2)!,cells=sheet.cells,started=performance.now();
  moveRows(book,sheet,[moving],sheet.rows.findIndex(row=>row.id===neighbor),table);
  const duration=performance.now()-started;console.info('84,000-cell scoped reorder (ms)',duration);
  expect(duration).toBeLessThan(500);expect(table.rows.slice(-2)).toEqual([moving,neighbor]);expect(sheet.cells).toBe(cells);
});
it('moves scoped rows with formats and identities without moving gaps or another source',()=>{
  const book=createDemo(),source=createReference(book,'Types'),a=addReferenceValue(book,source,'A'),b=addReferenceValue(book,source,'B'),other=createReference(book,'Other');
  addReferenceValue(book,other,'Keep');const {sheet,table}=referenceTable(book,source),column=table.columns[0].column;
  sheet.cells[key(b,column)].format={color:'#123456',background:'#abcdef',underline:true,wrap:false};
  const before=clone(book),slots=sheet.rows.map((r,i)=>table.rows.includes(r.id)?i:-1).filter(i=>i>=0);
  moveRows(book,sheet,[b],slots[0],table);
  expect(table.rows).toEqual([b,a]);expect(getCell(sheet,b,column)).toEqual(getCell(before.sheets.find(s=>s.id===sheet.id)!,b,column));
  expect(sheet.rows.filter((_,i)=>!slots.includes(i))).toEqual(before.sheets.find(s=>s.id===sheet.id)!.rows.filter((_,i)=>!slots.includes(i)));
  expect(referenceView(book,source).rows).toEqual([table.header,b,a]);
  expect(()=>moveRows(book,sheet,[table.header],0,table)).toThrow('header');
});
it('moving a dropdown value into grouped records inherits the group without changing its collapse state',()=>{
  const book=createDemo(),source=createReference(book,'Grouped options'),ids=['A','B','C','D'].map(value=>addReferenceValue(book,source,value)),{sheet}=referenceTable(book,source);
  const group={id:'options',axis:'row' as const,kind:'summary' as const,members:ids.slice(0,3),collapsed:true,label:'Options'};
  sheet.groups.push(group);const cells=clone(sheet.cells);
  moveReferenceValue(book,source,ids[3],-1);
  expect(group.members).toEqual([ids[0],ids[1],ids[3],ids[2]]);
  expect(group.collapsed).toBe(true);expect(sheet.cells).toEqual(cells);
});
it('scoped field insertion/deletion preserves another list sharing its physical column',()=>{
  const book=createDemo(),a=createReference(book,'A'),b=createReference(book,'B');
  addReferenceValue(book,a,'First');addReferenceValue(book,b,'Keep');
  const aa=referenceTable(book,a),bb=referenceTable(book,b),before=clone(bb.table),value=clone(getCell(bb.sheet,bb.table.rows[0],bb.table.columns[0].column));
  const added=insertColumn(book,aa.sheet,0,aa.table);expect(bb.table).toEqual(before);
  deleteReferenceColumns(book,a,[added.id,aa.table.columns.find(c=>c.id===a.column)!.column]);
  expect(bb.table).toEqual(before);expect(getCell(bb.sheet,bb.table.rows[0],bb.table.columns[0].column)).toEqual(value);
  expect(referenceView(book,a).error).toContain('unavailable');
});
it('shared edits enforce unit identities, duplicate conversions, positive factors and historical impact',()=>{
  const book=createDemo(),units=unitsSource(book),a=addReferenceValue(book,units,'a'),b=addReferenceValue(book,units,'b'),source=createReference(book,'Convert','conversions');
  const row=upsertConversion(book,source,undefined,a,b,'2',true),{table,sheet}=referenceTable(book,source),factor=table.columns.find(c=>c.id===source.conversion!.factor)!.column;
  setInput(book,book.sheets[0],book.sheets[0].rows[5].id,book.sheets[0].columns[0].id,`=SUM(${table.name}[Conversion Factor])`);
  const before=clone(book);writeGridCell(book,sheet,row,factor,'3');
  expect(conversionEditImpact(before,book)).toContain('historical');
  writeGridCell(book,sheet,row,factor,'-1');expect(()=>conversionEditImpact(before,book)).toThrow('positive');
  writeGridCell(book,sheet,row,table.columns[0].column,'a');expect(()=>conversionEditImpact(before,book)).toThrow();
});
it('catalog formatting migration preserves edited styles, blank records and positional row identities',()=>{
  const book=seedDropdownCatalog(createDemo()).book,source=book.references!.find(r=>r.catalog?.table==='AnimalType')!,{table,sheet}=referenceTable(book,source),column=table.columns[0].column;
  const turkey=source.catalog!.rows![1];expect(getCell(sheet,turkey,column).format?.color).toBe('#242424');
  const custom={color:'#ff0000',bold:true};sheet.cells[key(turkey,column)].format=custom;
  book.catalogMigrations=book.catalogMigrations!.filter(m=>m!==dropdownFormatMigration);
  const result=seedDropdownCatalog(book);expect(getCell(result.book.sheets.find(s=>s.id===sheet.id)!,turkey,column).format).toEqual(custom);
  expect(seedDropdownCatalog(result.book).changed).toBe(false);expect(result.book.catalogMigrations).toContain(dropdownCatalog.id);
});
