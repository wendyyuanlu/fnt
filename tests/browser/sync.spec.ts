import { expect,test } from '@playwright/test';

test('Recovery suggests the renamed legacy sync path without changing the saved destination or custom paths',async({page})=>{
  const requests:string[]=[];
  await page.route('https://api.github.com/**',async route=>{requests.push(route.request().method());await route.abort();});
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const savedPath=async(path?:string)=>page.evaluate(async value=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{
      let state=(await store.load())!;
      if(value)state=await store.metadata(state.version,s=>({...s,sync:{owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:value}}));
      return state.sync?.path;
    }finally{store.close();}
  },path);
  for(const path of ['workbook.json','personal-workbook.json']){
    await savedPath(path);await page.reload();
    await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.locator('#sync').click();
    await expect(page.locator('#sync-path')).toHaveValue('fnt-data.json');
    await expect(page.locator('#sync-path-note')).toContainText(`Saved destination: ${path}`);
    expect(await savedPath()).toBe(path);
  }
  await savedPath('private/custom.json');await page.reload();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.locator('#sync').click();
  await expect(page.locator('#sync-path')).toHaveValue('private/custom.json');
  await expect(page.locator('#sync-path-note')).toHaveCount(0);
  expect(await savedPath()).toBe('private/custom.json');
  expect(requests).toEqual([]);
});

