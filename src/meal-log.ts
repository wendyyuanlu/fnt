import {masterDayBlocks,masterLogging} from './day-logging';
import {compile,Engine,scalar,type Ast} from './formula';
import {addRow,allSheets,allTables,getCell,isFault,key,moveRows,setInput,uid,type Sheet,type Table,type Workbook} from './model';
import {validationChoiceGroups} from './references';
import {captureData,ingredientKey,nutrients} from './food-capture';
import {ingredientConsumptionCalculations} from './ingredient-calculation';

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
export function mapMealFields(table:Table,ingredients=false):Partial<Record<MealField,string>>{
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
    const target=saved.ingredients??(ingredients?{table:ingredients.id,fields:mapMealFields(ingredients,true)}:undefined);
    return{...saved,...(meals?{meals}:{}),fields:{...(table?mapMealFields(table):{}),...saved.fields},...(target?{ingredients:{...target,fields:{...(ingredients?mapMealFields(ingredients,true):{}),...target.fields}}}:{})};
  }
  const {table,food}=masterLogging(book,sheet),ingredients=allTables(book).find(table=>table.name.toLowerCase()==='ingredients');
  return{table:table.id,...(meals?{meals}:{}),fields:{...mapMealFields(table),...(food?{food:food.id}:{})},...(ingredients?{ingredients:{table:ingredients.id,fields:mapMealFields(ingredients,true)}}:{})};
}
function mealNutritionReader(book:Workbook,sheet:Sheet,engine:Engine,contains:(table:Table,row:string)=>boolean):(row:string)=>boolean{
  const config=mealLogConfig(book,sheet),tables=allTables(book),table=tables.find(table=>table.id===config.table);
  const foodColumn=table?.columns.find(column=>column.id===config.fields.food);
  const target=config.ingredients,ingredients=target?tables.find(table=>table.id===target.table):undefined;
  const source=ingredients?allSheets(book).find(sheet=>sheet.id===ingredients.sheet):undefined;
  return row=>{
    if(!foodColumn||!table||!contains(table,row))return false;
    const food=getCell(sheet,row,foodColumn.column),name=scalar(engine.cell(sheet.id,row,foodColumn.column));
    if(name===null||typeof name==='string'&&!name.trim())return false;
    const binding=food.binding,linked=!!binding&&binding.table===target?.table;
    if(linked&&(!ingredients||!source||!contains(ingredients,binding.row)))return true;
    const fields=linked?target!.fields:config.fields,sourceTable=linked?ingredients!:table,sourceSheet=linked?source!:sheet,sourceRow=linked?binding!.row:row;
    return (['calories','protein','fat','carbs','sugar','sodium'] as const).some(field=>{
      const column=sourceTable.columns.find(column=>column.id===fields[field]);
      const value=column?scalar(engine.cell(sourceSheet.id,sourceRow,column.column)):null;
      return typeof value==='number'?!Number.isFinite(value):typeof value!=='string'||!value.trim()||!Number.isFinite(Number(value));
    });
  };
}
export function createMealNutritionReader(book:Workbook,sheet:Sheet,engine=new Engine(book)):(row:string)=>boolean{
  // Recreate after structural edits; this reader belongs to one synchronous view.
  const rows=new Map<Table,Set<string>>();
  return mealNutritionReader(book,sheet,engine,(table,row)=>{
    let members=rows.get(table);if(!members)rows.set(table,members=new Set(table.rows));
    return members.has(row);
  });
}
export function mealNeedsNutrition(book:Workbook,sheet:Sheet,row:string,engine=new Engine(book)):boolean{
  return mealNutritionReader(book,sheet,engine,(table,row)=>table.rows.includes(row))(row);
}
export function markMealNeedsNutrition(book:Workbook,sheet:Sheet,row:string,read?:(row:string)=>boolean):void{
  const config=mealLogConfig(book,sheet),table=allTables(book).find(table=>table.id===config.table),foodColumn=table?.columns.find(column=>column.id===config.fields.food);
  if(!foodColumn||!table?.rows.includes(row))return;
  const food=getCell(sheet,row,foodColumn.column),incomplete=read?read(row):mealNeedsNutrition(book,sheet,row);
  if(incomplete)sheet.cells[key(row,foodColumn.column)]={...food,foodDraft:true};
  else if(food.foodDraft){const cell={...food};delete cell.foodDraft;sheet.cells[key(row,foodColumn.column)]=cell;}
}
export function mealLogTable(book:Workbook,sheet:Sheet,config=mealLogConfig(book,sheet)){
  const table=allTables(book).find(table=>table.id===config.table&&table.sheet===sheet.id);
  if(!table)throw Error('Restore the Meal log table before logging.');
  return table;
}
export function mealLogContext(book:Workbook,sheet:Sheet,engine?:Engine){
  const config=mealLogConfig(book,sheet),table=mealLogTable(book,sheet,config);
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
export function refreshMealIngredientCalculations(book:Workbook,sheet:Sheet,row:string,context=mealLogContext(book,sheet)):void{
  const config=mealLogConfig(book,sheet),food=context.fields.get('food');
  if(!food||!context.blocks.some(block=>block.rows.slice(1).includes(row)))return;
  const source=config.ingredients,table=allTables(book).find(table=>table.id===source?.table),origin=allSheets(book).find(item=>item.id===table?.sheet);
  if(!source||!table||!origin)return;
  const targetFields=new Map([...context.fields].map(([field,column])=>[field,column.column]));
  const sourceFields=new Map(mealFields.flatMap(field=>{
    const column=table.columns.find(column=>column.id===source.fields[field]);
    return column?[[field,column.column] as const]:[];
  }));
  const cache=new Map<string,ReturnType<typeof ingredientConsumptionCalculations>['nutrition']>();
  const calculations=(sourceRow:string)=>{
    const saved=cache.get(sourceRow);if(saved)return saved;
    if(!table.rows.includes(sourceRow))return;
    const result=ingredientConsumptionCalculations(
      {sheet:sheet.id,row,fields:targetFields},
      {sheet:origin.id,row:sourceRow,fields:sourceFields},
    ).nutrition;
    cache.set(sourceRow,result);return result;
  };
  const binding=getCell(sheet,row,food.column).binding;
  const next=binding?.table===table.id&&binding.column===source.fields.food?calculations(binding.row):undefined;
  for(const field of nutrients){
    const column=context.fields.get(field);if(!column)continue;
    const cell=getCell(sheet,row,column.column),formula=next?.get(field);
    const owned=(ast:Ast|undefined)=>{
      // Match the complete factory AST, including retained calculations after unlinking Food.
      const condition=ast?.kind==='call'&&ast.name==='IF'?ast.args[0]:undefined;
      const present=condition?.kind==='call'&&condition.name==='AND'?condition.args[1]:undefined;
      const reference=present?.kind==='binary'&&present.op==='<>'?present.left:undefined;
      if(reference?.kind!=='ref'||reference.sheet!==origin.id)return false;
      const expected=calculations(reference.row)?.get(field);
      return!!expected&&JSON.stringify(ast)===JSON.stringify(expected);
    };
    if(owned(cell.formula))
      sheet.cells[key(row,column.column)]={...cell,value:undefined,formula,calculation:owned(cell.calculation)?formula:cell.calculation};
    else if(!cell.formula&&!cell.binding){
      const calculation=owned(cell.calculation)?formula:cell.calculation;
      if(formula&&(cell.value===null||cell.value===undefined||cell.value===''))
        sheet.cells[key(row,column.column)]={...cell,value:undefined,formula:calculation??formula,calculation};
      else if(calculation!==cell.calculation)sheet.cells[key(row,column.column)]={...cell,calculation};
    }
  }
}
export function addMealIngredient(book:Workbook,sheet:Sheet,row:string):{table:string;row:string}{
  const config=mealLogConfig(book,sheet),context=mealLogContext(book,sheet);
  if(!context.blocks.some(block=>block.rows.slice(1).includes(row)))throw Error('This food no longer belongs to a day.');
  const target=config.ingredients,table=allTables(book).find(table=>table.id===target?.table),destination=allSheets(book).find(sheet=>sheet.id===table?.sheet);
  if(!target||!table||!destination)throw Error('Restore the Ingredients table before adding an ingredient.');
  const linked=context.fields.get('food'),binding=linked?getCell(sheet,row,linked.column).binding:undefined;
  if(binding?.table===table.id&&table.rows.includes(binding.row))throw Error('An Ingredient link already exists. Choose another Ingredient from the Food dropdown instead.');
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
  const data=captureData(book),mapping=data.ingredientMappings.find(mapping=>mapping.table===table.id);
  const type=table.columns.find(column=>mapping?.fields.type?column.id===mapping.fields.type:column.name.toLowerCase()==='type');
  if(type)setInput(book,destination,next.id,type.column,"'Premade");
  if(!mapping)data.ingredientMappings.push({table:table.id,fields:{...target.fields,...(type?{type:type.id}:{})}});
  else if(type&&!mapping.fields.type)mapping.fields.type=type.id;
  data.ingredientDetails[ingredientKey({table:table.id,row:next.id})]={notes:values.get('notes')??'',photos:[]};
  const food=context.fields.get('food')!,previous=getCell(sheet,row,food.column);
  sheet.cells[key(row,food.column)]={...previous,value:undefined,formula:undefined,foodDraft:undefined,binding:{table:table.id,row:next.id,column:label.id}};
  refreshMealIngredientCalculations(book,sheet,row,context);
  markMealNeedsNutrition(book,sheet,row);
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
