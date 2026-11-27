import {test,expect,type Page,type BrowserContext,type Route} from '@playwright/test';
import {blankSheet,clone,key,uid,type Workbook} from '../../src/model';
import {encode64,type LocalState} from '../../src/storage';
import {syncCodec} from '../../src/sync-codec';
import {sameSharedWorkbook} from '../../src/sync-merge';
import {structuralUndo} from '../../src/undo-history';

const config={owner:'example',repo:'private',branch:'main',path:'coauthoring.json'};
class ControlledGitHub{
  book:Workbook;sha='baseline';operations:string[]=[];writes=0;attempts=0;races=0;raceRow=3;fail=false;loseAcknowledgement=false;
  holdRead=false;holdWrite=false;started=false;release?:()=>void;
  changes:unknown[]=[];
  constructor(){
    const sheet=blankSheet('Coauthoring fixture',40,5);
    this.book={schema:1,id:uid(),title:'Synthetic coauthoring',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{},dropdownData:{sheets:[],tables:[]}};
    const table={id:uid(),name:'InventedValues',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1,8).map(row=>row.id),columns:sheet.columns.slice(0,3).map((column,i)=>({id:uid(),column:column.id,name:['Value','Other','Notes'][i]}))};
    this.book.tables=[table];
    for(const field of table.columns)sheet.cells[key(table.header,field.column)]={value:field.name};
    sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:1};
    sheet.cells[key(sheet.rows[1].id,sheet.columns[1].id)]={value:10};
  }
  edit(r:number,c:number,value:number){
    const sheet=this.book.sheets[0];sheet.cells[key(sheet.rows[r].id,sheet.columns[c].id)]={value};
    this.sha=`external-${++this.writes}`;
  }
  attach(context:BrowserContext){return context.route('https://api.github.com/**',route=>this.route(route));}
  private async route(route:Route){
    if(this.fail){await route.fulfill({status:503,json:{message:'Controlled failure'}});return;}
    if(!route.request().url().includes('/contents/')){await route.fulfill({json:{private:true,has_pages:false}});return;}
    if(route.request().method()==='PUT'){
      const request=route.request().postDataJSON() as {sha?:string;content:string};this.attempts++;
      if(this.holdWrite){this.started=true;await new Promise<void>(resolve=>this.release=resolve);this.holdWrite=false;}
      if(this.races-->0)this.edit(this.raceRow,2,900+this.attempts);
      if(request.sha!==this.sha){await route.fulfill({status:409,json:{message:'CAS race'}});return;}
      const envelope=syncCodec({kind:'unpack',value:request.content}) as {book:Workbook;operations:string[]};
      this.changes.push(structuralUndo(envelope.book,this.book));
      this.book=envelope.book;this.operations=envelope.operations;this.sha=`saved-${++this.writes}`;
      if(this.loseAcknowledgement){this.loseAcknowledgement=false;await route.abort();return;}
      await route.fulfill({json:{content:{sha:this.sha}}});return;
    }
    const response={sha:this.sha,content:encode64(JSON.stringify({format:'fnt-sync-v1',book:this.book,operations:this.operations})),encoding:'base64'};
    if(this.holdRead){this.started=true;await new Promise<void>(resolve=>this.release=resolve);this.holdRead=false;}
    await route.fulfill({json:response});
  }
}
async function local(page:Page):Promise<LocalState>{
  return page.evaluate(async()=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!;}finally{store.close();}
  });
}
  test('large-workbook three-way merging and long cell history stay responsive without per-keystroke snapshots',async({page})=>{
    await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
    const result=await page.evaluate(async()=>{
      const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts');
      const {syncGitHub,encode64}=await load('storage') as typeof import('../../src/storage'),{runSyncCodec}=await load('sync-processing') as typeof import('../../src/sync-processing'),{blankSheet,key}=await load('model') as typeof import('../../src/model');
      const sheet=blankSheet('Synthetic large sync',10000,9),base:Workbook={schema:1,id:'large-sync',title:'Synthetic only',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
      for(let r=0;r<10000;r++)for(let c=0;c<9;c++)sheet.cells[key(sheet.rows[r].id,sheet.columns[c].id)]={value:r*9+c};
      const local=structuredClone(base),remote=structuredClone(base),first=key(sheet.rows[1].id,sheet.columns[0].id),last=key(sheet.rows[9999].id,sheet.columns[8].id);
      local.sheets[0].cells[first]={value:500};remote.sheets[0].cells[last]={value:-1};
      const history={undo:Array.from({length:500},(_,i)=>({cells:[{sheet:sheet.id,key:first,value:{value:i}}]})),redo:[]};
      const content=encode64(JSON.stringify({format:'fnt-sync-v1',book:remote,operations:[]}));
      const fetcher:typeof fetch=async(input,init)=>{
        await new Promise(resolve=>setTimeout(resolve,0));
        return Response.json(init?.method==='PUT'?{content:{sha:'confirmed'}}:String(input).includes('/contents/')?{sha:'other-device',content}:{private:true,has_pages:false});
      };
      const state:LocalState={book:local,version:1,updated:'',pending:[{id:'large-local',label:'Edit',time:''}],sync:{owner:'example',repo:'private',branch:'main',path:'large.json'},remoteSha:'base'};
      let previous=performance.now(),gap=0,frames=0,running=true;
      const frame=(now:number)=>{gap=Math.max(gap,now-previous);previous=now;frames++;if(running)requestAnimationFrame(frame);};
      await new Promise<void>(resolve=>requestAnimationFrame(()=>{previous=performance.now();requestAnimationFrame(frame);resolve();}));
      const start=performance.now(),result=await syncGitHub(state,'invented',fetcher,[],{base}),merged=result.remote!;
      const rebased=await runSyncCodec({kind:'history',before:local,after:merged,history},{snapshots:true}) as typeof history;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));running=false;
      return{duration:performance.now()-start,gap,frames,acknowledged:result.acknowledged,first:merged.sheets[0].cells[first].value,last:merged.sheets[0].cells[last].value,history:rebased.undo.length};
    });
    console.info('Coauthoring performance',test.info().project.name,result);
    test.info().annotations.push({type:'coauthoring-performance',description:JSON.stringify(result)});
    expect(result.acknowledged).toEqual(['large-local']);expect(result.first).toBe(500);expect(result.last).toBe(-1);expect(result.history).toBe(500);
    expect(result.frames).toBeGreaterThan(4);expect(result.gap).toBeLessThan(250);expect(result.duration).toBeLessThan(15000);
  });
