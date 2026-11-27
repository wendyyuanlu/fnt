import {describe,expect,it,vi} from 'vitest';
import {addDraftFood,addDraftIngredient,appendNewFood,availableFoodDays,captureData,changedLinkedNutritionIntents,changedNutritionSnapshots,createFoodCaptureContext,deleteRestaurant,generateNutritionPrompt,ingredientList,ingredientRecord,newNutritionBatch,nutritionCandidates,nutritionReference,parseServing,quantityFactor,refreshNutritionPrompt,rememberNutritionConversions,renameRestaurant,restaurantFoods,restaurantName,restoreNameVersion,saveNameVersion,scaledDraft,setRestaurant,validateFoodCapture,type DraftFood} from '../src/food-capture';
import {compile,Engine} from '../src/formula';
import {setInput,type Table,type Workbook} from '../src/model';
import {captureDraftNutrition,captureNutritionReview,nutritionReviewRows,queueDraftNutritionReview,queueNutritionReview,resolveNutritionReview,writeIngredientValues} from '../src/ingredient-edit';
import {applyUndo,structuralUndo} from '../src/undo-history';
import {encodeNameBackup,parseNameBackup} from '../src/nutrition-names';
import {addMealIngredient} from '../src/meal-log';

function fixture(count=3):Workbook{
  const fields={food:'Ingredients',weight:'Serving (g)',amount:'Conversion Amount',unit:'Conversion Unit',calories:'Calories',protein:'Protein',fat:'Fat',carbs:'Carbs',sugar:'Sugar',sodium:'Sodium'};
  const columns=Object.entries(fields).map(([id,name])=>({id,column:id,name}));
  const rows=Array.from({length:count},(_,i)=>'r'+i),cells:Workbook['sheets'][number]['cells']={};
  for(const row of rows)for(const column of columns)cells[row+':'+column.column]={value:column.id==='food'?'Food '+row:column.id==='unit'?'g':column.id==='weight'?1:column.id==='amount'?null:2};
  return{schema:1,id:'book',title:'Foundation fixture',revision:0,names:[],pickerSources:{},sheets:[{id:'s',name:'Ingredients',color:'',rows:['header',...rows].map(id=>({id})),columns:columns.map(c=>({id:c.column,label:c.name})),cells,groups:[],validations:[]}],tables:[{id:'ingredients',name:'Ingredients',sheet:'s',header:'header',rows,columns}]};
}
function draft(values:DraftFood['values']={},linked=true):DraftFood{
  return{id:'draft',date:45000,mode:'single',values,parts:[],photos:[],...(linked?{ingredient:{table:'ingredients',row:'r0'}}:{})};
}
function conversions(book:Workbook,rules:[string,string,number][]){
  const table:Table={id:'conversions',name:'Conversions',sheet:'s',header:'ch',rows:rules.map((_,i)=>'c'+i),columns:[{id:'from',column:'from',name:'From Unit'},{id:'to',column:'to',name:'To Unit'},{id:'factor',column:'factor',name:'Conversion Factor'}]};
  book.tables.push(table);book.sheets[0].rows.push(...['ch',...table.rows].map(id=>({id})));book.sheets[0].columns.push(...['from','to','factor'].map(id=>({id,label:id})));
  rules.forEach(([from,to,factor],i)=>Object.assign(book.sheets[0].cells,{['c'+i+':from']:{value:from},['c'+i+':to']:{value:to},['c'+i+':factor']:{value:factor}}));
}
function countCells(engine:Engine){
  const calls:{sheet:string;row:string;column:string}[]=[],cell=engine.cell.bind(engine);
  engine.cell=(sheet,row,column)=>{calls.push({sheet,row,column});return cell(sheet,row,column);};
  return calls;
}
function loggedFoods(book:Workbook){
  const columns=[['food','Food'],['date','Date'],['marker','isDay'],['weight','Weight'],['calories','Calories']].map(([id,name])=>({id:'m'+id,column:'m'+id,name}));
  const table:Table={id:'master',name:'Master',sheet:'master-sheet',header:'mh',rows:['day','logged','linked','other-day','other'],columns};
  const cells:Workbook['sheets'][number]['cells']={
    'day:mmarker':{value:true},'day:mdate':{value:45000},
    'logged:mfood':{value:'Logged meal'},'logged:mcalories':{value:123},
    'linked:mfood':{value:'Linked',binding:{table:'ingredients',row:'r0',column:'food'}},
    'other-day:mmarker':{value:true},'other-day:mdate':{value:45001},
    'other:mfood':{value:'Other day'},'other:mcalories':{value:456}
  };
  book.tables.push(table);book.sheets.push({id:table.sheet,name:'Master',color:'',rows:['mh',...table.rows].map(id=>({id})),columns:columns.map(c=>({id:c.column,label:c.name})),cells,groups:[],validations:[],
    mealLog:{table:table.id,fields:{food:'mfood',calories:'mcalories'},ingredients:{table:'ingredients',fields:{food:'food'}}}});
}

