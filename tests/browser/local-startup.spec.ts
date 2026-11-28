import {expect,test,type Page} from '@playwright/test';

const existingOnlyUrl=process.env.FNT_EXISTING_DATA_ONLY_URL;

test('normal local development opens the current review workbook instead of the original demo',async({page,request})=>{
  test.skip(!!existingOnlyUrl,'This server deliberately opens existing data only.');
  const url=process.env.FNT_LOCAL_URL??'http://127.0.0.1:5173/';
  const version=await request.get(url+'testing-workbook-version.json');
  expect(version.ok()).toBe(true);
  expect(await version.json()).toMatchObject({format:'fnt-published-version',version:1,id:expect.any(String)});
  await page.goto(url);
  await expect(page.locator('#save-state')).toContainText('Saved');
  for(const name of ['Ingredients','Meals','Meal TEST DATA','Daily log','Notebook TEST']){
    await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  }
  await expect(page.getByRole('button',{name:'Notebook',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>navigator.serviceWorker.controller===null)).toBe(true);
  const fullWorkbookRequests:string[]=[];
  page.on('request',request=>{if(request.url().endsWith('/testing-workbook.json'))fullWorkbookRequests.push(request.url());});
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  expect(fullWorkbookRequests).toEqual([]);
});

declare global{
  interface Window{localStartupProbe:{writes:string[];credentialReads:number}}
}
async function guardExistingStartup(page:Page){
  const unexpected:string[]=[],origin=new URL(existingOnlyUrl!).origin;
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/__existing-startup-fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Disposable startup fixture</title>'});
    if(url.origin!==origin||/^\/testing-workbook(?:-version)?\.json$/.test(url.pathname)){
      unexpected.push(url.origin+url.pathname);return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(()=>{
    window.localStartupProbe={writes:[],credentialReads:0};
    for(const action of ['put','add','delete','clear'] as const){
      const original=IDBObjectStore.prototype[action];
      Object.defineProperty(IDBObjectStore.prototype,action,{configurable:true,writable:true,value:function(this:IDBObjectStore,...args:unknown[]){
        window.localStartupProbe.writes.push(this.name+':'+action);
        return Reflect.apply(original,this,args);
      }});
    }
    const get=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){
      if(this.name==='state'&&key==='device:sync-credential')window.localStartupProbe.credentialReads++;
      return get.call(this,key);
    };
  });
  return unexpected;
}
test.describe('existing-data-only local startup',()=>{
  test.skip(!existingOnlyUrl,'Requires an isolated existing-data-only development server.');

  test('an empty origin refuses all starter and private-data substitution',async({page},testInfo)=>{
    const unexpected=await guardExistingStartup(page);
    await page.goto(existingOnlyUrl!);
    await expect(page.getByRole('heading',{name:'No saved workbook at this address'})).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('No demo, published workbook or private copy has been loaded');
    await expect(page.locator('td[data-r][data-c]')).toHaveCount(0);
    const saved=await page.evaluate(async()=>{
      const {Store}=await import(new URL('/src/storage.ts',location.href).href) as typeof import('../../src/storage');
      const store=await Store.open();try{return await store.load()}finally{store.close()}
    });
    expect(saved).toBeUndefined();
    expect(await page.evaluate(()=>window.localStartupProbe)).toEqual({writes:[],credentialReads:0});
    expect(unexpected).toEqual([]);
    await page.screenshot({path:testInfo.outputPath('existing-data-only-empty.png')});
  });

  for(const paused of [false,true])test(`preserves existing ${paused?'paused-review':'connected'} state without startup writes or automatic sync`,async({page})=>{
    const unexpected=await guardExistingStartup(page);
    await page.goto(new URL('/__existing-startup-fixture',existingOnlyUrl!).href);
    const before=await page.evaluate(async paused=>{
      const {Store}=await import(new URL('/src/storage.ts',location.href).href) as typeof import('../../src/storage');
      const {syntheticConverterBook}=await import(new URL('/tests/converter-polish-fixture.ts',location.href).href) as typeof import('../converter-polish-fixture');
      const store=await Store.open(),book=syntheticConverterBook();
      const saved=await store.save(book,0,'Preserved synthetic local edit');
      const state=await store.metadata(saved.version,state=>({...state,
        sync:{owner:'synthetic-owner',repo:'synthetic-data',branch:'main',path:'workbook.json'},
        remoteSha:'synthetic-remote',syncPaused:paused,syncReview:paused}));
      await store.checkpoint('Preserved synthetic recovery',book);
      await store.rememberSyncToken(state.sync,'synthetic-not-a-real-credential');
      store.close();
      sessionStorage.setItem(`fnt-comparison:${book.id}`,'1');
      return state;
    },paused);
    await page.goto(existingOnlyUrl!);
    await expect(page.locator('td[data-r][data-c]').first()).toBeVisible();
    await expect(page.locator('#save-state')).toContainText('Saved locally');
    await expect(page.locator('.comparison-view')).toHaveCount(0);
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'))});
    const after=await page.evaluate(async()=>{
      const {Store}=await import(new URL('/src/storage.ts',location.href).href) as typeof import('../../src/storage');
      const store=await Store.open();try{return{state:await store.load(),comparison:sessionStorage.getItem(`fnt-comparison:${(await store.load())!.book.id}`),probe:window.localStartupProbe}}finally{store.close()}
    });
    expect(after.state).toEqual(before);
    expect(after.comparison).toBe('1');
    expect(after.probe).toEqual({writes:[],credentialReads:0});
    expect(unexpected).toEqual([]);
    const cell=page.locator('td[data-r="2"][data-c="3"]');
    await cell.click();await page.locator('#formula').fill('Edited synthetic rice');await page.locator('#formula').press('Enter');
    await expect(page.locator('#save-state')).toContainText('Saved');
    await page.reload();await expect(cell).toHaveText('Edited synthetic rice');
    await expect(page.locator('.comparison-view')).toHaveCount(0);
    expect(await page.evaluate(()=>window.localStartupProbe)).toEqual({writes:[],credentialReads:0});
    expect(unexpected).toEqual([]);
  });
});
