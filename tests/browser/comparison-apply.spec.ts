import {expect,test,type Page} from '@playwright/test';
import {clone,createDemo} from '../../src/model';
import {encode64} from '../../src/storage';
import {decompressArchive} from '../../src/archive';
import type {Workbook} from '../../src/model';

async function saved(page:Page){
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return (await store.load())!;}finally{store.close();}
  });
}
async function open(page:Page){
  await page.bringToFront();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
  const comparison=page.frameLocator('iframe.comparison-frame');
  await expect(comparison.locator('#left-source')).toHaveText('Current local workbook');
  await expect(comparison.locator('#left-file')).toBeEnabled();
  return comparison;
}
test('submission rejects newer edits in another tab without losing decisions',async({page,context,isMobile})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('#save-state')).toContainText('Saved');
  const other=await context.newPage();await other.goto('/',{waitUntil:'domcontentloaded'});await expect(other.locator('#save-state')).toContainText('Saved');
  const left=createDemo(),right=clone(left);right.title='Selected donor title';
  const comparison=await open(page);
  await comparison.locator('#left-file').setInputFiles({name:'invented-left.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(left))});
  await expect(comparison.locator('#left-source')).toHaveText('invented-left.json');
  await expect(comparison.locator('#right-file')).toBeEnabled();
  await comparison.locator('#right-file').setInputFiles({name:'invented.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(right))});
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await comparison.locator('#keep-right button').click();
  await comparison.locator('#submit-decision').click();
  await other.bringToFront();
  await other.locator('td[data-r="1"][data-c="2"]').click();
  if(isMobile){await other.locator('#formula').fill('77777');await other.locator('#formula').press('Enter');}
  else{await other.keyboard.press('F2');await other.getByRole('textbox',{name:'Edit selected cell',exact:true}).fill('77777');await other.keyboard.press('Enter');}
  await expect(other.locator('#save-state')).toContainText('Saved');
  await page.bringToFront();
  await comparison.locator('#apply-selection').click();
  await expect(comparison.locator('#apply-error')).toContainText(/changed|newer edits/);
  await other.reload();await expect(other.locator('#grid-scroll')).toContainText('77777');
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await expect(comparison.locator('#apply-selection')).toBeEnabled();
});

for(const stale of [false,true])test(stale?'explicit GitHub submission rejects a changed remote SHA':'explicit GitHub submission writes selected data only after confirmation',async({page})=>{
  let remote='',sha='initial-sha',uploads=0,uploaded='';
  await page.route('https://api.github.com/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='PUT'){
      const body=request.postDataJSON() as {sha:string;content:string};
      expect(body.sha).toBe('donor-sha');uploads++;uploaded=body.content;
      remote=body.content;sha='saved-sha';await route.fulfill({json:{content:{sha}}});return;
    }
    await route.fulfill({json:url.pathname.includes('/contents/')?{sha,content:remote,encoding:'base64'}:{private:true,has_pages:false}});
  });
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const before=await saved(page);
  remote=encode64(JSON.stringify({format:'fnt-sync-v1',book:before.book,operations:[]}));
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    const config={owner:'example',repo:'private',branch:'main',path:'book.json'};
    try{
      const state=(await store.load())!;await store.metadata(state.version,s=>({...s,sync:config,remoteSha:'initial-sha',pending:[]}));
      await store.rememberSyncToken(config,'invented-token');
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText(/Saved|Synced/);
  const right=clone((await saved(page)).book);right.title='Chosen remote title';
  remote=encode64(JSON.stringify({format:'fnt-sync-v1',book:right,operations:[]}));sha='donor-sha';
  const comparison=await open(page);
  await comparison.getByRole('combobox',{name:'Commits for right comparison',exact:true}).click();
  await comparison.getByRole('option',{name:'Latest saved workbook',exact:true}).click();
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await comparison.locator('#keep-right button').click();await comparison.locator('#submit-decision').click();
  await expect(comparison.locator('#apply-sync')).not.toBeChecked();
  expect(uploads).toBe(0);await comparison.locator('#apply-sync').check();
  if(stale)sha='changed-again';
  await comparison.locator('#apply-selection').click();
  if(stale){
    await expect(comparison.locator('#apply-error')).toContainText('GitHub changed');
    expect((await saved(page)).book.title).toBe(before.book.title);expect(uploads).toBe(0);
  }else{
    await expect(page.locator('.comparison-view')).toHaveCount(0);expect(uploads).toBe(1);
    const envelope=JSON.parse(Buffer.from(uploaded,'base64').toString('utf8'));
    expect((decompressArchive(envelope.payload) as {book:Workbook}).book.title).toBe('Chosen remote title');
    const result=await saved(page);expect(result.book.title).toBe('Chosen remote title');expect(result.remoteSha).toBe('saved-sha');expect(result.syncPaused).toBe(false);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(async()=>(await saved(page)).book.title).toBe(before.book.title);
  }
});

test('refresh restores comparison sources, choices, undo and display preferences only in that tab',async({page,context})=>{
  let requests=0;await page.route('https://api.github.com/**',async route=>{requests++;await route.abort();});
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const before=await saved(page),left=createDemo(),right=clone(left);right.title='Invented retained review';
  const comparison=await open(page);
  for(const [side,book]of [['left',left],['right',right]] as const)await comparison.locator(`#${side}-file`).setInputFiles({name:`invented-${side}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(book))});
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await comparison.locator('#keep-right button').click();await comparison.locator('#first-cell').uncheck();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await page.reload();
  await expect(page.locator('#app')).toHaveJSProperty('inert',true);
  await expect(comparison.locator('#left-source')).toHaveText('invented-left.json');
  await expect(comparison.locator('#right-source')).toHaveText('invented-right.json');
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await expect(comparison.locator('#first-cell')).not.toBeChecked();
  await comparison.locator('#undo-choice').click();await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  const other=await context.newPage();await other.goto('/');await expect(other.locator('#save-state')).toContainText('Saved');
  await expect(other.locator('.comparison-view')).toHaveCount(0);await other.close();
  expect((await saved(page)).book.title).toBe(before.book.title);expect(requests).toBe(0);
  await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  await expect(page.locator('.comparison-view')).toHaveCount(0);
});
