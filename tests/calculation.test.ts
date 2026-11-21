import { expect,it } from 'vitest';
import { applyTableColumnFormula,columnCalculations,quantityDiagnostic,restoreCalculation,tableColumnFormulas } from '../src/calculation';
import { compile,displayFormula,Engine } from '../src/formula';
import { cutCells } from '../src/cell-operations';
import { createDemo,fillCells,getCell,key,move,renameColumn,setInput } from '../src/model';
import { validateBook } from '../src/storage';

it('edits a column formula pattern without replacing overrides or unrelated formulas',()=>{
  const b=createDemo(),s=b.sheets[1],t=b.tables[0],column=t.columns[5].column,source=getCell(s,t.rows[0],column).formula!;
  setInput(b,s,t.rows[1],column,'999');setInput(b,s,t.rows[2],column,'=7');
  expect(tableColumnFormulas(b,t,column)).toHaveLength(2);
  const replacement=compile('=2',b,s.id,t.rows[0],column);
  applyTableColumnFormula(b,t,column,replacement,'matching',source);
  expect(new Engine(b).cell(s.id,t.rows[0],column)).toBe(2);
  expect(new Engine(b).cell(s.id,t.rows[1],column)).toBe(999);
  expect(getCell(s,t.rows[1],column).calculation).toEqual(replacement);
  expect(new Engine(b).cell(s.id,t.rows[2],column)).toBe(7);
});
it('adds column formulas only to calculated or empty cells unless replacing manual values is explicit',()=>{
  const b=createDemo(),s=b.sheets[1],t=b.tables[0],column=t.columns[4].column;
  setInput(b,s,t.rows[0],column,'');setInput(b,s,t.rows[1],column,'123');
  const formula=compile('=A2',b,s.id,t.rows[0],column),manual=getCell(s,t.rows[1],column);
  applyTableColumnFormula(b,t,column,formula,'calculated');
  expect(getCell(s,t.rows[0],column).formula).toEqual(formula);
  expect(getCell(s,t.rows[1],column)).toEqual(manual);
  applyTableColumnFormula(b,t,column,formula,'all');
  expect(displayFormula(getCell(s,t.rows[1],column).formula!,b)).toBe('=A3');
  expect(getCell(s,t.header,column).formula).toBeUndefined();
});
it('retains the exact overridden calculation through rename, column movement, filling, reload and explicit restoration',()=>{
  const b=createDemo(),s=b.sheets[1],t=b.tables[0],row=t.rows[0],column=t.columns[5].column,original=getCell(s,row,column).formula!;
  setInput(b,s,row,column,'777');expect(getCell(s,row,column).calculation).toEqual(original);expect(new Engine(b).cell(s.id,row,column)).toBe(777);
  renameColumn(b,t,t.columns[2].id,'Energy');move(s.columns,5,0);
  const restored=JSON.parse(JSON.stringify(b));validateBook(restored);const local=restored.sheets[1];
  const option=columnCalculations(restored,local,row,column)[0];expect(displayFormula(option.formula,restored)).toContain('[Energy]');
  restoreCalculation(restored,local,row,column,option.formula);expect(new Engine(restored).cell(local.id,row,column)).toBe(3.75);
  setInput(b,s,row,column,'888');
  fillCells(b,s,{r1:1,r2:1,c1:0,c2:0},{r1:1,r2:2,c1:0,c2:0});
  const next=s.rows[2].id;restoreCalculation(b,s,next,column,columnCalculations(b,s,next,column)[0].formula);
  expect(new Engine(b).cell(s.id,next,column)).toBe(1.16);
});
it('restores user-authored formulas rather than replacing them with an inferred default, including cut-bound references',()=>{
  const b=createDemo(),s=b.sheets[3],row=s.rows[1].id,column=s.columns[1].id;
  setInput(b,s,row,s.columns[2].id,'6');setInput(b,s,row,column,'=C2*7');setInput(b,s,row,column,'999');
  cutCells(b,s,{r1:1,r2:1,c1:2,c2:2},s,3,3);
  expect(displayFormula(getCell(s,row,column).calculation!,b)).toBe('=(D4*7)');
  restoreCalculation(b,s,row,column,columnCalculations(b,s,row,column)[0].formula);expect(new Engine(b).cell(s.id,row,column)).toBe(42);
});
it('diagnoses a missing conversion caught as zero without redefining IFERROR or overwriting imported formula text',()=>{
  const b=createDemo(),s=b.sheets[2],t=b.tables[1],ingredients=b.tables[0],source=b.sheets[1],conversions=b.tables[2],convert=b.sheets[0];
  ingredients.columns.push({id:'conversion-amount',column:source.columns[6].id,name:'Conversion Amount'});setInput(b,source,ingredients.header,source.columns[6].id,'Conversion Amount');setInput(b,source,ingredients.rows[0],source.columns[6].id,'10');
  conversions.name='Convert';conversions.columns.slice(0,3).forEach((c,i)=>renameColumn(b,conversions,c.id,['From Unit','To Unit','Conversion Factor'][i]));
  setInput(b,convert,conversions.rows[0],conversions.columns[0].column,'tbsp');setInput(b,convert,conversions.rows[0],conversions.columns[1].column,'cup');setInput(b,convert,conversions.rows[0],conversions.columns[2].column,'0.0625');
  t.columns.push({id:'amount',column:s.columns[5].id,name:'Amount'},{id:'unit',column:s.columns[6].id,name:'Unit'});
  const row=t.rows[0],grams=t.columns[2].column;
  setInput(b,s,t.header,s.columns[5].id,'Amount');setInput(b,s,t.header,s.columns[6].id,'Unit');setInput(b,s,row,s.columns[5].id,'2');setInput(b,s,row,s.columns[6].id,'unknown-unit');
  const original='=IFERROR([@Amount]*XLOOKUP([@Unit],Convert[From Unit],Convert[Conversion Factor],0)*XLOOKUP([@Ingredient],Ingredients[Ingredient],Ingredients[Serving (g)],0)/XLOOKUP([@Ingredient],Ingredients[Ingredient],Ingredients[Conversion Amount],0),0)';
  setInput(b,s,row,grams,original);expect(new Engine(b).cell(s.id,row,grams)).toBe(0);
  expect(quantityDiagnostic(b,s,row,grams)).toContain('Missing universal conversion');expect(getCell(s,row,grams).original).toBe(original);
  setInput(b,s,row,s.columns[6].id,'tbsp');expect(quantityDiagnostic(b,s,row,grams)).toBeUndefined();expect(new Engine(b).cell(s.id,row,grams)).toBe(.5);
  setInput(b,s,row,s.columns[6].id,'TBSP');setInput(b,s,row,t.columns[1].column,'EXAMPLE OATS');
  expect(new Engine(b).cell(s.id,row,grams)).toBe(.5);expect(quantityDiagnostic(b,s,row,grams)).toBeUndefined();
  setInput(b,s,row,grams,'25');expect(quantityDiagnostic(b,s,row,grams)).toBeUndefined();expect(getCell(s,row,grams).calculation).toEqual(compile(original,b,s.id,row,grams));
});
