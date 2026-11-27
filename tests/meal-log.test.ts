import {expect,it} from 'vitest';
import {addMasterFood,masterLogging,masterDayBlocks} from '../src/day-logging';
import {Engine,scalar} from '../src/formula';
import {addMealIngredient,editMealDayWeight,markMealDraft,mealLogConfig,mealLogContext,moveMealFood} from '../src/meal-log';
import {addTableColumns,blankSheet,clone,createDemo,getCell,moveColumns,renameColumn,setInput} from '../src/model';
import {applyUndo,structuralUndo} from '../src/undo-history';
import {validationChoiceGroups} from '../src/references';
import {validateBook} from '../src/storage';
import {defaultHeaderFormula} from '../src/meal-block';

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
it('copies manual nutrition to Ingredients, links the Food cell, and reverses the whole action with Undo',()=>{
  const {book,sheet,input}=fixture();input(2,10,'300');
  const row=sheet.rows[2].id,before=clone(book),food=mealLogContext(book,sheet).fields.get('food')!,added=addMealIngredient(book,sheet,row),target=book.tables.find(table=>table.id===added.table)!,destination=book.sheets.find(sheet=>sheet.id===target.sheet)!;
  const read=(name:string)=>scalar(new Engine(book).cell(destination.id,added.row,target.columns.find(field=>field.name===name)!.column));
  expect(read('Serving (g)')).toBe(300);expect(read('Conversion Amount')).toBe(300);expect(read('Conversion Unit')).toBe('g');
  expect(read('Calories (kcal)')).toBe(100);expect(read('Protein (g)')).toBe(20);
  for(const [address,cell]of Object.entries(before.sheets.find(source=>source.id===sheet.id)!.cells))if(address!==`${row}:${food.column}`)expect(sheet.cells[address]).toEqual(cell);
  expect(getCell(sheet,row,food.column).binding).toEqual({table:target.id,row:added.row,column:target.columns.find(field=>field.name==='Ingredients')!.id});
  expect(validationChoiceGroups(book,sheet.validations.find(source=>source.rows.includes(row))!,row,food.column,new Engine(book)).some(group=>group.choices.some(choice=>choice.binding?.row===added.row))).toBe(true);
  const restored=applyUndo(book,structuralUndo(before,book)).book;
  expect(restored.sheets.find(source=>source.id===sheet.id)!.cells[`${row}:${food.column}`]).toEqual(before.sheets.find(source=>source.id===sheet.id)!.cells[`${row}:${food.column}`]);
  expect(restored.tables.find(table=>table.id===target.id)!.rows).not.toContain(added.row);
  expect(()=>addMealIngredient(book,sheet,row)).toThrow('already exists');validateBook(book);
});
it('quietly marks blank manual macros as draft, accepts zero, and clears the marker when complete or linked',()=>{
  const {book,sheet,input}=fixture(),row=sheet.rows[2].id,food=mealLogContext(book,sheet).fields.get('food')!.column;
  markMealDraft(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBe(true);
  for(let c=4;c<10;c++)input(2,c,'0');
  markMealDraft(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBeUndefined();
  input(2,4,'=""');markMealDraft(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBe(true);
  const added=addMealIngredient(book,sheet,row);expect(getCell(sheet,row,food).foodDraft).toBeUndefined();
  expect(getCell(sheet,row,food).binding?.row).toBe(added.row);validateBook(book);
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
