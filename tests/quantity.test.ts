import {expect,it} from 'vitest';
import {displayFraction,parseFraction} from '../src/quantity';
import {createDemo,getCell,key,moveColumns,renameColumn,setInput} from '../src/model';
import {compile,Engine} from '../src/formula';

it.each([['1/2',0.5,'1/2'],['2/4',0.5,'1/2'],['1 1/2',1.5,'1 1/2'],['-1 1/2',-1.5,'-1 1/2'],['1½',1.5,'1 1/2'],['2 ⅔',2+2/3,'2 2/3'],['⅛',0.125,'1/8'],['3 ⁄ 4',0.75,'3/4'],['7/3',7/3,'2 1/3']] as const)('reads %s without concatenating mixed-fraction digits',(input,value,text)=>{
  expect(parseFraction(input)).toEqual({kind:'fraction',value,text});
  expect(displayFraction(value,input)).toBe(text);
});
it('distinguishes invalid fractions from intact notes and never invents rounded quantities',()=>{
  expect(parseFraction('1/0')).toMatchObject({kind:'invalid',error:'#DIV/0!'});
  for(const input of ['1//2','1/-2','1.5/2','1/2/3'])expect(parseFraction(input)).toMatchObject({kind:'invalid',error:'#VALUE!'});
  expect(parseFraction('9007199254740992/3')).toMatchObject({kind:'invalid',error:'#NUM!'});
  for(const text of ['1/2 shot glass  ','Recipe: 1/2 cup','tbsp','0.5'])expect(parseFraction(text)).toEqual({kind:'text'});
  expect(displayFraction(1/3)).toBe('1/3');expect(displayFraction(0.3333)).toBe('3333/10000');
  expect(displayFraction(0.123456789123)).toBe('0.123456789123');
});
it.each([['¼',1/4],['¾',3/4],['⅐',1/7],['⅑',1/9],['⅒',1/10],['⅓',1/3],['⅔',2/3],['⅕',1/5],['⅖',2/5],['⅗',3/5],['⅘',4/5],['⅙',1/6],['⅚',5/6],['⅜',3/8],['⅝',5/8],['⅞',7/8],['−½',-1/2]] as const)('understands fraction glyph %s',(input,value)=>{
  expect(parseFraction(input)).toMatchObject({kind:'fraction',value});
});
it('keeps quantity inputs numeric with exact editable input and refuses invalid replacement',()=>{
  const book=createDemo(),s=book.sheets.at(-1)!,row=s.rows[0].id,column=s.columns[0].id;
  s.cells[key(row,column)]={value:4,note:'Preserve',format:{number:'fraction',wrap:false}};
  setInput(book,s,row,column,'1½');expect(getCell(s,row,column)).toMatchObject({value:1.5,fractionInput:'1½',note:'Preserve',format:{wrap:false}});
  const previous=structuredClone(getCell(s,row,column));
  expect(()=>setInput(book,s,row,column,'1/0')).toThrow('zero');expect(getCell(s,row,column)).toEqual(previous);
  setInput(book,s,row,column,"'1/2");expect(new Engine(book).cell(s.id,row,column)).toBe('1/2');
  setInput(book,s,row,column,'1/2 shot glass  ');expect(new Engine(book).cell(s.id,row,column)).toBe('1/2 shot glass  ');
});
it('interprets legacy fraction quantities and VALUE explicitly without rewriting text or formula results',()=>{
  const book=createDemo(),s=book.sheets.at(-1)!,row=s.rows[0].id,a=s.columns[0].id,b=s.columns[1].id;
  s.cells[key(row,a)]={value:'1/8',format:{number:'fraction'}};
  setInput(book,s,row,b,'=IF(ISNUMBER(A1),A1*80,0)');
  expect(new Engine(book).cell(s.id,row,b)).toBe(10);expect(getCell(s,row,a).value).toBe('1/8');
  const engine=new Engine(book);
  expect(engine.evaluate(compile('=VALUE("1 1/2")',book,s.id,row,a),s.id,row,a)).toBe(1.5);
  expect(engine.evaluate(compile('=VALUE("1/0")',book,s.id,row,a),s.id,row,a)).toMatchObject({error:'#DIV/0!'});
});
it('keeps fraction quantities and calculations attached through field moves and renames',()=>{
  const book=createDemo(),table=book.tables.find(t=>t.name==='DailyLog')!,s=book.sheets.find(s=>s.id===table.sheet)!,row=table.rows[0],amount=table.columns[2],calories=table.columns[3];
  s.cells[key(row,amount.column)]={value:0.5,fractionInput:'½',format:{number:'fraction'}};
  setInput(book,s,row,calories.column,'=DailyLog[@[Amount (g)]]*80');
  renameColumn(book,table,amount.id,'Fraction amount');moveColumns(book,s,[amount.column],s.columns.length);
  expect(new Engine(book).cell(s.id,row,calories.column)).toBe(40);
  expect(getCell(s,row,amount.column)).toMatchObject({value:0.5,fractionInput:'½'});
});
