import {expect,test,type Page} from '@playwright/test';

test.skip(!process.env.FNT_WORKBOOK_COPY_URL,'Requires a dedicated invented whole-copy fixture server.');
const config={owner:'invented',repo:'private-copy',branch:'main',path:'fnt-data.json'};
const remoteSha='b'.repeat(40),nextSha='c'.repeat(40),movedSha='d'.repeat(40),canonicalSha='e'.repeat(40);
type Scenario='normal'|'moved'|'cas'|'missing-ack'|'split'|'waiting-flight'|'canonical-absent'|'canonical-race'|'canonical-ack-missing'|'legacy-connected'|'legacy-missing';
async function setup(page:Page,scenario:Scenario='normal',savedConfig=config){
  const origin=new URL(process.env.FNT_WORKBOOK_COPY_URL!).origin,unexpected:string[]=[],methods:string[]=[],errors:string[]=[];
  let contentsReads=0,canonicalReads=0,uploadedContent:string|undefined,puts=0;
  const requestedPaths:string[]=[];
  let releaseRead!:()=>void;
  const readGate=new Promise<void>(resolve=>{releaseRead=resolve;});
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin||url.pathname.startsWith('/testing-workbook')){unexpected.push(url.origin+url.pathname);return route.abort();}
    if(url.pathname==='/__copy-app-fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Invented whole-copy fixture</title>'});
    return route.continue();
  });
  await page.goto(origin+'/__copy-app-fixture');
  const fixture=await page.evaluate(async({config,split,waiting})=>{
    const {syntheticConverterBook}=await import(new URL('/tests/converter-polish-fixture.ts',location.href).href);
    const {Store,encode64,request}=await import(new URL('/src/storage.ts',location.href).href);
    const {ensureTableSheetSpace}=await import(new URL('/src/sheet-space.ts',location.href).href);
    const local=syntheticConverterBook();ensureTableSheetSpace(local);local.title='Invented browser workbook';
    const localOriginal={id:'invented-local-original',name:'Invented local.xlsx',data:'AA=='};
    local.references=[{id:'invented-local-reference',name:'Invented local source',kind:'list',archivedRows:[],origin:{original:localOriginal.id}}];
    const remote=structuredClone(local);remote.title=split?'Invented latest personal workbook':'Invented GitHub workbook';
    const remoteOriginal={id:'invented-remote-original',name:'Invented remote.xlsx',data:'AQ=='};
    remote.references=[{id:'invented-remote-reference',name:'Invented remote source',kind:'list',archivedRows:[],origin:{original:remoteOriginal.id}}];
    const store=await Store.open();
    let before;
    try{
      const saved=await store.save(local,0,'Invented unsynced local edits',false,localOriginal);
      before=await store.metadata(saved.version,(state:object)=>({...state,sync:config,remoteSha:'a'.repeat(40),syncPaused:true,syncReview:true}));
      if(waiting){
        await store.syncMetadata(before.version,{sha:'a'.repeat(40),confirmed:local,acknowledged:before.pending.map((operation:{id:string})=>operation.id),paused:false,review:false});
        await store.rememberSyncToken(config,'invented-existing-flight-token');
      }
    }finally{store.close();}
    const review={invented:'retained review',decision:'keep independent comparison'};
    const db=await request(indexedDB.open('fnt-workbook-v1',2));
    try{await request(db.transaction('state','readwrite').objectStore('state').put(review,'comparison:protected-copy-review'));}
    finally{db.close();}
    const canonical=structuredClone(remote);canonical.title='Invented older canonical workbook';
    return{local,remote,canonical,localOriginal,remoteOriginal,before,review,content:encode64(JSON.stringify({format:'fnt-sync-v1',book:remote,operations:[],originals:[remoteOriginal],receipts:{}})),canonicalContent:encode64(JSON.stringify({format:'fnt-sync-v1',book:canonical,operations:[],originals:[remoteOriginal],receipts:{}}))};
  },{config:savedConfig,split:scenario==='split',waiting:scenario==='waiting-flight'||scenario==='legacy-connected'});
  await page.route('https://api.github.com/**',async route=>{
    const request=route.request(),url=new URL(request.url());methods.push(request.method());
    const repository=`/repos/${savedConfig.owner}/${savedConfig.repo}`,prefix=repository+'/contents/';
    if(request.method()==='GET'&&url.pathname===repository)return route.fulfill({contentType:'application/json',body:JSON.stringify({private:true,has_pages:false})});
    const file=url.pathname.slice(prefix.length),allowed=[...new Set([savedConfig.path,'fnt-data.json'])];
    if(url.pathname.startsWith(prefix)&&allowed.includes(file)){
      if(request.method()==='GET'){
        contentsReads++;requestedPaths.push(file);
        if(file==='fnt-data.json')canonicalReads++;
        if(scenario==='waiting-flight'&&contentsReads===1)await readGate;
        if(scenario==='legacy-missing'&&file!=='fnt-data.json')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Not Found'})});
        if(file==='fnt-data.json'&&scenario.startsWith('canonical-')&&!(scenario==='canonical-race'&&canonicalReads>=3)&&!puts)return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Not Found'})});
        if(file==='fnt-data.json'&&scenario.startsWith('canonical-')&&puts)return route.fulfill({contentType:'application/json',body:JSON.stringify({sha:nextSha,content:uploadedContent})});
        return route.fulfill({contentType:'application/json',body:JSON.stringify({sha:scenario==='split'&&file==='fnt-data.json'?canonicalSha:scenario==='moved'&&contentsReads>1?movedSha:remoteSha,content:scenario==='split'&&file==='fnt-data.json'?fixture.canonicalContent:fixture.content})});
      }
      if(request.method()==='PUT'){
        puts++;const body=request.postDataJSON() as {sha:string;branch:string;content:string};
        expect(file).toBe('fnt-data.json');expect(body.sha).toBe(scenario.startsWith('canonical-')?undefined:scenario==='split'?canonicalSha:remoteSha);expect(body.branch).toBe('main');uploadedContent=body.content;
        if(scenario==='cas')return route.fulfill({status:409,body:'Invented remote changed'});
        return route.fulfill({contentType:'application/json',body:JSON.stringify(scenario==='missing-ack'||scenario==='canonical-ack-missing'?{}:{content:{sha:nextSha}})});
      }
    }
    unexpected.push(request.method()+' '+url.pathname);return route.abort();
  });
  await page.goto(origin+'/');await expect(page.locator('td[data-r][data-c]').first()).toBeVisible();
  if(scenario==='waiting-flight'){
    await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='invented-existing-editor';dialog.textContent='Invented existing nonmodal editor';document.body.append(dialog);dialog.show();});
    if(!contentsReads)await page.getByRole('button',{name:/^Save(?: workbook)?$/}).click({timeout:5000});
    await expect.poll(()=>contentsReads).toBe(1);
  }else expect(methods).toEqual([]);
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  const recovery=page.getByRole('dialog',{name:'Recovery',exact:true});
  await expect(recovery.getByRole('button',{name:'Compare versions for merge conflict',exact:true})).toBeVisible();
  await expect(recovery.getByRole('button',{name:'Use latest GitHub copy',exact:true})).toBeVisible();
  await expect(recovery.getByRole('button',{name:'Replace GitHub with this copy',exact:true})).toBeVisible();
  const beforeAction=await current(page);
  return{fixture,recovery,methods,unexpected,errors,requestedPaths,releaseRead,beforeAction,puts:()=>puts,uploadedContent:()=>uploadedContent};
}
async function inspect(page:Page,direction:'local'|'github',selected?:{owner:string;path:string}){
  const label=direction==='local'?'Use latest GitHub copy':'Replace GitHub with this copy';
  await page.getByRole('dialog',{name:'Recovery',exact:true}).getByRole('button',{name:label,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:label,exact:true});
  await expect(dialog.locator('[name="owner"]')).toHaveValue(selected?.owner??config.owner);
  await expect(dialog.locator('[data-local-copy]')).toContainText('Invented browser workbook');
  const localBeforeRead=await current(page);
  if(selected)await dialog.locator('[name="path"]').fill(selected.path);
  await dialog.locator('[name="token"]').fill('invented-copy-token');
  await dialog.getByRole('button',{name:'Read latest GitHub copy',exact:true}).click();
  const confirm=dialog.getByRole('button',{name:direction==='local'?'Use this GitHub copy':label,exact:true});
  await expect(confirm).toBeEnabled();await expect(dialog.locator('[name="token"]')).toHaveValue('');
  await expect(dialog.locator('[data-private-preview]')).toContainText(remoteSha);
  const localAtPreview=await current(page);
  expect(localAtPreview.state.book).toEqual(localBeforeRead.state.book);
  return{dialog,confirm,localAtPreview};
}
async function current(page:Page){
  return page.evaluate(async()=>{
    const {Store,request,hasPendingContent}=await import(new URL('/src/storage.ts',location.href).href),store=await Store.open();
    try{
      const state=await store.load(),originals=await store.originals(),history=await store.history();
      const db=await request(indexedDB.open('fnt-workbook-v1',2));
      try{
        const review=await request(db.transaction('state').objectStore('state').get('comparison:protected-copy-review'));
        return{state,originals,history,review,pendingContent:state&&hasPendingContent(state),base:state?.sync&&await store.syncBase(state.sync,state.remoteSha)};
      }finally{db.close();}
    }finally{store.close();}
  });
}
async function recoveries(page:Page){
  return page.evaluate(async()=>{
    const {Store}=await import(new URL('/src/storage.ts',location.href).href),{readArchive}=await import(new URL('/src/archive.ts',location.href).href),store=await Store.open();
    try{
      const history=await store.history() as {backup?:Blob}[],archives:import('../../src/storage').Backup[]=[];
      for(const{backup}of history)if(backup)archives.push(await readArchive(backup) as import('../../src/storage').Backup);
      return archives;
    }
    finally{store.close();}
  });
}
test('both directions are additive to Compare in Recovery and private sync',async({page},info)=>{
  const {recovery,methods,unexpected,errors}=await setup(page);
  await page.screenshot({path:info.outputPath('recovery-copy-actions.png')});
  await recovery.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  const sync=page.getByRole('dialog',{name:'Optional private GitHub sync',exact:true});
  await expect(sync.getByRole('button',{name:'Compare copies',exact:true})).toBeVisible();
  await expect(sync.getByRole('button',{name:'Use latest GitHub copy',exact:true})).toBeVisible();
  await expect(sync.getByRole('button',{name:'Replace GitHub with this copy',exact:true})).toBeVisible();
  expect(methods).toEqual([]);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
test('sign-in preserves the exact saved legacy destination',async({page})=>{
  const {recovery,methods}=await setup(page,'normal',{owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:'workbook.json'});
  await recovery.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  const sync=page.getByRole('dialog',{name:'Optional private GitHub sync',exact:true});
  await expect(sync.locator('#sync-path')).toHaveValue('workbook.json');
  await expect(sync.getByRole('button',{name:'Connect & sync now',exact:true})).toBeDisabled();
  await expect(sync.getByRole('button',{name:'Use fnt-data.json on this device',exact:true})).toBeVisible();expect(methods).toEqual([]);
});
test('a preexisting incoming flight blocked by an editor drains before replacement opens',async({page})=>{
  test.skip(process.env.FNT_COPY_UI_NORMAL_MODE!=='true','Remembered connections require normal mode, not the existing-data-only preview.');
  const state=await setup(page,'waiting-flight');state.releaseRead();
  await expect(page.locator('#save-state')).toContainText('updates ready');
  const putsBeforeChoice=state.puts();
  await state.recovery.getByRole('button',{name:'Use latest GitHub copy',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Use latest GitHub copy',exact:true});
  await expect(dialog).toBeVisible({timeout:5000});
  await expect(dialog.locator('[data-local-copy]')).toContainText('Invented browser workbook');
  expect((await current(page)).state.book.title).toBe('Invented browser workbook');
  expect(state.puts()).toBe(putsBeforeChoice);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.evaluate(()=>document.getElementById('invented-existing-editor')?.remove());
  expect(state.unexpected).toEqual([]);expect(state.errors).toEqual([]);
});
async function inspectMigration(page:Page){
  await page.getByRole('dialog',{name:'Recovery',exact:true}).getByRole('button',{name:'Use fnt-data.json on this device',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Use fnt-data.json on this device',exact:true});
  await expect(dialog.locator('[name="path"]')).toHaveValue('personal-workbook.json');
  await dialog.locator('[name="token"]').fill('invented-copy-token');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('Both files checked');
  return{dialog,before:await current(page)};
}
for(const direction of ['local','github'] as const)test(`two existing files: explicitly ${direction==='local'?'adopt':'replace'} canonical and preserve legacy`,async({page})=>{
  const state=await setup(page,'split',{...config,path:'personal-workbook.json'}),{dialog,before}=await inspectMigration(page);
  await expect(dialog.locator('[data-canonical-preview]')).toContainText('Invented older canonical workbook');
  expect(before.state.sync.path).toBe('personal-workbook.json');expect(state.puts()).toBe(0);
  await dialog.getByRole('button',{name:direction==='local'?'Use fnt-data.json in this browser':'Replace fnt-data.json with this browser',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  const saved=await current(page);
  expect(saved.state.book.title).toBe(direction==='local'?'Invented older canonical workbook':before.state.book.title);
  expect(saved.state.sync.path).toBe('fnt-data.json');expect(saved.state.syncPaused).toBe(true);
  expect(saved.review).toEqual(state.fixture.review);expect(saved.history.filter((entry:{backup?:string})=>entry.backup).length).toBeGreaterThanOrEqual(2);
  const archives=await recoveries(page);
  expect(archives.some(archive=>JSON.stringify(archive.state.book)===JSON.stringify(before.state.book))).toBe(true);
  expect(archives.some(archive=>JSON.stringify(archive.state.book)===JSON.stringify(state.fixture.remote)&&archive.state.sync?.path==='personal-workbook.json')).toBe(true);
  if(direction==='local')expect(saved.base).toEqual(state.fixture.canonical);
  else expect(archives.some(archive=>JSON.stringify(archive.state.book)===JSON.stringify(state.fixture.canonical)&&archive.state.sync?.path==='fnt-data.json')).toBe(true);
  expect(state.requestedPaths).toContain('personal-workbook.json');expect(state.requestedPaths).toContain('fnt-data.json');
  expect(state.puts()).toBe(direction==='local'?0:1);expect(state.unexpected).toEqual([]);expect(state.errors).toEqual([]);
});
test('legacy-first choice adopts only the legacy copy and keeps canonical untouched',async({page})=>{
  const state=await setup(page,'split',{...config,path:'personal-workbook.json'}),{dialog,before}=await inspectMigration(page);
  await dialog.getByRole('button',{name:'Use legacy GitHub copy locally first',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=await current(page);expect(saved.state.book.title).toBe(state.fixture.remote.title);
  expect(saved.state.book.sheets).toEqual(state.fixture.remote.sheets);expect(saved.state.sync.path).toBe('personal-workbook.json');
  expect(saved.state.syncPaused).toBe(true);expect(saved.pendingContent).toBe(false);expect(saved.review).toEqual(state.fixture.review);
  expect(saved.base).toEqual(state.fixture.remote);expect(state.puts()).toBe(0);
  const archives=await recoveries(page);
  expect(archives.some(archive=>JSON.stringify(archive.state.book)===JSON.stringify(before.state.book)&&archive.originals.some(original=>original.id===state.fixture.localOriginal.id))).toBe(true);
  expect(state.unexpected).toEqual([]);expect(state.errors).toEqual([]);
});
test('absent canonical migration creates only fnt-data.json and preserves the old saved source until confirmation',async({page})=>{
  const state=await setup(page,'canonical-absent',{...config,path:'personal-workbook.json'}),{dialog,before}=await inspectMigration(page);
  expect(before.state.sync.path).toBe('personal-workbook.json');expect(state.puts()).toBe(0);
  await dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=await current(page);
  expect(saved.state.book).toEqual(before.state.book);expect(saved.state.sync.path).toBe('fnt-data.json');
  expect(saved.state.remoteSha).toBe(nextSha);expect(saved.state.syncPaused).toBe(true);expect(saved.state.syncReview).toBe(true);
  expect(saved.review).toEqual(state.fixture.review);expect(saved.pendingContent).toBe(false);expect(state.puts()).toBe(1);
  expect(saved.originals).toEqual([state.fixture.localOriginal]);
  expect(saved.history.filter((entry:{backup?:string})=>entry.backup).length).toBeGreaterThanOrEqual(2);
  const archives=await recoveries(page);
  expect(archives.some(archive=>JSON.stringify(archive.state.book)===JSON.stringify(before.state.book))).toBe(true);
  expect(archives.some(archive=>JSON.stringify(archive.state.book)===JSON.stringify(state.fixture.remote)&&archive.state.sync?.path==='personal-workbook.json'&&archive.originals.some(original=>JSON.stringify(original)===JSON.stringify(state.fixture.remoteOriginal)))).toBe(true);
  await page.reload();await expect(page.locator('td[data-r][data-c]').first()).toBeVisible();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  await page.getByRole('dialog',{name:'Recovery',exact:true}).getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Optional private GitHub sync',exact:true}).locator('#sync-path')).toHaveValue('fnt-data.json');
  expect(state.unexpected).toEqual([]);expect(state.errors).toEqual([]);
});
for(const scenario of ['canonical-race','canonical-ack-missing'] as const)test(`${scenario}: migration does not switch a saved destination after unconfirmed creation`,async({page})=>{
  const state=await setup(page,scenario,{...config,path:'personal-workbook.json'}),{dialog,before}=await inspectMigration(page);
  await dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true}).click();
  await expect(dialog.getByRole('alert')).not.toBeEmpty();
  const saved=await current(page);expect(saved.state.sync.path).toBe('personal-workbook.json');expect(saved.state.book).toEqual(before.state.book);
  expect(saved.review).toEqual(state.fixture.review);expect(saved.state.syncPaused).toBe(true);expect(saved.pendingContent).toBe(true);
  expect(state.puts()).toBe(scenario==='canonical-race'?0:1);
  await expect(dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true})).toBeDisabled();
});
test('cancelling filename migration retains the actual saved legacy target, pending content and review',async({page})=>{
  const state=await setup(page,'split',{...config,path:'personal-workbook.json'}),{dialog,before}=await inspectMigration(page);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const saved=await current(page);
  expect(saved.state.book).toEqual(before.state.book);expect(saved.state.sync).toEqual(before.state.sync);
  expect(saved.state.pending).toEqual(before.state.pending);expect(saved.review).toEqual(state.fixture.review);
  expect(saved.history).toEqual(before.history);expect(state.puts()).toBe(0);
});
test('a missing legacy file cannot silently substitute the existing canonical copy during migration',async({page})=>{
  const state=await setup(page,'legacy-missing',{owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:'personal-workbook.json'});
  await state.recovery.getByRole('button',{name:'Use fnt-data.json on this device',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Use fnt-data.json on this device',exact:true}),before=await current(page);
  await dialog.locator('[name="token"]').fill('invented-copy-token');
  await dialog.getByRole('button',{name:'Read both GitHub files',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('different filename cannot stand in');
  await expect(dialog.getByRole('button',{name:'Create fnt-data.json from this browser',exact:true})).toBeDisabled();
  const saved=await current(page);expect(saved.state.book).toEqual(before.state.book);expect(saved.state.sync).toEqual(before.state.sync);
  expect(saved.state.pending).toEqual(before.state.pending);expect(state.puts()).toBe(0);
});
test('a saved legacy destination never auto-syncs or reconnects to an unreviewed canonical file',async({page})=>{
  test.skip(process.env.FNT_COPY_UI_NORMAL_MODE!=='true','Remembered credentials require normal mode.');
  const state=await setup(page,'legacy-connected',{...config,path:'personal-workbook.json'});
  await state.recovery.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.keyboard.press('Control+s');
  const sync=page.getByRole('dialog',{name:'Optional private GitHub sync',exact:true});
  await expect(sync.getByRole('button',{name:'Connect & sync now',exact:true})).toBeDisabled();
  expect((await current(page)).state.sync.path).toBe('personal-workbook.json');expect(state.methods).toEqual([]);
});
for(const direction of ['normal','canonical','legacy'] as const)for(const fault of direction==='legacy'?['clone'] as const:['clone','render'] as const)test(`postcommit ${direction} ${fault}: replacement remains fenced after dialog closes and late autosave`,async({page},info)=>{
  test.skip(process.env.FNT_PUBLICATION_PROBE!=='true','Requires the isolated publication fault-injection server.');
  const fixture=await setup(page,direction==='normal'?'normal':'split',direction==='normal'?config:{...config,path:'personal-workbook.json'});
  const choice=direction==='normal'?await inspect(page,'local'):await inspectMigration(page);
  const dialog=choice.dialog,prior=await current(page),title=direction==='canonical'?fixture.fixture.canonical.title:fixture.fixture.remote.title;
  await page.evaluate(async fault=>{
    const {Store}=await import(new URL('/src/storage.ts',location.href).href),use=Store.prototype.usePrivateWorkbook;
    const control={committed:false,triggered:false};Reflect.set(window,'__replacementFault',control);
    Store.prototype.usePrivateWorkbook=async function(...args:Parameters<typeof use>){
      const accepted=await use.apply(this,args);control.committed=true;
      if(fault==='clone'){
        const copy=window.structuredClone;
        window.structuredClone=function<T>(value:T,options?:StructuredSerializeOptions):T{
          if(value===accepted.book){window.structuredClone=copy;control.triggered=true;throw Error('Invented postcommit replacement clone failure');}
          return copy(value,options);
        };
      }else{control.triggered=true;Reflect.get(window,'__replacementProbe').failNextRender();}
      return accepted;
    };
  },fault);
  await dialog.getByRole('button',{name:direction==='normal'?'Use this GitHub copy':direction==='canonical'?'Use fnt-data.json in this browser':'Use legacy GitHub copy locally first',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__replacementFault').triggered)).toBe(true);
  const saved=await current(page);
  expect(saved.state.book.title).toBe(title);expect(saved.state.version).toBeGreaterThan(prior.state.version);
  expect(saved.state.syncPaused).toBe(true);expect(saved.review).toEqual(fixture.fixture.review);
  const archives=await recoveries(page);
  expect(archives.some(archive=>JSON.stringify(archive.state.book)===JSON.stringify(prior.state.book)&&archive.originals.some(original=>original.id===fixture.fixture.localOriginal.id))).toBe(true);
  let failureText:string|null=null;
  if(fault==='clone'){
    failureText=await dialog.getByRole('alert').textContent();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  }else await expect(dialog).not.toBeVisible();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__replacementProbe').snapshot().privateCopyOpen)).toBe(false);
  const fenced=await page.evaluate(()=>Reflect.get(window,'__replacementProbe').snapshot());
  await info.attach('Actual postcommit publication identity',{body:JSON.stringify({direction,fault,acceptedVersion:saved.state.version,volatileVersion:fenced.state.version,acceptedTitle:saved.state.book.title,volatileTitle:fenced.book.title,busy:fenced.busy,inert:fenced.inert,publicationFailed:fenced.publicationFailed,failureText}),contentType:'application/json'});
  expect(fenced.busy).toBe(true);expect(fenced.inert).toBe(true);expect(fenced.publicationFailed).toBe(true);
  if(fault==='clone')expect(failureText).toContain('was saved locally');
  expect(fenced.book.title).toBe(fault==='clone'?prior.state.book.title:title);expect(fenced.state.book.title).toBe(title);
  await expect(page.locator('#save-state')).toContainText('editing and autosave paused');
  await page.screenshot({path:info.outputPath(`replacement-${direction}-${fault}-paused.png`)});
  expect(await page.evaluate(()=>Reflect.get(window,'__replacementProbe').edit())).toBe(false);
  await page.evaluate(async()=>{const probe=Reflect.get(window,'__replacementProbe');probe.lateDirty();await probe.flush();});
  const retained=await current(page);
  expect(retained.state).toEqual(saved.state);expect(retained.originals).toEqual(saved.originals);
  expect(retained.history).toEqual(saved.history);expect(retained.review).toEqual(saved.review);
  expect(await recoveries(page)).toEqual(archives);
  expect(await page.evaluate(()=>Reflect.get(window,'__replacementProbe').snapshot().busy)).toBe(true);
  expect(await page.evaluate(()=>Reflect.get(window,'__replacementProbe').snapshot().inert)).toBe(true);
  expect(fixture.puts()).toBe(0);
  await info.attach('Postcommit replacement fence',{body:JSON.stringify({direction,fault,acceptedVersion:saved.state.version,priorVersion:prior.state.version,acceptedTitle:title,oldBookStillVolatile:fault==='clone',lateSaveBlocked:true,recoveryReadable:true}),contentType:'application/json'});
  await page.reload();await expect(page.locator('td[data-r][data-c]').first()).toBeVisible();
  const reopened=await page.evaluate(()=>Reflect.get(window,'__replacementProbe').snapshot());
  expect(reopened.busy).toBe(false);expect(reopened.inert).toBe(false);expect(reopened.publicationFailed).toBe(false);
  expect(reopened.book.title).toBe(title);expect(reopened.state.book.title).toBe(title);
  expect((await current(page)).originals).toEqual(saved.originals);
  expect(fixture.unexpected).toEqual([]);expect(fixture.errors).toEqual([]);
});
test('precommit replacement transaction rejection retains the old editable copy without a publication fence',async({page})=>{
  test.skip(process.env.FNT_PUBLICATION_PROBE!=='true','Requires the isolated publication fault-injection server.');
  const fixture=await setup(page),{dialog,confirm}=await inspect(page,'local'),prior=await current(page);
  await page.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(this.name==='history'&&value&&typeof value==='object'&&'label'in value&&value.label==='Before using latest GitHub copy')throw Error('Invented replacement checkpoint write failed');
      return put.call(this,value,key);
    };
  });
  await confirm.click();await expect(dialog.getByRole('alert')).toContainText('checkpoint write failed');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__replacementProbe').snapshot().privateCopyOpen)).toBe(false);
  const after=await current(page),view=await page.evaluate(()=>Reflect.get(window,'__replacementProbe').snapshot());
  expect(after.state).toEqual(prior.state);expect(after.history).toEqual(prior.history);expect(after.originals).toEqual(prior.originals);
  expect(view.busy).toBe(false);expect(view.inert).toBe(false);expect(view.publicationFailed).toBe(false);
  expect(await page.evaluate(()=>Reflect.get(window,'__replacementProbe').edit())).toBe(true);
  await page.evaluate(()=>Reflect.get(window,'__replacementProbe').flush());
  expect((await current(page)).state.book.title).toBe('Unsafe stale replacement overwrite');
  expect(fixture.puts()).toBe(0);expect(fixture.unexpected).toEqual([]);expect(fixture.errors).toEqual([]);
});
test('GitHub-to-browser replacement keeps displaced local edits, originals and comparison recoverable',async({page},info)=>{
  const {fixture,methods,unexpected,errors}=await setup(page),{dialog,confirm,localAtPreview}=await inspect(page,'local');
  expect(localAtPreview.state.book.title).toBe(fixture.local.title);
  await page.screenshot({path:info.outputPath('use-github-preview.png')});
  await confirm.click();await expect(dialog).not.toBeVisible();
  const saved=await current(page);
  expect(saved.state.book.title).toBe(fixture.remote.title);expect(saved.state.book.sheets).toEqual(fixture.remote.sheets);
  expect(saved.state.book.revision).toBeGreaterThan(fixture.remote.revision);expect(saved.pendingContent).toBe(false);
  expect(saved.state.syncPaused).toBe(true);expect(saved.state.remoteSha).toBe(remoteSha);expect(saved.base).toEqual(fixture.remote);
  expect(saved.originals).toEqual(expect.arrayContaining([fixture.localOriginal,fixture.remoteOriginal]));
  expect(saved.review).toEqual(fixture.review);expect(saved.history.some((entry:{backup?:string})=>!!entry.backup)).toBe(true);
  await expect(page.locator('#save-state')).toContainText('sync paused');
  expect(methods.every(method=>method==='GET')).toBe(true);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
test('browser-to-GitHub replacement uses confirmed SHA, archives displaced copy and acknowledges only after success',async({page},info)=>{
  const state=await setup(page),{dialog,confirm,localAtPreview}=await inspect(page,'github');
  await page.screenshot({path:info.outputPath('replace-github-preview.png')});
  await confirm.click();await expect(dialog).not.toBeVisible();expect(state.puts()).toBe(1);
  const saved=await current(page);
  expect(saved.state.book).toEqual(localAtPreview.state.book);expect(saved.pendingContent).toBe(false);
  expect(saved.state.remoteSha).toBe(nextSha);expect(saved.state.syncPaused).toBe(true);expect(saved.state.syncReview).toBe(false);
  expect(saved.review).toEqual(state.fixture.review);expect(saved.history.filter((entry:{backup?:string})=>!!entry.backup).length).toBeGreaterThanOrEqual(2);
  const uploaded=await page.evaluate(async content=>{
    const {readPrivateWorkbook}=await import(new URL('/src/storage.ts',location.href).href);
    return readPrivateWorkbook({owner:'invented',repo:'private-copy',branch:'main',path:'invented.json'},'invented-readback',async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).includes('/contents/')?{sha:'c'.repeat(40),content}:{private:true,has_pages:false}),{headers:{'Content-Type':'application/json'}}));
  },state.uploadedContent());
  expect(uploaded.book).toEqual(localAtPreview.state.book);
  expect(state.unexpected).toEqual([]);expect(state.errors).toEqual([]);
});
test('changed GitHub SHA refreshes the source without replacing either copy',async({page})=>{
  const state=await setup(page,'moved'),{dialog,confirm,localAtPreview}=await inspect(page,'local');
  await confirm.click();await expect(dialog.getByRole('status')).toContainText('GitHub changed since the preview');
  await expect(dialog.locator('[data-private-preview]')).toContainText(movedSha);
  expect((await current(page)).state.book).toEqual(localAtPreview.state.book);expect(state.puts()).toBe(0);
  await confirm.click();await expect(dialog).not.toBeVisible();expect((await current(page)).state.remoteSha).toBe(movedSha);
});
for(const direction of ['local','github'] as const)test(`cancel ${direction} replacement preserves current data and review`,async({page})=>{
  const state=await setup(page),{dialog,localAtPreview}=await inspect(page,direction);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const saved=await current(page);
  expect(saved.state.book).toEqual(localAtPreview.state.book);expect(saved.state.pending).toEqual(localAtPreview.state.pending);
  expect(saved.review).toEqual(state.fixture.review);expect(state.puts()).toBe(0);
});
for(const scenario of ['cas','missing-ack'] as const)test(`${scenario}: no blind retry or cleared pending after unconfirmed GitHub replacement`,async({page})=>{
  const state=await setup(page,scenario),{dialog,confirm,localAtPreview}=await inspect(page,'github');
  await confirm.click();await expect(dialog.getByRole('status')).toContainText('Check GitHub before retrying');
  await expect(dialog.getByRole('alert')).not.toBeEmpty();expect(state.puts()).toBe(1);
  const saved=await current(page);
  expect(saved.state.book).toEqual(localAtPreview.state.book);expect(saved.state.syncPaused).toBe(true);
  expect(saved.state.pending.map((operation:{id:string})=>operation.id)).toEqual(expect.arrayContaining(state.fixture.before.pending.map((operation:{id:string})=>operation.id)));
  expect(saved.review).toEqual(state.fixture.review);await expect(confirm).toBeDisabled();
});
