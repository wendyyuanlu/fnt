import {expect,test} from '@playwright/test';

test('deep mixed undo and redo survive reloads and a new edit clears the redo branch',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('td[data-r="0"][data-c="0"]').click();
  const original=await page.locator('#formula').inputValue(),title=await page.locator('#title').textContent();
  for(let i=1;i<=45;i++){
    await page.locator('#formula').fill('History value '+i);await page.locator('#formula').press('Enter');
  }
  for(let i=1;i<=6;i++){
    await page.locator('#title').click();await page.getByLabel('Name',{exact:true}).fill('History title '+i);
    await page.getByRole('button',{name:'Apply',exact:true}).click();
  }
  const undo=()=>page.getByRole('button',{name:'Undo',exact:true}),redo=()=>page.getByRole('button',{name:'Redo',exact:true});
  await expect(undo()).toHaveAttribute('data-history-count','51');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(undo()).toHaveAttribute('data-history-count','51');
  for(let i=0;i<5;i++)await undo().click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(undo()).toHaveAttribute('data-history-count','46');await expect(redo()).toHaveAttribute('data-history-count','5');
  await redo().click();await redo().click();
  for(let i=0;i<48;i++)await undo().click();
  await expect(undo()).toBeDisabled();await expect(page.locator('#title')).toHaveText(title!);
  await expect(page.locator('#formula')).toHaveValue(original);
  await page.locator('#formula').fill('New branch');await page.locator('#formula').press('Enter');await expect(redo()).toBeDisabled();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await expect(redo()).toBeDisabled();
});
