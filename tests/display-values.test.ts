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
it('rebinds proven cell-only Undo without retaining stale dependents or invalidating unrelated calculations',()=>{
  const book=createDemo(),s=book.sheets.at(-1)!,row=s.rows[0].id,a=s.columns[0].id,b=s.columns[1].id,c=s.columns[2].id;
  setInput(book,s,row,a,'4');setInput(book,s,row,b,'=A1*2');setInput(book,s,row,c,'=3+7');
  const engine=new Engine(book);engine.cell(s.id,row,b);const independent=engine.cell(s.id,row,c);
  const changes=[{sheet:s.id,key:key(row,a),value:{value:6}}],next=applyUndo(book,{cells:changes}).book;
  expect(engine.rebindCells(next,changes.map(c=>`${c.sheet}:${c.key}`))).toBe(true);
  expect(engine.cell(s.id,row,b)).toBe(12);expect(engine.cache.get(`${s.id}:${key(row,c)}`)).toBe(independent);
  const structural={...next,sheets:next.sheets.map(s=>({...s,rows:[...s.rows].reverse()}))};
  expect(engine.rebindCells(structural,[`${s.id}:${key(row,a)}`])).toBe(false);
});
it('shares reference and range work without stale matches, numeric results or hidden errors after edits',()=>{
  const book=createDemo(),s=book.sheets.at(-1)!,a=s.columns[0].id,b=s.columns[1].id,c=s.columns[2].id;
  for(let i=0;i<3;i++)setInput(book,s,s.rows[i].id,a,String(i+1));
  setInput(book,s,s.rows[0].id,b,'=SUM(A1:A3)');setInput(book,s,s.rows[0].id,c,'=XMATCH(2,A1:A3,0,-1)');
  const engine=new Engine(book),row=s.rows[0].id;
  expect(engine.cell(s.id,row,b)).toBe(6);expect(engine.cell(s.id,row,c)).toBe(2);
  setInput(book,s,s.rows[2].id,a,'2');engine.invalidate([`${s.id}:${key(s.rows[2].id,a)}`]);
  expect(engine.cell(s.id,row,b)).toBe(5);expect(engine.cell(s.id,row,c)).toBe(3);
  setInput(book,s,s.rows[1].id,a,'=1/0');engine.invalidate([`${s.id}:${key(s.rows[1].id,a)}`]);
  expect(engine.cell(s.id,row,b)).toMatchObject({error:'#DIV/0!'});expect(engine.cell(s.id,row,c)).toBe(3);
});
it('reuses suffix match boundaries with duplicate order, blank comparisons and relevant error propagation',()=>{
  const book=createDemo(),s=book.sheets.at(-1)!,a=s.columns[0].id,b=s.columns[1].id,c=s.columns[2].id;
  for(const [i,value]of ['=1/0','x','X','','x',''].entries())setInput(book,s,s.rows[i].id,a,value);
  const expressions=['=XMATCH("x",A1:A6,0,1)','=XMATCH("x",A3:A6,0,1)','=XMATCH("x",A3:A6,0,-1)','=XMATCH(0,A3:A6,0,1)','=XMATCH("missing",A2:A6,0,1)','=XMATCH("missing",A1:A6,0,1)'];
  expressions.forEach((formula,i)=>setInput(book,s,s.rows[i].id,b,formula));
  const engine=new Engine(book),values=()=>s.rows.slice(0,6).map(r=>engine.cell(s.id,r.id,b));
  expect(values()).toEqual([2,1,3,2,{error:'#N/A'},{error:'#DIV/0!'}]);
  setInput(book,s,s.rows[0].id,a,'=UNKNOWN(1)');engine.invalidate([`${s.id}:${key(s.rows[0].id,a)}`]);
  expect(engine.cell(s.id,s.rows[0].id,b)).toMatchObject({error:'#UNSUPPORTED!'});
  expect(engine.cell(s.id,s.rows[1].id,b)).toBe(1);
  setInput(book,s,s.rows[4].id,a,'=UNKNOWN(1)');engine.invalidate([`${s.id}:${key(s.rows[4].id,a)}`]);
  expect(engine.cell(s.id,s.rows[1].id,b)).toMatchObject({error:'#UNSUPPORTED!'});
  setInput(book,s,s.rows[4].id,a,'z');engine.invalidate([`${s.id}:${key(s.rows[4].id,a)}`]);
  expect(engine.cell(s.id,s.rows[2].id,b)).toBe(1);
  setInput(book,s,s.rows[0].id,c,'=XMATCH("z",A5:A6,0,1)');
  setInput(book,s,s.rows[1].id,c,'=XMATCH("x",A2:A6,0,1)');
  const narrow=new Engine(book);expect(narrow.cell(s.id,s.rows[0].id,c)).toBe(1);expect(narrow.cell(s.id,s.rows[1].id,c)).toBe(1);
});
