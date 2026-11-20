import { expect,it } from 'vitest';
import { compile,Engine } from '../src/formula';
import { addReferenceValue,createReference,moveReferenceValue,referenceChoices,referenceTable,referenceUsages,removeReferenceValue,renameReferenceValue,setDerivedSource,unitsSource,upsertConversion,validationReference } from '../src/references';
import { mergeReferences } from '../src/references-import';
import { blankSheet,clone,createDemo,key,setInput,uid,type Workbook } from '../src/model';
import { validateBook } from '../src/storage';

function source(){
  const dropdowns=blankSheet('Dropdowns',90,6),convert=blankSheet('Convert',12,6),meals=blankSheet('Meals',12,6),derived=blankSheet('MealDD',8,3);
  const b:Workbook={schema:1,id:uid(),title:'Invented auxiliary source',revision:0,sheets:[dropdowns,convert,meals,derived],tables:[],names:[],pickerSources:{}};
  function table(sheet:typeof dropdowns,name:string,at:number,headers:string[],rows:string[][]){
    const t={id:uid(),name,sheet:sheet.id,header:sheet.rows[at].id,rows:sheet.rows.slice(at+1,at+1+rows.length).map(r=>r.id),columns:headers.map((name,i)=>({id:uid(),column:sheet.columns[i].id,name}))};
    b.tables.push(t);[headers,...rows].forEach((row,i)=>row.forEach((value,j)=>setInput(b,sheet,sheet.rows[at+i].id,sheet.columns[j].id,value)));return t;
  }
  ['IngredientType','Period','AnimalType','Table14','SnackCountry','SnackFlavour','SnackCategory'].forEach((name,i)=>table(dropdowns,name,i*5,[name+' field'],[['Synthetic A'],['Synthetic B']]));
  table(convert,'Convert',0,['From Unit','To Unit','Conversion Factor'],[['tbsp','tsp','3']]);
  table(meals,'Meals',0,['Meal','isMeal'],[['Original invented meal','TRUE'],['','FALSE']]);
  const original='=FILTER(Meals[Meal],Meals[isMeal]=TRUE)';
  setInput(b,derived,derived.rows[0].id,derived.columns[0].id,original);
  b.names.push({id:uid(),name:'MealDD',context:derived.id,original,formula:compile(original,b,derived.id,derived.rows[0].id,derived.columns[0].id)},{id:uid(),name:'MealDD',sheet:meals.id,context:meals.id,original,formula:compile(original,b,meals.id,meals.rows[0].id,meals.columns[0].id)});
  return b;
}
it('imports auxiliary records only, hides supporting presentation, preserves missing original Meals rather than relinking demo, and is idempotent',()=>{
  const before=createDemo(),original=clone(before),incoming=source(),merged=mergeReferences(before,incoming,'invented-original'),b=merged.book;
  expect(before).toEqual(original);expect(merged.counts.map(t=>t.rows)).toEqual([2,2,2,2,2,2,2,1]);expect(merged.derivedUnavailable).toBe(true);
  expect(b.sheets.find(s=>s.id===before.sheets[1].id)).toEqual(before.sheets[1]);
  expect(b.sheets.filter(s=>s.supporting).map(s=>s.name)).toEqual(['Dropdowns','Convert','MealDD','Lists']);
  const derived=b.references!.find(s=>s.kind==='derived')!;expect(()=>referenceChoices(b,derived)).toThrow('Original derived source unavailable');
  expect(derived.deferredNames).toHaveLength(1);expect(b.tables.filter(t=>t.name==='Meals')).toHaveLength(1);
  expect(mergeReferences(b,source(),'invented-original',true)).toMatchObject({changed:false});
  validateBook(JSON.parse(JSON.stringify(b)));
  const named=compile('=MealDD',b,b.sheets[0].id,b.sheets[0].rows[2].id,b.sheets[0].columns[0].id);
  expect(validationReference(b,named,b.sheets[0].id)?.id).toBe(derived.id);
  const table=b.tables.find(t=>t.name==='Meals')!;
  setDerivedSource(b,derived,table.id,table.columns[0].id);
  expect(referenceChoices(b,derived).map(o=>o.value)).toEqual(['Example breakfast']);
});
it('keeps linked options distinct through duplicate labels, rename, reorder and archive; manual text stays manual',()=>{
  const b=createDemo(),ref=createReference(b,'Types'),a=addReferenceValue(b,ref,'Same label'),c=addReferenceValue(b,ref,'Same label'),log=b.sheets[0],r=log.rows[2].id,col=log.columns[1].id;
  const choice=referenceChoices(b,ref).find(o=>o.row===c)!;log.cells[key(r,col)]={binding:choice.binding};setInput(b,log,log.rows[3].id,col,'Same label');
  renameReferenceValue(b,ref,c,'Renamed');moveReferenceValue(b,ref,c,-1);
  expect(new Engine(b).cell(log.id,r,col)).toBe('Renamed');expect(new Engine(b).cell(log.id,log.rows[3].id,col)).toBe('Same label');expect(referenceChoices(b,ref)[0].row).toBe(c);
  ref.archivedRows.push(c);expect(referenceChoices(b,ref).map(o=>o.row)).toEqual([a]);expect(new Engine(b).cell(log.id,r,col)).toBe('Renamed');
  expect(()=>removeReferenceValue(b,ref,c)).toThrow('linked');
  removeReferenceValue(b,ref,c,a);expect(new Engine(b).cell(log.id,r,col)).toBe('Same label');
});
it('shares unit identities with conversion rules and requires an explicit impact confirmation for factor changes',()=>{
  const b=mergeReferences(createDemo(),source(),'invented-original').book,units=unitsSource(b),rule=b.references!.find(s=>s.kind==='conversions')!,choices=referenceChoices(b,units),from=choices.find(o=>o.value==='tbsp')!,to=choices.find(o=>o.value==='tsp')!,{table,sheet}=referenceTable(b,rule),row=table.rows[0];
  renameReferenceValue(b,units,from.row,'Spoon');
  expect(new Engine(b).cell(sheet.id,row,table.columns[0].column)).toBe('Spoon');
  const notes=b.sheets[3];setInput(b,notes,notes.rows[1].id,notes.columns[1].id,'=SUM(Convert[Conversion Factor])');
  expect(referenceUsages(b,rule).formulas).toBeGreaterThan(0);const before=clone(b);
  expect(()=>upsertConversion(b,rule,row,from.row,to.row,'6')).toThrow('Confirm conversion change');expect(b).toEqual(before);
  upsertConversion(b,rule,row,from.row,to.row,'6',true);expect(new Engine(b).cell(notes.id,notes.rows[1].id,notes.columns[1].id)).toBe(6);
  units.archivedRows.push(from.row);expect(referenceChoices(b,units).some(o=>o.row===from.row)).toBe(false);expect(new Engine(b).cell(sheet.id,row,table.columns[0].column)).toBe('Spoon');
});
it('refuses colliding sources without changing a workbook or guessing option identities',()=>{
  const b=createDemo(),ref=createReference(b,'IngredientType');addReferenceValue(b,ref,'Synthetic A');
  const{table}=referenceTable(b,ref);table.name='IngredientType';
  const before=clone(b);expect(()=>mergeReferences(b,source(),'another-original')).toThrow('already exists');expect(b).toEqual(before);
});
it('reuses verified legacy Ingredients dependencies without replacing formats, but rejects real value or format edits',()=>{
  const incoming=source(),original=incoming.tables.find(t=>t.name==='IngredientType')!,raw=incoming.sheets.find(s=>s.id===original.sheet)!;
  for(const row of[original.header,...original.rows])raw.cells[key(row,original.columns[0].column)].format={number:'general',excelNumberFormat:'@'};
  const b=createDemo(),legacy=clone(raw),owned=new Set([original.header,...original.rows]);
  legacy.cells=Object.fromEntries(Object.entries(legacy.cells).filter(([k])=>owned.has(k.split(':')[0])));
  for(const cell of Object.values(legacy.cells))delete cell.format!.excelNumberFormat;
  b.sheets.push(legacy);b.tables.push(clone(original));b.importReport={originalId:'legacy-original',entries:[],formulaCount:0,unsupported:{}};
  const result=mergeReferences(b,incoming,'legacy-original',true);
  expect(result.book.tables.find(t=>t.name==='IngredientType')!.id).toBe(original.id);
  expect(result.book.sheets.find(s=>s.id===legacy.id)!.cells).toMatchObject(legacy.cells);
  const changed=clone(b);changed.sheets.at(-1)!.cells[key(original.rows[0],original.columns[0].column)].value='Actual local edit';
  expect(()=>mergeReferences(changed,incoming,'legacy-original',true)).toThrow('not overwritten');
  const formatted=clone(b);formatted.sheets.at(-1)!.cells[key(original.rows[0],original.columns[0].column)].format!.number='percent';
  expect(()=>mergeReferences(formatted,incoming,'legacy-original',true)).toThrow('not overwritten');
});
it('persists authored factor formula changes even when their current result is equal, and refuses nonformula expressions',()=>{
  const b=mergeReferences(createDemo(),source(),'invented-original').book,units=unitsSource(b),rule=b.references!.find(s=>s.kind==='conversions')!,choices=referenceChoices(b,units),{table,sheet}=referenceTable(b,rule),row=table.rows[0],from=choices.find(o=>o.value==='tbsp')!,to=choices.find(o=>o.value==='tsp')!,factor=table.columns[2].column;
  upsertConversion(b,rule,row,from.row,to.row,'=1+2',true);expect(new Engine(b).cell(sheet.id,row,factor)).toBe(3);
  upsertConversion(b,rule,row,from.row,to.row,'3',true);expect(sheet.cells[key(row,factor)].formula).toBeUndefined();expect(sheet.cells[key(row,factor)].value).toBe(3);
  expect(()=>upsertConversion(b,rule,row,from.row,to.row,'1+2',true)).toThrow('start a formula');
  const derived=createReference(b,'Live test','derived'),nameId=derived.nameId!;
  b.names=b.names.filter(n=>n.id!==nameId);
  expect(()=>validationReference(b,{kind:'name',id:nameId},sheet.id)).toThrow('#REF!');
});
