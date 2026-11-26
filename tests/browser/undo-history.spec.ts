import {expect,test} from '@playwright/test';

test('an older autosave cannot report newer pending edits as saved',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.locator('td[data-r="0"][data-c="0"]').click();
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),save=Store.prototype.saveChanges;
    let calls=0;
    Store.prototype.saveChanges=async function(...args:Parameters<typeof save>){
      const call=++calls;document.documentElement.dataset.autosavePending=String(call);
      if(call<=2)await new Promise<void>(resolve=>document.addEventListener(`release-autosave-${call}`,()=>resolve(),{once:true}));
      return save.apply(this,args);
    };
  });
  const formula=page.locator('#formula');
  await formula.fill('First pending value');await formula.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-autosave-pending','1');
  await page.locator('td[data-r="0"][data-c="0"]').click();
  await formula.fill('Latest pending value');await formula.press('Enter');
  await page.evaluate(()=>{
    const status=document.querySelector('#save-state')!;
    new MutationObserver(()=>{if(status.textContent?.startsWith('Saved'))document.documentElement.dataset.prematureSaved='true';}).observe(status,{subtree:true,childList:true,characterData:true});
    document.dispatchEvent(new Event('release-autosave-1'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-autosave-pending','2');
  expect(await page.locator('html').getAttribute('data-premature-saved')).toBeNull();
  await expect(page.locator('#save-state')).not.toContainText('Saved');
  await page.evaluate(()=>document.dispatchEvent(new Event('release-autosave-2')));
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('Latest pending value');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('First pending value');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('Latest pending value');
});

test('deep mixed undo and redo survive reloads and a new edit clears the redo branch',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('td[data-r="0"][data-c="0"]').click();
  const original=await page.locator('#formula').inputValue();
  const rename=async()=>{await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.getByRole('button',{name:'Rename workbook',exact:true}).click();};
  await rename();const title=await page.locator('#answer').inputValue();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('td[data-r="0"][data-c="0"]').click();
  for(let i=1;i<=45;i++){
    await page.locator('td[data-r="0"][data-c="0"]').click();
    await page.locator('#formula').fill('History value '+i);await page.locator('#formula').press('Enter');
  }
  for(let i=1;i<=6;i++){
    await rename();await page.getByLabel('Name',{exact:true}).fill('History title '+i);
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
  await expect(undo()).toBeDisabled();await rename();await expect(page.locator('#answer')).toHaveValue(title);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.locator('#formula')).toHaveValue(original);
  await page.locator('td[data-r="0"][data-c="0"]').click();
  await page.locator('#formula').fill('New branch');await page.locator('#formula').press('Enter');await expect(redo()).toBeDisabled();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await expect(redo()).toBeDisabled();
});
