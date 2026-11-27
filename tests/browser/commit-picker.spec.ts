import {expect,test} from '@playwright/test';
import {encode64} from '../../src/storage';
import {createDemo,key} from '../../src/model';
import {decompressArchive} from '../../src/archive';

test.use({timezoneId:'America/Los_Angeles'});
test('commit picker uses local time, sticky three-column headers, collapsible days, search and keyboard selection',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const path='/src/commit-picker.ts',{mountCommitPicker}=await import(/* @vite-ignore */path) as typeof import('../../src/commit-picker'),trigger=document.createElement('button');
    document.body.classList.add('compact-controls');document.body.dataset.dropdownStyle='dd';
    trigger.id='test-commits';trigger.setAttribute('aria-label','Test commits');document.body.append(trigger);
    const entries=Array.from({length:50},(_,i)=>({sha:i.toString(16).padStart(40,'0'),time:i<25?'2026-11-25T22:00:37Z':'2026-11-26T10:00:00Z',message:`Fnt save (${i} pending changes)`,changes:i}));
    mountCommitPicker(trigger,{selected:()=>entries[0].sha,list:async page=>page===1?{commits:entries,next:2}:{commits:[{sha:'f'.repeat(40),time:'2026-11-24T22:00:00Z',message:'Older invented commit'}]},choose:entry=>document.body.dataset.chosenCommit=entry.sha});
  });

  await page.getByRole('combobox',{name:'Test commits',exact:true}).click();
  const popup=page.locator('.commit-popup'),list=popup.getByRole('listbox',{name:'Commits',exact:true});
  await expect(popup.getByRole('searchbox',{name:'Search commits',exact:true})).toBeFocused();
  await expect(popup.locator(':scope>p')).toHaveCount(0);
  expect((await popup.boundingBox())!.width).toBe(Math.min(380,(await page.viewportSize())!.width-12));
  await expect(popup.locator('.commit-header')).toHaveText('TimeChangesCommit');await expect(popup.locator('.commit-header')).toHaveCSS('position','sticky');
  await expect(popup.locator('.commit-option').first()).toHaveCSS('display','grid');await expect(popup.locator('.commit-option')).toHaveCount(50);
  const sharedFont=await popup.locator('.commit-option').first().evaluate(button=>getComputedStyle(button).fontFamily);
  for(const cell of await popup.locator('.commit-option').first().locator('span').all())await expect(cell).toHaveCSS('font-family',sharedFont);
  await expect(popup.locator('[data-commit="'+'0'.repeat(40)+'"]>span').nth(1)).toHaveText('0');
  await expect(popup.locator('summary').first()).toHaveClass(/find-sheet-header/);
  await expect(popup.locator('.commit-day')).toHaveCount(2);await expect(popup.locator('.commit-option').filter({hasText:'2:00:37 PM PST'})).toHaveCount(25);
  await list.evaluate(element=>element.scrollTop=250);
  const top=(await list.boundingBox())!.y;expect((await popup.locator('.commit-header').boundingBox())!.y).toBeCloseTo(top,0);
  const day=popup.locator('.commit-day').filter({has:page.locator('summary').filter({hasText:'November 25, 2026'})});
  await day.locator('summary').click();await expect(day.locator('[role="option"]').first()).toBeHidden();
  await popup.getByRole('button',{name:'Load earlier commits',exact:true}).click();await expect(popup.locator('.commit-day')).toHaveCount(3);
  await expect(day.locator('[role="option"]').first()).toBeHidden();
  const search=popup.getByRole('searchbox',{name:'Search commits',exact:true});await search.fill('0'.repeat(40));await search.press('ArrowDown');await expect(popup.locator('[role="option"]')).toBeFocused();
  await page.keyboard.press('Enter');await expect(popup).toHaveCount(0);expect(await page.evaluate(()=>document.body.dataset.chosenCommit)).toBe('0'.repeat(40));
});

