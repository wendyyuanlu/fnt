import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

if(process.env.FNT_LIVE_SYNC!=='1')throw Error('This writes SYNTHETIC test data to the approved private wendyyuanlu/fnt-data repository. Set FNT_LIVE_SYNC=1 only with explicit authorization.');
const gh=process.env.FNT_GH_PATH??join(homedir(),'AppData','Local','copilot-desktop-gh-2.103.3','gh.exe');
const env={...process.env};
for(const name of Object.keys(env))if(['GH_TOKEN','GITHUB_TOKEN','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS'].includes(name.toUpperCase()))delete env[name];
let token;
try{token=execFileSync(gh,['auth','token','--hostname','github.com','--user','wendyyuanlu'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
catch{throw Error('Personal wendyyuanlu keyring authentication unavailable. No alternate account or token was used.');}
const root='https://api.github.com/repos/wendyyuanlu/fnt-data';
const path=`integration-tests/live-${randomUUID()}.json`;
const fileUrl=`${root}/contents/${path}?ref=main`;
const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const allowedBooks=new Set(),clients=[],results=[];
let browser,created=false,phase='verify personal account',writes=0,cleanup='not needed',credentialIsolationVerified=false;
const api=(url,init={})=>fetch(url,{...init,headers:{...headers,...init.headers},redirect:'error',signal:AbortSignal.timeout(20000)});
const check=async(label,fn)=>{phase=label;await fn();results.push(label);};
const durable=page=>page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('fnt-workbook-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Cannot open test storage'));});
  try{return await new Promise((resolve,reject)=>{const request=db.transaction('state').objectStore('state').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Cannot read test storage'));});}
  finally{db.close();}
});
const history=page=>page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('fnt-workbook-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Cannot open test recovery'));});
  try{return await new Promise((resolve,reject)=>{const request=db.transaction('history').objectStore('history').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Cannot read test recovery'));});}
  finally{db.close();}
});
const grams=book=>book.sheets[0].cells[`${book.sheets[0].rows[1].id}:${book.sheets[0].columns[2].id}`].value;
const pendingIds=state=>state.pending.map(p=>p.id).sort();
const waitFor=async(page,test,label)=>{
  for(let i=0;i<120;i++){if(await test())return;await page.waitForTimeout(100);}
  throw Error(`Timed out: ${label}`);
};
const saved=async page=>waitFor(page,async()=>/Saved|Synced/.test(await page.locator('#save-state').textContent()),'durable local save');
const synced=async page=>waitFor(page,async()=>await page.locator('#save-state').textContent()==='Synced with private repository','acknowledged private sync');
const save=async page=>page.getByRole('button',{name:/^Save( workbook)?$/,exact:false}).click();
async function edit(page,value){
  await page.locator('td[data-r="1"][data-c="2"]').click();await page.locator('#formula').fill(String(value));
  await page.getByRole('button',{name:'Apply',exact:true}).click();await saved(page);
}
async function connect(page){
  if(!await page.locator('#sync-form').count()){
    await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
    await page.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  }
  for(const [id,value] of [['owner','wendyyuanlu'],['repo','fnt-data'],['branch','main'],['path',path],['token','bounded-authenticated-test-transport']])await page.locator(`#sync-${id}`).fill(value);
  await page.getByRole('button',{name:'Connect & sync now',exact:true}).click();
}
function validateUpload(body){
  const upload=JSON.parse(body);
  assert.equal(upload.branch,'main');assert.equal(typeof upload.content,'string');
  const envelope=JSON.parse(Buffer.from(upload.content,'base64').toString());
  assert.equal(envelope.format,'fnt-sync-v2');
  const packed=JSON.parse(gunzipSync(Buffer.from(envelope.payload,'base64')).toString());
  assert.equal(packed.format,'fnt-packed-v1');
  assert.equal(packed.data.format,'fnt-sync-v1');
  assert(allowedBooks.has(packed.data.book.id),'Upload is not an isolated synthetic workbook');
  assert(packed.data.book.title.startsWith('Fnt live sync test'));
  assert.equal(packed.data.book.importReport,undefined,'Original workbook upload forbidden');
  assert.deepEqual(packed.data.originals,[],'Original packages upload forbidden');
}
async function client(mobile=false){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1365,height:900},isMobile:mobile,hasTouch:mobile});
  const control={context,offline:false,lostAck:false,gate:undefined,putStatuses:[],puts:0};
  clients.push(control);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname==='127.0.0.1'){await route.continue();return;}
    if(url.origin!=='https://api.github.com'||url.href!==root&&url.href!==fileUrl){await route.abort('blockedbyclient');return;}
    if(control.offline){await route.abort('internetdisconnected');return;}
    if(request.method()==='OPTIONS'){
      await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:4173','Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Accept, X-GitHub-Api-Version, Content-Type'}});
      return;
    }
    try{
      if(request.method()==='PUT'){
        validateUpload(request.postData());control.puts++;
        if(control.gate){const gate=control.gate;control.gate=undefined;gate.entered();await gate.released;}
      }else assert.equal(request.method(),'GET');
      const response=await api(url.href,{method:request.method(),...(request.method()==='PUT'?{body:request.postData(),headers:{'Content-Type':'application/json'}}:{})});
      const body=await response.text();
      if(request.method()==='PUT'){
        control.putStatuses.push(response.status);
        if(response.ok){created=true;writes++;}
        if(control.lostAck&&response.ok){control.lostAck=false;await route.abort('failed');return;}
      }
      await route.fulfill({status:response.status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'http://127.0.0.1:4173','Cache-Control':'no-store'},body});
    }catch{
      await route.abort('failed');
      throw Error('Bounded GitHub transport failed; no request body or credential logged.');
    }
  });
  const page=await context.newPage();control.page=page;
  await page.goto('http://127.0.0.1:4173');await page.locator('table[role="grid"]').waitFor();await saved(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await page.locator('table[role="grid"]').waitFor();
  await waitFor(page,()=>page.evaluate(()=>!!navigator.serviceWorker.controller),'offline shell installation');
  await page.locator('#title').click();await page.locator('#answer').fill(`Fnt live sync test - ${mobile?'mobile B':'desktop A'}`);
  await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();await saved(page);
  const initial=await durable(page);
  assert.equal(initial.book.importReport,undefined);assert.equal(initial.book.sheets.length,4);
  assert.equal(grams(initial.book),180);allowedBooks.add(initial.book.id);
  return control;
}
try{
  const account=await api('https://api.github.com/user');assert(account.ok);assert.equal((await account.json()).login,'wendyyuanlu');
  const repo=await api(root);assert(repo.ok);const info=await repo.json();assert.equal(info.private,true);assert.equal(info.has_pages,false);assert.equal(info.default_branch,'main');
  const branch=await api(`${root}/branches/main`);assert(branch.ok);
  results.push('verified personal account, private repository, main branch and no Pages');
  browser=await chromium.launch();
  const a=await client(),b=await client(true),A=a.page,B=b.page;
  await check('online authenticated initial write and independently initialized mobile client download',async()=>{
    await connect(A);await synced(A);
    const first=await durable(A);assert.equal(first.pending.length,0);
    await connect(B);await B.locator('#use-remote').waitFor();
    const seed=await durable(B);assert(seed.pending.length>0);
    const recovery=await history(B);assert(recovery.some(c=>c.label==='Local conflict - not uploaded'));assert(recovery.some(c=>c.label==='Remote conflict - not applied'));
    await B.locator('#use-remote').click();
    await waitFor(B,async()=>(await durable(B)).pending.length===0,'explicit remote choice');
    assert.equal((await durable(B)).book.id,first.book.id);
    await A.reload();await A.locator('table[role="grid"]').waitFor();assert.equal((await durable(A)).remoteSha,first.remoteSha);
    await save(A);await A.locator('#sync-form').waitFor();assert.equal(await A.locator('#sync-token').inputValue(),'');
    await connect(A);await synced(A);
  });
  await check('online edit/read with durable acknowledgment and exact operation journal',async()=>{
    await edit(A,100);const before=await durable(A);assert(before.pending.length>0);
    await save(A);await synced(A);assert.equal((await durable(A)).pending.length,0);
    await save(B);await synced(B);assert.equal(grams((await durable(B)).book),100);
  });
  await check('offline divergence and production offline reload preserve both clients pending edits',async()=>{
    a.offline=b.offline=true;await a.context.setOffline(true);await b.context.setOffline(true);
    await edit(A,120);await edit(B,200);
    const pa=pendingIds(await durable(A)),pb=pendingIds(await durable(B));assert(pa.length&&pb.length);
    const before=a.puts+b.puts;await save(A);await waitFor(A,async()=>await A.locator('#save-state').textContent()==='Sync failed - local copy retained','offline failure');
    assert.equal(a.puts+b.puts,before);assert.deepEqual(pendingIds(await durable(A)),pa);
    await B.reload();await B.locator('table[role="grid"]').waitFor();assert.equal(grams((await durable(B)).book),200);assert.deepEqual(pendingIds(await durable(B)),pb);
    await a.context.setOffline(false);await b.context.setOffline(false);a.offline=b.offline=false;
    await save(A);await synced(A);
    await save(B);await B.locator('#sync-form').waitFor();assert.equal(await B.locator('#sync-token').inputValue(),'');await connect(B);
    await B.locator('#use-remote').waitFor();assert.deepEqual(pendingIds(await durable(B)),pb);
    const copies=await history(B);
    assert(copies.some(c=>c.label==='Local conflict - not uploaded'&&grams(c.book)===200));
    assert(copies.some(c=>c.label==='Remote conflict - not applied'&&grams(c.book)===120));
    await B.locator('#keep-local').click();await B.locator('#confirm').click();await synced(B);
    await save(A);await synced(A);assert.equal(grams((await durable(A)).book),200);
  });
  await check('real stale GitHub CAS rejects the losing PUT and preserves its pending edits',async()=>{
    await edit(A,140);const pending=pendingIds(await durable(A));
    let entered,release;const enteredPromise=new Promise(resolve=>{entered=resolve;}),released=new Promise(resolve=>{release=resolve;});
    a.gate={entered,released,release};
    await save(A);await Promise.race([enteredPromise,new Promise((_,reject)=>setTimeout(()=>reject(Error('CAS gate timeout')),20000))]);
    assert(await A.locator('#formula').isDisabled(),'Editing must pause while the source revision is syncing');
    try{await edit(B,160);await save(B);await synced(B);}finally{release();}
    await waitFor(A,async()=>await A.locator('#save-state').textContent()==='Sync failed - local copy retained','stale CAS failure');
    assert(!await A.locator('#formula').isDisabled(),'Editing must resume after a failed sync');
    assert([409,422].includes(a.putStatuses.at(-1)));
    assert.deepEqual(pendingIds(await durable(A)),pending);assert.equal(grams((await durable(A)).book),140);
    await save(A);await A.locator('#use-remote').waitFor();
    const copies=await history(A);assert(copies.some(c=>c.label==='Local conflict - not uploaded'&&grams(c.book)===140));
    await A.locator('#use-remote').click();await waitFor(A,async()=>(await durable(A)).pending.length===0,'explicit stale-version recovery');
    assert.equal(grams((await durable(A)).book),160);
  });
  await check('lost real upload acknowledgment retries idempotently without another GitHub commit',async()=>{
    await edit(A,180);const ids=pendingIds(await durable(A));a.lostAck=true;
    await save(A);await waitFor(A,async()=>await A.locator('#save-state').textContent()==='Sync failed - local copy retained','lost acknowledgment');
    assert.deepEqual(pendingIds(await durable(A)),ids);
    const commits=writes,puts=a.puts;await save(A);await synced(A);
    assert.equal(writes,commits);assert.equal(a.puts,puts);assert.equal((await durable(A)).pending.length,0);
    await save(B);await synced(B);assert.equal(grams((await durable(B)).book),180);
  });
  await check('same-origin second-tab edit during acknowledgment is not cleared or silently lost',async()=>{
    await edit(A,190);
    let entered,release;const enteredPromise=new Promise(resolve=>{entered=resolve;}),released=new Promise(resolve=>{release=resolve;});
    a.gate={entered,released,release};
    await save(A);await Promise.race([enteredPromise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Local race gate timeout')),20000))]);
    const tab=await a.context.newPage();
    try{
      await tab.goto('http://127.0.0.1:4173');await tab.locator('table[role="grid"]').waitFor();await edit(tab,210);
      const current=await durable(tab);assert(current.pending.length>=2);release();
      await waitFor(A,async()=>/Workbook changed during this operation/.test(await A.locator('#error').textContent()),'local version guard');
      assert.deepEqual(pendingIds(await durable(A)),pendingIds(current));assert.equal(grams((await durable(A)).book),210);
    }finally{release();await tab.close();}
    await A.reload();await A.locator('table[role="grid"]').waitFor();await save(A);await A.locator('#sync-form').waitFor();await connect(A);
    await A.locator('#keep-local').waitFor();await A.locator('#keep-local').click();await A.locator('#confirm').click();await synced(A);
    await save(B);await synced(B);assert.equal(grams((await durable(B)).book),210);
  });
  await check('no credential is persisted in either isolated client workbook or recovery records',async()=>{
    for(const page of [A,B]){
      const records=JSON.stringify([await durable(page),await history(page)]);
      assert(!records.includes(token));assert(!records.includes('bounded-authenticated-test-transport'));
    }
    credentialIsolationVerified=true;
  });
}catch{
  process.exitCode=1;
  console.error(`Live sync validation failed in phase: ${phase}. Credentials and response bodies omitted.`);
}finally{
  for(const c of clients)c.gate?.release();
  if(browser)await browser.close();
  if(created){
    try{
      const current=await api(fileUrl);assert(current.ok);const file=await current.json();
      const deletion=await api(`${root}/contents/${path}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Fnt: remove synthetic integration test file',branch:'main',sha:file.sha})});
      assert(deletion.ok);cleanup='only unique synthetic test file removed; synthetic commit history retained';
    }catch{cleanup='synthetic test file retained; cleanup failed';process.exitCode=1;}
  }
  token='';
  console.log(JSON.stringify({passed:results,syntheticUploads:writes,putStatuses:clients.flatMap(c=>c.putStatuses),cleanup,personalDataUploaded:false,credentialIsolationVerified,physicalDeviceAuthorizationVerified:false}));
}
