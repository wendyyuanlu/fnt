import {expect,it} from 'vitest';
import {blankSheet} from '../src/model';
import {captureSelection,selectionCount,selectionRanges} from '../src/selection';

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
