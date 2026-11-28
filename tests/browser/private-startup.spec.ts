import {expect,test,type Page,type TestInfo} from '@playwright/test';

test.skip(!process.env.FNT_PRIVATE_STARTUP_URL,'Requires a dedicated existing-data-only synthetic fixture server.');
const config={owner:'synthetic',repo:'private-open-data',branch:'main',path:'fnt-data.json'},sha='b'.repeat(40);
async function setup(page:Page,mode:'normal'|'missing'|'orphan'='normal'){
  const origin=new URL(process.env.FNT_PRIVATE_STARTUP_URL!).origin,unexpected:string[]=[],methods:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin||url.pathname.startsWith('/testing-workbook')){unexpected.push(url.origin+url.pathname);return route.abort();}
    if(url.pathname==='/__private-startup-fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Invented private-startup fixture</title>'});
    return route.continue();
  });
  await page.goto(origin+'/__private-startup-fixture');
  const fixture=await page.evaluate(async orphan=>{
    const {syntheticConverterBook}=await import(new URL('/tests/converter-polish-fixture.ts',location.href).href);
    const {encode64,Store,request}=await import(new URL('/src/storage.ts',location.href).href);
    const book=syntheticConverterBook(),original={id:'invented-original',name:'Invented original.xlsx',data:'AA=='};
    book.title='Invented private workbook <script>not executable</script>';
    book.references=[{id:'invented-original-reference',name:'Invented source',kind:'list',archivedRows:[],origin:{original:original.id}}];
    if(orphan){
      const store=await Store.open();store.close();
      const db=await request(indexedDB.open('fnt-workbook-v1',2));
      try{await request(db.transaction('state','readwrite').objectStore('state').put({invented:true},'comparison:protected-invented-review'));}
      finally{db.close();}
    }
    return{book,original,content:encode64(JSON.stringify({format:'fnt-sync-v1',book,operations:[],originals:[original],receipts:{}}))};
  },mode==='orphan');
  await page.route('https://api.github.com/**',route=>{
    const request=route.request(),url=new URL(request.url());methods.push(request.method());
    if(request.method()!=='GET')return route.fulfill({status:403,body:'Unexpected write'});
    if(url.pathname==='/repos/synthetic/private-open-data')return route.fulfill({contentType:'application/json',body:JSON.stringify({private:true,has_pages:false})});
    if(url.pathname==='/repos/synthetic/private-open-data/contents/fnt-data.json')return route.fulfill({status:mode==='missing'?404:200,contentType:'application/json',body:JSON.stringify({sha,content:fixture.content})});
    unexpected.push(url.pathname);return route.abort();
  });
  await page.goto(origin+'/');
  await expect(page.getByRole('heading',{name:'No saved workbook at this address',exact:true})).toBeVisible();
  expect(methods).toEqual([]);
  await page.getByRole('button',{name:'Open existing private workbook',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Open existing private workbook',exact:true});
  for(const [name,value]of Object.entries(config))if(name!=='path')await dialog.locator(`input[name="${name}"]`).fill(value);
  await expect(dialog.locator('input[name="path"]')).toHaveValue('fnt-data.json');
  await expect(dialog.locator('input[name="path"]')).toHaveJSProperty('readOnly',true);
  await dialog.getByLabel('Fine-grained token: Contents read, only this data repository',{exact:true}).fill('invented-read-only-token');
  return{dialog,fixture,methods,unexpected,errors};
}
async function inspect(page:Page){
  const dialog=page.getByRole('dialog',{name:'Open existing private workbook',exact:true});
  await dialog.getByRole('button',{name:'Read private workbook',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Open locally',exact:true})).toBeEnabled();
  await expect(dialog.locator('input[name="token"]')).toHaveValue('');
  return dialog;
}
async function current(page:Page){
  return page.evaluate(async()=>{
    const {Store}=await import(new URL('/src/storage.ts',location.href).href),store=await Store.open();
    try{
      const state=await store.load();
      return{state,originals:await store.originals(),base:state?.sync&&await store.syncBase(state.sync,state.remoteSha)};
    }finally{store.close();}
  });
}
test('empty startup opens only the separately confirmed private copy and stays paused after reload',async({page},info:TestInfo)=>{
  const {fixture,methods,unexpected,errors}=await setup(page),dialog=await inspect(page);
  expect((await current(page)).state).toBeUndefined();expect(methods).toEqual(['GET','GET']);
  await expect(dialog.locator('[data-private-preview]')).toContainText(fixture.book.title);
  await expect(dialog.locator('[data-private-preview]')).toContainText(sha);
  await expect(dialog.locator('[data-private-preview] script')).toHaveCount(0);
  await expect(dialog.getByText('Photo originals are not downloaded here',{exact:false})).toBeVisible();
  await page.screenshot({path:info.outputPath('private-source-preview.png')});
  await dialog.getByRole('button',{name:'Open locally',exact:true}).click();
  await expect(page.locator('td[data-r][data-c]').first()).toBeVisible();
  let saved=await current(page);
  expect(saved.state.book).toEqual(fixture.book);expect(saved.state.pending).toEqual([]);
  expect(saved.state.syncPaused).toBe(true);expect(saved.state.sync).toEqual(config);expect(saved.state.remoteSha).toBe(sha);
  expect(saved.base).toEqual(fixture.book);expect(saved.originals).toEqual([fixture.original]);
  await expect(page.locator('#save-state')).toContainText('private sync is not connected');
  await page.reload();await expect(page.locator('td[data-r][data-c]').first()).toBeVisible();
  saved=await current(page);expect(saved.state.pending).toEqual([]);expect(saved.state.syncPaused).toBe(true);expect(saved.base).toEqual(fixture.book);
  expect(methods).toEqual(['GET','GET']);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
test('cancel after private inspection leaves the empty origin untouched',async({page})=>{
  const {methods,unexpected,errors}=await setup(page),dialog=await inspect(page);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const saved=await current(page);expect(saved.state).toBeUndefined();expect(saved.originals).toEqual([]);
  await expect(page.getByRole('heading',{name:'No saved workbook at this address',exact:true})).toBeVisible();
  expect(methods).toEqual(['GET','GET']);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
test('a missing remote file reports failure without creating a local copy',async({page})=>{
  const {dialog,methods,unexpected,errors}=await setup(page,'missing');
  await dialog.getByRole('button',{name:'Read private workbook',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('No saved GitHub workbook');
  await expect(dialog.locator('input[name="token"]')).toHaveValue('');await expect(dialog.getByRole('button',{name:'Open locally',exact:true})).toBeDisabled();
  expect((await current(page)).state).toBeUndefined();expect(methods).toEqual(['GET','GET']);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
test('a concurrent local workbook is not replaced after inspection',async({page})=>{
  const {fixture,methods,unexpected,errors}=await setup(page),dialog=await inspect(page);
  const concurrent=await page.evaluate(async original=>{
    const {Store}=await import(new URL('/src/storage.ts',location.href).href),store=await Store.open();
    const book=structuredClone(original);book.id='concurrent-invented-workbook';book.title='Concurrent invented local workbook';delete book.references;
    try{await store.save(book,0,'Concurrent invented writer');return book;}finally{store.close();}
  },fixture.book);
  await dialog.getByRole('button',{name:'Open locally',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('already saved at this address');
  const saved=await current(page);expect(saved.state.book).toEqual(concurrent);expect(saved.originals).toEqual([]);
  expect(methods).toEqual(['GET','GET']);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
test('orphaned comparison recovery is preserved and blocks local initialization',async({page})=>{
  const {methods,unexpected,errors}=await setup(page,'orphan'),dialog=await inspect(page);
  await dialog.getByRole('button',{name:'Open locally',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Saved comparison recovery data already exists');
  expect((await current(page)).state).toBeUndefined();
  const preserved=await page.evaluate(async()=>{
    const {request}=await import(new URL('/src/storage.ts',location.href).href),db=await request(indexedDB.open('fnt-workbook-v1',2));
    try{return await request(db.transaction('state').objectStore('state').get('comparison:protected-invented-review'));}finally{db.close();}
  });
  expect(preserved).toEqual({invented:true});expect((await current(page)).originals).toEqual([]);
  expect(methods).toEqual(['GET','GET']);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
