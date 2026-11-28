import {test,expect,type Page,type BrowserContext,type Route} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {parseArchive} from '../../src/archive';
import type {Backup} from '../../src/storage';
import {blankSheet,clone,key,uid,type Workbook} from '../../src/model';
import {encode64,type LocalState} from '../../src/storage';
import {syncCodec} from '../../src/sync-codec';
import {masterLogging} from '../../src/day-logging';
import {addDraftFood} from '../../src/food-capture';

const config={owner:'example',repo:'private',branch:'main',path:'coauthoring.json'};
class ControlledGitHub{
  book:Workbook;sha='baseline';operations:string[]=[];receipts:Record<string,string>={};writes=0;
  holdRead=false;started=false;release?:()=>void;
  snapshots=new Map<string,Workbook>();
  constructor(){
    const sheet=blankSheet('Coauthoring fixture',40,5);
    this.book={schema:1,id:uid(),title:'Synthetic coauthoring',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{},dropdownData:{sheets:[],tables:[]}};
    const table={id:uid(),name:'InventedValues',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1,8).map(row=>row.id),columns:sheet.columns.slice(0,3).map((column,i)=>({id:uid(),column:column.id,name:['Value','Other','Notes'][i]}))};
    this.book.tables=[table];
    for(const field of table.columns)sheet.cells[key(table.header,field.column)]={value:field.name};
    sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:1};
    sheet.cells[key(sheet.rows[1].id,sheet.columns[1].id)]={value:10};
  }
  edit(r:number,c:number,value:number){
    const sheet=this.book.sheets[0];sheet.cells[key(sheet.rows[r].id,sheet.columns[c].id)]={value};
    this.sha=`external-${++this.writes}`;
  }
  attach(context:BrowserContext){return context.route('https://api.github.com/**',route=>this.route(route));}
  private async route(route:Route){
    if(route.request().url().includes('/git/blobs/')){
      const sha=route.request().url().split('/git/blobs/')[1],book=this.snapshots.get(sha);
      await route.fulfill(book?{json:{sha,encoding:'base64',content:encode64(JSON.stringify({format:'fnt-sync-v1',book,operations:[]}))}}:{status:404,json:{message:'No synthetic ancestor'}});
      return;
    }
    if(!route.request().url().includes('/contents/')){await route.fulfill({json:{private:true,has_pages:false}});return;}
    if(route.request().method()==='PUT'){
      const request=route.request().postDataJSON() as {sha?:string;content:string};
      if(request.sha!==this.sha){await route.fulfill({status:409,json:{message:'CAS race'}});return;}
      const envelope=syncCodec({kind:'unpack',value:request.content}) as {book:Workbook;operations:string[];receipts:Record<string,string>};
      this.book=envelope.book;this.operations=envelope.operations;this.receipts=envelope.receipts;this.sha=`saved-${++this.writes}`;
      await route.fulfill({json:{content:{sha:this.sha}}});return;
    }
    const response={sha:this.sha,content:encode64(JSON.stringify({format:'fnt-sync-v1',book:this.book,operations:this.operations,receipts:this.receipts})),encoding:'base64'};
    if(this.holdRead){this.started=true;await new Promise<void>(resolve=>this.release=resolve);this.holdRead=false;}
    await route.fulfill({json:response});
  }
}
async function local(page:Page):Promise<LocalState>{
  return page.evaluate(async()=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!;}finally{store.close();}
  });
}

  function captureEndpoint(){
    const endpoint=new ControlledGitHub(),book=endpoint.book,log=blankSheet('Capture sync',5,13),source=blankSheet('Ingredients',3,5);
    book.sheets=[log,source];book.tables=[];
    const columns=['Ingredients','Serving (g)','Conversion Amount','Conversion Unit','Calories'].map((name,i)=>({id:`i${i}`,name,column:source.columns[i].id}));
    const ingredient={id:'ingredients',name:'Ingredients',sheet:source.id,header:source.rows[0].id,rows:[source.rows[1].id],columns};
    book.tables.push(ingredient);
    columns.forEach((column,i)=>{source.cells[key(ingredient.header,column.column)]={value:column.name};source.cells[key(ingredient.rows[0],column.column)]={value:['Sample',100,1,'each',200][i]};});
    const logColumns=['Date','Weight','isDay','Food','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Amount (g)','Amount','Unit'].map((name,i)=>({id:`m${i}`,name,column:log.columns[i].id}));
    const master={id:'master',name:'Master',sheet:log.id,header:log.rows[0].id,rows:log.rows.slice(1,3).map(row=>row.id),columns:logColumns};book.tables.push(master);
    for(const field of logColumns)log.cells[key(master.header,field.column)]={value:field.name};
    const input=(r:number,c:number,value:string|number|boolean)=>{log.cells[key(log.rows[r].id,log.columns[c].id)]={value};};
    input(1,0,45000);input(1,1,'x');input(1,2,true);input(2,2,false);input(2,4,99);input(2,10,50);
    log.cells[key(log.rows[2].id,log.columns[3].id)]={binding:{table:ingredient.id,row:ingredient.rows[0],column:columns[0].id}};
    log.dayLogging=masterLogging(book,log).config;
    log.mealLog={table:master.id,fields:{food:'m3',weight:'m10',calories:'m4'},ingredients:{table:ingredient.id,fields:{food:'i0',weight:'i1',amount:'i2',unit:'i3',calories:'i4'}}};
    const food=addDraftFood(book,45000);food.values={food:'Sample',weight:'25',calories:'91'};food.ingredient={table:ingredient.id,row:ingredient.rows[0]};
    const changeSource=()=>{endpoint.book.sheets.find(sheet=>sheet.id===source.id)!.cells[key(ingredient.rows[0],columns[4].column)]={value:400};endpoint.sha='changed-ingredient';};
    return{endpoint,changeSource,source,ingredient,columns,master,log,logColumns};
  }
  test('incoming Ingredient changes preserve actual Logged/Draft manual nutrition and consumption across reload',async({page})=>{
    const f=captureEndpoint();await f.endpoint.attach(page.context());await install(page,f.endpoint);
    f.changeSource();await sync(page);
    await expect.poll(async()=>(await local(page)).book.foodCapture?.nutritionConflicts?.length).toBe(2);
    const received=(await local(page)).book,log=received.sheets[0];
    expect(log.cells[key(f.master.rows[1],f.logColumns[4].column)].value).toBe(99);
    expect(log.cells[key(f.master.rows[1],f.logColumns[10].column)].value).toBe(50);
    expect(received.foodCapture!.foods[0].values).toMatchObject({weight:'25',calories:'91'});
    expect(received.foodCapture!.nutritionConflicts!.map(review=>({kind:review.kind??'draft',calories:review.calculated.calories}))).toEqual(expect.arrayContaining([{kind:'draft',calories:'100'},{kind:'logged',calories:'200'}]));
    await expect(page.locator('#sync-review')).toBeHidden();
    await page.reload();await expect.poll(async()=>(await local(page)).book.foodCapture?.nutritionConflicts?.length).toBe(2);
    expect((await local(page)).book.foodCapture!.foods[0].values.calories).toBe('91');
  });
  test('comparison-selected Ingredient changes retain manual nutrition reviews through reload and Undo/Redo',async({page})=>{
    const f=captureEndpoint();await f.endpoint.attach(page.context());await install(page,f.endpoint);
    await page.getByRole('button',{name:'Recovery',exact:true}).click();
    await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
    const comparison=page.frameLocator('iframe.comparison-frame');
    await expect(comparison.locator('#left-source')).toHaveText('Current local workbook');
    f.changeSource();
    await comparison.getByRole('combobox',{name:'Commits for right comparison',exact:true}).click();
    await comparison.getByRole('option',{name:'Latest saved workbook',exact:true}).click();
    await expect(comparison.locator('body')).toHaveAttribute('data-loading','false');
    await comparison.locator('.bulk-disclosure>summary').click();
    await comparison.locator('#choice-scope-trigger').click();
    await comparison.getByRole('option',{name:'Every difference in both copies',exact:true}).click();
    await comparison.locator('#bulk-buttons [data-pick="right"]').click();
    await comparison.locator('#submit-decision').click();await comparison.locator('#apply-selection').click();
    await expect(page.locator('.comparison-view')).toHaveCount(0);
    const changed=await local(page);
    expect(changed.book.sheets[1].cells[key(f.ingredient.rows[0],f.columns[4].column)].value).toBe(400);
    expect(changed.book.foodCapture?.nutritionConflicts).toHaveLength(2);
    expect(changed.book.foodCapture!.foods[0].values).toMatchObject({weight:'25',calories:'91'});
    expect(changed.book.sheets[0].cells[key(f.master.rows[1],f.logColumns[4].column)].value).toBe(99);
    expect(changed.syncPaused).toBe(true);
    await page.reload();await expect.poll(async()=>(await local(page)).book.foodCapture?.nutritionConflicts?.length).toBe(2);
    await page.keyboard.press('Control+z');
    await expect.poll(async()=>(await local(page)).book.sheets[1].cells[key(f.ingredient.rows[0],f.columns[4].column)].value).toBe(200);
    expect((await local(page)).book.foodCapture?.nutritionConflicts??[]).toEqual([]);
    await page.keyboard.press('Control+y');
    await expect.poll(async()=>(await local(page)).book.foodCapture?.nutritionConflicts?.length).toBe(2);
    expect((await local(page)).book.sheets[1].cells[key(f.ingredient.rows[0],f.columns[4].column)].value).toBe(400);
  });
  test('pending photo originals cannot be skipped by incoming adoption after a quota failure',async({page})=>{
    const f=captureEndpoint();await f.endpoint.attach(page.context());await install(page,f.endpoint);
    if(!await page.locator('.meal-log-panel').isVisible())await page.getByRole('button',{name:'Meal log',exact:true}).click();
    await page.getByRole('tab',{name:'Draft',exact:true}).click();
    const draft=page.getByRole('region',{name:'Draft foods'});
    await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toContainText('Synced');
    f.changeSource();f.endpoint.holdRead=true;await sync(page);await expect.poll(()=>f.endpoint.started).toBe(true);
    const image=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;return canvas.toDataURL('image/png').split(',')[1];}),'base64');
    await page.evaluate(()=>{
      const original=IDBObjectStore.prototype.put;
      document.addEventListener('restore-incoming-photo',()=>{IDBObjectStore.prototype.put=original;},{once:true});
      IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='state')throw new DOMException('Synthetic incoming photo quota failure','QuotaExceededError');return original.apply(this,args);};
    });
    const chooser=page.waitForEvent('filechooser');await draft.getByRole('button',{name:'Add photo',exact:true}).click();
    await page.getByRole('dialog',{name:'Take photo',exact:true}).getByRole('button',{name:'Take photo',exact:true}).click();
    await(await chooser).setFiles({name:'Synthetic incoming pending.png',mimeType:'image/png',buffer:image});
    await expect(page.locator('#save-state')).toContainText('NOT SAVED');
    await expect(draft.getByRole('button',{name:'Open photo Synthetic incoming pending.png',exact:true}).locator('img')).toBeVisible();
    f.endpoint.release!();await expect(page.locator('#error')).toContainText('Incoming sync could not save');
    const failed=(await local(page)).book;
    expect(failed.foodCapture!.photos).toHaveLength(0);
    expect(failed.sheets[1].cells[key(f.ingredient.rows[0],f.columns[4].column)].value).toBe(200);
    await page.evaluate(()=>document.dispatchEvent(new Event('restore-incoming-photo')));
    await page.getByRole('button',{name:/^Save(?: workbook)?$/,exact:true}).click();
    await expect.poll(async()=>(await local(page)).book.sheets[1].cells[key(f.ingredient.rows[0],f.columns[4].column)].value).toBe(400);
    const archive=await page.evaluate(async()=>{
      const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
      try{return await store.backup((await store.load())!);}finally{store.close();}
    });
    expect(archive.state.book.foodCapture!.photos).toHaveLength(1);expect(archive.photos).toHaveLength(1);expect(archive.missingPhotos).toEqual([]);
    expect(Buffer.from(archive.photos![0].data,'base64')).toEqual(image);
    await page.reload();await expect.poll(async()=>(await local(page)).book.foodCapture?.photos.length).toBe(1);
  });
