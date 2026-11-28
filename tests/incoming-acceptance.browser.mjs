import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

const stage=path.dirname(path.dirname(fileURLToPath(import.meta.url))),root=path.dirname(stage);
const baseline=process.argv.includes('--baseline'),omitSaveFence=process.argv.includes('--omit-save-fence'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const baselinePath=path.join(root,'m28-review-export-proposal','payload','app-connection','current-source','src','app.ts');
const sourcePath=path.join(stage,'src','app.ts'),source=await fs.readFile(baseline?baselinePath:sourcePath,'utf8');
const proof={startedAt:new Date().toISOString(),baseline,omitSaveFence,sourceSha256:hash(source),cases:[],helpersClosed:false,
  scope:'Actual app receiveIncomingSync + native IndexedDB in invented fresh contexts. Test-only appended closures and native fault/delay seams; no production hooks, real profiles, private data, GitHub or app activation.'};
const probe=`
const incomingProbeIds=new WeakMap();let incomingProbeSequence=0;
const incomingProbeId=value=>{if(!incomingProbeIds.has(value))incomingProbeIds.set(value,++incomingProbeSequence);return incomingProbeIds.get(value);};
Reflect.set(window,'__incomingProbe',{
 snapshot:()=>({book:clone(book),state:clone(state),bookId:incomingProbeId(book),engineId:incomingProbeId(engine),engineBookId:incomingProbeId(engine.book),generation,savedGeneration,fullSaveRequired,undo:clone(undo),redo:clone(redo),busy,inert:root.inert,displayedVersion,
  values:[0,1,2].map(c=>engine.cell(book.sheets[0].id,book.sheets[0].rows[0].id,book.sheets[0].columns[c].id)),grid:root.querySelector('tbody')?.textContent,status,error}),
 edit:value=>{const s=book.sheets[0],r=s.rows[0].id,c=s.columns[0].id;return mutateCell(s,r,c,()=>{s.cells[key(r,c)]={value};});},
 action,
 structural:()=>mutate('Invented structural full save',()=>{book.sheets.push(blankSheet('Must not overwrite accepted data'));}),
 lateDirty:()=>changed('Invented late full-save continuation',false,true),
 flush,
 incoming:()=>{const f=Reflect.get(window,'__incomingFixture');Reflect.set(window,'__incomingOutcome',{done:false});void receiveIncomingSync(f.base,f.result(),clone(state.sync),token).then(()=>Reflect.set(window,'__incomingOutcome',{done:true,ok:true}),e=>Reflect.set(window,'__incomingOutcome',{done:true,ok:false,error:String(e),name:e.constructor.name}));},
 selectTable:()=>{selected={r:4,c:0};anchor={...selected};selectionKind='cells';refreshSelection();},
 openLegacyConflict:()=>{const f=Reflect.get(window,'__incomingFixture');openConflict(new SyncConflict(f.remote,'a'.repeat(40)));},
 failNextRender:()=>{const previous=render;render=(...args)=>{render=previous;throw Error('Invented postcommit view failure');};},
 failLockedStatusRender:()=>{const previous=renderStatus;renderStatus=(...args)=>{if(busy){renderStatus=previous;throw Error('Invented precommit status failure');}return previous(...args);};},
});
`;
process.env.VITE_FNT_EXISTING_DATA_ONLY='true';
const server=await createServer({root:stage,cacheDir:path.join(stage,'.vite-incoming-cache'),clearScreen:false,
  plugins:[{name:'isolated-incoming-native-probe',enforce:'pre',transform(code,id){
    if(id.replaceAll('\\','/').split('?')[0]===sourcePath.replaceAll('\\','/')){
      const guard=/^    if\(incomingPublicationFailed\)throw Error\('Autosave is paused[^\n]+\n/m;
      if(omitSaveFence)assert.equal((source.match(guard)??[]).length,1);
      return {code:(omitSaveFence?source.replace(guard,''):source)+'\n'+probe,map:null};
    }
  },configureServer(server){server.middlewares.use('/__incoming-acceptance',(_request,response)=>{
    response.setHeader('content-type','text/html');
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module">import {setup} from "/tests/incoming-acceptance-fixture.ts";await setup();await import("/src/app.ts");</script></body></html>');
  });}}],
  server:{host:'127.0.0.1',port:40000+Math.floor(Math.random()*20000),watch:null,strictPort:true}});
let browser;
const snapshot=page=>page.evaluate(()=>Reflect.get(window,'__incomingProbe').snapshot());
const fixture=(page,method,...args)=>page.evaluate(async({method,args})=>Reflect.get(window,'__incomingFixture')[method](...args),{method,args});
const app=(page,method,...args)=>page.evaluate(async({method,args})=>Reflect.get(window,'__incomingProbe')[method](...args),{method,args});
const settled=async page=>{await page.waitForFunction(()=>Reflect.get(window,'__incomingOutcome')?.done);return page.evaluate(()=>Reflect.get(window,'__incomingOutcome'));};
const noNewCheckpoint=history=>!history.some(entry=>entry.label==='Before incoming sync changes');
async function localHistory(page){
  await app(page,'edit',2);await app(page,'edit',3);await app(page,'action','undo');await app(page,'flush');
  const before=await snapshot(page);assert.deepEqual(before.values,[2,10,12]);assert.equal(before.undo.length,1);assert.equal(before.redo.length,1);return before;
}
async function run(name,fn,{touch=false}={}){
  if(process.argv.includes('--clone-only')&&!name.includes('clone failure'))return;
  const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1280,height:900},hasTouch:touch,isMobile:touch,serviceWorkers:'block'});
  const errors=[],external=[];let page;
  try{
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).origin!==proof.url){external.push(route.request().url());return route.abort();}
      return route.continue();
    });
    page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(proof.url+'/__incoming-acceptance');
    await page.waitForFunction(()=>{const api=Reflect.get(window,'__incomingProbe');try{return !!api?.snapshot().grid;}catch{return false;}},{timeout:20000});
    const evidence=await fn(page);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    proof.cases.push({name,touch,pass:true,evidence});console.log('PASS',name,touch?'touch':'desktop');
  }catch(error){proof.cases.push({name,touch,pass:false,error:String(error),pageErrors:errors,external});throw error;}
  finally{await context.close();}
}
try{
  await server.listen();proof.url=`http://127.0.0.1:${server.httpServer.address().port}`;
  assert.equal((await fetch(proof.url+'/__incoming-acceptance')).status,200);
  browser=await chromium.launch({headless:true});
  for(const touch of [false,true])await run('Rejected native transaction preserves volatile and durable state',async page=>{
    const before=await localHistory(page),durable=await fixture(page,'durable');
    await fixture(page,'control','reject');await app(page,'incoming');
    const outcome=await settled(page);assert.equal(outcome.ok,false);assert.match(outcome.error,/checkpoint write failed/);
    const after=await snapshot(page);
    for(const field of ['book','state','bookId','engineId','engineBookId','generation','savedGeneration','fullSaveRequired','undo','redo','displayedVersion','values','grid'])assert.deepEqual(after[field],before[field],field);
    assert.equal(after.busy,false);assert.equal(after.inert,false);assert.equal(after.generation,after.savedGeneration);
    assert.deepEqual(await fixture(page,'durable'),durable);assert.ok(noNewCheckpoint(await fixture(page,'history')));
    await fixture(page,'control','');await app(page,'action','redo');assert.deepEqual((await snapshot(page)).values,[3,10,13]);
  },{touch});
  await run('Delayed durable acceptance locks editing and publishes only committed data',async page=>{
    const before=await localHistory(page);
    await fixture(page,'control','delay');await app(page,'incoming');
    await page.waitForFunction(()=>Reflect.get(window,'__incomingFixture').counts().acceptCalls===1);
    const waiting=await snapshot(page);assert.equal(waiting.busy,true);assert.equal(waiting.inert,true);
    for(const field of ['book','bookId','engineId','generation','savedGeneration','undo','redo','grid'])assert.deepEqual(waiting[field],before[field],field);
    await page.locator('#formula').isDisabled().then(disabled=>assert.equal(disabled,true));
    assert.equal(await app(page,'edit',99),false);assert.deepEqual((await snapshot(page)).values,[2,10,12]);
    await fixture(page,'release');const outcome=await settled(page);assert.equal(outcome.ok,true,JSON.stringify(outcome));
    let after=await snapshot(page);assert.deepEqual(after.values,[2,20,22]);assert.notEqual(after.engineId,before.engineId);
    assert.equal(after.engineBookId,after.bookId);assert.equal(after.busy,false);assert.equal(after.inert,false);
    assert.equal(after.generation,after.savedGeneration);assert.deepEqual(after.book,(await fixture(page,'durable')).book);
    const history=await fixture(page,'history'),checkpoint=history.find(entry=>entry.label==='Before incoming sync changes');
    assert.deepEqual(checkpoint.book,before.book);
    assert.equal(after.state.remoteSha,'b'.repeat(40));assert.deepEqual(after.state.pending,before.state.pending);
    assert.deepEqual(await fixture(page,'syncBase'),await page.evaluate(()=>Reflect.get(window,'__incomingFixture').remote));
    assert.equal(await fixture(page,'syncBase','a'.repeat(40)),undefined);
    assert.deepEqual(await fixture(page,'undo'),{undo:after.undo,redo:after.redo});
    await app(page,'action','undo');assert.deepEqual((await snapshot(page)).values,[1,20,21]);
    await app(page,'action','redo');assert.deepEqual((await snapshot(page)).values,[2,20,22]);
    await app(page,'edit',8);await app(page,'flush');after=await snapshot(page);
    assert.deepEqual(after.values,[8,20,28]);assert.deepEqual(after.book,(await fixture(page,'durable')).book);
  });
  await run('Edit during actual worker merge retries and is not lost',async page=>{
    await localHistory(page);await fixture(page,'control','merge-edit');await app(page,'incoming');assert.equal((await settled(page)).ok,true);
    assert.ok((await fixture(page,'counts')).mergeCalls>=2);const after=await snapshot(page);
    assert.deepEqual(after.values,[7,20,27]);assert.equal(after.generation,after.savedGeneration);assert.deepEqual(after.book,(await fixture(page,'durable')).book);
  });
  await run('Already-running navigation callback drains before commit',async page=>{
    await fixture(page,'control','visit');await app(page,'selectTable');
    await page.waitForFunction(()=>Reflect.get(window,'__incomingFixture').counts().visitCalls===1);
    await app(page,'incoming');await page.waitForTimeout(250);
    assert.equal((await fixture(page,'counts')).acceptCalls,0);
    await fixture(page,'release');assert.equal((await settled(page)).ok,true);
    const after=await snapshot(page),table=await page.evaluate(()=>Reflect.get(window,'__incomingFixture').table);
    assert.equal(after.book.tableActivity[table].visits,1);assert.deepEqual(after.book,(await fixture(page,'durable')).book);
  });
  await run('Returned durable device preferences are published',async page=>{
    await fixture(page,'control','delay');await app(page,'incoming');
    await page.waitForFunction(()=>Reflect.get(window,'__incomingFixture').counts().acceptCalls===1);
    await fixture(page,'externalVisit');await fixture(page,'release');assert.equal((await settled(page)).ok,true);
    const after=await snapshot(page),table=await page.evaluate(()=>Reflect.get(window,'__incomingFixture').table);
    assert.equal(after.book.tableActivity[table].visits,41);assert.deepEqual(after.book,(await fixture(page,'durable')).book);
  });
  await run('Concurrent durable version and destination change is refused',async page=>{
    const before=await snapshot(page);await fixture(page,'control','delay');await app(page,'incoming');
    await page.waitForFunction(()=>Reflect.get(window,'__incomingFixture').counts().acceptCalls===1);
    await fixture(page,'externalChange');await fixture(page,'release');
    const outcome=await settled(page);assert.equal(outcome.ok,false);assert.match(outcome.error,/Another tab changed/);
    const after=await snapshot(page);
    for(const field of ['book','bookId','engineId','generation','savedGeneration','undo','redo','grid'])assert.deepEqual(after[field],before[field],field);
    assert.ok(noNewCheckpoint(await fixture(page,'history')));
    assert.equal((await fixture(page,'durable')).sync.path,'other-invented.json');
  });
  await run('Whole-copy conflict action pauses incoming acceptance and preserves edits for retry',async page=>{
    await localHistory(page);const before=await snapshot(page),durable=await fixture(page,'durable');
    await app(page,'openLegacyConflict');
    await page.getByText('Choose a whole copy instead',{exact:true}).click();
    await page.locator('#keep-local').click();
    await page.getByRole('heading',{name:'Replace GitHub with this copy',exact:true}).waitFor();
    await app(page,'incoming');const outcome=await settled(page);
    assert.equal(outcome.ok,false);assert.match(outcome.error,/Incoming sync paused/);
    assert.equal((await fixture(page,'counts')).acceptCalls,0);
    const retained=await snapshot(page);
    for(const field of ['book','generation','savedGeneration','undo','redo','values'])assert.deepEqual(retained[field],before[field],field);
    assert.deepEqual(await fixture(page,'durable'),durable);
    await page.locator('dialog[open] [data-cancel]').click();
    await page.waitForFunction(()=>!Reflect.get(window,'__incomingProbe').snapshot().busy);
    await app(page,'incoming');const retry=await settled(page);assert.equal(retry.ok,true,JSON.stringify(retry));
    await page.waitForFunction(()=>{const s=Reflect.get(window,'__incomingProbe').snapshot();return s.generation===s.savedGeneration;});
    const after=await snapshot(page);assert.deepEqual(after.values,[2,20,22]);
    assert.deepEqual(after.book,(await fixture(page,'durable')).book);
    return {firstOutcome:outcome,wholeCopyPauseAndRetryRetained:true,qualification:'Accepted replacement-v2 removed the old asynchronous keep-local metadata continuation; this exercises its actual guarded shared-dialog successor rather than resurrecting the deleted path.'};
  });
  await run('Postcommit render failure retains the accepted durable version',async page=>{
    const before=await snapshot(page);await app(page,'failNextRender');await app(page,'incoming');const outcome=await settled(page);
    assert.equal(outcome.ok,false);assert.equal(outcome.name,'IncomingSyncViewError');assert.match(outcome.error,/saved locally.*not rolled back/);
    const after=await snapshot(page),durable=await fixture(page,'durable');assert.ok(after.state.version>before.state.version);
    assert.deepEqual(after.values,[1,20,21]);assert.deepEqual(after.book,durable.book);assert.equal(after.state.version,durable.version);
    assert.equal(after.generation,after.savedGeneration);assert.equal(after.busy,true);assert.equal(after.inert,true);
    assert.ok(!noNewCheckpoint(await fixture(page,'history')));
    assert.equal(await app(page,'structural'),false);await app(page,'flush');
    assert.deepEqual((await fixture(page,'durable')).book,durable.book);
  });
  await run('Precommit status failure always releases the edit lock',async page=>{
    const before=await snapshot(page);await app(page,'failLockedStatusRender');await app(page,'incoming');
    const outcome=await settled(page);assert.equal(outcome.ok,false);assert.match(outcome.error,/precommit status failure/);
    assert.equal((await fixture(page,'counts')).acceptCalls,0);
    const after=await snapshot(page);
    for(const field of ['book','state','bookId','engineId','generation','savedGeneration','undo','redo','grid'])assert.deepEqual(after[field],before[field],field);
    assert.equal(after.busy,false);assert.equal(after.inert,false);assert.ok(noNewCheckpoint(await fixture(page,'history')));
    assert.equal(await app(page,'edit',6),true);
  });
  await run('Accepted publication clone failure is classified as postcommit',async page=>{
    const before=await snapshot(page);await fixture(page,'control','clone-fail');await app(page,'incoming');
    const outcome=await settled(page);assert.equal(outcome.ok,false);assert.equal(outcome.name,'IncomingSyncViewError');
    await fixture(page,'control','');
    const after=await snapshot(page),durable=await fixture(page,'durable');assert.ok(after.state.version>before.state.version);
    assert.equal(after.state.version,durable.version);assert.deepEqual(after.state.book,durable.book);
    assert.match(after.status,/Incoming updates saved locally.*editing and autosave paused/);
    assert.deepEqual(after.book,before.book);assert.equal(after.busy,true);assert.equal(after.inert,true);
    assert.ok(!noNewCheckpoint(await fixture(page,'history')));
    assert.equal(await app(page,'structural'),false);assert.equal(await app(page,'edit',77),false);
    await app(page,'lateDirty');const dirty=await snapshot(page);
    assert.ok(dirty.generation>dirty.savedGeneration);assert.equal(dirty.fullSaveRequired,true);
    await app(page,'flush');assert.deepEqual((await fixture(page,'durable')).book,durable.book);
    const fenced=await snapshot(page);assert.equal(fenced.savedGeneration,dirty.savedGeneration);
    assert.ok(fenced.generation>fenced.savedGeneration);assert.equal(fenced.fullSaveRequired,true);
  });
}catch(error){proof.error=String(error);process.exitCode=1;console.error(error);}
finally{
  await browser?.close();await server.close();proof.helpersClosed=true;proof.finishedAt=new Date().toISOString();
  proof.sourceStillExact=hash(await fs.readFile(baseline?baselinePath:sourcePath,'utf8'))===proof.sourceSha256;
  if(!proof.sourceStillExact)process.exitCode=1;
  const receipt=path.join(root,`m30-incoming-native-${baseline?'baseline':omitSaveFence?'fence-knockout':'candidate'}-${Date.now()}.json`);
  await fs.writeFile(receipt,JSON.stringify(proof,null,2));console.log(receipt);
}