test('comparison reads the renamed default after an old saved path is removed, retaining the saved connection and edits',async({page})=>{
  let remote='',writes=0;
  const reads:string[]=[];
  await page.route('https://api.github.com/**',async route=>{
    const request=route.request(),path=decodeURIComponent(new URL(request.url()).pathname.split('/contents/')[1]??'');
    if(request.method()==='PUT'){writes++;await route.abort();return;}
    if(!path){await route.fulfill({json:{private:true,has_pages:false}});return;}
    reads.push(path);
    if(path==='fnt-data.json')await route.fulfill({json:{sha:'renamed-file',content:remote,encoding:'base64'}});
    else await route.fulfill({status:404,json:{message:'Not found'}});
  });
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  remote=await page.evaluate(async()=>{
    const module='/src/storage.ts',{Store,encode64}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{
      let state=(await store.load())!;
      const sync={owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:'personal-workbook.json'},book=structuredClone(state.book),sheet=book.sheets[0];
      sheet.cells[`${sheet.rows[1].id}:${sheet.columns[2].id}`]={value:777};
      state=await store.metadata(state.version,s=>({...s,sync,remoteSha:'old-file',pending:[...s.pending,{id:'retained-local-edit',label:'Edit',time:'2026-01-01T00:00:00Z'}]}));
      await store.rememberSyncToken(sync,'invented-remembered-token');
      return encode64(JSON.stringify({format:'fnt-sync-v1',book,operations:[]}));
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText('Sync failed');
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
  const comparison=page.frameLocator('iframe.comparison-frame');
  await expect(comparison.locator('#right-source')).toHaveText('fnt-data.json');
  await expect(comparison.locator('#right-grid')).toContainText('777');
  await expect(comparison.locator('#error')).toBeHidden();
  await expect(comparison.locator('#right-source-freshness')).toContainText('Saved sync destination remains personal-workbook.json');
  const retained=await page.evaluate(async()=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;return{path:state.sync?.path,sha:state.remoteSha,localEdit:state.pending.some(p=>p.id==='retained-local-edit')};}finally{store.close();}
  });
  expect(retained).toEqual({path:'personal-workbook.json',sha:'old-file',localEdit:true});
  expect(reads).toContain('personal-workbook.json');expect(reads).toContain('fnt-data.json');expect(writes).toBe(0);
});

test('independent browsers batch uploads, require deliberate remote adoption, and retain failed/offline edits',async({page,browser,isMobile})=>{
  let content:string|undefined,sha='revision-0',revision=0,failure=false;
  const other=await browser.newContext({viewport:page.viewportSize()!,isMobile,hasTouch:isMobile}),second=await other.newPage();
  const route=async(context:typeof other)=>context.route('https://api.github.com/**',async route=>{
    if(failure){await route.fulfill({status:503,json:{message:'Controlled failure'}});return;}
    if(route.request().method()==='PUT'){
      const body=route.request().postDataJSON() as {sha?:string;content:string};
      if(content&&body.sha!==sha){await route.fulfill({status:409,json:{message:'Concurrent change'}});return;}
      content=body.content;sha='revision-'+ ++revision;await route.fulfill({json:{content:{sha}}});return;
    }
    await route.fulfill(route.request().url().includes('/contents/')?
      content?{json:{sha,content,encoding:'base64'}}:{status:404,json:{message:'Not found'}}:
      {json:route.request().url().includes('/git/trees/')?{tree:[],truncated:false}:{private:true,has_pages:false}});
  });
  const connect=async(target:typeof page,remember=false)=>{
    await target.bringToFront();
    await target.getByRole('button',{name:'Recovery',exact:true}).click();
    await expect(target.getByRole('dialog',{name:'Recovery',exact:true}).locator('.menu > :first-child')).toHaveText('Private GitHub sync');
    await target.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
    for(const [name,value]of [['owner','example'],['repo','private-test'],['branch','main'],['path','synthetic.json'],['token','synthetic-test-token']])await target.locator(`#sync-${name}`).fill(value);
    if(remember)await target.locator('#sync-remember').check();
    await target.getByRole('button',{name:'Connect & sync now',exact:true}).click();
  };
  const edit=async(target:typeof page,value:string)=>{
    await target.bringToFront();await target.locator('td[data-r="1"][data-c="2"]').click();
    if(isMobile){await target.locator('#formula').fill(value);await target.locator('#formula').press('Enter');}
    else{await target.keyboard.press('F2');await target.getByRole('textbox',{name:'Edit selected cell',exact:true}).fill(value);await target.keyboard.press('Enter');}
  };
  const local=async(target:typeof page)=>target.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets[0];
      return{pending:state.pending.filter((operation:{label:string})=>operation.label!=='Visit table').length,value:sheet.cells[`${sheet.rows[1].id}:${sheet.columns[2].id}`].value};
    }finally{store.close();}
  });
  const adopt=async(target:typeof page)=>{
    await target.bringToFront();await target.locator('#sync-review').click();
    const comparison=target.frameLocator('iframe.comparison-frame');
    await comparison.getByRole('button',{name:'Compare with remote version (GitHub)',exact:true}).click();
    await expect(comparison.locator('body')).toHaveAttribute('data-loading','false');
    await comparison.locator('.bulk-disclosure>summary').click();
    await comparison.locator('#choice-scope-trigger').click();await comparison.getByRole('option',{name:'Every difference in both copies',exact:true}).click();
    await comparison.locator('#bulk-buttons [data-pick="right"]').click();
    await comparison.locator('#submit-decision').click();await comparison.locator('#apply-sync').check();
    await comparison.locator('#apply-selection').click();await expect(target.locator('.comparison-view')).toHaveCount(0);
    await expect(target.locator('#save-state')).toContainText('Synced');
  };
  try{
    await route(page.context());await route(other);
    await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');await connect(page);
    await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
    const baseline=await page.evaluate(async()=>{
      const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
      try{return (await store.load())!;}finally{store.close();}
    });
    await second.goto(page.url());await expect(second.locator('#save-state')).toContainText('Saved');
    await second.evaluate(async baseline=>{
      const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
      try{const previous=(await store.load())!,saved=await store.save(baseline.book,previous.version,'Invented second-device baseline');await store.metadata(saved.version,state=>({...state,sync:baseline.sync,remoteSha:baseline.remoteSha,pending:[]}));}finally{store.close();}
    },baseline);
    await second.reload();await connect(second,true);await expect(second.locator('#save-state')).toContainText('Synced');
    const started=Date.now();await edit(page,'801');
    await expect.poll(()=>local(page),{timeout:25000}).toEqual({pending:0,value:801});
    await second.bringToFront();await second.locator('[data-action="save"]').click();
    await expect(second.locator('#save-state')).toContainText('Sync conflict');
    expect((await local(second)).value).not.toBe(801);
    test.info().annotations.push({type:'controlled-sync-ms',description:String(Date.now()-started)});
    failure=true;await edit(page,'802');await page.locator('[data-action="save"]').click();
    await expect(page.locator('#save-state')).toHaveText('Sync failed - local copy retained');
    expect((await local(page)).value).toBe(802);expect((await local(page)).pending).toBeGreaterThan(0);
    failure=false;await page.locator('[data-action="save"]').click();
    await expect.poll(()=>local(page)).toEqual({pending:0,value:802});
    await page.context().setOffline(true);await edit(page,'901');await expect(page.locator('#save-state')).toContainText('Saved locally');
    expect((await local(page)).pending).toBeGreaterThan(0);
    await adopt(second);await expect(second.locator('td[data-r="1"][data-c="2"]')).toHaveText('802');
    await edit(second,'902');await second.locator('[data-action="save"]').click();await expect.poll(()=>local(second)).toEqual({pending:0,value:902});
    const before=revision;await page.context().setOffline(false);
    await page.bringToFront();await page.locator('[data-action="save"]').click();
    await expect(page.locator('#save-state')).toContainText('Sync conflict');
    expect((await local(page)).value).toBe(901);expect((await local(second)).value).toBe(902);expect(revision).toBe(before);
    await page.locator('#sync-review').click();
    const comparison=page.frameLocator('iframe.comparison-frame');
    await expect(comparison.locator('body')).toHaveAttribute('data-loading','false');
    await comparison.getByRole('button',{name:'Compare with remote version (GitHub)',exact:true}).click();
    await expect(comparison.getByRole('button',{name:'Compare with remote version (GitHub)',exact:true})).toBeEnabled();
    await expect(comparison.locator('body')).toHaveAttribute('data-loading','false');
    await expect(comparison.locator('#left-grid')).toContainText('901');
    await expect(comparison.locator('#right-grid')).toContainText('902');
    await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Sync conflict - choose deliberately',exact:true})).toHaveCount(0);
    await expect(page.locator('#sync-review')).toBeVisible();
    expect(revision).toBe(before);
    await page.reload();await expect(page.locator('#save-state')).toContainText('sync paused');
    expect((await local(page)).value).toBe(901);expect((await local(page)).pending).toBeGreaterThan(0);
    await second.getByRole('button',{name:'Recovery',exact:true}).click();
    await second.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
    await expect(second.locator('#sync-remember')).toBeChecked();
    await second.getByRole('button',{name:'Disconnect',exact:true}).click();
    await expect(second.locator('#save-state')).toHaveText('Disconnected - local only');
    await second.reload();await expect(second.locator('#save-state')).toContainText('local only');
  }finally{await page.context().setOffline(false);await other.close();}
});