describe.each([1,2,3])('food-capture foundation, repetition %i',()=>{
  it('shares stable restaurant identities between Logged and Draft without changing consumption cells',()=>{
    const book=fixture(1);loggedFoods(book);
    const data=captureData(book),food=addDraftFood(book,45000);food.values.food='Draft dish';
    setRestaurant(book,food,'Synthetic cafe');
    const link={restaurant:food.restaurant};data.loggedDetails={'master:logged':link,'removed:row':{...link}};
    const cells=structuredClone(book.sheets.map(sheet=>sheet.cells)),master=book.tables.find(table=>table.id==='master')!;
    master.name='Renamed log';master.columns.reverse();master.columns.forEach(column=>column.name='Renamed '+column.id);
    renameRestaurant(book,food.restaurant!,'Renamed cafe');
    expect(restaurantName(book,food)).toBe('Renamed cafe');expect(restaurantName(book,link)).toBe('Renamed cafe');
    expect(restaurantFoods(book,food.restaurant!)).toEqual([{name:'Draft dish',kind:'Draft'},{name:'Logged meal',kind:'Logged'}]);
    expect(book.sheets.map(sheet=>sheet.cells)).toEqual(cells);
    setInput(book,book.sheets[1],'logged','mfood',"'Renamed meal");
    expect(restaurantFoods(book,food.restaurant!)[1].name).toBe('Renamed meal');
    deleteRestaurant(book,food.restaurant!);
    expect(data.restaurants).toEqual([]);expect(food.restaurant).toBeUndefined();expect(link.restaurant).toBeUndefined();
    expect(restaurantName(book,link)).toBe('Renamed cafe');expect(data.loggedDetails['removed:row']).toEqual({restaurantText:'Renamed cafe'});
    expect(()=>validateFoodCapture(data)).not.toThrow();
  });
  it('includes Logged restaurant context in immutable nutrition snapshots and detects later source changes',()=>{
    const book=fixture(1);loggedFoods(book);
    const data=captureData(book),link={restaurantText:'Typed restaurant'};data.loggedDetails={'master:logged':link};
    const batch=newNutritionBatch(book,[45000],'Template'),item=batch.items.find(item=>item.kind==='logged')!;
    for(const candidate of batch.items)candidate.selected=candidate===item;
    expect(item.restaurant).toBe('Typed restaurant');expect(generateNutritionPrompt(batch)).toContain('"restaurant": "Typed restaurant"');
    setRestaurant(book,link,'Reusable restaurant');
    expect(changedNutritionSnapshots(book,batch)).toContain(item.key);
    appendNewFood(book,batch);expect(item.restaurant).toBe('Typed restaurant');
    const next=newNutritionBatch(book,[45000],'Template');expect(next.items.find(candidate=>candidate.key===item.key)?.restaurant).toBe('Reusable restaurant');
    const roundtrip=JSON.parse(JSON.stringify(data));expect(()=>validateFoodCapture(roundtrip)).not.toThrow();
  });
  it('validates optional Logged metadata without accepting malformed keys, values or unknown fields',()=>{
    const data=captureData(fixture(1));expect(()=>validateFoodCapture(data)).not.toThrow();
    for(const loggedDetails of [[],{'no-row':{}},{'master:row':{restaurant:3}},{'master:row':{restaurantText:{}}},{'master:row':{unexpected:'value'}}]){
      expect(()=>validateFoodCapture({...data,loggedDetails})).toThrow('logged food details');
    }
    expect(()=>validateFoodCapture({...data,loggedDetails:{'master:row':{restaurantText:'Unlinked text'}}})).not.toThrow();
  });
  it('keeps Multi requests without Notes valid across saved batch reloads',()=>{
    const book=fixture(1),food=addDraftFood(book,45000);food.mode='multi';food.values.food='Rice\nSoup';food.parts=[{id:'one',text:'Rice'},{id:'two',text:'Soup'}];
    captureData(book).builder=newNutritionBatch(book,[45000],'Template');
    const saved=structuredClone(book.foodCapture);
    expect(saved!.builder!.items.filter(item=>item.kind==='draft').map(item=>item.values)).toEqual([{food:'Rice'},{food:'Soup'}]);
    expect(()=>validateFoodCapture(saved)).not.toThrow();
  });
  it('accepts saved nutrition workflow choices and older batches, but rejects unknown tabs',()=>{
    const book=fixture(1),data=captureData(book),batch=newNutritionBatch(book,[45000],'Template');data.builder=batch;
    expect(()=>validateFoodCapture(data)).not.toThrow();
    for(const workflow of ['builder','converter'] as const){
      batch.workflow=workflow;expect(()=>validateFoodCapture(JSON.parse(JSON.stringify(data)))).not.toThrow();
    }
    for(const workflow of ['',null,false,{},'unknown']){
      expect(()=>validateFoodCapture({...data,builder:{...batch,workflow}})).toThrow('Invalid nutrition workflow.');
    }
  });
  it('limits a Draft quantity review to its declared food while preserving another pending choice',()=>{
    const book=fixture(900),data=captureData(book),engine=new Engine(book);
    data.foods=Array.from({length:1000},(_,index)=>({...draft({weight:'2',calories:'9'}),id:'draft-'+index,ingredient:{table:'ingredients',row:'r'+index%900}}));
    const other={food:'draft-1',ingredient:{table:'ingredients',row:'r1'},fields:['calories'] as const,manual:{calories:'9'},calculated:{calories:'4'}};
    data.nutritionConflicts=[{...other,fields:[...other.fields]}];
    const calls=countCells(engine),before=captureNutritionReview(book,engine,{drafts:new Set(['draft-0'])});
    expect([...before.drafts.keys()]).toEqual(['draft-0']);expect(before.logged.size).toBe(0);
    data.foods[0].values.weight='3';queueNutritionReview(book,before,engine);
    expect(data.nutritionConflicts).toHaveLength(2);expect(data.nutritionConflicts.find(review=>review.food==='draft-1')).toEqual(other);
    expect(nutritionReviewRows(book).find(row=>row.food==='draft-0')).toMatchObject({manual:'9',calculated:'6'});
    expect(calls.length).toBeLessThan(100);
  });
  it('shares dependency-tracked UNITFACTOR graphs without freezing successful or missing conversions',()=>{
    const book=fixture(3),sheet=book.sheets[0];conversions(book,[['tsp','tbsp',3],['tbsp','cup',16]]);
    for(const [row,formula]of [['r0','=UNITFACTOR("tsp","cup")'],['r1','=UNITFACTOR("cup","tsp")'],['r2','=UNITFACTOR("tsp","g")']])setInput(book,sheet,row,'food',formula);
    const engine=new Engine(book),calls=countCells(engine),read=(row:string)=>engine.cell('s',row,'food');
    expect(read('r0')).toBe(48);expect(read('r1')).toBe(1/48);expect(read('r2')).toMatchObject({error:'#N/A'});
    expect(calls.filter(call=>call.column==='factor')).toHaveLength(2);
    setInput(book,sheet,'c0','factor','4');engine.invalidate(['s:c0:factor']);
    expect(read('r0')).toBe(64);expect(read('r1')).toBe(1/64);
    setInput(book,sheet,'c1','to','g');engine.invalidate(['s:c1:to']);
    expect(read('r0')).toMatchObject({error:'#N/A'});expect(read('r2')).toBe(64);
    setInput(book,sheet,'c0','from','spoon');engine.invalidate(['s:c0:from']);
    expect(read('r2')).toMatchObject({error:'#N/A'});
  });
  it('retains conversion identities through table/column renames, column moves and a sheet move',()=>{
    const book=fixture(1);conversions(book,[['scoop','cup',.5]]);rememberNutritionConversions(book);rememberNutritionConversions(book);
    expect(book.references).toHaveLength(1);
    const table=book.tables.find(table=>table.id==='conversions')!,sheet=book.sheets[0];
    table.name='Renamed conversion table';table.columns.reverse();table.columns.forEach(column=>column.name='Renamed '+column.id);sheet.columns.reverse();
    const moved=structuredClone(sheet);moved.id='moved';moved.name='Moved units';book.sheets.push(moved);table.sheet=moved.id;
    for(const row of table.rows)for(const column of table.columns)delete sheet.cells[row+':'+column.column];
    setInput(book,sheet,'r0','food','=UNITFACTOR("scoop","cup")');
    const engine=new Engine(book);expect(engine.cell('s','r0','food')).toBe(.5);
    setInput(book,moved,'c0','factor','.25');engine.invalidate(['moved:c0:factor']);expect(engine.cell('s','r0','food')).toBe(.25);
  });
  it('captures stable destinations and raw linked portions independently of deduplicated reference requests',()=>{
    const book=fixture(1);loggedFoods(book);
    const master=structuredClone(book.sheets[1]),target={sheet:'master-sheet',table:'master'};
    const first=addDraftFood(book,45000,undefined,target);
    first.values={food:'Two mochi',amount:'2',unit:'each',calories:'999',notes:'Original note'};first.ingredient={table:'ingredients',row:'r0'};
    const second=addDraftFood(book,45000,first.id,{sheet:'other-sheet',table:'other-table'});
    second.values={food:'Explicit grams',weight:'47'};second.ingredient={...first.ingredient};
    expect(second.loggingTarget).toEqual(target);expect(second.loggingTarget).not.toBe(first.loggingTarget);
    const batch=newNutritionBatch(book,[45000],'Template');captureData(book).builder=batch;
    expect(batch.items.filter(item=>item.kind==='draft')).toHaveLength(0);
    expect(batch.linkedIntents).toMatchObject([{source:{row:first.id,part:first.id},values:{amount:'2',unit:'each',calories:'999'},overrides:{calories:'999'},target},{source:{row:second.id,part:second.id},values:{weight:'47'},overrides:{},target}]);
    expect(book.sheets[1]).toEqual(master);expect(()=>validateFoodCapture(book.foodCapture)).not.toThrow();
    const snapshot=structuredClone(batch.linkedIntents);first.values.amount='3';first.photos.push('photo-one');
    expect(changedLinkedNutritionIntents(book,batch)).toEqual([`draft:${first.id}:${first.id}`]);
    appendNewFood(book,batch);expect(batch.linkedIntents).toEqual(snapshot);
  });
  it('retains explicit unresolved legacy destinations and never recaptures promoted request identities as logging intents',()=>{
    const book=fixture(1),food=addDraftFood(book,45000);food.values.food='Original description';
    const batch=newNutritionBatch(book,[45000],'Template'),request=batch.items.find(item=>item.kind==='draft')!;
    expect(request.loggingTarget).toBeUndefined();
    food.ingredient={table:'ingredients',row:'r0'};appendNewFood(book,batch);
    expect(batch.linkedIntents).toEqual([]);expect(changedNutritionSnapshots(book,batch)).toContain(request.key);
    const fresh=newNutritionBatch(book,[45000],'Template');
    expect(fresh.linkedIntents).toHaveLength(1);expect(fresh.linkedIntents![0].target).toBeUndefined();
    const legacy={...fresh};delete legacy.linkedIntents;appendNewFood(book,legacy);expect(legacy.linkedIntents).toBeUndefined();
  });
  it('appends new linked intents without refreshing captured source snapshots and validates override/target metadata',()=>{
    const book=fixture(1),data=captureData(book),first=draft({amount:'2',unit:'each',calories:'9'});data.foods.push(first);
    const batch=newNutritionBatch(book,[45000],'Template');data.builder=batch;
    const captured=structuredClone(batch.linkedIntents![0]),next={...draft({weight:'47'}),id:'new-linked'};data.foods.push(next);
    appendNewFood(book,batch);expect(batch.linkedIntents).toHaveLength(2);expect(batch.linkedIntents![0]).toEqual(captured);
    appendNewFood(book,batch);expect(batch.linkedIntents).toHaveLength(2);
    const invalid=structuredClone(data);invalid.builder!.linkedIntents![0].overrides.calories='wrong';
    expect(()=>validateFoodCapture(invalid)).toThrow('override snapshot');
    invalid.builder!.linkedIntents![0]=structuredClone(captured);invalid.builder!.linkedIntents![0].target={sheet:'s',table:''};
    expect(()=>validateFoodCapture(invalid)).toThrow('linked consumption snapshot');
  });
  it('requires a usable Ingredient reference, rejects partial/overflow bases and respects explicit basis overrides',()=>{
    const book=fixture(1),item=newNutritionBatch(book,[],'Template').items[0];
    item.values={food:'Reference',weight:'',amount:'',unit:'each'};
    expect(()=>nutritionReference(item)).toThrow('reference serving');
    item.basis='4 each';expect(()=>nutritionReference(item)).toThrow('cannot be replaced');item.values.unit='';
    item.basis='4 each';expect(nutritionReference(item)).toEqual({amount:4,unit:'each'});
    item.basis='40g';expect(nutritionReference(item)).toEqual({weight:40});
    expect(()=>parseServing('1'+''.padEnd(308,'0')+'kg')).toThrow('numeric range');
    item.selected=true;
    const batch=newNutritionBatch(book,[],'Template');batch.items=[item];
    expect(generateNutritionPrompt(batch)).toContain('"grams": 40');
    expect(generateNutritionPrompt(batch)).not.toContain('"unit": "each"');
  });
  it('keeps linked consumption out of requests, original descriptions intact and prompt text current after reviewed names/notes',()=>{
    const book=fixture(1),data=captureData(book),unlinked=draft({food:'Original with oil',weight:'40',notes:'Context note'},false);
    data.foods.push(unlinked,{...draft({food:'Linked consumption',weight:'2'}),id:'linked'});
    const batch=newNutritionBatch(book,[45000],'Template');data.builder=batch;
    expect(batch.items.filter(item=>item.kind==='draft')).toHaveLength(1);
    const item=batch.items.find(item=>item.kind==='draft')!;
    let prompt=generateNutritionPrompt(batch);expect(prompt).not.toContain('Context note');
    batch.generated=true;item.name='Reviewed name';item.includeNotes=true;refreshNutritionPrompt(batch);
    expect(batch.prompt).toContain('"dishName": "Reviewed name"');expect(batch.prompt).toContain('"originalDescription": "Original with oil"');expect(batch.prompt).toContain('Context note');
    batch.days=[];refreshNutritionPrompt(batch);
    expect(batch.prompt).toBe('');expect(batch.promptIssue).toBe('Select at least one item.');
    batch.days=[45000];refreshNutritionPrompt(batch);expect(batch.promptIssue).toBeUndefined();
    expect(unlinked.values).toEqual({food:'Original with oil',weight:'40',notes:'Context note'});
  });
  it('restores dated name backups by batch, stable key, original description and Item ID, never by display name',()=>{
    const book=fixture(2),data=captureData(book),batch=newNutritionBatch(book,[],'Template');data.builder=batch;
    const version=saveNameVersion(data),encoded=encodeNameBackup(version);
    batch.items[0].name='Same display name';batch.items[1].name='Same display name';
    restoreNameVersion(batch,parseNameBackup(encoded));expect(batch.items.map(item=>item.name)).toEqual(['Food r0','Food r1']);
    const before=structuredClone(batch),bad=structuredClone(version);bad.names[0].key=bad.names[1].key;
    expect(()=>restoreNameVersion(batch,bad)).toThrow('identities');expect(batch).toEqual(before);
    bad.names[0]={...version.names[0],originalName:'Different source description'};
    expect(()=>restoreNameVersion(batch,bad)).toThrow('identities');expect(batch).toEqual(before);
    expect(()=>parseNameBackup('{"format":"fnt-backup","version":1}')).toThrow('nutrition-name backup');
  });
  it('reports changed or removed snapshots without overwriting captured payloads, Item IDs or reviewed names',()=>{
    const book=fixture(2),batch=newNutritionBatch(book,[],'Template'),original=structuredClone(batch.items);
    batch.items[0].name='Reviewed name';
    setInput(book,book.sheets[0],'r0','calories','999');
    book.tables[0].rows=book.tables[0].rows.filter(row=>row!=='r1');
    expect(changedNutritionSnapshots(book,batch)).toEqual(original.map(item=>item.key));
    appendNewFood(book,batch);
    expect(batch.items).toEqual(original.map((item,index)=>index?item:{...item,name:'Reviewed name'}));
  });
  it('queues manual conflicts only for changed recalculations and retains source/consumption values until review',()=>{
    const book=fixture(),food=draft({weight:'2',calories:'9'}),data=captureData(book);data.foods.push(food);
    const before=captureDraftNutrition(book,food.ingredient!),original={...food.values};
    writeIngredientValues(book,food.ingredient!,{calories:'3'});
    const reviews=queueDraftNutritionReview(book,before);
    expect(reviews).toMatchObject([{food:'draft',fields:['calories'],manual:{calories:'9'},calculated:{calories:'6'}}]);
    expect(food.values).toEqual(original);expect(ingredientRecord(book,food.ingredient!).values.calories).toBe('3');
    delete food.values.calories;
    queueDraftNutritionReview(book,captureDraftNutrition(book,food.ingredient!));
    expect(data.nutritionConflicts).toEqual([]);expect(scaledDraft(book,food).values.calories).toBe('6');
  });
  it('does not open manual calorie conflicts for unrelated source fields or name edits',()=>{
    const book=fixture(),food=draft({weight:'2',calories:'9'});captureData(book).foods.push(food);
    const before=captureDraftNutrition(book,food.ingredient!);
    writeIngredientValues(book,food.ingredient!,{food:'New display name',protein:'8'});
    expect(queueDraftNutritionReview(book,before)).toEqual([]);
    expect(food.ingredient).toEqual({table:'ingredients',row:'r0'});
    expect(scaledDraft(book,food).values).toMatchObject({food:'New display name',calories:'9',protein:'16'});
  });
  it.each([false,true])('reviews transitive bulk dependencies for Logged and Draft with projected scope %s',projected=>{
    const book=fixture(2);loggedFoods(book);
    const source=book.sheets[0],master=book.sheets[1],food=draft({weight:'2',calories:'9'});captureData(book).foods.push(food);
    captureData(book).ingredientMappings.push({table:'ingredients',fields:Object.fromEntries(book.tables[0].columns.map(column=>[column.id,column.id]))});
    setInput(book,source,'r0','calories','=E3*2');
    master.cells['logged:mcalories']={value:123,calculation:compile('=Ingredients!E2*2',book,master.id,'logged','mcalories')};
    const before=captureNutritionReview(book,new Engine(book),projected?{cells:new Set(['s:r1:calories','s:r1:protein'])}:'all');
    setInput(book,source,'r1','calories','6');setInput(book,source,'r1','protein','8');
    queueNutritionReview(book,before);
    expect(book.foodCapture!.nutritionConflicts).toMatchObject([
      {food:'draft',fields:['calories'],manual:{calories:'9'},calculated:{calories:'24'}},
      {kind:'logged',food:'master:logged',fields:['calories'],manual:{calories:'123'},calculated:{calories:'24'}}
    ]);
    expect(food.values).toEqual({weight:'2',calories:'9'});expect(master.cells['logged:mcalories'].value).toBe(123);
    expect(()=>validateFoodCapture(book.foodCapture)).not.toThrow();
    const pending=structuredClone(book),rows=nutritionReviewRows(book);
    resolveNutritionReview(book,rows.map(row=>({row,calculated:row.kind==='logged'})));
    expect(food.values.calories).toBe('9');expect(new Engine(book).cell(master.id,'logged','mcalories')).toBe(24);
    expect(book.foodCapture!.nutritionConflicts).toEqual([]);
    const restored=applyUndo(book,structuralUndo(pending,book)).book;
    expect(restored).toEqual(pending);
  });
  it.each([false,true])('tracks conversion factors through renamed stable mappings with projected scope %s',projected=>{
    const book=fixture(1);loggedFoods(book);
    const data=captureData(book),source=book.sheets[0],master=book.sheets[1];
    data.ingredientMappings.push({table:'ingredients',fields:Object.fromEntries(book.tables[0].columns.map(column=>[column.id,column.id]))});
    for(const [field,value]of Object.entries({weight:'100',amount:'1',unit:'portion',calories:'10'}))setInput(book,source,'r0',field,value);
    conversions(book,[['cup','portion',1]]);rememberNutritionConversions(book);
    data.foods.push(draft({amount:'2',unit:'cup',calories:'99'}));
    master.cells['logged:mcalories']={value:123,calculation:compile('=Ingredients!E2*UNITFACTOR("cup","portion")*2',book,master.id,'logged','mcalories')};
    book.tables[0].name='Renamed reference';book.tables[0].columns.reverse();book.tables[0].columns.forEach(column=>column.name='Renamed '+column.id);
    const conversion=book.tables.find(table=>table.id==='conversions')!;conversion.name='Renamed units';conversion.columns.forEach(column=>column.name='Renamed '+column.id);
    const before=captureNutritionReview(book,new Engine(book),projected?{cells:new Set(['s:c0:factor'])}:'all');
    setInput(book,source,'c0','factor','2');queueNutritionReview(book,before);
    const rows=nutritionReviewRows(book);expect(rows.map(row=>[row.kind,row.calculated])).toEqual([['draft','40'],['logged','40']]);
    resolveNutritionReview(book,rows.map(row=>({row,calculated:true})));
    expect(new Engine(book).cell(master.id,'logged','mcalories')).toBe(40);
    expect(scaledDraft(book,data.foods[0]).values).toMatchObject({amount:'2',unit:'cup',weight:'400',calories:'40'});
    expect(data.foods[0].values).toEqual({amount:'2',unit:'cup'});
  });
  it('rejects stale or unavailable recalculation choices atomically and allows keeping the original manual value',()=>{
    const book=fixture(1);loggedFoods(book);
    const source=book.sheets[0],master=book.sheets[1];
    master.cells['logged:mcalories']={value:123,calculation:compile('=Ingredients!E2/Ingredients!B2',book,master.id,'logged','mcalories')};
    let before=captureNutritionReview(book);
    setInput(book,source,'r0','weight','0');queueNutritionReview(book,before);
    let rows=nutritionReviewRows(book);expect(rows[0].calculated).toBe('#DIV/0!');
    const invalid=structuredClone(book);
    expect(()=>resolveNutritionReview(book,rows.map(row=>({row,calculated:true})))).toThrow('unavailable');
    expect(book).toEqual(invalid);
    resolveNutritionReview(book,rows.map(row=>({row,calculated:false})));
    expect(master.cells['logged:mcalories'].value).toBe(123);expect(book.foodCapture!.nutritionConflicts).toEqual([]);
    before=captureNutritionReview(book);setInput(book,source,'r0','weight','2');queueNutritionReview(book,before);
    rows=nutritionReviewRows(book);expect(rows[0].calculated).toBe('1');
    setInput(book,source,'r0','calories','8');
    const stale=structuredClone(book);
    expect(()=>resolveNutritionReview(book,rows.map(row=>({row,calculated:true})))).toThrow('changed');
    expect(book).toEqual(stale);
    resolveNutritionReview(book,nutritionReviewRows(book).map(row=>({row,calculated:true})));
    expect(new Engine(book).cell(master.id,'logged','mcalories')).toBe(4);
  });
  it('queues consumed-quantity changes but not explicit new overrides, and removes deleted Logged targets',()=>{
    const book=fixture(1);loggedFoods(book);
    const master=book.sheets[1],table=book.tables.find(table=>table.id==='master')!;
    table.columns.push({id:'amount',column:'amount',name:'Amount'});master.columns.push({id:'amount',label:'Amount'});
    master.mealLog!.fields.amount='amount';setInput(book,master,'logged','amount','2');
    master.cells['logged:mcalories']={value:123,calculation:compile('=Ingredients!E2*F3',book,master.id,'logged','mcalories')};
    let before=captureNutritionReview(book);setInput(book,master,'logged','amount','3');queueNutritionReview(book,before);
    expect(nutritionReviewRows(book)).toMatchObject([{kind:'logged',manual:'123',calculated:'6'}]);
    resolveNutritionReview(book,nutritionReviewRows(book).map(row=>({row,calculated:false})));
    before=captureNutritionReview(book);setInput(book,master,'logged','mcalories','555');queueNutritionReview(book,before);
    expect(book.foodCapture!.nutritionConflicts).toEqual([]);expect(master.cells['logged:mcalories'].value).toBe(555);
    before=captureNutritionReview(book);setInput(book,master,'logged','amount','4');queueNutritionReview(book,before);
    expect(nutritionReviewRows(book)[0].calculated).toBe('8');
    before=captureNutritionReview(book);table.rows=table.rows.filter(row=>row!=='logged');master.rows=master.rows.filter(row=>row.id!=='logged');
    queueNutritionReview(book,before);expect(book.foodCapture!.nutritionConflicts).toEqual([]);
  });
  it('does not use cached manual cells to hide self-cycles or enable a mutually circular set of recalculations',()=>{
    const book=fixture(1);loggedFoods(book);
    const master=book.sheets[1],table=book.tables.find(table=>table.id==='master')!;
    table.columns.push({id:'protein',column:'protein',name:'Protein'});master.columns.push({id:'protein',label:'Protein'});master.mealLog!.fields.protein='protein';
    master.cells['logged:mcalories']={value:123,calculation:{kind:'literal',value:1}};
    master.cells['logged:protein']={value:7,calculation:{kind:'literal',value:1}};
    const before=captureNutritionReview(book);
    const self=compile('=E3*2',book,master.id,'logged','mcalories'),engine=new Engine(book);
    expect(engine.cell(master.id,'logged','mcalories')).toBe(123);
    expect(engine.evaluateCalculation(self,master.id,'logged','mcalories')).toMatchObject({error:'#CYCLE!'});
    expect(engine.cell(master.id,'logged','mcalories')).toBe(123);
    master.cells['logged:mcalories'].calculation=compile('=F3*2',book,master.id,'logged','mcalories');
    master.cells['logged:protein'].calculation=self;
    queueNutritionReview(book,before);
    const rows=nutritionReviewRows(book);expect(rows.map(row=>row.calculated)).toEqual(['14','246']);
    const saved=structuredClone(book);
    expect(()=>resolveNutritionReview(book,rows.map(row=>({row,calculated:true})))).toThrow('unavailable');
    expect(book).toEqual(saved);
    resolveNutritionReview(book,rows.map(row=>({row,calculated:row.field==='calories'})));
    expect(new Engine(book).cell(master.id,'logged','mcalories')).toBe(14);
    expect(master.cells['logged:protein'].value).toBe(7);
  });
  it('scopes Draft metadata recalculation without reevaluating Logged overrides or losing their pending choices',()=>{
    const book=fixture(1);loggedFoods(book);
    const data=captureData(book),source=book.sheets[0],master=book.sheets[1],food=draft({weight:'2',calories:'9'});data.foods.push(food);
    data.ingredientMappings.push({table:'ingredients',fields:Object.fromEntries(book.tables[0].columns.map(column=>[column.id,column.id]))});
    master.cells['logged:mcalories']={value:123,calculation:compile('=Ingredients!E2*2',book,master.id,'logged','mcalories')};
    const before=captureNutritionReview(book);setInput(book,source,'r0','calories','3');queueNutritionReview(book,before);
    resolveNutritionReview(book,nutritionReviewRows(book).filter(row=>row.kind==='draft').map(row=>({row,calculated:false})));
    const logged=structuredClone(data.nutritionConflicts),engine=new Engine(book),calls=countCells(engine),metadata=captureNutritionReview(book,engine,'draft');
    food.values.weight='4';queueNutritionReview(book,metadata,engine);
    expect(calls.filter(call=>call.sheet===master.id)).toEqual([]);
    expect(data.nutritionConflicts!.filter(review=>review.kind==='logged')).toEqual(logged);
    expect(data.nutritionConflicts!.find(review=>review.kind!=='logged')).toMatchObject({fields:['calories'],calculated:{calories:'12'}});
  });
  it('constructs a historical Engine only when a projected edit needs nutrition values',()=>{
    const book=fixture(2);loggedFoods(book);
    const master=book.sheets[1];
    master.cells['logged:mcalories']={value:123,calculation:compile('=Ingredients!E2*2',book,master.id,'logged','mcalories')};
    let created=0;
    const reader=()=>{created++;return new Engine(book);};
    const unrelated=captureNutritionReview(book,reader,{cells:new Set(['unrelated:row:column'])});
    expect(unrelated.drafts.size).toBe(0);expect(unrelated.logged.size).toBe(0);expect(created).toBe(0);
    const affected=captureNutritionReview(book,reader,{cells:new Set([`${book.sheets[0].id}:r0:calories`])});
    expect(affected.logged.has('master:logged')).toBe(true);expect(created).toBe(1);
  });
  it('reviews an actual Add as ingredient manual Logged value without inventing a prior formula',()=>{
    const book=fixture(1);loggedFoods(book);
    const master=book.sheets[1],table=book.tables.find(table=>table.id==='master')!;
    table.columns.push({id:'grams',column:'grams',name:'Amount (g)'});master.columns.push({id:'grams',label:'Amount (g)'});master.mealLog!.fields.weight='grams';
    master.cells['logged:grams']={value:2};
    const identity=addMealIngredient(book,master,'logged'),source=book.sheets[0],sourceTable=book.tables[0];
    expect(master.cells['logged:mcalories'].calculation).toBeUndefined();expect(master.cells['logged:mcalories'].formula).toBeUndefined();
    const before=captureNutritionReview(book);
    sourceTable.columns.reverse();sourceTable.columns.forEach(column=>column.name='Renamed '+column.id);sourceTable.name='Renamed source';
    table.columns.forEach(column=>column.name='Renamed '+column.id);
    setInput(book,source,identity.row,'calories','124');queueNutritionReview(book,before);
    const rows=nutritionReviewRows(book);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({kind:'logged',manual:'123',calculated:'124'});
    expect(master.cells['logged:mcalories'].value).toBe(123);
    resolveNutritionReview(book,rows.map(row=>({row,calculated:true})));
    expect(new Engine(book).cell(master.id,'logged','mcalories')).toBe(124);
    expect(master.cells['logged:grams'].value).toBe(2);expect(source.cells[`${identity.row}:weight`].value).toBe(2);
    expect(master.cells['logged:mfood'].binding).toMatchObject(identity);
  });
  it('keeps plain linked manual nutrition separate from unbound text and rejects missing source values',()=>{
    const book=fixture(1);loggedFoods(book);
    const master=book.sheets[1],table=book.tables.find(table=>table.id==='master')!;
    table.columns.push({id:'grams',column:'grams',name:'Amount (g)'});master.columns.push({id:'grams',label:'Amount (g)'});master.mealLog!.fields.weight='grams';
    master.cells['linked:grams']={value:2};master.cells['linked:mcalories']={value:9};
    master.cells['logged:mfood']={value:'Food r0'};
    const before=captureNutritionReview(book);
    expect([...before.logged.keys()]).toEqual(['master:linked']);
    setInput(book,book.sheets[0],'r0','calories','');queueNutritionReview(book,before);
    let rows=nutritionReviewRows(book);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({manual:'9',calculated:'#VALUE!'});
    const unchanged=structuredClone(book);
    expect(()=>resolveNutritionReview(book,rows.map(row=>({row,calculated:true})))).toThrow('unavailable');expect(book).toEqual(unchanged);
    resolveNutritionReview(book,rows.map(row=>({row,calculated:false})));
    const missing=captureNutritionReview(book);setInput(book,book.sheets[0],'r0','calories','3');queueNutritionReview(book,missing);
    rows=nutritionReviewRows(book);expect(rows[0]).toMatchObject({manual:'9',calculated:'6'});
    resolveNutritionReview(book,rows.map(row=>({row,calculated:true})));
    expect(new Engine(book).cell(master.id,'linked','mcalories')).toBe(6);expect(master.cells['logged:mcalories'].value).toBe(123);
  });
  it('projects an explicit Logged Ingredient rebind even when its old formula references only source IDs',()=>{
    const book=fixture(2);loggedFoods(book);
    const master=book.sheets[1],table=book.tables.find(table=>table.id==='master')!;
    table.columns.push({id:'grams',column:'grams',name:'Amount (g)'});master.columns.push({id:'grams',label:'Amount (g)'});master.mealLog!.fields.weight='grams';
    master.cells['linked:grams']={value:2};master.cells['linked:mcalories']={value:9};
    setInput(book,book.sheets[0],'r1','calories','5');
    const before=captureNutritionReview(book,new Engine(book),{cells:new Set([`${master.id}:linked:mfood`])});
    master.cells['linked:mfood'].binding!.row='r1';queueNutritionReview(book,before);
    expect(nutritionReviewRows(book)).toMatchObject([{kind:'logged',manual:'9',calculated:'10'}]);
    expect(master.cells['linked:mcalories'].value).toBe(9);
  });
  it('does not derive plain manual nutrition from an Ingredient row or name column outside its source table',()=>{
    for(const missing of ['row','column']){
      const book=fixture(2);loggedFoods(book);
      const master=book.sheets[1],table=book.tables.find(table=>table.id==='master')!,source=book.tables[0];
      table.columns.push({id:'grams',column:'grams',name:'Amount (g)'});master.columns.push({id:'grams',label:'Amount (g)'});master.mealLog!.fields.weight='grams';
      master.cells['linked:grams']={value:2};master.cells['linked:mcalories']={value:9};
      expect(captureNutritionReview(book).logged.has('master:linked')).toBe(true);
      const binding=master.cells['linked:mfood'].binding!;
      if(missing==='row')source.rows=source.rows.filter(row=>row!==binding.row);
      else source.columns=source.columns.filter(column=>column.id!==binding.column);
      const before=captureNutritionReview(book);
      expect(before.logged.has('master:linked')).toBe(false);
      setInput(book,book.sheets[0],binding.row,'calories','3');queueNutritionReview(book,before);
      expect(nutritionReviewRows(book)).toEqual([]);
      expect(master.cells['linked:mcalories'].value).toBe(9);
    }
  });
  it('reviews plain linked unit portions without filling consumption fields or accepting self-cycles',()=>{
    const book=fixture(1);loggedFoods(book);
    const master=book.sheets[1],table=book.tables.find(table=>table.id==='master')!,source=book.sheets[0];
    for(const [id,name]of [['amount','Amount'],['unit','Unit']]){
      table.columns.push({id,column:id,name});master.columns.push({id,label:name});
    }
    master.mealLog!.fields.amount='amount';master.mealLog!.fields.unit='unit';
    master.cells['linked:amount']={value:2};master.cells['linked:unit']={value:'each'};master.cells['linked:mcalories']={value:99};
    setInput(book,source,'r0','weight','40');setInput(book,source,'r0','amount','4');setInput(book,source,'r0','unit',"'each");setInput(book,source,'r0','calories','80');
    let before=captureNutritionReview(book);setInput(book,source,'r0','amount','2');queueNutritionReview(book,before);
    let rows=nutritionReviewRows(book);expect(rows[0]).toMatchObject({manual:'99',calculated:'80'});
    resolveNutritionReview(book,rows.map(row=>({row,calculated:false})));
    before=captureNutritionReview(book);
    source.cells['r0:calories']={formula:{kind:'ref',sheet:master.id,row:'linked',column:'mcalories',absRow:true,absCol:true}};
    queueNutritionReview(book,before);rows=nutritionReviewRows(book);expect(rows[0].calculated).toBe('#CYCLE!');
    expect(()=>resolveNutritionReview(book,rows.map(row=>({row,calculated:true})))).toThrow('unavailable');
    expect(master.cells['linked:mcalories'].value).toBe(99);expect(master.cells['linked:amount'].value).toBe(2);
    expect(master.cells['linked:unit'].value).toBe('each');expect(master.cells['linked:mweight']).toBeUndefined();
  });
  it('lets a restored stale review acknowledge a missing target without altering any current cells',()=>{
    const book=fixture(1);loggedFoods(book);
    const master=book.sheets[1];master.cells['logged:mcalories']={value:123,calculation:compile('=Ingredients!E2*2',book,master.id,'logged','mcalories')};
    const before=captureNutritionReview(book);setInput(book,book.sheets[0],'r0','calories','3');queueNutritionReview(book,before);
    book.tables=book.tables.filter(table=>table.id!=='master');
    const cells=structuredClone(book.sheets.map(sheet=>sheet.cells)),rows=nutritionReviewRows(book);
    expect(rows).toHaveLength(1);expect(rows[0].calculated).toContain('Unavailable');
    expect(()=>resolveNutritionReview(book,rows.map(row=>({row,calculated:true})))).toThrow('unavailable');
    resolveNutritionReview(book,rows.map(row=>({row,calculated:false})));
    expect(book.foodCapture!.nutritionConflicts).toEqual([]);expect(book.sheets.map(sheet=>sheet.cells)).toEqual(cells);
  });
  it('shares one source context across a thousand manual Drafts and queues only changed dependencies',()=>{
    const book=fixture(900),data=captureData(book),engine=new Engine(book),calls=countCells(engine);
    data.foods=Array.from({length:1000},(_,index)=>({...draft({weight:'2',calories:'9'}),id:'draft-'+index,ingredient:{table:'ingredients',row:'r'+index%900}}));
    const before=captureNutritionReview(book,engine);
    setInput(book,book.sheets[0],'r0','calories','3');engine.invalidate(['s:r0:calories']);queueNutritionReview(book,before,engine);
    expect(data.nutritionConflicts?.map(review=>review.food)).toEqual(['draft-0','draft-900']);
    expect(calls.length).toBeLessThan(24000);
    expect(data.foods.every(food=>food.values.calories==='9'&&food.values.weight==='2')).toBe(true);
  });
  it('projects a source edit across 1000 Drafts and 6000 Logged overrides while preserving unrelated pending choices',()=>{
    const book=fixture(900);loggedFoods(book);
    const master=book.sheets[1],table=book.tables.find(table=>table.id==='master')!,data=captureData(book),source=book.sheets[0];
    data.ingredientMappings.push({table:'ingredients',fields:Object.fromEntries(book.tables[0].columns.map(column=>[column.id,column.id]))});
    const fields=['calories','protein','fat','carbs','sugar','sodium'] as const;
    for(const field of fields)if(field!=='calories'){
      const id='m'+field;table.columns.push({id,column:id,name:field});master.columns.push({id,label:field});master.mealLog!.fields[field]=id;
    }
    table.rows=Array.from({length:1000},(_,index)=>'log-'+index);master.rows=['mh',...table.rows].map(id=>({id}));master.cells={};
    table.rows.forEach((row,index)=>{
      master.cells[`${row}:mfood`]={value:'Logged '+index};
      for(const field of fields)master.cells[`${row}:m${field}`]={value:9,calculation:{kind:'binary',op:'*',left:{kind:'ref',sheet:source.id,row:'r'+index%900,column:field,absRow:true,absCol:true},right:{kind:'literal',value:2}}};
    });
    data.foods=Array.from({length:1000},(_,index)=>({...draft({weight:'2',calories:'9'}),id:'draft-'+index,ingredient:{table:'ingredients',row:'r'+index%900}}));
    const prior={kind:'logged' as const,food:'master:log-1',target:{sheet:master.id,table:table.id,row:'log-1'},fields:['protein'] as ('protein')[],manual:{protein:'9'},calculated:{protein:'4'}};
    data.nutritionConflicts=[prior];
    const engine=new Engine(book),calls=countCells(engine),before=captureNutritionReview(book,engine,{cells:new Set(['s:r0:calories'])});
    expect([...before.drafts.keys()]).toEqual(['draft-0','draft-900']);expect([...before.logged.keys()]).toEqual(['master:log-0','master:log-900']);
    setInput(book,source,'r0','calories','3');engine.invalidate(['s:r0:calories']);queueNutritionReview(book,before,engine);
    expect(data.nutritionConflicts).toHaveLength(5);expect(data.nutritionConflicts.find(review=>review.food===prior.food)).toEqual(prior);
    expect(data.nutritionConflicts.filter(review=>review.food!==prior.food).every(review=>review.calculated.calories==='6')).toBe(true);
    expect(calls.length).toBeLessThan(150);
    expect(master.cells['log-0:mcalories'].value).toBe(9);expect(data.foods[0].values.calories).toBe('9');
  });
  it('applies Ingredient values by mapped column identity after renames, preserving notes/photos and formula inputs',()=>{
    const book=fixture(),identity={table:'ingredients',row:'r0'},data=captureData(book);
    data.ingredientMappings.push({table:'ingredients',fields:Object.fromEntries(book.tables[0].columns.map(column=>[column.id,column.id]))});
    data.ingredientDetails['ingredients:r0']={notes:'Old notes',photos:['photo1']};
    for(const column of book.tables[0].columns)column.name='Renamed '+column.id;
    book.tables[0].columns.reverse();
    writeIngredientValues(book,identity,{food:'Literal =name',calories:'=10+2',notes:'New notes'});
    expect(ingredientRecord(book,identity).values).toMatchObject({food:'Literal =name',calories:'12'});
    expect(data.ingredientDetails['ingredients:r0']).toEqual({notes:'New notes',photos:['photo1']});
    const snapshot=structuredClone(book);
    expect(()=>writeIngredientValues(book,identity,{calories:'999',type:'Missing field'})).toThrow('Restore');
    expect(book).toEqual(snapshot);
  });
  it('writes Ingredient inputs without evaluating unused formulas and still rejects another workbook context',()=>{
    const book=fixture(),sheet=book.sheets[0],identity={table:'ingredients',row:'r0'};
    setInput(book,sheet,'r0','protein','=SUM(2,3)');
    const formula=structuredClone(sheet.cells['r0:protein']),reads=vi.spyOn(Engine.prototype,'cell');
    try{
      writeIngredientValues(book,identity,{calories:'12'});
      expect(reads).not.toHaveBeenCalled();
    }finally{reads.mockRestore();}
    expect(sheet.cells['r0:calories'].value).toBe(12);
    expect(sheet.cells['r0:protein']).toEqual(formula);
    const before=structuredClone(book),other=createFoodCaptureContext(fixture());
    expect(()=>writeIngredientValues(book,identity,{calories:'99'},other)).toThrow('different workbook');
    expect(book).toEqual(before);
  });
  it.each([10,100])('reads %i Ingredient rows linearly and retains values/order',count=>{
    const book=fixture(count),engine=new Engine(book),table=book.tables[0];let reads=0;
    table.rows=new Proxy(table.rows,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}});
    const calls=countCells(engine),context=createFoodCaptureContext(book,engine),items=ingredientList(book,context);
    expect(reads).toBe(2*count);
    expect(calls).toHaveLength(count*10);
    expect(items.map(item=>item.row)).toEqual(Array.from({length:count},(_,i)=>'r'+i));
    expect(items[0].values).toMatchObject({food:'Food r0',weight:'1',amount:'',calories:'2'});
    expect(items[0].missing).toEqual([]);
    expect(ingredientRecord(book,{table:table.id,row:'r0'},context).values).toEqual(items[0].values);
    expect(reads).toBe(2*count);
    expect(()=>ingredientRecord(book,{table:table.id,row:'removed'},context)).toThrow('removed');
  });
  it('finds formula-derived duplicate names using only names and stops early',()=>{
    const book=fixture(100);setInput(book,book.sheets[0],'r0','food','="  Match Me  "');
    const engine=new Engine(book),calls=countCells(engine),before=structuredClone(book);
    expect(()=>addDraftIngredient(book,draft({food:'match me'},false),engine)).toThrow('already exists');
    expect(calls).toEqual([{sheet:'s',row:'r0',column:'food'}]);
    expect(book).toEqual(before);
  });
  it('adds a nonduplicate Ingredient with normal cell semantics and independent photos',()=>{
    const book=fixture(),food=draft({food:'  New food  ',weight:'40',unit:'each',calories:'200',notes:'Recipe'},false);
    food.photos=['photo1'];const engine=new Engine(book),calls=countCells(engine);
    const identity=addDraftIngredient(book,food,engine);
    expect(calls.filter(call=>call.column==='food')).toHaveLength(3);
    expect(calls.every(call=>call.column==='food')).toBe(true);
    expect(book.tables[0].rows).toContain(identity.row);
    expect(food.ingredient).toEqual(identity);
    expect(ingredientRecord(book,identity).values).toMatchObject({food:'  New food  ',weight:'40',unit:'each',calories:'200'});
    food.photos.push('photo2');
    expect(captureData(book).ingredientDetails['ingredients:'+identity.row]).toEqual({notes:'Recipe',photos:['photo1']});
  });
  it('rejects mismatched readers even on same-unit and unlinked early returns',()=>{
    const book=fixture(),other=fixture(),engine=new Engine(other),context=createFoodCaptureContext(other,engine);
    expect(()=>createFoodCaptureContext(book,engine)).toThrow('different workbook');
    for(const reader of [engine,context]){
      for(const call of [
        ()=>ingredientList(book,reader),()=>ingredientRecord(book,{table:'ingredients',row:'r0'},reader),
        ()=>quantityFactor(book,'each','pieces',reader),()=>scaledDraft(book,draft({},false),reader),
        ()=>availableFoodDays(book,reader),()=>nutritionCandidates(book,[],reader),
        ()=>newNutritionBatch(book,[],'',reader),()=>addDraftIngredient(book,draft({food:'New'},false),reader)
      ])expect(call).toThrow('different workbook');
      const batch=newNutritionBatch(book,[],'');expect(()=>appendNewFood(book,batch,reader)).toThrow('different workbook');
    }
  });
  it('shares conversion source reads and caches both successful and missing paths',()=>{
    const book=fixture();conversions(book,[['a','b',2],['b','c',3]]);
    const engine=new Engine(book),calls=countCells(engine),context=createFoodCaptureContext(book,engine);
    expect(quantityFactor(book,' EACH ','pieces',context)).toBe(1);expect(calls).toHaveLength(0);
    expect(quantityFactor(book,'a','c',context)).toBe(6);expect(calls).toHaveLength(6);
    expect(quantityFactor(book,'c','a',context)).toBeCloseTo(1/6);
    expect(quantityFactor(book,'a','missing',context)).toBeUndefined();
    expect(context.conversions.get('a')?.has('missing')).toBe(true);
    const graph=context.conversionGraph!;
    const get=graph.get.bind(graph);let graphReads=0;graph.get=key=>{graphReads++;return get(key);};
    expect(quantityFactor(book,'a','missing',context)).toBeUndefined();
    expect(quantityFactor(book,'a','c',context)).toBe(6);
    expect(graphReads).toBe(0);expect(calls).toHaveLength(6);
  });
  it('retains duplicate overwrite, reciprocal, BFS and built-in precedence',()=>{
    const book=fixture();conversions(book,[['a','b',2],['a','b',4],['a','c',3],['b','d',5],['c','d',7],['kg','g',2000]]);
    const context=createFoodCaptureContext(book);
    expect(quantityFactor(book,'a','b',context)).toBe(4);
    expect(quantityFactor(book,'b','a',context)).toBe(.25);
    expect(quantityFactor(book,'a','d',context)).toBe(20);
    expect(quantityFactor(book,'kg','g',context)).toBe(2000);
    expect(quantityFactor(book,'g','kg',context)).toBe(.0005);
  });
  it('rejects overflow/underflow without selecting a later viable BFS route',()=>{
    for(const factor of [1e308,1e-308]){
      const book=fixture();conversions(book,[['a','b',factor],['a','c',2],['b','d',factor],['c','d',3]]);
      const context=createFoodCaptureContext(book);
      expect(quantityFactor(book,'a','d',context)).toBeUndefined();
      expect(quantityFactor(book,'a','d',context)).toBeUndefined();
    }
  });
  it('rebuilds request caches after formula/dependency and structural edits',()=>{
    const book=fixture();conversions(book,[['a','b',2]]);
    setInput(book,book.sheets[0],'c0','factor','=E2+1');
    const engine=new Engine(book),before=createFoodCaptureContext(book,engine);
    expect(quantityFactor(book,'a','b',before)).toBe(3);
    expect(quantityFactor(book,'a','c',before)).toBeUndefined();
    setInput(book,book.sheets[0],'r0','calories','4');engine.invalidate(['s:r0:calories']);
    const after=createFoodCaptureContext(book,engine);expect(quantityFactor(book,'a','b',after)).toBe(5);
    setInput(book,book.sheets[0],'c0','to',"'c");engine.invalidate(['s:c0:to']);
    const renamed=createFoodCaptureContext(book,engine);expect(quantityFactor(book,'a','b',renamed)).toBeUndefined();
    expect(quantityFactor(book,'a','c',renamed)).toBe(5);
    book.tables[0].rows=book.tables[0].rows.filter(row=>row!=='r0');
    expect(()=>ingredientRecord(book,{table:'ingredients',row:'r0'})).toThrow('removed');
  });
  it('scales multiple drafts with one graph, preserving zero and manual overrides',()=>{
    const book=fixture(1);conversions(book,[['portion','g',20]]);
    const engine=new Engine(book),calls=countCells(engine),context=createFoodCaptureContext(book,engine);
    const first=scaledDraft(book,draft({amount:'2',unit:'portion',calories:'999'}),context);
    expect(first.issue).toBeUndefined();expect(first.values).toMatchObject({weight:'40',calories:'999',protein:'80'});
    const zero=scaledDraft(book,draft({amount:'0',unit:'portion'}),context);
    expect(zero.issue).toBeUndefined();expect(zero.values).toMatchObject({weight:'0',calories:'0',protein:'0'});
    expect(calls.filter(call=>call.row.startsWith('c'))).toHaveLength(3);
  });
  it('scales against an amount-based serving and diagnoses missing conversion without fallback',()=>{
    const book=fixture(1),sheet=book.sheets[0];
    sheet.cells['r0:weight']={value:null};sheet.cells['r0:amount']={value:2};sheet.cells['r0:unit']={value:'each'};
    conversions(book,[['g','each',.5]]);
    expect(scaledDraft(book,draft({weight:'8'}))).toMatchObject({values:{calories:'4'}});
    expect(scaledDraft(book,draft({amount:'0',unit:'pieces'}))).toMatchObject({values:{calories:'0'}});
    const missing=scaledDraft(book,draft({amount:'2',unit:'unknown',calories:'777'}));
    expect(missing.issue).toBeTruthy();expect(missing.values.calories).toBe('777');
    expect(missing.values.protein).toBeUndefined();
  });
  it('retains zero placeholders in unused reference dimensions, not a zero reference divisor',()=>{
    const book=fixture(1),sheet=book.sheets[0];
    sheet.cells['r0:amount']={value:0};
    expect(scaledDraft(book,draft({weight:'2'}))).toMatchObject({values:{calories:'4'}});
    expect(scaledDraft(book,draft({weight:'2'})).issue).toBeUndefined();
    sheet.cells['r0:weight']={value:0};sheet.cells['r0:amount']={value:2};sheet.cells['r0:unit']={value:'each'};
    expect(scaledDraft(book,draft({amount:'4',unit:'pieces'}))).toMatchObject({values:{calories:'4'}});
    expect(scaledDraft(book,draft({amount:'4',unit:'pieces'})).issue).toBeUndefined();
  });
  it.each(['-1','Infinity','NaN','1e999'])('reports invalid consumed quantity %s without losing manual nutrients',value=>{
    const book=fixture(1),result=scaledDraft(book,draft({weight:value,calories:'777'}));
    expect(result.issue).toBeTruthy();expect(result.values.calories).toBe('777');
    expect(result.values.protein).toBeUndefined();
  });
  it('reports invalid reference quantities and arithmetic overflow explicitly',()=>{
    const book=fixture(1);
    for(const value of [-1,0,Infinity]){
      book.sheets[0].cells['r0:weight']={value};
      const result=scaledDraft(book,draft({weight:'1'}));expect(result.issue).toBeTruthy();
      expect(result.values.calories).toBeUndefined();
    }
    book.sheets[0].cells['r0:weight']={value:1e-308};
    expect(scaledDraft(book,draft({weight:'1e308'})).issue).toBeTruthy();
    book.sheets[0].cells['r0:weight']={value:1};
    book.sheets[0].cells['r0:calories']={value:1e308};
    const result=scaledDraft(book,draft({weight:'2'}));
    expect(result.issue).toContain('numeric range');expect(result.values.calories).toBeUndefined();
    expect(result.values.protein).toBe('4');
  });
  it('freezes Ingredient candidate photos and fingerprint independently of source changes',()=>{
    const book=fixture(1),data=captureData(book);
    data.ingredientDetails['ingredients:r0']={notes:'Recipe',photos:['photo1']};
    const item=nutritionCandidates(book,[])[0],fingerprint=item.fingerprint;
    data.ingredientDetails['ingredients:r0'].photos.push('photo2');
    expect(item.photos).toEqual(['photo1']);expect(item.fingerprint).toBe(fingerprint);
    item.photos.push('batch-photo');
    expect(data.ingredientDetails['ingredients:r0'].photos).toEqual(['photo1','photo2']);
  });
  it('skips captured Ingredient and draft payloads before reading values and retains batch IDs',()=>{
    const book=fixture(2),data=captureData(book),food=draft({food:'Draft'},false);
    food.mode='multi';food.parts=[{id:'part1',text:'One'},{id:'part2',text:'Two'}];data.foods.push(food);
    const batch=newNutritionBatch(book,[45000],'Template'),previous=structuredClone(batch.items);
    book.sheets[0].cells['r0:calories']={value:999};
    const engine=new Engine(book),calls=countCells(engine);
    Object.defineProperty(food,'photos',{get(){throw Error('Existing draft payload was evaluated');},configurable:true});
    expect(appendNewFood(book,batch,engine)).toBe(0);expect(calls).toHaveLength(0);
    expect(batch.items).toEqual(previous);
    delete data.ingredientDetails['ingredients:r0'];
    const table=book.tables[0],sheet=book.sheets[0];table.rows.push('new-row');sheet.rows.push({id:'new-row'});
    sheet.cells['new-row:food']={value:'New Ingredient'};
    const nextEngine=new Engine(book),nextCalls=countCells(nextEngine);
    expect(appendNewFood(book,batch,nextEngine)).toBe(1);
    expect(nextCalls.every(call=>call.row==='new-row')).toBe(true);
    expect(nextCalls).toHaveLength(10);
    expect(batch.items.slice(0,previous.length)).toEqual(previous);
    expect(batch.items.at(-1)?.id).toBe('I00005');
  });
  it('skips existing logged payloads but still discovers selected dates and new rows',()=>{
    const book=fixture(1);loggedFoods(book);
    const batch=newNutritionBatch(book,[45000],'Template'),old=structuredClone(batch.items),engine=new Engine(book),calls=countCells(engine);
    expect(batch.items.map(item=>item.key)).toEqual(['ingredient:ingredients:r0','logged:master:logged']);
    expect(availableFoodDays(book,engine)).toEqual([45001,45000]);calls.length=0;
    expect(appendNewFood(book,batch,engine)).toBe(0);
    expect(calls.filter(call=>call.column!=='mmarker'&&call.column!=='mdate')).toEqual([]);
    expect(batch.items).toEqual(old);
    const master=book.tables[1],sheet=book.sheets[1];
    master.rows.splice(2,0,'new-log');sheet.rows.splice(3,0,{id:'new-log'});sheet.cells['new-log:mfood']={value:'New logged food'};
    expect(appendNewFood(book,batch)).toBe(1);
    expect(batch.items.at(-1)).toMatchObject({id:'I00003',key:'logged:master:new-log',name:'New logged food',date:45000});
    expect(batch.items.slice(0,old.length)).toEqual(old);
  });
});