test('historical comparison sources stay read-only until submission and use the current remote head when syncing',async({page})=>{
  const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);let content='',currentSha='current-blob',historyReads=0,remoteReads=0,writes=0,allowUpload=false,uploaded='';
  await page.route('https://api.github.com/**',async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='PUT'){
      expect(allowUpload).toBe(true);const body=route.request().postDataJSON() as {sha:string;content:string};
      expect(body.sha).toBe(currentSha);writes++;uploaded=body.content;await route.fulfill({json:{content:{sha:'saved-blob'}}});return;
    }
    if(url.pathname.endsWith('/commits')){
      historyReads++;
      await route.fulfill({json:[a,b,c].map((sha,i)=>({sha,commit:{committer:{date:`2026-11-${25-i}T22:00:00Z`},message:`Fnt save (${i+1} pending changes)`}}))});return;
    }
    if(url.pathname.includes('/contents/')){
      remoteReads++;
      const envelope=JSON.parse(content),ref=url.searchParams.get('ref');
      if(ref===c)envelope.book=createDemo();else if(ref===a||ref===b){
        envelope.book.title=ref===a?'Invented first commit':'Invented second commit';
        const sheet=envelope.book.sheets.at(-1);
        for(const row of [1,60])sheet.cells[key(sheet.rows[row].id,sheet.columns[0].id)]={value:`Invented ${ref.slice(0,8)} row ${row}`};
      }
      await route.fulfill({json:{sha:currentSha,content:encode64(JSON.stringify(envelope)),encoding:'base64'}});return;
    }
    await route.fulfill({json:{private:true,has_pages:false}});
  });
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const original=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      let state=(await store.load())!;const sync={owner:'example',repo:'private-data',branch:'main',path:'book.json'};
      state=await store.metadata(state.version,current=>({...current,sync,remoteSha:'current-blob',pending:[],syncPaused:true}));
      await store.rememberSyncToken(sync,'invented-history-token');return state.book;
    }finally{store.close();}
  });
  content=JSON.stringify({format:'fnt-sync-v1',book:original,operations:[]});
  await page.reload();await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
  const frame=page.frameLocator('.comparison-view iframe');
  await expect(frame.locator('#left-source')).toHaveText('Current local workbook');
  expect(remoteReads).toBe(0);await expect(frame.locator('#right-commits')).toBeEnabled();await expect(frame.locator('#right-github')).toBeEnabled();
  await frame.getByRole('combobox',{name:'Commits for right comparison',exact:true}).click();
  await frame.getByRole('option',{name:'Latest saved workbook',exact:true}).click();
  await expect(frame.locator('#right-source')).toHaveText('book.json');
  historyReads=0;
  await expect(frame.getByRole('combobox',{name:'Commits for left comparison',exact:true})).toBeEnabled();
  const beforeSelection=await page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book;}finally{store.close();}});
  await expect(frame.getByRole('button',{name:'Read GitHub',exact:true})).toHaveCount(0);
  await expect(frame.locator('#right-github')).toHaveText('Uploads');
  await frame.getByRole('combobox',{name:'Commits for right comparison',exact:true}).click();
  await expect(frame.locator(`[data-commit="${a}"]`)).toBeVisible();
  content=JSON.stringify({format:'fnt-sync-v1',book:{...original,title:'Newest invented save'},operations:[]});currentSha='fresh-blob';
  await frame.getByRole('option',{name:'Latest saved workbook',exact:true}).click();
  await expect(frame.locator('#detail-right')).toContainText('Newest invented save');expect(writes).toBe(0);
  for(const [side,sha]of [['left',a],['right',b]] as const){
    await frame.getByRole('combobox',{name:`Commits for ${side} comparison`,exact:true}).click();
    await frame.locator(`[data-commit="${sha}"]`).click();await expect(frame.locator(`#${side}-kind`)).toHaveText('GitHub commit');
    await expect(frame.locator(`#${side}-source`)).toContainText(sha.slice(0,8));
  }
  const settingsScope=await frame.locator('.scope-button[aria-current="true"]').getAttribute('data-scope');
  await frame.locator('#navigation>div').filter({has:frame.locator('.sheet-heading',{hasText:'Notebook'})}).getByRole('button').click();
  await expect(frame.locator('#region-picker-trigger')).toBeVisible();
  const triggerStyles=await frame.locator('#right-commits').evaluate(button=>{
    const region=document.querySelector<HTMLElement>('#region-picker-trigger')!,properties=['height','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','fontSize','fontWeight','borderRadius'];
    const style=getComputedStyle(button),other=getComputedStyle(region);
    const values=(computed:CSSStyleDeclaration)=>Object.fromEntries(properties.map(property=>[property,computed.getPropertyValue(property.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))]));
    return {commits:values(style),region:values(other),directChevron:!!button.querySelector(':scope>svg'),wrapper:!!button.querySelector('.format-caret'),width:button.getBoundingClientRect().width,regionWidth:region.getBoundingClientRect().width};
  });
  expect(triggerStyles.commits).toEqual(triggerStyles.region);expect(triggerStyles.directChevron).toBe(true);expect(triggerStyles.wrapper).toBe(false);expect(triggerStyles.width).toBeLessThan(triggerStyles.regionWidth);
  const widths=await frame.locator('#right-commits').evaluate(button=>{const label=button.querySelector('span')!,before=button.getBoundingClientRect().width;label.textContent='Commits with a longer label';const longer=button.getBoundingClientRect().width;label.textContent='Commits';return{before,longer,after:button.getBoundingClientRect().width};});
  expect(widths.longer).toBeGreaterThan(widths.before);expect(widths.after).toBe(widths.before);
  await frame.locator(`.scope-button[data-scope="${settingsScope}"]`).click();
  await frame.getByRole('combobox',{name:'Commits for right comparison',exact:true}).click();await frame.locator(`[data-commit="${c}"]`).click();
  expect(historyReads).toBe(4);
  await expect(frame.locator('#error')).toContainText('different workbook');await expect(frame.locator('#right-source')).toContainText(b.slice(0,8));
  expect(writes).toBe(0);
  const after=await page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book;}finally{store.close();}});
  expect(after).toEqual(beforeSelection);
  const overflow=await frame.locator('.source-actions').evaluateAll(elements=>elements.some(element=>element.getBoundingClientRect().right>element.closest('.source')!.getBoundingClientRect().right));
  expect(overflow).toBe(false);
  await frame.locator('#keep-right button').click();await frame.locator('#submit-decision').click();
  await expect(frame.locator('#apply-sync')).not.toBeChecked();expect(writes).toBe(0);
  await frame.locator('#apply-sync').check();allowUpload=true;await frame.locator('#apply-selection').click();
  await expect(page.locator('.comparison-view')).toHaveCount(0);expect(writes).toBe(1);
  const envelope=JSON.parse(Buffer.from(uploaded,'base64').toString('utf8'));
  expect((decompressArchive(envelope.payload) as {book:{title:string}}).book.title).toBe('Invented second commit');
});

