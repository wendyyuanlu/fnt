import { expect,test } from '@playwright/test';

test('production shell reloads offline, persists editable data and exports the native recovery XLSX',async({page,context})=>{
  await page.goto('http://127.0.0.1:4173');
  await expect(page.locator('td[data-r="1"][data-c="3"]')).toHaveText('208.8');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('td[data-r="1"][data-c="3"]')).toHaveText('208.8');
  await page.locator('td[data-r="1"][data-c="2"]').click();
  await page.getByRole('textbox',{name:'Cell value or formula',exact:true}).fill('100');
  await page.locator('#formula').press('Enter');
  await expect(page.locator('td[data-r="1"][data-c="3"]')).toHaveText('116');
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('td[data-r="1"][data-c="3"]')).toHaveText('116');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  await page.getByRole('button',{name:'Export Excel projection + embedded Fnt archive',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download private XLSX',exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);await expect(page.getByRole('dialog')).toHaveCount(0);
});
