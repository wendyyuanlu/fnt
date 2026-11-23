import {expect,test,type Page} from '@playwright/test';
import {createDemo,key} from '../../src/model';
import {loadPublishedTesting} from '../../src/published';
import type {Checkpoint,LocalState} from '../../src/storage';

const url='http://127.0.0.1:4173/';
async function state(page:Page):Promise<LocalState>{
  return page.evaluate(async()=>{
    const open=indexedDB.open('fnt-workbook-v1',1),db=await new Promise<IDBDatabase>((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
    try{const read=db.transaction('state').objectStore('state').get('current');return await new Promise<LocalState>((resolve,reject)=>{read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);});}finally{db.close();}
  });
}
async function seed(page:Page,edited:boolean){
  const book=createDemo();const notebook=book.sheets.find(s=>s.name==='Notebook')!;
  if(edited){book.title='Separate browser workbook';notebook.cells[key(notebook.rows[1].id,notebook.columns[1].id)]={value:'Keep my separate browser edits'};}
  const pending=[{id:'first',label:'Create starter workbook',time:''},{id:'migration',label:'Move dropdown records into DD storage',time:''},{id:'visit',label:'Visit table',time:''},...(edited?[{id:'edit',label:'Edit workbook',time:''}]:[])];
  const value:LocalState={book,version:100,pending,updated:''};
  await page.evaluate(async value=>{
    const open=indexedDB.open('fnt-workbook-v1',1),db=await new Promise<IDBDatabase>((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
    try{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,'current');await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
  },value);
  return book;
}
test('published site loads the complete testing grid, bypasses stale HTML and works offline',async({page,request,context})=>{
  const response=await request.get(url+'testing-workbook.json'),snapshot=await loadPublishedTesting(async()=>new Response(await response.text()));
  const legacy=await context.newPage();
  await legacy.route(url+'legacy.html',route=>route.fulfill({contentType:'text/html',body:'<p>Older app remains open</p>'}));await legacy.goto(url+'legacy.html');
  await legacy.evaluate(async()=>{
    const cache=await caches.open('fnt-shell-obsolete');
    for(const path of ['./','./index.html'])await cache.put(new URL(path,location.href),new Response('<p id="stale-shell">Obsolete cached website</p>',{headers:{'Content-Type':'text/html'}}));
  });
  await page.goto(url);await expect(page.locator('#save-state')).toContainText('Saved');
  for(const name of ['Meal TEST DATA','Daily log','Notebook TEST'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  expect(JSON.stringify((await state(page)).book.sheets)===JSON.stringify(snapshot.book.sheets)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    const name=(await caches.keys()).find(name=>name.startsWith('fnt-shell-'))!;
    await(await caches.open(name)).put(location.href,new Response('<p id="stale-shell">Old cached website</p>',{headers:{'Content-Type':'text/html'}}));
  });
  const workbookRequests:string[]=[];page.on('request',request=>{if(request.url().endsWith('/testing-workbook.json'))workbookRequests.push(request.url());});
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');await expect(page.locator('#stale-shell')).toHaveCount(0);
  expect(workbookRequests).toEqual([]);
  await context.setOffline(true);await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  expect(JSON.stringify((await state(page)).book.sheets)===JSON.stringify(snapshot.book.sheets)).toBe(true);
});
test('existing website edits are not overwritten; explicit testing restore preserves their recovery archive',async({page})=>{
  await page.goto(url);await expect(page.locator('#save-state')).toContainText('Saved');const own=await seed(page,true);
  await page.reload();await expect(page.locator('#title')).toHaveText(own.title);expect((await state(page)).book.id).toBe(own.id);
  await page.getByRole('button',{name:'Workbook and backups'}).click();await page.getByRole('button',{name:'Load published testing workbook',exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Published testing workbook saved');
  expect((await state(page)).book.id).not.toBe(own.id);
  const preserved=await page.evaluate(async id=>{
    const open=indexedDB.open('fnt-workbook-v1',1),db=await new Promise<IDBDatabase>((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
    try{const read=db.transaction('history').objectStore('history').getAll();return await new Promise<boolean>((resolve,reject)=>{read.onsuccess=()=>resolve(read.result.some((h:Checkpoint)=>h.book.id===id&&!!h.backup));read.onerror=()=>reject(read.error);});}finally{db.close();}
  },own.id);expect(preserved).toBe(true);
});
test('an untouched old starter upgrades to published data with a recovery checkpoint',async({page})=>{
  await page.goto(url);await expect(page.locator('#save-state')).toContainText('Saved');const own=await seed(page,false);
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');const current=await state(page);expect(current.book.id).not.toBe(own.id);expect(current.publishedSnapshot).toBeTruthy();
});
