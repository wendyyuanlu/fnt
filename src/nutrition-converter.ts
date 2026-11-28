import {nutrients,nutritionReference,numberValue,type FoodValues,type NutritionBatch,type NutritionItem,type NutritionTarget} from './food-capture';
import {converterFields,mapNutritionTable,separateDescription,strictNutritionNumber,type ConverterField,type ConverterRow,type ParsedNutritionTable} from './nutrition-table';
import {validateStandaloneState,type StandaloneConverterState} from './nutrition-converter-import';

export interface ConverterChoice{
  referenceAcknowledged?:boolean;
  overwrite?:boolean;
  quantityAcknowledged?:boolean;
  missingReason?:string;
  include?:boolean;
  manual?:'keep'|'reference';
  target?:NutritionTarget;
}
export interface ConverterReview{
  batch:string;rows:ConverterRow[];choices:Record<string,ConverterChoice>;linkedChoices?:Record<string,ConverterChoice>;removeDescription:boolean;
  source?:{raw:string;html:string;table?:ParsedNutritionTable};
}
export interface ConverterState{
  schema:1;batch:string;mode:'tracked'|'untracked';raw:string;html:string;parsed?:ParsedNutritionTable;
  rows:ConverterRow[];choices:Record<string,ConverterChoice>;linkedChoices:Record<string,ConverterChoice>;removeDescription:boolean;
  processedRaw?:string;status:'editing'|'saving'|'applying'|'applied'|'failed';error?:string;
  standalone?:StandaloneConverterState;
  pendingMapping?:ParsedNutritionTable['mapping'];
}
export interface ConverterIssue{item?:string;message:string}
export interface ReviewedNutrition{
  item:NutritionItem;row:ConverterRow;values:FoodValues;description:string;
}
export interface ConverterReviewResult{issues:ConverterIssue[];items:ReviewedNutrition[]}
export function newConverterState(batch='',standalone?:StandaloneConverterState):ConverterState{
  return{schema:1,batch,mode:'tracked',raw:'',html:'',rows:[],choices:{},linkedChoices:{},removeDescription:false,status:'editing',...(standalone?{standalone:structuredClone(standalone)}:{})};
}
export function selectedNutritionItems(batch:NutritionBatch):NutritionItem[]{
  return batch.items.filter(item=>item.selected&&(item.date===undefined||batch.days.includes(item.date)));
}
export function converterReview(state:ConverterState):ConverterReview{
  if(state.mode!=='tracked')throw Error('Untracked tables cannot be matched or applied to this nutrition batch.');
  if(state.pendingMapping)throw Error('Rebuild the pending column mapping before reviewing or applying.');
  if(!state.parsed){
    if(state.raw.trim()||!Object.values(state.linkedChoices).some(choice=>choice.include))throw Error('Process the current paste before applying.');
  }else if(state.processedRaw!==state.raw)throw Error('Process the current paste before applying.');
  if(state.parsed&&state.batch!==state.parsed.batch)throw Error('This review is bound to another Batch ID. Paste a response for the current batch.');
  return{batch:state.batch,rows:structuredClone(state.rows),choices:structuredClone(state.choices),linkedChoices:structuredClone(state.linkedChoices),removeDescription:state.removeDescription,source:{raw:state.raw,html:state.html,...(state.parsed?{table:structuredClone(state.parsed)}:{})}};
}
const quantityFields=['weight','amount','unit'] as const;
function referenceMatches(item:NutritionItem,row:ConverterRow):boolean{
  const reference=nutritionReference(item);
  return quantityFields.every(field=>{
    const expected=reference[field],actual=row[field].trim();
    if(field==='unit')return String(expected??'').trim().toLowerCase()===actual.toLowerCase();
    return expected===undefined?!actual:strictNutritionNumber(actual,field,false)===expected;
  });
}
export function reviewNutritionTable(batch:NutritionBatch,review:ConverterReview):ConverterReviewResult{
  const issues:ConverterIssue[]=[],items:ReviewedNutrition[]=[];
  if(review.rows.length&&!batch.generated)issues.push({message:'Generate a tracked nutrition prompt before applying a response.'});
  if(review.batch!==batch.id)issues.push({message:'Batch ID does not match the open nutrition batch. Paste the complete response, including its original Batch ID.'});
  const selected=selectedNutritionItems(batch),byId=new Map(selected.map(item=>[item.id,item])),seen=new Set<string>();
  for(const [index,row]of review.rows.entries()){
    const id=row.id.trim(),item=byId.get(id);
    if(seen.has(id)){issues.push({item:id,message:`Duplicate Item ID ${id}. Keep exactly one result per request.`});continue;}
    seen.add(id);
    if(!item){issues.push({item:id,message:`Row ${index+1}: unknown or unselected Item ID "${id}". Names and row order are never used for matching.`});continue;}
    try{
      if(!row.name.trim())throw Error('Dish Name is required.');
      const values:FoodValues={food:row.name};
      for(const field of nutrients)values[field]=String(strictNutritionNumber(row[field],field));
      if(item.kind==='logged')for(const field of quantityFields)values[field]=item.values[field]??'';
      for(const field of ['weight','amount'] as const){
        const value=strictNutritionNumber(row[field],field,false);if(value!==undefined)values[field]=String(value);
      }
      if(item.kind!=='logged'||row.unit.trim())values.unit=row.unit.trim();
      if(!!values.amount!==!!values.unit)throw Error('Amount and Unit must be supplied together.');
      if(item.kind==='ingredient'){
        const matches=referenceMatches(item,row);
        if(!matches&&!review.choices[id]?.referenceAcknowledged)throw Error('Returned quantities differ from the captured reference. Confirm that ALL nutrients describe the captured Ingredient reference, not the logging portion.');
        const reference=nutritionReference(item);
        for(const field of quantityFields)values[field]=reference[field]===undefined?'':String(reference[field]);
      }else if(item.kind==='draft'){
        if(quantityFields.some(field=>row[field].trim()))throw Error('Draft response Grams, Amount and Unit must be blank. Consumed quantities are preserved from the captured Draft.');
        for(const field of quantityFields)values[field]=item.values[field]??'';
      }else{
        const changed=quantityFields.filter(field=>{
          const before=item.values[field]?.trim()??'',after=values[field]?.trim()??'';
          return field==='unit'?before.toLowerCase()!==after.toLowerCase():before!==after&&(!before||!after||numberValue(before)!==numberValue(after));
        });
        if(changed.length&&!review.choices[id]?.quantityAcknowledged)throw Error('Returned logging quantities differ from the captured consumed portion. Review the nutrition basis and explicitly approve the changed quantities, or leave these response cells blank to preserve captured quantities.');
      }
      const conflicts=nutrients.filter(field=>item.values[field]?.trim()&&Number(item.values[field])!==Number(values[field]));
      if(conflicts.length&&!review.choices[id]?.overwrite)throw Error(`Review replacement of existing ${conflicts.join(', ')} values, then explicitly allow these changes.`);
      const separated=review.removeDescription?separateDescription(row.name):{name:row.name,description:''};
      values.food=separated.name;
      items.push({item,row,values,description:separated.description});
    }catch(error){issues.push({item:id,message:error instanceof Error?error.message:String(error)});}
  }
  for(const item of selected)if(!seen.has(item.id)&&!review.choices[item.id]?.missingReason?.trim())issues.push({item:item.id,message:`Missing result for ${item.id}. Paste its row or record an explicit reason for not applying this request.`});
  if(!items.length&&!Object.values(review.linkedChoices??{}).some(choice=>choice.include))issues.push({message:'There are no valid result rows or explicitly selected captured linked Drafts to apply.'});
  return{issues,items};
}
export function remapConverterTable(state:ConverterState,mapping:ParsedNutritionTable['mapping']):ConverterState{
  if(!state.parsed)throw Error('Process a table before changing the mapping.');
  const parsed={...state.parsed,mapping};
  return{...state,parsed,rows:mapNutritionTable(parsed),choices:{},pendingMapping:undefined,status:'editing',error:undefined};
}
export function validateConverterState(value:unknown):asserts value is ConverterState{
  const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const text=(value:unknown)=>typeof value==='string'&&value.length<=2_000_000;
  if(!record(value)||value.schema!==1||!text(value.batch)||!['tracked','untracked'].includes(String(value.mode))||!text(value.raw)||!text(value.html)||typeof value.removeDescription!=='boolean'||!['editing','saving','applying','applied','failed'].includes(String(value.status))||!Array.isArray(value.rows)||value.rows.length>5000||!value.rows.every(row=>record(row)&&converterFields.every(field=>text(row[field])))||!record(value.choices)||!record(value.linkedChoices))throw Error('Invalid saved nutrition converter review.');
  for(const [id,choice]of [...Object.entries(value.choices),...Object.entries(value.linkedChoices)])if(!/^[a-zA-Z0-9_.:-]{1,512}$/.test(id)||!record(choice)||choice.overwrite!==undefined&&typeof choice.overwrite!=='boolean'||choice.quantityAcknowledged!==undefined&&typeof choice.quantityAcknowledged!=='boolean'||choice.referenceAcknowledged!==undefined&&typeof choice.referenceAcknowledged!=='boolean'||choice.include!==undefined&&typeof choice.include!=='boolean'||choice.manual!==undefined&&!['keep','reference'].includes(String(choice.manual))||choice.target!==undefined&&(!record(choice.target)||!text(choice.target.sheet)||!text(choice.target.table))||choice.missingReason!==undefined&&!text(choice.missingReason))throw Error('Invalid saved nutrition converter choices.');
  if(value.processedRaw!==undefined&&!text(value.processedRaw)||value.error!==undefined&&!text(value.error))throw Error('Invalid saved converter status.');
  if(value.standalone!==undefined)validateStandaloneState(value.standalone);
  if(value.parsed!==undefined){
    const parsed=value.parsed;
    if(!record(parsed)||!text(parsed.batch)||!Array.isArray(parsed.headers)||parsed.headers.length>128||!parsed.headers.every(text))throw Error('Invalid saved converter source table.');
    const width=parsed.headers.length;
    if(!Array.isArray(parsed.mapping)||parsed.mapping.length!==width||!parsed.mapping.every(field=>field==='extra'||converterFields.includes(field as ConverterField))||!Array.isArray(parsed.rows)||parsed.rows.length>5000||!parsed.rows.every(row=>Array.isArray(row)&&row.length===width&&row.every(text)))throw Error('Invalid saved converter source table.');
  }
  if(value.pendingMapping!==undefined&&(!record(value.parsed)||!Array.isArray(value.parsed.headers)||!Array.isArray(value.pendingMapping)||value.pendingMapping.length!==value.parsed.headers.length||!value.pendingMapping.every(field=>field==='extra'||converterFields.includes(field as ConverterField))))throw Error('Invalid saved pending converter mapping.');
}
