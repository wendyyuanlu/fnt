import { expect,it } from 'vitest';
import { RowViewport } from '../src/row-viewport';

it('keeps a continuous height and overlapping windows across former page boundaries',()=>{
  const view=new RowViewport(Array.from({length:100000},()=>33)),before=view.window(59*33,660),after=view.window(60*33,660);
  expect(view.offsets.at(-1)).toBe(3300000);
  expect(before.start).toBeLessThan(59);expect(before.end).toBeGreaterThan(60);
  expect(after.start).toBeLessThan(60);expect(after.end).toBeGreaterThan(61);
  expect(after.end-after.start).toBeLessThan(50);
  expect(after.before+view.heights.slice(after.start,after.end).reduce((a,b)=>a+b,0)+after.after).toBe(3300000);
});
it('resolves exact row boundaries and changed wrapped heights, including empty and final viewports',()=>{
  const view=new RowViewport([33,96,33,66]);
  expect(view.at(32)).toBe(0);expect(view.at(33)).toBe(1);expect(view.at(128)).toBe(1);expect(view.at(129)).toBe(2);
  view.heights[1]=150;view.rebuild();expect(view.at(182)).toBe(1);expect(view.at(183)).toBe(2);
  const end=view.window(100000,500);expect(end.end).toBe(4);expect(end.after).toBe(0);
  expect(new RowViewport([]).window(0,500)).toEqual({start:0,end:0,before:0,after:0});
});
