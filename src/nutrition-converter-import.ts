import {allSheets,allTables,clone,key,setInput,uid,validateTableRowTemplates,type Validation,type Workbook} from './model';
import {ingredientMapping,nutrients,type FoodValues,type NutritionTarget} from './food-capture';
import {addIngredientTableRows} from './ingredient-table';
import {addMasterFood,addMasterFoods,createMasterDay,masterLogging,reviewMasterFoods} from './day-logging';
import {mealLogConfig,mealLogContext,markMealNeedsNutrition,type MealField} from './meal-log';
import {compile,Engine} from './formula';
import {validationChoiceGroups} from './references';
import {excelDateText,parseDateInput} from './dates';
import {converterFields,inferNutritionField,mapNutritionTable,separateDescription,strictNutritionNumber,type ConverterRow,type ParsedNutritionTable} from './nutrition-table';

export interface StandaloneDestination extends NutritionTarget{
  kind:'master'|'ingredients';fields:Partial<Record<MealField|'type',string>>;
}
export interface StandaloneConverterState{
  schema:1;operation:string;raw:string;html:string;parsed?:ParsedNutritionTable;rows:ConverterRow[];
  processedRaw?:string;removeDescription:boolean;target?:StandaloneDestination;date:string;types:string[];
  status:'editing'|'applying'|'applied'|'failed';
  pendingMapping?:ParsedNutritionTable['mapping'];
}
export interface StandaloneReview{
  operation:string;raw:string;html:string;parsed:ParsedNutritionTable;rows:ConverterRow[];
  removeDescription:boolean;target:StandaloneDestination;date:string;types:string[];
}
export interface StandaloneReceipt{
  schema:1;id:string;operation:string;signature:string;created:string;review:StandaloneReview;
  entries:{target:{table:string;row:string};values:FoodValues;type?:string;removedDescription?:string}[];
}
export interface StandaloneImportPlan{
  signature:string;alreadyApplied:boolean;date?:number;
  entries:{values:FoodValues;type?:string;removedDescription?:string}[];
}
export function newStandaloneConverterState():StandaloneConverterState{
  return{schema:1,operation:uid(),raw:'',html:'',rows:[],removeDescription:false,date:'',types:[],status:'editing'};
}
function orderedFields(fields:StandaloneDestination['fields']){
  return Object.fromEntries(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)));
}
export function standaloneSignature(review:StandaloneReview):string{
  return JSON.stringify({operation:review.operation,rows:review.rows,removeDescription:review.removeDescription,target:{kind:review.target.kind,sheet:review.target.sheet,table:review.target.table,fields:orderedFields(review.target.fields)},date:review.date,types:review.types});
}
export function standaloneReview(state:StandaloneConverterState):StandaloneReview{
  validateStandaloneState(state);
  if(state.pendingMapping)throw Error('Rebuild the pending column mapping before reviewing or adding.');
  if(!state.parsed||state.processedRaw!==state.raw)throw Error('Process the current table before reviewing an Add.');
  if(!state.target)throw Error('Choose Master or Ingredients explicitly before reviewing an Add.');
  return clone({operation:state.operation,raw:state.raw,html:state.html,parsed:state.parsed,rows:state.rows,removeDescription:state.removeDescription,target:state.target,date:state.date,types:state.types});
}
export function remapStandaloneTable(state:StandaloneConverterState,mapping:ParsedNutritionTable['mapping']):StandaloneConverterState{
  if(!state.parsed)throw Error('Process a table before changing the mapping.');
  const parsed={...state.parsed,mapping},rows=mapNutritionTable(parsed);
  return{...state,parsed,rows,types:rows.map(()=>''),pendingMapping:undefined,status:'editing'};
}
export function standaloneDestinations(book:Workbook):(StandaloneDestination&{label:string})[]{
  const result:(StandaloneDestination&{label:string})[]=[];
  for(const sheet of book.sheets){
    if(!sheet.dayLogging&&!sheet.mealLog&&!book.tables.some(table=>table.sheet===sheet.id&&table.name==='Master'))continue;
    const context=mealLogContext(book,sheet),day=masterLogging(book,sheet);
    if(day.table.id!==context.table.id)throw Error('The Master logging and Meal log mappings disagree. Restore them before adding a table.');
    result.push({kind:'master',sheet:sheet.id,table:context.table.id,fields:Object.fromEntries([...context.fields].map(([field,column])=>[field,column.id])),label:`Master - ${sheet.name}`});
  }
  if(allTables(book).some(table=>table.name.toLowerCase()==='ingredients')||book.foodCapture?.ingredientMappings.length||book.sheets.some(sheet=>sheet.mealLog?.ingredients)){
    const mapping=ingredientMapping(book),table=allTables(book).find(table=>table.id===mapping.table);
    if(!table||!book.sheets.some(sheet=>sheet.id===table.sheet))throw Error('The configured Ingredients table is not writable.');
    result.push({kind:'ingredients',sheet:table.sheet,table:table.id,fields:{...mapping.fields},label:'Ingredients'});
  }
  return result;
}
function destination(book:Workbook,target:StandaloneDestination){
  const current=standaloneDestinations(book).find(item=>item.kind===target.kind&&item.sheet===target.sheet&&item.table===target.table);
  if(!current||JSON.stringify(orderedFields(current.fields))!==JSON.stringify(orderedFields(target.fields)))throw Error('The chosen destination or field mapping changed. Choose it again and review before adding.');
  const table=allTables(book).find(table=>table.id===current.table)!,sheet=allSheets(book).find(sheet=>sheet.id===current.sheet)!;
  return{table,sheet,fields:current.fields};
}
function standaloneTypeDropdown(book:Workbook,target:StandaloneDestination){
  const {table,sheet,fields}=destination(book,target),column=table.columns.find(column=>column.id===fields.type);
  if(!column)throw Error('Restore the Ingredients Type field before adding Ingredients.');
  const next=table.rows.length?undefined:sheet.rows[sheet.rows.findIndex(row=>row.id===table.header)+1]?.id;
  const occupied=next&&allTables(book).some(other=>other.id!==table.id&&other.sheet===sheet.id&&[other.header,...other.rows].includes(next)&&other.columns.some(field=>field.column===column.column));
  const assigned=new Set(table.rows.length?table.rows:[table.header,...(next&&!occupied?[next]:[])]);
  const validations=sheet.validations.filter(validation=>validation.columns.includes(column.column)&&validation.rows.some(row=>assigned.has(row)));
  if(!validations.length)throw Error('Restore the Ingredients Type dropdown before adding Ingredients; no Type options are invented. For an empty table, assign it to the Type header or the first available row directly below it.');
  const source=(validation:typeof validations[number])=>JSON.stringify([validation.sheet,validation.source,validation.values]);
  if(validations.some(validation=>source(validation)!==source(validations[0])))throw Error('The Ingredients Type column has different dropdown sources. Make them consistent before adding Ingredients.');
  const validation=validations[0],row=validation.rows.find(row=>assigned.has(row))!;
  return{validation,row,column};
}
export function standaloneTypeChoices(book:Workbook,target:StandaloneDestination):string[]{
  if(target.kind!=='ingredients')return[];
  const {validation,row,column}=standaloneTypeDropdown(book,target),engine=new Engine(book);
  const choices=[...new Set(validationChoiceGroups(book,validation,row,column.column,engine).flatMap(group=>group.choices.map(choice=>choice.value)).filter(value=>value.trim()))];
  if(!choices.length)throw Error('The Ingredients Type dropdown has no resolvable nonblank options. Restore its assigned source before adding Ingredients.');
  return choices;
}
function reviewedValues(review:StandaloneReview){
  if(review.parsed.batch||review.rows.some(row=>row.id.trim())||review.parsed.headers.some((header,index)=>(inferNutritionField(header)==='id'||['batchid','itemid'].includes(header.replace(/[\s_*-]/g,'').toLowerCase()))&&review.parsed.rows.some(row=>row[index]?.trim()))){
    throw Error('This table contains Batch or Item IDs. Use Tracked nutrition response; tracked results cannot be imported as new rows.');
  }
  if(!review.rows.length)throw Error('Process at least one result row before adding.');
  return review.rows.map((row,index)=>{
    if(!row.name.trim())throw Error(`Row ${index+1}: Dish Name is required.`);
    const separated=review.removeDescription?separateDescription(row.name):{name:row.name,description:''};
    const values:FoodValues={food:separated.name,weight:'',amount:'',unit:''};
    for(const field of nutrients)values[field]=String(strictNutritionNumber(row[field],`Row ${index+1} ${field}`));
    for(const field of ['weight','amount'] as const){
      const value=strictNutritionNumber(row[field],`Row ${index+1} ${field}`,false);
      if(value!==undefined)values[field]=String(value);
    }
    if(row.unit.trim())values.unit=row.unit.trim();
    if(!!values.amount!==!!values.unit)throw Error(`Row ${index+1}: Amount and Unit must be supplied together.`);
    return{values,description:separated.description};
  });
}
export function preflightStandaloneImport(book:Workbook,review:StandaloneReview){
  const checked=standaloneReview({...review,schema:1,status:'editing',processedRaw:review.raw});
  const target=destination(book,checked.target),rows=reviewedValues(checked);
  let date:number|undefined;
  if(checked.target.kind==='master'){
    date=/^\d{4}-\d{2}-\d{2}$/.test(checked.date)?parseDateInput(checked.date):undefined;
    if(date===undefined||date<1||excelDateText(date)!==checked.date)throw Error('Choose a valid calendar date for Master.');
    if(checked.types.some(Boolean))throw Error('Ingredient Types cannot be written into Master.');
  }else{
    const choices=new Set(standaloneTypeChoices(book,checked.target));
    if(checked.types.length!==rows.length||checked.types.some(type=>!type||!choices.has(type)))throw Error('Choose an existing Type dropdown option for every Ingredient.');
  }
  const fields={...target.fields};
  for(const {values}of rows)for(const [field,value]of Object.entries(values)){
    if(value&&!target.table.columns.some(column=>column.id===fields[field as MealField]))throw Error(`Restore the destination ${field} field before adding; no values will be dropped.`);
  }
  return{rows,date};
}
export function reviewStandaloneImport(book:Workbook,review:StandaloneReview,receipts:readonly StandaloneReceipt[]=[]):StandaloneImportPlan{
  const signature=standaloneSignature(review),prior=receipts.find(receipt=>receipt.operation===review.operation);
  if(prior){
    reviewedValues(review);
    if(prior.signature!==signature)throw Error('This Add was already applied with different values. Start a new table instead.');
    return{signature,alreadyApplied:true,entries:prior.entries.map(({values,type,removedDescription})=>({values:clone(values),...(type?{type}:{}),...(removedDescription?{removedDescription}:{})}))};
  }
  const checked=preflightStandaloneImport(book,review);
  const sheet=allSheets(book).find(sheet=>sheet.id===review.target.sheet)!;
  if(review.target.kind==='master')reviewMasterFoods(book,sheet,checked.date!,checked.rows.length);
  else{
    if(sheet.rows.length+checked.rows.length>100000)throw Error('There is not enough worksheet space to add the Ingredients.');
    validateTableRowTemplates(book,sheet,allTables(book).find(table=>table.id===review.target.table)!);
  }
  return{signature,alreadyApplied:false,date:checked.date,entries:checked.rows.map(({values,description},index)=>({values,...(review.target.kind==='ingredients'?{type:review.types[index]}:{}),...(description?{removedDescription:description}:{})}))};
}
export function prepareStandaloneImport(book:Workbook,review:StandaloneReview,receipts:readonly StandaloneReceipt[]=[]){
  const plan=reviewStandaloneImport(book,review,receipts);
  if(plan.alreadyApplied)return{book:clone(book),receipt:clone(receipts.find(receipt=>receipt.operation===review.operation)!),alreadyApplied:true};
  const next=clone(book),target=destination(next,review.target),entries:StandaloneReceipt['entries']=[];
  const master=review.target.kind==='master'?masterLogging(next,target.sheet):undefined;
  const meal=master?mealLogConfig(next,target.sheet):undefined;
  const completeMaster=!!master&&meal?.table===target.table.id&&meal.fields.food===target.fields.food&&nutrients.every(field=>meal.fields[field]===target.fields[field])&&
    Object.values(target.fields).every(id=>id===undefined||![master.config.date,master.config.marker,master.config.label].includes(id));
  const nutritionComplete=()=>false;
  const emptyType=review.target.kind==='ingredients'&&!target.table.rows.length?standaloneTypeDropdown(next,review.target):undefined;
  const typeValidation:Validation|undefined=emptyType?{...clone(emptyType.validation),id:uid(),rows:[],columns:[emptyType.column.column],
    source:emptyType.validation.values||emptyType.validation.source.startsWith('{')?emptyType.validation.source:JSON.stringify(compile(emptyType.validation.source,next,emptyType.validation.sheet,emptyType.row,emptyType.column.column))}:undefined;
  const write=(row:string,index:number)=>{
    const {values,removedDescription}=plan.entries[index];
    for(const [field,value]of Object.entries(values)){
      const column=target.table.columns.find(column=>column.id===target.fields[field as MealField]);
      if(column&&value!==undefined)setInput(next,target.sheet,row,column.column,['food','unit'].includes(field)?"'"+value:value);
    }
    if(review.target.kind==='ingredients'){
      const column=target.table.columns.find(column=>column.id===target.fields.type)!;
      setInput(next,target.sheet,row,column.column,"'"+review.types[index]);
    }else markMealNeedsNutrition(next,target.sheet,row,completeMaster?nutritionComplete:undefined);
    entries.push({target:{table:target.table.id,row},values:clone(values),...(review.target.kind==='ingredients'?{type:review.types[index]}:{}),...(removedDescription?{removedDescription}:{})});
  };
  if(review.target.kind==='ingredients')addIngredientTableRows(next,plan.entries.length,(identity,index)=>write(identity.row,index));
  else{
    const day=createMasterDay(next,target.sheet,false,false,{date:plan.date!,advance:false});
    const offset=day.created?1:0;
    if(day.created)write(mealLogContext(next,target.sheet).blocks.find(block=>block.header===day.row)!.rows[1],0);
    if(plan.entries.length>offset){
      if(completeMaster)addMasterFoods(next,target.sheet,plan.entries.length-offset,day.row,(row,index)=>write(row,index+offset));
      else for(let index=offset;index<plan.entries.length;index++)write(addMasterFood(next,target.sheet,day.row),index);
    }
  }
  if(typeValidation){typeValidation.rows=entries.map(entry=>entry.target.row);target.sheet.validations.push(typeValidation);}
  const receipt:StandaloneReceipt={schema:1,id:uid(),operation:review.operation,signature:plan.signature,created:new Date().toISOString(),review:clone(review),entries};
  return{book:next,receipt,alreadyApplied:false};
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.length<=2_000_000;
const identity=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,512}$/.test(value);
export function validateStandaloneState(value:unknown):asserts value is StandaloneConverterState{
  if(!record(value)||value.schema!==1||!identity(value.operation)||!text(value.raw)||!text(value.html)||!text(value.date)||typeof value.removeDescription!=='boolean'||!['editing','applying','applied','failed'].includes(String(value.status))||
    !Array.isArray(value.rows)||value.rows.length>5000||!value.rows.every(row=>record(row)&&converterFields.every(field=>text(row[field])))||
    !Array.isArray(value.types)||value.types.length>5000||!value.types.every(text)||value.processedRaw!==undefined&&!text(value.processedRaw))throw Error('Invalid saved standalone converter state.');
  if(value.target!==undefined&&(!record(value.target)||!['master','ingredients'].includes(String(value.target.kind))||!identity(value.target.sheet)||!identity(value.target.table)||!record(value.target.fields)||!Object.entries(value.target.fields).every(([field,id])=>['food',...nutrients,'weight','amount','unit','notes','type'].includes(field)&&identity(id))))throw Error('Invalid standalone destination identities.');
  if(value.parsed!==undefined){
    const parsed=value.parsed;
    if(!record(parsed)||!text(parsed.batch)||!Array.isArray(parsed.headers)||parsed.headers.length>128||!parsed.headers.every(text)||!Array.isArray(parsed.mapping)||parsed.mapping.length!==parsed.headers.length||!parsed.mapping.every(field=>field==='extra'||converterFields.includes(field as typeof converterFields[number]))||
      !Array.isArray(parsed.rows)||parsed.rows.length>5000||!parsed.rows.every(row=>Array.isArray(row)&&row.length===(parsed.headers as unknown[]).length&&row.every(text)))throw Error('Invalid standalone source table.');
  }
  if(value.pendingMapping!==undefined&&(!record(value.parsed)||!Array.isArray(value.parsed.headers)||!Array.isArray(value.pendingMapping)||value.pendingMapping.length!==value.parsed.headers.length||!value.pendingMapping.every(field=>field==='extra'||converterFields.includes(field as typeof converterFields[number]))))throw Error('Invalid saved pending standalone mapping.');
}
export function validateStandaloneReceipt(value:unknown):asserts value is StandaloneReceipt{
  if(!record(value)||value.schema!==1||!identity(value.id)||!identity(value.operation)||typeof value.signature!=='string'||value.signature.length>8_000_000||!text(value.created)||!record(value.review)||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>5000)throw Error('Invalid standalone converter receipt.');
  const candidate={...value.review,schema:1,status:'applied',processedRaw:value.review.raw};
  validateStandaloneState(candidate);
  const review=standaloneReview(candidate);
  if(review.operation!==value.operation||standaloneSignature(review)!==value.signature||value.entries.length!==review.rows.length)throw Error('Inconsistent standalone converter receipt.');
  const expected=reviewedValues(review);
  const seen=new Set<string>();
  for(const [index,entry]of value.entries.entries()){
    if(!record(entry)||!record(entry.target)||!identity(entry.target.table)||!identity(entry.target.row)||entry.target.table!==review.target.table||seen.has(key(entry.target.table,entry.target.row))||
      !record(entry.values)||!Object.entries(entry.values).every(([field,value])=>['food',...nutrients,'weight','amount','unit'].includes(field)&&text(value))||
      entry.type!==undefined&&!text(entry.type)||entry.removedDescription!==undefined&&!text(entry.removedDescription))throw Error('Invalid standalone converter receipt entry.');
    const values=entry.values;
    if(Object.entries(expected[index].values).some(([field,text])=>values[field]!==text)||entry.removedDescription!==(expected[index].description||undefined)||
      entry.type!==(review.target.kind==='ingredients'?review.types[index]:undefined))throw Error('Standalone receipt values do not match its reviewed input.');
    seen.add(key(entry.target.table,entry.target.row));
  }
}
