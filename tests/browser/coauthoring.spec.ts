import {test,expect,type Page,type BrowserContext,type Route} from '@playwright/test';
import {blankSheet,clone,key,uid,type Workbook} from '../../src/model';
import {encode64,type LocalState} from '../../src/storage';
import {syncCodec} from '../../src/sync-codec';
import {masterLogging} from '../../src/day-logging';
import {addDraftFood} from '../../src/food-capture';

const config={owner:'example',repo:'private',branch:'main',path:'coauthoring.json'};
class ControlledGitHub{
  book:Workbook;sha='baseline';operations:string[]=[];receipts:Record<string,string>={};writes=0;
  holdRead=false;started=false;release?:()=>void;
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
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
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
