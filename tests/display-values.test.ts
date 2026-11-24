import {expect,it} from 'vitest';
import {cachedCellText} from '../src/display-values';
import {Engine,scalar} from '../src/formula';
import {createDemo,getCell,key,setInput} from '../src/model';
import {applyUndo,capturePatch} from '../src/undo-history';

it('reuses displayed text only while the cell and dependency-tracked value remain current',()=>{
  const book=createDemo(),s=book.sheets.at(-1)!,row=s.rows[0].id,column=s.columns[0].id,formula=s.columns[1].id;
  setInput(book,s,row,column,'4');setInput(book,s,row,formula,'=A1*2');
  const engine=new Engine(book);let calls=0;
  const display=(c:string)=>cachedCellText(engine,s.id,row,c,getCell(s,row,c),value=>{calls++;return String(scalar(value));});
  expect(display(formula)).toBe('8');expect(display(formula)).toBe('8');expect(calls).toBe(1);
  setInput(book,s,row,column,'5');engine.invalidate([`${s.id}:${key(row,column)}`]);
  expect(display(formula)).toBe('10');expect(calls).toBe(2);
  s.cells[key(row,formula)]={...getCell(s,row,formula),format:{number:'decimal'}};
  expect(display(formula)).toBe('10');expect(calls).toBe(3);
  engine.cache.clear();expect(display(formula)).toBe('10');expect(calls).toBe(4);
});

it('retains valid calculations across layout replay and binds subsequent cell invalidation to the new sheet',()=>{
  const book=createDemo(),s=book.sheets.at(-1)!,row=s.rows[0].id,column=s.columns[0].id,formula=s.columns[1].id;
  setInput(book,s,row,column,'4');setInput(book,s,row,formula,'=A1*2');
  const engine=new Engine(book),value=engine.cell(s.id,row,formula);
  const next=applyUndo(book,capturePatch(book,[['sheets',book.sheets.length-1,'outlineView']])).book;
  expect(engine.rebindLayout(next)).toBe(true);expect(engine.cell(s.id,row,formula)).toBe(value);
  const rebound=next.sheets.at(-1)!;setInput(next,rebound,row,column,'6');
  engine.invalidate([`${s.id}:${key(row,column)}`]);expect(scalar(engine.cell(s.id,row,formula))).toBe(12);
  const structural={...next,sheets:next.sheets.map(sheet=>({...sheet,rows:[...sheet.rows].reverse()}))};
  expect(engine.rebindLayout(structural)).toBe(false);
});
