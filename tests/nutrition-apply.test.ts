import {describe,expect,it} from 'vitest';
import {addDraftFood,captureData,ingredientRecord,newNutritionBatch,nutrients,renameRestaurant,restaurantName,setRestaurant,updateDraftText,type DraftFood,type FoodValues} from '../src/food-capture';
import {Engine,scalar} from '../src/formula';
import {allTables,getCell,key,moveColumns,renameColumn,setInput,type Workbook} from '../src/model';
import {renameTable} from '../src/table-management';
import {converterFields,type ConverterRow} from '../src/nutrition-table';
import {prepareNutritionApply,preflightNutritionApply,validateConverterReceipt} from '../src/nutrition-apply';
import type {ConverterReview} from '../src/nutrition-converter';
import {applyUndo,structuralUndo} from '../src/undo-history';

function fixture(){
  const nutrition=['food',...nutrients,'weight','amount','unit','notes'];
  const ingredientColumns=nutrition.map(id=>({id,column:id,name:({food:'Ingredients',weight:'Serving (g)',amount:'Conversion Amount',unit:'Conversion Unit'} as Record<string,string>)[id]??id[0].toUpperCase()+id.slice(1)}));
  const masterColumns=['date','marker','label',...nutrition].map(id=>({id:'m'+id,column:'m'+id,name:({date:'Date',marker:'isDay',label:'Weight',food:'Food',weight:'Amount (g)'} as Record<string,string>)[id]??id[0].toUpperCase()+id.slice(1)}));
  const book:Workbook={schema:1,id:'book',revision:0,title:'Synthetic converter fixture',names:[],pickerSources:{},sheets:[
    {id:'ingredients-sheet',name:'Ingredients',color:'',rows:['ih','ingredient'].map(id=>({id})),columns:ingredientColumns.map(column=>({id:column.column,label:column.name})),cells:{'ingredient:food':{value:'Mochi'},'ingredient:weight':{value:25},'ingredient:amount':{value:1},'ingredient:unit':{value:'each'}},groups:[],validations:[]},
    {id:'master-sheet',name:'Log',color:'',rows:['mh','day','logged','linked'].map(id=>({id})),columns:masterColumns.map(column=>({id:column.column,label:column.name})),cells:{'day:mdate':{value:45000},'day:mmarker':{value:true},'day:mlabel':{value:'x'},'logged:mfood':{value:'Same name'},'logged:mweight':{value:30},'linked:mfood':{binding:{table:'ingredients',row:'ingredient',column:'food'}}},groups:[],validations:[],mealLog:{table:'master',fields:Object.fromEntries(nutrition.map(field=>[field,'m'+field])),ingredients:{table:'ingredients',fields:Object.fromEntries(nutrition.map(field=>[field,field]))}}}
  ],tables:[{id:'ingredients',name:'Ingredients',sheet:'ingredients-sheet',header:'ih',rows:['ingredient'],columns:ingredientColumns},{id:'master',name:'Master',sheet:'master-sheet',header:'mh',rows:['day','logged','linked'],columns:masterColumns}]};
  const data=captureData(book);data.ingredientMappings.push({table:'ingredients',fields:Object.fromEntries(nutrition.map(field=>[field,field]))});
  return book;
}
function draft(book:Workbook,id:string,values:FoodValues,linked=false):DraftFood{
  const food=addDraftFood(book,45000);food.id=id;food.values={...values};food.loggingTarget={sheet:'master-sheet',table:'master'};food.restaurantText='Synthetic cafe';food.photos=['synthetic-photo'];
  if(linked)food.ingredient={table:'ingredients',row:'ingredient'};
  return food;
}
function setup(book:Workbook){
  const batch=newNutritionBatch(book,[45000],'Synthetic prompt');captureData(book).builder=batch;batch.generated=true;
  const rows=batch.items.filter(item=>item.selected).map(item=>{
    const row=Object.fromEntries(converterFields.map(field=>[field,''])) as ConverterRow;
    Object.assign(row,{id:item.id,name:item.name,calories:'70',protein:'1',fat:'2',carbs:'12',sugar:'6',sodium:'10'});
    if(item.kind==='ingredient')Object.assign(row,{weight:'25',amount:'1',unit:'each'});
    else if(item.kind==='logged')row.weight='30';
    return row;
  });
  const review:ConverterReview={batch:batch.id,rows,choices:{},linkedChoices:{},removeDescription:false};return{batch,review};
}
function cell(book:Workbook,row:string,field:string){return scalar(new Engine(book).cell('master-sheet',row,'m'+field));}
describe('tracked nutrition atomic clone apply',()=>{
  it('updates SAME Ingredient and original Logged rows, creates only captured dated Draft, preserves literal text and original contexts',()=>{
    const book=fixture(),food=draft(book,'draft',{food:'Same name',weight:'47',notes:'=literal note'}),before=structuredClone(book),{batch,review}=setup(book);
    const item=batch.items.find(item=>item.kind==='draft')!;review.rows.find(row=>row.id===item.id)!.name='=not a formula (description)';review.removeDescription=true;
    const result=prepareNutritionApply(book,batch,review);
    expect(book).toEqual({...before,foodCapture:{...book.foodCapture}});
    expect(ingredientRecord(result.book,{table:'ingredients',row:'ingredient'}).values.calories).toBe('70');
    expect(cell(result.book,'logged','calories')).toBe(70);
    const added=result.receipt.entries.find(entry=>entry.kind==='draft')!;
    expect(cell(result.book,added.target.row,'food')).toBe('=not a formula');
    expect(cell(result.book,added.target.row,'weight')).toBe(47);
    expect(cell(result.book,added.target.row,'notes')).toBe('=literal note');
    expect(added.originalDraft).toMatchObject({restaurantText:'Synthetic cafe',photos:['synthetic-photo']});
    expect(result.book.foodCapture?.loggedDetails?.[`${added.target.table}:${added.target.row}`]).toEqual({restaurantText:'Synthetic cafe'});
    expect(added.removedDescription).toBe(' (description)');
    expect(result.book.foodCapture?.foods.some(item=>item.id===food.id)).toBe(false);
    expect(book.foodCapture?.foods).toHaveLength(1);
    expect(()=>validateConverterReceipt(result.receipt)).not.toThrow();
  });
  it('logs only explicitly captured linked intentions, scales count or explicit grams, preserving amount and Ingredient binding',()=>{
    const book=fixture();draft(book,'count',{food:'Mochi',amount:'2',unit:'each'},true);draft(book,'grams',{food:'Mochi',weight:'47',amount:'2',unit:'each'},true);
    const {batch,review}=setup(book);for(const intent of batch.linkedIntents!)review.linkedChoices![intent.key]={include:true};
    // This later linked Draft was never captured and must not be logged.
    draft(book,'later',{food:'Mochi',amount:'9',unit:'each'},true);
    const result=prepareNutritionApply(book,batch,review),linked=result.receipt.entries.filter(entry=>entry.kind==='linked');
    expect(linked).toHaveLength(2);
    expect(cell(result.book,linked[0].target.row,'calories')).toBe(140);
    expect(cell(result.book,linked[1].target.row,'calories')).toBeCloseTo(131.6);
    expect(cell(result.book,linked[1].target.row,'amount')).toBe(2);
    const sheet=result.book.sheets[1];
    expect(getCell(sheet,linked[0].target.row,'mfood').binding).toEqual({table:'ingredients',row:'ingredient',column:'food'});
    expect(result.book.foodCapture?.foods.map(food=>food.id)).toEqual(['later']);
    setInput(result.book,result.book.sheets[0],'ingredient','calories','100');
    expect(cell(result.book,linked[0].target.row,'calories')).toBe(200);
  });
  it('carries restaurant identity into linked and Multi consumption while honoring explicitly reviewed restaurant text',()=>{
    const book=fixture(),linked=draft(book,'linked',{food:'Mochi',amount:'2',unit:'each'},true),multi=draft(book,'multi',{food:'First\nSecond'});
    setRestaurant(book,linked,'Shared cafe');setRestaurant(book,multi,'Shared cafe');multi.mode='multi';updateDraftText(multi,'First\nSecond');
    const restaurant=linked.restaurant!,{batch,review}=setup(book);review.linkedChoices![batch.linkedIntents![0].key]={include:true};
    batch.items.find(item=>item.kind==='draft')!.restaurant='Reviewed restaurant';
    const result=prepareNutritionApply(book,batch,review),entries=result.receipt.entries.filter(entry=>entry.kind==='draft'||entry.kind==='linked');
    const details=(entry:typeof entries[number])=>result.book.foodCapture!.loggedDetails![`${entry.target.table}:${entry.target.row}`];
    expect(entries).toHaveLength(3);
    const reviewed=entries.find(entry=>entry.kind==='draft'&&entry.source.restaurant==='Reviewed restaurant')!;
    expect(restaurantName(result.book,details(reviewed))).toBe('Reviewed restaurant');
    for(const entry of entries.filter(entry=>entry!==reviewed))expect(details(entry)).toEqual({restaurant});
    renameRestaurant(result.book,restaurant,'Renamed shared cafe');
    for(const entry of entries.filter(entry=>entry!==reviewed))expect(restaurantName(result.book,details(entry))).toBe('Renamed shared cafe');
    expect(restaurantName(result.book,details(reviewed))).toBe('Reviewed restaurant');
    expect(result.book.foodCapture!.foods).toEqual([]);
    expect(applyUndo(result.book,structuralUndo(book,result.book)).book).toEqual(book);
  });
  it('requires explicit manual override review and preserves kept values without losing other macro links',()=>{
    const book=fixture();draft(book,'manual',{food:'Mochi',amount:'2',unit:'each',calories:'999'},true);
    const {batch,review}=setup(book),intent=batch.linkedIntents![0];review.linkedChoices![intent.key]={include:true};
    expect(()=>prepareNutritionApply(book,batch,review)).toThrow('Keep manual');
    const before=structuredClone(book);review.linkedChoices![intent.key].manual='keep';
    const result=prepareNutritionApply(book,batch,review),entry=result.receipt.entries.find(entry=>entry.kind==='linked')!;
    expect(book).toEqual(before);expect(cell(result.book,entry.target.row,'calories')).toBe(999);
    expect(getCell(result.book.sheets[1],entry.target.row,'mprotein').formula).toBeDefined();
  });
  it('queues existing Logged and unselected Draft overrides after an Ingredient-only import without logging consumption',()=>{
    const book=fixture();setInput(book,book.sheets[0],'ingredient','calories','10');
    const food=draft(book,'retained',{food:'Mochi',amount:'2',unit:'each',calories:'777'},true);
    book.sheets[1].cells['linked:mcalories']={value:999,calculation:{kind:'binary',op:'*',left:{kind:'ref',sheet:'ingredients-sheet',row:'ingredient',column:'calories',absRow:true,absCol:true},right:{kind:'literal',value:2}}};
    const {batch,review}=setup(book),item=batch.items.find(item=>item.kind==='ingredient')!;
    for(const candidate of batch.items)candidate.selected=candidate===item;review.rows=review.rows.filter(row=>row.id===item.id);
    review.choices[item.id]={overwrite:true};
    const before=structuredClone(book),result=prepareNutritionApply(book,batch,review);
    expect(book).toEqual(before);expect(result.receipt.entries.map(entry=>entry.kind)).toEqual(['ingredient']);
    expect(result.book.foodCapture!.foods).toEqual([food]);expect(cell(result.book,'linked','calories')).toBe(999);
    expect(result.book.foodCapture!.nutritionConflicts).toMatchObject([
      {food:'retained',manual:{calories:'777'},calculated:{calories:'140'}},
      {kind:'logged',food:'master:linked',manual:{calories:'999'},calculated:{calories:'140'}}
    ]);
    expect(result.book.tables.find(table=>table.id==='master')!.rows).toEqual(before.tables.find(table=>table.id==='master')!.rows);
  });
  it('retains unselected Multi part identities and snapshots when another part becomes Logged',()=>{
    const book=fixture(),food=draft(book,'multi',{food:'First\nSecond'});food.mode='multi';updateDraftText(food,'First\nSecond');
    const part=food.parts[1].id,{batch,review}=setup(book),parts=batch.items.filter(item=>item.kind==='draft');parts[1].selected=false;review.rows=review.rows.filter(row=>row.id!==parts[1].id);
    const result=prepareNutritionApply(book,batch,review),remaining=result.book.foodCapture!.foods[0];
    expect(remaining.parts).toEqual([{id:part,text:'Second'}]);expect(remaining.values.food).toBe('Second');
    expect(result.receipt.entries.find(entry=>entry.kind==='draft')?.originalDraft?.parts).toHaveLength(2);
  });
  it('blocks stale source/destination/mapping or removed source without any live workbook mutation',()=>{
    for(const mutate of [(book:Workbook)=>{book.foodCapture!.foods[0].values.weight='99';},(book:Workbook)=>{book.tables=book.tables.filter(table=>table.id!=='master');},(book:Workbook)=>{book.sheets[1].mealLog!.fields.sodium='removed';}]){
      const book=fixture();draft(book,'draft',{food:'New food'});const {batch,review}=setup(book);mutate(book);const before=structuredClone(book);
      expect(()=>prepareNutritionApply(book,batch,review)).toThrow();expect(book).toEqual(before);
    }
  });
  it('requires explicit legacy destination choice and refuses diverting a captured target',()=>{
    const book=fixture(),food=draft(book,'legacy',{food:'Food'});delete food.loggingTarget;const {batch,review}=setup(book),item=batch.items.find(item=>item.kind==='draft')!;
    expect(preflightNutritionApply(book,batch,review).issues.some(issue=>issue.message.includes('explicit destination'))).toBe(true);
    review.choices[item.id]={target:{sheet:'master-sheet',table:'master'}};
    expect(()=>prepareNutritionApply(book,batch,review)).not.toThrow();
    item.loggingTarget={sheet:'master-sheet',table:'master'};review.choices[item.id].target={sheet:'x',table:'wrong'};
    expect(()=>prepareNutritionApply(book,batch,review)).toThrow();
  });
  it('supports existing complete reference logging without inventing an AI result row',()=>{
    const book=fixture();for(const [field,value]of Object.entries({calories:'70',protein:'1',fat:'2',carbs:'12',sugar:'6',sodium:'10'}))setInput(book,book.sheets[0],'ingredient',field,value);
    draft(book,'linked',{food:'Mochi',amount:'2',unit:'each'},true);const {batch,review}=setup(book);
    batch.items.forEach(item=>item.selected=false);batch.generated=false;review.rows=[];review.linkedChoices![batch.linkedIntents![0].key]={include:true};
    const result=prepareNutritionApply(book,batch,review);expect(result.receipt.entries).toHaveLength(1);expect(cell(result.book,result.receipt.entries[0].target.row,'calories')).toBe(140);
  });
  it('replays a saved receipt idempotently and Undo restores all mixed routes and Draft sources',()=>{
    const book=fixture();draft(book,'draft',{food:'Food'});const {batch,review}=setup(book),before=structuredClone(book),result=prepareNutritionApply(book,batch,review);
    const replay=prepareNutritionApply(result.book,batch,review,[result.receipt]);
    expect(replay.alreadyApplied).toBe(true);expect(replay.book).toEqual(result.book);
    const undone=applyUndo(result.book,structuralUndo(before,result.book)).book;expect(undone).toEqual(before);
    review.rows[0].name='Changed retry';
    expect(()=>prepareNutritionApply(result.book,batch,review,[result.receipt])).toThrow();
  });
  it('keeps linked reference/consumption unchanged when an Ingredient returned quantity is reconciled explicitly',()=>{
    const book=fixture();draft(book,'linked',{food:'Mochi',weight:'47',amount:'2',unit:'each'},true);const {batch,review}=setup(book);
    const request=batch.items.find(item=>item.kind==='ingredient')!,row=review.rows.find(row=>row.id===request.id)!;row.weight='50';review.choices[request.id]={referenceAcknowledged:true};review.linkedChoices![batch.linkedIntents![0].key]={include:true};
    const result=prepareNutritionApply(book,batch,review);
    expect(ingredientRecord(result.book,request.reference!).values.weight).toBe('25');
    const linked=result.receipt.entries.find(entry=>entry.kind==='linked')!;expect(cell(result.book,linked.target.row,'weight')).toBe(47);
  });
  it('preserves all captured Logged quantity fields when returned cells are blank and separately reviews changed quantities',()=>{
    const book=fixture();setInput(book,book.sheets[1],'logged','mweight','47');setInput(book,book.sheets[1],'logged','mamount','2');setInput(book,book.sheets[1],'logged','munit',"'each");
    const {batch,review}=setup(book),item=batch.items.find(item=>item.kind==='logged')!,row=review.rows.find(row=>row.id===item.id)!;
    row.weight='';row.amount='';row.unit='';
    const result=prepareNutritionApply(book,batch,review);
    expect(cell(result.book,'logged','weight')).toBe(47);expect(cell(result.book,'logged','amount')).toBe(2);expect(cell(result.book,'logged','unit')).toBe('each');
    row.weight='100';review.choices[item.id]={overwrite:true};
    expect(()=>prepareNutritionApply(book,batch,review)).toThrow('explicitly approve');
    review.choices[item.id].quantityAcknowledged=true;
    expect(cell(prepareNutritionApply(book,batch,review).book,'logged','weight')).toBe(100);
  });
  it('does not trust retained fingerprint stamps on retargeted request or linked snapshots',()=>{
    for(const linked of [false,true]){
      const book=fixture();draft(book,'source',{food:'Rice',amount:'2',unit:'each'},linked);draft(book,'decoy',{food:'Rice',amount:'2',unit:'each'},linked);
      const {batch,review}=setup(book);
      if(linked){const intent=batch.linkedIntents![0];review.linkedChoices![intent.key]={include:true};intent.source.row='decoy';}
      else batch.items.find(item=>item.kind==='draft')!.source.row='decoy';
      const before=structuredClone(book);expect(()=>prepareNutritionApply(book,batch,review)).toThrow('inconsistent');expect(book).toEqual(before);
    }
  });
  it('keeps auto-derived grams and nutrition live through Ingredient serving edits while explicit grams and manual macros remain independent',()=>{
    const book=fixture();draft(book,'auto',{food:'Mochi',amount:'2',unit:'each',calories:'999'},true);draft(book,'explicit',{food:'Mochi',weight:'47',amount:'2',unit:'each'},true);
    const {batch,review}=setup(book);for(const intent of batch.linkedIntents!)review.linkedChoices![intent.key]={include:true,manual:'keep'};
    const result=prepareNutritionApply(book,batch,review),entries=result.receipt.entries.filter(entry=>entry.kind==='linked');
    const auto=entries.find(entry=>entry.source.source.row==='auto')!.target.row,explicit=entries.find(entry=>entry.source.source.row==='explicit')!.target.row;
    expect(cell(result.book,auto,'weight')).toBe(50);expect(getCell(result.book.sheets[1],auto,'mweight').formula).toBeDefined();
    setInput(result.book,result.book.sheets[0],'ingredient','weight','30');
    expect(cell(result.book,auto,'weight')).toBe(60);expect(cell(result.book,auto,'calories')).toBe(999);expect(cell(result.book,auto,'protein')).toBe(2);
    expect(cell(result.book,explicit,'weight')).toBe(47);expect(cell(result.book,explicit,'calories')).toBeCloseTo(47/30*70);
    setInput(result.book,result.book.sheets[0],'ingredient','amount','2');
    expect(cell(result.book,auto,'weight')).toBe(30);expect(cell(result.book,auto,'amount')).toBe(2);expect(cell(result.book,auto,'protein')).toBe(1);
    expect(getCell(result.book.sheets[1],auto,'mcalories').calculation).toBeDefined();
  });
  it('tracks live conversion factors, units, rule edits, renamed tables/columns and column movement without frozen graph constants',()=>{
    const book=fixture(),sheet=book.sheets[0];
    sheet.rows.push({id:'conversion-header'},{id:'conversion'});
    sheet.columns.push(...['from','to','factor'].map(id=>({id,label:id})));
    const table={id:'conversions',name:'Conversions',sheet:sheet.id,header:'conversion-header',rows:['conversion'],columns:[{id:'from',column:'from',name:'From Unit'},{id:'to',column:'to',name:'To Unit'},{id:'factor',column:'factor',name:'Conversion Factor'}]};book.tables.push(table);
    setInput(book,sheet,'conversion','from',"'cup");setInput(book,sheet,'conversion','to',"'each");setInput(book,sheet,'conversion','factor','2');
    draft(book,'converted',{food:'Mochi',amount:'1',unit:'cup'},true);const {batch,review}=setup(book),intent=batch.linkedIntents![0];review.linkedChoices![intent.key]={include:true};
    const result=prepareNutritionApply(book,batch,review),row=result.receipt.entries.find(entry=>entry.kind==='linked')!.target.row,engine=new Engine(result.book),source=result.book.sheets[0];
    const read=(field:string)=>scalar(engine.cell('master-sheet',row,'m'+field));
    const edit=(row:string,column:string,value:string)=>{setInput(result.book,source,row,column,value);engine.invalidate([`${source.id}:${row}:${column}`]);};
    expect(read('weight')).toBe(50);expect(read('calories')).toBe(140);
    edit('conversion','factor','3');expect(read('weight')).toBe(75);expect(read('calories')).toBe(210);
    edit('ingredient','unit',"'piece");expect(read('weight')).toBe(75);
    edit('ingredient','unit',"'tablespoon");expect(read('calories')).toMatchObject({error:'#N/A'});
    edit('conversion','to',"'tablespoon");edit('conversion','factor','4');
    expect(read('weight')).toBe(100);expect(read('calories')).toBe(280);
    renameTable(result.book,'conversions','RenamedRules');
    const renamed=result.book.tables.find(table=>table.id==='conversions')!;
    renameColumn(result.book,renamed,'factor','New factor label');renameColumn(result.book,renamed,'from','New source label');renameColumn(result.book,renamed,'to','New target label');
    moveColumns(result.book,source,['factor'],0);
    expect(cell(result.book,row,'weight')).toBe(100);
    setInput(result.book,source,'conversion','factor','5');expect(cell(result.book,row,'weight')).toBe(125);expect(cell(result.book,row,'amount')).toBe(1);
    const ingredients=result.book.tables.find(table=>table.id==='ingredients')!;
    renameTable(result.book,'ingredients','RenamedIngredients');renameColumn(result.book,ingredients,'weight','Reference grams renamed');moveColumns(result.book,source,['weight'],0);
    expect(cell(result.book,row,'weight')).toBe(125);expect(cell(result.book,row,'calories')).toBe(350);
  });
});