async function install(page:Page,endpoint:ControlledGitHub){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async({book,config,sha})=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const previous=(await store.load())!;book.catalogMigrations=previous.book.catalogMigrations;
      const saved=await store.save(book,previous.version,'Synthetic independent device');
      const connected=await store.metadata(saved.version,state=>({...state,sync:config,remoteSha:sha,pending:[]}));
      await store.syncMetadata(connected.version,{sha,confirmed:book});
      await store.rememberSyncToken(config,'invented-synthetic-token');
    }finally{store.close();}
  },{book:clone(endpoint.book),config,sha:endpoint.sha});
  // Both devices receive the exact same migration history, not fresh identities.
  endpoint.book.catalogMigrations=(await local(page)).book.catalogMigrations;
  await page.reload();await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
  await local(page);
  await page.evaluate(async()=>{const module='/src/model.ts';await import(/* @vite-ignore */module);});
}
async function edit(page:Page,r:number,c:number,value:string,mobile:boolean){
  await page.bringToFront();await page.locator(`td[data-r="${r}"][data-c="${c}"]`).click();
  if(mobile){await page.locator('#formula').fill(value);await page.locator('#formula').press('Enter');}
  else{await page.keyboard.press('F2');const input=page.getByRole('textbox',{name:'Edit selected cell',exact:true});await input.fill(value);await input.press('Enter');}
  await expect(page.locator('#save-state')).toContainText('Saved locally');
}
const value=(state:LocalState,r=1,c=0)=>{const s=state.book.sheets[0];return s.cells[key(s.rows[r].id,s.columns[c].id)]?.value;};
const pending=(state:LocalState)=>state.pending.filter(operation=>operation.label!=='Visit table');
async function sync(page:Page){await page.bringToFront();await page.locator('[data-action="save"]').click();}
async function mutateSaved(page:Page,kind:'group'|'delete',label:string){
  await page.evaluate(async({kind,label})=>{
    const prefix='/src/',{Store}=await import(/* @vite-ignore */prefix+'storage.ts') as typeof import('../../src/storage'),{deleteRows}=await import(/* @vite-ignore */prefix+'model.ts') as typeof import('../../src/model'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0];
      if(kind==='delete')deleteRows(state.book,s,[s.rows[1].id]);
      else{
        s.groups.push({id:`group-${label}`,axis:'row',members:s.rows.slice(2,4).map(row=>row.id),label,collapsed:false});
        state.book.toolbarOrder=label==='Phone'?['action:bold','action:italic']:['action:italic','action:bold'];
        state.book.toolbarDividers=[label==='Phone'?'action:bold':'action:italic'];
      }
      await store.save(state.book,state.version,`Synthetic ${label}`,false,undefined,{pauseSync:true});
    }finally{store.close();}
  },{kind,label});
  await page.context().setOffline(false);await page.reload();await expect(page.locator('#save-state')).toContainText('Saved locally');
  await local(page);
  await page.context().setOffline(true);
}
test.describe('independent device coauthoring',()=>{
  let endpoint:ControlledGitHub,other:BrowserContext,computer:Page;
  test.beforeEach(async({page,browser,isMobile})=>{
    endpoint=new ControlledGitHub();
    other=await browser.newContext({viewport:{width:1365,height:900},isMobile:false,hasTouch:false});
    computer=await other.newPage();await endpoint.attach(page.context());await endpoint.attach(other);
    await install(page,endpoint);await install(computer,endpoint);await page.bringToFront();
  });
  test.afterEach(async({page})=>{endpoint.release?.();await page.context().setOffline(false);await other.close();});
  test('a phone row and its value appear automatically on the other device without comparison or duplication',async({page,isMobile})=>{
    await page.locator('[data-row-select="1"]').hover();await page.locator('[data-insert-row="2"]').first().click({force:true});
    await edit(page,2,0,'501',isMobile);
    await expect.poll(async()=>pending(await local(page)).length).toBe(0);
    await computer.bringToFront();
    await expect.poll(async()=>(await local(computer)).book.sheets[0].rows.length,{timeout:15000}).toBe(41);
    await expect(computer.locator('td[data-r="2"][data-c="0"]')).toHaveText('501');
    expect(sameSharedWorkbook((await local(computer)).book,endpoint.book)).toBe(true);
    await expect(computer.locator('#sync-review')).toBeHidden();
    await computer.reload();await expect(computer.locator('#save-state')).toContainText('Synced');
    expect((await local(computer)).book.sheets[0].rows).toHaveLength(41);
  });
  test('offline disjoint edits converge after reconnect, including a real CAS upload race',async({page,isMobile})=>{
    await page.context().setOffline(true);await other.setOffline(true);
    await edit(page,1,0,'2',isMobile);await edit(computer,1,1,'30',false);
    endpoint.races=1;
    await page.context().setOffline(false);await sync(page);
    await expect.poll(async()=>pending(await local(page)).length).toBe(0);
    await other.setOffline(false);await sync(computer);
    await expect.poll(async()=>pending(await local(computer)).length).toBe(0);
    await page.bringToFront();
    await expect.poll(async()=>value(await local(page),1,1),{timeout:15000}).toBe(30);
    expect(value(await local(computer))).toBe(2);expect(value(await local(page),3,2)).toBe(901);
    expect(sameSharedWorkbook((await local(computer)).book,endpoint.book)).toBe(true);
    await expect(page.locator('#sync-review')).toBeHidden();await expect(computer.locator('#sync-review')).toBeHidden();
  });
  test('same-value concurrent edits acknowledge both devices without a duplicate commit',async({page,isMobile})=>{
    await page.context().setOffline(true);await other.setOffline(true);
    await edit(page,1,0,'2',isMobile);await edit(computer,1,0,'2',false);
    await page.context().setOffline(false);await sync(page);await expect.poll(async()=>pending(await local(page)).length).toBe(0);
    await other.setOffline(false);await sync(computer);await expect.poll(async()=>pending(await local(computer)).length).toBe(0);
    expect(endpoint.writes,JSON.stringify(endpoint.changes)).toBe(1);expect(value(await local(computer))).toBe(2);
    await expect(computer.locator('#sync-review')).toBeHidden();
  });
  test('compatible offline groups merge while each device retains its own toolbar layout',async({page})=>{
    await page.context().setOffline(true);await other.setOffline(true);
    await mutateSaved(page,'group','Phone');await mutateSaved(computer,'group','Computer');
    const phoneOrder=(await local(page)).book.toolbarOrder,computerOrder=(await local(computer)).book.toolbarOrder;
    await page.context().setOffline(false);await sync(page);await expect.poll(async()=>pending(await local(page)).length).toBe(0);
    await other.setOffline(false);await sync(computer);await expect.poll(async()=>pending(await local(computer)).length).toBe(0);
    await page.bringToFront();await expect.poll(async()=>(await local(page)).book.sheets[0].groups.length,{timeout:15000}).toBe(2);
    expect((await local(page)).book.toolbarOrder).toEqual(phoneOrder);expect((await local(computer)).book.toolbarOrder).toEqual(computerOrder);
    expect(sameSharedWorkbook((await local(page)).book,(await local(computer)).book)).toBe(true);
  });
  test('divergent same-cell edits keep both values and focus comparison on that collision, preserving unrelated edits',async({page,isMobile})=>{
    await page.context().setOffline(true);await other.setOffline(true);
    await edit(page,1,0,'2',isMobile);await edit(page,1,1,'20',isMobile);
    await edit(computer,1,0,'3',false);await edit(computer,3,2,'55',false);
    await page.context().setOffline(false);await sync(page);await expect.poll(async()=>pending(await local(page)).length).toBe(0);
    await computer.evaluate(async()=>{
      const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),checkpoint=Store.prototype.checkpoint;
      Store.prototype.checkpoint=async function(...args){
        if(args[0]==='Remote conflict - not applied'){
          document.documentElement.dataset.recoveryStarted='true';
          await new Promise<void>(resolve=>window.addEventListener('synthetic-release-recovery',()=>resolve(),{once:true}));
        }
        return checkpoint.apply(this,args);
      };
    });
    await other.setOffline(false);await sync(computer);
    await expect(computer.locator('html')).toHaveAttribute('data-recovery-started','true');
    await edit(computer,4,1,'66',false);
    await computer.evaluate(()=>window.dispatchEvent(new Event('synthetic-release-recovery')));
    await expect(computer.locator('#save-state')).toHaveText('Sync conflict — saved locally');
    expect(value(await local(computer))).toBe(3);expect(value(await local(computer),1,1)).toBe(20);expect(value(await local(computer),3,2)).toBe(55);
    expect(value({book:endpoint.book} as LocalState)).toBe(2);
    const writes=endpoint.writes;
    await computer.locator('#sync-review').click();
    const comparison=computer.frameLocator('iframe.comparison-frame');
    await expect(comparison.locator('body')).toHaveAttribute('data-loading','false');
    await expect(comparison.locator('#selection-progress')).toContainText('0 of 1');
    await expect.poll(()=>computer.evaluate(async()=>{
      const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
      try{
        const state=(await store.load())!,id=sessionStorage.getItem(`fnt-comparison:${state.book.id}`),review=id?await store.comparisonReview(id):undefined;
        return[review?.left.book,review?.right?.book].map(book=>{const s=book?.sheets[0];return s?.cells[`${s.rows[4].id}:${s.columns[1].id}`]?.value;});
      }finally{store.close();}
    })).toEqual([66,66]);
    endpoint.races=1;endpoint.raceRow=5;const raced=900+endpoint.attempts+1;
    await comparison.locator('#keep-right button').click();
    await comparison.locator('#submit-decision').click();await comparison.locator('#apply-sync').check();await comparison.locator('#apply-selection').click();
    await expect(computer.locator('.comparison-view')).toHaveCount(0,{timeout:15000});await expect(computer.locator('#save-state')).toContainText('Synced');
    expect(value(await local(computer))).toBe(2);expect(value(await local(computer),3,2)).toBe(55);expect(value(await local(computer),4,1)).toBe(66);
    expect(value(await local(computer),5,2)).toBe(raced);expect(endpoint.writes).toBe(writes+2);
    expect(sameSharedWorkbook((await local(computer)).book,endpoint.book)).toBe(true);
  });
  test('delete-versus-edit pauses safely and survives reload with both copies recoverable',async({page})=>{
    await page.context().setOffline(true);await other.setOffline(true);
    await mutateSaved(page,'delete','Deleted row');await edit(computer,1,0,'3',false);
    await page.context().setOffline(false);await sync(page);await expect.poll(async()=>pending(await local(page)).length).toBe(0);
    const writes=endpoint.writes;
    await other.setOffline(false);await sync(computer);await expect(computer.locator('#save-state')).toHaveText('Sync conflict — saved locally');
    expect(value(await local(computer))).toBe(3);expect(endpoint.writes).toBe(writes);
    await computer.reload();await expect(computer.locator('#save-state')).toContainText('sync paused');
    expect(value(await local(computer))).toBe(3);
    const copies=await computer.evaluate(async()=>{
      const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
      try{return(await store.history()).map(copy=>({label:copy.label,rows:copy.book.sheets[0].rows.length}));}finally{store.close();}
    });
    expect(copies).toContainEqual({label:'Remote conflict - not applied',rows:39});
    expect(copies).toContainEqual({label:'Local conflict - not uploaded',rows:40});
  });
  test('incoming reads wait for a live editor, then rebase committed edits made during the download',async({page,isMobile})=>{
    endpoint.edit(1,1,30);endpoint.holdRead=true;
    await sync(page);await expect.poll(()=>endpoint.started).toBe(true);
    await page.locator('td[data-r="1"][data-c="0"]').click();
    const input=isMobile?page.locator('#formula'):page.getByRole('textbox',{name:'Edit selected cell',exact:true});
    if(!isMobile)await page.keyboard.press('F2');await input.fill('99');
    endpoint.release!();await expect(page.locator('#save-state')).toContainText('Editing cell');
    await expect(input).toHaveValue('99');await expect(input).toBeFocused();
    await input.press('Enter');
    await expect.poll(async()=>value(await local(page),1,1)).toBe(30);expect(value(await local(page))).toBe(99);
    await expect(page.locator('#sync-review')).toBeHidden();
    await expect.poll(async()=>pending(await local(page)).length).toBe(0);
    expect(value({book:endpoint.book} as LocalState)).toBe(99);
  });
  test('upload acknowledgements do not clear newer edits; lost acknowledgements plus reload do not cause false same-cell conflicts',async({page,isMobile})=>{
    endpoint.holdWrite=true;endpoint.loseAcknowledgement=true;
    await edit(page,1,0,'2',isMobile);await sync(page);await expect.poll(()=>endpoint.started).toBe(true);
    await edit(page,1,0,'3',isMobile);const newer=(await local(page)).pending.at(-1)!.id;
    endpoint.release!();await expect(page.locator('#save-state')).toHaveText('Sync failed - local copy retained');
    expect(value({book:endpoint.book} as LocalState)).toBe(2);expect((await local(page)).pending.map(operation=>operation.id)).toContain(newer);
    await page.reload();await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
    expect(value(await local(page))).toBe(3);expect(value({book:endpoint.book} as LocalState)).toBe(3);
    expect(pending(await local(page))).toHaveLength(0);expect(endpoint.writes).toBe(2);await expect(page.locator('#sync-review')).toBeHidden();
  });
});
