import {expect,test,type Page} from '@playwright/test';

async function snapshot(page:Page){
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
}
async function fixture(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0];
      s.groups=[
        {id:'outer',axis:'row',kind:'summary',members:s.rows.slice(1,10).map(r=>r.id),collapsed:false,label:'Outer'},
        {id:'inner',axis:'row',kind:'summary',members:s.rows.slice(3,7).map(r=>r.id),collapsed:false,label:'Inner'},
        {id:'leaf',axis:'row',kind:'summary',members:s.rows.slice(4,6).map(r=>r.id),collapsed:false,label:'Leaf'},
        {id:'separate',axis:'row',kind:'summary',members:s.rows.slice(15,20).map(r=>r.id),collapsed:false,label:'Separate'},
        {id:'plain-row',axis:'row',kind:'range',members:s.rows.slice(10,12).map(r=>r.id),collapsed:false,label:'Notes'},
        {id:'col-outer',axis:'column',kind:'summary',members:s.columns.slice(0,9).map(c=>c.id),collapsed:false,label:'Nutrition'},
        {id:'col-inner',axis:'column',kind:'summary',members:s.columns.slice(1,3).map(c=>c.id),collapsed:false,label:'Macros'},
        {id:'plain-col',axis:'column',kind:'range',members:s.columns.slice(3,5).map(c=>c.id),collapsed:false,label:'Extras'}
      ];
      const notes=state.book.sheets.find(s=>s.name==='Notebook')!;
      notes.groups=[{id:'notebook-group',axis:'row',kind:'summary',members:notes.rows.slice(1,3).map(r=>r.id),collapsed:false,label:'Notebook notes'}];
      await store.save(state.book,state.version,'Synthetic outlines');
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('.group-menu-button')).toBeVisible();
  return snapshot(page);
}
async function menu(page:Page){
  if(!await page.locator('.group-popover').count())await page.getByRole('button',{name:'Group controls',exact:true}).click();
  return page.locator('.group-popover');
}
test('Option A retains summaries, independent branches, plain hints and formula identities',async({page})=>{
  const before=await fixture(page);
  await expect(page.locator('th[data-row-select="1"] [data-group-id="outer"]')).toBeVisible();
  expect(await page.locator('.grid col').first().evaluate(el=>el.getBoundingClientRect().width)).toBe(48);
  await expect(page.locator('th[data-col="2"] .plain-group-hints [data-group-id="plain-col"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="outer"]').click();
  await expect(page.locator('[data-row-select="1"]')).toBeVisible();await expect(page.locator('[data-row-select="3"]')).toHaveCount(0);
  await expect(page.locator('[data-row-select="15"]')).toHaveCount(1);
  await expect(page.locator('tr[data-row="1"] td:first-of-type .row-plain-hints [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="plain-row"]').click();
  await expect(page.locator('[data-row-select="10"],[data-row-select="11"]')).toHaveCount(0);
  await expect(page.locator('.grid [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="col-outer"]').click();
  await expect(page.locator('th[data-col="0"]')).toHaveCount(1);await expect(page.locator('th[data-col="2"]')).toHaveCount(0);
  await expect(page.locator('th[data-col="0"] .plain-group-hints [data-group-id="plain-col"]')).toBeVisible();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  await page.reload();await expect(page.locator('.grid [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="outer"]').click();await expect(page.locator('[data-row-select="3"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-row-select="3"]')).toHaveCount(0);
});
test('tree and hint preferences stay sheet-specific across re-renders, saves and reloads',async({page})=>{
  await fixture(page);await menu(page);await page.getByRole('switch',{name:'Tree view',exact:true}).click();
  await expect(page.locator('.grid')).toHaveClass(/tree-outline/);
  await expect(page.locator('.row-outline-rail')).not.toHaveCount(0);
  await expect(page.locator('.column-outline-row')).toHaveCount(2);
  await menu(page);await page.getByRole('switch',{name:'Plain group hints',exact:true}).click();
  await expect(page.locator('.row-plain-hints,.plain-group-hints')).toHaveCount(0);
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.keyboard.press('Escape');await expect(page.locator('.group-popover')).toHaveCount(0);await page.getByRole('button',{name:'Notebook',exact:true}).click();await menu(page);
  await expect(page.getByRole('switch',{name:'Plain group hints',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(page.getByRole('switch',{name:'Tree view',exact:true})).toHaveAttribute('aria-checked','false');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Daily log',exact:true}).click();
  await page.reload();await menu(page);
  await expect(page.getByRole('switch',{name:'Plain group hints',exact:true})).toHaveAttribute('aria-checked','false');
  await expect(page.getByRole('switch',{name:'Tree view',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('switch',{name:'Plain group hints',exact:true}).click();
  await page.locator('.group-popover [data-outline-axis="row"][data-outline-level="0"]').click();
  await expect(page.locator('.grid [data-group-id="plain-row"]')).toHaveCount(1);
  await page.keyboard.press('Escape');await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=2000;el.scrollLeft=400;});
  await expect(page.locator('tbody tr[data-row]')).not.toHaveCount(0);
  expect(await page.locator('.corner').evaluate(el=>el.getBoundingClientRect().height)).toBe(31);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;});
  await expect(page.locator('.grid [data-group-id="outer"]')).toBeVisible();
});
test('popover is content-sized, single levels omit duplicate controls and icons keep their shared styling',async({page})=>{
  await fixture(page);const popup=await menu(page);
  const large=await popup.evaluate(el=>el.getBoundingClientRect().width);
  const icons=await page.locator('.grid .group-control svg,.group-popover .group-control svg').evaluateAll(elements=>elements.map(el=>({size:el.getBoundingClientRect().width,header:!!el.closest('.grid'),stroke:el.getAttribute('stroke-width'),effect:getComputedStyle(el.querySelector('path')!).vectorEffect})));
  for(const icon of icons){expect(icon.size).toBe(icon.header?14:18);expect(icon.stroke).toBe('1');expect(icon.effect).toBe('non-scaling-stroke');}
  const toggles=page.locator('.group-popover .group-control');
  expect(await toggles.evaluateAll(elements=>elements.every(el=>getComputedStyle(el).backgroundColor==='rgb(255, 255, 255)'))).toBe(true);
  const rect=await popup.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(8);expect(rect!.x+rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width-7);
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;state.book.sheets[0].groups=state.book.sheets[0].groups.filter(g=>!['inner','leaf','col-inner'].includes(g.id));await store.save(state.book,state.version,'Single level');}finally{store.close();}
  });
  await page.reload();const small=await menu(page);
  await expect(small.locator('.outline-layer-grid strong')).toHaveText(['Rows','Columns']);
  await expect(small.locator('.outline-layer-grid button')).toHaveCount(2);
  expect(await small.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThan(large);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await expect(page.getByRole('button',{name:'Group controls',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Select all cells',exact:true})).toBeVisible();
});

  test('a plain group on a summary identity hides its entire group for both rows and columns',async({page})=>{
    const before=await fixture(page);
    for(const [axis,summary,child] of [['row','outer','inner'],['column','col-outer','col-inner']] as const){
      await page.locator(`.grid [data-group-id="${child}"]`).click();
      await page.locator(axis==='row'?'[data-row-select="1"] .row-index':'th[data-col="0"]').click();
      await page.keyboard.press('Control+Alt+g');await expect(page.locator('#save-state')).toContainText(/^Saved/);
      const sheet=(await snapshot(page)).sheets[0],plain=sheet.groups.at(-1)!;
      expect(plain.axis).toBe(axis);expect(plain.kind).toBe('range');expect(plain.members).toHaveLength(1);
      await page.locator(`.grid [data-group-id="${plain.id}"]`).click();
      await expect(page.locator(axis==='row'?'[data-row-select="1"],[data-row-select="2"],[data-row-select="9"]':'th[data-col="0"],th[data-col="1"],th[data-col="8"]')).toHaveCount(0);
      await expect(page.locator(`.grid [data-group-id="${plain.id}"]`)).toBeVisible();
      await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
      await expect(page.locator(axis==='row'?'[data-row-select="1"]':'th[data-col="0"]')).toHaveCount(0);
      await page.locator(`.grid [data-group-id="${plain.id}"]`).click();
      await expect(page.locator(axis==='row'?'[data-row-select="1"]':'th[data-col="0"]')).toHaveCount(1);
      await expect(page.locator(axis==='row'?'[data-row-select="4"]':'th[data-col="2"]')).toHaveCount(0);
      await expect(page.locator('#save-state')).toContainText(/^Saved/);
      const groups=(await snapshot(page)).sheets[0].groups;
      expect(groups.find(g=>g.id===summary)!.collapsed).toBe(false);expect(groups.find(g=>g.id===child)!.collapsed).toBe(true);
    }
    expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  });

  test('group manager shows group types, real cell previews and affected coordinates without obscuring the sheet',async({page})=>{
    const before=await fixture(page);
    await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+Alt+g');
    await expect(page.locator('#save-state')).toContainText(/^Saved/);const plain=(await snapshot(page)).sheets[0].groups.at(-1)!;
    await menu(page);await page.getByRole('button',{name:'Manage groups',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'Groups on Daily log',exact:true}),card=panel.locator(`[data-group-card="${plain.id}"]`);
    await expect(panel).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(panel).toContainText('keeps its summary row/column visible');await expect(panel).toContainText('hides all its members');
    await expect(card).toContainText('Plain group');await expect(card).toContainText('Rows 2-10');await expect(card).toContainText('Selected rows 2 includes a summary');
    await expect(card.locator('tbody th')).toHaveText(['2','3','4','10']);
    await expect(panel.locator('[data-group-card="outer"]')).toContainText('Summary row 2 stays visible');
    await card.getByRole('button',{name:'Locate on sheet',exact:true}).click();await expect(page.locator('[data-row-select="1"]')).toHaveClass(/group-located/);
    await card.getByRole('button',{name:'Hide group',exact:true}).click();await expect(card).toContainText('All 9 rows hidden');
    await expect(page.locator('[data-row-select="1"]')).toHaveCount(0);
    await card.getByRole('button',{name:'Show group',exact:true}).click();await expect(page.locator('[data-row-select="1"]')).toHaveCount(1);
    await panel.getByRole('button',{name:'Close group manager',exact:true}).click();await expect(panel).toHaveCount(0);await expect(page.locator('.group-located')).toHaveCount(0);
    await expect(page.locator('#save-state')).toContainText(/^Saved/);
    expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  });
