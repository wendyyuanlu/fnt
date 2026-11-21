import {expect,test,type Page} from '@playwright/test';

const cell=(page:Page,r:number,c:number)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`);
async function fixture(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets.find(s=>s.name==='Notebook')!;
      for(let r=2;r<8;r++)for(let c=2;c<10;c++)s.cells[s.rows[r].id+':'+s.columns[c].id]={value:`r${r}c${c}`};
      await store.save(state.book,state.version,'Synthetic selection values');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
}
async function snapshot(page:Page){
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book.sheets.find(s=>s.name==='Notebook')!;}finally{store.close();}
  });
}
test('Ctrl adds cells to a four-cell Shift range and edits only selected cells',async({page})=>{
  await fixture(page);
  await cell(page,2,2).click();await cell(page,2,5).click({modifiers:['Shift']});
  await expect(page.locator('.selection-count')).toHaveText('4 cells');
  await page.keyboard.down('Control');await cell(page,4,7).click();await cell(page,6,8).click();await page.keyboard.up('Control');
  await expect(page.locator('.selection-count')).toHaveText('6 cells');
  await expect(cell(page,3,3)).not.toHaveClass(/selected/);
  await page.getByRole('button',{name:'Bold',exact:true}).click();
  for(const [r,c] of [[2,2],[2,3],[2,4],[2,5],[4,7],[6,8]])await expect(cell(page,r,c)).toHaveCSS('font-weight','700');
  await expect(cell(page,3,3)).not.toHaveCSS('font-weight','700');
  await page.locator('#grid-scroll').focus();await page.keyboard.press('Delete');
  for(const [r,c] of [[2,2],[2,3],[2,4],[2,5],[4,7],[6,8]])await expect(cell(page,r,c)).toHaveText('');
  await expect(cell(page,3,3)).toHaveText('r3c3');
  await cell(page,3,3).click();await expect(page.locator('.selection-count')).toHaveText('1 cells');
});
test('Ctrl can add whole rows and columns to an existing Shift cell selection',async({page})=>{
  await fixture(page);await cell(page,2,2).click();await cell(page,2,5).click({modifiers:['Shift']});
  await page.keyboard.down('Control');await page.locator('[data-row-select="4"] .row-index').click();await page.locator('th[data-col="8"] .column-index').click();await page.keyboard.up('Control');
  await expect(page.locator('.selection-count')).toHaveText('119 cells');
  await expect(cell(page,4,3)).toHaveClass(/selected/);await expect(cell(page,5,8)).toHaveClass(/selected/);await expect(cell(page,3,3)).not.toHaveClass(/selected/);
  await page.getByRole('button',{name:'Italic',exact:true}).click();
  await expect(cell(page,2,3)).toHaveCSS('font-style','italic');await expect(cell(page,4,3)).toHaveCSS('font-style','italic');await expect(cell(page,5,8)).toHaveCSS('font-style','italic');
  await expect(cell(page,3,3)).not.toHaveCSS('font-style','italic');
});
test('moving nonconsecutive selected rows leaves the intervening row untouched',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.locator('[data-row-select="2"] .row-index').click();await page.locator('[data-row-select="4"] .row-index').click({modifiers:['Control']});
  await page.locator('[data-move-row="2"]').click();await expect(cell(page,3,3)).not.toHaveClass(/moving/);
  await page.locator('[data-insert-row="8"]').click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const after=await snapshot(page);expect(after.rows.slice(6,8).map(r=>r.id)).toEqual([before.rows[2].id,before.rows[4].id]);expect(after.cells).toEqual(before.cells);
});
test('moving nonconsecutive selected columns does not move or select their gap',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.locator('th[data-col="3"] .column-index').click();await page.locator('th[data-col="5"] .column-index').click({modifiers:['Control']});
  await expect(cell(page,3,4)).not.toHaveClass(/selected/);
  await page.locator('[data-move-column="3"]').click();await expect(cell(page,3,4)).not.toHaveClass(/moving/);
  await page.locator('[data-insert-column="8"]').click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const after=await snapshot(page);expect(after.columns.slice(6,8).map(c=>c.id)).toEqual([before.columns[3].id,before.columns[5].id]);expect(after.cells).toEqual(before.cells);
});
test('arrow keys commit in-cell drafts and immediately select the surrounding cell',async({page})=>{
  await fixture(page);await expect(page.locator('#formula-form > button')).toHaveCount(0);
  for(const [key,r,c] of [['ArrowLeft',4,3],['ArrowRight',4,5],['ArrowUp',3,4],['ArrowDown',5,4]] as const){
    await cell(page,4,4).click();await page.keyboard.press('F2');
    await page.getByRole('textbox',{name:'Edit selected cell',exact:true}).fill('=2+3');
    await page.keyboard.press(key);
    await expect(cell(page,4,4)).toHaveText('5');await expect(cell(page,r,c)).toHaveClass(/active/);await expect(page.locator('.cell-inline-editor')).toHaveCount(0);
  }
  await expect(cell(page,4,4)).toHaveCSS('white-space','nowrap');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await expect(cell(page,4,4)).toHaveText('5');
});
test('a rejected header rename prevents arrow navigation and preserves its draft',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets.find(s=>s.name==='Notebook')!;
      state.book.tables.push({id:'selection-guard',name:'SelectionTest',sheet:s.id,header:s.rows[2].id,rows:[s.rows[3].id],columns:[{id:'selection-first',column:s.columns[2].id,name:'r2c2'},{id:'selection-second',column:s.columns[3].id,name:'r2c3'}]});
      await store.save(state.book,state.version,'Synthetic header guard');
    }finally{store.close();}
  });
  await page.reload();await cell(page,2,2).click();await page.keyboard.press('F2');
  const editor=page.getByRole('textbox',{name:'Edit selected cell',exact:true});await editor.fill('r2c3');await editor.press('ArrowRight');
  await expect(cell(page,2,2)).toHaveClass(/active/);await expect(editor).toHaveValue('r2c3');await expect(page.locator('#error')).toBeVisible();
  await page.keyboard.press('Escape');await expect(cell(page,2,2)).toHaveText('r2c2');
});
test('disjoint copying reports an explicit error instead of including unselected cells',async({page})=>{
  await fixture(page);await cell(page,2,2).click();await cell(page,4,7).click({modifiers:['Control']});
  await page.getByRole('button',{name:'Copy',exact:true}).click();
  await expect(page.locator('#error')).toContainText('one rectangular range');await expect(cell(page,3,3)).not.toHaveClass(/copying/);
});
