import { expect,it } from 'vitest';
import {parseTsv,serializeTsv}from'../src/clipboard';

it('roundtrips multiline notes, tabs, quotes and trailing blank fields',()=>{
  const rows=[['Recipe','Line one\nLine "two"',''],['a\tb','42','']];
  expect(parseTsv(serializeTsv(rows))).toEqual(rows);
  expect(parseTsv('a\tb\r\n1\t2\r\n')).toEqual([['a','b'],['1','2']]);
  expect(()=>parseTsv('"unclosed')).toThrow('unclosed');
});
