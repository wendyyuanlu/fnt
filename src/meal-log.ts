import {masterDayBlocks,masterLogging} from './day-logging';
import {Engine,scalar} from './formula';
import {addRow,allSheets,allTables,isFault,moveRows,setInput,type Sheet,type Table,type Workbook} from './model';

export const mealFields=['food','calories','protein','fat','carbs','sugar','sodium','weight','amount','unit'] as const;
export type MealField=typeof mealFields[number];
export interface MealLogConfig{
  table:string;fields:Partial<Record<MealField,string>>;
  ingredients?:{table:string;fields:Partial<Record<MealField,string>>};
}
const names:Record<MealField,string[]>={
  food:['Food'],calories:['Calories','Calories (kcal)'],protein:['Protein (g)','Protein'],
  fat:['Fat (g)','Fat'],carbs:['Carbs (g)','Carbs'],sugar:['Sugar (g)','Sugar'],
  sodium:['Sodium (mg)','Sodium'],weight:['Amount (g)'],amount:['Amount'],unit:['Unit']
};
const ingredientNames:Partial<Record<MealField,string[]>>={
  food:['Ingredients','Ingredient'],weight:['Serving (g)'],amount:['Conversion Amount'],unit:['Conversion Unit'],calories:['Calories (kcal)','Calories']
};
export function validateMealLog(config:MealLogConfig):void{
  const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(value);
  const valid=(target:MealLogConfig|NonNullable<MealLogConfig['ingredients']>)=>target&&id(target.table)&&target.fields&&typeof target.fields==='object'&&!Array.isArray(target.fields)&&Object.entries(target.fields).every(([field,value])=>mealFields.includes(field as MealField)&&id(value));
  if(!valid(config)||config.ingredients!==undefined&&!valid(config.ingredients))throw Error('Invalid Meal log field identities.');
}
function mapFields(table:Table,ingredients=false):Partial<Record<MealField,string>>{
  const result:Partial<Record<MealField,string>>={};
  for(const field of mealFields){
    const aliases=ingredients?ingredientNames[field]??names[field]:names[field];
    const found=aliases.map(name=>table.columns.find(column=>column.name.toLowerCase()===name.toLowerCase())).find(Boolean);
    if(found)result[field]=found.id;
  }
  return result;
}
export function mealLogConfig(book:Workbook,sheet:Sheet):MealLogConfig{
  if(sheet.mealLog){
    validateMealLog(sheet.mealLog);
    const saved=sheet.mealLog,table=allTables(book).find(table=>table.id===saved.table);
    const ingredients=allTables(book).find(table=>saved.ingredients?table.id===saved.ingredients.table:table.name.toLowerCase()==='ingredients');
    const target=saved.ingredients??(ingredients?{table:ingredients.id,fields:mapFields(ingredients,true)}:undefined);
    return{...saved,fields:{...(table?mapFields(table):{}),...saved.fields},...(target?{ingredients:{...target,fields:{...(ingredients?mapFields(ingredients,true):{}),...target.fields}}}:{})};
  }
  const {table,food}=masterLogging(book,sheet),ingredients=allTables(book).find(table=>table.name.toLowerCase()==='ingredients');
  return{table:table.id,fields:{...mapFields(table),...(food?{food:food.id}:{})},...(ingredients?{ingredients:{table:ingredients.id,fields:mapFields(ingredients,true)}}:{})};
}
export function mealLogContext(book:Workbook,sheet:Sheet,engine?:Engine){
  const config=mealLogConfig(book,sheet),table=allTables(book).find(table=>table.id===config.table&&table.sheet===sheet.id);
  if(!table)throw Error('Restore the Meal log table before logging.');
  const fields=new Map(mealFields.flatMap(field=>{
    const column=table.columns.find(column=>column.id===config.fields[field]);
    return column?[[field,column] as const]:[];
  }));
  if(!fields.has('food'))throw Error('Restore the Meal log Food field before logging.');
  return{table,fields,blocks:masterDayBlocks(book,sheet,engine).filter(block=>block.isDay)};
}
export function moveMealFood(book:Workbook,sheet:Sheet,row:string,direction:-1|1):void{
  const {table,blocks}=mealLogContext(book,sheet),block=blocks.find(block=>block.rows.slice(1).includes(row));
  if(!block)throw Error('This food no longer belongs to a day.');
  const foods=block.rows.slice(1),at=foods.indexOf(row),neighbor=foods[at+direction];
  if(!neighbor)return;
  if(sheet.groups.some(group=>group.axis==='row'&&group.kind==='summary'&&group.members[0]===row))throw Error('Move this food’s nested summary group in the spreadsheet instead.');
  const boundary=sheet.rows.findIndex(item=>item.id===neighbor)+(direction===1?1:0);
  moveRows(book,sheet,[row],boundary,table);
}
export function addMealIngredient(book:Workbook,sheet:Sheet,row:string):{table:string;row:string}{
  const config=mealLogConfig(book,sheet),context=mealLogContext(book,sheet);
  if(!context.blocks.some(block=>block.rows.slice(1).includes(row)))throw Error('This food no longer belongs to a day.');
  const target=config.ingredients,table=allTables(book).find(table=>table.id===target?.table),destination=allSheets(book).find(sheet=>sheet.id===table?.sheet);
  if(!target||!table||!destination)throw Error('Restore the Ingredients table before adding an ingredient.');
  const engine=new Engine(book),values=new Map<MealField,string>();
  for(const [field,column]of context.fields){
    const value=scalar(engine.cell(sheet.id,row,column.column));
    if(isFault(value))throw Error(`Fix the ${column.name} error before adding this ingredient.`);
    values.set(field,value===null?'':String(value));
  }
  const name=values.get('food')?.trim();
  if(!name)throw Error('Enter the food name before adding it to Ingredients.');
  const columns=new Map(mealFields.flatMap(field=>{
    const column=table.columns.find(column=>column.id===target.fields[field]);
    return column?[[field,column] as const]:[];
  }));
  if(['food','weight','amount','unit',...mealFields.slice(1,7)].some(field=>!columns.has(field as MealField)))throw Error('Restore the Ingredients nutrition and serving fields before adding an ingredient.');
  const label=columns.get('food')!;
  if(table.rows.some(row=>String(scalar(engine.cell(destination.id,row,label.column))??'').trim().toLowerCase()===name.toLowerCase()))throw Error('An ingredient with this name already exists. Choose it from the Food dropdown or use a different name.');
  const next=addRow(book,destination,table.rows.length?destination.rows.findIndex(row=>row.id===table.rows.at(-1))+1:destination.rows.findIndex(row=>row.id===table.header)+1,table);
  const amount=values.get('amount')??'',unit=values.get('unit')??'',weight=values.get('weight')??'';
  for(const [field,column]of columns){
    const value=field==='food'?name:field==='amount'&&!amount&&!unit?weight:field==='unit'&&!amount&&!unit?(weight?'g':''):values.get(field)??'';
    setInput(book,destination,next.id,column.column,field==='food'||field==='unit'?"'"+value:value);
  }
  // Nutrition overrides stay on the logged row; adding a reference never rewrites history.
  return{table:table.id,row:next.id};
}
