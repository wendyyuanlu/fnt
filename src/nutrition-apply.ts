import {captureData,changedLinkedNutritionIntents,ingredientKey,ingredientRecord,linkedNutritionIntents,nutrients,nutritionCandidates,numberValue,rememberNutritionConversions,restaurantName,scaledDraft,setRestaurant,validateFoodCapture,type DraftFood,type FoodValues,type LinkedNutritionIntent,type NutritionBatch,type NutritionItem,type NutritionTarget,type RestaurantLink} from './food-capture';
import {captureNutritionReview,queueNutritionReview,writeIngredientValues} from './ingredient-edit';
import {addMasterFood,createMasterDay,masterLogging} from './day-logging';
import {mealFields,mealLogConfig,mealLogContext,markMealNeedsNutrition,type MealField} from './meal-log';
import {Engine,scalar} from './formula';
import {allSheets,allTables,clone,getCell,isFault,key,setInput,uid,type Sheet,type Workbook} from './model';
import {newConverterState,reviewNutritionTable,validateConverterState,type ConverterChoice,type ConverterIssue,type ConverterReview,type ReviewedNutrition} from './nutrition-converter';
import {strictNutritionNumber} from './nutrition-table';
import {ingredientConsumptionCalculations} from './ingredient-calculation';

export interface ConverterReceiptEntry{
  key:string;item?:string;kind:'ingredient'|'logged'|'draft'|'linked';
  target:{table:string;row:string};source:NutritionItem|LinkedNutritionIntent;
  originalDraft?:DraftFood;values:FoodValues;removedDescription?:string;
}
export interface ConverterReceipt{
  schema:1;id:string;batch:string;signature:string;created:string;
  entries:ConverterReceiptEntry[];
  response?:ConverterReview['source'];
}
export interface ConverterPlan{
  batch:string;revision:number;signature:string;items:ReviewedNutrition[];
  linked:{intent:LinkedNutritionIntent;choice:ConverterChoice}[];
}
export interface PreparedNutritionApply{
  book:Workbook;receipt:ConverterReceipt;plan:ConverterPlan;alreadyApplied:boolean;
}
const describe=(error:unknown)=>error instanceof Error?error.message:String(error);
const normalized=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(normalized);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,normalized(value)]));
  return value;
};
export const converterSignature=(review:ConverterReview)=>{
  const {source,...request}=review;
  return JSON.stringify(normalized({...request,rows:[...review.rows].sort((a,b)=>a.id.localeCompare(b.id))}));
};
function destination(book:Workbook,target:NutritionTarget|undefined){
  if(!target)throw Error('Choose and review an explicit destination for this legacy Draft. No default table is assumed.');
  const table=allTables(book).find(table=>table.id===target.table),sheet=table?allSheets(book).find(sheet=>sheet.id===table.sheet):undefined;
  if(!table||!sheet||!book.sheets.some(item=>item.id===sheet.id))throw Error('The captured destination table was removed or is not a writable logging table.');
  const context=mealLogContext(book,sheet),day=masterLogging(book,sheet);
  if(context.table.id!==table.id||day.table.id!==table.id)throw Error('The captured destination is no longer the configured dated logging table.');
  return{table,sheet,context};
}
function targetFor(item:NutritionItem,choice:ConverterChoice|undefined):NutritionTarget|undefined{
  if(item.loggingTarget&&choice?.target&&choice.target.table!==item.loggingTarget.table)throw Error('A captured Draft destination cannot be diverted to another table.');
  return item.loggingTarget??choice?.target;
}
function mappedFields(book:Workbook,sheet:Sheet,tableId:string){
  const config=mealLogConfig(book,sheet),table=allTables(book).find(table=>table.id===tableId&&table.sheet===sheet.id);
  if(!table||config.table!==table.id)throw Error('The source logging table or configured mapping changed.');
  const fields=new Map<MealField,string>();
  for(const field of mealFields){const column=table.columns.find(column=>column.id===config.fields[field]);if(column)fields.set(field,column.column);}
  return{table,fields};
}
function requireFields(fields:Map<MealField,string>,values:FoodValues):void{
  for(const [field,text]of Object.entries(values))if(text!==undefined&&text!==''&&!fields.has(field as MealField))throw Error(`Restore the configured ${field} destination column before applying; no values will be dropped.`);
}
function literalWrite(book:Workbook,sheet:Sheet,row:string,field:MealField,column:string,value:string){
  setInput(book,sheet,row,column,['food','unit','notes'].includes(field)?"'"+value:value);
}
function draftValues(item:ReviewedNutrition):FoodValues{
  return{...item.values,...(item.item.values.notes!==undefined?{notes:item.item.values.notes}:{})};
}
function consumedValues(values:FoodValues):FoodValues{
  const result={...values};
  for(const field of ['weight','amount'] as const)if(values[field]?.trim()){
    const number=numberValue(values[field]);
    if(number===undefined||number<0)throw Error(`Captured ${field} must be finite and nonnegative. Correct the source before applying.`);
    result[field]=String(number);
  }
  if(!!result.amount?.trim()!==!!result.unit?.trim())throw Error('Captured Amount and Unit must be supplied together. Correct the source before applying.');
  return result;
}
function sameRequestPayload(current:NutritionItem,captured:NutritionItem):boolean{
  const payload=(item:NutritionItem)=>({key:item.key,kind:item.kind,originalName:item.originalName,values:item.values,date:item.date,reference:item.reference,source:item.source,photos:item.photos,loggingTarget:item.loggingTarget});
  return JSON.stringify(normalized(payload(current)))===JSON.stringify(normalized(payload(captured)));
}
function linkedFood(intent:LinkedNutritionIntent,manual:'keep'|'reference'):DraftFood{
  const values={...intent.values};
  if(manual==='reference')for(const nutrient of nutrients)delete values[nutrient];
  return{id:intent.source.row,date:intent.date,mode:intent.mode,values,parts:[],photos:[...intent.photos],ingredient:{...intent.ingredient}};
}
function scaledIntent(book:Workbook,intent:LinkedNutritionIntent,choice:ConverterChoice):FoodValues{
  const calculated=scaledDraft(book,linkedFood(intent,'reference'));
  if(calculated.issue)throw Error(calculated.issue);
  for(const nutrient of nutrients)strictNutritionNumber(calculated.values[nutrient]??'',`${intent.key} ${nutrient}`);
  const conflicts=nutrients.filter(field=>intent.overrides[field]?.trim()&&Number(intent.overrides[field])!==Number(calculated.values[field]));
  if(conflicts.length&&!choice.manual)throw Error(`Review linked Draft manual ${conflicts.join(', ')} overrides and choose Keep manual or Use reference.`);
  const result=scaledDraft(book,linkedFood(intent,choice.manual??'keep'));
  if(result.issue)throw Error(result.issue);
  for(const nutrient of nutrients)strictNutritionNumber(result.values[nutrient]??'',`${intent.key} ${nutrient}`);
  if(result.missing.length)throw Error('The linked Ingredient still has missing nutrition.');
  return result.values;
}
function linkedTarget(intent:LinkedNutritionIntent,choice:ConverterChoice){
  if(intent.target&&choice.target&&choice.target.table!==intent.target.table)throw Error('A captured linked Draft destination cannot be diverted to another table.');
  return intent.target??choice.target;
}
export function preflightNutritionApply(book:Workbook,batch:NutritionBatch,review:ConverterReview):{plan:ConverterPlan;issues:ConverterIssue[]}{
  const checked=reviewNutritionTable(batch,review),issues=[...checked.issues];
  const plan:ConverterPlan={batch:batch.id,revision:book.revision,signature:converterSignature(review),items:checked.items,linked:[]};
  if(book.foodCapture?.builder?.id!==batch.id)issues.push({message:'The active batch changed. Reopen this batch before applying.'});
  const candidates=new Map(nutritionCandidates(book,batch.days).map(item=>[item.key,item]));
  for(const reviewed of checked.items){
    const item=reviewed.item;
    try{
      const current=candidates.get(item.key);
      if(!current||current.fingerprint!==item.fingerprint||!sameRequestPayload(current,item))throw Error('Captured source changed, was removed, or its saved identity/payload is inconsistent. Reset/review a fresh batch rather than overwriting newer values.');
      if(item.kind==='ingredient'){
        if(!item.reference||item.reference.table!==item.source.table||item.reference.row!==item.source.row)throw Error('Ingredient source identities do not match.');
        const source=ingredientRecord(book,item.reference);
        for(const [field,text]of Object.entries(reviewed.values))if(text!==undefined&&text!==''&&!source.table.columns.some(column=>column.id===source.mapping.fields[field as MealField]))throw Error(`Restore the Ingredients ${field} field before applying.`);
        const pending=book.foodCapture?.ingredientEdits[ingredientKey(item.reference)];
        if(pending)throw Error('This Ingredient has unsaved editor changes. Save or cancel them before applying nutrition.');
      }else if(item.kind==='logged'){
        const source=allTables(book).find(table=>table.id===item.source.table),sheet=source?allSheets(book).find(sheet=>sheet.id===source.sheet):undefined;
        if(!source||!sheet||!source.rows.includes(item.source.row))throw Error('The original logged source row was removed.');
        const {fields}=mappedFields(book,sheet,source.id);requireFields(fields,consumedValues(reviewed.values));
      }else{
        if(item.date===undefined)throw Error('The captured Draft date is missing.');
        const target=destination(book,targetFor(item,review.choices[item.id]));requireFields(target.context.fields.size?new Map([...target.context.fields].map(([field,column])=>[field,column.column])):new Map(),consumedValues(draftValues(reviewed)));
        if(!book.foodCapture?.foods.some(food=>food.id===item.source.row))throw Error('The original Draft was removed.');
      }
    }catch(error){issues.push({item:item.id,message:describe(error)});}
  }
  const intents=new Map(batch.linkedIntents?.map(intent=>[intent.key,intent])??[]);
  const currentIntents=new Map(linkedNutritionIntents(book,batch.days).map(intent=>[intent.key,intent]));
  const changed=new Set(changedLinkedNutritionIntents(book,batch));
  for(const [intentKey,choice]of Object.entries(review.linkedChoices??{})){
    if(!choice.include)continue;
    const intent=intents.get(intentKey);
    try{
      if(!intent||!batch.days.includes(intent.date))throw Error('This linked Draft was not captured for the selected days. Reset/review the batch.');
      if(changed.has(intentKey)||JSON.stringify(normalized(currentIntents.get(intentKey)))!==JSON.stringify(normalized(intent)))throw Error('Captured linked Draft source, consumption, reference or destination changed, or its saved payload is inconsistent. Review a fresh batch.');
      const target=destination(book,linkedTarget(intent,choice));
      requireFields(new Map([...target.context.fields].map(([field,column])=>[field,column.column])),intent.values);
      ingredientRecord(book,intent.ingredient);
      const request=batch.items.find(item=>item.kind==='ingredient'&&item.reference&&ingredientKey(item.reference)===ingredientKey(intent.ingredient));
      const reference=request?candidates.get(request.key):undefined;
      if(!request||!reference||reference.fingerprint!==request.fingerprint||!sameRequestPayload(reference,request))throw Error('The captured Ingredient reference changed or was not captured. Review a fresh batch before logging linked consumption.');
      plan.linked.push({intent,choice});
    }catch(error){issues.push({item:intentKey,message:describe(error)});}
  }
  if(!plan.items.length&&!plan.linked.length&&!issues.length)issues.push({message:'Select at least one captured result or linked Draft.'});
  return{plan,issues};
}
function linkNutrition(book:Workbook,sheet:Sheet,row:string,fields:Map<MealField,string>,intent:LinkedNutritionIntent,choice:ConverterChoice):void{
  const source=ingredientRecord(book,intent.ingredient),consumed=intent.values;
  const fieldFor=(field:MealField)=>source.table.columns.find(column=>column.id===source.mapping.fields[field])?.column;
  for(const field of ['weight','amount','unit'] as const){
    if(!fields.has(field))throw Error(`Restore the consumed ${field} mapping before linked logging.`);
    if(!fieldFor(field))throw Error(`Restore the Ingredient ${field} mapping before linked logging.`);
  }
  const sourceFields=new Map(mealFields.flatMap(field=>{const column=fieldFor(field);return column?[[field,column] as const]:[];}));
  const formulas=ingredientConsumptionCalculations({sheet:sheet.id,row,fields},{sheet:source.sheet.id,row:intent.ingredient.row,fields:sourceFields});
  const weightColumn=fields.get('weight')!,weightCell=getCell(sheet,row,weightColumn);
  if(!consumed.weight?.trim()&&consumed.amount?.trim()){
    sheet.cells[key(row,weightColumn)]={...weightCell,value:undefined,calculation:undefined,formula:formulas.weight};
  }
  for(const nutrient of nutrients){
    const column=fields.get(nutrient),sourceColumn=fieldFor(nutrient);
    if(!column||!sourceColumn)throw Error(`Restore the ${nutrient} mapping before linked logging.`);
    const previous=getCell(sheet,row,column),formula=formulas.nutrition.get(nutrient)!;
    sheet.cells[key(row,column)]=choice.manual!=='reference'&&intent.overrides[nutrient]?.trim()?{...previous,calculation:formula}:{...previous,value:undefined,calculation:undefined,formula};
  }
}
function logValues(book:Workbook,target:NutritionTarget|undefined,date:number,values:FoodValues,linked?:{intent:LinkedNutritionIntent;choice:ConverterChoice}){
  values=consumedValues(values);
  const {table,sheet}=destination(book,target);
  const day=createMasterDay(book,sheet,false,false,{date,advance:false});
  const row=day.created?mealLogContext(book,sheet).blocks.find(block=>block.header===day.row)!.rows[1]:addMasterFood(book,sheet,day.row),{fields}=mappedFields(book,sheet,table.id);requireFields(fields,values);
  for(const [field,value]of Object.entries(values)){
    const column=fields.get(field as MealField);if(column&&value!==undefined)literalWrite(book,sheet,row,field as MealField,column,value);
  }
  if(linked){
    const ingredient=linked.intent.ingredient,source=ingredientRecord(book,ingredient),name=source.table.columns.find(column=>column.id===source.mapping.fields.food);
    if(!name)throw Error('Restore the Ingredient name mapping before logging.');
    const foodColumn=fields.get('food')!,cell=getCell(sheet,row,foodColumn);
    sheet.cells[key(row,foodColumn)]={...cell,value:undefined,formula:undefined,binding:{table:ingredient.table,row:ingredient.row,column:name.id}};
    linkNutrition(book,sheet,row,fields,linked.intent,linked.choice);
  }
  markMealNeedsNutrition(book,sheet,row);return{table:table.id,row};
}
function removeDraftSource(book:Workbook,source:NutritionItem['source']):void{
  const data=captureData(book),food=data.foods.find(food=>food.id===source.row);
  if(!food)throw Error('The original Draft disappeared during conversion.');
  if(food.mode==='multi'){
    if(!source.part||!food.parts.some(part=>part.id===source.part))throw Error('The original Multi part disappeared during conversion.');
    food.parts=food.parts.filter(part=>part.id!==source.part);
    if(food.parts.some(part=>part.text.trim())){food.values.food=food.parts.map(part=>part.text).join('\n');return;}
  }
  data.foods=data.foods.filter(item=>item.id!==food.id);
  if(data.nutritionConflicts)data.nutritionConflicts=data.nutritionConflicts.filter(conflict=>conflict.kind==='logged'||conflict.food!==food.id);
}
function logRestaurant(book:Workbook,target:{table:string;row:string},name:string,original:RestaurantLink):void{
  const link:RestaurantLink={};
  if(name===restaurantName(book,original)){
    if(original.restaurant!==undefined)link.restaurant=original.restaurant;
    if(original.restaurantText!==undefined)link.restaurantText=original.restaurantText;
  }else setRestaurant(book,link,name);
  if(link.restaurant!==undefined||link.restaurantText!==undefined)(captureData(book).loggedDetails??={})[`${target.table}:${target.row}`]=link;
}
export function prepareNutritionApply(book:Workbook,batch:NutritionBatch,review:ConverterReview,receipts:readonly ConverterReceipt[]=[]):PreparedNutritionApply{
  if(book.foodCapture?.builder?.id!==batch.id||review.batch!==batch.id)throw Error('The active nutrition batch changed. Reopen the matching batch before applying.');
  const signature=converterSignature(review),prior=receipts.find(receipt=>receipt.batch===batch.id&&receipt.signature===signature);
  if(prior)return{book:clone(book),receipt:clone(prior),plan:{batch:batch.id,revision:book.revision,signature,items:[],linked:[]},alreadyApplied:true};
  const {plan,issues}=preflightNutritionApply(book,batch,review);
  if(issues.length)throw Error(issues.map(issue=>`${issue.item?issue.item+': ':''}${issue.message}`).join('\n'));
  const requested=[...plan.items.map(({item})=>({key:item.key,kind:item.kind})),...plan.linked.map(({intent})=>({key:intent.key,kind:'draft'}))];
  for(const request of requested)if(receipts.some(receipt=>(receipt.batch===batch.id||request.kind==='draft')&&receipt.entries.some(entry=>entry.key===request.key)))throw Error(`${request.key} was already applied. Undo that operation or create a fresh request; retry cannot log it twice.`);
  const next=clone(book),entries:ConverterReceiptEntry[]=[];
  rememberNutritionConversions(next);
  const before=captureNutritionReview(next);
  for(const reviewed of plan.items.filter(({item})=>item.kind==='ingredient')){
    const {item,values,description}=reviewed;
    writeIngredientValues(next,item.reference!,values);
    entries.push({key:item.key,item:item.id,kind:'ingredient',target:{...item.reference!},source:clone(item),values:{...values},...(description?{removedDescription:description}:{})});
  }
  for(const reviewed of plan.items.filter(({item})=>item.kind!=='ingredient')){
    const {item,values,description}=reviewed;
    let target:ConverterReceiptEntry['target'],originalDraft:DraftFood|undefined;
    if(item.kind==='logged'){
      const table=allTables(next).find(table=>table.id===item.source.table)!,sheet=allSheets(next).find(sheet=>sheet.id===table.sheet)!;
      const {fields}=mappedFields(next,sheet,table.id);
      for(const [field,value]of Object.entries(values)){
        const column=fields.get(field as MealField);
        if(column&&value!==undefined)literalWrite(next,sheet,item.source.row,field as MealField,column,value);
      }
      markMealNeedsNutrition(next,sheet,item.source.row);target={table:table.id,row:item.source.row};
    }else{
      originalDraft=clone(captureData(next).foods.find(food=>food.id===item.source.row)!);
      target=logValues(next,targetFor(item,review.choices[item.id]),item.date!,draftValues(reviewed));
      logRestaurant(next,target,item.restaurant,originalDraft);
    }
    entries.push({key:item.key,item:item.id,kind:item.kind,target,source:clone(item),originalDraft,values:{...values},...(description?{removedDescription:description}:{})});
  }
  for(const {intent,choice}of plan.linked){
    const values=scaledIntent(next,intent,choice),originalDraft=clone(captureData(next).foods.find(food=>food.id===intent.source.row)!);
    const target=logValues(next,linkedTarget(intent,choice),intent.date,values,{intent,choice});
    logRestaurant(next,target,intent.restaurant,originalDraft);
    entries.push({key:intent.key,kind:'linked',target,source:clone(intent),originalDraft,values:{...values}});
  }
  // Remove only after every route has succeeded on the private clone.
  for(const entry of entries)if(entry.kind==='draft'||entry.kind==='linked')removeDraftSource(next,entry.source.source);
  queueNutritionReview(next,before);
  const receipt:ConverterReceipt={schema:1,id:uid(),batch:batch.id,signature,created:new Date().toISOString(),entries,...(review.source?{response:clone(review.source)}:{})};
  return{book:next,receipt,plan,alreadyApplied:false};
}
export function validateConverterReceipt(value:unknown):asserts value is ConverterReceipt{
  const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const text=(value:unknown)=>typeof value==='string'&&value.length<=2_000_000;
  const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(value);
  if(!record(value)||value.schema!==1||!id(value.id)||!id(value.batch)||!text(value.signature)||!value.signature||!text(value.created)||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>10000)throw Error('Invalid nutrition apply receipt.');
  const items:unknown[]=[],linked:unknown[]=[],drafts=new Map<string,unknown>(),keys=new Set<string>();
  for(const entry of value.entries){
    if(!record(entry)||!text(entry.key)||keys.has(String(entry.key))||!['ingredient','logged','draft','linked'].includes(String(entry.kind))||!record(entry.target)||!id(entry.target.table)||!id(entry.target.row)||!record(entry.source)||!record(entry.values)||Object.entries(entry.values).some(([field,text])=>!mealFields.includes(field as MealField)||typeof text!=='string')||entry.removedDescription!==undefined&&!text(entry.removedDescription))throw Error('Invalid nutrition apply receipt entry.');
    keys.add(String(entry.key));
    if(entry.source.key!==entry.key)throw Error('Receipt source identities do not match.');
    if(entry.kind==='linked')linked.push(entry.source);
    else{
      if(entry.kind!==entry.source.kind||entry.item!==entry.source.id)throw Error('Receipt request identities do not match.');
      items.push(entry.source);
    }
    if(entry.originalDraft!==undefined){
      const food=entry.originalDraft;
      if(!record(food)||typeof food.id!=='string'||drafts.has(food.id)&&JSON.stringify(normalized(drafts.get(food.id)))!==JSON.stringify(normalized(food)))throw Error('Invalid receipt Draft context.');
      drafts.set(food.id,food);
    }
  }
  const data={schema:1,foods:[...drafts.values()],restaurants:[],photos:[],ingredientMappings:[],ingredientDetails:{},ingredientEdits:{},nameVersions:[],builder:{id:value.batch,created:value.created,days:[],multiDay:false,items,linkedIntents:linked,generated:true,selectOpen:false,reviewNames:false,promptOpen:false,template:'',prompt:''}};
  validateFoodCapture(data);
  if(value.response!==undefined){
    const response=value.response;
    if(!record(response)||!text(response.raw)||!text(response.html))throw Error('Invalid receipt response context.');
    validateConverterState({...newConverterState(String(value.batch)),raw:response.raw,html:response.html,...(response.table!==undefined?{parsed:response.table}:{})});
  }
}