test('visual backup comparison supports choices and changed areas without restoring or syncing either source',async({page})=>{
  let requests=0;page.on('request',request=>{if(request.url().startsWith('https://api.github.com/'))requests++;});
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const fixture=await page.evaluate(async()=>{
    const storage='/src/storage.ts',model='/src/model.ts',archive='/src/archive.ts';
    const [{Store},{blankSheet,key},{stringifyArchive}]=await Promise.all([import(/* @vite-ignore */storage),import(/* @vite-ignore */model),import(/* @vite-ignore */archive)]);
    const store=await Store.open();
    try{
      const state=(await store.load())!,backup=await store.backup(state),extra=blankSheet('Invented comparison',65,3);
      backup.state.book.sheets.push(extra);
      for(let i=1;i<=60;i++)extra.cells[key(extra.rows[i].id,extra.columns[0].id)]={value:`Backup only ${i}`};
      return{contents:stringifyArchive(backup),book:state.book.id,version:state.version};
    }finally{store.close();}
  });
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  await page.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  await page.getByRole('button',{name:'Compare copies',exact:true}).click();
  const comparison=page.frameLocator('iframe.comparison-frame');
  await expect(comparison.getByRole('heading',{name:'Compare versions',exact:true})).toBeVisible();
  await expect(comparison.getByRole('button',{name:'Compare with remote version (GitHub)',exact:true})).toBeDisabled();
  await expect(comparison.locator('#totals')).toContainText('Choose a right copy');
  await comparison.locator('#right-file').setInputFiles({name:'invented.fnt.json',mimeType:'application/json',buffer:Buffer.from(fixture.contents)});
  await expect(comparison.locator('body')).toHaveAttribute('data-loading','false');
  await expect(comparison.locator('#navigation')).toContainText('Invented comparison');
  await comparison.locator('[data-category="structure"]').click();
  await expect(comparison.locator('#right-grid')).toContainText('Backup only 1');
  const areas=await comparison.locator('#region-picker option').count();
  for(let area=1;area<areas;area++)await comparison.locator('#next').click();
  await expect(comparison.locator('#right-grid')).toContainText('Backup only 60');
  await comparison.locator('#keep-right button').click();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of');
  await comparison.locator('#undo-choice').click();
  await expect(comparison.locator('#selection-progress')).toContainText('0 of');
  await comparison.locator('#right-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"bad":true}')});
  await expect(comparison.locator('#error')).toContainText('Neither workbook was changed.');
  await expect(comparison.locator('#right-grid')).toContainText('Backup only 60');
  expect(await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{const state=(await store.load())!;return{book:state.book.id,version:state.version};}finally{store.close();}
  })).toEqual({book:fixture.book,version:fixture.version});
  expect(requests).toBe(0);
  await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();
});

