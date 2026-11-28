import {describe,expect,it,vi} from 'vitest';
import {Engine,scalar} from '../src/formula';
import {clone,getCell,setInput,type Workbook} from '../src/model';
import {nutrients} from '../src/food-capture';
import {masterDayBlocks} from '../src/day-logging';
import {validateBook} from '../src/storage';
import {mapNutritionTable,parseNutritionTable} from '../src/nutrition-table';
import {newConverterState,validateConverterState} from '../src/nutrition-converter';
import {newStandaloneConverterState,prepareStandaloneImport,remapStandaloneTable,reviewStandaloneImport,standaloneDestinations,standaloneReview,standaloneTypeChoices,validateStandaloneReceipt,validateStandaloneState,type StandaloneReview} from '../src/nutrition-converter-import';
import {syntheticConverterBook} from './converter-polish-fixture';

const source='Food,Calories,Protein,Fat,Carbs,Sugar,Sodium,Weight (g),Amount,Unit\nSoup (vegetables),100,4,2,18,0,45,120,,\n"Rice, tofu",200,8,3,35,1,80,150,,';
function request(book:Workbook,kind:'master'|'ingredients'='master',raw=source):StandaloneReview{
  const state=newStandaloneConverterState();state.raw=raw;state.parsed=parseNutritionTable(raw);state.processedRaw=raw;state.rows=mapNutritionTable(state.parsed);
  const target=standaloneDestinations(book).find(target=>target.kind===kind)!;
  state.target={kind:target.kind,sheet:target.sheet,table:target.table,fields:target.fields};state.date='2023-03-16';state.types=kind==='ingredients'?['Homemade','Packaged']:[];
  return standaloneReview(state);
}
describe('standalone reviewed table Add',()=>{
  it.each(['master','ingredients'] as const)('builds a read-only %s Review plan without allocating target rows or receipts',kind=>{
    const book=syntheticConverterBook(),review=request(book,kind),before=clone(book);
    const freeze=(value:object)=>{Object.freeze(value);for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);};
    freeze(book);freeze(review);
    const identity=vi.spyOn(crypto,'randomUUID');
    let plan:ReturnType<typeof reviewStandaloneImport>;
    try{plan=reviewStandaloneImport(book,review);expect(identity).not.toHaveBeenCalled();}
    finally{identity.mockRestore();}
    expect(book).toEqual(before);expect(plan.alreadyApplied).toBe(false);
    expect(plan).not.toHaveProperty('book');expect(plan).not.toHaveProperty('receipt');
    expect(plan.entries).toHaveLength(2);expect(plan.entries.every(entry=>!('target'in entry))).toBe(true);
    const applied=prepareStandaloneImport(before,review);
    expect(plan.entries).toEqual(applied.receipt.entries.map(({target,...entry})=>entry));
    const retry=reviewStandaloneImport(applied.book,review,[applied.receipt]);
    expect(retry.alreadyApplied).toBe(true);expect(retry.entries).toEqual(plan.entries);
    const changed=clone(review);changed.rows[0].calories='101';
    expect(()=>reviewStandaloneImport(applied.book,changed,[applied.receipt])).toThrow('already applied with different values');
  });
  it('read-only Review rejects structural date/marker faults and worksheet exhaustion without touching the workbook',()=>{
    for(const mode of ['marker','date','totals','capacity'] as const){
      const book=syntheticConverterBook(),review=request(book),sheet=book.sheets[0],table=book.tables[0];
      if(mode==='marker')setInput(book,sheet,table.rows[0],table.columns[2].column,'=1/0');
      if(mode==='date')setInput(book,sheet,table.rows[0],table.columns[0].column,'=1/0');
      if(mode==='totals')sheet.dayLogging!.totals.push('removed-field');
      if(mode==='capacity')sheet.rows.push(...Array.from({length:99993},(_,index)=>({id:'padding-'+index})));
      const before=clone(book);
      expect(()=>reviewStandaloneImport(book,review)).toThrow();
      expect(book).toEqual(before);
    }
  });
  it('starting or resetting a tracked batch preserves a deep-cloned standalone operation and its pending choices',()=>{
    const review=request(syntheticConverterBook(),'ingredients');
    const standalone={...newStandaloneConverterState(),...review,processedRaw:source,pendingMapping:[...review.parsed.mapping]};
    standalone.pendingMapping[2]='fat';
    const before=clone(standalone),reset=newConverterState('replacement-batch',standalone);
    expect(reset).toMatchObject({batch:'replacement-batch',mode:'tracked',raw:'',rows:[],choices:{},linkedChoices:{}});
    expect(reset.standalone).toEqual(before);
    expect(()=>standaloneReview(reset.standalone!)).toThrow('Rebuild the pending column mapping');
    reset.standalone!.pendingMapping![2]='protein';reset.standalone!.rows[0].name='Changed in replacement batch';
    expect(standalone).toEqual(before);
  });
  it('retains pending mapping and Types across restore or rejected rebuild, blocking Add until explicit commit',()=>{
    const book=syntheticConverterBook(),review=request(book,'ingredients');
    const state={...newStandaloneConverterState(),...review,processedRaw:source,pendingMapping:[...review.parsed.mapping]};
    [state.pendingMapping[2],state.pendingMapping[3]]=[state.pendingMapping[3],state.pendingMapping[2]];
    const restored=JSON.parse(JSON.stringify(state));validateStandaloneState(restored);
    expect(()=>standaloneReview(restored)).toThrow('Rebuild the pending column mapping');
    expect(restored.types).toEqual(['Homemade','Packaged']);
    const before=clone(restored),invalid=[...restored.pendingMapping!];invalid[2]=invalid[3];
    expect(()=>remapStandaloneTable(restored,invalid)).toThrow('only once');
    expect(restored).toEqual(before);
    const rebuilt=remapStandaloneTable(restored,restored.pendingMapping!);
    expect(rebuilt.pendingMapping).toBeUndefined();
    expect(rebuilt.types).toEqual(['','']);
    expect(standaloneReview(rebuilt).rows[0]).toMatchObject({protein:'2',fat:'4'});
    expect(restored).toEqual(before);
    expect(()=>validateStandaloneState({...state,pendingMapping:['name']})).toThrow('pending standalone mapping');
    expect(()=>validateStandaloneState({...state,pendingMapping:state.pendingMapping.map(()=>'unknown')})).toThrow('pending standalone mapping');
  });
  it('creates exactly the reviewed dated Master rows on a clone without changing the tracked batch or Ingredients',()=>{
    const book=syntheticConverterBook(),before=clone(book),review=request(book),result=prepareStandaloneImport(book,review);
    expect(book).toEqual(before);expect(result.alreadyApplied).toBe(false);expect(result.receipt.entries).toHaveLength(2);
    expect(result.book.foodCapture).toEqual(before.foodCapture);
    expect(result.book.sheets[1]).toEqual(before.sheets[1]);
    const blocks=masterDayBlocks(result.book,result.book.sheets[0]),block=blocks.find(block=>block.date===45001)!;
    expect(block.rows).toHaveLength(3);expect(blocks.find(block=>block.date===45000)!.rows).toHaveLength(2);
    const target=result.book.tables.find(table=>table.id===review.target.table)!,food=target.columns.find(column=>column.id===review.target.fields.food)!;
    const engine=new Engine(result.book);
    expect(result.receipt.entries.map(entry=>scalar(engine.cell(review.target.sheet,entry.target.row,food.column)))).toEqual(['Soup (vegetables)','Rice, tofu']);
    expect(()=>validateStandaloneReceipt(result.receipt)).not.toThrow();
  });
  it('imports three new-day rows in receipt order with native complete macros and managed dates, retaining the source and tracked data',()=>{
    const book=syntheticConverterBook(),review=request(book,'master',source+'\nThird invented food,300,12,4,50,2,100,180,,'),before=clone(book),originalReview=clone(review);
    const result=prepareStandaloneImport(book,review),sheet=result.book.sheets[0],table=result.book.tables[0],engine=new Engine(result.book),entries=result.receipt.entries;
    const field=(name:keyof typeof review.target.fields)=>table.columns.find(column=>column.id===review.target.fields[name])!.column;
    expect(entries.map(entry=>entry.values.food)).toEqual(review.rows.map(row=>row.name));
    const block=masterDayBlocks(result.book,sheet,engine).find(block=>block.date===45001)!;
    expect(block.rows.slice(1)).toEqual(entries.map(entry=>entry.target.row));
    for(const [index,entry]of entries.entries()){
      expect(scalar(engine.cell(sheet.id,entry.target.row,table.columns[0].column))).toBe(45001);
      expect(nutrients.map(name=>scalar(engine.cell(sheet.id,entry.target.row,field(name))))).toEqual(nutrients.map(name=>Number(review.rows[index][name])));
      expect(scalar(engine.cell(sheet.id,entry.target.row,field('food')))).toBe(review.rows[index].name);
      expect(getCell(sheet,entry.target.row,field('food')).foodDraft).toBeUndefined();
    }
    expect(book).toEqual(before);expect(review).toEqual(originalReview);
    expect(result.book.foodCapture).toEqual(before.foodCapture);expect(result.book.sheets[1]).toEqual(before.sheets[1]);
    validateStandaloneReceipt(result.receipt);validateBook(result.book);
    const retry=prepareStandaloneImport(result.book,review,[result.receipt]);
    expect(retry.alreadyApplied).toBe(true);expect(retry.book).toEqual(result.book);expect(retry.receipt).toEqual(result.receipt);
  });
  it('uses the selected existing day without creating a second header, and works without any nutrition batch',()=>{
    const book=syntheticConverterBook();delete book.foodCapture;
    const review=request(book);review.date='2023-03-15';
    const result=prepareStandaloneImport(book,review),blocks=masterDayBlocks(result.book,result.book.sheets[0]);
    expect(blocks.filter(block=>block.isDay)).toHaveLength(1);expect(blocks[0].rows).toHaveLength(4);
    expect(result.book.foodCapture?.builder).toBeUndefined();
  });
  it('requires actual per-row Ingredient Type options and preserves the exact original name unless removal is chosen',()=>{
    const book=syntheticConverterBook(),review=request(book,'ingredients'),before=clone(book);
    expect(standaloneTypeChoices(book,review.target)).toEqual(['Packaged','Homemade']);
    const normal=prepareStandaloneImport(book,review);expect(normal.receipt.entries[0].values.food).toBe('Soup (vegetables)');
    review.removeDescription=true;
    const result=prepareStandaloneImport(book,review);expect(book).toEqual(before);
    expect(result.book.sheets[0]).toEqual(before.sheets[0]);
    expect(result.receipt.entries[0]).toMatchObject({type:'Homemade',values:{food:'Soup'},removedDescription:' (vegetables)'});
    expect(result.receipt.review.rows[0].name).toBe('Soup (vegetables)');
    const sheet=result.book.sheets[1],table=result.book.tables.find(table=>table.id===review.target.table)!,type=table.columns.find(column=>column.id===review.target.fields.type)!,engine=new Engine(result.book);
    expect(result.receipt.entries.map(entry=>scalar(engine.cell(sheet.id,entry.target.row,type.column)))).toEqual(['Homemade','Packaged']);
  });
  it.each(['header literal','assigned range'])('imports into an empty Ingredients table using its existing %s Type source and retains the dropdown on new rows',mode=>{
    const book=syntheticConverterBook(),table=book.tables[1],sheet=book.sheets[1];
    table.rows=[];book.foodCapture!.foods=[];delete book.foodCapture!.builder;
    for(const row of sheet.rows.slice(1))for(const column of table.columns)delete sheet.cells[row.id+':'+column.column];
    if(mode==='header literal')sheet.validations[0].rows=[table.header];
    else{
      setInput(book,sheet,sheet.rows[1].id,sheet.columns[11].id,"'Packaged");
      setInput(book,sheet,sheet.rows[2].id,sheet.columns[11].id,"'Homemade");
      delete sheet.validations[0].values;sheet.validations[0].source="'Synthetic Ingredients'!$L$2:$L$3";
    }
    const before=clone(book),review=request(book,'ingredients');
    expect(standaloneTypeChoices(book,review.target)).toEqual(['Packaged','Homemade']);
    const result=prepareStandaloneImport(book,review),resultSheet=result.book.sheets[1],type=table.columns.find(column=>column.id===review.target.fields.type)!,engine=new Engine(result.book);
    expect(book).toEqual(before);expect(result.book.tables[1].rows).toHaveLength(2);
    expect(standaloneTypeChoices(result.book,review.target)).toEqual(['Packaged','Homemade']);
    for(const [index,entry]of result.receipt.entries.entries()){
      expect(scalar(engine.cell(sheet.id,entry.target.row,type.column))).toBe(review.types[index]);
      expect(resultSheet.validations.some(validation=>validation.rows.includes(entry.target.row)&&validation.columns.includes(type.column))).toBe(true);
    }
  });
  it('does not borrow a distant unrelated Type validation for an empty table or invent values for an empty source',()=>{
    const book=syntheticConverterBook();book.tables[1].rows=[];book.foodCapture!.foods=[];delete book.foodCapture!.builder;
    const review=request(book,'ingredients');
    book.sheets[1].validations[0].rows=[book.sheets[1].rows[2].id];
    const unassigned=clone(book);
    expect(()=>prepareStandaloneImport(book,review)).toThrow('first available row directly below');
    expect(book).toEqual(unassigned);
    book.sheets[1].validations[0].rows=[book.sheets[1].rows[1].id];
    book.tables.push({id:'other-type-table',name:'Other Type',sheet:book.sheets[1].id,header:book.sheets[1].rows[1].id,rows:[],
      columns:[{id:'other-type-field',name:'Type',column:book.sheets[1].columns[10].id}]});
    const occupied=clone(book);
    expect(()=>prepareStandaloneImport(book,review)).toThrow('first available row directly below');expect(book).toEqual(occupied);
    book.tables.pop();
    book.sheets[1].validations[0].rows=[book.tables[1].header];book.sheets[1].validations[0].values=['',' '];
    const empty=clone(book);
    expect(()=>prepareStandaloneImport(book,review)).toThrow('no resolvable nonblank options');expect(book).toEqual(empty);
  });
  it('returns the saved operation receipt without duplicating rows, but rejects reuse with changed data',()=>{
    const book=syntheticConverterBook(),review=request(book),first=prepareStandaloneImport(book,review);
    const retry=prepareStandaloneImport(first.book,review,[first.receipt]);
    expect(retry.alreadyApplied).toBe(true);expect(retry.book).toEqual(first.book);expect(retry.receipt).toEqual(first.receipt);
    const edited=clone(review);edited.rows[0].calories='101';
    expect(()=>prepareStandaloneImport(first.book,edited,[first.receipt])).toThrow('already applied with different values');
    const tracked=clone(review);tracked.parsed.batch='captured-batch';
    expect(()=>prepareStandaloneImport(first.book,tracked,[first.receipt])).toThrow('Use Tracked nutrition response');
  });
  it('rejects saved receipt values that disagree with the actual reviewed nutrition or Ingredient Type',()=>{
    const book=syntheticConverterBook(),receipt=prepareStandaloneImport(book,request(book,'ingredients')).receipt;
    expect(()=>validateStandaloneReceipt(receipt)).not.toThrow();
    const nutrition=clone(receipt);nutrition.entries[0].values.protein='0';
    expect(()=>validateStandaloneReceipt(nutrition)).toThrow('do not match');
    const type=clone(receipt);type.entries[0].type='Packaged';
    expect(()=>validateStandaloneReceipt(type)).toThrow('do not match');
  });
  it.each(['2023-02-29','2023-03-32','2023-3-16','', 'not a date'])('rejects invalid Master calendar %j before writing any rows',date=>{
    const book=syntheticConverterBook(),before=clone(book),review=request(book);review.date=date;
    expect(()=>prepareStandaloneImport(book,review)).toThrow('valid calendar');expect(book).toEqual(before);
  });
  it('rejects all Batch/Item-bearing results, including an Item ID column deliberately unmapped as extra',()=>{
    const book=syntheticConverterBook();
    for(const mode of ['batch','row','unmapped','batch-alias','item-alias']){
      const review=request(book);
      if(mode==='batch')review.parsed.batch='captured-batch';
      else if(mode==='row')review.rows[0].id='I00001';
      else{review.parsed.headers.push(mode==='batch-alias'?'Batch_ID':mode==='item-alias'?'Item-ID':'Item ID');review.parsed.mapping.push('extra');review.parsed.rows.forEach(row=>row.push('I00001'));}
      expect(()=>prepareStandaloneImport(book,review)).toThrow('Use Tracked nutrition response');
    }
  });
  it.each(['','-1','1g','Infinity'])('rejects invalid nutrient %j even if other rows are valid',value=>{
    const book=syntheticConverterBook(),before=clone(book),review=request(book);review.rows[1].sodium=value;
    expect(()=>prepareStandaloneImport(book,review)).toThrow();expect(book).toEqual(before);
  });
  it('rejects removed or remapped destinations, missing quantity columns and unknown/removed Type choices without partial output',()=>{
    const book=syntheticConverterBook(),review=request(book,'ingredients'),before=clone(book);
    review.types[1]='Invented';expect(()=>prepareStandaloneImport(book,review)).toThrow('existing Type');
    review.types[1]='Packaged';book.sheets[1].validations=[];expect(()=>prepareStandaloneImport(book,review)).toThrow('Restore the Ingredients Type dropdown');
    const master=request(before);master.target.fields.food='removed';expect(()=>prepareStandaloneImport(before,master)).toThrow('mapping changed');
    const deleted=clone(before);deleted.tables=deleted.tables.filter(table=>table.id!==master.target.table);expect(()=>prepareStandaloneImport(deleted,master)).toThrow();
    const missing=clone(before);delete missing.sheets[0].mealLog!.fields.weight;missing.tables[0].columns.find(column=>column.name==='Amount (g)')!.name='Unmapped grams';
    const updated=request(missing);expect(()=>prepareStandaloneImport(missing,updated)).toThrow('weight field');
  });
  it('never promotes unknown or partially missing nutrition to zero, while storing an explicit zero as a real returned value',()=>{
    const book=syntheticConverterBook(),before=clone(book),review=request(book);
    review.rows[0].protein='';
    expect(()=>prepareStandaloneImport(book,review)).toThrow('blank is not zero');
    expect(book).toEqual(before);
    review.rows[0].protein='0';
    const result=prepareStandaloneImport(book,review),entry=result.receipt.entries[0],column=result.book.tables[0].columns.find(column=>column.id===review.target.fields.protein)!;
    expect(entry.values.protein).toBe('0');
    expect(scalar(new Engine(result.book).cell(review.target.sheet,entry.target.row,column.column))).toBe(0);
  });
  it('keeps unsupplied quantities blank instead of inheriting calculated zeroes or quantities from the destination template',()=>{
    const book=syntheticConverterBook(),review=request(book);review.date='2023-03-15';
    for(const field of ['weight','amount','unit'] as const){
      review.rows.forEach(row=>{row[field]='';});
      const column=book.tables[0].columns.find(column=>column.id===review.target.fields[field])!;column.formulaDefault='=0';
    }
    const result=prepareStandaloneImport(book,review),engine=new Engine(result.book);
    for(const entry of result.receipt.entries)for(const field of ['weight','amount','unit'] as const){
      const column=result.book.tables[0].columns.find(column=>column.id===review.target.fields[field])!,cell=result.book.sheets[0].cells[entry.target.row+':'+column.column];
      expect([null,'']).toContain(scalar(engine.cell(review.target.sheet,entry.target.row,column.column)));expect(cell.formula).toBeUndefined();
    }
  });
  it('writes formula-looking dish names and unit text as literal text, never executable formulas',()=>{
    const book=syntheticConverterBook(),review=request(book);review.rows[0].name='=1+1';review.rows[0].amount='2';review.rows[0].unit='=SUM(A1)';
    const result=prepareStandaloneImport(book,review),entry=result.receipt.entries[0],sheet=result.book.sheets[0],table=result.book.tables[0],engine=new Engine(result.book);
    for(const [field,expected]of [['food','=1+1'],['unit','=SUM(A1)']] as const){
      const column=table.columns.find(column=>column.id===review.target.fields[field])!;
      expect(scalar(engine.cell(sheet.id,entry.target.row,column.column))).toBe(expected);expect(sheet.cells[entry.target.row+':'+column.column].formula).toBeUndefined();
    }
  });
  it('persists nested standalone review without replacing tracked content; rejects corrupted nested states and receipts',()=>{
    const state=newConverterState('tracked-batch'),review=request(syntheticConverterBook());
    state.raw='Keep tracked paste';state.choices={I1:{overwrite:true}};
    state.standalone={...review,schema:1,status:'editing',processedRaw:review.raw};state.mode='untracked';
    const roundtrip=JSON.parse(JSON.stringify(state));validateConverterState(roundtrip);
    expect(roundtrip.raw).toBe('Keep tracked paste');expect(roundtrip.choices).toEqual(state.choices);
    expect(()=>validateStandaloneState({...state.standalone,types:[null]})).toThrow();
    expect(()=>validateConverterState({...roundtrip,standalone:{...roundtrip.standalone,target:{...review.target,fields:{food:42}}}})).toThrow();
    const book=syntheticConverterBook(),receipt=prepareStandaloneImport(book,request(book)).receipt;receipt.entries[0].target.row=receipt.entries[1].target.row;
    expect(()=>validateStandaloneReceipt(receipt)).toThrow();
  });
  it('retains the independent reviewed paste through a new tracked batch without sharing mutable state',()=>{
    const review=request(syntheticConverterBook()),standalone={...review,schema:1 as const,status:'editing' as const,processedRaw:review.raw};
    const next=newConverterState('new-tracked-batch',standalone);
    validateConverterState(next);
    expect(next.batch).toBe('new-tracked-batch');expect(next.raw).toBe('');
    expect(next.standalone).toEqual(standalone);
    next.standalone!.rows[0].name='Changed in the next batch';
    expect(standalone.rows[0].name).toBe('Soup (vegetables)');
  });
  it('validates durable Add receipts through workbook save/load validation and rejects duplicates or changed nutrition',()=>{
    const source=syntheticConverterBook(),result=prepareStandaloneImport(source,request(source));
    result.book.foodCapture!.nutritionImports=[result.receipt];
    const restored=JSON.parse(JSON.stringify(result.book)) as Workbook;
    expect(()=>validateBook(restored)).not.toThrow();
    expect(prepareStandaloneImport(restored,result.receipt.review,restored.foodCapture!.nutritionImports).alreadyApplied).toBe(true);
    const invalid=clone(restored);invalid.foodCapture!.nutritionImports![0].entries[0].values.calories='0';
    expect(()=>validateBook(invalid)).toThrow('do not match');
    restored.foodCapture!.nutritionImports!.push({...clone(result.receipt),id:'duplicate-operation'});
    expect(()=>validateBook(restored)).toThrow('Duplicate standalone Add receipt');
  });
});
