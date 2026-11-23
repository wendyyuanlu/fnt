import {expect,test} from '@playwright/test';

test('four sheet rows and two columns remain outside table bounds, are editable and follow growth',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const model='/src/model.ts',storage='/src/storage.ts',catalog='/src/dropdown-catalog.ts';
    const [{blankSheet,createDemo,key},{Store},{seedDropdownCatalog}]=await Promise.all([
      import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>,
      import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>,
      import(/* @vite-ignore */catalog) as Promise<typeof import('../../src/dropdown-catalog')>
    ]);
    const book=seedDropdownCatalog(createDemo()).book,s=blankSheet('Sheet space',4,3);
    const table={id:'space-table',name:'Pantry',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1).map(row=>row.id),columns:s.columns.map((column,i)=>({id:`space-field-${i}`,name:['Item','Amount','Note'][i],column:column.id}))};
    book.sheets.unshift(s);book.tables.push(table);
    for(const field of table.columns)s.cells[key(table.header,field.column)]={value:field.name};
    s.cells[key(table.rows[0],table.columns[0].column)]={value:'Synthetic ingredient'};
    const store=await Store.open();try{const state=(await store.load())!;await store.save(book,state.version,'Synthetic trailing sheet space');}finally{store.close();}
    sessionStorage.setItem('fnt-current-sheet',s.id);
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const snapshot=async()=>{
    await expect(page.locator('#save-state')).toContainText(/^Saved/);
    return page.evaluate(async()=>{
      const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
      try{return(await store.load())!.book;}finally{store.close();}
    });
  };
  const before=await snapshot(),s=before.sheets[0],table=before.tables.find(table=>table.id==='space-table')!;
  expect(s.rows).toHaveLength(8);expect(s.columns).toHaveLength(5);expect(table.rows).toHaveLength(3);expect(table.columns).toHaveLength(3);
  await page.getByRole('button',{name:'Bottom',exact:true}).click();
  const cell=page.locator('td[data-r="7"][data-c="4"]');await cell.scrollIntoViewIfNeeded();await cell.click();
  await page.getByLabel('Cell value or formula',{exact:true}).fill('Scratch note');await page.getByLabel('Cell value or formula',{exact:true}).press('Enter');
  const edited=await snapshot();expect(edited.tables.find(item=>item.id===table.id)).toEqual(table);expect(edited.sheets[0].cells[`${s.rows[7].id}:${s.columns[4].id}`].value).toBe('Scratch note');
  await page.getByRole('button',{name:'Jump to top',exact:true}).click();await page.getByLabel('Table selection target',{exact:true}).click();
  await page.getByRole('option',{name:'Pantry',exact:true}).click();await page.locator('[data-row-select="3"] .row-index').click();
  await page.getByRole('button',{name:'Rows & columns',exact:true}).click();await page.getByRole('button',{name:'Insert row above',exact:true}).click();
  const grown=await snapshot();expect(grown.sheets[0].rows).toHaveLength(9);expect(grown.tables.find(item=>item.id===table.id)!.rows).toHaveLength(4);
  await page.getByRole('button',{name:'Rows & columns',exact:true}).click();await page.getByRole('button',{name:'Insert column left',exact:true}).click();
  const wider=await snapshot();expect(wider.sheets[0].columns).toHaveLength(6);expect(wider.tables.find(item=>item.id===table.id)!.columns).toHaveLength(4);
  expect(wider.sheets[0].cells[`${s.rows[7].id}:${s.columns[4].id}`].value).toBe('Scratch note');
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const reloaded=await snapshot();expect(reloaded.sheets[0].rows).toEqual(wider.sheets[0].rows);expect(reloaded.sheets[0].columns).toEqual(wider.sheets[0].columns);
});
