import { describe,expect,it } from 'vitest';
import { compile,Engine } from '../src/formula';
import { createDemo } from '../src/model';
import { displayExcelDate,excelDate,excelDateText } from '../src/dates';

describe('year-aware date display',()=>{
  it('uses an unpadded month and two-digit day except for earlier years',()=>{
    expect(displayExcelDate(excelDate(2026,9,29)!,2026)).toBe('9/29');
    expect(displayExcelDate(excelDate(2026,10,2)!,2026)).toBe('10/02');
    expect(displayExcelDate(excelDate(2025,9,29)!,2026)).toBe('25/09/29');
    expect(displayExcelDate(excelDate(2000,1,2)!,2026)).toBe('00/01/02');
    expect(displayExcelDate(excelDate(2027,1,2)!,2026)).toBe('1/02');
  });
  it('changes the display at a year boundary without changing the stored serial or ISO date',()=>{
    const serial=excelDate(2026,12,31)!;
    expect(displayExcelDate(serial,2026)).toBe('12/31');
    expect(displayExcelDate(serial,2027)).toBe('26/12/31');
    expect(excelDateText(serial)).toBe('2026-12-31');
  });
  it('retains explicit invalid-date handling',()=>{
    for(const value of [-1,Infinity,NaN,2958466])expect(displayExcelDate(value,2026)).toBeUndefined();
  });
});

describe('Excel date boundaries without cached values',()=>{
  const cases:[string,number|string][]=[
    ['DATE(1900,1,1)',1],['DATE(1900,2,28)',59],['DATE(1900,2,29)',60],['DATE(1900,3,1)',61],
    ['DATE(1900,3,0)',60],['DATE(1900,2,30)',61],['DATE(1900,1,0)',0],
    ['DATE(0,1,1)',1],['DATE(99,1,1)',36161],['DATE(2025,5,5)',45782],
    ['DATE(2025.9,5.9,5.9)',45782],['DATE(2025,13,1)',46023],['DATE(2025,1,0)',45657],
    ['DATE(9999,12,31)',2958465],['DATE(9999,13,1)','#NUM!'],['DATE(-1,1,1)','#NUM!'],['DATE(1900,0,1)','#NUM!'],
    ['DATEDIF(DATE(2001,1,1),DATE(2003,1,1),"Y")',2],
    ['DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"D")',440],
    ['DATEDIF(DATE(2001,6,15),DATE(2002,8,15),"M")',14],
    ['DATEDIF(DATE(2001,6,15),DATE(2002,8,14),"YM")',1],
    ['DATEDIF(DATE(2020,2,29),DATE(2021,2,28),"Y")',0],
    ['DATEDIF(59,61,"D")',2],['DATEDIF(1.75,2.25,"D")',1],
    ['DATEDIF(2,1,"D")','#NUM!'],['DATEDIF(-1,1,"D")','#NUM!'],['DATEDIF(1,2958466,"D")','#NUM!'],
    ['DATEDIF(1,2,"invalid")','#NUM!'],['DATEDIF(1,2,"MD")','#UNSUPPORTED!'],['DATEDIF(1,2,"YD")','#UNSUPPORTED!'],
  ];
  it.each(cases)('%s → %s',(source,expected)=>{
    const book=createDemo(),s=book.sheets[0],r=s.rows[10].id,c=s.columns[10].id;
    const result=new Engine(book).evaluate(compile('='+source,book,s.id,r,c),s.id,r,c);
    if(typeof expected==='number')expect(result).toBe(expected);
    else expect(result).toMatchObject({error:expected});
  });
});
