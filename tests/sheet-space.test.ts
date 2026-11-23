import {expect,it} from 'vitest';
import {blankSheet,clone,key,type Workbook} from '../src/model';
import {ensureTableSheetSpace} from '../src/sheet-space';

function fixture(){
  const sheet=blankSheet('Ingredients',4,3),book:Workbook={schema:1,id:'book',title:'Synthetic ingredients',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  const table={id:'table',name:'Ingredients',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1).map(row=>row.id),columns:sheet.columns.map((column,i)=>({id:`field-${i}`,name:column.label,column:column.id}))};
  book.tables.push(table);sheet.cells[key(table.rows[0],table.columns[0].column)]={value:'Synthetic ingredient'};
  return{book,sheet,table};
}
it('adds real sheet space without enlarging tables, changing identities or touching contents',()=>{
  const {book,sheet,table}=fixture(),before=clone(book);
  expect(ensureTableSheetSpace(book)).toBe(true);
  expect(sheet.rows).toHaveLength(8);expect(sheet.columns).toHaveLength(5);
  expect(sheet.rows.slice(0,4)).toEqual(before.sheets[0].rows);expect(sheet.columns.slice(0,3)).toEqual(before.sheets[0].columns);
  expect(sheet.cells).toEqual(before.sheets[0].cells);expect(table).toEqual(before.tables[0]);
  expect(new Set(sheet.rows.map(row=>row.id)).size).toBe(8);expect(new Set(sheet.columns.map(column=>column.id)).size).toBe(5);
  const padded=clone(book);expect(ensureTableSheetSpace(book)).toBe(false);expect(book).toEqual(padded);
  table.rows.push(sheet.rows[4].id);table.columns.push({id:'extra-field',name:'Extra',column:sheet.columns[3].id});
  expect(ensureTableSheetSpace(book)).toBe(true);expect(sheet.rows).toHaveLength(9);expect(sheet.columns).toHaveLength(6);
});
it('preserves existing space and notes, reserves space past all tables, and leaves table-free sheets alone',()=>{
  const {book,sheet,table}=fixture(),free=blankSheet('Notes',2,2);
  book.sheets.push(free);sheet.rows.push(...blankSheet('Unused',8,1).rows);
  sheet.columns.push({id:'note-column',label:'Notes'});sheet.cells[key(sheet.rows[11].id,'note-column')]={value:'Keep this note'};
  const other={...clone(table),id:'other',name:'Other',header:sheet.rows[8].id,rows:[sheet.rows[9].id],columns:[{id:'other-field',name:'Other',column:'note-column'}]};book.tables.push(other);
  const before=clone(book);expect(ensureTableSheetSpace(book)).toBe(true);
  expect(sheet.rows).toHaveLength(14);expect(sheet.columns).toHaveLength(6);expect(sheet.rows.slice(0,12)).toEqual(before.sheets[0].rows);
  expect(sheet.cells).toEqual(before.sheets[0].cells);expect(book.tables).toEqual(before.tables);expect(free).toEqual(before.sheets[1]);
});
