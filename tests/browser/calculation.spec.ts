import { expect,test } from '@playwright/test';

test('a manual override exposes Restore, survives reload and restores its exact user formula in one undoable step',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  const cell=page.locator('td[data-r="1"][data-c="5"]'),formula=page.locator('#formula');
  await cell.click();await expect(page.locator('#calculation-state')).toHaveText('Calculated');
  await formula.fill('=2*7');await page.locator('#formula').press('Enter');await expect(cell).toHaveText('14');
  await formula.fill('999');await page.locator('#formula').press('Enter');await expect(cell).toHaveText('999');await expect(page.locator('#calculation-state')).toContainText('Manual');
  await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();await cell.click();
  await page.getByRole('button',{name:'Restore calculation',exact:true}).click();await expect(cell).toHaveText('14');await expect(formula).toHaveValue('=(2*7)');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell).toHaveText('999');await page.getByRole('button',{name:'Restore calculation',exact:true}).click();await expect(cell).toHaveText('14');
});
test('Group & move to top moves a selected ingredient owning meal and collapses only details as one undoable action',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Meals',exact:true}).click();
  const cell=(r:number,c=0)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`);
  await cell(2,1).click();await page.getByRole('button',{name:'Meal / day',exact:true}).click();
  await page.locator('#block-label').fill('Invented second meal');await page.getByRole('button',{name:'Create explicit meal',exact:true}).click();await expect(cell(3)).toHaveText('Invented second meal');await expect(cell(3,3)).toHaveText('0');
  await page.locator('[data-row-select="3"]').hover();await page.locator('[data-insert-row="4"]').click();
  await cell(4,1).click();await page.locator('#formula').fill('Example lentils');await page.locator('#formula').press('Enter');
  await cell(4,2).click();await page.locator('#formula').fill('50');await page.locator('#formula').press('Enter');await expect(cell(4,3)).toHaveText('58');await expect(cell(3,3)).toHaveText('58');
  await cell(4,1).click();await page.getByRole('button',{name:'Meal / day',exact:true}).click();await page.getByRole('button',{name:'Group & move to top',exact:true}).click();
  await expect(cell(1)).toHaveText('Invented second meal');await expect(cell(2)).toHaveCount(0);await expect(cell(1,3)).toHaveText('58');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(3)).toHaveText('Invented second meal');await expect(cell(4,1)).toHaveText('Example lentils');
});
test('a meal header can be created from the table header without inventing an owning block',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Meals',exact:true}).click();
  await page.locator('td[data-r="0"][data-c="0"]').click();await page.getByRole('button',{name:'Meal / day',exact:true}).click();
  await expect(page.getByRole('button',{name:'Group & move to top',exact:true})).toBeDisabled();
  await page.locator('#block-label').fill('Invented empty final meal');await page.getByRole('button',{name:'Create explicit meal',exact:true}).click();
  await expect(page.locator('td[data-r="3"][data-c="0"]')).toHaveText('Invented empty final meal');await expect(page.locator('td[data-r="3"][data-c="3"]')).toHaveText('0');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('td[data-r="3"][data-c="0"]')).toHaveText('');
});