test.describe('device-local commit dates',()=>{
  test.use({timezoneId:'Asia/Kolkata'});
  test('uses the device day across UTC midnight and preserves retry errors while searching',async({page})=>{
    await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
    await page.evaluate(async()=>{
      const path='/src/commit-picker.ts',{mountCommitPicker}=await import(/* @vite-ignore */path) as typeof import('../../src/commit-picker'),trigger=document.createElement('button');trigger.id='retry-commits';document.body.append(trigger);
      let requests=0;
      mountCommitPicker(trigger,{selected:()=>undefined,choose:()=>{},list:async()=>{
        if(++requests===1)throw Error('Invented unavailable history');
        return {commits:[{sha:'a'.repeat(40),time:'2026-11-25T22:00:00Z',message:'Invented midnight commit'}]};
      }});
    });
    await page.locator('#retry-commits').click();
    const popup=page.locator('.commit-popup'),search=popup.getByRole('searchbox');
    await expect(popup.getByRole('status')).toContainText('Invented unavailable history');
    await search.fill('missing');await expect(popup.getByRole('status')).toContainText('Invented unavailable history');
    await popup.getByRole('button',{name:'Retry reading copies',exact:true}).click();await expect(popup.getByRole('status')).toHaveText('No matching options.');
    await search.fill('');await expect(popup.locator('summary')).toHaveText('November 26, 2026');
    await expect(popup.locator('.commit-option')).toContainText('3:30:00 AM GMT+5:30');
    await search.press('Escape');await expect(popup).toHaveCount(0);await expect(page.locator('#retry-commits')).toBeFocused();
  });
});

