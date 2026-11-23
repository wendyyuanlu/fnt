import { expect,test,type Page } from '@playwright/test';
const rows=(p:Page)=>p.locator('.grid tbody tr[data-row]:has(td:not(.table-header))');
const saved=(p:Page)=>expect(p.locator('#save-state')).toContainText(/^Saved/);
const dd=async(p:Page,name?:string)=>{await p.locator('[data-action="references"]').click();if(name)await p.locator('[data-reference]').filter({hasText:new RegExp('^'+name+'$')}).click();};
async function edit(p:Page,text:string){await p.locator('#formula').fill(text);await p.locator('#formula').press('Enter');}
async function snapshot(p:Page){await saved(p);return p.evaluate(async()=>{const path='/src/',{Store}=await import(path+'storage.ts') as typeof import('../../src/storage'),s=await Store.open();try{return await s.backup((await s.load())!);}finally{s.close();}});}

test('DD uses the same grid, maintains duplicate identities and formats across row movement, archive, undo and reload',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.locator('td[data-r="1"][data-c="1"]').click();
  await dd(page);await page.locator('[data-action="new-reference"]').click();await page.locator('#answer').fill('Invented types');await page.getByRole('button',{name:'Create',exact:true}).click();
  for(let i=0;i<2;i++){await page.locator('.reference-append-row input').fill('Same');await page.locator('.reference-append-row input').press('Enter');}
  await expect(rows(page)).toHaveCount(2);await rows(page).last().locator('td').click();
  await page.locator('[data-action="bold"]').click();await page.locator('[data-action="format"]').click();await page.locator('#text-color').fill('#cc1122');await page.locator('#bg-color').fill('#ddeeff');await page.getByRole('button',{name:'Apply to selection'}).click();
  await page.getByRole('button',{name:'DD settings',exact:true}).click();await page.locator('#reference-bind').click();
  await page.getByRole('button',{name:'Close DD',exact:true}).click();
  await page.locator('td[data-r="1"][data-c="1"]').click();await page.locator('.cell-dropdown').getByRole('option').nth(1).click();await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Same');
  await dd(page,'Invented types');await rows(page).last().locator('td').click();await edit(page,'Renamed');
  await rows(page).last().locator('th').hover();await rows(page).last().locator('[data-move-row]').click();await rows(page).first().locator('th').hover();
  const destination=await rows(page).first().getAttribute('data-row');await rows(page).first().locator(`[data-insert-row="${destination}"]`).click();
  await expect(rows(page).first().locator('td')).toHaveText('Renamed');
  await expect(rows(page).first().locator('td')).toHaveCSS('color','rgb(204, 17, 34)');
  await expect(rows(page).first().locator('td')).toHaveCSS('background-color','rgb(221, 238, 255)');
  await rows(page).first().locator('th').click();await page.locator('[data-action="archive-options"]').click();
  await page.getByRole('button',{name:'Close DD',exact:true}).click();await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Renamed');
  await page.locator('td[data-r="1"][data-c="1"]').click();await expect(page.locator('.cell-dropdown').getByRole('option')).toHaveCount(1);await page.keyboard.press('Escape');
  await saved(page);const before=await snapshot(page);await page.reload();await dd(page,'Invented types');await expect(rows(page).first()).toHaveClass(/archived/);
  await rows(page).first().locator('th').click();await page.keyboard.press('Delete');await expect(page.getByRole('dialog')).toContainText('linked cells');
  await page.locator('#replacement').selectOption({index:1});await page.locator('#delete-option').click();await expect(rows(page)).toHaveCount(1);
  await page.locator('[data-action="undo"]').click();await expect(rows(page)).toHaveCount(2);await expect(rows(page).first().locator('td')).toHaveText('Renamed');
  const after=await snapshot(page);expect(after.state.book.references).toEqual(before.state.book.references);
  const proof=await page.evaluate(async()=>{const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{exportXlsx}=await import(p+'xlsx-export.ts') as typeof import('../../src/xlsx-export'),{importXlsx}=await import(p+'xlsx.ts') as typeof import('../../src/xlsx'),s=await Store.open();try{const b=await s.backup((await s.load())!);return JSON.stringify((await importXlsx(Uint8Array.from(await exportXlsx(b)).buffer,'synthetic.xlsx')).nativeBackup)===JSON.stringify(b);}finally{s.close();}});
  expect(proof).toBe(true);
});
test('cell and column dropdown assignment preserves values and precise scopes and is undoable',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();await page.locator('td[data-r="1"][data-c="0"]').click();
  const before=await snapshot(page);
  await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  const one=await snapshot(page),s=one.state.book.sheets.find(s=>s.name==='Ingredients')!,column=s.columns[0].id;
  expect(s.cells).toEqual(before.state.book.sheets.find(s=>s.name==='Ingredients')!.cells);
  expect(s.validations.filter(v=>v.columns.includes(column)).flatMap(v=>v.rows)).toEqual([s.rows[1].id]);
  await page.locator('[data-action="undo"]').click();
  await page.locator('th[data-col="0"]').click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'IngredientType',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  const all=await snapshot(page),sheet=all.state.book.sheets.find(x=>x.id===s.id)!,table=all.state.book.tables.find(t=>t.name==='Ingredients')!;
  expect(sheet.validations.filter(v=>v.columns.includes(column)).flatMap(v=>v.rows)).toEqual(table.rows);
  expect(sheet.cells).toEqual(s.cells);await page.reload();
  await page.locator('td[data-r="1"][data-c="0"]').click();await expect(page.locator('.cell-dropdown')).toContainText('Seasoning');await page.keyboard.press('Escape');
  await page.locator('[data-action="dropdown-source"]').click();await page.locator('#no-dropdown').click();await page.getByRole('button',{name:'Apply dropdown'}).click();
  await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Example oats');
});
test('live derived lists are filtered shared-grid previews, never editable replacements for the source',async({page})=>{
  await page.goto('/');await dd(page);await page.locator('[data-action="new-reference"]').click();await page.locator('#answer').fill('Meal choices');await page.locator('#reference-kind').selectOption('derived');await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.locator('#derived-table').selectOption({label:'Meals'});await page.locator('#derived-column').selectOption({label:'Meal'});await page.locator('#derived-filter').selectOption({label:'Ingredient'});await page.locator('#derived-equals').fill('Example oats');await page.getByRole('button',{name:'Save connection'}).click();
  await expect(rows(page)).toHaveCount(1);await expect(rows(page).first().locator('td')).toHaveText('Example breakfast');await expect(page.locator('#formula')).toBeDisabled();
  const before=await snapshot(page);await rows(page).first().locator('td').click();await page.keyboard.press('Delete');await page.locator('[data-action="bold"]').click();await saved(page);
  expect((await snapshot(page)).state.book).toEqual(before.state.book);
});
test('conversion grid hides IDs and confirms factor changes without losing authored formulas or formats',async({page})=>{
  await page.goto('/');await saved(page);
  await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{createReference,addReferenceValue,unitsSource,upsertConversion,referenceTable}=await import(p+'references.ts') as typeof import('../../src/references'),{setInput,key}=await import(p+'model.ts') as typeof import('../../src/model'),s=await Store.open();
    try{
      const state=(await s.load())!,b=state.book,u=unitsSource(b),a=addReferenceValue(b,u,'c'),z=addReferenceValue(b,u,'lb'),src=createReference(b,'Convert','conversions'),row=upsertConversion(b,src,undefined,a,z,'2',true),{table:t,sheet}=referenceTable(b,src);
      sheet.cells[key(row,t.columns[2].column)].format={color:'#cc1122',underline:true};
      setInput(b,b.sheets[0],b.sheets[0].rows[1].id,b.sheets[0].columns[5].id,`=SUM(${t.name}[Conversion Factor])`);
      await s.save(b,state.version,'Synthetic conversions');
    }finally{s.close();}
  });
  await page.reload();await dd(page,'Convert');await expect(rows(page).first().locator('td').nth(0)).toHaveText('c');await expect(rows(page).first().locator('td').nth(1)).toHaveText('lb');
  await rows(page).first().locator('td').nth(2).click();await edit(page,'=3*2');await expect(page.getByRole('dialog')).toContainText('historical');await expect(rows(page).first().locator('td').nth(2)).toHaveText('2');
  await page.locator('#confirm').click();await expect(rows(page).first().locator('td').nth(2)).toHaveText('6');await expect(page.locator('#formula')).toHaveValue('=(3*2)');
  await expect(rows(page).first().locator('td').nth(2)).toHaveCSS('color','rgb(204, 17, 34)');
  await page.locator('[data-action="undo"]').click();await expect(rows(page).first().locator('td').nth(2)).toHaveText('2');
  await rows(page).first().locator('td').nth(0).click();await expect(page.locator('#formula')).toHaveValue('c');await expect(rows(page).first().locator('td').nth(0)).toHaveText('c');await expect(page.locator('.cell-dropdown')).toHaveCount(0);
});
test('DD field deletion never deletes neighboring sources sharing the backing column',async({page})=>{
  await page.goto('/');await dd(page,'Country');const before=await snapshot(page);
  await page.locator('th[data-col]').click();await page.keyboard.press('Delete');await expect(page.getByRole('alert')).toContainText('unavailable');
  await page.locator('[data-action="undo"]').click();await expect(rows(page)).toHaveCount(4);const after=await snapshot(page);
  expect(after.state.book.references).toEqual(before.state.book.references);expect(after.state.book.tables).toEqual(before.state.book.tables);
  expect(after.state.book.sheets.map(s=>s.cells)).toEqual(before.state.book.sheets.map(s=>s.cells));
  expect(after.state.book.dropdownData).toEqual(before.state.book.dropdownData);
});
