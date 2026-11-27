import {expect,test} from '@playwright/test';
import {createDemo,key} from '../../src/model';
import type {ComparisonFrame} from '../../src/comparison-host';

test('published Recovery confirms real replacement, preserves review navigation and works offline',async({page,context})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let githubRequests=0;
  await page.route('https://api.github.com/**',async route=>{githubRequests++;await route.abort();});
  const left=createDemo(),right=structuredClone(left),sheet=right.sheets[0];
  sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:'Invented deployed comparison'};
  await page.goto('http://127.0.0.1:4184/');
  await expect(page.locator('#save-state')).toContainText('Saved',{timeout:15000});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller),{timeout:15000}).toBe(true);
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
  const comparison=page.frameLocator('iframe.comparison-frame');
  await expect(page.locator('#app')).toHaveJSProperty('inert',true);
  await expect(comparison.locator('#totals')).toContainText('Choose a right copy');
  await expect(comparison.locator('#left-file')).toBeEnabled();
  await comparison.locator('#left-file').setInputFiles({name:'invented-left.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(left))});
  await expect(comparison.locator('#right-file')).toBeEnabled();
  await comparison.locator('#right-file').setInputFiles({name:'invented-right.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(right))});
  await expect(comparison.locator('#right-grid')).toContainText('Invented deployed comparison');
  await expect(comparison.locator('#first-cell')).toBeChecked();
  expect(await comparison.locator('#left-grid').evaluate(element=>getComputedStyle(element,'::-webkit-scrollbar').width)).toBe('4px');
  await comparison.locator('#keep-right button').click();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await comparison.locator('#first-cell').uncheck();
  await context.setOffline(true);
  try{
    await page.reload();
    await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
    await expect(comparison.locator('#left-source')).toHaveText('invented-left.json');
    await expect(comparison.locator('#right-source')).toHaveText('invented-right.json');
    await expect(comparison.locator('#first-cell')).not.toBeChecked();
  }finally{await context.setOffline(false);}
  await expect(comparison.locator('.grid-scroll .row-identity')).toHaveCount(0);
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await comparison.locator('#first-cell').check();
  await comparison.locator('#review-choices').click();
  await expect(comparison.locator('#choice-review')).toContainText('nothing changes until you confirm');
  await expect(comparison.locator('#review-submit')).toBeEnabled();
  await comparison.locator('#review-submit').click();
  await expect(comparison.locator('#submit-confirmation')).toBeVisible();
  await comparison.locator('#submit-review').click();
  await expect(comparison.locator('#choice-review')).toBeVisible();
  await comparison.getByRole('button',{name:'Close selection review',exact:true}).click();
  const review=await comparison.locator('#review-choices').boundingBox(),submit=await comparison.locator('#submit-decision').boundingBox();
  expect(submit!.x).toBeGreaterThan(review!.x);expect(submit!.y).toBe(review!.y);
  expect(await comparison.locator('#submit-decision').evaluate(button=>getComputedStyle(button).fontWeight)).toBe('700');
  await comparison.locator('#submit-decision').click();
  await comparison.locator('#submit-back').click();
  await expect(comparison.locator('#submit-confirmation')).toBeHidden();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await comparison.locator('#submit-decision').click();
  await comparison.locator('#apply-selection').click();
  expect(errors).toEqual([]);
  await expect(page.locator('.comparison-view')).toHaveCount(0,{timeout:45000});
  await expect(page.locator('#app')).toHaveJSProperty('inert',false);
  await expect(page.locator('#save-state')).toContainText('Selected data saved locally');
  await expect(page.locator('#grid-scroll')).toContainText('Invented deployed comparison');
  await page.reload();
  await expect(page.locator('#grid-scroll')).toContainText('Invented deployed comparison',{timeout:15000});
  await context.setOffline(true);
  try{
    await page.getByRole('button',{name:'Recovery',exact:true}).click();
    await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
    await expect(comparison.getByRole('heading',{name:'Compare versions',exact:true})).toBeVisible();
    await expect(comparison.locator('#totals')).toContainText('Choose a right copy');
    const offlineRight=await page.locator('iframe.comparison-frame').evaluate(frame=>{
      const host=(frame as ComparisonFrame).comparisonHost;
      if(!host)throw Error('The synthetic production comparison host is missing.');
      return structuredClone(host.local.book);
    });
    const offlineSheet=offlineRight.sheets[0],offlineCell=key(offlineSheet.rows[1].id,offlineSheet.columns[0].id);
    offlineSheet.cells[offlineCell]={...offlineSheet.cells[offlineCell],value:'Invented older offline value'};
    await comparison.locator('#left-file').setInputFiles({name:'invented-left.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(left))});
    await expect(comparison.locator('#left-source')).toHaveText('invented-left.json');
    await comparison.getByRole('button',{name:"Use this device's local changes",exact:true}).click();
    await expect(comparison.locator('#left-source')).toHaveText('Current local workbook');
    await comparison.locator('#right-file').setInputFiles({name:'invented-right.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(offlineRight))});
    await expect(comparison.locator('#left-grid')).toContainText('Invented deployed comparison');
    await expect(comparison.locator('#selection-progress')).toContainText('0 of 1 chosen');
    await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();
  }finally{await context.setOffline(false);}
  expect(githubRequests).toBe(0);
});

test('standalone published comparison never loads private prototype files',async({page})=>{
  const privateFiles:string[]=[];
  page.on('request',request=>{if(/\/(?:left|right|source-meta)\.json(?:\?|$)/.test(request.url()))privateFiles.push(request.url());});
  await page.goto('http://127.0.0.1:4184/comparison.html');
  await expect(page.locator('#error')).toContainText('Open Compare versions from Recovery');
  await expect(page.locator('#left-local')).toHaveCount(0);
  expect(privateFiles).toEqual([]);
});