test('connecting and uploading never locks source editing while waiting for acknowledgment',async({page})=>{
  let release:()=>void;
  let uploading=false;
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('https://api.github.com/**',async route=>{
    if(route.request().method()==='PUT'){
      uploading=true;
      await gate;await route.fulfill({json:{content:{sha:'acknowledged'}}});return;
    }
    await route.fulfill(route.request().url().includes('/contents/')?{status:404,json:{message:'Not found'}}:{json:{private:true,has_pages:false}});
  });
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  for(const [name,value]of [['owner','example'],['repo','private-test'],['branch','main'],['path','synthetic.json'],['token','synthetic-test-token']]){
    await page.locator(`#sync-${name}`).fill(value);
  }
  await page.getByRole('button',{name:'Connect & sync now',exact:true}).click();
  await expect.poll(()=>uploading).toBe(true);
  await expect(page.locator('#formula')).toBeEnabled();
  await page.locator('#grid-scroll').focus();
  await expect(page.locator('.cell-inline-editor')).toHaveCount(0);
  expect(await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const s=(await store.load())!.book.sheets[0];return s.cells[`${s.rows[1].id}:${s.columns[2].id}`].value;}finally{store.close();}
  })).toBe(180);
  release!();
  await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
  await expect(page.locator('#formula')).toBeEnabled();
  await page.locator('#row-jump').fill('2');await page.locator('#row-jump').press('Enter');
  await expect(page.locator('td[data-r="1"][data-c="2"]')).toHaveText('180');
});

test('failed conflict recovery is explicit and never claims both versions were saved',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const remote=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store,encode64}=await import(/* @vite-ignore */path),store=await Store.open();
    try{
      const state=(await store.load())!,remote=structuredClone(state.book);remote.title='Invented remote conflict';
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args:Parameters<typeof put>){
        if(this.name==='history'&&(args[0] as {label?:string}).label==='Remote conflict - not applied')throw new DOMException('Controlled recovery quota','QuotaExceededError');
        return put.apply(this,args);
      };
      return encode64(JSON.stringify({format:'fnt-sync-v1',book:remote,operations:[]}));
    }finally{store.close();}
  });
  await page.route('https://api.github.com/**',async route=>{
    expect(route.request().method()).not.toBe('PUT');
    await route.fulfill({json:route.request().url().includes('/contents/')?{sha:'divergent',content:remote}:{private:true,has_pages:false}});
  });
  await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  for(const [name,value]of [['owner','example'],['repo','private-test'],['branch','main'],['path','synthetic.json'],['token','synthetic-test-token']])await page.locator(`#sync-${name}`).fill(value);
  await page.getByRole('button',{name:'Connect & sync now',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Sync conflict — recovery failed; saved locally');
  await expect(page.locator('#error')).toContainText('Controlled recovery quota');
  await expect(page.getByRole('dialog',{name:'Sync conflict - choose deliberately'})).toHaveCount(0);
  await expect(page.locator('#formula')).toBeEnabled();expect(errors).toEqual([]);
});
