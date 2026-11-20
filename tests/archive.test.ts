import { expect,it } from 'vitest';
import { compressArchive,decompressArchive,parseArchive,stringifyArchive } from '../src/archive';
import { Engine,flatten } from '../src/formula';
import { createDemo, getCell } from '../src/model';
import { validateBook } from '../src/storage';

it('roundtrips identity-bound formulas through independent and compressed sync archives',()=>{
  const book=createDemo(),source=book.sheets[0],restored=parseArchive(stringifyArchive(book)),compressed=decompressArchive(compressArchive(book));
  validateBook(restored);validateBook(compressed);
  expect(flatten(new Engine(restored).cell(source.id,source.rows[1].id,source.columns[3].id))[0]).toBeCloseTo(208.8);
  expect(getCell(compressed.sheets[0],source.rows[1].id,source.columns[3].id).formula).toEqual(getCell(source,source.rows[1].id,source.columns[3].id).formula);
});
it('rejects missing formula templates',()=>{
  expect(()=>parseArchive('{"format":"fnt-packed-v1","asts":[],"data":{"formula":{"$ast":0}}}')).toThrow('Missing archived formula');
});
