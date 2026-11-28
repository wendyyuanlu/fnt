import {expect,test,type Page,type Locator,type TestInfo} from '@playwright/test';

test.skip(!process.env.FNT_COPY_UI_URL,'Requires an isolated invented copy-control fixture.');
type Mode='replace-local'|'replace-remote'|'migrate-canonical';
async function setup(page:Page,mode:Mode,scenario:'normal'|'changed'|'local-change'|'read-error'|'apply-error'|'canonical-present'|'canonical-race'|'canonical-disappears'|'canonical-error'|'canonical-wait'|'canonical-confirm-wait'='normal',legacyPath?:string){
  const origin=new URL(process.env.FNT_COPY_UI_URL!).origin;
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/__copy-ui')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invented copy controls</title>'});
    return route.continue();
  });
  await page.goto(origin+'/__copy-ui');
  await page.evaluate(async({mode,scenario,legacyPath})=>{
    await import(new URL('/src/style.css',location.href).href);
    const {openPrivateWorkbook}=await import(new URL('/src/private-workbook-ui.ts',location.href).href);
    const observations={reads:[] as {config:object;token:string;fieldCleared:boolean}[],applied:[] as {sha:string;token:string}[],actions:[] as {action:string;path:string;legacyPath:string}[],canonicalReads:0,completed:0,checks:0};
    Object.assign(window,{copyObservations:observations});
    openPrivateWorkbook({
      mode,config:legacyPath?{owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:legacyPath}:{owner:'invented',repo:'private-copy',branch:'main',path:'invented.json'},
      canonical:mode==='migrate-canonical'?{path:'fnt-data.json',inspect:async(config:{owner:string;repo:string;branch:string},token:string)=>{
        observations.canonicalReads++;
        if(token!=='invented-dialog-token')throw Error('Unexpected migration credential.');
        if(scenario==='canonical-wait'||scenario==='canonical-confirm-wait'&&observations.canonicalReads===2)await new Promise<void>(resolve=>Reflect.set(window,'releaseCanonicalRead',resolve));
        if(scenario==='canonical-error')throw Error('Invented canonical access failure.');
        return scenario==='canonical-present'||scenario==='canonical-race'&&observations.canonicalReads>1||scenario==='canonical-disappears'&&observations.canonicalReads===1?{config:{...config,path:'fnt-data.json'},sha:'c'.repeat(40),book:{title:'Invented different canonical workbook'}}:undefined;
      }}:undefined,
      dialog:(title:string,html:string,mount:(dialog:HTMLDialogElement)=>void)=>{
        const dialog=document.createElement('dialog');dialog.className='dialog-surface';dialog.setAttribute('aria-label',title);
        dialog.innerHTML=`<div class="dialog-heading"><h1 class="dialog-title">${title}</h1><button type="button" class="close" aria-label="Close dialog">Close</button></div>${html}`;
        document.body.append(dialog);dialog.querySelector<HTMLButtonElement>('.close')!.onclick=()=>dialog.close();dialog.showModal();mount(dialog);return dialog;
      },
      ensureReady:async()=>{
        observations.checks++;
        if(scenario==='local-change'&&observations.reads.length>0&&observations.checks>2)throw Error('Invented concurrent local change; read again.');
      },
      inspect:async(config:object,token:string)=>{
        observations.reads.push({config,token,fieldCleared:document.querySelector<HTMLInputElement>('[name="token"]')!.value===''});
        if(scenario==='read-error')throw Error('Invented read failure.');
        return{config,sha:scenario==='changed'&&observations.reads.length>1?'b'.repeat(40):'a'.repeat(40),book:{title:'Invented <script>not executable</script>'}};
      },
      initialize:async(source:{sha:string;config:{path:string}},token:string,action:string,legacy?:{config:{path:string}})=>{
        if(scenario==='apply-error')throw Error('Invented uncertain replacement; inspect recovery.');
        observations.applied.push({sha:source.sha,token});
        if(mode==='migrate-canonical')observations.actions.push({action,path:source.config.path,legacyPath:legacy!.config.path});
      },
      opened:()=>{observations.completed++;},
    });
  },{mode,scenario,legacyPath});
  const dialog=page.getByRole('dialog',{name:mode==='migrate-canonical'?'Use fnt-data.json on this device':mode==='replace-local'?'Use latest GitHub copy':'Replace GitHub with this copy',exact:true});
  await dialog.locator('[name="token"]').fill('invented-dialog-token');
  return dialog;
}
async function observations(page:Page){
  return page.evaluate(()=>Reflect.get(window,'copyObservations') as {reads:{token:string;fieldCleared:boolean}[];applied:{sha:string;token:string}[];actions:{action:string;path:string;legacyPath:string}[];canonicalReads:number;completed:number});
}
async function migrationLayout(page:Page,dialog:Locator,info:TestInfo,mode:string){
  const bounds=await dialog.evaluate(element=>{
    const surface=element.getBoundingClientRect();
    return{viewport:{width:innerWidth,height:innerHeight},surface:{left:surface.left,right:surface.right,top:surface.top,bottom:surface.bottom},
      scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,
      controls:[...element.querySelectorAll<HTMLElement>('input,button')].filter(control=>control.getClientRects().length).map(control=>{
        const rect=control.getBoundingClientRect();return{text:control.textContent,left:rect.left,right:rect.right};
      })};
  });
  expect(bounds.viewport.height).toBe(770);
  expect(bounds.surface.left).toBeGreaterThanOrEqual(9);expect(bounds.surface.right).toBeLessThanOrEqual(bounds.viewport.width-9);
  expect(bounds.surface.top).toBeGreaterThanOrEqual(9);expect(bounds.surface.bottom).toBeLessThanOrEqual(761);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth+1);
  for(const control of bounds.controls){expect(control.left).toBeGreaterThanOrEqual(bounds.surface.left);expect(control.right).toBeLessThanOrEqual(bounds.surface.right);}
  await info.attach(`${mode}-migration-bounds`,{body:JSON.stringify(bounds),contentType:'application/json'});
  await dialog.evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:info.outputPath(`${mode}-migration-top.png`)});
  await dialog.getByRole('button',{name:mode==='absent'?'Create fnt-data.json from this browser':'Use fnt-data.json in this browser',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath(`${mode}-migration-choices.png`)});
}
for(const mode of ['replace-local','replace-remote'] as const){
  const label=mode==='replace-local'?'Use this GitHub copy':'Replace GitHub with this copy';
  test(`${mode}: separate read, safe text and fresh confirmation`,async({page},info)=>{
    const dialog=await setup(page,mode),confirm=dialog.getByRole('button',{name:label,exact:true});
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('button',{name:'Read latest GitHub copy',exact:true}).click();
    await expect(confirm).toBeEnabled();await expect(dialog.locator('[name="token"]')).toHaveValue('');
    await expect(dialog.locator('[data-private-preview]')).toContainText('Invented <script>not executable</script>');
    await expect(dialog.locator('[data-private-preview] script')).toHaveCount(0);
    expect((await observations(page)).applied).toEqual([]);
    await page.screenshot({path:info.outputPath(`${mode}-preview.png`)});
    await confirm.click();await expect(dialog).not.toBeVisible();
    const result=await observations(page);
    expect(result.reads).toHaveLength(2);expect(result.reads.every(read=>read.fieldCleared&&read.token==='invented-dialog-token')).toBe(true);
    expect(result.applied).toEqual([{sha:'a'.repeat(40),token:'invented-dialog-token'}]);expect(result.completed).toBe(1);
  });
  test(`${mode}: moved GitHub revision refreshes preview and needs another confirmation`,async({page})=>{
    const dialog=await setup(page,mode,'changed'),confirm=dialog.getByRole('button',{name:label,exact:true});
    await dialog.getByRole('button',{name:'Read latest GitHub copy',exact:true}).click();
    await expect(confirm).toBeEnabled();await confirm.click();
    await expect(dialog.getByRole('status')).toContainText('GitHub changed since the preview');
    await expect(dialog.locator('[data-private-preview]')).toContainText('b'.repeat(40));
    expect((await observations(page)).applied).toEqual([]);await expect(confirm).toBeEnabled();
    await confirm.click();await expect(dialog).not.toBeVisible();
    expect((await observations(page)).applied).toEqual([{sha:'b'.repeat(40),token:'invented-dialog-token'}]);
  });
  test(`${mode}: cancellation never applies a preview`,async({page})=>{
    const dialog=await setup(page,mode);
    await dialog.getByRole('button',{name:'Read latest GitHub copy',exact:true}).click();
    await expect(dialog.getByRole('button',{name:label,exact:true})).toBeEnabled();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    expect((await observations(page)).applied).toEqual([]);
  });
}
test('editing the source invalidates the inspected copy',async({page})=>{
  const dialog=await setup(page,'replace-local'),confirm=dialog.getByRole('button',{name:'Use this GitHub copy',exact:true});
  await dialog.getByRole('button',{name:'Read latest GitHub copy',exact:true}).click();await expect(confirm).toBeEnabled();
  await dialog.locator('[name="path"]').fill('different.json');await expect(confirm).toBeDisabled();
  await expect(dialog.locator('[data-private-preview]')).toBeHidden();expect((await observations(page)).applied).toEqual([]);
});
test('a concurrent local change refuses confirmation',async({page})=>{
  const dialog=await setup(page,'replace-local','local-change'),confirm=dialog.getByRole('button',{name:'Use this GitHub copy',exact:true});
  await dialog.getByRole('button',{name:'Read latest GitHub copy',exact:true}).click();await expect(confirm).toBeEnabled();await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('Invented concurrent local change');
  await expect(confirm).toBeDisabled();expect((await observations(page)).applied).toEqual([]);
});
test('read errors are explicit and cannot enable replacement',async({page})=>{
  const dialog=await setup(page,'replace-local','read-error');
  await dialog.getByRole('button',{name:'Read latest GitHub copy',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Invented read failure');
  await expect(dialog.getByRole('button',{name:'Use this GitHub copy',exact:true})).toBeDisabled();
  await expect(dialog.locator('[name="token"]')).toHaveValue('');expect((await observations(page)).applied).toEqual([]);
});
test('uncertain GitHub replacement does not claim that GitHub was unchanged',async({page})=>{
  const dialog=await setup(page,'replace-remote','apply-error'),confirm=dialog.getByRole('button',{name:'Replace GitHub with this copy',exact:true});
  await dialog.getByRole('button',{name:'Read latest GitHub copy',exact:true}).click();await expect(confirm).toBeEnabled();await confirm.click();
  await expect(dialog.getByRole('status')).toContainText('Check GitHub before retrying');
  await expect(dialog.getByRole('alert')).toContainText('Invented uncertain replacement');
  await expect(confirm).toBeDisabled();expect((await observations(page)).completed).toBe(0);
});
test('both directions preserve an explicitly saved legacy path rather than silently selecting a different file',async({page})=>{
  for(const mode of ['replace-local','replace-remote'] as const)for(const path of ['workbook.json','personal-workbook.json']){
    const dialog=await setup(page,mode,'normal',path);
    await expect(dialog.locator('[name="owner"]')).toHaveValue('wendyyuanlu');
    await expect(dialog.locator('[name="repo"]')).toHaveValue('fnt-data');
    await expect(dialog.locator('[name="path"]')).toHaveValue(path);
  }
});
test('canonical migration reads both files and separately confirms absent-file creation',async({page},info)=>{
  await page.setViewportSize({width:page.viewportSize()!.width,height:770});
  const dialog=await setup(page,'migrate-canonical','normal','personal-workbook.json');
  await expect(dialog.locator('[name="path"]')).toHaveValue('personal-workbook.json');
  await expect(dialog.locator('[name="path"]')).toHaveJSProperty('readOnly',true);
  const create=dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true});
  await expect(create).toBeDisabled();await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await expect(dialog.locator('[data-canonical-preview]')).toContainText('does not exist');
  await expect(create).toBeEnabled();expect((await observations(page)).applied).toEqual([]);
  await migrationLayout(page,dialog,info,'absent');
  await create.click();await expect(dialog).not.toBeVisible();
  const result=await observations(page);expect(result.canonicalReads).toBe(2);
  expect(result.actions).toEqual([{action:'migrate-canonical',path:'personal-workbook.json',legacyPath:'personal-workbook.json'}]);
});
for(const [label,action]of [['Use fnt-data.json in this browser','replace-local'],['Replace fnt-data.json with this browser','replace-remote']] as const)test(`existing canonical copy requires explicit choice: ${action}`,async({page},info)=>{
  await page.setViewportSize({width:page.viewportSize()!.width,height:770});
  const dialog=await setup(page,'migrate-canonical','canonical-present','personal-workbook.json');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await expect(dialog.locator('[data-canonical-preview]')).toContainText('Invented different canonical workbook');
  await expect(dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true})).toBeHidden();
  expect((await observations(page)).applied).toEqual([]);
  if(action==='replace-local')await migrationLayout(page,dialog,info,'existing');
  await dialog.getByRole('button',{name:label,exact:true}).click();await expect(dialog).not.toBeVisible();
  expect((await observations(page)).actions).toEqual([{action,path:'fnt-data.json',legacyPath:'personal-workbook.json'}]);
});
test('a canonical file appearing after preview stops creation and requires a new explicit choice',async({page})=>{
  const dialog=await setup(page,'migrate-canonical','canonical-race','personal-workbook.json');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('GitHub files changed');
  expect((await observations(page)).applied).toEqual([]);
  await dialog.getByRole('button',{name:'Use fnt-data.json in this browser',exact:true}).click();
  await expect(dialog).not.toBeVisible();expect((await observations(page)).actions[0].action).toBe('replace-local');
});
test('a disappearing canonical file refreshes choices without applying the old selection',async({page})=>{
  const dialog=await setup(page,'migrate-canonical','canonical-disappears','personal-workbook.json');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await dialog.getByRole('button',{name:'Use fnt-data.json in this browser',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('GitHub files changed');
  await expect(dialog.locator('[data-canonical-preview]')).toContainText('does not exist');
  expect((await observations(page)).applied).toEqual([]);
  await dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true}).click();
  await expect(dialog).not.toBeVisible();expect((await observations(page)).actions[0].action).toBe('migrate-canonical');
});
test('a legacy-only revision change requires confirmation of the refreshed source',async({page})=>{
  const dialog=await setup(page,'migrate-canonical','changed','personal-workbook.json');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  const create=dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true});
  await create.click();await expect(dialog.getByRole('status')).toContainText('GitHub files changed');
  await expect(dialog.locator('[data-private-preview]')).toContainText('b'.repeat(40));expect((await observations(page)).applied).toEqual([]);
  await create.click();await expect(dialog).not.toBeVisible();expect((await observations(page)).applied[0].sha).toBe('b'.repeat(40));
});
test('canonical access errors never masquerade as an absent file',async({page})=>{
  const dialog=await setup(page,'migrate-canonical','canonical-error','personal-workbook.json');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Invented canonical access failure');
  await expect(dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true})).toBeDisabled();
  expect((await observations(page)).applied).toEqual([]);
});
test('closing during a canonical read cannot publish its late result',async({page})=>{
  const dialog=await setup(page,'migrate-canonical','canonical-wait','personal-workbook.json');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await expect.poll(async()=>(await observations(page)).canonicalReads).toBe(1);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.evaluate(()=>Reflect.get(window,'releaseCanonicalRead')());
  await expect(dialog).not.toBeVisible();expect((await observations(page)).applied).toEqual([]);
  expect((await observations(page)).completed).toBe(0);
});
test('a late canonical confirmation response cannot apply after its dialog closes',async({page})=>{
  const dialog=await setup(page,'migrate-canonical','canonical-confirm-wait','personal-workbook.json');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true}).click();
  await expect.poll(async()=>(await observations(page)).canonicalReads).toBe(2);
  await dialog.evaluate(element=>(element as HTMLDialogElement).close());
  await page.evaluate(()=>Reflect.get(window,'releaseCanonicalRead')());
  await expect(dialog).not.toBeVisible();expect((await observations(page)).applied).toEqual([]);
  expect((await observations(page)).completed).toBe(0);
});
