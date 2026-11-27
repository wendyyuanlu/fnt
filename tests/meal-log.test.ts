import {expect,it} from 'vitest';
import {addMasterFood,masterLogging,masterDayBlocks} from '../src/day-logging';
import {Engine,scalar} from '../src/formula';
import {addMealIngredient,editMealDayWeight,markMealNeedsNutrition,mealNeedsNutrition,mealLogConfig,mealLogContext,moveMealFood,refreshMealIngredientCalculations} from '../src/meal-log';
import {addTableColumns,blankSheet,clone,createDemo,getCell,moveColumns,renameColumn,setInput} from '../src/model';
import {applyUndo,structuralUndo} from '../src/undo-history';
import {validationChoiceGroups} from '../src/references';
import {validateBook} from '../src/storage';
import {defaultHeaderFormula} from '../src/meal-block';
import {writeIngredientValues} from '../src/ingredient-edit';

function fixture(){
  const book=createDemo(),sheet=blankSheet('Master',7,13);
  const ingredients=book.tables.find(table=>table.name==='Ingredients')!,source=book.sheets.find(sheet=>sheet.id===ingredients.sheet)!;
  renameColumn(book,ingredients,ingredients.columns[0].id,'Ingredients');
  const extra=source.columns.slice(6,11);
  ['Conversion Amount','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)'].forEach((name,i)=>setInput(book,source,ingredients.header,extra[i].id,name));
  addTableColumns(book,source,ingredients,extra.map(column=>column.id));
  book.sheets.push(sheet);
  const table={id:'master-log',name:'Master',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1,6).map(row=>row.id),
    columns:['Date','Weight','isDay','Food','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Amount (g)','Amount','Unit'].map((name,i)=>({id:'log-field-'+i,column:sheet.columns[i].id,name}))};
  book.tables.push(table);
  const input=(r:number,c:number,value:string)=>setInput(book,sheet,sheet.rows[r].id,sheet.columns[c].id,value);
  table.columns.forEach((field,i)=>input(0,i,field.name));
  for(let r=1;r<6;r++)input(r,2,'=[@Weight]<>""');
  for(const r of [1,4]){input(r,1,'x');input(r,0,`=DATE(2026,11,${r===1?20:21})`);for(let c=4;c<10;c++)input(r,c,defaultHeaderFormula(book,table,table.columns[c].id));}
  for(const r of [2,3,5]){input(r,3,'Synthetic food '+r);input(r,4,'100');input(r,5,'20');}
  sheet.dayLogging=masterLogging(book,sheet).config;sheet.mealLog=mealLogConfig(book,sheet);
  return{book,sheet,table,input};
}
it('inserts directly below a food and creates the owning summary without changing other days or totals',()=>{
  const {book,sheet,table}=fixture(),header=sheet.rows[1].id,original=sheet.rows[2].id,last=sheet.rows[3].id,other=sheet.rows[4].id;
  const added=addMasterFood(book,sheet,original,{after:original});
  expect(masterDayBlocks(book,sheet)[0].rows).toEqual([header,original,added,last]);
  const group=sheet.groups.find(group=>group.kind==='summary'&&group.members[0]===header)!;
  expect(group.members).toEqual([header,original,added,last]);expect(group.members).not.toContain(other);
  setInput(book,sheet,added,table.columns[4].column,'30');
  expect(scalar(new Engine(book).cell(sheet.id,header,table.columns[4].column))).toBe(230);
  validateBook(book);
});
it('retains live field identities and formulas after column moves and names change',()=>{
  const {book,sheet,table}=fixture(),food=sheet.rows[2].id,header=sheet.rows[1].id;
  for(const column of table.columns)renameColumn(book,table,column.id,'Renamed '+column.id);
  moveColumns(book,sheet,[table.columns[4].column],0);
  const fields=mealLogContext(book,sheet).fields;
  expect(fields.get('calories')!.id).toBe('log-field-4');
  setInput(book,sheet,food,fields.get('calories')!.column,'321');
  expect(scalar(new Engine(book).cell(sheet.id,header,fields.get('calories')!.column))).toBe(421);
  validateBook(book);
});
it('keeps day boundaries, groups, formulas and cursor intact through blank, zero and decimal Weight edits after a column rename and move',()=>{
  const {book,sheet,table}=fixture(),header=sheet.rows[4].id,weight=table.columns[1];
  sheet.groups=masterDayBlocks(book,sheet).map(block=>({id:'day-'+block.header,axis:'row',kind:'summary',members:block.rows,collapsed:false,label:'Synthetic day'}));
  renameColumn(book,table,weight.id,'Measured weight');moveColumns(book,sheet,[weight.column],0);
  const expected=clone(book),blocks=masterDayBlocks(book,sheet),engine=new Engine(book),address=`${header}:${weight.column}`;
  for(const [value,result] of [['','x'],[' ','x'],['0',0],['68.25',68.25],['','x'],['(Tues)','(Tues)']] as const){
    editMealDayWeight(book,sheet,header,value,engine);
    expect(getCell(sheet,header,weight.column).value).toBe(result);
    expected.sheets.find(source=>source.id===sheet.id)!.cells[address]=clone(getCell(sheet,header,weight.column));
    expect(book).toEqual(expected);expect(masterDayBlocks(book,sheet,engine)).toEqual(blocks);validateBook(book);
  }
});
it('rejects missing, food and demoted day targets without writing Weight or changing day membership',()=>{
  const {book,sheet,input}=fixture(),header=sheet.rows[4].id;
  input(4,1,'');
  for(const row of ['missing-row',sheet.rows[2].id,header]){
    const before=clone(book);
    expect(()=>editMealDayWeight(book,sheet,row,'68.25')).toThrow('day header changed');
    expect(book).toEqual(before);
  }
});
it('rolls back empty literals and invalid Weight formulas without poisoning day calculations, while allowing valid formulas',()=>{
  const {book,sheet,table}=fixture(),header=sheet.rows[4].id,engine=new Engine(book),blocks=masterDayBlocks(book,sheet,engine);
  for(const value of ["'",'=""','=NA()','=']){
    const before=clone(book);
    expect(()=>editMealDayWeight(book,sheet,header,value,engine)).toThrow();
    expect(book).toEqual(before);expect(masterDayBlocks(book,sheet,engine)).toEqual(blocks);
  }
  editMealDayWeight(book,sheet,header,'=60+8',engine);
  expect(scalar(engine.cell(sheet.id,header,table.columns[1].column))).toBe(68);
  expect(masterDayBlocks(book,sheet,engine)).toEqual(blocks);validateBook(book);
});
it('fills blank linked nutrition including zero and retargets only its own calculations when Food changes',()=>{
  const {book,sheet,input}=fixture(),row=sheet.rows[3].id;
  for(let column=4;column<10;column++){input(2,column,'0');input(3,column,'');}
  input(2,10,'25');input(2,11,'1');input(2,12,'each');
  const first=addMealIngredient(book,sheet,sheet.rows[2].id);
  for(const [index,value]of [70,1,2,12,6,10].entries())input(5,index+4,String(value));
  input(5,10,'25');input(5,11,'1');input(5,12,'each');
  const second=addMealIngredient(book,sheet,sheet.rows[5].id);
  const context=mealLogContext(book,sheet),food=context.fields.get('food')!.column;
  const label=book.tables.find(table=>table.id===first.table)!.columns.find(column=>column.name==='Ingredients')!.id;
  input(3,11,'2');input(3,12,'each');
  sheet.cells[`${row}:${food}`]={binding:{...first,column:label}};
  refreshMealIngredientCalculations(book,sheet,row,context);
  const read=()=>[4,5,6,7,8,9].map(column=>scalar(new Engine(book).cell(sheet.id,row,sheet.columns[column].id)));
  expect(read()).toEqual([0,0,0,0,0,0]);
  const protein=`${row}:${context.fields.get('protein')!.column}`,retained=sheet.cells[protein].formula!;
  sheet.cells[protein]={value:999,calculation:retained};
  input(3,7,'=11');
  const custom=getCell(sheet,row,context.fields.get('carbs')!.column).formula;
  sheet.cells[`${row}:${food}`]={binding:{...second,column:label}};
  refreshMealIngredientCalculations(book,sheet,row,context);
  expect(read()).toEqual([140,999,4,11,12,20]);
  expect(sheet.cells[protein].calculation).not.toEqual(retained);
  expect(getCell(sheet,row,context.fields.get('carbs')!.column).formula).toEqual(custom);
  expect(getCell(sheet,row,context.fields.get('amount')!.column).value).toBe(2);
  expect(getCell(sheet,row,context.fields.get('unit')!.column).value).toBe('each');
  validateBook(book);
});
it('copies manual nutrition to Ingredients, links the Food cell, and reverses the whole action with Undo',()=>{
  const {book,sheet,input}=fixture();input(2,10,'300');
  const row=sheet.rows[2].id,before=clone(book),food=mealLogContext(book,sheet).fields.get('food')!,added=addMealIngredient(book,sheet,row),target=book.tables.find(table=>table.id===added.table)!,destination=book.sheets.find(sheet=>sheet.id===target.sheet)!;
  const read=(name:string)=>scalar(new Engine(book).cell(destination.id,added.row,target.columns.find(field=>field.name===name)!.column));
  expect(read('Serving (g)')).toBe(300);expect(read('Conversion Amount')).toBe(300);expect(read('Conversion Unit')).toBe('g');
  expect(read('Calories (kcal)')).toBe(100);expect(read('Protein (g)')).toBe(20);
  for(const [address,cell]of Object.entries(before.sheets.find(source=>source.id===sheet.id)!.cells))if(address!==`${row}:${food.column}`&&(cell.value!==null&&cell.value!==undefined&&cell.value!==''||cell.formula||cell.binding))expect(sheet.cells[address]).toEqual(cell);
  expect(getCell(sheet,row,food.column).binding).toEqual({table:target.id,row:added.row,column:target.columns.find(field=>field.name==='Ingredients')!.id});
  expect(validationChoiceGroups(book,sheet.validations.find(source=>source.rows.includes(row))!,row,food.column,new Engine(book)).some(group=>group.choices.some(choice=>choice.binding?.row===added.row))).toBe(true);
  const restored=applyUndo(book,structuralUndo(before,book)).book;
  expect(restored.sheets.find(source=>source.id===sheet.id)!.cells[`${row}:${food.column}`]).toEqual(before.sheets.find(source=>source.id===sheet.id)!.cells[`${row}:${food.column}`]);
  expect(restored.tables.find(table=>table.id===target.id)!.rows).not.toContain(added.row);
  expect(()=>addMealIngredient(book,sheet,row)).toThrow('already exists');validateBook(book);
});
it('recalculates all six previously blank promoted nutrients from later Ingredient reference edits without changing consumed quantity',()=>{
  const {book,sheet,table,input}=fixture(),row=sheet.rows[2].id;
  for(let c=4;c<10;c++)input(2,c,'');
  input(2,11,'2');input(2,12,'each');
  const before=clone(book),identity=addMealIngredient(book,sheet,row);
  writeIngredientValues(book,identity,{weight:'25',amount:'1',unit:'each',calories:'70',protein:'1',fat:'2',carbs:'12',sugar:'6',sodium:'10'});
  const engine=new Engine(book);
  expect(table.columns.slice(4,10).map(column=>scalar(engine.cell(sheet.id,row,column.column)))).toEqual([140,2,4,24,12,20]);
  expect(getCell(sheet,row,table.columns[11].column).value).toBe(2);
  expect(getCell(sheet,row,table.columns[12].column).value).toBe('each');
  const ingredients=book.tables.find(table=>table.id===identity.table)!,source=book.sheets.find(sheet=>sheet.id===ingredients.sheet)!;
  for(const column of ingredients.columns)renameColumn(book,ingredients,column.id,'Renamed '+column.id);
  moveColumns(book,source,[ingredients.columns[0].column],0);
  expect(scalar(new Engine(book).cell(sheet.id,row,table.columns[4].column))).toBe(140);
  expect(applyUndo(book,structuralUndo(before,book)).book).toEqual(before);
  validateBook(book);
});
it('promotes Logged nutrition with the shared Premade type, original Notes and retained consumed portion',()=>{
  const {book,sheet,table,input}=fixture(),row=sheet.rows[2].id;
  const ingredients=book.tables.find(table=>table.name==='Ingredients')!,source=book.sheets.find(sheet=>sheet.id===ingredients.sheet)!;
  const type=source.columns[11];setInput(book,source,ingredients.header,type.id,'Type');addTableColumns(book,source,ingredients,[type.id]);
  const notes=sheet.columns[13]??{id:'notes-column',label:'Notes'};if(!sheet.columns.includes(notes))sheet.columns.push(notes);
  setInput(book,sheet,table.header,notes.id,'Exercise');addTableColumns(book,sheet,table,[notes.id]);sheet.mealLog=mealLogConfig(book,sheet);
  input(2,11,'2');input(2,12,'each');setInput(book,sheet,row,notes.id,"'Synthetic packaging note");
  const before=clone(book),added=addMealIngredient(book,sheet,row);
  expect(getCell(source,added.row,type.id).value).toBe('Premade');
  expect(book.foodCapture!.ingredientDetails[`${added.table}:${added.row}`]).toEqual({notes:'Synthetic packaging note',photos:[]});
  expect(book.foodCapture!.ingredientMappings.find(mapping=>mapping.table===ingredients.id)!.fields.type).toBe(ingredients.columns.find(column=>column.column===type.id)!.id);
  expect(getCell(sheet,row,table.columns[11].column).value).toBe(2);expect(getCell(sheet,row,table.columns[12].column).value).toBe('each');
  expect(getCell(sheet,row,notes.id).value).toBe('Synthetic packaging note');
  expect(applyUndo(book,structuralUndo(before,book)).book).toEqual(before);validateBook(book);
});
it('requires all six nutrients, accepts genuine zeros and retains incompleteness after Ingredient promotion',()=>{
  const {book,sheet,input}=fixture(),row=sheet.rows[2].id,food=mealLogContext(book,sheet).fields.get('food')!.column;
  markMealNeedsNutrition(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBe(true);
  for(let c=4;c<8;c++)input(2,c,'0');
  markMealNeedsNutrition(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBe(true);
  input(2,8,'0');markMealNeedsNutrition(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBe(true);
  input(2,9,'0');
  markMealNeedsNutrition(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBeUndefined();
  for(const value of ['unknown',"'NaN",'TRUE']){
    input(2,9,value);markMealNeedsNutrition(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBe(true);
  }
  input(2,9,'0');
  input(2,4,'=""');markMealNeedsNutrition(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBe(true);
  const added=addMealIngredient(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBe(true);
  expect(getCell(sheet,row,food).binding?.row).toBe(added.row);validateBook(book);
});
it('checks linked Ingredient source nutrition rather than zero-filled consumption formulas, with live stable identities',()=>{
  const {book,sheet,input}=fixture(),row=sheet.rows[2].id;
  for(let c=4;c<10;c++)input(2,c,'0');
  const added=addMealIngredient(book,sheet,row),table=book.tables.find(table=>table.id===added.table)!,source=book.sheets.find(sheet=>sheet.id===table.sheet)!;
  const fields=sheet.mealLog!.ingredients!.fields,calories=table.columns.find(column=>column.id===fields.calories)!;
  for(let c=4;c<8;c++)input(2,c,'=0');
  expect(mealNeedsNutrition(book,sheet,row)).toBe(false);
  setInput(book,source,added.row,calories.column,'');
  const before=clone(book);
  expect(mealNeedsNutrition(book,sheet,row)).toBe(true);expect(book).toEqual(before);
  for(const column of table.columns)renameColumn(book,table,column.id,'Renamed '+column.id);
  moveColumns(book,source,[calories.column],0);
  for(const value of ['=""','=NA()',' ']){
    setInput(book,source,added.row,calories.column,value);expect(mealNeedsNutrition(book,sheet,row)).toBe(true);
  }
  setInput(book,source,added.row,calories.column,'=0');
  expect(mealNeedsNutrition(book,sheet,row)).toBe(false);
  const restored=applyUndo(book,structuralUndo(before,book)).book,restoredSheet=restored.sheets.find(item=>item.id===sheet.id)!;
  expect(mealNeedsNutrition(restored,restoredSheet,row)).toBe(true);validateBook(book);
});
it('does not label unnamed food slots and reports unknown or faulted manual nutrition without changing data',()=>{
  const {book,sheet,input}=fixture(),row=sheet.rows[2].id;
  input(2,3,'');expect(mealNeedsNutrition(book,sheet,row)).toBe(false);
  input(2,3,'Invented food');for(let c=4;c<8;c++)input(2,c,'0');
  for(const value of ['=""','=NA()',' ']){
    input(2,4,value);const before=clone(book);
    expect(mealNeedsNutrition(book,sheet,row)).toBe(true);expect(book).toEqual(before);
  }
});
it('adds the Ingredients picker source only to the linked Food cell without changing other dropdown targets',()=>{
  const {book,sheet}=fixture(),row=sheet.rows[2].id,other=sheet.rows[3].id,fields=mealLogContext(book,sheet).fields,food=fields.get('food')!.column,unit=fields.get('unit')!.column;
  const original={id:'original-picker',rows:[row,other],columns:[food,unit],source:'=Meals[Meal]',sheet:sheet.id};
  sheet.validations.push(original);const added=addMealIngredient(book,sheet,row);
  const source=sheet.validations.find(source=>source.rows.includes(row)&&source.columns.includes(food))!;
  const groups=validationChoiceGroups(book,source,row,food,new Engine(book));
  expect(groups.some(group=>group.target?.table===added.table)).toBe(true);expect(groups.some(group=>group.name==='Meals')).toBe(true);
  expect(sheet.validations.find(source=>source.rows.includes(other)&&source.columns.includes(food))!.source).toBe(original.source);
  expect(sheet.validations.find(source=>source.rows.includes(row)&&source.columns.includes(unit))!.source).toBe(original.source);
  validateBook(book);
});
it('keeps all three serving/conversion fields empty when the quantity row is blank',()=>{
  const {book,sheet}=fixture(),added=addMealIngredient(book,sheet,sheet.rows[2].id),table=book.tables.find(table=>table.id===added.table)!,destination=book.sheets.find(sheet=>sheet.id===table.sheet)!;
  for(const name of ['Serving (g)','Conversion Amount','Conversion Unit'])expect(getCell(destination,added.row,table.columns.find(field=>field.name===name)!.column).value??'').toBe('');
});
it('preserves explicit conversion quantities when the Ingredients table and fields are renamed',()=>{
  const {book,sheet,input}=fixture(),target=book.tables.find(table=>table.id===sheet.mealLog!.ingredients!.table)!;
  const amount=target.columns.find(field=>field.name==='Conversion Amount')!,unit=target.columns.find(field=>field.name==='Conversion Unit')!;
  target.name='Renamed pantry';for(const field of target.columns)renameColumn(book,target,field.id,'Renamed '+field.id);
  input(2,10,'300');input(2,11,'2');input(2,12,'cup');
  const added=addMealIngredient(book,sheet,sheet.rows[2].id),destination=book.sheets.find(sheet=>sheet.id===target.sheet)!;
  expect(getCell(destination,added.row,amount.column).value).toBe(2);expect(getCell(destination,added.row,unit.column).value).toBe('cup');
  validateBook(book);
});
it('moves a food only within its day, preserving cell and formula identities',()=>{
  const {book,sheet}=fixture(),row=sheet.rows[2].id,last=sheet.rows[3].id;
  const food=getCell(sheet,row,mealLogContext(book,sheet).fields.get('food')!.column);
  moveMealFood(book,sheet,row,1);
  const context=mealLogContext(book,sheet);
  expect(context.blocks[0].rows.indexOf(row)).toBeGreaterThan(context.blocks[0].rows.indexOf(last));
  expect(getCell(sheet,row,context.fields.get('food')!.column)).toEqual(food);
  const order=[...context.table.rows];moveMealFood(book,sheet,row,1);expect(context.table.rows).toEqual(order);validateBook(book);
});