test('paged commit history stays responsive with one thousand loaded metadata rows',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const path='/src/commit-picker.ts',{mountCommitPicker}=await import(/* @vite-ignore */path) as typeof import('../../src/commit-picker'),trigger=document.createElement('button');trigger.id='history-perf';document.body.append(trigger);
    const entries=Array.from({length:1000},(_,i)=>({sha:i.toString(16).padStart(40,'0'),time:'2026-11-25T22:00:00Z',message:`Invented history ${i}`}));
    mountCommitPicker(trigger,{selected:()=>undefined,choose:()=>{},list:async page=>({commits:entries.slice((page-1)*100,page*100),...(page<10?{next:page+1}:{})})});
  });
  await page.locator('#history-perf').click();const popup=page.locator('.commit-popup');await expect(popup.locator('[role="option"]')).toHaveCount(100);
  for(let page=2;page<=10;page++){await popup.getByRole('button',{name:'Load earlier commits',exact:true}).click();await expect(popup.locator('[role="option"]')).toHaveCount(page*100);}
  const elapsed=await popup.getByRole('searchbox').evaluate(input=>{
    const start=performance.now();(input as HTMLInputElement).value='Invented history';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.commit-popup')!.getBoundingClientRect();return performance.now()-start;
  });
  console.log('1,000-commit history search including layout (ms)',elapsed);expect(elapsed).toBeLessThan(500);
  await expect(popup.getByRole('button',{name:'Load earlier commits',exact:true})).toBeHidden();
});

test('older open workbooks do not fail automatically on newer Meal log metadata and explain the safe update',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const path='/src/model.ts',{createDemo}=await import(/* @vite-ignore */path) as typeof import('../../src/model'),book=createDemo(),remote=structuredClone(book),table=remote.tables[0];
    remote.sheets.find(sheet=>sheet.id===table.sheet)!.mealLog={table:table.id,fields:{food:table.columns[0].id,notes:table.columns[1].id}};
    const frame=document.createElement('iframe') as import('../../src/comparison-host').ComparisonFrame;
    document.body.dataset.remoteReads='0';frame.className='legacy-comparison';frame.style.cssText='width:100%;height:750px;border:0';
    frame.comparisonHost={local:{book,kind:'This device',label:'Invented legacy copy'},close:()=>{},readRemote:async()=>{
      document.body.dataset.remoteReads=String(Number(document.body.dataset.remoteReads)+1);
      const oldFields=['food','calories','protein','fat','carbs','sugar','sodium','weight','amount','unit'];
      if(remote.sheets.some(sheet=>Object.keys(sheet.mealLog?.fields??{}).some(field=>!oldFields.includes(field))))throw Error('Invalid Meal log field identities.');
      return {book:remote,kind:'GitHub',label:'Invented saved copy'};
    }};
    frame.src='/comparison.html';document.body.replaceChildren(frame);
  });
  const frame=page.frameLocator('iframe.legacy-comparison');
  await expect(frame.locator('#left-source')).toHaveText('Invented legacy copy');await expect(frame.locator('#source-auth-note')).toContainText('older website version');
  await expect(frame.locator('#error')).toBeHidden();expect(await page.evaluate(()=>document.body.dataset.remoteReads)).toBe('0');
  await frame.getByRole('combobox',{name:'Commits for right comparison',exact:true}).click();
  await frame.getByRole('option',{name:'Latest saved workbook',exact:true}).click();
  await expect(frame.locator('#error')).toContainText('Update website');await expect(frame.locator('#left-source')).toHaveText('Invented legacy copy');
  expect(await page.evaluate(()=>document.body.dataset.remoteReads)).toBe('1');await expect(frame.locator('#right-file')).toBeEnabled();
});

