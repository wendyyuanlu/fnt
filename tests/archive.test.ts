import { expect,it } from 'vitest';
import { ArchiveEncoder,compressArchive,decompressArchive,parseArchive,readArchive,stringifyArchive } from '../src/archive';
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
it('shares formula templates across Blob parts and reads the established packed format',async()=>{
  const encoder=new ArchiveEncoder(),formula={kind:'literal' as const,value:'Synthetic formula'};
  const left=encoder.stringify({formula}),right=encoder.stringify({formula:structuredClone(formula)});
  const blob=encoder.finishBlob(['{"left":',new Blob([left]),',"right":',new Blob([right]),'}']);
  const restored=await readArchive(blob) as {left:{formula:unknown};right:{formula:unknown}};
  expect(restored).toEqual({left:{formula},right:{formula}});
  expect(restored.left.formula).toBe(restored.right.formula);
  expect(JSON.parse(await blob.text()).asts).toHaveLength(1);
});
