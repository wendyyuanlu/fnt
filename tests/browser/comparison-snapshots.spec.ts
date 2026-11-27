import {expect,test} from '@playwright/test';

for(const failSecond of [false,true])test(`upload management confirms bulk deletion and preserves comparison data${failSecond?' through a partial failure':''}`,async({page})=>{
  let remote='',uploads=0,deletions=0,deleteRequests=0,failed=false,blobReads=0;
  let releaseRead:()=>void=()=>{};
  const readGate=new Promise<void>(resolve=>releaseRead=resolve);
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
    if(request.method()==='DELETE'){
      deleteRequests++;
      const path=decodeURIComponent(url.pathname.split('/contents/')[1]),body=request.postDataJSON() as {sha:string};
      expect(path).toContain('/fnt-snapshots/');expect(body.sha).toBe(files.get(path)!.sha);
      if(failSecond&&!failed&&deletions===1){failed=true;await route.fulfill({status:503,json:{message:'Invented interrupted delete'}});return;}
      files.delete(path);deletions++;await route.fulfill({json:{commit:{sha:'d'.repeat(40)}}});return;
    }
    if(url.pathname.includes('/contents/')){
      const path=decodeURIComponent(url.pathname.split('/contents/')[1]);
      if(files.has(path)){await route.fulfill({json:{sha:files.get(path)!.sha}});return;}
    }
    if(url.pathname.includes('/git/trees/')){await route.fulfill({json:{tree:[...files].map(([path,file])=>({path,sha:file.sha,type:'blob'})),truncated:false}});return;}
    if(url.pathname.includes('/git/blobs/')){
      if(++blobReads===1)await readGate;
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
  const comparison=page.frameLocator('iframe.comparison-frame');
  await expect(comparison.getByRole('heading',{name:'Compare versions',exact:true})).toBeVisible();
  expect(uploads).toBe(0);
  await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  const reopened=page.getByRole('dialog',{name:'Recovery',exact:true});
  await expect(reopened.getByRole('button',{name:'Upload local data to GitHub',exact:true})).toBeDisabled();
  await expect(reopened.getByText('Import or restore',{exact:true})).toBeVisible();
  await expect(reopened.locator('#import')).toBeHidden();
  await page.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  for(const [name,value]of [['owner','example'],['repo','private-test'],['branch','main'],['path','private/synthetic.json'],['token','invented-token']])await page.locator(`#sync-${name}`).fill(value);
  await page.getByRole('button',{name:'Connect & sync now',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/conflict/i);
  const local=()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;return {book:JSON.stringify(state.book),pending:state.pending,remoteSha:state.remoteSha};}finally{store.close();}
  });
  const before=await local();
  await expect(page.getByRole('dialog',{name:'Sync conflict - choose deliberately',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  const recovery=page.getByRole('dialog',{name:'Recovery',exact:true});
  await recovery.getByRole('button',{name:'Upload local data to GitHub',exact:true}).click();
  const upload=page.getByRole('dialog',{name:'Upload local data to GitHub',exact:true});
  await upload.locator('#snapshot-device').fill('Phone');
  await upload.getByRole('button',{name:'Upload local data to GitHub',exact:true}).click();
  await expect(upload.locator('#snapshot-upload-status')).toContainText('[Phone]');
  await upload.locator('#snapshot-device').fill('Desktop');
  await upload.getByRole('button',{name:'Upload another snapshot',exact:true}).click();
  await expect(upload.locator('#snapshot-upload-status')).toContainText('[Desktop]');
  expect(uploads).toBe(2);expect(await local()).toEqual(before);
  await upload.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(recovery).toBeVisible();await expect(page.locator('#save-state')).toContainText(/conflict/i);
  await recovery.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
  await expect(comparison.locator('body')).toHaveAttribute('data-loading','false');
  await comparison.locator('#left-github').click();
  await expect(comparison.locator('.commit-header')).toHaveText('DateDevice');
  await expect(comparison.locator('.commit-popup summary')).toHaveCount(0);
  await expect(comparison.locator('.commit-popup>p')).toHaveCount(0);
  await expect(comparison.locator('[data-upload]')).toHaveCount(2);
  await expect(comparison.getByRole('button',{name:'Sync GitHub',exact:true})).toHaveCount(0);
  const option=comparison.getByRole('option').filter({hasText:'Phone'});
  await expect(option.locator('.snapshot-device')).toHaveText('Phone');
  await expect(option.locator('.snapshot-date')).toContainText(/\d{1,2}\/\d{1,2} @ \d{1,2}:\d{2}:\d{2}/);
  const date=(await option.locator('.snapshot-date').boundingBox())!,device=(await option.locator('.snapshot-device').boundingBox())!;
  expect(device.x).toBeGreaterThan(date.x);
  await option.click();
  await expect(comparison.locator('#left-local')).toBeDisabled();releaseRead();
  await expect(comparison.locator('#left-kind')).toHaveText('Phone upload');
  await expect(comparison.locator('body')).toHaveAttribute('data-loading','false');
  await comparison.locator('#left-local').click();
  await expect(comparison.locator('#left-source')).toHaveText('Current local workbook');expect(blobReads).toBe(1);expect(await local()).toEqual(before);
  await comparison.locator('#left-github').click();await comparison.getByRole('option').filter({hasText:'Phone'}).click();
  await expect(comparison.locator('#left-kind')).toHaveText('Phone upload');
  await comparison.locator('#keep-left button').click();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of');
  await comparison.locator('#left-github').click();await comparison.getByRole('button',{name:'Manage',exact:true}).click();
  await expect(comparison.locator('#upload-manager-rows tr')).toHaveCount(2);
  const trash=comparison.locator('#upload-manager-rows tr').first().getByRole('button');
  await expect(trash).toHaveClass('icon-button');
  const size=(await trash.boundingBox())!;expect(size.width).toBe(32);expect(size.height).toBe(32);
  await expect(trash.locator('svg')).toHaveAttribute('viewBox','0 0 24 24');
  await comparison.locator('#upload-manager-rows tr').filter({hasText:'Phone'}).getByRole('button').click();
  await comparison.getByRole('button',{name:'Cancel',exact:true}).click();expect(deletions).toBe(0);
  await comparison.getByRole('checkbox',{name:'Select all uploaded copies',exact:true}).check();
  await comparison.getByRole('button',{name:'Delete selected (2)',exact:true}).click();
  await comparison.getByRole('button',{name:'Cancel',exact:true}).click();expect(deletions).toBe(0);
  const phoneSelection=comparison.locator('#upload-manager-rows tr').filter({hasText:'Phone'}).getByRole('checkbox');
  await phoneSelection.uncheck();await expect(comparison.getByRole('button',{name:'Delete selected (1)',exact:true})).toBeVisible();
  await expect(comparison.getByRole('checkbox',{name:'Select all uploaded copies',exact:true})).toHaveJSProperty('indeterminate',true);
  await phoneSelection.check();await comparison.getByRole('button',{name:'Delete selected (2)',exact:true}).click();
  await comparison.getByRole('button',{name:'Delete from GitHub',exact:true}).click();
  if(failSecond){
    await expect(comparison.locator('#upload-delete-error')).toContainText('Deleted 1 of 2');
    await expect(comparison.getByRole('button',{name:'Delete from GitHub',exact:true})).toBeDisabled();
    await comparison.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(comparison.getByRole('button',{name:'Delete selected (1)',exact:true})).toBeDisabled();
    expect(deleteRequests).toBe(2);expect(deletions).toBe(1);
    await comparison.getByRole('button',{name:'Refresh uploads',exact:true}).click();
    await expect(comparison.getByRole('button',{name:'Delete selected (1)',exact:true})).toBeEnabled();
    await comparison.getByRole('button',{name:'Delete selected (1)',exact:true}).click();
    await comparison.getByRole('button',{name:'Delete from GitHub',exact:true}).click();
  }
  await expect(comparison.locator('#upload-manager-rows tr')).toHaveCount(0);expect(deletions).toBe(2);
  await expect(comparison.locator('#upload-delete-selected')).toBeHidden();
  await expect(comparison.locator('#left-kind')).toHaveText('Phone upload');
  await comparison.getByRole('button',{name:'Close upload manager',exact:true}).click();
  await comparison.locator('#left-github').click();await expect(comparison.locator('[data-upload]')).toHaveCount(0);
  await expect(comparison.locator('.dropdown-footer')).toBeVisible();
  expect(await local()).toEqual(before);expect(uploads).toBe(2);
});