async function install(page:Page,endpoint:ControlledGitHub){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved',{timeout:15000});
  await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toHaveText('Saved locally + recovery checkpoint');
  await page.evaluate(async({book,config,sha})=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const previous=(await store.load())!;book.catalogMigrations=previous.book.catalogMigrations;
      const saved=await store.save(book,previous.version,'Synthetic independent device');
      const connected=await store.metadata(saved.version,state=>({...state,sync:config,remoteSha:sha,pending:[]}));
      await store.syncMetadata(connected.version,{sha,confirmed:book});
      await store.rememberSyncToken(config,'invented-synthetic-token');
    }finally{store.close();}
  },{book:clone(endpoint.book),config,sha:endpoint.sha});
  endpoint.book.catalogMigrations=(await local(page)).book.catalogMigrations;
  await page.reload();await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
}
async function edit(page:Page,r:number,c:number,value:string,mobile:boolean){
  await page.bringToFront();await page.locator(`td[data-r="${r}"][data-c="${c}"]`).click();
  if(mobile){await page.locator('#formula').fill(value);await page.locator('#formula').press('Enter');}
  else{await page.keyboard.press('F2');const input=page.getByRole('textbox',{name:'Edit selected cell',exact:true});await input.fill(value);await input.press('Enter');}
  await expect(page.locator('#save-state')).toContainText('Saved locally');
}
const value=(state:LocalState,r=1,c=0)=>{const s=state.book.sheets[0];return s.cells[key(s.rows[r].id,s.columns[c].id)]?.value;};
const pending=(state:LocalState)=>state.pending.filter(operation=>operation.label!=='Visit table');
async function sync(page:Page){await page.bringToFront();await page.keyboard.press('Control+s');}
test.describe('paused review recheck',()=>{
  async function seed(page:Page,collision=false){
    const endpoint=new ControlledGitHub();await endpoint.attach(page.context());await install(page,endpoint);
    const base=clone(endpoint.book),sha='a'.repeat(40);
    endpoint.snapshots.set(sha,base);endpoint.edit(1,1,30);
    if(collision)endpoint.edit(1,0,3);
    const previous=await page.evaluate(async({base,config,sha,collision,remote,remoteSha})=>{
      const module='/src/storage.ts',{Store,mergeForSync}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
      const model='/src/model.ts',{clone,key,uid}=await import(/* @vite-ignore */model) as typeof import('../../src/model');
      try{
        const current=(await store.load())!,book=clone(base),sheet=book.sheets[0];
        sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:2};book.revision++;
        const id=uid(),review={left:{book:clone(book),kind:'Local',label:'Preserved old phone'},right:{book:clone(base),kind:'GitHub',label:'Preserved old GitHub'},baseRevision:book.revision,sync:{config,path:config.path,sha:'old-review'}};
        await store.saveComparisonReview(id,review,true);
        sheet.cells[key(sheet.rows[2].id,sheet.columns[2].id)]={value:44};book.revision++;
        const merged=collision?await mergeForSync(base,book,remote):undefined;
        const saved=await store.save(merged?.local??book,current.version,'Later phone edit');
        const connected=await store.metadata(saved.version,s=>({...s,sync:config,remoteSha:collision?remoteSha:sha,syncPaused:true,syncReview:true}));
        if(merged){
          await store.syncMetadata(connected.version,{sha:remoteSha,confirmed:remote});
          await store.checkpoint('Remote conflict - not applied',merged.remote,[],true,{config,sha:remoteSha,local:merged.local});
        }
        sessionStorage.setItem(`fnt-comparison:${book.id}`,id);
        return{id,review};
      }finally{store.close();}
    },{base,config,sha,collision,remote:clone(endpoint.book),remoteSha:endpoint.sha});
    await page.reload();
    const comparison=page.frameLocator('iframe.comparison-frame');
    await expect(comparison.locator('#left-source')).toHaveText('Preserved old phone');
    await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
    await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();await expect(page.locator('.comparison-view')).toHaveCount(0);
    return{endpoint,previous};
  }
  async function original(page:Page,id:string){
    return page.evaluate(async id=>{
      const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
      try{return await store.comparisonReview(id);}finally{store.close();}
    },id);
  }
  async function recheck(page:Page){
    await page.getByRole('button',{name:'Recovery',exact:true}).click();
    await page.getByRole('button',{name:'Recheck paused sync',exact:true}).click();
  }
  test('Blob and legacy recovery downloads retain original bytes and restore through the existing checkpoint UI',async({page})=>{
    const f=await seed(page),writesBefore=f.endpoint.writes;
    const expected=await page.evaluate(async()=>{
      const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{captureData}=await import(p+'food-capture.ts') as typeof import('../../src/food-capture');
      const {inspectPhoto}=await import(p+'food-photos.ts') as typeof import('../../src/food-photos'),{stringifyArchive}=await import(p+'archive.ts') as typeof import('../../src/archive');
      const store=await Store.open();
      try{
        const state=(await store.load())!,photo=await inspectPhoto('synthetic-checkpoint-photo',new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1])],{type:'image/png'}));
        captureData(state.book).photos.push({id:photo.id,name:'Invented.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
        const original={id:'synthetic-checkpoint-original',name:'Invented.xlsx',data:'AA=='};
        const saved=await store.save(state.book,state.version,'Attach synthetic checkpoint bytes',false,original,{photos:[photo]});
        const before=await store.backup(saved);
        await store.save(saved.book,saved.version,'Legacy recovery fixture',true,undefined,{recoveryArchive:stringifyArchive(before)});
        return{book:saved.book,photo:before.photos![0],original};
      }finally{store.close();}
    });
    await page.reload();
    await page.frameLocator('iframe.comparison-frame').getByRole('button',{name:'Back to workbook',exact:true}).click();
    await recheck(page);
    await page.getByRole('dialog',{name:'Compatible sync merge ready',exact:true}).getByRole('button',{name:'Not now',exact:true}).click();
    await page.getByRole('button',{name:'Recovery',exact:true}).click();
    await page.getByRole('button',{name:'Recovery checkpoints',exact:true}).click();
    const checkpoints=page.getByRole('dialog',{name:'Recovery checkpoints',exact:true});
    for(const label of ['Before paused sync recheck','Before Legacy recovery fixture']){
      const row=checkpoints.getByRole('button',{name:new RegExp(`^${label}`)}).locator('..');
      const pending=page.waitForEvent('download');await row.getByRole('button',{name:'Download full recovery archive',exact:true}).click();
      const download=await pending,archive=parseArchive(await readFile((await download.path())!,'utf8')) as Backup;
      expect({...archive.state.book,tableActivity:expected.book.tableActivity}).toEqual(expected.book);expect(archive.photos).toEqual([expected.photo]);expect(archive.originals).toEqual([expected.original]);
    }
    await checkpoints.getByRole('button',{name:/^Before paused sync recheck/}).click();
    await expect(page.locator('#save-state')).toContainText('Checkpoint restored locally - sync disconnected');
    await page.reload();expect({...((await local(page)).book),tableActivity:expected.book.tableActivity}).toEqual(expected.book);
    const retained=await page.evaluate(async()=>{
      const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),store=await Store.open();
      try{return await store.backup((await store.load())!);}finally{store.close();}
    });
    expect(retained.photos).toEqual([expected.photo]);expect(retained.originals).toEqual([expected.original]);expect(f.endpoint.writes).toBe(writesBefore);
  });
  async function gateInitialSave(page:Page,fail:boolean){
    await page.evaluate(async fail=>{
      const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage');
      const save=Store.prototype.save,changes=Store.prototype.saveChanges;
      let release!:()=>void;
      const wait=new Promise<void>(resolve=>{release=resolve;});
      const gate=async()=>{
        document.documentElement.dataset.recheckInitialSave='entered';
        if(fail)throw new DOMException('Synthetic initial recheck save failure','QuotaExceededError');
        await wait;
      };
      Store.prototype.save=async function(...args){await gate();return save.apply(this,args);};
      Store.prototype.saveChanges=async function(...args){await gate();return changes.apply(this,args);};
      document.addEventListener('release-recheck-initial-save',()=>{
        Store.prototype.save=save;Store.prototype.saveChanges=changes;release();
        delete document.documentElement.dataset.recheckInitialSave;
      },{once:true});
    },fail);
    await page.locator('td[data-r="2"][data-c="2"]').click();
    await page.locator('#formula').fill('45');await page.locator('#formula').press('Enter');
  }
  test('initial held flush locks the workbook before yielding and does not let a second save clear ownership',async({page})=>{
    const {endpoint,previous}=await seed(page),old=await original(page,previous.id),writes=endpoint.writes;
    await gateInitialSave(page,false);
    try{
      await recheck(page);
      await expect(page.locator('html')).toHaveAttribute('data-recheck-initial-save','entered');
      await expect(page.locator('#app')).toHaveJSProperty('inert',true);
      await page.keyboard.press('Control+s');
      await expect(page.locator('#error')).toContainText('Wait for the current save or sync');
      await expect(page.locator('#app')).toHaveJSProperty('inert',true);
      expect(endpoint.writes).toBe(writes);expect(await original(page,previous.id)).toEqual(old);
    }finally{await page.evaluate(()=>document.dispatchEvent(new Event('release-recheck-initial-save')));}
    const preview=page.getByRole('dialog',{name:'Compatible sync merge ready',exact:true});
    await expect(preview).toBeVisible();await preview.getByRole('button',{name:'Not now',exact:true}).click();
    await expect(page.locator('#app')).toHaveJSProperty('inert',false);
    expect(value(await local(page),2,2)).toBe(45);expect((await local(page)).syncReview).toBe(true);
    expect(endpoint.writes).toBe(writes);expect(await original(page,previous.id)).toEqual(old);
  });
  test('initial local save failure unlocks the workbook without claiming saved or applying the recheck',async({page})=>{
    const {endpoint,previous}=await seed(page),old=await original(page,previous.id),writes=endpoint.writes;
    await gateInitialSave(page,true);
    try{
      await recheck(page);
      await expect(page.locator('#save-state')).toContainText('Sync remains paused - recheck not applied');
      await expect(page.locator('#app')).toHaveJSProperty('inert',false);
      await expect(page.locator('#error')).toContainText('Save local edits and photo originals');
      await expect(page.getByRole('dialog',{name:'Compatible sync merge ready',exact:true})).toHaveCount(0);
      expect(value(await local(page),2,2)).toBe(44);expect((await local(page)).syncReview).toBe(true);
      expect(endpoint.writes).toBe(writes);expect(await original(page,previous.id)).toEqual(old);
    }finally{await page.evaluate(()=>document.dispatchEvent(new Event('release-recheck-initial-save')));}
    await page.keyboard.press('Control+s');await expect.poll(async()=>value(await local(page),2,2)).toBe(45);
  });
  test('compatible preview makes no upload, survives cancellation, preserves the old review and explicitly confirms through normal sync',async({page})=>{
    const {endpoint,previous}=await seed(page),writes=endpoint.writes,old=await original(page,previous.id);
    await sync(page);expect(endpoint.writes).toBe(writes);expect((await local(page)).syncReview).toBe(true);
    await recheck(page);
    const preview=page.getByRole('dialog',{name:'Compatible sync merge ready',exact:true});
    await expect(preview).toBeVisible();expect(endpoint.writes).toBe(writes);
    expect(value(await local(page),1,1)).toBe(10);expect(value(await local(page),2,2)).toBe(44);
    await preview.getByRole('button',{name:'Not now',exact:true}).click();
    expect((await local(page)).syncReview).toBe(true);expect(await original(page,previous.id)).toEqual(old);
    await recheck(page);await expect(preview).toBeVisible();
    await preview.getByRole('button',{name:'Confirm merged workbook and sync',exact:true}).click();
    await expect(preview).toHaveCount(0);await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
    const result=await local(page);
    expect(value(result)).toBe(2);expect(value(result,1,1)).toBe(30);expect(value(result,2,2)).toBe(44);
    expect(result.syncReview).toBe(false);expect(endpoint.writes).toBe(writes+1);
    expect(await original(page,previous.id)).toEqual(old);
    await page.reload();await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
    expect(await original(page,previous.id)).toEqual(old);
    await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.getByRole('button',{name:'Preserved paused reviews',exact:true}).click();
    const archived=page.getByRole('dialog',{name:'Preserved paused reviews',exact:true});await archived.locator('[data-preserved-review="0"]').click();
    const comparison=page.frameLocator('iframe.comparison-frame');await expect(comparison.locator('#left-source')).toHaveText('Preserved old phone');
    await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();expect((await local(page)).syncReview).toBe(false);
    await page.context().setOffline(true);
    await page.keyboard.press('Control+z');await expect.poll(async()=>value(await local(page),1,1)).toBe(10);
    expect(value(await local(page))).toBe(2);expect(value(await local(page),2,2)).toBe(44);
    await page.keyboard.press('Control+y');await expect.poll(async()=>value(await local(page),1,1)).toBe(30);
    expect(await original(page,previous.id)).toEqual(old);await page.context().setOffline(false);
  });
  test('changed GitHub revision rejects confirmation without replacing the workbook or the preserved review',async({page})=>{
    const {endpoint,previous}=await seed(page),old=await original(page,previous.id);
    await recheck(page);const preview=page.getByRole('dialog',{name:'Compatible sync merge ready',exact:true});await expect(preview).toBeVisible();
    endpoint.edit(1,0,3);const writes=endpoint.writes;
    await preview.getByRole('button',{name:'Confirm merged workbook and sync',exact:true}).click();
    await expect(preview.locator('[data-recheck-progress]')).toContainText('GitHub changed');
    expect(endpoint.writes).toBe(writes);expect(value(await local(page))).toBe(2);expect(value(await local(page),1,1)).toBe(10);
    expect((await local(page)).syncReview).toBe(true);expect(await original(page,previous.id)).toEqual(old);
    await preview.getByRole('button',{name:'Not now',exact:true}).click();
  });
  test('failed apply recovery cannot upload or replace the workbook and keeps the original review available',async({page})=>{
    const {endpoint,previous}=await seed(page),old=await original(page,previous.id),writes=endpoint.writes;
    await recheck(page);const preview=page.getByRole('dialog',{name:'Compatible sync merge ready',exact:true});await expect(preview).toBeVisible();
    await page.evaluate(()=>{
      const original=IDBObjectStore.prototype.put;
      document.addEventListener('restore-recheck-recovery',()=>{IDBObjectStore.prototype.put=original;},{once:true});
      IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='history')throw new DOMException('Synthetic apply-recovery quota failure','QuotaExceededError');return original.apply(this,args);};
    });
    try{
      await preview.getByRole('button',{name:'Confirm merged workbook and sync',exact:true}).click();
      await expect(preview.locator('[data-recheck-progress]')).toContainText('Synthetic apply-recovery quota failure');
      expect(endpoint.writes).toBe(writes);expect(value(await local(page),1,1)).toBe(10);expect(value(await local(page),2,2)).toBe(44);
      expect((await local(page)).syncReview).toBe(true);expect(await original(page,previous.id)).toEqual(old);
    }finally{await page.evaluate(()=>document.dispatchEvent(new Event('restore-recheck-recovery')));}
    await preview.getByRole('button',{name:'Not now',exact:true}).click();
  });
  test('a genuine collision opens a new focused review, retains later edits, and preserves both the old review and new decisions across reload',async({page})=>{
    const {endpoint,previous}=await seed(page,true),old=await original(page,previous.id),writes=endpoint.writes;
    await recheck(page);
    const comparison=page.frameLocator('iframe.comparison-frame');
    await expect(comparison.locator('#left-source')).toHaveText('Rechecked local choice with compatible changes');
    await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');expect(endpoint.writes).toBe(writes);
    await comparison.locator('#keep-right button').click();
    await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
    await page.reload();await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
    expect(await original(page,previous.id)).toEqual(old);
    await comparison.locator('#submit-decision').click();await comparison.locator('#apply-sync').check();await comparison.locator('#apply-selection').click();
    await expect(page.locator('.comparison-view')).toHaveCount(0);await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
    const result=await local(page);expect(value(result)).toBe(3);expect(value(result,1,1)).toBe(30);expect(value(result,2,2)).toBe(44);
    expect(await original(page,previous.id)).toEqual(old);expect(endpoint.writes).toBe(writes+1);
  });
});
test.describe('independent device coauthoring',()=>{
  let endpoint:ControlledGitHub,other:BrowserContext,computer:Page;
  test.beforeEach(async({page,browser})=>{
    endpoint=new ControlledGitHub();other=await browser.newContext({viewport:{width:1365,height:900},isMobile:false,hasTouch:false});
    computer=await other.newPage();await endpoint.attach(page.context());await endpoint.attach(other);
    await install(page,endpoint);await install(computer,endpoint);
  });
  test.afterEach(async({page})=>{endpoint.release?.();await page.context().setOffline(false);await other.close();});
  test('offline disjoint edits converge without comparison, survive reload and retain remote values through local Undo/Redo',async({page,isMobile})=>{
    await page.context().setOffline(true);await other.setOffline(true);
    await edit(page,1,0,'2',isMobile);await edit(computer,1,1,'30',false);
    await page.context().setOffline(false);await sync(page);
    await expect.poll(async()=>pending(await local(page)).length).toBe(0);
    await other.setOffline(false);await sync(computer);
    await expect.poll(async()=>pending(await local(computer)).length).toBe(0);
    await sync(page);await expect.poll(async()=>value(await local(page),1,1)).toBe(30);
    expect(value(await local(page))).toBe(2);await expect(page.locator('#sync-review')).toBeHidden();
    await page.context().setOffline(true);
    await page.keyboard.press('Control+z');await expect.poll(async()=>value(await local(page))).toBe(1);
    expect(value(await local(page),1,1)).toBe(30);
    await page.keyboard.press('Control+y');await expect.poll(async()=>value(await local(page))).toBe(2);
    await page.context().setOffline(false);await sync(page);
    await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
    await page.reload();await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
    expect(value(await local(page))).toBe(2);expect(value(await local(page),1,1)).toBe(30);
  });
  test('incoming updates wait for an open grid editor and merge the edit completed during the transfer',async({page,isMobile})=>{
    endpoint.edit(1,1,80);endpoint.holdRead=true;
    await sync(page);await expect.poll(()=>endpoint.started).toBe(true);
    await page.locator('td[data-r="1"][data-c="0"]').click();
    if(!isMobile)await page.keyboard.press('F2');
    const input=isMobile?page.locator('#formula'):page.getByRole('textbox',{name:'Edit selected cell',exact:true});await input.fill('42');
    endpoint.release!();await expect(page.locator('#save-state')).toContainText('finish the current edit');
    await expect(input).toHaveValue('42');await expect(input).toBeFocused();expect(value(await local(page),1,1)).toBe(10);
    await input.press('Enter');
    await expect.poll(async()=>value(await local(page),1,1)).toBe(80);
    expect(value(await local(page))).toBe(42);await expect(page.locator('#sync-review')).toBeHidden();
  });
  test('failed local persistence prevents incoming adoption and a later save safely retries',async({page,isMobile})=>{
    endpoint.edit(1,1,80);endpoint.holdRead=true;
    await sync(page);await expect.poll(()=>endpoint.started).toBe(true);
    await page.evaluate(()=>{
      const original=IDBObjectStore.prototype.put;
      (window as typeof window&{restoreSyncQuota?:()=>void}).restoreSyncQuota=()=>{IDBObjectStore.prototype.put=original;};
      IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='state')throw new DOMException('Synthetic incoming quota failure','QuotaExceededError');return original.apply(this,args);};
    });
    await page.locator('td[data-r="1"][data-c="0"]').click();
    if(isMobile){await page.locator('#formula').fill('42');await page.locator('#formula').press('Enter');}
    else{await page.keyboard.press('F2');const input=page.getByRole('textbox',{name:'Edit selected cell',exact:true});await input.fill('42');await input.press('Enter');}
    await expect(page.locator('#save-state')).toContainText('NOT SAVED');
    endpoint.release!();await expect(page.locator('#error')).toContainText('Incoming sync could not save');
    expect(value(await local(page))).toBe(1);expect(value(await local(page),1,1)).toBe(10);
    await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('42');
    await page.evaluate(()=>(window as typeof window&{restoreSyncQuota?:()=>void}).restoreSyncQuota!());
    await sync(page);await expect.poll(async()=>value(await local(page),1,1)).toBe(80);
    expect(value(await local(page))).toBe(42);
  });
});
