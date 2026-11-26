import {expect,test,type Page} from '@playwright/test';
import {encode64} from '../../src/storage';
import {decompressArchive} from '../../src/archive';

async function saved(page:Page){
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return (await store.load())!;}finally{store.close();}
  });
}
async function fixture(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage') as typeof import('../../src/storage'),{blankSheet,setInput,uid}=await load('model') as typeof import('../../src/model'),{masterLogging}=await load('day-logging') as typeof import('../../src/day-logging'),store=await Store.open();
    try{
      const state=(await store.load())!,s=blankSheet('Quiet sync log',45,13);state.book.sheets.push(s);
      const table={id:uid(),name:'Master',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,42).map(row=>row.id),columns:['Date','Weight','isDay','Food','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Amount (g)','Amount','Unit'].map((name,i)=>({id:uid(),name,column:s.columns[i].id}))};
      state.book.tables.push(table);for(const field of table.columns)setInput(state.book,s,table.header,field.column,field.name);
      for(let i=1;i<=41;i++){const row=s.rows[i].id;setInput(state.book,s,row,table.columns[2].column,i===1?'TRUE':'FALSE');if(i>1){setInput(state.book,s,row,table.columns[3].column,"'Invented food "+i);setInput(state.book,s,row,table.columns[4].column,'100');}}
      setInput(state.book,s,s.rows[1].id,table.columns[0].column,'=DATE(2026,11,26)');setInput(state.book,s,s.rows[1].id,table.columns[1].column,'x');
      s.validations.push({id:uid(),rows:table.rows,columns:[table.columns[3].column],source:'=Ingredients[Ingredient]',sheet:s.id});s.dayLogging=masterLogging(state.book,s).config;
      let current=await store.save(state.book,state.version,'Invented quiet sync fixture');
      const config={owner:'example',repo:'private',branch:'main',path:'book.json'};
      current=await store.metadata(current.version,state=>({...state,sync:config,remoteSha:'original-sha',pending:[]}));
      await store.rememberSyncToken(config,'invented-token');
    }finally{store.close();}
  });
}
test('in-flight sync leaves fields, picker and scroll intact, preserving edits made after its captured revision',async({page})=>{
  let content='',sha='original-sha',release:(()=>void)|undefined,started=false,uploaded='',hold=false;
  await page.route('https://api.github.com/**',async route=>{
    if(route.request().method()==='PUT'){
      uploaded=route.request().postDataJSON().content;
      if(hold){started=true;await new Promise<void>(resolve=>release=resolve);}
      content=uploaded;sha=hold?'uploaded-sha':'baseline-sha';await route.fulfill({json:{content:{sha}}});return;
    }
    await route.fulfill({json:route.request().url().includes('/contents/')?{sha,content,encoding:'base64'}:{private:true,has_pages:false}});
  });
  await fixture(page);content=encode64(JSON.stringify({format:'fnt-sync-v1',book:(await saved(page)).book,operations:[]}));
  await page.reload();await expect(page.locator('#save-state')).toContainText('Synced');
  hold=true;
  await page.getByRole('button',{name:'Quiet sync log',exact:true}).click();await page.getByRole('button',{name:'Meal log',exact:true}).click();
  const panel=page.locator('.meal-log-panel'),card=panel.locator('[data-log-card]').last();
  await card.locator('.meal-log-macros summary').click();
  await card.getByRole('textbox',{name:'Calories',exact:true}).fill('101');
  await expect(page.locator('#save-state')).toContainText('Saved locally');
  const before=await saved(page);await page.locator('[data-action="save"]').click();await expect.poll(()=>started).toBe(true);
  await expect(card.getByRole('textbox',{name:'Calories',exact:true})).toBeEnabled();await card.getByRole('textbox',{name:'Calories',exact:true}).fill('202');
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();
  const search=page.locator('.cell-dropdown input[type=search]');await search.fill('Oa');
  const scroll=await panel.locator('.meal-log-scroll').evaluate(element=>element.scrollTop);
  release!();await expect.poll(async()=>(await saved(page)).remoteSha).toBe('uploaded-sha');
  await expect(search).toHaveValue('Oa');await expect(search).toBeFocused();
  expect(await panel.locator('.meal-log-scroll').evaluate(element=>element.scrollTop)).toBe(scroll);
  await expect(card.getByRole('textbox',{name:'Calories',exact:true})).toHaveValue('202');
  await expect.poll(async()=>(await saved(page)).pending.some(operation=>!before.pending.some(prior=>prior.id===operation.id))).toBe(true);
  const after=await saved(page);
  const envelope=JSON.parse(Buffer.from(uploaded,'base64').toString()),sent=decompressArchive(envelope.payload) as {book:typeof after.book;operations:{id:string}[]},uploadedBook=sent.book;
  expect(after.pending.some(operation=>sent.operations.some(prior=>prior.id===operation.id)&&operation.label!=='Visit table')).toBe(false);
  const sheet=uploadedBook.sheets.find(sheet=>sheet.name==='Quiet sync log')!,table=uploadedBook.tables.find(table=>table.sheet===sheet.id)!;
  expect(sheet.cells[`${table.rows.at(-1)}:${table.columns[4].column}`].value).toBe(101);
});
test('remote changes and unsubmitted choices never replace local data or upload on resume, Save or reload',async({page})=>{
  let content='',sha='original-sha',writes=0,guard=false;
  await page.route('https://api.github.com/**',async route=>{
    if(route.request().method()==='PUT'){
      if(guard){writes++;await route.abort();return;}
      content=route.request().postDataJSON().content;sha='baseline-sha';await route.fulfill({json:{content:{sha}}});return;
    }
    await route.fulfill({json:route.request().url().includes('/contents/')?{sha,content,encoding:'base64'}:{private:true,has_pages:false}});
  });
  await fixture(page);const local=(await saved(page)).book;
  content=encode64(JSON.stringify({format:'fnt-sync-v1',book:local,operations:[]}));
  await page.reload();await expect(page.locator('#save-state')).toContainText('Synced');
  guard=true;
  const remote=structuredClone(local);remote.title='Never adopted without submission';content=encode64(JSON.stringify({format:'fnt-sync-v1',book:remote,operations:[]}));sha='changed-remote';
  await page.locator('[data-action="save"]').click();
  await expect(page.locator('#save-state')).toHaveText('Sync conflict — saved locally');
  await expect(page.locator('.save-area #sync-review')).toHaveText('Compare');
  expect(await page.locator('#sync-review').evaluate(element=>getComputedStyle(element).fontSize)).toBe(await page.locator('[data-action="file"]').evaluate(element=>getComputedStyle(element).fontSize));
  expect((await saved(page)).book.title).toBe(local.title);expect((await saved(page)).syncReview).toBe(true);
  await page.locator('#error .error-message a').click();
  const comparison=page.frameLocator('iframe.comparison-frame');await comparison.locator('#keep-right button').click();
  await expect(comparison.locator('#right-source')).toHaveText('Preserved sync-conflict copy');
  await expect(comparison.locator('#right-source-commit')).toContainText('changed-remote');
  await expect(comparison.locator('#selection-progress')).toContainText(/1 of \d+ chosen/);
  await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.locator('[data-action="save"]').click();
  await page.reload();await expect(page.locator('#save-state')).toContainText('sync paused');
  expect((await saved(page)).book.title).toBe(local.title);expect(writes).toBe(0);
  sha='different-later-revision';content=encode64(JSON.stringify({format:'fnt-sync-v1',book:{...remote,title:'Not the conflicting revision'},operations:[]}));
  await page.locator('#save-state a').click();
  await expect(comparison.locator('#right-source')).toHaveText('Preserved sync-conflict copy');
  await expect(comparison.locator('#right-source-commit')).toContainText('changed-remote');
  expect(writes).toBe(0);
});
test('disconnecting during a remote read never attaches the old destination conflict to the new local state',async({page})=>{
  let content='',sha='original-sha',held=false,started=false,release:(()=>void)|undefined;
  await page.route('https://api.github.com/**',async route=>{
    if(route.request().method()==='PUT'){content=route.request().postDataJSON().content;sha='baseline-sha';await route.fulfill({json:{content:{sha}}});return;}
    if(!route.request().url().includes('/contents/')){await route.fulfill({json:{private:true,has_pages:false}});return;}
    if(held){started=true;await new Promise<void>(resolve=>release=resolve);}
    await route.fulfill({json:{sha:held?'old-destination-conflict':sha,content,encoding:'base64'}});
  });
  await fixture(page);const local=(await saved(page)).book;
  content=encode64(JSON.stringify({format:'fnt-sync-v1',book:local,operations:[]}));
  await page.reload();await expect(page.locator('#save-state')).toContainText('Synced');
  content=encode64(JSON.stringify({format:'fnt-sync-v1',book:{...local,title:'Old destination only'},operations:[]}));held=true;
  await page.locator('[data-action="save"]').click();await expect.poll(()=>started).toBe(true);
  await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();await expect(page.locator('#save-state')).toHaveText('Disconnected - local only');
  release!();await expect(page.locator('#error')).toContainText('previous sync response was not applied');
  const after=await saved(page);expect(after.sync).toBeUndefined();expect(after.syncReview).not.toBe(true);expect(after.book.title).toBe(local.title);
  await expect(page.locator('#sync-review')).toBeHidden();
});
test('public-sized sync compression runs off the UI thread with a bounded frame gap',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const result=await page.evaluate(async()=>{
    const module='/src/sync-processing.ts',{runSyncCodec}=await import(/* @vite-ignore */module) as typeof import('../../src/sync-processing');
    const value={format:'fnt-sync-v1',cells:Array.from({length:90000},(_,i)=>({id:i,value:`Invented sync performance cell ${i}`,formula:{kind:'ref',row:'row-'+i,column:'column-a'}}))};
    let previous=performance.now(),gap=0,frames=0,running=true;
    const frame=(now:number)=>{gap=Math.max(gap,now-previous);previous=now;frames++;if(running)requestAnimationFrame(frame);};
    await new Promise<void>(resolve=>requestAnimationFrame(()=>{previous=performance.now();requestAnimationFrame(frame);resolve();}));
    const started=performance.now(),packed=await runSyncCodec({kind:'pack',value});running=false;
    return{duration:performance.now()-started,gap,frames,bytes:typeof packed==='string'?packed.length:0};
  });
  test.info().annotations.push({type:'sync-performance',description:JSON.stringify(result)});
  console.info('Sync performance',test.info().project.name,result);
  expect(result.bytes).toBeGreaterThan(100000);expect(result.frames).toBeGreaterThan(2);expect(result.gap).toBeLessThan(250);
});
