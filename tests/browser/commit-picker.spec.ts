import {expect,test} from '@playwright/test';
import {encode64} from '../../src/storage';
import {createDemo} from '../../src/model';
import {decompressArchive} from '../../src/archive';

test.use({timezoneId:'America/Los_Angeles'});
test('commit picker uses local time, sticky three-column headers, collapsible days, search and keyboard selection',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const path='/src/commit-picker.ts',{mountCommitPicker}=await import(/* @vite-ignore */path) as typeof import('../../src/commit-picker'),trigger=document.createElement('button');
    document.body.classList.add('compact-controls');document.body.dataset.dropdownStyle='dd';
    trigger.id='test-commits';trigger.setAttribute('aria-label','Test commits');document.body.append(trigger);
    const entries=Array.from({length:50},(_,i)=>({sha:i.toString(16).padStart(40,'0'),time:i<25?'2026-11-25T22:00:00Z':'2026-11-26T10:00:00Z',message:`Fnt save (${i} pending changes)`,changes:i}));
    mountCommitPicker(trigger,{selected:()=>entries[0].sha,list:async page=>page===1?{commits:entries,next:2}:{commits:[{sha:'f'.repeat(40),time:'2026-11-24T22:00:00Z',message:'Older invented commit'}]},choose:entry=>document.body.dataset.chosenCommit=entry.sha});
  });

  await page.getByRole('button',{name:'Test commits',exact:true}).click();
  const popup=page.locator('.commit-popup'),list=popup.getByRole('listbox',{name:'Commits',exact:true});
  await expect(popup.getByRole('searchbox',{name:'Search commits',exact:true})).toBeFocused();
  await expect(popup.locator('.commit-header')).toHaveText('TimeChangesCommit');await expect(popup.locator('.commit-header')).toHaveCSS('position','sticky');
  await expect(popup.locator('.commit-option').first()).toHaveCSS('display','grid');await expect(popup.locator('.commit-option')).toHaveCount(50);
  await expect(popup.locator('.commit-day')).toHaveCount(2);await expect(popup.locator('.commit-option').filter({hasText:'2:00 PM PST'})).toHaveCount(25);
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
  const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);let content='',writes=0,allowUpload=false,uploaded='';
  await page.route('https://api.github.com/**',async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='PUT'){
      expect(allowUpload).toBe(true);const body=route.request().postDataJSON() as {sha:string;content:string};
      expect(body.sha).toBe('current-blob');writes++;uploaded=body.content;await route.fulfill({json:{content:{sha:'saved-blob'}}});return;
    }
    if(url.pathname.endsWith('/commits')){
      await route.fulfill({json:[a,b,c].map((sha,i)=>({sha,commit:{committer:{date:`2026-11-${25-i}T22:00:00Z`},message:`Fnt save (${i+1} pending changes)`}}))});return;
    }
    if(url.pathname.includes('/contents/')){
      const envelope=JSON.parse(content),ref=url.searchParams.get('ref');
      if(ref===c)envelope.book=createDemo();else if(ref===a||ref===b)envelope.book={...envelope.book,title:ref===a?'Invented first commit':'Invented second commit'};
      await route.fulfill({json:{sha:'current-blob',content:encode64(JSON.stringify(envelope)),encoding:'base64'}});return;
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
  await expect(frame.locator('#right-source')).toHaveText('book.json');
  await expect(frame.getByRole('button',{name:'Commits for left comparison',exact:true})).toBeEnabled();
  const beforeSelection=await page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book;}finally{store.close();}});
  for(const [side,sha]of [['left',a],['right',b]] as const){
    await frame.getByRole('button',{name:`Commits for ${side} comparison`,exact:true}).click();
    await frame.locator(`[data-commit="${sha}"]`).click();await expect(frame.locator(`#${side}-kind`)).toHaveText('GitHub commit');
    await expect(frame.locator(`#${side}-source`)).toContainText(sha.slice(0,8));
  }
  await frame.getByRole('button',{name:'Commits for right comparison',exact:true}).click();await frame.locator(`[data-commit="${c}"]`).click();
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
    await popup.getByRole('button',{name:'Retry reading commits',exact:true}).click();await expect(popup.getByRole('status')).toHaveText('No matching commits.');
    await search.fill('');await expect(popup.locator('summary')).toHaveText('November 26, 2026');
    await expect(popup.locator('.commit-option')).toContainText('3:30 AM GMT+5:30');
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
