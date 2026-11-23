import {expect,test} from '@playwright/test';

test('normal local development opens the current review workbook instead of the original demo',async({page,request})=>{
  const url=process.env.FNT_LOCAL_URL??'http://127.0.0.1:5173/';
  const version=await request.get(url+'testing-workbook-version.json');
  expect(version.ok()).toBe(true);
  expect(await version.json()).toMatchObject({format:'fnt-published-version',version:1,id:expect.any(String)});
  await page.goto(url);
  await expect(page.locator('#save-state')).toContainText('Saved');
  for(const name of ['Ingredients','Meals','Meal TEST DATA','Daily log','Notebook TEST']){
    await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  }
  await expect(page.getByRole('button',{name:'Notebook',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>navigator.serviceWorker.controller===null)).toBe(true);
  const fullWorkbookRequests:string[]=[];
  page.on('request',request=>{if(request.url().endsWith('/testing-workbook.json'))fullWorkbookRequests.push(request.url());});
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  expect(fullWorkbookRequests).toEqual([]);
});
