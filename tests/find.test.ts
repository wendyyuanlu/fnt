import {expect,it} from 'vitest';
import {createTextSearch} from '../src/find';

const options={matchCase:false,entire:false};
it('matches literal text with independent case and entire-cell options',()=>{
  expect(createTextSearch('cottage',options).matches('Cottage cheese')).toBe(true);
  expect(createTextSearch('cottage',{...options,matchCase:true}).matches('Cottage cheese')).toBe(false);
  expect(createTextSearch('cottage',{...options,entire:true}).matches('Cottage cheese')).toBe(false);
  expect(createTextSearch('cottage',{...options,entire:true}).matches('COTTAGE')).toBe(true);
  expect(createTextSearch('cottage',{...options,entire:true}).matches('cottage\n')).toBe(false);
  expect(createTextSearch('',options).matches('anything')).toBe(false);
});
it('supports wildcard characters, escaping, multiline values and Unicode character boundaries',()=>{
  expect(createTextSearch('sm?th',options).matches('Smith')).toBe(true);
  expect(createTextSearch('cot*cheese',{...options,entire:true}).matches('Cottage\ncheese')).toBe(true);
  expect(createTextSearch('~*~?~~',options).replace('literal *?~ symbols','done')).toBe('literal done symbols');
  expect(createTextSearch('a?*z',{...options,entire:true}).replace('a😀z','found')).toBe('found');
});
it('replaces matching text without interpreting replacement characters or regex metacharacters',()=>{
  expect(createTextSearch('a.b',options).replace('a.b A.B axb','$&')).toBe('$& $& axb');
  expect(createTextSearch('foo*bar',options).replace('before foo one bar and foo two bar after','$1')).toBe('before $1 after');
  expect(createTextSearch('cat',{...options,entire:true}).replace('cat\n','dog')).toBe('cat\n');
});
it('handles many wildcard spans without exponential regex backtracking',()=>{
  const search=createTextSearch('a*a*a*a*a*a*b',options),text='a'.repeat(4000);
  expect(search.matches(text)).toBe(false);
  expect(search.matches(text+'b')).toBe(true);
});
it('returns matching character ranges using the same case, wildcard and Unicode rules',()=>{
  expect(createTextSearch('cat',options).ranges('cat CAT cat')).toEqual([{start:0,end:3},{start:4,end:7},{start:8,end:11}]);
  expect(createTextSearch('cat',{...options,matchCase:true}).ranges('CAT cat')).toEqual([{start:4,end:7}]);
  expect(createTextSearch('a?',options).ranges('😀A😺!')).toEqual([{start:2,end:5}]);
  expect(createTextSearch('a*e',options).ranges('--AxxE--')).toEqual([{start:2,end:6}]);
  expect(createTextSearch('~*',options).ranges('a*b')).toEqual([{start:1,end:2}]);
  expect(createTextSearch('cat',{...options,entire:true}).ranges('cat\n')).toEqual([]);
  expect(createTextSearch('',options).ranges('cat')).toEqual([]);
});
