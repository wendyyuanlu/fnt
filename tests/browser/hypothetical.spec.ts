import {expect,test,type Page} from '@playwright/test';

async function fixture(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets[0];
      s.groups=[{id:'summary',axis:'row',kind:'summary',members:s.rows.slice(1,4).map(r=>r.id),collapsed:false,label:'Summary'},
        {id:'col-summary',axis:'column',kind:'summary',members:s.columns.slice(1,4).map(c=>c.id),collapsed:false,label:'Columns'},
        {id:'plain',axis:'row',kind:'range',members:s.rows.slice(5,7).map(r=>r.id),collapsed:true,label:'Plain'}];
      for(let r=1;r<7;r++)s.cells[`${s.rows[r].id}:${s.columns[0].id}`]={value:`Example ${r}`};
      await store.save(state.book,state.version,'Synthetic hypothetical fixture');
    }finally{store.close();}
  });await page.reload();
}
async function snapshot(page:Page){
  await expect(page.locator('#save-state')).toContainText('Saved');
  return page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book;}finally{store.close();}});
}
test('row tags inherit, clear, persist and sit between the summary chevron and value',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+h');
  await expect(page.locator('td[data-c="0"] .hypothetical-badge')).toHaveCount(3);
  const s=(await snapshot(page)).sheets[0];expect(s.rows[1].hypothetical).toBe(true);expect(s.rows[2].hypothetical).toBeUndefined();expect(s.cells).toEqual(before.sheets[0].cells);
  const cell=page.locator('td[data-r="1"][data-c="0"]'),chevron=(await cell.locator('.summary-chevron').boundingBox())!,badge=(await cell.locator('.hypothetical-badge').boundingBox())!,value=(await cell.locator('.cell-value').boundingBox())!;
  expect(badge.x).toBeGreaterThanOrEqual(chevron.x+chevron.width);expect(value.x).toBeGreaterThanOrEqual(badge.x+badge.width);
  await page.reload();await expect(page.locator('td[data-c="0"] .hypothetical-badge')).toHaveCount(3);
  await page.locator('[data-row-select="2"] .row-index').click();await page.keyboard.press('Control+Shift+h');await expect(page.locator('td[data-r="2"] .hypothetical-badge')).toHaveCount(0);
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+Shift+h');await expect(page.locator('.hypothetical-badge')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.hypothetical-badge')).toHaveCount(2);
});
test('column tags inherit and inherited row tags disappear when dragged out of a summary',async({page})=>{
  await fixture(page);
  const columnCell=page.locator('td[data-r="0"][data-c="1"]'),height=(await columnCell.boundingBox())!.height;
  await page.locator('th[data-col="1"] .column-index').click();await page.keyboard.press('Control+h');
  await expect(page.locator('td[data-r="0"] .hypothetical-badge')).toHaveCount(3);
  const chevron=(await columnCell.locator('.column-summary-controls .group-control').boundingBox())!,badge=(await columnCell.locator('.hypothetical-badge').boundingBox())!,value=(await columnCell.locator('.cell-value').boundingBox())!;
  expect(badge.x).toBeGreaterThanOrEqual(chevron.x+chevron.width);expect(value.x).toBeGreaterThanOrEqual(badge.x+badge.width);expect((await columnCell.boundingBox())!.height).toBe(height);
  await page.locator('th[data-col="1"] .column-index').click();await page.keyboard.press('Control+Shift+h');await expect(page.locator('.hypothetical-badge')).toHaveCount(0);
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+h');
  await page.locator('[data-row-select="2"] .row-index').click();await page.locator('[data-move-row="2"]').click();await page.locator('[data-insert-row="9"]').click();
  const s=(await snapshot(page)).sheets[0],moved=s.rows.findIndex(row=>s.cells[`${row.id}:${s.columns[0].id}`]?.value==='Example 2');
  await expect(page.locator(`td[data-r="${moved}"] .hypothetical-badge`)).toHaveCount(0);expect(s.rows[moved].hypothetical).toBeUndefined();
});
test('ungrouping all plain groups is checkpointed and undoable without touching cells or summaries',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.getByRole('button',{name:'Group controls',exact:true}).click();await page.getByRole('button',{name:'Manage groups',exact:true}).click();
  await page.getByRole('button',{name:'Ungroup all plain groups (workbook)',exact:true}).click();
  const after=await snapshot(page);expect(after.sheets[0].groups).toEqual(before.sheets[0].groups.filter(g=>g.kind==='summary'));expect(after.sheets[0].cells).toEqual(before.sheets[0].cells);
  const saved=await page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.history()).some(item=>item.label==='Before ungrouping all plain groups');}finally{store.close();}});expect(saved).toBe(true);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshot(page)).sheets[0].groups).toEqual(before.sheets[0].groups);
});
