import {expect,it} from 'vitest';
import {blankSheet,type Table} from '../src/model';
import {captureSelection,headerSelectionTables,tableHeaderBounds,selectionCount,selectionRanges} from '../src/selection';

it('adds a cell to a Shift range without selecting the intervening cells or counting overlaps twice',()=>{
  const sheet=blankSheet('Selection',8,8),first={r1:2,r2:2,c1:2,c2:5},area=captureSelection(sheet,first,'cells');
  const ranges=selectionRanges(sheet,{r1:4,r2:4,c1:7,c2:7},[area]);
  expect(selectionCount(ranges)).toBe(5);
  expect(ranges.some(r=>3>=r.r1&&3<=r.r2&&3>=r.c1&&3<=r.c2)).toBe(false);
  expect(selectionCount(selectionRanges(sheet,first,[area,area]))).toBe(4);
});
it('unions mixed cell, row and column selections without counting intersections twice',()=>{
  const sheet=blankSheet('Mixed',100,16);
  const cells=captureSelection(sheet,{r1:2,r2:2,c1:2,c2:5},'cells'),row=captureSelection(sheet,{r1:4,r2:4,c1:0,c2:15},'rows');
  expect(selectionCount(selectionRanges(sheet,{r1:0,r2:99,c1:8,c2:8},[cells,row]))).toBe(119);
});
it('keeps added selections bound to row and column identities after their positions change',()=>{
  const sheet=blankSheet('Identity',8,8),area=captureSelection(sheet,{r1:2,r2:2,c1:3,c2:3},'cells');
  const [row]=sheet.rows.splice(2,1);sheet.rows.push(row);
  const [column]=sheet.columns.splice(3,1);sheet.columns.unshift(column);
  const ranges=selectionRanges(sheet,{r1:0,r2:0,c1:5,c2:5},[area]);
  expect(ranges).toContainEqual({r1:7,r2:7,c1:0,c2:0});
  expect(selectionCount(ranges)).toBe(2);
});
it('distinguishes three stacked tables and two adjacent tables sharing sheet headers',()=>{
  const sheet=blankSheet('Five tables',24,12);
  const make=(name:string,r:number,c:number):Table=>({id:name,name,sheet:sheet.id,header:sheet.rows[r].id,rows:sheet.rows.slice(r+1,r+5).map(row=>row.id),columns:sheet.columns.slice(c,c+3).map((column,i)=>({id:name+'-'+i,name:'Field '+i,column:column.id}))});
  const tables=[make('Top',2,1),make('Middle',9,1),make('Bottom',16,1),make('Right',9,5),make('Far-right',9,9)];
  expect(headerSelectionTables(sheet,tables,'column',2).map(t=>t.name)).toEqual(['Top','Middle','Bottom']);
  expect(headerSelectionTables(sheet,tables,'row',11).map(t=>t.name)).toEqual(['Middle','Right','Far-right']);
  expect(headerSelectionTables(sheet,tables,'column',6).map(t=>t.name)).toEqual(['Right']);
  expect(headerSelectionTables(sheet,tables,'row',0)).toEqual([]);
  expect(tableHeaderBounds(sheet,tables[1],'column',2)).toEqual({r1:9,r2:13,c1:2,c2:2});
  expect(tableHeaderBounds(sheet,tables[1],'row',11,10)).toEqual({r1:10,r2:11,c1:1,c2:3});
  expect(()=>tableHeaderBounds(sheet,tables[1],'row',0)).toThrow('outside');
});
it('keeps scoped selections clipped to current table membership across moves, removal and disjoint additions',()=>{
  const sheet=blankSheet('Scoped selections',12,10),table:Table={id:'owner',sheet:sheet.id,name:'Owner',header:sheet.rows[2].id,rows:[sheet.rows[3].id,sheet.rows[5].id],columns:[1,3].map(c=>({id:'field-'+c,name:'Field',column:sheet.columns[c].id}))};
  const bounds=tableHeaderBounds(sheet,table,'column',3),area=captureSelection(sheet,bounds,'columns',table);
  expect(selectionCount(selectionRanges(sheet,bounds,[],table))).toBe(3);
  const [row]=sheet.rows.splice(3,1);sheet.rows.push(row);
  const [column]=sheet.columns.splice(3,1);sheet.columns.unshift(column);
  let ranges=selectionRanges(sheet,{r1:0,r2:0,c1:8,c2:8},[area],undefined,[table]);
  expect(ranges).toContainEqual({r1:11,r2:11,c1:0,c2:0});
  expect(selectionCount(ranges)).toBe(4);
  table.rows=table.rows.filter(id=>id!==row.id);
  ranges=selectionRanges(sheet,{r1:0,r2:0,c1:8,c2:8},[area],undefined,[table]);
  expect(selectionCount(ranges)).toBe(3);
  expect(selectionCount(selectionRanges(sheet,{r1:0,r2:0,c1:8,c2:8},[area],undefined,[]))).toBe(1);
});
