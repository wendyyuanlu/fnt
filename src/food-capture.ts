import {Engine,scalar} from './formula';
import {addRow,allSheets,allTables,clone,getCell,isFault,setInput,uid,type Cell,type Sheet,type Table,type Workbook} from './model';
import {mealFields,mealLogConfig,mealLogContext,type MealField} from './meal-log';
import {parseFraction} from './quantity';
import type {NutritionConflict} from './ingredient-edit';
import {validateNameVersion} from './nutrition-names';
import type {ConverterState} from './nutrition-converter';
import type {ConverterReceipt} from './nutrition-apply';
import type {StandaloneReceipt} from './nutrition-converter-import';

export const nutrients=['calories','protein','fat','carbs','sugar','sodium'] as const;
export type Nutrient=typeof nutrients[number];
export type FoodValues=Partial<Record<MealField,string>>;
export type CaptureMode='single'|'multi'|'packaged'|'ingredient';
export interface IngredientIdentity{table:string;row:string}
export interface NutritionTarget{sheet:string;table:string}
export interface IngredientMapping{table:string;fields:Partial<Record<MealField|'type',string>>}
export interface RestaurantLink{restaurant?:string;restaurantText?:string}
export interface DraftFood extends RestaurantLink{
  id:string;date:number;mode:CaptureMode;values:FoodValues;parts:{id:string;text:string}[];
  ingredient?:IngredientIdentity;photos:string[];
  loggingTarget?:NutritionTarget;
}
export interface FoodPhoto{id:string;date:number;name:string;mime:string;bytes:number;digest:string}
export interface NutritionItem{
  id:string;key:string;kind:'ingredient'|'draft'|'logged';name:string;originalName:string;
  selected:boolean;includeNotes:boolean;values:FoodValues;restaurant:string;date?:number;
  reference?:IngredientIdentity;source:{sheet?:string;table?:string;row:string;part?:string};
  photos:string[];basis:string;missing:string[];fingerprint:string;
  loggingTarget?:NutritionTarget;
}
export interface LinkedNutritionIntent{
  id:string;key:string;source:NutritionItem['source'];ingredient:IngredientIdentity;date:number;
  values:FoodValues;restaurant:string;restaurantId?:string;photos:string[];mode:CaptureMode;
  overrides:Partial<Record<Nutrient,string>>;target?:NutritionTarget;fingerprint:string;
}
export interface NameVersion{
  id:string;time:string;batch:string;
  names:{id:string;key:string;originalName:string;name:string;restaurant:string}[];
}
export interface NutritionBatch{
  id:string;created:string;days:number[];multiDay:boolean;items:NutritionItem[];
  generated:boolean;selectOpen:boolean;reviewNames:boolean;promptOpen:boolean;template:string;prompt:string;
  workflow?:'builder'|'converter';
  promptIssue?:string;
  sourceChanges?:string[];
  linkedIntents?:LinkedNutritionIntent[];
}
export interface FoodCapture{
  schema:1;foods:DraftFood[];restaurants:{id:string;name:string}[];photos:FoodPhoto[];
  loggedDetails?:Record<string,RestaurantLink>;
  ingredientMappings:IngredientMapping[];ingredientDetails:Record<string,{notes:string;photos:string[]}>;
  ingredientEdits:Record<string,{values:FoodValues&{type?:string};base:FoodValues&{type?:string};typeBinding?:NonNullable<Cell['binding']>}>;nameVersions:NameVersion[];
  selectedDate?:number;builder?:NutritionBatch;promptTemplate?:string;
  nutritionConflicts?:NutritionConflict[];
  converter?:ConverterState;
  nutritionReceipts?:ConverterReceipt[];
  nutritionImports?:StandaloneReceipt[];
}
interface ResolvedIngredient{
  table:Table;sheet:Sheet;mapping:IngredientMapping;rows:Set<string>;
  columns:Map<string,Table['columns'][number]|undefined>;
}
type ConversionGraph=Map<string,Map<string,number>>;
export interface FoodCaptureContext{
  readonly book:Workbook;readonly engine:Engine;readonly tables:Table[];
  readonly tablesById:Map<string,Table>;readonly sheetsById:Map<string,Sheet>;
  readonly ingredients:Map<string,ResolvedIngredient>;
  conversionGraph?:ConversionGraph;
  readonly conversions:Map<string,Map<string,number|undefined>>;
}
// Share only within a read operation; discard after workbook edits or Engine invalidation.
export function createFoodCaptureContext(book:Workbook,engine:Engine|(()=>Engine)=()=>new Engine(book)):FoodCaptureContext{
  let current=typeof engine==='function'?undefined:engine;
  if(current&&current.book!==book)throw Error('The food capture Engine belongs to a different workbook.');
  const tables=allTables(book);
  return{book,get engine(){
    current??=typeof engine==='function'?engine():engine;
    if(current.book!==book)throw Error('The food capture Engine belongs to a different workbook.');
    return current;
  },tables,tablesById:new Map(tables.map(table=>[table.id,table])),sheetsById:new Map(allSheets(book).map(sheet=>[sheet.id,sheet])),ingredients:new Map(),conversions:new Map()};
}
type CaptureReader=Engine|FoodCaptureContext;
function checkReader(book:Workbook,reader?:CaptureReader):void{
  if(reader&&(reader.book!==book||'engine'in reader&&reader.engine.book!==book))throw Error('The food capture Engine or context belongs to a different workbook.');
}
function captureContext(book:Workbook,reader?:CaptureReader):FoodCaptureContext{
  checkReader(book,reader);
  return reader&&'engine'in reader?reader:createFoodCaptureContext(book,reader);
}
export const ingredientKey=(item:IngredientIdentity)=>`${item.table}:${item.row}`;
export function captureData(book:Workbook):FoodCapture{
  return book.foodCapture??={schema:1,foods:[],restaurants:[],photos:[],ingredientMappings:[],ingredientDetails:{},ingredientEdits:{},nameVersions:[]};
}
export function numberValue(value:string|undefined):number|undefined{
  if(value===undefined||!value.trim())return;
  const fraction=parseFraction(value);
  if(fraction.kind==='fraction')return fraction.value;
  const number=Number(value);return Number.isFinite(number)?number:undefined;
}
export function parseServing(text:string):{weight?:number;amount?:number;unit?:string}{
  const match=text.trim().match(/^((?:\d+\s+)?\d+\/\d+|(?:\d+)?[¼½¾⅓⅔⅛⅜⅝⅞]|(?:\d+(?:\.\d*)?|\.\d+))\s*([^\d\s].*)$/u);
  if(!match)throw Error('Enter a quantity and unit, such as 40g or 4 each.');
  const amount=numberValue(match[1]),unit=match[2].trim();
  if(amount===undefined||amount<=0||!unit)throw Error('The nutrition reference serving must be greater than zero and have a unit.');
  const mass:Record<string,number>={g:1,gram:1,grams:1,kg:1000,mg:.001,oz:28.349523125,lb:453.59237};
  if(mass[unit.toLowerCase()]){
    const weight=amount*mass[unit.toLowerCase()];if(!Number.isFinite(weight)||weight<=0)throw Error('The nutrition reference weight exceeds the supported numeric range.');
    return{weight};
  }
  return{amount,unit};
}
export function ingredientMapping(book:Workbook):IngredientMapping{
  return resolveIngredientMapping(book,allTables(book));
}
function resolveIngredientMapping(book:Workbook,tables:Table[]):IngredientMapping{
  const tableIds=new Set(tables.map(table=>table.id));
  const stored=book.foodCapture?.ingredientMappings.find(mapping=>tableIds.has(mapping.table));
  if(stored)return stored;
  for(const sheet of book.sheets){
    if(!sheet.mealLog?.ingredients)continue;
    const target=sheet.mealLog.ingredients,table=tables.find(table=>table.id===target.table);
    if(table)return{...target,fields:{...target.fields,type:table.columns.find(column=>column.name.toLowerCase()==='type')?.id}};
  }
  const table=tables.find(table=>table.name.toLowerCase()==='ingredients');
  if(!table)throw Error('Restore the Ingredients table before using ingredients.');
  const aliases:Record<string,string[]>={food:['ingredients','ingredient'],weight:['serving (g)'],amount:['conversion amount'],unit:['conversion unit'],calories:['calories (kcal)','calories'],protein:['protein (g)','protein'],fat:['fat (g)','fat'],carbs:['carbs (g)','carbs'],sugar:['sugar (g)','sugar'],sodium:['sodium (mg)','sodium'],type:['type']};
  return{table:table.id,fields:Object.fromEntries(Object.entries(aliases).flatMap(([field,names])=>{
    const column=table.columns.find(column=>names.includes(column.name.toLowerCase()));return column?[[field,column.id]]:[];
  }))};
}
export function rememberIngredients(book:Workbook):IngredientMapping{
  const data=captureData(book),mapping=ingredientMapping(book);
  if(!data.ingredientMappings.some(item=>item.table===mapping.table))data.ingredientMappings.push(clone(mapping));
  return mapping;
}
function resolvedIngredient(context:FoodCaptureContext,tableId?:string):ResolvedIngredient{
  if(tableId){const cached=context.ingredients.get(tableId);if(cached)return cached;}
  const book=context.book,mapping=(tableId?book.foodCapture?.ingredientMappings.find(item=>item.table===tableId):undefined)??resolveIngredientMapping(book,context.tables);
  const id=tableId??mapping.table,cached=context.ingredients.get(id);if(cached)return cached;
  const table=context.tablesById.get(id),sheet=table?context.sheetsById.get(table.sheet):undefined;
  if(!table||!sheet||mapping.table!==table.id)throw Error('This Ingredient was removed. Restore it or explicitly choose another Ingredient.');
  const byId=new Map(table.columns.map(column=>[column.id,column]));
  const resolved={table,sheet,mapping,rows:new Set(table.rows),columns:new Map(Object.entries(mapping.fields).map(([field,id])=>[field,id?byId.get(id):undefined]))};
  context.ingredients.set(id,resolved);return resolved;
}
function ingredientValue(context:FoodCaptureContext,source:ResolvedIngredient,row:string,field:string):string{
  const column=source.columns.get(field),result=column?scalar(context.engine.cell(source.sheet.id,row,column.column)):null;
  return isFault(result)?result.error:String(result??'');
}
function readIngredient(context:FoodCaptureContext,source:ResolvedIngredient,row:string){
  const values:FoodValues&{type?:string}={};
  for(const field of source.columns.keys())values[field as keyof typeof values]=ingredientValue(context,source,row,field);
  return{table:source.table,sheet:source.sheet,mapping:source.mapping,values};
}
export function ingredientRecord(book:Workbook,identity:IngredientIdentity,reader?:CaptureReader){
  const context=captureContext(book,reader),source=ingredientSource(context,identity);
  return readIngredient(context,source,identity.row);
}
export function ingredientSource(context:FoodCaptureContext,identity:IngredientIdentity){
  const source=resolvedIngredient(context,identity.table);
  if(!source.rows.has(identity.row))throw Error('This Ingredient was removed. Restore it or explicitly choose another Ingredient.');
  return source;
}
export const missingNutrition=(values:FoodValues)=>nutrients.filter(field=>numberValue(values[field])===undefined);
export function ingredientList(book:Workbook,reader?:CaptureReader,options?:{includeBlank:boolean}){
  const context=captureContext(book,reader),source=resolvedIngredient(context);
  return source.table.rows.flatMap(row=>{
    const identity={table:source.table.id,row},record=readIngredient(context,source,row);
    return options?.includeBlank||record.values.food?.trim()?[{...identity,...record,missing:missingNutrition(record.values)}]:[];
  });
}
export const homeCookedRestaurant='Home cooked';
export function restaurantChoices(book:Workbook):{id:string;name:string}[]{
  return[{id:'',name:homeCookedRestaurant},...(book.foodCapture?.restaurants??[]).filter(item=>item.name.trim().toLocaleLowerCase()!==homeCookedRestaurant.toLocaleLowerCase())];
}
export function restaurantName(book:Workbook,food:RestaurantLink,names?:ReadonlyMap<string,string>):string{
  const name=food.restaurant?(names?names.get(food.restaurant):book.foodCapture?.restaurants.find(item=>item.id===food.restaurant)?.name):undefined;
  const resolved=name??food.restaurantText??'';
  return resolved.trim().toLocaleLowerCase()===homeCookedRestaurant.toLocaleLowerCase()?homeCookedRestaurant:resolved;
}
export function setRestaurant(book:Workbook,food:RestaurantLink,text:string):void{
  text=text.trim();delete food.restaurantText;
  if(!text){delete food.restaurant;return;}
  if(text.toLocaleLowerCase()===homeCookedRestaurant.toLocaleLowerCase()){food.restaurantText=homeCookedRestaurant;delete food.restaurant;return;}
  const data=captureData(book);let restaurant=data.restaurants.find(item=>item.name.toLocaleLowerCase()===text.toLocaleLowerCase());
  if(!restaurant){restaurant={id:uid(),name:text};data.restaurants.push(restaurant);}
  food.restaurant=restaurant.id;
}
export function renameRestaurant(book:Workbook,id:string,name:string):void{
  const data=captureData(book),restaurant=data.restaurants.find(item=>item.id===id);name=name.trim();
  if(!restaurant||!name)throw Error('Choose an existing restaurant and a nonempty name.');
  if(data.restaurants.some(item=>item.id!==id&&item.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('That restaurant already exists.');
  restaurant.name=name;
}
export function deleteRestaurant(book:Workbook,id:string):void{
  const data=captureData(book),restaurant=data.restaurants.find(item=>item.id===id);
  if(!restaurant)throw Error('This restaurant no longer exists.');
  for(const food of [...data.foods,...Object.values(data.loggedDetails??{})])if(food.restaurant===id){food.restaurantText=restaurant.name;delete food.restaurant;}
  data.restaurants=data.restaurants.filter(item=>item.id!==id);
}
export function restaurantFoods(book:Workbook,id:string,engine=new Engine(book)):{name:string;kind:'Draft'|'Logged'}[]{
  const data=book.foodCapture,foods:{name:string;kind:'Draft'|'Logged'}[]=(data?.foods??[]).filter(food=>food.restaurant===id).map(food=>({name:food.values.food?.trim()||'(Unnamed food)',kind:'Draft'}));
  const tables=new Map(allTables(book).map(table=>[table.id,table])),sheets=new Map(allSheets(book).map(sheet=>[sheet.id,sheet]));
  for(const [key,details]of Object.entries(data?.loggedDetails??{})){
    if(details.restaurant!==id)continue;
    const [tableId,row]=key.split(':'),table=tables.get(tableId),sheet=table&&sheets.get(table.sheet);
    if(!table||!sheet||!table.rows.includes(row))continue;
    const config=mealLogConfig(book,sheet),column=table.columns.find(column=>column.id===config.fields.food);
    if(config.table!==table.id||!column)throw Error('Restore the logged Food field before reviewing affected restaurant foods.');
    const value=scalar(engine.cell(sheet.id,row,column.column));
    if(isFault(value))throw Error('Fix the logged Food error before reviewing affected restaurant foods.');
    foods.push({name:String(value??'').trim()||'(Unnamed food)',kind:'Logged'});
  }
  return foods;
}
export function addDraftFood(book:Workbook,date:number,after?:string,target?:NutritionTarget):DraftFood{
  const data=captureData(book),source=after?data.foods.find(food=>food.id===after):undefined;
  if(after&&(!source||source.date!==date))throw Error('The source food changed. Reopen the selected day.');
  const loggingTarget=source?source.loggingTarget:target;
  const food:DraftFood={id:uid(),date,mode:'single',values:{},parts:[],photos:[],...(source?.restaurant?{restaurant:source.restaurant}:{}),...(source?.restaurantText?{restaurantText:source.restaurantText}:{}),...(loggingTarget?{loggingTarget:{...loggingTarget}}:{})};
  const at=source?data.foods.indexOf(source)+1:data.foods.length;data.foods.splice(at,0,food);return food;
}
export function updateDraftText(food:DraftFood,text:string):void{
  const lines=text.split(/\r?\n/),previous=food.parts;
  let first=0,last=0;
  while(first<Math.min(lines.length,previous.length)&&lines[first]===previous[first].text)first++;
  while(last<Math.min(lines.length-first,previous.length-first)&&lines[lines.length-1-last]===previous[previous.length-1-last].text)last++;
  const middle=lines.slice(first,lines.length-last).map((text,index)=>({id:lines.length-first-last===previous.length-first-last?previous[first+index]?.id??uid():uid(),text}));
  food.parts=[...previous.slice(0,first),...middle,...(last?previous.slice(-last):[])];food.values.food=text;
}
function unitName(unit:string):string{
  const value=unit.trim().toLowerCase();return['piece','pieces','each'].includes(value)?'each':value;
}
export function rememberNutritionConversions(book:Workbook):void{
  for(const table of allTables(book)){
    if(book.references?.some(source=>source.table===table.id&&source.conversion))continue;
    const column=(name:string)=>table.columns.find(column=>column.name.toLowerCase()===name)?.id;
    const from=column('from unit'),to=column('to unit'),factor=column('conversion factor');
    if(from&&to&&factor)(book.references??=[]).push({id:uid(),name:table.name+' conversions',kind:'conversions',table:table.id,archivedRows:[],conversion:{from,to,factor}});
  }
}
export function nutritionConversionColumns(context:FoodCaptureContext){
  return context.tables.flatMap(table=>{
    const configured=context.book.references?.find(source=>source.table===table.id&&source.conversion)?.conversion;
    const column=(id:string|undefined,name:string)=>table.columns.find(column=>id?column.id===id:column.name.toLowerCase()===name)?.column;
    const from=column(configured?.from,'from unit'),to=column(configured?.to,'to unit'),factor=column(configured?.factor,'conversion factor');
    return from&&to&&factor?[{table,from,to,factor}]:[];
  });
}
function conversionGraph(context:FoodCaptureContext):ConversionGraph{
  if(context.conversionGraph)return context.conversionGraph;
  const {engine}=context;
  const edges=new Map<string,Map<string,number>>();
  const edge=(a:string,b:string,factor:number)=>{a=unitName(a);b=unitName(b);if(!a||!b||!Number.isFinite(factor)||factor<=0)return;const next=edges.get(a)??new Map<string,number>();next.set(b,factor);edges.set(a,next);};
  for(const [unit,factor]of Object.entries({mg:.001,kg:1000,oz:28.349523125,lb:453.59237,gram:1,grams:1})){edge(unit,'g',factor);edge('g',unit,1/factor);}
  for(const {table,from:a,to:b,factor:f}of nutritionConversionColumns(context)){
    for(const row of table.rows){
      const factor=Number(scalar(engine.cell(table.sheet,row,f))),left=String(scalar(engine.cell(table.sheet,row,a))??''),right=String(scalar(engine.cell(table.sheet,row,b))??'');
      edge(left,right,factor);edge(right,left,1/factor);
    }
  }
  context.conversionGraph=edges;return edges;
}
export function quantityFactor(book:Workbook,from:string,to:string,reader?:CaptureReader):number|undefined{
  checkReader(book,reader);
  from=unitName(from);to=unitName(to);if(!from||!to)return;if(from===to)return 1;
  const context=captureContext(book,reader),cached=context.conversions.get(from);
  if(cached?.has(to))return cached.get(to);
  const edges=conversionGraph(context),results=cached??new Map<string,number|undefined>();
  context.conversions.set(from,results);
  const queue:[string,number|undefined][]=[[from,1]],seen=new Set([from]);
  for(let i=0;i<queue.length;i++)for(const [unit,factor]of edges.get(queue[i][0])??[]){
    if(seen.has(unit))continue;
    const previous=queue[i][1],product=previous===undefined?undefined:previous*factor;
    const result=product!==undefined&&Number.isFinite(product)&&product>0?product:undefined;
    // Keep the first BFS path even when its product is invalid; do not select a fallback route.
    if(unit===to){results.set(to,result);return result;}
    seen.add(unit);queue.push([unit,result]);
  }
  results.set(to,undefined);
}
export function scaledDraft(book:Workbook,food:DraftFood,reader?:CaptureReader):{values:FoodValues;issue?:string;missing:Nutrient[]}{
  checkReader(book,reader);
  if(!food.ingredient)return{values:{...food.values},missing:missingNutrition(food.values)};
  const context=captureContext(book,reader),source=ingredientRecord(book,food.ingredient,context).values,values:FoodValues={...food.values,food:source.food};
  const weight=numberValue(food.values.weight),referenceWeight=numberValue(source.weight),amount=numberValue(food.values.amount),referenceAmount=numberValue(source.amount);
  const invalidQuantity=(values:FoodValues)=>(['weight','amount'] as const).some(field=>{
    if(!values[field]?.trim())return false;
    const value=numberValue(values[field]);return value===undefined||!Number.isFinite(value)||value<0;
  });
  if(invalidQuantity(food.values)||invalidQuantity(source))return{values,missing:missingNutrition(values),issue:'Enter finite nonnegative consumed quantities and a positive Ingredient reference serving.'};
  let factor:number|undefined;
  if(weight!==undefined){
    if(referenceWeight!==undefined&&referenceWeight>0)factor=weight/referenceWeight;
    else if(referenceAmount!==undefined&&referenceAmount>0){const conversion=quantityFactor(book,'g',source.unit??'',context);if(conversion!==undefined)factor=weight*conversion/referenceAmount;}
  }else if(amount!==undefined&&referenceAmount!==undefined&&referenceAmount>0){
    const conversion=quantityFactor(book,food.values.unit??'',source.unit??'',context);if(conversion!==undefined)factor=amount*conversion/referenceAmount;
  }else if(amount!==undefined&&referenceWeight!==undefined&&referenceWeight>0){
    const conversion=quantityFactor(book,food.values.unit??'','g',context);if(conversion!==undefined)factor=amount*conversion/referenceWeight;
  }
  let issue:string|undefined;
  if(factor!==undefined&&Number.isFinite(factor)&&factor>=0){
    const scaled=(reference:number):string|undefined=>{
      const result=reference*factor;
      if(Number.isFinite(result))return String(result);
      issue='The scaled Ingredient quantity or nutrition exceeds the supported numeric range.';return;
    };
    if(!food.values.weight?.trim()&&referenceWeight!==undefined){const result=scaled(referenceWeight);if(result!==undefined)values.weight=result;}
    for(const nutrient of nutrients)if(!food.values[nutrient]?.trim()){
      const reference=numberValue(source[nutrient]),result=reference===undefined?'':scaled(reference);
      if(result!==undefined)values[nutrient]=result;
    }
  }else issue='Enter a compatible finite consumed quantity and Ingredient reference serving to calculate nutrition.';
  return{values,missing:missingNutrition(values),...(issue?{issue}:{})};
}
export function addDraftIngredient(book:Workbook,food:DraftFood,reader?:CaptureReader):IngredientIdentity{
  checkReader(book,reader);
  if(food.ingredient)throw Error('This food already links to an Ingredient.');
  if(food.mode==='multi'||food.mode==='ingredient')throw Error('Use Single or Pre-packaged to add an Ingredient.');
  const name=food.values.food?.trim();if(!name)throw Error('Enter a food name before adding an Ingredient.');
  const context=captureContext(book,reader),source=resolvedIngredient(context),{table,sheet,columns}=source;
  const normalized=name.toLocaleLowerCase();
  for(const row of table.rows)if(ingredientValue(context,source,row,'food').trim().toLocaleLowerCase()===normalized)throw Error('That Ingredient already exists. Select it from the Ingredient picker instead.');
  for(const field of ['food','weight','amount','unit',...nutrients])if(!columns.get(field))throw Error(`Restore the Ingredients ${field} field before adding an Ingredient.`);
  rememberIngredients(book);
  const row=addRow(book,sheet,table.rows.length?sheet.rows.findIndex(row=>row.id===table.rows.at(-1))+1:sheet.rows.findIndex(row=>row.id===table.header)+1,table);
  for(const [field,column]of columns)if(column){
    const text=field==='type'?'Premade':food.values[field as MealField]??'';
    setInput(book,sheet,row.id,column.column,field==='food'||field==='unit'||field==='type'?"'"+text:text);
  }
  const identity={table:table.id,row:row.id};food.ingredient=identity;
  captureData(book).ingredientDetails[ingredientKey(identity)]={notes:food.values.notes??'',photos:[...food.photos]};return identity;
}
export function availableFoodDays(book:Workbook,reader?:CaptureReader):number[]{
  const context=captureContext(book,reader);
  const days=new Set(book.foodCapture?.foods.map(food=>food.date));
  for(const sheet of book.sheets){
    if(!sheet.mealLog&&!context.tables.some(table=>table.sheet===sheet.id&&table.name.toLowerCase()==='master'))continue;
    const log=mealLogContext(book,sheet,context.engine);
    for(const block of log.blocks)if(block.date!==undefined&&block.rows.length>1)days.add(block.date);
  }
  return[...days].sort((a,b)=>b-a);
}
function itemFingerprint(item:Omit<NutritionItem,'fingerprint'>):string{
  return JSON.stringify([item.originalName,item.values,item.restaurant,item.date,item.reference,item.source,item.photos,...(item.loggingTarget?[item.loggingTarget]:[])]);
}
export function linkedNutritionIntents(book:Workbook,days:number[]):LinkedNutritionIntent[]{
  const selected=new Set(days),intents:LinkedNutritionIntent[]=[];
  for(const food of book.foodCapture?.foods??[]){
    if(!food.ingredient||!selected.has(food.date))continue;
    const parts=food.mode==='multi'?food.parts.filter(part=>part.text.trim()):[{id:food.id,text:food.values.food??''}];
    for(const part of parts){
      const intent:LinkedNutritionIntent={id:part.id,key:`draft:${food.id}:${part.id}`,source:{row:food.id,part:part.id},ingredient:{...food.ingredient},date:food.date,
        values:{...food.values,...(food.mode==='multi'?{food:part.text}:{})},restaurant:restaurantName(book,food),...(food.restaurant?{restaurantId:food.restaurant}:{}),
        photos:[...food.photos],mode:food.mode,overrides:Object.fromEntries(nutrients.filter(field=>food.values[field]?.trim()).map(field=>[field,food.values[field]!])),
        ...(food.loggingTarget?{target:{...food.loggingTarget}}:{}),fingerprint:''};
      intent.fingerprint=JSON.stringify([intent.source,intent.ingredient,intent.date,intent.values,intent.restaurant,intent.restaurantId,intent.photos,intent.mode,intent.target]);
      intents.push(intent);
    }
  }
  return intents;
}
export function changedLinkedNutritionIntents(book:Workbook,batch:NutritionBatch):string[]{
  const current=new Map(linkedNutritionIntents(book,batch.days).map(intent=>[intent.key,intent.fingerprint]));
  return(batch.linkedIntents??[]).filter(intent=>batch.days.includes(intent.date)&&current.get(intent.key)!==intent.fingerprint).map(intent=>intent.key);
}
export function nutritionCandidates(book:Workbook,days:number[],reader?:CaptureReader):NutritionItem[]{
  return collectNutritionCandidates(captureContext(book,reader),days);
}
function collectNutritionCandidates(context:FoodCaptureContext,days:number[],existing:ReadonlySet<string>=new Set()):NutritionItem[]{
  const {book,engine}=context,items:NutritionItem[]=[],selectedDays=new Set(days),restaurants=new Map(book.foodCapture?.restaurants.map(item=>[item.id,item.name]));
  const add=(item:Omit<NutritionItem,'id'|'fingerprint'>)=>{
    const next={...item,id:'',fingerprint:''};next.fingerprint=itemFingerprint(next);items.push(next);
  };
  const source=resolvedIngredient(context);
  for(const row of source.table.rows){
    const key='ingredient:'+ingredientKey({table:source.table.id,row});
    if(existing.has(key))continue;
    const ingredient={...readIngredient(context,source,row),row};
    if(!ingredient.values.food?.trim())continue;
    const missing=missingNutrition(ingredient.values);
    const identity={table:ingredient.table.id,row:ingredient.row},details=book.foodCapture?.ingredientDetails[ingredientKey(identity)];
    add({key,kind:'ingredient',name:ingredient.values.food!,originalName:ingredient.values.food!,selected:missing.length>0,includeNotes:false,values:{...ingredient.values,notes:details?.notes??''},restaurant:'',reference:identity,source:{table:identity.table,sheet:ingredient.sheet.id,row:identity.row},photos:[...(details?.photos??[])],basis:'',missing});
  }
  for(const food of book.foodCapture?.foods??[]){
    if(!selectedDays.has(food.date)||food.ingredient||!food.values.food?.trim())continue;
    const descriptions=food.mode==='multi'?food.parts.filter(part=>part.text.trim()):[{id:food.id,text:food.values.food}];
    for(const part of descriptions){
      const key=`draft:${food.id}:${part.id}`;if(existing.has(key))continue;
      const values=food.mode==='multi'?{food:part.text,...(food.values.notes!==undefined?{notes:food.values.notes}:{})}:{...food.values};
      add({key,kind:'draft',name:part.text,originalName:part.text,selected:true,includeNotes:false,values,restaurant:restaurantName(book,food,restaurants),date:food.date,source:{row:food.id,part:part.id},photos:[...food.photos],basis:'',missing:missingNutrition(values),...(food.loggingTarget?{loggingTarget:{...food.loggingTarget}}:{})});
    }
  }
  for(const sheet of book.sheets){
    if(!sheet.mealLog&&!context.tables.some(table=>table.sheet===sheet.id&&table.name.toLowerCase()==='master'))continue;
    const log=mealLogContext(book,sheet,engine),config=mealLogConfig(book,sheet);
    for(const day of log.blocks){
      if(day.date===undefined||!selectedDays.has(day.date))continue;
      for(const row of day.rows.slice(1)){
        const key=`logged:${log.table.id}:${row}`;if(existing.has(key))continue;
        const label=log.fields.get('food')!,food=getCell(sheet,row,label.column);
        if(food.binding?.table===config.ingredients?.table)continue;
        const values:FoodValues={};
        for(const [field,column]of log.fields){const value=scalar(engine.cell(sheet.id,row,column.column));values[field]=isFault(value)?value.error:String(value??'');}
        if(!values.food?.trim())continue;
        add({key,kind:'logged',name:values.food,originalName:values.food,values,selected:true,includeNotes:false,restaurant:restaurantName(book,book.foodCapture?.loggedDetails?.[`${log.table.id}:${row}`]??{},restaurants),date:day.date,source:{sheet:sheet.id,table:log.table.id,row},photos:[],basis:'',missing:missingNutrition(values)});
      }
    }
  }
  return items;
}
export function newNutritionBatch(book:Workbook,days:number[],template:string,reader?:CaptureReader):NutritionBatch{
  const items=nutritionCandidates(book,days,reader);items.forEach((item,index)=>item.id=`I${String(index+1).padStart(5,'0')}`);
  return{id:uid(),created:new Date().toISOString(),days:[...days],multiDay:days.length>1,items,linkedIntents:linkedNutritionIntents(book,days),generated:false,selectOpen:true,reviewNames:false,promptOpen:true,template,prompt:''};
}
export function appendNewFood(book:Workbook,batch:NutritionBatch,reader?:CaptureReader):number{
  const existing=new Set(batch.items.map(item=>item.key)),incoming=collectNutritionCandidates(captureContext(book,reader),batch.days,existing);
  let next=batch.items.reduce((max,item)=>Math.max(max,Number(item.id.slice(1))||0),0);
  for(const item of incoming){item.id=`I${String(++next).padStart(5,'0')}`;batch.items.push(item);}
  if(batch.linkedIntents){
    const captured=new Set([...batch.items.map(item=>item.key),...batch.linkedIntents.map(intent=>intent.key)]);
    for(const intent of linkedNutritionIntents(book,batch.days))if(!captured.has(intent.key))batch.linkedIntents.push(intent);
  }
  return incoming.length;
}
export function generateNutritionPrompt(batch:NutritionBatch):string{
  const selected=batch.items.filter(item=>item.selected&&(item.date===undefined||batch.days.includes(item.date)));
  if(!selected.length)throw Error('Select at least one item.');
  const sections=new Map<string,unknown[]>();
  for(const item of selected){
    const serving=item.kind==='ingredient'?nutritionReference(item):undefined;
    const group=item.kind==='ingredient'?'Ingredients':item.kind==='logged'?'Logged food':`Draft food / ${item.restaurant||'Other'}`;
    const fields={itemId:item.id,dishName:item.name,originalDescription:item.originalName,source:item.kind==='logged'?'Meal plan':item.kind==='ingredient'?'Ingredient':'Draft',date:item.date,restaurant:item.restaurant||undefined,
      nutritionBasis:item.kind==='ingredient'?{kind:'Ingredient reference serving',grams:serving?.weight,amount:serving?.amount,unit:serving?.unit}:{kind:'Described consumed portion',grams:item.values.weight,amount:item.values.amount,unit:item.values.unit},
      knownNutrition:Object.fromEntries(nutrients.filter(field=>item.values[field]?.trim()).map(field=>[field,item.values[field]])),notes:item.includeNotes?item.values.notes:undefined,photosToAttachManually:item.photos};
    const rows=sections.get(group)??[];rows.push(fields);sections.set(group,rows);
  }
  return`${batch.template.trim()}\n\n## Current batch\nBatch ID: ${batch.id}\n\nFor this tracked batch, each Ingredient request's nutritionBasis is authoritative: return all six nutrient values for that exact captured reference serving, and make its output Grams/Amount/Unit describe the same reference serving. Ingredient-linked consumed portions are retained separately in the app; do not use them as the Ingredient reference or add them as extra response rows. Draft output quantity columns remain blank as specified above; blank never means zero or per 100g. Reviewed dishName values are the requested names; preserve user-edited names exactly. originalDescription remains nutrition context, not replacement naming instructions. Photos are references only: I will attach them manually.\n\n${[...sections].map(([group,items])=>`### ${group}\n\`\`\`json\n${JSON.stringify(items,null,2)}\n\`\`\``).join('\n\n')}`;
}
export function nutritionReference(item:Pick<NutritionItem,'basis'|'values'|'name'>):{weight?:number;amount?:number;unit?:string}{
  if(item.basis.trim()){
    if(!missingNutritionReference(item))throw Error(`The captured reference for ${item.name} cannot be replaced in the request. Use its captured reference, or edit the Ingredient and reset the batch.`);
    return parseServing(item.basis);
  }
  const weight=numberValue(item.values.weight),amount=numberValue(item.values.amount),unit=item.values.unit?.trim();
  if(weight!==undefined&&weight>0)return{weight,...(amount!==undefined&&amount>0&&unit?{amount,unit}:{})};
  if(amount!==undefined&&amount>0&&unit)return{amount,unit};
  throw Error(`Enter a nutrition reference serving for ${item.name}, such as 40g or 4 each.`);
}
export function missingNutritionReference(item:Pick<NutritionItem,'values'>):boolean{
  return(['weight','amount','unit'] as const).every(field=>!item.values[field]?.trim());
}
export function refreshNutritionPrompt(batch:NutritionBatch):void{
  if(!batch.generated)return;
  try{batch.prompt=generateNutritionPrompt(batch);delete batch.promptIssue;}
  catch(error){batch.prompt='';batch.promptIssue=error instanceof Error?error.message:String(error);}
}
export function changedNutritionSnapshots(book:Workbook,batch:NutritionBatch,reader?:CaptureReader):string[]{
  const candidates=new Map(nutritionCandidates(book,batch.days,reader).map(item=>[item.key,item]));
  return batch.items.filter(item=>(item.date===undefined||batch.days.includes(item.date))&&candidates.get(item.key)?.fingerprint!==item.fingerprint).map(item=>item.key);
}
export function saveNameVersion(data:FoodCapture):NameVersion{
  const batch=data.builder;if(!batch)throw Error('Generate or open a nutrition batch first.');
  const version:NameVersion={id:uid(),time:new Date().toISOString(),batch:batch.id,names:batch.items.map(item=>({id:item.id,key:item.key,originalName:item.originalName,name:item.name,restaurant:item.restaurant}))};
  data.nameVersions.push(version);return version;
}
export function restoreNameVersion(batch:NutritionBatch,version:NameVersion):void{
  if(batch.id!==version.batch)throw Error('This backup belongs to a different batch. Open that batch before restoring names.');
  const byId=new Map(batch.items.map(item=>[item.id,item]));
  if(new Set(version.names.map(item=>item.id)).size!==version.names.length||version.names.some(name=>!byId.has(name.id)||byId.get(name.id)!.key!==name.key||byId.get(name.id)!.originalName!==name.originalName))throw Error('Name backup identities do not match this batch. Nothing was restored.');
  for(const name of version.names){const item=byId.get(name.id)!;item.name=name.name;item.restaurant=name.restaurant;}
  if(batch.generated)refreshNutritionPrompt(batch);
}
export function validateFoodCapture(value:unknown):asserts value is FoodCapture{
  const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const id=(value:unknown):value is string=>typeof value==='string'&&/^[\w.-]{1,128}$/.test(value);
  const text=(value:unknown):value is string=>typeof value==='string'&&value.length<=1000000;
  const array=(value:unknown):value is unknown[]=>Array.isArray(value)&&value.length<=100000;
  if(!record(value)||value.schema!==1||!array(value.foods)||!array(value.restaurants)||!array(value.photos)||!array(value.ingredientMappings)||!array(value.nameVersions)||!record(value.ingredientDetails)||!record(value.ingredientEdits))throw Error('Invalid food capture data.');
  const ids=new Set<string>(),unique=(value:unknown)=>{if(!id(value)||ids.has(String(value)))throw Error('Duplicate or invalid food capture identity.');ids.add(String(value));};
  const values=(value:unknown):value is Record<string,string>=>record(value)&&Object.entries(value).every(([key,value])=>(mealFields.includes(key as MealField)||key==='type')&&text(value));
  // Early Multi snapshots stored an absent optional Notes property as undefined.
  const requestValues=(value:unknown,kind:unknown)=>values(value)||kind==='draft'&&record(value)&&Object.prototype.hasOwnProperty.call(value,'notes')&&value.notes===undefined&&values({...value,notes:''});
  const photos=(value:unknown)=>array(value)&&value.every(id);
  const day=(value:unknown)=>Number.isInteger(value)&&Number(value)>=0&&Number(value)<=2958465;
  const target=(value:unknown)=>value===undefined||record(value)&&id(value.sheet)&&id(value.table);
  const source=(value:unknown)=>record(value)&&id(value.row)&&['sheet','table','part'].every(field=>value[field]===undefined||id(value[field]));
  const ingredient=(value:unknown)=>record(value)&&id(value.table)&&id(value.row);
  if(value.selectedDate!==undefined&&!day(value.selectedDate))throw Error('Invalid selected draft date.');
  for(const food of value.foods){
    if(!record(food)||!values(food.values)||!day(food.date)||!['single','multi','packaged','ingredient'].includes(String(food.mode))||!array(food.parts)||!photos(food.photos)||!target(food.loggingTarget)||food.restaurant!==undefined&&!id(food.restaurant)||food.restaurantText!==undefined&&!text(food.restaurantText))throw Error('Invalid draft food.');
    unique(food.id);
    for(const part of food.parts){if(!record(part)||!text(part.text))throw Error('Invalid Multi food identity.');unique(part.id);}
    if(food.ingredient!==undefined&&(!record(food.ingredient)||!id(food.ingredient.table)||!id(food.ingredient.row)))throw Error('Invalid Ingredient link.');
  }
  for(const restaurant of value.restaurants){if(!record(restaurant)||!text(restaurant.name)||!restaurant.name.trim())throw Error('Invalid restaurant.');unique(restaurant.id);}
  if(value.loggedDetails!==undefined){
    if(!record(value.loggedDetails)||Object.keys(value.loggedDetails).length>100000)throw Error('Invalid logged food details.');
    for(const [key,details]of Object.entries(value.loggedDetails))if(!/^[\w.-]{1,128}:[\w.-]{1,128}$/.test(key)||!record(details)||Object.keys(details).some(field=>!['restaurant','restaurantText'].includes(field))||details.restaurant!==undefined&&!id(details.restaurant)||details.restaurantText!==undefined&&!text(details.restaurantText))throw Error('Invalid logged food details.');
  }
  for(const photo of value.photos){if(!record(photo)||!text(photo.name)||!['image/jpeg','image/png','image/webp','image/gif'].includes(String(photo.mime))||!Number.isInteger(photo.date)||!Number.isSafeInteger(photo.bytes)||Number(photo.bytes)<=0||!/^[a-f0-9]{64}$/.test(String(photo.digest)))throw Error('Invalid food photo.');unique(photo.id);}
  for(const mapping of value.ingredientMappings)if(!record(mapping)||!id(mapping.table)||!record(mapping.fields)||Object.entries(mapping.fields).some(([field,value])=>!['type',...mealFields].includes(field)||value!==undefined&&!id(value)))throw Error('Invalid Ingredient field mapping.');
  for(const [key,details]of Object.entries(value.ingredientDetails))if(!/^[\w.-]+:[\w.-]+$/.test(key)||!record(details)||!text(details.notes)||!photos(details.photos))throw Error('Invalid Ingredient details.');
  for(const [key,edit]of Object.entries(value.ingredientEdits)){
    if(!/^[\w.-]+:[\w.-]+$/.test(key)||!record(edit)||!values(edit.values)||!values(edit.base))throw Error('Invalid staged Ingredient edit.');
    if(edit.typeBinding!==undefined&&(!record(edit.typeBinding)||Object.keys(edit.typeBinding).some(key=>!['table','row','column'].includes(key))||!id(edit.typeBinding.table)||!id(edit.typeBinding.row)||!id(edit.typeBinding.column)||!Object.hasOwn(edit.values,'type')))throw Error('Invalid staged Ingredient Type link.');
  }
  if(value.nutritionConflicts!==undefined){
    if(!array(value.nutritionConflicts))throw Error('Invalid nutrition review.');
    const seen=new Set<string>();
    for(const review of value.nutritionConflicts){
      if(!record(review))throw Error('Invalid nutrition conflict.');
      const logged=review.kind==='logged',identity=logged
        ?record(review.target)&&id(review.target.sheet)&&id(review.target.table)&&id(review.target.row)&&review.food===`${review.target.table}:${review.target.row}`
        :(review.kind===undefined||review.kind==='draft')&&id(review.food)&&ingredient(review.ingredient);
      const key=`${logged?'logged':'draft'}:${review.food}`;
      if(!identity||seen.has(key)||!array(review.fields)||!review.fields.length||new Set(review.fields).size!==review.fields.length||review.fields.some(field=>!nutrients.includes(field as Nutrient))||!values(review.manual)||!values(review.calculated))throw Error('Invalid nutrition conflict.');
      seen.add(key);
    }
  }
  if(value.promptTemplate!==undefined&&!text(value.promptTemplate))throw Error('Invalid nutrition prompt template.');
  for(const version of value.nameVersions)validateNameVersion(version);
  if(value.builder!==undefined){
    const batch=value.builder;
    if(!record(batch)||!id(batch.id)||!text(batch.created)||!array(batch.days)||batch.days.some(value=>!day(value))||!array(batch.items)||!text(batch.template)||!text(batch.prompt)||batch.promptIssue!==undefined&&!text(batch.promptIssue)||['multiDay','generated','selectOpen','reviewNames','promptOpen'].some(key=>typeof batch[key]!=='boolean'))throw Error('Invalid nutrition batch.');
    if(batch.workflow!==undefined&&batch.workflow!=='builder'&&batch.workflow!=='converter')throw Error('Invalid nutrition workflow.');
    if(batch.sourceChanges!==undefined&&(!array(batch.sourceChanges)||batch.sourceChanges.some(value=>!text(value))))throw Error('Invalid nutrition snapshot review.');
    const ids=new Set(),keys=new Set();
    for(const item of batch.items){
      if(!record(item)||!id(item.id)||ids.has(item.id)||!text(item.key)||keys.has(item.key)||!['ingredient','draft','logged'].includes(String(item.kind))||!text(item.name)||!text(item.originalName)||!text(item.restaurant)||!requestValues(item.values,item.kind)||!photos(item.photos)||!source(item.source)||!target(item.loggingTarget)||item.date!==undefined&&!day(item.date)||item.reference!==undefined&&!ingredient(item.reference)||!text(item.basis)||!text(item.fingerprint)||!array(item.missing)||item.missing.some(field=>!nutrients.includes(field as Nutrient))||typeof item.selected!=='boolean'||typeof item.includeNotes!=='boolean')throw Error('Invalid nutrition request mapping.');
      ids.add(item.id);keys.add(item.key);
    }
    if(batch.linkedIntents!==undefined){
      if(!array(batch.linkedIntents))throw Error('Invalid linked consumption snapshots.');
      const ids=new Set(),keys=new Set();
      for(const intent of batch.linkedIntents){
        if(!record(intent)||!id(intent.id)||ids.has(intent.id)||!text(intent.key)||!intent.key||keys.has(intent.key)||!source(intent.source)||!ingredient(intent.ingredient)||!day(intent.date)||!values(intent.values)||!text(intent.restaurant)||intent.restaurantId!==undefined&&!id(intent.restaurantId)||!photos(intent.photos)||!['single','multi','packaged','ingredient'].includes(String(intent.mode))||!target(intent.target)||!record(intent.overrides)||Object.entries(intent.overrides).some(([field,value])=>!nutrients.includes(field as Nutrient)||!text(value))||!text(intent.fingerprint))throw Error('Invalid linked consumption snapshot.');
        for(const [field,value]of Object.entries(intent.overrides))if(intent.values[field]!==value)throw Error('Invalid linked nutrition override snapshot.');
        ids.add(intent.id);keys.add(intent.key);
      }
    }
  }
}
