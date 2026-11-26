import {expect,test} from '@playwright/test';
import {createDemo,key} from '../../src/model';

test('published Recovery uses the visual comparison, supports choice drafts and works offline',async({page,context})=>{
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
  await comparison.locator('#left-file').setInputFiles({name:'invented-left.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(left))});
  await comparison.locator('#right-file').setInputFiles({name:'invented-right.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(right))});
  await expect(comparison.locator('#right-grid')).toContainText('Invented deployed comparison');
  await expect(comparison.locator('#first-cell')).toBeChecked();
  expect(await comparison.locator('#left-grid').evaluate(element=>getComputedStyle(element,'::-webkit-scrollbar').width)).toBe('4px');
  await comparison.locator('#keep-right button').click();
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await comparison.locator('#first-cell').uncheck();
  await expect(comparison.locator('.grid-scroll .row-identity')).toHaveCount(0);
  await expect(comparison.locator('#selection-progress')).toContainText('1 of 1 chosen');
  await comparison.locator('#first-cell').check();
  await comparison.locator('#review-choices').click();
  await expect(comparison.locator('#choice-review')).toContainText('Selection UI only, not a merged workbook');
  await comparison.getByRole('button',{name:'Close selection review',exact:true}).click();
  await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();
  await expect(page.locator('.comparison-view')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveJSProperty('inert',false);
  await context.setOffline(true);
  try{
    await page.getByRole('button',{name:'Recovery',exact:true}).click();
    await page.getByRole('button',{name:'Compare versions for merge conflict',exact:true}).click();
    await expect(comparison.getByRole('heading',{name:'Compare versions',exact:true})).toBeVisible();
    await expect(comparison.locator('#totals')).toContainText('Choose a right copy');
    await comparison.getByRole('button',{name:'Back to workbook',exact:true}).click();
  }finally{await context.setOffline(false);}
  expect(githubRequests).toBe(0);
});

test('standalone published comparison never loads private prototype files',async({page})=>{
  const privateFiles:string[]=[];
  page.on('request',request=>{if(/\/(?:left|right|source-meta)\.json(?:\?|$)/.test(request.url()))privateFiles.push(request.url());});
  await page.goto('http://127.0.0.1:4184/comparison.html');
  await expect(page.locator('#error')).toContainText('Open Compare versions from Recovery');
  expect(privateFiles).toEqual([]);
});
