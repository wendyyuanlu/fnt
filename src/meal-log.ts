import {masterDayBlocks,masterLogging} from './day-logging';
import {compile,Engine,scalar,type Ast} from './formula';
import {addRow,allSheets,allTables,getCell,isFault,key,moveRows,setInput,uid,type Sheet,type Table,type Workbook} from './model';
import {validationChoiceGroups} from './references';

export const mealFields=['food','calories','protein','fat','carbs','sugar','sodium','weight','amount','unit','notes'] as const;
export type MealField=typeof mealFields[number];
export interface MealLogConfig{
  table:string;fields:Partial<Record<MealField,string>>;
  ingredients?:{table:string;fields:Partial<Record<MealField,string>>};
  meals?:string;
}
const names:Record<MealField,string[]>={
  food:['Food'],calories:['Calories','Calories (kcal)'],protein:['Protein (g)','Protein'],
  fat:['Fat (g)','Fat'],carbs:['Carbs (g)','Carbs'],sugar:['Sugar (g)','Sugar'],
  sodium:['Sodium (mg)','Sodium'],weight:['Amount (g)'],amount:['Amount'],unit:['Unit'],notes:['Exercise']
};
const ingredientNames:Partial<Record<MealField,string[]>>={
  food:['Ingredients','Ingredient'],weight:['Serving (g)'],amount:['Conversion Amount'],unit:['Conversion Unit'],calories:['Calories (kcal)','Calories']
};
export function validateMealLog(config:MealLogConfig):void{
  const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(value);
  const valid=(target:MealLogConfig|NonNullable<MealLogConfig['ingredients']>)=>target&&id(target.table)&&target.fields&&typeof target.fields==='object'&&!Array.isArray(target.fields)&&Object.entries(target.fields).every(([field,value])=>mealFields.includes(field as MealField)&&id(value));
  if(!valid(config)||config.ingredients!==undefined&&!valid(config.ingredients)||config.meals!==undefined&&!id(config.meals))throw Error('Invalid Meal log field identities.');
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
  const meals=sheet.mealLog?.meals??allTables(book).find(table=>table.name.toLowerCase()==='meals')?.id;
  if(sheet.mealLog){
    validateMealLog(sheet.mealLog);
    const saved=sheet.mealLog,table=allTables(book).find(table=>table.id===saved.table);
    const ingredients=allTables(book).find(table=>saved.ingredients?table.id===saved.ingredients.table:table.name.toLowerCase()==='ingredients');
    const target=saved.ingredients??(ingredients?{table:ingredients.id,fields:mapFields(ingredients,true)}:undefined);
    return{...saved,...(meals?{meals}:{}),fields:{...(table?mapFields(table):{}),...saved.fields},...(target?{ingredients:{...target,fields:{...(ingredients?mapFields(ingredients,true):{}),...target.fields}}}:{})};
  }
  const {table,food}=masterLogging(book,sheet),ingredients=allTables(book).find(table=>table.name.toLowerCase()==='ingredients');
  return{table:table.id,...(meals?{meals}:{}),fields:{...mapFields(table),...(food?{food:food.id}:{})},...(ingredients?{ingredients:{table:ingredients.id,fields:mapFields(ingredients,true)}}:{})};
}
export function markMealDraft(book:Workbook,sheet:Sheet,row:string):void{
  const config=mealLogConfig(book,sheet),table=allTables(book).find(table=>table.id===config.table);
  const foodColumn=table?.columns.find(column=>column.id===config.fields.food);
  if(!foodColumn||!table?.rows.includes(row))return;
  const food=getCell(sheet,row,foodColumn.column),engine=new Engine(book);
  const incomplete=!food.binding&&!food.formula&&mealFields.slice(1,7).some(field=>{
    const column=table.columns.find(column=>column.id===config.fields[field]);
    const value=column?scalar(engine.cell(sheet.id,row,column.column)):null;
    return value===null||typeof value==='string'&&!value.trim();
  });
  if(incomplete)sheet.cells[key(row,foodColumn.column)]={...food,foodDraft:true};
  else if(food.foodDraft){const cell={...food};delete cell.foodDraft;sheet.cells[key(row,foodColumn.column)]=cell;}
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
export function editMealDayWeight(book:Workbook,sheet:Sheet,row:string,value:string,engine=new Engine(book)):void{
  const blocks=mealLogContext(book,sheet,engine).blocks;
  if(!blocks.some(block=>block.header===row))throw Error('This Meal log day header changed. Undo the change or reopen the correct day before editing Weight.');
  const {label}=masterLogging(book,sheet),address=key(row,label.column),previous=sheet.cells[address],reference=`${sheet.id}:${address}`;
  try{
    setInput(book,sheet,row,label.column,value.trim()?value:'x');engine.invalidate([reference]);
    const after=mealLogContext(book,sheet,engine).blocks;
    if(after.length!==blocks.length||after.some((block,i)=>block.header!==blocks[i].header||block.rows.length!==blocks[i].rows.length||block.rows.some((row,j)=>row!==blocks[i].rows[j])))throw Error('Weight would change day grouping. Clear the field to leave this day unmeasured instead.');
  }catch(error){
    if(previous)sheet.cells[address]=previous;else delete sheet.cells[address];
    engine.invalidate([reference]);throw error;
  }
}
export function moveMealFood(book:Workbook,sheet:Sheet,row:string,direction:-1|1,engine?:Engine):void{
  const {table,blocks}=mealLogContext(book,sheet,engine),block=blocks.find(block=>block.rows.slice(1).includes(row));
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
  const food=context.fields.get('food')!,previous=getCell(sheet,row,food.column);
  sheet.cells[key(row,food.column)]={...previous,value:undefined,formula:undefined,foodDraft:undefined,binding:{table:table.id,row:next.id,column:label.id}};
  const validation=sheet.validations.find(source=>source.rows.includes(row)&&source.columns.includes(food.column));
  if(!validation||!validationChoiceGroups(book,validation,row,food.column,new Engine(book)).some(group=>group.target?.table===table.id&&group.target.column===label.id)){
    const source:Ast={kind:'structured',table:table.id,columns:[label.id],mode:'data'};
    const original=validation?(validation.source.startsWith('{')?JSON.parse(validation.source) as Ast:compile(validation.source,book,validation.sheet,row,food.column)):undefined;
    if(validation)sheet.validations=sheet.validations.flatMap(item=>{
      if(item!==validation)return[item];
      const rows=item.rows.filter(id=>id!==row),columns=item.columns.filter(id=>id!==food.column);
      return[...(rows.length?[{...item,rows}]:[]),...(columns.length?[{...item,id:uid(),rows:[row],columns}]:[])];
    });
    sheet.validations.push({id:uid(),rows:[row],columns:[food.column],sheet:sheet.id,source:JSON.stringify(original?{kind:'call',name:'VSTACK',args:[original,source]}:source)});
  }
  return{table:table.id,row:next.id};
}
