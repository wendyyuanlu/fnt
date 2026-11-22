import {expect,test,type Page} from '@playwright/test';

async function fixture(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const model='/src/model.ts',storage='/src/storage.ts',{setInput,key}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=book.sheets.find(s=>s.name==='Notebook')!,t=book.tables.find(t=>t.name==='Ingredients')!,ingredients=book.sheets.find(s=>s.id===t.sheet)!;
      setInput(book,ingredients,t.rows[0],t.columns[0].column,'Cottage linked');
      for(const [r,value]of [[1,'Cottage cheese'],[2,'cottage cheese'],[3,'Cottage'],[4,'="Cottage cheese"']] as const)setInput(book,s,s.rows[r].id,s.columns[1].id,value);
      s.cells[key(s.rows[5].id,s.columns[1].id)]={binding:{table:t.id,row:t.rows[0],column:t.columns[0].id}};
      await store.save(book,state.version,'Synthetic Find fixture');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.keyboard.press('Control+f');await expect(page.getByRole('dialog')).toBeVisible();
}
test('Find has no replacement DOM, preserves replacement drafts and keeps a fixed height',async({page})=>{
  await fixture(page);const dialog=page.getByRole('dialog'),height=(await dialog.boundingBox())!.height;
  expect(height).toBeGreaterThan(700);await expect(page.locator('#replace-label')).toHaveCount(0);
  await page.locator('#find-text').fill('Cottage');await expect(page.locator('#find-count')).toHaveText('Results found (5)');
  expect((await dialog.boundingBox())!.height).toBe(height);
  await page.getByRole('tab',{name:'Replace',exact:true}).click();await page.locator('#replace-text').fill('Fresh');
  expect((await dialog.boundingBox())!.height).toBe(height);
  await page.getByRole('tab',{name:'Find',exact:true}).click();await expect(page.locator('#replace-label')).toHaveCount(0);
  await page.getByRole('tab',{name:'Replace',exact:true}).click();await expect(page.locator('#replace-text')).toHaveValue('Fresh');
  await page.keyboard.press('Control+f');await expect(page.locator('#find-text')).toBeFocused();
  await page.locator('#find-text').fill('no matches');await expect(page.locator('#find-count')).toHaveText('Results found (0)');
  expect((await dialog.boundingBox())!.height).toBe(height);
});
test('All scope stays synchronized, and results have sheet subheaders rather than a Sheet column',async({page})=>{
  await fixture(page);await page.locator('#find-text').fill('Cottage');
  await expect(page.locator('.find-scope label').first()).toHaveText('All');
  const all=page.getByRole('checkbox',{name:'All',exact:true});expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBe(true);
  await all.check();await expect(all).toBeChecked();await expect(page.locator('#find-count')).not.toHaveText('Results found (5)');
  const selected=await page.locator('input[name=scope]').evaluateAll(inputs=>inputs.every(input=>(input as HTMLInputElement).checked));expect(selected).toBe(true);
  await expect(page.locator('.find-results-table thead th')).toHaveText(['Cell','Value']);
  const names=await page.locator('.find-sheet-header').allTextContents();expect(new Set(names).size).toBe(names.length);expect(names).toContain('Notebook');
  await page.getByRole('checkbox',{name:'Notebook',exact:true}).uncheck();expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBe(true);
  await all.check();await all.uncheck();await expect(page.locator('#find-count')).toHaveText('Results found (0)');await expect(page.locator('#find-feedback')).toContainText('Select at least one sheet');
});
test('case, whole-cell and wildcard searches work, and Find next honors direction',async({page})=>{
  await fixture(page);await page.locator('#find-text').fill('Cottage');
  await page.getByRole('checkbox',{name:'Match case',exact:true}).check();await expect(page.locator('#find-count')).toHaveText('Results found (4)');
  await page.getByRole('checkbox',{name:'Match entire cell contents',exact:true}).check();await expect(page.locator('#find-count')).toHaveText('Results found (1)');
  await page.locator('#find-text').fill('Cott?ge*');await expect(page.locator('#find-count')).toHaveText('Results found (4)');
  await page.getByRole('checkbox',{name:'Match case',exact:true}).uncheck();
  await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.locator('.address')).toHaveText('B2');
  await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.locator('.address')).toHaveText('B3');
  await page.locator('#find-direction').selectOption('up');await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.locator('.address')).toHaveText('B2');
});
test('Replace and Replace all preserve formulas and linked source identities',async({page})=>{
  await fixture(page);await page.locator('#find-text').fill('Cottage');await page.getByRole('tab',{name:'Replace',exact:true}).click();await page.locator('#replace-text').fill('Fresh');
  await page.getByRole('button',{name:'Replace',exact:true}).click();await expect(page.locator('#find-count')).toHaveText('Results found (4)');
  await page.getByRole('button',{name:'Replace all',exact:true}).click();await expect(page.locator('#find-count')).toHaveText('Results found (2)');await expect(page.locator('#find-feedback')).toContainText('2 other results left unchanged');
  await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.locator('#save-state')).toContainText('Saved');
  await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Fresh cheese');await expect(page.locator('td[data-r="4"][data-c="1"]')).toHaveText('Cottage cheese');await expect(page.locator('td[data-r="5"][data-c="1"]')).toHaveText('Cottage linked');
  const kinds=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const {book}=(await store.load())!,s=book.sheets.find(s=>s.name==='Notebook')!;return [s.cells[`${s.rows[4].id}:${s.columns[1].id}`].formula?.kind,!!s.cells[`${s.rows[5].id}:${s.columns[1].id}`].binding];}finally{store.close();}
  });expect(kinds).toEqual(['literal',true]);
});
test('Ctrl+F commits an in-cell draft before opening the search dialog',async({page})=>{
  await fixture(page);await page.getByRole('button',{name:'Close dialog'}).click();
  await page.locator('td[data-r="6"][data-c="2"]').click();await page.keyboard.type('committed search draft');await page.keyboard.press('Control+f');
  await expect(page.getByRole('dialog')).toBeVisible();await page.locator('#find-text').fill('committed search draft');await expect(page.locator('#find-count')).toHaveText('Results found (1)');
});
test('Find reuses the existing dialog field and button styles without overflowing the viewport',async({page})=>{
  await fixture(page);
  const style=async(selector:string)=>page.locator(selector).evaluate(el=>{
    const css=getComputedStyle(el);return {radius:css.borderRadius,border:css.borderColor,padding:css.padding,font:css.fontFamily,size:css.fontSize};
  });
  const find={input:await style('#find-text'),select:await style('#find-within'),button:await style('#find-next'),close:await style('.find-dialog .close')};
  await page.getByRole('button',{name:'Close dialog'}).click();await page.getByRole('button',{name:'Browse values',exact:true}).click();
  expect(await style('#browse-search')).toEqual(find.input);expect(await style('#browse-column')).toEqual(find.select);
  expect(await style('#browse-go')).toEqual(find.button);expect(await style('dialog .close')).toEqual(find.close);
  await page.getByRole('button',{name:'Close dialog'}).click();await page.keyboard.press('Control+f');await page.getByRole('tab',{name:'Replace',exact:true}).click();
  const bounds=await page.getByRole('dialog').boundingBox(),button=await page.locator('#replace-all').boundingBox(),viewport=page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(button!.x+button!.width).toBeLessThanOrEqual(bounds!.x+bounds!.width);
  expect(button!.y+button!.height).toBeLessThanOrEqual(bounds!.y+bounds!.height);
  await expect(page.locator('#find-all-sheets')).toBeInViewport();
});
