import {expect,test} from '@playwright/test';

test('conflict snapshots upload separately and comparison lists dated device copies without replacing the workbook',async({page})=>{
  let remote='',uploads=0;
  const files=new Map<string,{sha:string;content:string}>();
  await page.route('https://api.github.com/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='PUT'){
      const path=decodeURIComponent(url.pathname.split('/contents/')[1]);
      expect(path).toContain('/fnt-snapshots/');expect(path).not.toBe('private/synthetic.json');
      const body=request.postDataJSON() as {content:string;sha?:string};expect(body.sha).toBeUndefined();
      const sha=(++uploads).toString(16).padStart(40,'0');files.set(path,{sha,content:body.content});
      await route.fulfill({json:{content:{sha}}});return;
    }
    if(url.pathname.includes('/git/trees/')){await route.fulfill({json:{tree:[...files].map(([path,file])=>({path,sha:file.sha,type:'blob'})),truncated:false}});return;}
    if(url.pathname.includes('/git/blobs/')){
      const file=[...files.values()].find(file=>file.sha===url.pathname.split('/').at(-1))!;
      await route.fulfill({json:{encoding:'base64',content:file.content}});return;
    }
    await route.fulfill({json:url.pathname.includes('/contents/')?{sha:'divergent-main',content:remote,encoding:'base64'}:{private:true,has_pages:false}});
  });
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  remote=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store,encode64}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,book=structuredClone(state.book);book.title='Invented other-device workbook';return encode64(JSON.stringify({format:'fnt-sync-v1',book,operations:[]}));}
    finally{store.close();}
  });
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  const file=page.getByRole('dialog',{name:'Recovery',exact:true});
  await expect(file.locator('.menu > button').nth(0)).toHaveText('Private GitHub sync');
  await expect(file.locator('.menu > button').nth(1)).toHaveText('Upload local data to GitHub');
  await expect(file.locator('.menu > button').nth(2)).toHaveText('Compare versions for merge conflict');
  expect(await file.locator('#backup').evaluate(button=>button.classList.contains('primary'))).toBe(false);
  await file.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Compare workbooks and backups',exact:true})).toBeVisible();
  expect(uploads).toBe(0);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  const reopened=page.getByRole('dialog',{name:'Recovery',exact:true});
  await expect(reopened.getByRole('button',{name:'Upload local data to GitHub',exact:true})).toBeDisabled();
  await expect(reopened.getByText('Import or restore',{exact:true})).toBeVisible();
  await expect(reopened.locator('#import')).toBeHidden();
  await page.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  for(const [name,value]of [['owner','example'],['repo','private-test'],['branch','main'],['path','private/synthetic.json'],['token','invented-token']])await page.locator(`#sync-${name}`).fill(value);
  await page.getByRole('button',{name:'Connect & sync now',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('CONFLICT');
  const local=()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;return {book:JSON.stringify(state.book),pending:state.pending,remoteSha:state.remoteSha};}finally{store.close();}
  });
  const before=await local(),conflict=page.getByRole('dialog',{name:'Sync conflict - choose deliberately',exact:true});
  await expect(conflict.locator('.menu > button').first()).toHaveText('Upload local data to GitHub');
  await conflict.getByRole('button',{name:'Upload local data to GitHub',exact:true}).click();
  const upload=page.getByRole('dialog',{name:'Upload local data to GitHub',exact:true});
  await upload.locator('#snapshot-device').fill('Phone');
  await upload.getByRole('button',{name:'Upload local data to GitHub',exact:true}).click();
  await expect(upload.locator('#snapshot-upload-status')).toContainText('[Phone]');
  await upload.locator('#snapshot-device').fill('Desktop');
  await upload.getByRole('button',{name:'Upload another snapshot',exact:true}).click();
  await expect(upload.locator('#snapshot-upload-status')).toContainText('[Desktop]');
  expect(uploads).toBe(2);expect(await local()).toEqual(before);
  await upload.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(conflict).toBeVisible();await expect(page.locator('#save-state')).toContainText('CONFLICT');
  await conflict.getByRole('button',{name:'Compare versions or a backup',exact:true}).click();
  await expect(page.locator('#snapshot-list-status')).toContainText('2 uploaded copies, newest first');
  await expect(page.locator('#snapshot-left option')).toHaveCount(3);
  expect(await page.locator('#snapshot-left option').nth(1).getAttribute('data-device')).toBe('Desktop');
  await page.locator('#snapshot-left-trigger').click();
  const option=page.getByRole('option').filter({hasText:'[Phone]'});
  await expect(option.locator('.snapshot-date')).toContainText('@');
  const date=(await option.locator('.snapshot-date').boundingBox())!,device=(await option.locator('.snapshot-device').boundingBox())!;
  expect(device.x).toBeGreaterThan(date.x);
  await option.click();
  await expect(page.locator('#comparison-left-label')).toContainText('[Phone]');
  await expect(page.locator('#comparison-status')).toContainText('Comparison complete.');
  expect(await local()).toEqual(before);expect(uploads).toBe(2);
});
