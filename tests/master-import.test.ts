import {describe,expect,it} from 'vitest';
import {compile,Engine} from '../src/formula';
import {allTables,blankSheet,clone,createDemo,key,mapAst,renameColumn,uid,type ReferenceSource,type Table,type Workbook} from '../src/model';
import {masterNutritionStatus,stageMasterImport,type MasterImportReview} from '../src/master-import';
import {referenceFormula,validationChoiceGroups} from '../src/references';
import {applyUndo,structuralUndo} from '../src/undo-history';

function destination(){
  const book=createDemo(),ingredients=book.tables.find(table=>table.name==='Ingredients')!,meals=book.tables.find(table=>table.name==='Meals')!;
  const sheet=book.sheets.find(sheet=>sheet.id===meals.sheet)!,field={id:uid(),name:'isMeal',column:sheet.columns[5].id};
  meals.columns.push(field);
  for(const row of meals.rows)sheet.cells[key(row,field.column)]={value:row===meals.rows[0]};
  const ingredient:ReferenceSource={id:uid(),name:'Ingredients',kind:'list',table:ingredients.id,column:ingredients.columns[0].id,archivedRows:[]};
  const meal:ReferenceSource={id:uid(),name:'MealDD',kind:'derived',archivedRows:[],nameId:uid(),derived:{table:meals.id,column:meals.columns[0].id,filter:{column:field.id,value:true}}};
  book.names.push({id:meal.nameId!,name:'MealDD',context:sheet.id,original:'=FILTER(Meals[Meal],Meals[isMeal]=TRUE)',formula:compile('=FILTER(Meals[Meal],Meals[isMeal]=TRUE)',book,sheet.id,meals.rows[0],meals.columns[0].column)});
  book.references=[ingredient,meal];
  return{book,ingredients,meals,ingredient,meal};
}
function incoming(){
  const {book}=destination(),sheet=blankSheet('Master',12,15),headers=['Date','Weight','Calories','Fat (g)','Carbs (g)','Sugar (g)','Protein (g)','Sodium (mg)','Food','Amount (g)','Amount','Unit','Exercise','Period','isDay'];
  const table:Table={id:uid(),name:'Master',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1,4).map(row=>row.id),columns:headers.map((name,i)=>({id:uid(),name,column:sheet.columns[i].id}))};
  book.sheets.push(sheet);book.tables.push(table);
  headers.forEach((value,i)=>sheet.cells[key(table.header,sheet.columns[i].id)]={value});
  for(let i=2;i<=7;i++){
    table.columns[i].formulaDefault=i===2?'=XLOOKUP([@Food],Ingredients[Ingredient],Ingredients[Calories (kcal)],0)':'=0';
    for(const row of table.rows)sheet.cells[key(row,sheet.columns[i].id)]={formula:compile(table.columns[i].formulaDefault!,book,sheet.id,row,sheet.columns[i].id)};
  }
  for(const [i,text]of ['Example oats','Example breakfast','Unmatched synthetic food'].entries())sheet.cells[key(table.rows[i],sheet.columns[8].id)]={value:text,format:{wrap:false}};
  sheet.cells[key(table.rows[0],sheet.columns[2].id)]={formula:compile('=XLOOKUP([@Food],Ingredients[Ingredient],Ingredients[Calories (kcal)],0)',book,sheet.id,table.rows[0],sheet.columns[2].id),original:'=XLOOKUP([@Food],Ingredients[Ingredient],Ingredients[Calories (kcal)],0)'};
  sheet.cells[key(table.rows[1],sheet.columns[2].id)]={value:717,note:'Synthetic manual override'};
  sheet.cells[key(table.rows[0],sheet.columns[1].id)]={value:'(Tues)',format:{wrap:false}};
  sheet.groups.push({id:uid(),axis:'row',members:table.rows,collapsed:true,label:'Original outline'});
  const ingredients=book.references![0],meal=book.references![1];
  sheet.validations.push(...[ingredients,meal].map(reference=>({id:uid(),sheet:sheet.id,rows:table.rows,columns:[sheet.columns[8].id],source:JSON.stringify(referenceFormula(reference))})));
  sheet.validations.push({id:uid(),sheet:sheet.id,rows:table.rows,columns:[sheet.columns[13].id],source:'"Manual,Period"',values:['Manual','Period']});
  return {book,sheet,table};
}

