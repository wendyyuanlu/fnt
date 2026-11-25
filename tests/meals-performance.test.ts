import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {parseArchive} from '../src/archive';
import {displayFormula,Engine,scalar} from '../src/formula';
import {allSheets,allTables,getCell,isFault,key,setInput,type Workbook} from '../src/model';

it('retains real Meals dependency results after quantity, portion, ingredient and conversion edits without rewriting summary formulas',()=>{
  const {book}=parseArchive(readFileSync('public/testing-workbook.json','utf8')) as {book:Workbook};
  const tables=allTables(book),meals=tables.find(t=>t.name==='Meals')!,ingredients=tables.find(t=>t.name==='Ingredients')!,convert=tables.find(t=>t.name==='Convert')!;
  const sheets=new Map(allSheets(book).map(s=>[s.id,s])),sheet=sheets.get(meals.sheet)!,source=sheets.get(ingredients.sheet)!,conversion=sheets.get(convert.sheet)!;
  const summary=meals.rows[0],nutrients=meals.columns.slice(8,14).map(c=>c.column);
  const formulas=nutrients.map(c=>displayFormula(getCell(sheet,summary,c).formula!,book)),engine=new Engine(book);
  const calculate=(engine:Engine)=>nutrients.map(c=>{engine.beginPass();return scalar(engine.cell(sheet.id,summary,c));});
  const original=calculate(engine);expect(original.every(v=>typeof v==='number')).toBe(true);
  const detail=meals.rows.slice(1,11).find(row=>typeof getCell(sheet,row,meals.columns[4].column).value==='number'&&Number(scalar(engine.cell(sheet.id,row,nutrients[0])))>0)!;
  const edit=(s:typeof sheet,row:string,column:string,value:string)=>{
    setInput(book,s,row,column,value);engine.invalidate([`${s.id}:${key(row,column)}`]);
    const result=calculate(engine);expect(result).toEqual(calculate(new Engine(book)));
    expect(result.some(isFault)).toBe(false);expect(nutrients.map(c=>displayFormula(getCell(sheet,summary,c).formula!,book))).toEqual(formulas);
    return result;
  };
  const grams=Number(getCell(sheet,detail,meals.columns[4].column).value);
  expect(edit(sheet,detail,meals.columns[4].column,String(grams*2))).not.toEqual(original);
  const doubled=edit(sheet,summary,meals.columns[2].column,'7');
  const before=calculate(engine);
  const quantityRow=meals.rows.slice(1,11).find(row=>getCell(sheet,row,meals.columns[4].column).formula&&typeof getCell(sheet,row,meals.columns[5].column).value==='number'&&Number(scalar(engine.cell(sheet.id,row,nutrients[0])))>0)!;
  expect(quantityRow).toBeDefined();
  const quantity=Number(getCell(sheet,quantityRow,meals.columns[5].column).value);
  expect(edit(sheet,quantityRow,meals.columns[5].column,String(quantity*2+1))).not.toEqual(before);
  const ingredient=ingredients.rows.find(row=>Number(scalar(engine.cell(source.id,row,ingredients.columns[4].column)))>0)!;
  const name=scalar(engine.cell(source.id,ingredient,ingredients.columns[0].column));
  const beforeIngredient=calculate(engine);
  expect(edit(sheet,detail,meals.columns[3].column,String(name))).not.toEqual(beforeIngredient);
  const beforeDensity=calculate(engine);
  expect(edit(source,ingredient,ingredients.columns[4].column,'777')).not.toEqual(beforeDensity);
  let affected=false;
  for(const row of convert.rows){
    const factor=getCell(conversion,row,convert.columns[2].column);
    if(typeof factor.value!=='number')continue;
    const prior=calculate(engine),value=factor.value;
    const changed=edit(conversion,row,convert.columns[2].column,String(value*2));
    affected=JSON.stringify(prior)!==JSON.stringify(changed);
    if(affected)break;
    edit(conversion,row,convert.columns[2].column,String(value));
  }
  expect(affected).toBe(true);expect(doubled.every(v=>typeof v==='number')).toBe(true);
},30000);
