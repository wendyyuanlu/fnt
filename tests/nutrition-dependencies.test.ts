import {describe,expect,it} from 'vitest';
import {compile,type Ast} from '../src/formula';
import {createDemo,setInput} from '../src/model';
import {nutritionDependencyFilter} from '../src/nutrition-dependencies';

describe('conservative nutrition dependency projection',()=>{
  it('follows scalar, named, bound, structured and range dependencies without selecting unrelated cells',()=>{
    const book=createDemo(),sheet=book.sheets[1],table=book.tables.find(table=>table.sheet===sheet.id)!;
    const [first,second]=table.rows,[a,b,c]=table.columns;
    setInput(book,sheet,first,a.column,'7');
    sheet.cells[`${first}:${b.column}`]={formula:{kind:'ref',sheet:sheet.id,row:first,column:a.column,absRow:true,absCol:true}};
    sheet.cells[`${second}:${b.column}`]={binding:{table:table.id,row:first,column:b.id}};
    book.names.push({id:'named-source',name:'NamedSource',context:sheet.id,original:'=Ingredients!$B$3',formula:{kind:'ref',sheet:sheet.id,row:second,column:b.column,absRow:true,absCol:true}});
    const changed=new Set([`${sheet.id}:${first}:${a.column}`]),scope=nutritionDependencyFilter(book,changed);
    expect(scope.cell(sheet.id,first,b.column)).toBe(true);
    expect(scope.cell(sheet.id,second,b.column)).toBe(true);
    expect(scope.calculation({kind:'name',id:'named-source'},sheet.id,first,c.column)).toBe(true);
    expect(scope.calculation({kind:'structured',table:table.id,columns:[b.id],mode:'data'},sheet.id,first,c.column)).toBe(true);
    const ref=(row:string,column:string):Ast=>({kind:'ref',sheet:sheet.id,row,column,absRow:true,absCol:true});
    expect(scope.calculation({kind:'range',start:ref(first,b.column),end:ref(second,b.column)},sheet.id,first,c.column)).toBe(true);
    expect(scope.cell(sheet.id,second,c.column)).toBe(false);
    expect(scope.calculation({kind:'literal',value:42},sheet.id,first,c.column)).toBe(false);
  });
  it('falls back for dynamic references, unit conversions, cyclic dependencies and possible spill occupants',()=>{
    const book=createDemo(),sheet=book.sheets[0],row=sheet.rows[1].id,[a,b,c]=sheet.columns;
    const scope=nutritionDependencyFilter(book,new Set(['unrelated:row:column']));
    for(const text of ['=INDIRECT("A1")','=UNITFACTOR("g","kg")','=TODAY()','=FutureFunction(1)']){
      expect(scope.calculation(compile(text,book,sheet.id,row,c.id),sheet.id,row,c.id)).toBe(true);
    }
    sheet.cells[`${row}:${a.id}`]={formula:{kind:'ref',sheet:sheet.id,row,column:b.id,absRow:true,absCol:true}};
    sheet.cells[`${row}:${b.id}`]={formula:{kind:'ref',sheet:sheet.id,row,column:a.id,absRow:true,absCol:true}};
    expect(scope.cell(sheet.id,row,a.id)).toBe(true);
    sheet.cells[`${row}:${a.id}`]={formula:compile('=VSTACK(1,2)',book,sheet.id,row,a.id),spillHint:true};
    const spilled=nutritionDependencyFilter(book,new Set(['unrelated:row:column']));
    expect(spilled.cell(sheet.id,row,a.id)).toBe(true);
    delete sheet.cells[`${sheet.rows[2].id}:${a.id}`];
    expect(spilled.cell(sheet.id,sheet.rows[2].id,a.id)).toBe(true);
  });
  it('uses a bounded conservative fallback instead of traversing arbitrarily large expressions',()=>{
    const book=createDemo(),sheet=book.sheets[0],row=sheet.rows[1].id,column=sheet.columns[0].id;
    const ast:Ast={kind:'call',name:'SUM',args:Array.from({length:60000},()=>({kind:'literal',value:1}))};
    const scope=nutritionDependencyFilter(book,new Set());
    expect(scope.calculation(ast,sheet.id,row,column)).toBe(true);
    expect(scope.calculation({kind:'literal',value:1},sheet.id,row,column)).toBe(false);
  });
  it('does not exhaust a whole review after many individually short calculations',()=>{
    const book=createDemo(),sheet=book.sheets[0],row=sheet.rows[1].id,column=sheet.columns[0].id;
    const scope=nutritionDependencyFilter(book,new Set());
    for(let i=0;i<100;i++){
      const ast:Ast={kind:'call',name:'SUM',args:Array.from({length:1000},()=>({kind:'literal',value:i}))};
      expect(scope.calculation(ast,sheet.id,row,column)).toBe(false);
    }
  });
  it('still falls back when aggregate review work exceeds the calculation-pass limit',()=>{
    const book=createDemo(),sheet=book.sheets[0],row=sheet.rows[1].id,column=sheet.columns[0].id;
    const scope=nutritionDependencyFilter(book,new Set());
    const ast:Ast={kind:'call',name:'SUM',args:Array.from({length:20000},()=>({kind:'literal',value:1}))};
    let exhausted=false;
    for(let i=0;i<30;i++)exhausted=scope.calculation(ast,sheet.id,row,column)||exhausted;
    expect(exhausted).toBe(true);
  });
});
