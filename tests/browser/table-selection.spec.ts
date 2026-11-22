import {expect,test,type Locator,type Page} from '@playwright/test';

async function fixture(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const model='/src/model.ts',catalog='/src/dropdown-catalog.ts',storage='/src/storage.ts';
    const [{blankSheet,createDemo,key},{seedDropdownCatalog},{Store}]=await Promise.all([
      import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>,
      import(/* @vite-ignore */catalog) as Promise<typeof import('../../src/dropdown-catalog')>,
      import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>
    ]);
    const book=seedDropdownCatalog(createDemo()).book,sheet=blankSheet('Five tables',24,12);
    book.sheets.unshift(sheet);book.title='Synthetic table-selection fixture';
    sheet.columns.forEach(column=>column.width=82);
    sheet.groups=[{id:'outside-group',axis:'row',kind:'range',members:sheet.rows.slice(22).map(row=>row.id),collapsed:false,label:'Outside'}];
    for(const [name,r,c] of [['Top',2,1],['Middle',9,1],['Bottom',16,1],['Right',9,5],['Far-right',9,9]] as const){
      const table={id:'scope-'+name.toLowerCase(),name,sheet:sheet.id,header:sheet.rows[r].id,rows:sheet.rows.slice(r+1,r+5).map(row=>row.id),columns:sheet.columns.slice(c,c+3).map((column,i)=>({id:name+'-field-'+i,name:['Name','Qty','Note'][i],column:column.id}))};
      book.tables.push(table);
      for(const field of table.columns)sheet.cells[key(table.header,field.column)]={value:field.name};
      table.rows.forEach((row,i)=>table.columns.forEach(field=>sheet.cells[key(row,field.column)]={value:`${name} ${i+1} ${field.name}`}));
    }
    const store=await Store.open();try{const state=(await store.load())!;await store.save(book,state.version,'Synthetic multi-table selection');}finally{store.close();}
    sessionStorage.setItem('fnt-current-sheet',sheet.id);
  });
  await page.reload();await expect(page.locator('.grid')).toHaveAttribute('aria-label','Five tables');
}
async function snapshot(page:Page){
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
}
const activate=(locator:Locator,mobile:boolean)=>mobile?locator.tap():locator.click();
async function extend(page:Page,axis:'row'|'column',index:number,mobile:boolean){
  const target=page.locator(axis==='row'?`[data-row-select="${index}"] .row-index`:`th[data-col="${index}"] .column-index`);
  if(mobile){
    await page.locator('.selection-count').tap();
    await page.getByRole('button',{name:`Extend ${axis} selection on next header tap`,exact:true}).tap();
    await target.tap();
  }else await target.click({modifiers:['Shift']});
}
async function scopedSelection(page:Page,axis:'row'|'column',mobile:boolean){
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),mobile);
  await page.getByLabel('Table selection target').selectOption('scope-middle');
  await activate(page.locator(axis==='row'?'[data-row-select="10"] .row-index':'th[data-col="1"] .column-index'),mobile);
  await extend(page,axis,axis==='row'?12:3,mobile);
}
test('existing headers constrain selection, resolve shared axes, extend on touch and never add cell-edge targets',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await activate(page.locator('th[data-col="2"] .column-index'),isMobile);
  await expect(page.getByRole('dialog')).toContainText('Several tables');
  for(const name of ['Top','Middle','Bottom'])await expect(page.getByRole('dialog').getByRole('button',{name,exact:true})).toBeVisible();
  await activate(page.getByRole('dialog').getByRole('button',{name:'Middle',exact:true}),isMobile);
  await expect(page.locator('.selection-count')).toHaveText('5 cells');
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  await expect(page.locator('td.selected')).toHaveCount(5);
  await activate(page.locator('[data-row-select="11"] .row-index'),isMobile);
  await expect(page.locator('.selection-count')).toHaveText('3 cells');
  await extend(page,'row',12,isMobile);await expect(page.locator('.selection-count')).toHaveText('6 cells');
  await expect(page.locator('td[data-r="11"][data-c="5"]')).not.toHaveClass(/selected/);
  await page.getByLabel('Table selection target').selectOption('scope-right');
  await activate(page.locator('[data-row-select="11"] .row-index'),isMobile);
  await expect(page.locator('td[data-r="11"][data-c="5"]')).toHaveClass(/selected/);
  await expect(page.locator('td[data-r="11"][data-c="1"]')).not.toHaveClass(/selected/);
  await activate(page.locator('th[data-col="2"] .column-index'),isMobile);
  await expect(page.locator('#error')).toContainText('outside the chosen table');
  await page.getByRole('button',{name:'Dismiss error'}).click();
  await page.getByLabel('Table selection target').selectOption('');
  await page.locator('td[data-r="9"][data-c="1"]').click({position:{x:35,y:1}});
  await expect(page.locator('.selection-count')).toHaveText('1 cells');
  await expect(page.locator('[data-table-row-select],.table-edge-target,.table-selection-handle')).toHaveCount(0);
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await activate(page.locator('[data-row-select="11"] .row-index'),isMobile);
  await expect(page.locator('.selection-count')).toHaveText('12 cells');
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
for(const axis of ['row','column'] as const)for(const kind of ['summary','range'] as const){
  test(`${kind} ${axis} groups belong to their selected table, collapse only its cells and persist`,async({page,isMobile})=>{
    await fixture(page);const before=await snapshot(page);
    await scopedSelection(page,axis,isMobile);
    await activate(page.getByRole('button',{name:'Group controls',exact:true}),isMobile);
    await activate(page.getByRole('button',{name:'Manage groups',exact:true}),isMobile);
    await page.locator(`[data-create-kind="${kind}"][data-create-axis="${axis}"]`).click();
    const grouped=await snapshot(page),group=grouped.sheets[0].groups.find(g=>g.table==='scope-middle')!;
    expect(group.axis).toBe(axis);expect(group.kind).toBe(kind);
    await expect(page.locator(`[data-group-card="${group.id}"]`)).toContainText('Table: Middle');
    await page.getByRole('button',{name:'Close group manager'}).click();
    await page.locator(`.table-group-controls [data-group-id="${group.id}"]`).click();
    const r=axis==='row'?11:10,c=axis==='row'?1:2;
    await expect(page.locator(`td[data-r="${r}"][data-c="${c}"]`)).toHaveClass(/scoped-hidden/);
    await expect(page.locator(`td[data-r="${r}"][data-c="5"]`)).not.toHaveClass(/scoped-hidden/);
    await expect(page.locator('td[data-r="17"][data-c="2"]')).not.toHaveClass(/scoped-hidden/);
    expect((await snapshot(page)).sheets[0].cells).toEqual(before.sheets[0].cells);
    await page.reload();
    await expect(page.locator(`td[data-r="${r}"][data-c="${c}"]`)).toHaveClass(/scoped-hidden/);
    const after=await snapshot(page);
    expect(after.sheets[0].groups.find(g=>g.id===group.id)).toMatchObject({table:'scope-middle',collapsed:true});
    expect(after.sheets[0].rows).toEqual(before.sheets[0].rows);
    if(axis==='row'&&kind==='summary'){
      await page.locator('td[data-r="10"][data-c="1"] .cell-value').click();
      await page.keyboard.press('ArrowDown');await expect(page.locator('.address')).toHaveText('B14');
    }
  });
}
for(const axis of ['row','column'] as const){
  test(`table ${axis} hypo can override a sheet tag without changing neighboring tables or cell data`,async({page,isMobile})=>{
    await fixture(page);const before=await snapshot(page);
    await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
    await page.getByLabel('Table selection target').selectOption('scope-middle');
    const header=page.locator(axis==='row'?'[data-row-select="11"] .row-index':'th[data-col="2"] .column-index');
    await activate(header,isMobile);
    await activate(page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}),isMobile);
    await expect(page.locator('td[data-r="11"][data-c="2"]')).toHaveClass(/hypothetical-cell/);
    await expect(page.locator('td[data-r="11"][data-c="5"]')).not.toHaveClass(/hypothetical-cell/);
    await expect(page.locator('td[data-r="17"][data-c="2"]')).not.toHaveClass(/hypothetical-cell/);
    await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
    await activate(header,isMobile);
    await activate(page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}),isMobile);
    await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
    await page.getByLabel('Table selection target').selectOption('scope-middle');await activate(header,isMobile);
    await activate(page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}),isMobile);
    await expect(page.locator('td[data-r="11"][data-c="2"]')).not.toHaveClass(/hypothetical-cell/);
    const neighbor=axis==='row'?'td[data-r="11"][data-c="5"]':'td[data-r="17"][data-c="2"]';
    await expect(page.locator(neighbor)).toHaveClass(/hypothetical-cell/);
    const saved=await snapshot(page),item=axis==='row'?saved.sheets[0].rows[11]:saved.sheets[0].columns[2];
    expect(item.hypothetical).toBe(true);expect(item.hypotheticalTables?.['scope-middle']).toBe(false);
    expect(saved.sheets[0].cells).toEqual(before.sheets[0].cells);
    await page.reload();await expect(page.locator('td[data-r="11"][data-c="2"]')).not.toHaveClass(/hypothetical-cell/);
    await expect(page.locator(neighbor)).toHaveClass(/hypothetical-cell/);
    await page.locator('[data-action="hypothetical-visibility"]').click();
    await expect(page.locator('td[data-r="11"][data-c="2"]')).not.toHaveClass(/scoped-hidden/);
    await expect(page.locator(neighbor)).toHaveClass(/scoped-hidden/);
  });
}
test('table selection refuses whole-sheet deletion rather than affecting adjacent table data',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  await scopedSelection(page,'row',isMobile);
  await activate(page.getByRole('button',{name:'Rows & columns',exact:true}),isMobile);
  await activate(page.getByRole('button',{name:'Delete selected rows',exact:true}),isMobile);
  await expect(page.locator('#error')).toContainText('adjacent tables have not been changed');
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
test('noncontiguous table fields never include intervening freeform cells or fill their bounding box',async({page,isMobile})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,table=state.book.tables.find(t=>t.id==='scope-top')!;table.columns.splice(1,1);await store.save(state.book,state.version,'Synthetic field membership gap');}finally{store.close();}
  });
  await page.reload();const before=await snapshot(page);
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await page.getByLabel('Table selection target').selectOption('scope-top');
  await activate(page.locator('th[data-col="1"] .column-index'),isMobile);await extend(page,'column',3,isMobile);
  await expect(page.locator('.selection-count')).toHaveText('10 cells');
  await expect(page.locator('td[data-r="3"][data-c="2"]')).not.toHaveClass(/selected/);
  await activate(page.getByRole('button',{name:'Fill down',exact:true}),isMobile);
  await expect(page.locator('#error')).toContainText('requires one rectangular range');
  expect((await snapshot(page)).sheets[0].cells).toEqual(before.sheets[0].cells);
});
test('table column DD assignment respects the chosen owner rather than earlier active-cell context',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  await activate(page.locator('td[data-r="3"][data-c="2"]'),isMobile);await page.keyboard.press('Escape');
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await page.getByLabel('Table selection target').selectOption('scope-middle');
  await activate(page.locator('th[data-col="2"] .column-index'),isMobile);
  await activate(page.getByRole('button',{name:'Assign DD',exact:true}),isMobile);
  await page.getByRole('button',{name:'List view',exact:true}).click();
  await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();
  await activate(page.getByRole('button',{name:'Apply dropdown',exact:true}),isMobile);
  const after=await snapshot(page),sheet=after.sheets[0],table=after.tables.find(t=>t.id==='scope-middle')!;
  expect(sheet.validations).toHaveLength(1);expect(sheet.validations[0].rows).toEqual(table.rows);
  expect(sheet.validations[0].columns).toEqual([table.columns[1].column]);
  expect(sheet.cells).toEqual(before.sheets[0].cells);
});
test('reload and visiting DD retain table ownership instead of silently broadening saved header selections',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);await scopedSelection(page,'row',isMobile);
  await page.reload();
  const toggle=page.getByRole('button',{name:'Table-constrained header selection'});
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('Table selection target')).toHaveValue('scope-middle');
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  await expect(page.locator('.selection-count')).toHaveText('9 cells');
  await activate(page.locator('[data-action="references"]'),isMobile);
  await activate(page.getByRole('button',{name:'Close DD',exact:true}),isMobile);
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  await expect(page.locator('.selection-count')).toHaveText('9 cells');
  await activate(page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}),isMobile);await snapshot(page);
  await activate(page.getByRole('button',{name:'Undo',exact:true}),isMobile);
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
