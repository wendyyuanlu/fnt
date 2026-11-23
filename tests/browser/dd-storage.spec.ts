import {expect,test,type Page} from '@playwright/test';

async function saved(page:Page){
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
}
async function fixture(page:Page){
  await page.goto('/');await saved(page);
  const result=await page.evaluate(async()=>{
    const paths=['/src/model.ts','/src/storage.ts','/src/dropdown-catalog.ts'] as const;
    const [model,storage,catalog]=await Promise.all(paths.map(path=>import(/* @vite-ignore */path))) as [typeof import('../../src/model'),typeof import('../../src/storage'),typeof import('../../src/dropdown-catalog')];
    const book=catalog.seedDropdownCatalog(model.createDemo()).book,source=book.references!.find(source=>source.catalog?.table==='IngredientType')!,table=book.tables.find(table=>table.id===source.table)!,sheet=book.sheets.find(sheet=>sheet.name==='Notebook')!;
    model.setInput(book,sheet,sheet.rows[0].id,sheet.columns[0].id,'=XLOOKUP("Seasoning",IngredientType[Ingredient type],IngredientType[Ingredient type],"missing")');
    sheet.cells[model.key(sheet.rows[1].id,sheet.columns[0].id)]={binding:{table:table.id,row:table.rows[0],column:table.columns[0].id}};
    const store=await storage.Store.open();try{
      const state=(await store.load())!;
      await store.save(book,state.version,'Legacy DD fixture');
    }finally{store.close();}
    sessionStorage.setItem('fnt-current-sheet',sheet.id);sessionStorage.removeItem('fnt-current-reference');
    return{source:source.id,backing:table.sheet,table:table.id,sheet:sheet.id,sourceRow:table.rows[0]};
  });
  await page.reload();await expect(page.locator('.grid')).toHaveAttribute('aria-label','Notebook');return result;
}

test('DD owns the real records, edits existing links, and retains full pre-migration recovery',async({page})=>{
  const ids=await fixture(page),book=await saved(page);
  expect(book.sheets.some(sheet=>sheet.id===ids.backing)).toBe(false);expect(book.tables.some(table=>table.id===ids.table)).toBe(false);
  expect(book.dropdownData!.tables.some(table=>table.id===ids.table)).toBe(true);
  await expect(page.locator(`.sheet-tab[data-sheet="${ids.backing}"]`)).toHaveCount(0);
  await expect(page.locator('td[data-r="0"][data-c="0"] .cell-value')).toHaveText('Seasoning');
  await expect(page.locator('td[data-r="1"][data-c="0"] .cell-value')).toHaveText('Seasoning');
  await page.getByRole('button',{name:'Open DD',exact:true}).click();
  await page.locator(`.sheet-tab[data-reference="${ids.source}"]`).click();
  await page.locator('td[data-r="1"][data-c="0"]').click();await page.locator('#formula').fill('Edited synthetic type');await page.locator('#formula').press('Enter');
  await page.getByRole('button',{name:'Close DD',exact:true}).click();
  await expect(page.locator('td[data-r="0"][data-c="0"] .cell-value')).toHaveText('missing');
  await expect(page.locator('td[data-r="1"][data-c="0"] .cell-value')).toHaveText('Edited synthetic type');
  await saved(page);await page.reload();
  await expect(page.locator('td[data-r="1"][data-c="0"] .cell-value')).toHaveText('Edited synthetic type');
  const recovery=await page.evaluate(async()=>{
    const path='/src/storage.ts',archivePath='/src/archive.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),{parseArchive}=await import(/* @vite-ignore */archivePath) as typeof import('../../src/archive'),store=await Store.open();
    try{const entry=(await store.history()).find(entry=>entry.label==='Before Move dropdown records into DD storage')!;const backup=parseArchive(entry.backup!) as import('../../src/storage').Backup;return{tableIds:backup.state.book.tables.map(table=>table.id),dd:backup.state.book.dropdownData};}finally{store.close();}
  });
  expect(recovery.tableIds).toContain(ids.table);expect(recovery.dd).toBeUndefined();
});

