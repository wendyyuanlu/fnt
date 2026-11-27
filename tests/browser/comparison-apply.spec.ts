import {expect,test,type Page} from '@playwright/test';
import {blankSheet,clone,createDemo,key} from '../../src/model';
import {encode64} from '../../src/storage';
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
test('submission handles removed rows and columns containing only formatting after restoring saved choices',async({page})=>{
  let requests=0;await page.route('https://api.github.com/**',async route=>{requests++;await route.abort();});
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const left=createDemo(),sheet=blankSheet('Synthetic formatted edges',4,4);left.sheets.push(sheet);
  const row=sheet.rows[1].id,column=sheet.columns[1].id;
  sheet.cells[key(row,sheet.columns[0].id)]={format:{bold:true}};
  sheet.cells[key(sheet.rows[0].id,column)]={format:{italic:true}};
  sheet.cells[key(row,column)]={};
  const right=clone(left),donor=right.sheets.at(-1)!;
  donor.rows=donor.rows.filter(item=>item.id!==row);donor.columns=donor.columns.filter(item=>item.id!==column);
  donor.cells={};
  const comparison=await open(page);
  for(const [side,book]of [['left',left],['right',right]] as const){
    await expect(comparison.locator(`#${side}-file`)).toBeEnabled();
    await comparison.locator(`#${side}-file`).setInputFiles({name:`synthetic-${side}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(book))});
    await expect(comparison.locator(`#${side}-source`)).toHaveText(`synthetic-${side}.json`);
  }
  await comparison.locator('.bulk-disclosure>summary').click();
  await comparison.locator('#choice-scope-trigger').click();
  await comparison.getByRole('option',{name:'Every difference in both copies',exact:true}).click();
  await comparison.locator('#bulk-buttons [data-pick="right"]').click();
  await expect(comparison.locator('#selection-progress')).toContainText('5 of 5 chosen');
  await page.reload();
  await expect(comparison.locator('#selection-progress')).toContainText('5 of 5 chosen');
  await comparison.locator('#submit-decision').click();
  await comparison.locator('#submit-back').click();
  await expect(comparison.locator('#selection-progress')).toContainText('5 of 5 chosen');
  await comparison.locator('#submit-decision').click();await comparison.locator('#apply-selection').click();
  await expect(page.locator('.comparison-view')).toHaveCount(0);
  expect((await saved(page)).book.sheets.find(item=>item.id===sheet.id)).toEqual(donor);
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  expect((await saved(page)).book.sheets.find(item=>item.id===sheet.id)).toEqual(donor);
  expect(requests).toBe(0);
});
test('upgrading comparison retains 603 existing choices when a previously hidden formatted cell becomes a new difference',async({page})=>{
  let legacy=true,legacyLoads=0;
  await page.route('**/prototypes/comparison/comparison-model.ts',async route=>{
    if(!legacy){await route.continue();return;}
    const response=await route.fetch({headers:{...route.request().headers(),'if-none-match':'','if-modified-since':''}}),body=await response.text();
    const fixed=/!present\d* \|\| (!equal\(meaningful\(ca\), meaningful\(cb\)\))/g;
    expect([...body.matchAll(fixed)]).toHaveLength(1);legacyLoads++;
    await route.fulfill({response,body:body.replace(fixed,'$1')});
  });
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const left=createDemo(),sheet=blankSheet('Synthetic upgrade choices',604,14);left.sheets.push(sheet);
  const removed=sheet.rows[1].id;
  for(const index of [8,10,12,13])sheet.cells[key(removed,sheet.columns[index].id)]=index===8?{}:{format:{bold:true}};
  for(const row of sheet.rows.slice(2))sheet.cells[key(row.id,sheet.columns[0].id)]={value:'Before'};
  const right=clone(left),donor=right.sheets.at(-1)!;
  donor.rows=donor.rows.filter(item=>item.id!==removed);
  for(const index of [8,10,12,13])delete donor.cells[key(removed,sheet.columns[index].id)];
  for(const row of donor.rows.slice(1))donor.cells[key(row.id,donor.columns[0].id)]={value:'After'};
  const comparison=await open(page);
  for(const [side,book]of [['left',left],['right',right]] as const){
    await expect(comparison.locator(`#${side}-file`)).toBeEnabled();
    await comparison.locator(`#${side}-file`).setInputFiles({name:`upgrade-${side}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(book))});
    await expect(comparison.locator(`#${side}-source`)).toHaveText(`upgrade-${side}.json`);
  }
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 603 chosen');
  await comparison.locator('.bulk-disclosure>summary').click();
  await comparison.locator('#choice-scope-trigger').click();
  await comparison.getByRole('option',{name:'Every difference in both copies',exact:true}).click();
  await comparison.locator('#bulk-buttons [data-pick="right"]').click();
  await expect(comparison.locator('#selection-progress')).toContainText('603 of 603 chosen');
  await expect.poll(()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;return (await store.comparisonReview(sessionStorage.getItem(`fnt-comparison:${state.book.id}`)!))?.view?.choices.length;}finally{store.close();}
  })).toBe(603);
  expect(legacyLoads).toBeGreaterThan(0);legacy=false;
  await page.reload();
  await expect(comparison.locator('#selection-progress')).toContainText('603 of 607 chosen');
  await expect(comparison.locator('#left-source')).toHaveText('upgrade-left.json');
  await expect(comparison.locator('#right-source')).toHaveText('upgrade-right.json');
  await expect(comparison.locator('#undo-choice')).toBeEnabled();
  await comparison.locator('#submit-decision').click();await comparison.locator('#apply-selection').click();
  await expect(page.locator('.comparison-view')).toHaveCount(0);
  expect((await saved(page)).book.sheets.find(item=>item.id===sheet.id)).toEqual(donor);
});
test('computer action restores local edits offline without replacing the right copy or saving workbook data',async({page,isMobile})=>{
  let requests=0;await page.route('https://api.github.com/**',async route=>{requests++;await route.abort();});
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.locator('td[data-r="1"][data-c="2"]').click();
  if(isMobile){await page.locator('#formula').fill('54321');await page.locator('#formula').press('Enter');}
  else{await page.keyboard.press('F2');await page.getByRole('textbox',{name:'Edit selected cell',exact:true}).fill('54321');await page.keyboard.press('Enter');}
  await expect(page.locator('#save-state')).toContainText('Saved');
  const before=await saved(page),left=clone(before.book),right=clone(before.book);
  left.title='Invented historical JSON';right.title='Invented right JSON';
  const comparison=await open(page),computer=comparison.getByRole('button',{name:"Use this device's local changes",exact:true});
  await expect(computer).toHaveCount(1);await expect(computer).toHaveClass('icon-button');
  const size=(await computer.boundingBox())!,attachment=(await comparison.locator('#left-file').locator('..').boundingBox())!;
  expect(size.width).toBe(attachment.width);expect(size.height).toBe(attachment.height);
  await expect(computer.locator('svg')).toHaveClass('toolbar-icon');await expect(computer.locator('svg')).toHaveCSS('width','14px');
  await expect(computer.locator('svg')).toHaveAttribute('viewBox','0 0 24 24');
  await comparison.locator('#left-file').setInputFiles({name:'invented-left.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(left))});
  await expect(comparison.locator('#left-source')).toHaveText('invented-left.json');
  await computer.click();await expect(comparison.locator('#left-source')).toHaveText('Current local workbook');
  await expect(comparison.locator('#totals')).toHaveText('Choose a right copy to begin.');
  await comparison.locator('#right-file').setInputFiles({name:'invented-right.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(right))});
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await comparison.locator('#left-file').setInputFiles({name:'invented-left.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(left))});
  await expect(comparison.locator('#left-source')).toHaveText('invented-left.json');
  await comparison.locator('#keep-left button').click();await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await computer.click();await expect(comparison.locator('#left-source')).toHaveText('Current local workbook');
  await expect(comparison.locator('#detail-left')).toContainText(before.book.title);
  await expect(comparison.locator('#right-source')).toHaveText('invented-right.json');
  await expect(comparison.locator('#detail-right')).toContainText(right.title);
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await expect(comparison.locator('#undo-choice')).toBeDisabled();
  await comparison.locator('#keep-right button').click();await computer.click();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  expect((await saved(page)).book).toEqual(before.book);expect((await saved(page)).pending).toEqual(before.pending);expect(requests).toBe(0);
  expect(await comparison.locator('.source-actions').evaluateAll(elements=>elements.some(element=>element.getBoundingClientRect().right>element.closest('.source')!.getBoundingClientRect().right))).toBe(false);
  await page.reload();
  await expect(comparison.locator('#left-source')).toHaveText('Current local workbook');
  await expect(comparison.locator('#right-source')).toHaveText('invented-right.json');
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  const afterReload=(await saved(page)).book;
  // Reload records a table visit, independently of comparison source selection.
  expect({...afterReload,tableActivity:before.book.tableActivity}).toEqual(before.book);expect(requests).toBe(0);
});

test('computer action refuses an unrelated right workbook without losing sources or decisions',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const before=await saved(page),left=createDemo(),right=clone(left);right.title='Invented unrelated donor';
  const comparison=await open(page);
  for(const [side,book]of [['left',left],['right',right]] as const)await comparison.locator(`#${side}-file`).setInputFiles({name:`unrelated-${side}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(book))});
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await comparison.locator('#keep-right button').click();await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await comparison.locator('#left-local').click();
  await expect(comparison.locator('#error')).toContainText('different workbook');
  await expect(comparison.locator('#left-source')).toHaveText('unrelated-left.json');await expect(comparison.locator('#right-source')).toHaveText('unrelated-right.json');
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await expect(comparison.locator('#left-local')).toBeEnabled();
  expect((await saved(page)).book).toEqual(before.book);
});

test('right computer action preserves the left copy and repeated selections preserve decisions',async({page})=>{
  let requests=0;await page.route('https://api.github.com/**',async route=>{requests++;await route.abort();});
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const before=await saved(page),left=clone(before.book),right=clone(before.book);
  left.title='Invented left history';right.title='Invented right history';
  const comparison=await open(page),computer=comparison.locator('#right-local');
  await computer.click();await expect(comparison.locator('#right-source')).toHaveText('Current local workbook');
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 0 chosen');
  for(const [side,book]of [['left',left],['right',right]] as const)await comparison.locator(`#${side}-file`).setInputFiles({name:`invented-${side}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(book))});
  await expect(comparison.locator('#right-source')).toHaveText('invented-right.json');
  await comparison.locator('#keep-left button').click();await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await computer.click();await expect(comparison.locator('#right-source')).toHaveText('Current local workbook');
  await expect(comparison.locator('#left-source')).toHaveText('invented-left.json');
  await expect(comparison.locator('#detail-right')).toContainText(before.book.title);
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await expect(comparison.locator('#undo-choice')).toBeDisabled();
  await comparison.locator('#keep-right button').click();await computer.click();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  expect((await saved(page)).book).toEqual(before.book);expect((await saved(page)).pending).toEqual(before.pending);expect(requests).toBe(0);
  await page.reload();
  await expect(comparison.locator('#right-source')).toHaveText('Current local workbook');
  await expect(comparison.locator('#left-source')).toHaveText('invented-left.json');
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
});

test('source icon sizes match attachments and chevrons disappear before source cards stack',async({page,isMobile})=>{
  test.skip(isMobile,'Desktop context exercises the responsive viewport boundaries.');
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const comparison=await open(page);
  for(const width of [1200,1100,721,720,650,390,320]){
    await page.setViewportSize({width,height:900});
    for(const side of ['left','right']){
      const computer=comparison.locator(`#${side}-local`),attachment=comparison.locator(`#${side}-file`).locator('..');
      const buttonSize=(await computer.boundingBox())!,fileSize=(await attachment.boundingBox())!;
      expect(buttonSize.width).toBe(fileSize.width);expect(buttonSize.height).toBe(fileSize.height);
      expect(buttonSize.width).toBeCloseTo(width<=720?30:27.2,1);
      for(const control of [computer,attachment]){
        await expect(control.locator('svg')).toHaveCSS('width','14px');await expect(control.locator('svg')).toHaveCSS('height','14px');
      }
      for(const id of ['commits','github']){
        const chevron=comparison.locator(`#${side}-${id}>svg`);
        if(width<=1150)await expect(chevron).toBeHidden();else await expect(chevron).toBeVisible();
      }
    }
    const cards=await comparison.locator('.source').evaluateAll(elements=>elements.map(element=>({top:element.getBoundingClientRect().top,left:element.getBoundingClientRect().left})));
    if(width>650)expect(cards[1].left).toBeGreaterThan(cards[0].left);else expect(cards[1].top).toBeGreaterThan(cards[0].top);
    expect(await comparison.locator('.source-actions').evaluateAll(elements=>elements.some(element=>[...element.children].some(child=>child.getBoundingClientRect().right>element.closest('.source')!.getBoundingClientRect().right)))).toBe(false);
  }
});

for(const localSide of ['left','right'] as const)test(`${localSide} computer action rebases a restored stale review only after discarding its old decisions`,async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const before=await saved(page),right=clone(before.book);right.title='Invented chosen donor';
  const comparison=await open(page);
  await comparison.locator('#right-file').setInputFiles({name:'invented-right.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(right))});
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await comparison.locator('#keep-right button').click();await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await expect.poll(()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;return (await store.comparisonReview(sessionStorage.getItem(`fnt-comparison:${state.book.id}`)!))?.view?.choices.length;}finally{store.close();}
  })).toBe(1);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;state.book.title='Invented newer local workbook';state.book.revision++;await store.save(state.book,state.version,'Invented newer local edit');}finally{store.close();}
  });
  await page.reload();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await comparison.locator('#submit-decision').click();await comparison.locator('#apply-selection').click();
  await expect(comparison.locator('#apply-error')).toContainText('changed since this comparison was saved');
  expect((await saved(page)).book.title).toBe('Invented newer local workbook');
  await comparison.locator('#submit-back').click();
  await comparison.locator(`#${localSide}-local`).click();
  await expect(comparison.locator(`#detail-${localSide}`)).toContainText('Invented newer local workbook');
  await expect(comparison.locator(`#${localSide==='left'?'right':'left'}-source`)).toHaveText(localSide==='left'?'invented-right.json':'Current local workbook');
  await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await expect(comparison.locator('#undo-choice')).toBeDisabled();
  await page.reload();await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
  await comparison.locator('#keep-right button').click();await comparison.locator('#submit-decision').click();await comparison.locator('#apply-selection').click();
  await expect(page.locator('.comparison-view')).toHaveCount(0);
  expect((await saved(page)).book.title).toBe(localSide==='left'?right.title:'Invented newer local workbook');
});
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

for(const stale of [false,true])test(stale?'explicit GitHub submission rejects a changed remote SHA':'explicit GitHub submission acknowledges equivalent selected data only after confirmation',async({page})=>{
  let remote='',sha='initial-sha',uploads=0;
  await page.route('https://api.github.com/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='PUT'){
      const body=request.postDataJSON() as {sha:string;content:string};
      expect(body.sha).toBe('donor-sha');uploads++;
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
    await expect(page.locator('.comparison-view')).toHaveCount(0);expect(uploads).toBe(0);
    const result=await saved(page);expect(result.book.title).toBe('Chosen remote title');expect(result.remoteSha).toBe('donor-sha');expect(result.syncPaused).toBe(false);
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