test('disconnected browsers keep source dropdowns accessible and offer sign-in',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const fieldStyle=(input:Element)=>{const style=getComputedStyle(input);return{padding:style.padding,border:style.border,borderRadius:style.borderRadius,font:style.font,color:style.color,background:style.backgroundColor,outline:style.outline,cursor:style.cursor};};
  await page.keyboard.press('Control+f');await expect(page.locator('#find-text')).toBeFocused();
  const sharedField=await page.locator('#find-text').evaluate(fieldStyle);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
  const frame=page.frameLocator('iframe.comparison-frame');
  await expect(frame.locator('#source-auth-note')).toContainText('connected in this browser');
  const noticeColors=await frame.locator('#source-auth-note').evaluate(notice=>({text:getComputedStyle(notice).color,link:getComputedStyle(notice.querySelector('a')!).color}));
  expect(noticeColors.link).toBe(noticeColors.text);
  await expect(frame.locator('#source-auth-note a')).toHaveCSS('text-decoration-line','underline');
  const syncStyles=await frame.getByRole('button',{name:'Sync',exact:true}).evaluate(button=>{
    const properties=['fontFamily','fontSize','fontWeight','lineHeight','padding','color','backgroundColor','borderColor','borderWidth','borderRadius','height'] as const;
    const styles=(element:Element)=>{const style=getComputedStyle(element);return Object.fromEntries(properties.map(property=>[property,style[property]]));};
    return{sync:styles(button),shared:styles(document.getElementById('right-github')!),width:button.getBoundingClientRect().width};
  });
  expect(syncStyles.sync).toEqual(syncStyles.shared);expect(syncStyles.width).toBeGreaterThan(32);
  await frame.getByRole('button',{name:'Sync',exact:true}).click();
  const sync=page.getByRole('dialog',{name:'Optional private GitHub sync',exact:true});
  await expect(sync.getByRole('button',{name:'Connect & read copies',exact:true})).toBeVisible();
  const footer=sync.locator('#sync-form>.button-row');
  await expect(footer.getByRole('button')).toHaveText(['Connect & read copies','Disconnect']);
  await expect(footer).toHaveCSS('gap','8px');
  await sync.getByRole('button',{name:'Close dialog',exact:true}).click();
  await frame.locator('#source-auth-note a').click();await expect(sync).toBeVisible();
  await sync.getByRole('button',{name:'Close dialog',exact:true}).click();
  const positions=await frame.locator('.top>div button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,label:button.getAttribute('aria-label'),x:button.getBoundingClientRect().x})));
  expect(positions.map(button=>button.label)).toEqual(['Sync','Back to workbook']);expect(positions[0].x).toBeLessThan(positions[1].x);
  await expect(frame.getByRole('combobox',{name:'Commits for right comparison',exact:true})).toBeEnabled();
  await expect(frame.locator('#right-github')).toBeEnabled();await expect(frame.locator('#right-file')).toBeEnabled();
  await frame.locator('#right-github').click();await expect(frame.getByRole('searchbox',{name:'Search uploads',exact:true})).toBeFocused();
  expect(await frame.getByRole('searchbox',{name:'Search uploads',exact:true}).evaluate(fieldStyle)).toEqual(sharedField);
  await expect(frame.getByRole('button',{name:'Sync GitHub',exact:true})).toBeVisible();
  await frame.getByRole('combobox',{name:'Commits for right comparison',exact:true}).click();
  expect(await frame.getByRole('searchbox',{name:'Search commits',exact:true}).evaluate(fieldStyle)).toEqual(sharedField);
});

test('comparison sign-in uses the existing sync dialog read-only and disconnect clears comparison access',async({page})=>{
  let writes=0,reads=0;
  await page.route('https://api.github.com/**',async route=>{
    if(['PUT','DELETE'].includes(route.request().method()))writes++;
    else reads++;
    const url=new URL(route.request().url());
    await route.fulfill({json:url.pathname.includes('/git/trees/')?{tree:[],truncated:false}:{private:true,has_pages:false}});
  });
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
  const frame=page.frameLocator('iframe.comparison-frame');await expect(frame.locator('#totals')).toContainText('Choose a right copy');
  await frame.locator('#right-github').click();await frame.getByRole('button',{name:'Sync GitHub',exact:true}).click();
  const sync=page.getByRole('dialog',{name:'Optional private GitHub sync',exact:true});
  for(const [field,value]of [['owner','example'],['repo','private-data'],['branch','main'],['path','book.json'],['token','invented-read-token']])await sync.locator('#sync-'+field).fill(value);
  await sync.getByRole('button',{name:'Connect & read copies',exact:true}).click();
  await expect(sync).toBeHidden();await expect(frame.locator('.commit-popup')).toBeVisible();
  await expect(frame.getByRole('button',{name:'Sync GitHub',exact:true})).toHaveCount(0);expect(writes).toBe(0);
  await expect(frame.locator('#totals')).toContainText('Choose a right copy');
  const state=await page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{const state=(await store.load())!;return{paused:state.syncPaused,sha:state.remoteSha};}finally{store.close();}});
  expect(state).toEqual({paused:true,sha:undefined});
  await frame.getByRole('searchbox',{name:'Search uploads',exact:true}).press('Escape');
  await frame.getByRole('button',{name:'Sync',exact:true}).click();
  await sync.getByRole('button',{name:'Disconnect',exact:true}).click();
  await expect(sync).toBeHidden();await expect(frame.locator('#source-auth-note a')).toBeVisible();
  const disconnectedReads=reads;
  await frame.locator('#right-github').click();
  await expect(frame.getByRole('button',{name:'Sync GitHub',exact:true})).toBeVisible();
  expect(reads).toBe(disconnectedReads);expect(writes).toBe(0);
});