test('native backups and Excel exports retain DD storage and materialize every backing table',async({page})=>{
  await fixture(page);
  const result=await page.evaluate(async()=>{
    const paths=['/src/model.ts','/src/storage.ts','/src/xlsx-export.ts','/src/xlsx.ts','/src/archive.ts'] as const;
    const [model,storage,exporter,importer,archive]=await Promise.all(paths.map(path=>import(/* @vite-ignore */path))) as [typeof import('../../src/model'),typeof import('../../src/storage'),typeof import('../../src/xlsx-export'),typeof import('../../src/xlsx'),typeof import('../../src/archive')];
    const store=await storage.Store.open();try{
      const backup=await store.backup((await store.load())!),native=archive.parseArchive(archive.stringifyArchive(backup)) as import('../../src/storage').Backup;
      storage.validateBackup(native);
      const bytes=await exporter.exportXlsx(backup),roundtrip=await importer.importXlsx(Uint8Array.from(bytes).buffer,'synthetic-DD.xlsx');
      const zipPath='/node_modules/.vite/deps/fflate.js',{unzipSync,strFromU8}=await import(/* @vite-ignore */zipPath) as typeof import('fflate'),parts=unzipSync(bytes);
      const sheets=new DOMParser().parseFromString(strFromU8(parts['xl/workbook.xml']),'application/xml').getElementsByTagName('sheet');
      return{nativeEqual:JSON.stringify(native.state.book)===JSON.stringify(backup.state.book),equal:JSON.stringify(roundtrip.nativeBackup?.state.book)===JSON.stringify(backup.state.book),
        tableCount:Object.keys(parts).filter(path=>/^xl\/tables\/table\d+\.xml$/.test(path)).length,expectedTables:model.allTables(backup.state.book).length,sheetCount:sheets.length,expectedSheets:model.allSheets(backup.state.book).length};
    }finally{store.close();}
  });
  expect(result.nativeEqual).toBe(true);expect(result.equal).toBe(true);expect(result.tableCount).toBe(result.expectedTables);expect(result.sheetCount).toBe(result.expectedSheets);
});

test('sheet groups are visual only, persist, and use matching add/settings icons and a stable rounded 3px selection stroke',async({page})=>{
  await fixture(page);const before=await saved(page);
  const notebook=page.getByRole('button',{name:'Notebook',exact:true}),log=page.getByRole('button',{name:'Meals',exact:true});
  const height=(await notebook.boundingBox())!.height;
  await notebook.click();await log.click({modifiers:['Shift']});
  await page.locator('.tab-actions').getByRole('button',{name:'Sheet settings',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Sheet settings',exact:true});
  await expect(dialog.locator('[data-sheet-name]')).toHaveCount(2);
  await dialog.getByRole('combobox',{name:'Group',exact:true}).click();await page.getByRole('button',{name:'New group',exact:true}).click();
  await page.getByRole('textbox',{name:'New visual group',exact:true}).fill('Daily tools');await page.getByRole('button',{name:'Create group',exact:true}).click();
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  const group=page.locator('.sheet-tab-group');await expect(group).toHaveAttribute('aria-label','Daily tools');await expect(group.locator('[data-sheet]')).toHaveCount(2);
  await expect(notebook).toHaveCSS('border-bottom-width','3px');await expect(notebook).toHaveCSS('border-top-width','0px');
  await expect(notebook).toHaveCSS('border-bottom-left-radius','3px');await expect(notebook).toHaveCSS('border-bottom-right-radius','3px');
  expect(await page.locator('.sheet-tab.current').evaluate(el=>getComputedStyle(el).borderBottomColor)).toBe(await page.locator('.grid-footer').evaluate(el=>getComputedStyle(el).borderBottomColor));
  expect((await notebook.boundingBox())!.height).toBe(height);
  for(const name of ['Add sheet','Sheet settings']){
    const button=page.locator('.tab-actions').getByRole('button',{name,exact:true});
    expect(await button.boundingBox()).toMatchObject({width:24,height:24});
    await expect(button.locator('svg')).toHaveAttribute('width','18');await expect(button.locator('svg')).toHaveAttribute('stroke-width','1');
  }
  const after=await saved(page);expect(after.sheets).toEqual(before.sheets);expect(after.tables).toEqual(before.tables);expect(after.dropdownData).toEqual(before.dropdownData);
  await group.getByRole('button',{name:'Daily tools',exact:true}).click();await expect(group.locator('.reference-group-members')).toBeHidden();
  await saved(page);await page.reload();await expect(group.locator('.reference-group-members')).toBeHidden();
  await group.getByRole('button',{name:'Daily tools',exact:true}).click();await expect(group.locator('.reference-group-members')).toBeVisible();
  await notebook.click();await page.getByRole('button',{name:'Open DD',exact:true}).click();
  const settings=page.locator('.tab-actions').getByRole('button',{name:'Dropdown settings',exact:true});
  expect(await settings.boundingBox()).toMatchObject({width:24,height:24});await settings.click();await expect(page.locator('dialog.reference-settings')).toBeVisible();
});
