import {captureData,createFoodCaptureContext,ingredientKey,ingredientRecord,ingredientSource,nutritionConversionColumns,nutrients,numberValue,scaledDraft,type FoodCaptureContext,type FoodValues,type IngredientIdentity,type Nutrient} from './food-capture';
import {Engine,scalar,type Ast} from './formula';
import {allSheets,allTables,isFault,key,setInput,type Workbook} from './model';
import {mapMealFields} from './meal-log';
import {restoreCalculation} from './calculation';
import {editSnapshot} from './undo-history';
import {ingredientConsumptionCalculations} from './ingredient-calculation';
import {nutritionDependencyFilter} from './nutrition-dependencies';

interface ConflictValues{
  food:string;fields:Nutrient[];
  manual:FoodValues;calculated:FoodValues;
}
export interface DraftNutritionConflict extends ConflictValues{kind?:'draft';ingredient:IngredientIdentity}
export interface LoggedNutritionTarget{sheet:string;table:string;row:string}
export interface LoggedNutritionConflict extends ConflictValues{kind:'logged';target:LoggedNutritionTarget}
export type NutritionConflict=DraftNutritionConflict|LoggedNutritionConflict;
export interface DraftNutritionSnapshot{ingredient:IngredientIdentity;values:FoodValues}
export function captureDraftNutrition(book:Workbook,identity:IngredientIdentity,engine=new Engine(book)):Map<string,DraftNutritionSnapshot>{
  const context=createFoodCaptureContext(book,engine),result=new Map<string,DraftNutritionSnapshot>();
  for(const food of book.foodCapture?.foods??[]){
    if(!food.ingredient||ingredientKey(food.ingredient)!==ingredientKey(identity))continue;
    const values={...food.values};for(const field of nutrients)delete values[field];
    result.set(food.id,{ingredient:{...identity},values:scaledDraft(book,{...food,values},context).values});
  }
  return result;
}
export function queueDraftNutritionReview(book:Workbook,before:Map<string,DraftNutritionSnapshot>,context=createFoodCaptureContext(book)):DraftNutritionConflict[]{
  const data=book.foodCapture;if(!data||!before.size)return[];
  const incoming:DraftNutritionConflict[]=[];
  const previous=data.nutritionConflicts??[],pending=new Map(previous.filter(item=>item.kind!=='logged').map(item=>[item.food,item]));
  for(const food of data.foods){
    const old=before.get(food.id);if(!old||!food.ingredient||ingredientKey(old.ingredient)!==ingredientKey(food.ingredient))continue;
    const values={...food.values};for(const field of nutrients)delete values[field];
    const calculated=scaledDraft(book,{...food,values},context).values;
    const changed=nutrients.filter(field=>numberValue(old.values[field])!==numberValue(calculated[field]));
    const prior=pending.get(food.id);
    const fields=nutrients.filter(field=>(changed.includes(field)||prior?.fields.includes(field))&&food.values[field]?.trim()&&(numberValue(calculated[field])===undefined||numberValue(food.values[field])!==numberValue(calculated[field])));
    if(fields.length)incoming.push({food:food.id,ingredient:{...food.ingredient},fields,manual:{...food.values},calculated:{...calculated}});
  }
  const next=[...previous.filter(item=>item.kind==='logged'||!before.has(item.food)),...incoming];
  if(JSON.stringify(previous)!==JSON.stringify(next))data.nutritionConflicts=next;
  return incoming;
}
interface LoggedNutritionSnapshot{target:LoggedNutritionTarget;manual:FoodValues;values:FoodValues;signatures:Partial<Record<Nutrient,string>>;formulas:Partial<Record<Nutrient,Ast>>}
export interface NutritionReviewSnapshot{drafts:Map<string,DraftNutritionSnapshot>;logged:Map<string,LoggedNutritionSnapshot>;scope:'all'|'draft';partial?:boolean}
function logContexts(book:Workbook){
  const tables=allTables(book),sheets=new Map(allSheets(book).map(sheet=>[sheet.id,sheet]));
  return book.sheets.flatMap(sheet=>{
    const id=sheet.mealLog?.table??sheet.dayLogging?.table;
    const table=tables.find(table=>table.sheet===sheet.id&&(id?table.id===id:table.name.toLowerCase()==='master'));
    if(!table)return[];
    const mapping={...mapMealFields(table),...sheet.mealLog?.fields};
    const fields=new Map(Object.entries(mapping).flatMap(([field,id])=>{
      const column=table.columns.find(column=>column.id===id);return column?[[field,column] as const]:[];
    }));
    const target=sheet.mealLog?.ingredients,stored=book.foodCapture?.ingredientMappings;
    const ingredientId=target?.table??stored?.find(mapping=>tables.some(table=>table.id===mapping.table))?.table;
    const ingredient=ingredientId?tables.find(table=>table.id===ingredientId):tables.find(table=>table.name.toLowerCase()==='ingredients');
    const ingredientSheet=ingredient?sheets.get(ingredient.sheet):undefined;
    const sourceMapping=ingredient?{...mapMealFields(ingredient,true),...target?.fields,...stored?.find(mapping=>mapping.table===ingredient.id)?.fields}:undefined;
    const source=ingredient&&ingredientSheet&&sourceMapping?{table:ingredient,sheet:ingredientSheet.id,rows:new Set(ingredient.rows),name:sourceMapping.food,fields:new Map(Object.entries(sourceMapping).flatMap(([field,id])=>{
      const column=ingredient.columns.find(column=>column.id===id);return column?[[field,column.column] as const]:[];
    }))}:undefined;
    return[{sheet,table,rows:new Set(table.rows),fields,addresses:new Map([...fields].map(([field,column])=>[field,column.column])),source}];
  });
}
function linkedCalculations(context:ReturnType<typeof logContexts>[number],row:string){
  const food=context.fields.get('food'),binding=food?context.sheet.cells[key(row,food.column)]?.binding:undefined,source=context.source;
  if(!binding||!source||binding.table!==source.table.id||binding.column!==source.name||!source.rows.has(binding.row)||!source.fields.has('food'))return;
  return ingredientConsumptionCalculations({sheet:context.sheet.id,row,fields:context.addresses},{sheet:source.sheet,row:binding.row,fields:source.fields});
}
function ingredientMembership(context:FoodCaptureContext){
  const tables=new Map<string,Set<string>>();
  return(identity:IngredientIdentity)=>{
    let rows=tables.get(identity.table);
    if(!rows){const table=context.tablesById.get(identity.table);if(!table)return false;tables.set(identity.table,rows=new Set(table.rows));}
    return rows.has(identity.row);
  };
}
function readLogged(context:ReturnType<typeof logContexts>[number],row:string,engine:Engine|(()=>Engine),projection?:ReturnType<typeof nutritionDependencyFilter>):LoggedNutritionSnapshot|undefined{
  const {sheet,table,fields}=context,manual:FoodValues={},values:FoodValues={},signatures:LoggedNutritionSnapshot['signatures']={},formulas:LoggedNutritionSnapshot['formulas']={};
  const reader=()=>typeof engine==='function'?engine():engine;
  let linked:ReturnType<typeof linkedCalculations>,checkedLink=false;
  for(const field of nutrients){
    const column=fields.get(field);if(!column)continue;
    const cell=sheet.cells[key(row,column.column)];
    if(!cell||cell.formula||cell.binding||cell.value===null||cell.value===undefined||cell.value==='')continue;
    if(!cell.calculation&&!checkedLink){linked=linkedCalculations(context,row);checkedLink=true;}
    const formula=cell.calculation??linked?.nutrition.get(field);if(!formula)continue;
    const food=fields.get('food'),changedLink=projection&&!cell.calculation&&food&&projection.cell(sheet.id,row,food.column);
    if(projection&&!changedLink&&!projection.cell(sheet.id,row,column.column)&&!projection.calculation(formula,sheet.id,row,column.column))continue;
    manual[field]=cell.fractionInput??String(cell.value);
    const result=scalar(reader().evaluateCalculation(formula,sheet.id,row,column.column));
    values[field]=isFault(result)?result.error:String(result??'');
    signatures[field]=JSON.stringify(formula);formulas[field]=formula;
  }
  if(!Object.keys(signatures).length)return;
  const food=fields.get('food'),name=food?scalar(reader().cell(sheet.id,row,food.column)):row;
  manual.food=isFault(name)?name.error:String(name??'');
  return{target:{sheet:sheet.id,table:table.id,row},manual,values,signatures,formulas};
}
/** The supplied Engine must be current; discard the snapshot after one mutation. */
export function captureNutritionReview(book:Workbook,engine:Engine|(()=>Engine)=()=>new Engine(book),scope:'all'|'draft'|{drafts:ReadonlySet<string>}|{cells:ReadonlySet<string>}='all'):NutritionReviewSnapshot{
  if(typeof engine!=='function'&&engine.book!==book)throw Error('The food capture Engine belongs to a different workbook.');
  let current:Engine|undefined;
  const reader=()=>{
    if(!current){
      current=typeof engine==='function'?engine():engine;
      if(current.book!==book)throw Error('The food capture Engine belongs to a different workbook.');
      current.beginPass();
    }
    return current;
  };
  const context=createFoodCaptureContext(book,reader),drafts=new Map<string,DraftNutritionSnapshot>(),logged=new Map<string,LoggedNutritionSnapshot>();
  const selected=typeof scope==='object'&&'drafts'in scope?scope.drafts:undefined;
  const changes=typeof scope==='object'&&'cells'in scope?scope.cells:undefined;
  let projection:ReturnType<typeof nutritionDependencyFilter>|undefined,conversionsChanged:boolean|undefined,checkingConversions=false;
  const conversionChanges=():boolean=>{
    if(checkingConversions)return true;
    if(conversionsChanged!==undefined)return conversionsChanged;
    checkingConversions=true;
    try{return conversionsChanged=nutritionConversionColumns(context).some(({table,from,to,factor})=>table.rows.some(row=>[from,to,factor].some(column=>projection!.cell(table.sheet,row,column))));}
    finally{checkingConversions=false;}
  };
  if(changes)projection=nutritionDependencyFilter(book,changes,conversionChanges);
  const present=ingredientMembership(context);
  const pending=new Set(book.foodCapture?.nutritionConflicts?.filter(review=>review.kind!=='logged').map(review=>review.food));
  for(const food of book.foodCapture?.foods??[]){
    if(selected&&!selected.has(food.id))continue;
    if(!food.ingredient||!nutrients.some(field=>food.values[field]?.trim())&&!pending.has(food.id))continue;
    if(!present(food.ingredient))continue;
    if(projection){
      const source=ingredientSource(context,food.ingredient);
      if(!conversionChanges()&&![...source.columns.values()].some(column=>column&&projection.cell(source.sheet.id,food.ingredient!.row,column.column)))continue;
    }
    const values={...food.values};for(const field of nutrients)delete values[field];
    drafts.set(food.id,{ingredient:{...food.ingredient},values:scaledDraft(book,{...food,values},context).values});
  }
  const draftOnly=scope==='draft'||selected!==undefined;
  const pendingLogged=new Set(book.foodCapture?.nutritionConflicts?.filter(review=>review.kind==='logged').map(review=>review.food));
  if(!draftOnly)for(const context of logContexts(book))for(const row of context.table.rows){
    const id=`${context.table.id}:${row}`,snapshot=readLogged(context,row,reader,projection);
    if(snapshot)logged.set(id,snapshot);
    else if(changes&&pendingLogged.has(id)&&[...context.fields.values()].some(column=>changes.has(`${context.sheet.id}:${key(row,column.column)}`))){
      logged.set(id,{target:{sheet:context.sheet.id,table:context.table.id,row},manual:{},values:{},signatures:{},formulas:{}});
    }
  }
  return{drafts,logged,scope:draftOnly?'draft':'all',partial:!!projection};
}
export function queueNutritionReview(book:Workbook,before:NutritionReviewSnapshot,engine=new Engine(book)):NutritionConflict[]{
  engine.beginPass();
  const context=createFoodCaptureContext(book,engine);
  const foods=new Map(book.foodCapture?.foods.map(food=>[food.id,food])),present=ingredientMembership(context);
  const liveDrafts=new Map([...before.drafts].filter(([id,snapshot])=>{
    const food=foods.get(id);
    return food?.ingredient&&ingredientKey(food.ingredient)===ingredientKey(snapshot.ingredient)&&present(snapshot.ingredient);
  }));
  const incoming:NutritionConflict[]=[...queueDraftNutritionReview(book,liveDrafts,context)];
  const previous=book.foodCapture?.nutritionConflicts??[],contexts=new Map(logContexts(book).map(context=>[context.table.id,context]));
  const pending=new Map(previous.filter(review=>review.kind==='logged').map(review=>[review.food,review]));
  const targets=new Map([...before.logged].map(([id,snapshot])=>[id,snapshot.target]));
  if(before.scope==='all'&&!before.partial)for(const review of previous)if(review.kind==='logged')targets.set(review.food,review.target);
  const logged:LoggedNutritionConflict[]=[];
  for(const [id,target]of targets){
    const context=contexts.get(target.table);
    if(!context||context.sheet.id!==target.sheet||!context.rows.has(target.row))continue;
    const current=readLogged(context,target.row,engine);if(!current)continue;
    const old=before.logged.get(id),prior=pending.get(id);
    const fields=nutrients.filter(field=>current.signatures[field]&&
      (old?.signatures[field]&&(old.values[field]!==current.values[field]||old.signatures[field]!==current.signatures[field])||prior?.fields.includes(field))&&
      (numberValue(current.values[field])===undefined||numberValue(current.manual[field])!==numberValue(current.values[field])));
    if(fields.length)logged.push({kind:'logged',food:id,target:{...target},fields,manual:{...current.manual},calculated:{...current.values}});
  }
  incoming.push(...logged);
  const draftIds=new Set(book.foodCapture?.foods.filter(food=>food.ingredient&&present(food.ingredient)).map(food=>food.id));
  const next=[...(book.foodCapture?.nutritionConflicts??[]).filter(review=>review.kind==='logged'?before.scope==='draft'||!!before.partial&&!before.logged.has(review.food):draftIds.has(review.food)),...logged];
  if(JSON.stringify(previous)!==JSON.stringify(next)||!book.foodCapture&&next.length)captureData(book).nutritionConflicts=next;
  return incoming;
}
export interface NutritionReviewRow{
  key:string;food:string;field:Nutrient;name:string;kind:'draft'|'logged';
  manual:string;calculated:string|undefined;signature?:string;
}
export function nutritionReviewRows(book:Workbook,engine=new Engine(book)):NutritionReviewRow[]{
  engine.beginPass();
  const context=createFoodCaptureContext(book,engine),contexts=new Map(logContexts(book).map(context=>[context.table.id,context]));
  const foods=new Map(book.foodCapture?.foods.map(food=>[food.id,food])),present=ingredientMembership(context);
  const unavailable=(review:NutritionConflict,message:string):NutritionReviewRow[]=>review.fields.map(field=>({
    key:`${review.kind==='logged'?'logged':'draft'}:${review.food}:${field}`,food:review.food,field,
    name:review.manual.food||review.food,kind:review.kind==='logged'?'logged':'draft',manual:review.manual[field]??'',calculated:message
  }));
  return(book.foodCapture?.nutritionConflicts??[]).flatMap((review):NutritionReviewRow[]=>{
    if(review.kind==='logged'){
      const context=contexts.get(review.target.table);
      if(!context||context.sheet.id!==review.target.sheet||!context.rows.has(review.target.row))return unavailable(review,'Unavailable: the Logged food or its mapped table was removed.');
      const current=readLogged(context,review.target.row,engine);if(!current)return unavailable(review,'Unavailable: this food no longer has a retained calculation or explicit Ingredient link.');
      return review.fields.map(field=>({
        key:`logged:${review.food}:${field}`,food:review.food,field,name:current.manual.food??review.food,kind:'logged' as const,
        manual:current.manual[field]??review.manual[field]??'',calculated:current.signatures[field]?current.values[field]:'Unavailable: this field no longer has a retained calculation or explicit Ingredient link.',signature:current.signatures[field]
      }));
    }
    const food=foods.get(review.food);
    if(!food?.ingredient||ingredientKey(food.ingredient)!==ingredientKey(review.ingredient)||!present(food.ingredient))return unavailable(review,'Unavailable: this Draft food or its Ingredient link changed or was removed.');
    const values={...food.values};for(const field of nutrients)delete values[field];
    const calculated=scaledDraft(book,{...food,values},context).values;
    return review.fields.map(field=>({
      key:`draft:${review.food}:${field}`,food:review.food,field,name:calculated.food??food.values.food??review.food,kind:'draft' as const,
      manual:food.values[field]??review.manual[field]??'',calculated:food.values[field]?.trim()?calculated[field]:'Unavailable: this manual value was cleared.'
    }));
  });
}
interface NutritionDecision{row:NutritionReviewRow;calculated:boolean}
function writeNutritionChoices(book:Workbook,decisions:NutritionDecision[]):void{
  const contexts=new Map(logContexts(book).map(context=>[context.table.id,context]));
  const foods=new Map(book.foodCapture?.foods.map(food=>[food.id,food]));
  const reviews=new Map(book.foodCapture?.nutritionConflicts?.filter((review):review is LoggedNutritionConflict=>review.kind==='logged').map(review=>[review.food,review]));
  const engine=new Engine(book),snapshots=new Map<string,LoggedNutritionSnapshot|undefined>();
  const writes=decisions.flatMap(({row,calculated})=>{
    if(!calculated||row.kind!=='logged')return[];
    const review=reviews.get(row.food)!,context=contexts.get(review.target.table)!,column=context.fields.get(row.field)!;
    if(!snapshots.has(row.food))snapshots.set(row.food,readLogged(context,review.target.row,engine));
    const formula=snapshots.get(row.food)?.formulas[row.field];
    if(!formula)throw Error('This Logged nutrition calculation changed. Reopen the nutrition review.');
    return[{context,column,row:review.target.row,formula}];
  });
  for(const {row,calculated}of decisions){
    if(!calculated)continue;
    if(row.kind==='draft')delete foods.get(row.food)!.values[row.field];
  }
  for(const {context,column,row,formula}of writes)restoreCalculation(book,context.sheet,row,column.column,formula);
}
export function resolveNutritionReview(book:Workbook,decisions:NutritionDecision[]):void{
  const current=new Map(nutritionReviewRows(book).map(row=>[row.key,row])),seen=new Set<string>();
  for(const {row,calculated}of decisions){
    if(seen.has(row.key)||JSON.stringify(current.get(row.key))!==JSON.stringify(row))throw Error('Food or Ingredient values changed. Reopen this nutrition review.');
    if(calculated&&numberValue(row.calculated)===undefined)throw Error('Fix the unavailable calculation before choosing recalculated nutrition.');
    seen.add(row.key);
  }
  if(decisions.some(decision=>decision.calculated)){
    const proposed=editSnapshot(book);writeNutritionChoices(proposed,decisions);
    const engine=new Engine(proposed),context=createFoodCaptureContext(proposed,engine),contexts=new Map(logContexts(proposed).map(context=>[context.table.id,context]));
    const foods=new Map(proposed.foodCapture?.foods.map(food=>[food.id,food]));
    const reviews=new Map(proposed.foodCapture?.nutritionConflicts?.filter((review):review is LoggedNutritionConflict=>review.kind==='logged').map(review=>[review.food,review]));
    for(const {row,calculated}of decisions){
      if(!calculated)continue;
      let value:string|undefined;
      if(row.kind==='draft')value=scaledDraft(proposed,foods.get(row.food)!,context).values[row.field];
      else{
        const review=reviews.get(row.food)!,context=contexts.get(review.target.table)!,column=context.fields.get(row.field)!;
        const result=scalar(engine.cell(context.sheet.id,review.target.row,column.column));
        value=isFault(result)?result.error:String(result??'');
      }
      if(numberValue(value)===undefined)throw Error(`Recalculated nutrition is unavailable (${value||'missing value'}). Resolve its dependencies or keep the manual value.`);
    }
  }
  writeNutritionChoices(book,decisions);
  if(book.foodCapture)book.foodCapture.nutritionConflicts=(book.foodCapture.nutritionConflicts??[]).flatMap(review=>{
    const fields=review.fields.filter(field=>!seen.has(`${review.kind==='logged'?'logged':'draft'}:${review.food}:${field}`));
    return fields.length?[{...review,fields}]:[];
  });
}
export function writeIngredientValues(book:Workbook,identity:IngredientIdentity,values:FoodValues&{type?:string},context?:FoodCaptureContext):void{
  const source=context?ingredientRecord(book,identity,context):ingredientSource(createFoodCaptureContext(book),identity);
  const writes=Object.entries(values).filter(([field])=>field!=='notes').map(([field,text])=>{
    const column=source.table.columns.find(column=>column.id===source.mapping.fields[field as keyof typeof source.mapping.fields]);
    if(!column)throw Error(`Restore the Ingredients ${field} field before applying this edit.`);
    return{field,text,column};
  });
  if(values.notes!==undefined&&!book.foodCapture)throw Error('Initialize food capture before editing Ingredient notes.');
  for(const {field,text,column}of writes)setInput(book,source.sheet,identity.row,column.column,['food','unit','type'].includes(field)?"'"+text:text);
  if(values.notes!==undefined){
    const data=book.foodCapture;if(!data)throw Error('Initialize food capture before editing Ingredient notes.');
    const key=ingredientKey(identity),previous=data.ingredientDetails[key];
    data.ingredientDetails[key]={notes:values.notes,photos:[...(previous?.photos??[])]};
  }
}