describe('staged Master import',()=>{
  it('links unique actual record identities and preserves manual nutrition, text markers, layout, formulas and both DD sources without changing the inputs',()=>{
    const {book:current,ingredients}=destination(),source=incoming(),before=clone(current),original=clone(source.book),stage=stageMasterImport(current,source.book);
    expect(stage.conflicts).toEqual([]);expect(stage.summary).toEqual({unique:1,reviewed:0,manual:2,ambiguous:0,sourceReview:0,formulaInputs:0});
    const prepared=stage.prepared!,sheet=prepared.book.sheets.at(-1)!;
    expect(sheet.cells[key(source.table.rows[0],source.sheet.columns[8].id)].binding?.row).toBe(ingredients.rows[0]);
    expect(sheet.cells[key(source.table.rows[1],source.sheet.columns[8].id)].binding).toBeUndefined();
    expect(sheet.cells[key(source.table.rows[1],source.sheet.columns[8].id)].value).toBe('Example breakfast');
    expect(sheet.cells[key(source.table.rows[2],source.sheet.columns[8].id)].value).toBe('Unmatched synthetic food');
    expect(sheet.cells[key(source.table.rows[1],source.sheet.columns[2].id)]).toEqual({value:717,note:'Synthetic manual override'});
    expect(sheet.rows).toEqual(source.sheet.rows);expect(sheet.groups).toEqual(source.sheet.groups);
    expect(sheet.cells[key(source.table.rows[0],source.sheet.columns[1].id)].value).toBe('(Tues)');
    expect(sheet.validations.find(rule=>rule.values)?.values).toEqual(['Manual','Period']);
    const foodRule=sheet.validations.find(rule=>rule.columns.includes(source.sheet.columns[8].id))!;
    expect(validationChoiceGroups(prepared.book,foodRule,source.table.rows[0],source.sheet.columns[8].id,new Engine(prepared.book))).toHaveLength(2);
    expect(new Engine(prepared.book).cell(sheet.id,source.table.rows[0],source.sheet.columns[2].id)).toBe(150);
    renameColumn(prepared.book,prepared.book.tables.find(table=>table.id===ingredients.id)!,ingredients.columns[2].id,'Renamed calories');
    expect(new Engine(prepared.book).cell(sheet.id,source.table.rows[0],source.sheet.columns[2].id)).toBe(150);
    expect(current).toEqual(before);expect(source.book).toEqual(original);
  });
  it('stops for duplicates within and across DDs, and records every affected Food row instead of choosing precedence',()=>{
    const {book,ingredients,meals}=destination(),source=incoming(),ingredientSheet=book.sheets.find(sheet=>sheet.id===ingredients.sheet)!,mealSheet=book.sheets.find(sheet=>sheet.id===meals.sheet)!;
    ingredientSheet.cells[key(ingredients.rows[1],ingredients.columns[0].column)]={value:'EXAMPLE OATS'};
    mealSheet.cells[key(meals.rows[0],meals.columns[0].column)]={value:'Example oats'};
    source.sheet.cells[key(source.table.rows[1],source.sheet.columns[8].id)]={value:'example oats'};
    const stage=stageMasterImport(book,source.book),conflict=stage.conflicts.find(conflict=>conflict.kind==='food')!;
    expect(stage.prepared).toBeUndefined();expect(conflict.candidates).toHaveLength(3);expect(conflict.locations).toEqual(['I2','I3']);
    expect(stage.summary.ambiguous).toBe(2);
  });
  it('uses separate reviewed duplicate records in XLOOKUP, MATCH, XMATCH and LET, retaining manual overrides through row moves and column renames',()=>{
    const {book,ingredients,ingredient}=destination(),source=incoming(),owner=book.sheets.find(s=>s.id===ingredients.sheet)!;
    owner.cells[key(ingredients.rows[1],ingredients.columns[0].column)]={value:'EXAMPLE OATS'};
    source.sheet.cells[key(source.table.rows[1],source.sheet.columns[8].id)]={value:'Example oats'};
    const review:MasterImportReview={destination:{id:book.id,revision:book.revision},food:{
      I2:{text:'Example oats',record:{source:ingredient.id,table:ingredients.id,row:ingredients.rows[1],column:ingredients.columns[0].id}},
      I3:{text:'Example oats',record:{source:ingredient.id,table:ingredients.id,row:ingredients.rows[0],column:ingredients.columns[0].id}}
    }};
    const before=clone(book),stage=stageMasterImport(book,source.book,review),prepared=stage.prepared!,sheet=prepared.book.sheets.at(-1)!,row=source.table.rows[0],column=source.sheet.columns[2].id,engine=new Engine(prepared.book);
    expect(stage.conflicts).toEqual([]);expect(stage.summary.reviewed).toBe(2);expect(stage.summary.ambiguous).toBe(0);
    const evaluate=(formula:string,r=row)=>engine.evaluate(compile(formula,prepared.book,sheet.id,r,column),sheet.id,r,column);
    expect(engine.cell(sheet.id,row,column)).toBe(116);
    expect(evaluate('=INDEX(Ingredients[Calories (kcal)],MATCH([@Food],Ingredients[Ingredient],0))')).toBe(116);
    expect(evaluate('=LET(chosen,[@Food],XLOOKUP(chosen,Ingredients[Ingredient],Ingredients[Calories (kcal)]))')).toBe(116);
    expect(evaluate('=XMATCH([@Food],Ingredients[Ingredient],0,-1)',source.table.rows[1])).toBe(1);
    expect(sheet.cells[key(source.table.rows[1],column)]).toEqual({value:717,note:'Synthetic manual override'});
    const target=prepared.book.tables.find(t=>t.id===ingredients.id)!,first=target.rows[0],second=target.rows[1],targetSheet=prepared.book.sheets.find(s=>s.id===target.sheet)!;
    renameColumn(prepared.book,target,target.columns[2].id,'Renamed calories');
    [target.rows[0],target.rows[1]]=[second,first];
    const a=targetSheet.rows.findIndex(r=>r.id===first),b=targetSheet.rows.findIndex(r=>r.id===second);
    [targetSheet.rows[a],targetSheet.rows[b]]=[targetSheet.rows[b],targetSheet.rows[a]];
    targetSheet.columns.reverse();
    expect(new Engine(prepared.book).cell(sheet.id,row,column)).toBe(116);
    expect(book).toEqual(before);
  });
  it('respects a selected Meals record over an identical Ingredients label without changing ordinary unbound or unrelated-table value lookups',()=>{
    const {book,meals,meal}=destination(),source=incoming(),owner=book.sheets.find(s=>s.id===meals.sheet)!,calories=meals.columns.find(c=>c.name.toLowerCase().startsWith('calories'))!;
    owner.cells[key(meals.rows[0],meals.columns[0].column)]={value:'Example oats'};
    owner.cells[key(meals.rows[0],calories.column)]={value:888};
    const formula=`=LET(chosen,[@Food],IFERROR(XLOOKUP(chosen,Ingredients[Ingredient],Ingredients[Calories (kcal)]),XLOOKUP(chosen,Meals[Meal],Meals[${calories.name}])))`;
    source.table.columns[2].formulaDefault=formula;
    source.sheet.cells[key(source.table.rows[0],source.sheet.columns[2].id)]={formula:compile(formula,source.book,source.sheet.id,source.table.rows[0],source.sheet.columns[2].id)};
    const stage=stageMasterImport(book,source.book,{destination:{id:book.id,revision:book.revision},food:{I2:{text:'Example oats',record:{source:meal.id,table:meals.id,row:meals.rows[0],column:meals.columns[0].id}}}}),prepared=stage.prepared!,sheet=prepared.book.sheets.at(-1)!,row=source.table.rows[0],column=source.sheet.columns[2].id;
    expect(stage.conflicts).toEqual([]);expect(new Engine(prepared.book).cell(sheet.id,row,column)).toBe(888);
    const other=blankSheet('Other values',3,2),table:Table={id:uid(),name:'OtherValues',sheet:other.id,header:other.rows[0].id,rows:[other.rows[1].id],columns:other.columns.map((c,i)=>({id:uid(),name:i?'Factor':'Label',column:c.id}))};
    other.cells[key(table.header,other.columns[0].id)]={value:'Label'};other.cells[key(table.header,other.columns[1].id)]={value:'Factor'};
    other.cells[key(table.rows[0],other.columns[0].id)]={value:'Example oats'};other.cells[key(table.rows[0],other.columns[1].id)]={value:42};
    prepared.book.sheets.push(other);prepared.book.tables.push(table);
    const engine=new Engine(prepared.book);
    expect(engine.evaluate(compile('=XLOOKUP([@Food],OtherValues[Label],OtherValues[Factor])',prepared.book,sheet.id,row,column),sheet.id,row,column)).toBe(42);
    const manual=clone(prepared.book),foodCell=manual.sheets.find(s=>s.id===sheet.id)!.cells[key(row,source.sheet.columns[8].id)];
    delete foodCell.binding;foodCell.value='Example oats';
    expect(new Engine(manual).cell(sheet.id,row,column)).toBe(150);
  });
  it('rejects incomplete, stale and mismatched reviewed choices and never replaces an explicit Custom selection',()=>{
    const {book,ingredients,ingredient}=destination(),source=incoming(),owner=book.sheets.find(s=>s.id===ingredients.sheet)!;
    owner.cells[key(ingredients.rows[1],ingredients.columns[0].column)]={value:'Example oats'};
    source.sheet.cells[key(source.table.rows[1],source.sheet.columns[8].id)]={value:'Example oats'};
    const choice={text:'Example oats',record:{source:ingredient.id,table:ingredients.id,row:ingredients.rows[1],column:ingredients.columns[0].id}},review:MasterImportReview={destination:{id:book.id,revision:book.revision},food:{I2:choice}};
    expect(stageMasterImport(book,source.book,review).prepared).toBeUndefined();
    review.food.I3=clone(choice);
    expect(stageMasterImport(book,source.book,{...review,destination:{...review.destination,revision:book.revision+1}}).prepared).toBeUndefined();
    for(const changed of [{...choice,text:'Different Food'},{...choice,record:{...choice.record,row:uid()}}])
      expect(stageMasterImport(book,source.book,{...review,food:{...review.food,I2:changed}}).prepared).toBeUndefined();
    source.sheet.cells[key(source.table.rows[1],source.sheet.columns[8].id)].calculation={kind:'literal',value:'Custom'};
    expect(stageMasterImport(book,source.book,review).prepared).toBeUndefined();
    expect(source.sheet.cells[key(source.table.rows[1],source.sheet.columns[8].id)].value).toBe('Example oats');
    expect(stageMasterImport(book,source.book,{...review,food:{...review.food,I999:choice}}).prepared).toBeUndefined();
  });
  it('stages the explicitly reviewed existing Meal DD repair atomically with Master, preserves IDs and undo, and blocks changed repair impact',()=>{
    const {book,meal,meals}=destination(),source=incoming(),old=uid();
    meal.derived!.table=old;
    const named=book.names.find(n=>n.id===meal.nameId)!;
    named.formula=mapAst(named.formula,n=>n.kind==='structured'?{...n,table:old}:n);
    meal.anchor={sheet:uid(),row:uid(),column:uid()};
    const before=clone(book),review:MasterImportReview={destination:{id:book.id,revision:book.revision},food:{},mealDD:{source:meal.id,nameId:meal.nameId!,oldTable:old,table:meals.id,sheet:meals.sheet,column:meals.columns[0].id,filterColumn:meal.derived!.filter!.column,filterValue:true}};
    const stage=stageMasterImport(book,source.book,review),after=stage.prepared!.book,reference=after.references!.find(r=>r.id===meal.id)!;
    expect(stage.conflicts).toEqual([]);expect(reference.nameId).toBe(meal.nameId);expect(reference.derived!.table).toBe(meals.id);expect(reference.anchor).toBeUndefined();
    expect(after.names.find(n=>n.id===meal.nameId)!.context).toBe(meals.sheet);
    expect(applyUndo(after,structuralUndo(book,after)).book).toEqual(before);expect(book).toEqual(before);
    const unrelated=book.sheets.find(s=>s.name==='Notebook')!;
    unrelated.cells[key(unrelated.rows[0].id,unrelated.columns[0].id)]={binding:{table:old,row:uid(),column:meal.derived!.column}};
    expect(stageMasterImport(book,source.book,review).prepared).toBeUndefined();
  });
  it('treats a broken MealDD identity as review-only and never auto-links a proposed live Meals table or a seemingly unique ingredient',()=>{
    const {book,meal}=destination(),source=incoming();meal.derived!.table=uid();
    const stage=stageMasterImport(book,source.book);
    expect(stage.prepared).toBeUndefined();expect(stage.conflicts.find(conflict=>conflict.id==='source:meals')?.candidates).toHaveLength(1);
    expect(stage.food.find(match=>match.text==='Example breakfast')?.choices[0].proposed).toBe(true);
    expect(stage.summary.unique).toBe(0);expect(stage.summary.sourceReview).toBe(1);
    expect(meal.derived!.table).not.toBe(allTables(book).find(table=>table.name==='Meals')!.id);
  });
  it.each([2,3,4,5,6,7])('keeps a unique Food manual when nutrient field %i contains an override, even zero or an equal cached result',index=>{
    const {book}=destination(),source=incoming(),row=source.table.rows[0];
    source.sheet.cells[key(row,source.sheet.columns[index].id)]={value:0};
    const stage=stageMasterImport(book,source.book);
    expect(stage.prepared!.book.sheets.at(-1)!.cells[key(row,source.sheet.columns[8].id)].binding).toBeUndefined();
    expect(stage.food[0].rows[0].nutrition.status).toBe('override');
  });
  it('distinguishes cached default formulas, changed formulas, explicit clearing and uncertain provenance without evaluating nutrient equality',()=>{
    const source=incoming(),row=source.table.rows[0],field=source.table.columns[3];
    source.sheet.cells[key(row,field.column)].value=999;
    expect(masterNutritionStatus(source.book,source.table,row).status).toBe('none');
    source.sheet.cells[key(row,field.column)]={formula:compile('=1-1',source.book,source.sheet.id,row,field.column)};
    expect(masterNutritionStatus(source.book,source.table,row).overrides).toContain('Fat');
    source.sheet.cells[key(row,field.column)]={value:null,calculation:compile('=0',source.book,source.sheet.id,row,field.column)};
    expect(masterNutritionStatus(source.book,source.table,row).overrides).toContain('Fat');
    source.sheet.cells[key(row,field.column)]={value:null};
    const stage=stageMasterImport(destination().book,source.book);
    expect(stage.prepared).toBeUndefined();expect(stage.conflicts.some(c=>c.kind==='nutrition')).toBe(true);
    expect(stage.food[0].rows[0].linkPolicy).toBe('needs-review');
  });
  it('refuses stale named DD formulas and does not treat an alternative live DD as proof of a broken MealDD identity',()=>{
    const {book,meal}=destination(),source=incoming();
    book.names.find(named=>named.id===meal.nameId)!.formula={kind:'literal',value:'Unrelated static label'};
    expect(stageMasterImport(book,source.book).conflicts.some(conflict=>conflict.kind==='identity')).toBe(true);
    const alternate=clone(meal);alternate.id=uid();alternate.name='Another Meals DD';
    book.names.find(named=>named.id===meal.nameId)!.formula=compile('=FILTER(Meals[Meal],Meals[isMeal]=TRUE)',book,book.sheets[0].id,book.sheets[0].rows[0].id,book.sheets[0].columns[0].id);
    book.references!.push(alternate);meal.derived!.table=uid();
    const stage=stageMasterImport(book,source.book);
    expect(stage.conflicts.some(conflict=>conflict.id==='source:meals')).toBe(true);expect(stage.prepared).toBeUndefined();
  });
  it('retains existing explicitly Custom cells and formula Food inputs and makes an append-only import undoable',()=>{
    const {book}=destination(),source=incoming(),customSheet=book.sheets.find(sheet=>sheet.name==='Notebook')!;
    const customKey=key(customSheet.rows[2].id,customSheet.columns[2].id);
    customSheet.cells[customKey]={value:'Example oats'};
    source.sheet.cells[key(source.table.rows[2],source.sheet.columns[8].id)]={formula:compile('="Formula Food"',source.book,source.sheet.id,source.table.rows[2],source.sheet.columns[8].id)};
    const stage=stageMasterImport(book,source.book),after=stage.prepared!.book;
    expect(stage.summary.formulaInputs).toBe(1);expect(after.sheets.find(sheet=>sheet.id===customSheet.id)!.cells[customKey]).toEqual({value:'Example oats'});
    const restored=applyUndo(after,structuralUndo(book,after)).book;
    expect(restored).toEqual(book);
  });
  it('blocks missing fields, external cell references, unsupported formulas, unknown Food sources and duplicate import instead of dropping or freezing them',()=>{
    const {book}=destination(),source=incoming(),notebook=source.book.sheets.find(sheet=>sheet.name==='Notebook')!;
    const cell=(index:number,formula:string)=>source.sheet.cells[key(source.table.rows[index],source.sheet.columns[3].id)]={formula:compile(formula,source.book,source.sheet.id,source.table.rows[index],source.sheet.columns[3].id),original:formula};
    cell(0,'=Notebook!A1');cell(1,'=UNSUPPORTED_FN(1)');
    source.sheet.validations.push({id:uid(),sheet:source.sheet.id,rows:source.table.rows,columns:[source.sheet.columns[8].id],source:JSON.stringify({kind:'ref',sheet:notebook.id,row:notebook.rows[0].id,column:notebook.columns[0].id})});
    book.tables.find(table=>table.name==='Ingredients')!.columns[2].name='Changed without mapping';
    const stage=stageMasterImport(book,source.book);
    expect(stage.prepared).toBeUndefined();expect(new Set(stage.conflicts.map(conflict=>conflict.kind))).toEqual(new Set(['dependency','formula','validation']));
    const collision=stageMasterImport(source.book,source.book);
    expect(collision.conflicts.some(conflict=>conflict.kind==='collision')).toBe(true);expect(collision.prepared).toBeUndefined();
  });
});
