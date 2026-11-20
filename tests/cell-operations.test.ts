import { expect,it } from 'vitest';
import { cutCells,shiftCells } from '../src/cell-operations';
import { compile,Engine,displayFormula } from '../src/formula';
import { createDemo,getCell,key,setInput,clone } from '../src/model';

function fixture(){
  const book=createDemo(),s=book.sheets[3];s.cells={};
  const put=(r:number,c:number,value:string)=>setInput(book,s,s.rows[r].id,s.columns[c].id,value);
  const value=(r:number,c:number)=>new Engine(book).cell(s.id,s.rows[r].id,s.columns[c].id);
  return {book,s,put,value};
}
it('shifts freeform cells down and deletes upward, preserving ranges, names, notes and validation',()=>{
  const {book,s,put,value}=fixture();
  put(0,0,'2');put(1,0,'3');put(2,0,'4');put(0,2,'=SUM(A1:A3)');
  s.cells[key(s.rows[1].id,s.columns[0].id)].note='keep this';
  book.names.push({id:crypto.randomUUID(),name:'Picked',context:s.id,original:'=A2',formula:compile('=A2',book,s.id,s.rows[0].id,s.columns[2].id)});
  s.validations.push({id:crypto.randomUUID(),sheet:s.id,rows:[s.rows[1].id],columns:[s.columns[0].id],source:'="a,b"',values:['a','b']});
  shiftCells(book,s,{r1:1,r2:1,c1:0,c2:0},'down');
  expect(value(0,2)).toBe(9);expect(value(1,0)).toBe(null);expect(value(2,0)).toBe(3);
  expect(displayFormula(getCell(s,s.rows[0].id,s.columns[2].id).formula!,book)).toContain('A4');
  expect(getCell(s,s.rows[2].id,s.columns[0].id).note).toBe('keep this');
  expect(s.validations[0].rows).toEqual([s.rows[2].id]);
  expect(new Engine(book).evaluate(book.names[0].formula,s.id,s.rows[0].id,s.columns[2].id)).toBe(3);
  shiftCells(book,s,{r1:2,r2:2,c1:0,c2:0},'up');
  expect(value(0,2)).toBe(6);expect(book.names[0].formula).toMatchObject({kind:'error',value:{error:'#REF!'}});
});
it('cut moves preserve formula targets, not relative copy offsets, including cross-sheet dependents',()=>{
  const {book,s,put,value}=fixture(),other=book.sheets[0];
  put(0,0,'7');put(0,1,'=A1*2');put(0,4,'=B1');
  s.cells[key(s.rows[1].id,s.columns[1].id)]={format:{bold:true}};
  cutCells(book,s,{r1:0,r2:0,c1:1,c2:1},s,1,1);
  expect(value(1,1)).toBe(14);expect(value(0,4)).toBe(14);expect(value(0,1)).toBe(null);
  cutCells(book,s,{r1:1,r2:1,c1:1,c2:1},other,10,9);
  expect(new Engine(book).cell(other.id,other.rows[10].id,other.columns[9].id)).toBe(14);
  expect(value(0,4)).toBe(14);
  expect(displayFormula(getCell(other,other.rows[10].id,other.columns[9].id).formula!,book)).toContain('Notebook');
});
it('rejects occupied destinations, fragmented ranges and partial table shifts without changing data',()=>{
  const {book,s,put}=fixture();
  put(0,0,'1');put(1,0,'2');put(2,0,'3');put(0,3,'=SUM(A1:A3)');put(0,2,'occupied');
  const before=clone(book);
  expect(()=>cutCells(book,s,{r1:1,r2:1,c1:0,c2:0},s,0,2)).toThrow(/contains data/);
  expect(()=>cutCells(book,s,{r1:1,r2:1,c1:0,c2:0},s,4,2)).toThrow(/fragment/);
  expect(()=>shiftCells(book,book.sheets[1],{r1:1,r2:1,c1:0,c2:0},'down')).toThrow(/table records/);
  expect(book).toEqual(before);
});
it('moves overlapping cuts from a snapshot and shifts right without dropping bottom-edge data',()=>{
  const {book,s,put,value}=fixture();put(0,0,'1');put(0,1,'2');put(0,2,'3');
  cutCells(book,s,{r1:0,r2:0,c1:0,c2:2},s,0,1);
  expect([value(0,0),value(0,1),value(0,2),value(0,3)]).toEqual([null,1,2,3]);
  put(0,s.columns.length-1,'99');const oldWidth=s.columns.length;
  shiftCells(book,s,{r1:0,r2:0,c1:1,c2:1},'right');
  expect(s.columns).toHaveLength(oldWidth+1);expect(value(0,oldWidth)).toBe(99);
});
it('refuses to cut generated spill followers or split their output with a shift',()=>{
  const {book,s,put}=fixture();
  put(0,0,'=FILTER(Ingredients[Ingredient],Ingredients[Protein (g)]>8)');
  const before=clone(book);
  expect(()=>cutCells(book,s,{r1:1,r2:1,c1:0,c2:0},s,5,0)).toThrow(/spill cells/);
  expect(()=>shiftCells(book,s,{r1:1,r2:1,c1:0,c2:0},'down')).toThrow(/spill cells/);
  expect(book).toEqual(before);
});
