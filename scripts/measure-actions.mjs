import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const url=process.argv[2],output=process.argv[3];
const phase=process.argv[4]??'all';
if(!['all','manager','find','columns','followup'].includes(phase))throw Error('Unknown measurement phase.');
if(!url||!output)throw Error('Usage: node scripts\\measure-actions.mjs URL OUTPUT.json');
const html=await(await fetch(url)).text(),asset=html.match(/src="([^"]+\.js)"/)?.[1];
if(!asset)throw Error('No production entry script found.');
const bundle=await(await fetch(new URL(asset,url))).text();
const fixture=await(await fetch(new URL('testing-workbook.json',url))).arrayBuffer();
const result={url,phase,asset,bundleSHA256:createHash('sha256').update(bundle).digest('hex'),fixtureSHA256:createHash('sha256').update(Buffer.from(fixture)).digest('hex'),viewport:{width:1440,height:950},samples:[],errors:[]};
const browser=await chromium.launch({channel:process.env.FNT_BROWSER_CHANNEL??'msedge',headless:true});
let context,page;
async function fresh(sheet='Meals',quietMs=1500){
  await context?.close();
  context=await browser.newContext({viewport:result.viewport,serviceWorkers:'block'});
  page=await context.newPage();page.setDefaultTimeout(180000);
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.addInitScript(()=>{
    window.actionTasks=[];
    new PerformanceObserver(list=>window.actionTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
  });
  await page.goto(url);await page.locator('.grid').waitFor();if(quietMs)await page.waitForTimeout(quietMs);
  await page.getByRole('button',{name:sheet,exact:true}).click();await saved();
}
async function saved(){
  await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent?.includes('Saved')||document.querySelector('#error')?.textContent,{},{timeout:180000});
  const status=await page.locator('#save-state').innerText();
  if(!status.includes('Saved'))throw Error(`${status}: ${await page.locator('#error').innerText()}`);
}
async function fingerprint(){
  return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('fnt-workbook-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    let keys,values;
    try{
      const tx=db.transaction('state','readonly'),store=tx.objectStore('state');
      [keys,values]=await Promise.all([store.getAllKeys(),store.getAll()].map(request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);})));
    }finally{db.close();}
    const records=new Map(keys.map((key,i)=>[key,values[i]])),base=records.get('current'),head=records.get('journal:head');
    let book=base.book;
    for(const [key,entry]of records){
      if(!String(key).startsWith('journal:entry:')||entry.book!==book.id)continue;
      for(const forward of entry.forward){
        if(forward.book){book=forward.book;continue;}
        if(forward.cells)for(const change of forward.cells){
          const sheet=[...book.sheets,...book.dropdownData?.sheets??[]].find(s=>s.id===change.sheet);
          if(change.value)sheet.cells[change.key]=change.value;else delete sheet.cells[change.key];
        }
        if(forward.patch)for(const change of forward.patch){
          let target=book;for(const part of change.path.slice(0,-1))target=target[part];
          const part=change.path.at(-1);if(change.exists)target[part]=change.value;else delete target[part];
        }
      }
    }
    const sheets=[...book.sheets,...book.dropdownData?.sheets??[]],formulas=[],cells=[];
    for(const sheet of sheets)for(const [key,cell]of Object.entries(sheet.cells).sort(([a],[b])=>a.localeCompare(b))){
      if(cell.formula||cell.calculation)formulas.push([sheet.id,key,cell.formula,cell.calculation,cell.original]);
      cells.push([sheet.id,key,cell]);
    }
    const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
    return{formulaCells:formulas.length,formulaSHA256:await digest(formulas),cellsSHA256:await digest(cells),version:head?.state.version??base.version,undo:records.get('undo')?.history.undo.length,groups:sheets.reduce((n,s)=>n+s.groups.length,0)};
  });
}
async function sample(name,action){
  const started=await page.evaluate(()=>performance.now()),wall=Date.now();
  await action();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const painted=Date.now()-wall;
  await saved();
  const detail=await page.evaluate(start=>({longTasks:window.actionTasks.filter(t=>t.start>=start),status:document.querySelector('#save-state').textContent}),started);
  result.samples.push({name,paintedMs:painted,savedMs:Date.now()-wall,...detail});
  await writeFile(output,JSON.stringify(result,null,2));
  console.error(`${name}: paint ${painted}ms, saved ${result.samples.at(-1).savedMs}ms`);
}
async function select(range){
  await page.locator('[data-action="range"]').click();await page.locator('#answer').fill(range);await page.locator('#answer').press('Enter');
}
async function openManager(){
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await sample('manager-open',()=>page.getByRole('button',{name:'Manage groups',exact:true}).click());
  result.managerCards=await page.locator('[data-group-card]').count();
  result.managerPreviews=await page.locator('.group-cell-preview').count();
}
try{
  if(phase==='followup'){
    await fresh('Meals',0);await page.locator('[data-action="find"]').click();
    await sample('immediate-cold-find-a',async()=>{
      await page.locator('#find-text').fill('a');
      await page.waitForFunction(()=>document.querySelector('#find-count')?.textContent==='Results found (9962)');
    });
    await fresh();
    await page.getByRole('button',{name:'Group controls',exact:true}).click();await page.getByRole('button',{name:'Manage groups',exact:true}).click();
    await sample('summary-expand-manager',()=>page.locator('[data-group-card]').first().locator('[data-toggle]').click());
    await page.getByRole('button',{name:'Close group manager'}).click();
    await sample('table-selection-mode',()=>page.getByRole('button',{name:'Table-constrained header selection',exact:true}).click());
    await select('F3');await page.locator('#formula').fill('3');
    await sample('Meals-F3-cell-edit',()=>page.locator('#formula').press('Enter'));
    await sample('Meals-F3-undo',()=>page.locator('[data-action="undo"]').click());
    await sample('Meals-F3-redo',()=>page.locator('[data-action="redo"]').click());
    await fresh('Daily log');
    await sample('sheet-row-insert',()=>page.locator('[data-insert-row="2"]').first().click());
    await sample('sheet-row-insert-undo',()=>page.locator('[data-action="undo"]').click());
    await fresh('Meals',0);await page.locator('#grid-scroll').evaluate(el=>el.scrollTop=900);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.evaluate(()=>{
      window.stickySamples=[];
      const grid=document.querySelector('#grid-scroll');
      grid.addEventListener('scroll',()=>{
        const header=grid.querySelector('.sticky-table-header');if(!header)return;
        window.stickySamples.push({scroll:grid.scrollTop,mismatch:header.getBoundingClientRect().top-grid.querySelector('thead').getBoundingClientRect().bottom});
      },{passive:true});
    });
    await page.mouse.move(800,500);
    await sample('native-sticky-wheel-sequence',async()=>{for(const delta of [240,240,-120,240,-240,-120]){await page.mouse.wheel(0,delta);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}});
    result.stickySamples=await page.evaluate(()=>window.stickySamples);
    await page.screenshot({path:output.replace(/\.json$/,'-sticky.png')});
  }
  if(phase==='all'||phase==='manager'){
  await fresh();result.groupBefore=await fingerprint();await select('A1:A2');await openManager();
  await sample('plain-group-create-manager-open',()=>page.locator('[data-create-kind="range"][data-create-axis="row"]').click());
  await sample('group-toggle-manager-open',()=>page.locator('[data-group-card]').first().locator('[data-toggle]').click());
  await page.getByRole('button',{name:'Close group manager'}).click();
  await sample('group-toggle-undo',()=>page.locator('[data-action="undo"]').click());
  await sample('group-toggle-redo',()=>page.locator('[data-action="redo"]').click());
  await sample('explicit-save',async()=>{await page.locator('[data-action="save"]').click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('checkpoint'));});
  result.groupAfter=await fingerprint();result.groupFormulasPreserved=result.groupBefore.formulaSHA256===result.groupAfter.formulaSHA256;result.groupCellsPreserved=result.groupBefore.cellsSHA256===result.groupAfter.cellsSHA256;
  }

  if(phase==='all'||phase==='find'){
  await fresh();
  await page.locator('[data-action="find"]').click();
  for(const query of ['a','ap','app','apple','a']){
    await sample(`find-${query}-${result.samples.length}`,async()=>{
      await page.locator('#find-text').fill(query);
      await page.waitForFunction(()=>document.querySelector('#find-count')?.textContent?.startsWith('Results found ('));
    });
    result.samples.at(-1).count=await page.locator('#find-count').innerText();
  }
  await page.locator('#find-text').fill('apple');await page.locator('#find-text').fill('a');
  await page.waitForFunction(()=>document.querySelector('#find-count')?.textContent?.startsWith('Results found ('));
  const total=Number((await page.locator('#find-count').innerText()).match(/\d+/)[0]);
  await sample('find-last-page',async()=>{
    await page.evaluate(()=>{const next=document.querySelector('#find-next-page');while(!next.disabled)next.click();});
    await page.locator(`[data-find-match="${total-1}"]`).click();
  });
  result.lastResultVisible=await page.locator('.grid td.active').isVisible();
  }

  if(phase==='all'||phase==='columns'){
  await fresh();
  await sample('meals-column-A-autofit',async()=>{
    const handle=page.locator('[data-resize-column="0"]'),box=await handle.boundingBox();
    if(!box)throw Error('Resize handle is not visible.');
    await handle.dblclick({position:{x:box.width/2,y:box.height-2}});
  });
  await sample('autofit-undo',()=>page.locator('[data-action="undo"]').click());
  await page.locator('#title').click();await page.locator('#answer').fill('Disposable measured title');
  await sample('workbook-title',()=>page.locator('#answer').press('Enter'));
  await sample('title-undo',()=>page.locator('[data-action="undo"]').click());

  await fresh('Daily log');
  await page.getByRole('button',{name:'Table-constrained header selection',exact:true}).click();
  await page.locator('[data-row-select="1"]').click();await page.locator('[data-action="structure"]').click();
  await sample('tiny-table-row-duplicate',()=>page.getByRole('button',{name:'Duplicate selected rows',exact:true}).click());
  await sample('row-duplicate-undo',()=>page.locator('[data-action="undo"]').click());
  await sample('row-duplicate-redo',()=>page.locator('[data-action="redo"]').click());
  }
}catch(error){
  result.failure={message:String(error),status:await page.locator('#save-state').innerText().catch(()=>''),error:await page.locator('#error').innerText().catch(()=>'')};
  throw error;
}finally{
  await writeFile(output,JSON.stringify(result,null,2));
  await context?.close();await browser.close();
}
