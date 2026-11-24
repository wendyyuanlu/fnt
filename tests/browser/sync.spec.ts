import { expect,test } from '@playwright/test';

test('sync holds a source-edit lock until remote acknowledgment, then restores editing',async({page})=>{
  let release:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('https://api.github.com/**',async route=>{
    if(route.request().method()==='PUT'){
      await gate;await route.fulfill({json:{content:{sha:'acknowledged'}}});return;
    }
    await route.fulfill(route.request().url().includes('/contents/')?{status:404,json:{message:'Not found'}}:{json:{private:true,has_pages:false}});
  });
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.getByRole('button',{name:'Private GitHub sync',exact:true}).click();
  for(const [name,value]of [['owner','example'],['repo','private-test'],['branch','main'],['path','synthetic.json'],['token','synthetic-test-token']]){
    await page.locator(`#sync-${name}`).fill(value);
  }
  await page.getByRole('button',{name:'Connect & sync now',exact:true}).click();
  await expect(page.locator('#save-state')).toHaveText('Syncing private repository...');
  await expect(page.locator('#formula')).toBeDisabled();
  await page.locator('#grid-scroll').focus();await page.keyboard.type('should not become a draft');
  await expect(page.locator('.cell-inline-editor')).toHaveCount(0);
  expect(await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const s=(await store.load())!.book.sheets[0];return s.cells[`${s.rows[1].id}:${s.columns[2].id}`].value;}finally{store.close();}
  })).toBe(180);
  release!();
  await expect(page.locator('#save-state')).toHaveText('Synced with private repository');
  await expect(page.locator('#formula')).toBeEnabled();
  await page.locator('#row-jump').fill('2');await page.locator('#row-jump').press('Enter');
  await expect(page.locator('td[data-r="1"][data-c="2"]')).toHaveText('180');
});
