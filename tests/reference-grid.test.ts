import { expect,it } from 'vitest';
import { clone,createDemo,getCell,insertColumn,key,moveRows,setInput } from '../src/model';
import { addReferenceValue,createReference,referenceTable,unitsSource,upsertConversion } from '../src/references';
import { conversionEditImpact,deleteReferenceColumns,referenceView,writeGridCell } from '../src/reference-grid';
import { dropdownCatalog,dropdownFormatMigration,seedDropdownCatalog } from '../src/dropdown-catalog';

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
