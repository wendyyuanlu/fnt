import {expect,test,type Page} from '@playwright/test';

async function snapshot(page:Page){
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
}
async function fixture(page:Page,offset=false){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async(offset)=>{
    const model='/src/model.ts',storage='/src/storage.ts',catalog='/src/dropdown-catalog.ts';
    const [{createDemo,blankSheet,setInput,key},{Store},{seedDropdownCatalog}]=await Promise.all([
      import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>,
      import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>,
      import(/* @vite-ignore */catalog) as Promise<typeof import('../../src/dropdown-catalog')>
    ]);
    const book=seedDropdownCatalog(createDemo()).book,s=blankSheet('Table lab',12,7),other=blankSheet('Other lab',offset?100:8,offset?14:5);book.sheets.unshift(s,other);
    s.groups.push({id:'recovery-group',kind:'summary',axis:'row',members:s.rows.slice(4,7).map(row=>row.id),collapsed:false,label:'Recovery group'});
    for(const [r,c,text]of [[0,0,'Item'],[0,1,'Count'],[0,2,'Count'],[1,0,'Alpha'],[1,1,'5'],[1,2,'8'],[2,0,'Beta'],[2,1,'7'],[2,2,'9'],[0,5,'=SUM(B2:B3)'],[1,4,'Neighbor'],[5,0,'Below']] as const)setInput(book,s,s.rows[r].id,s.columns[c].id,text);
    const start=offset?70:0,first=offset?8:0,table={id:'other-table',name:'Other_Table',sheet:other.id,header:other.rows[start].id,rows:[other.rows[start+1].id],columns:other.columns.slice(first,first+2).map((column,i)=>({id:`other-field-${i}`,name:['Thing','Value'][i],column:column.id}))};
    if(offset){other.rows[start].hidden=true;other.columns[first].hidden=true;other.groups.push({id:'hidden-table-group',label:'Hidden table',axis:'row',kind:'range',members:other.rows.slice(start,start+2).map(row=>row.id),collapsed:true});}
    book.tables.push(table);table.columns.forEach(field=>{other.cells[key(table.header,field.column)]={value:field.name};});
    other.cells[key(table.rows[0],table.columns[0].column)]={value:'Other entry'};other.cells[key(table.rows[0],table.columns[1].column)]={value:42};
    const store=await Store.open();try{const current=(await store.load())!;await store.save(book,current.version,'Synthetic table management');}finally{store.close();}
    sessionStorage.setItem('fnt-current-sheet',s.id);
  },offset);
  await page.reload();await expect(page.locator('.grid')).toHaveAttribute('aria-label','Table lab');
}
async function select(page:Page,range:string){
  await page.locator('.selection-count').click();await page.locator('#answer').fill(range);await page.getByRole('button',{name:'Apply',exact:true}).click();
}
test('table rename updates inherited formula defaults and restores them with Undo, Redo and reload',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{
      const state=(await store.load())!;
      state.book.tables.find((table:{id:string})=>table.id==='other-table')!.columns[1].formulaDefault='=ROWS(Other_Table[Thing])';
      await store.save(state.book,state.version,'Invented formula default');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Other lab',exact:true}).click();
  await page.locator('td[data-r="1"][data-c="0"]').click();await page.getByRole('button',{name:'Table manager',exact:true}).click();
  await page.locator('#answer').fill('Other_Renamed');await page.getByRole('button',{name:'Apply',exact:true}).click();
  const read=async()=> (await snapshot(page)).tables.find(table=>table.id==='other-table')!;
  expect((await read()).columns[1].formulaDefault).toContain('Other_Renamed[Thing]');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect((await read()).name).toBe('Other_Table');expect((await read()).columns[1].formulaDefault).toBe('=ROWS(Other_Table[Thing])');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await snapshot(page);await page.reload();
  expect((await read()).name).toBe('Other_Renamed');expect((await read()).columns[1].formulaDefault).toContain('Other_Renamed[Thing]');
});

test('Ctrl+T creates headers and table manager opens only the selected table rename field with stable formulas and persistence',async({page})=>{
  await fixture(page);await select(page,'A1:C3');await page.keyboard.press('Control+t');
  await expect(page.getByRole('dialog',{name:'Create table',exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'My table has headers',exact:true})).toBeChecked();
  await expect(page.locator('.table-headers-option')).toHaveCSS('flex-direction','row');
  await expect(page.locator('.table-headers-option')).toHaveCSS('display','inline-flex');
  const checkbox=await page.locator('#table-has-headers').boundingBox(),checkboxLabel=await page.locator('.table-headers-option').boundingBox();
  expect(Math.abs(checkbox!.y+checkbox!.height/2-checkboxLabel!.y-checkboxLabel!.height/2)).toBeLessThan(1);
  await page.getByRole('textbox',{name:'Table name',exact:true}).fill('New_Table');await page.getByRole('button',{name:'Create table',exact:true}).click();
  const created=(await snapshot(page)).tables.find(table=>table.name==='New_Table')!;expect(created.rows).toHaveLength(2);expect(created.columns.map(field=>field.name)).toEqual(['Item','Count','Count_2']);
  await page.locator('td[data-r="1"][data-c="5"]').click();await page.locator('#formula').fill('=SUM(New_Table[Count])');await page.locator('#formula').press('Enter');
  await page.locator('td[data-r="1"][data-c="0"]').click();await page.getByRole('button',{name:'Table manager',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Rename table',exact:true})).toBeVisible();await expect(page.locator('.table-manager-card')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Delete table',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Name',exact:true})).toHaveValue('New_Table');
  const renameWidth=(await page.getByRole('dialog',{name:'Rename table',exact:true}).boundingBox())!.width;
  const allTables=page.getByRole('button',{name:'See all tables',exact:true});
  const allBounds=(await allTables.boundingBox())!,deleteBounds=(await page.getByRole('button',{name:'Delete table',exact:true}).boundingBox())!;
  expect(allBounds.x).toBeGreaterThan(deleteBounds.x+deleteBounds.width);
  expect(allBounds.y+allBounds.height).toBeCloseTo(deleteBounds.y+deleteBounds.height,0);
  await allTables.click();await expect(page.getByRole('dialog',{name:'Table manager',exact:true})).toBeVisible();
  expect((await page.getByRole('dialog',{name:'Table manager',exact:true}).boundingBox())!.width).toBe(renameWidth);
  await expect(page.locator('.table-manager-card')).toHaveCount((await snapshot(page)).tables.length);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Table manager',exact:true}).click();
  await page.locator('#answer').fill('Ingredients');await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('#table-rename-error')).toContainText('already in use');
  await page.locator('#answer').fill('Renamed_Table');await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('td[data-r="1"][data-c="5"]')).toContainText('12');
  const renamed=(await snapshot(page)).tables.find(table=>table.id===created.id)!;expect(renamed.name).toBe('Renamed_Table');expect(renamed.columns).toEqual(created.columns);
  await page.reload();await expect(page.locator('td[data-r="1"][data-c="5"]')).toContainText('12');
  await page.locator('td[data-r="1"][data-c="0"]').click();await page.getByRole('button',{name:'Table manager',exact:true}).click();await expect(page.locator('#answer')).toHaveValue('Renamed_Table');
});

test('unchecked headers preserve every selected record, neighboring cells and formulas when created from the toolbar',async({page})=>{
  await fixture(page);await select(page,'A2:B3');await page.getByRole('button',{name:'Convert to table',exact:true}).click();
  await page.locator('#table-name').fill('Generated_Headers');await page.getByRole('checkbox',{name:'My table has headers',exact:true}).uncheck();
  await expect(page.locator('#table-header-detail')).toHaveCount(0);
  await page.getByRole('button',{name:'Create table',exact:true}).click();
  await expect(page.locator('td[data-r="1"][data-c="0"]')).toContainText('Column1');
  await expect(page.locator('td[data-r="2"][data-c="0"]')).toContainText('Alpha');
  await expect(page.locator('td[data-r="3"][data-c="0"]')).toContainText('Beta');
  await expect(page.locator('td[data-r="1"][data-c="4"]')).toContainText('Neighbor');
  await expect(page.locator('td[data-r="0"][data-c="5"]')).toContainText('12');
  const table=(await snapshot(page)).tables.find(table=>table.name==='Generated_Headers')!;expect(table.rows).toHaveLength(2);
  await page.reload();await expect(page.locator('td[data-r="2"][data-c="0"]')).toContainText('Alpha');await expect(page.locator('td[data-r="0"][data-c="5"]')).toContainText('12');
});

test('table manager reuses searchable DD previews across sheets and supports double-click and keyboard inline rename',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);await page.locator('td[data-r="0"][data-c="5"]').click();
  await page.getByRole('button',{name:'Table manager',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Table manager',exact:true})).toBeVisible();await expect(page.locator('.table-manager-card')).toHaveCount(before.tables.length);
  await expect(page.locator('#validation,#clear-validation,#named')).toHaveCount(0);
  await expect(page.locator('.dropdown-view-controls')).toHaveCount(0);
  const bottomAlignment=await page.locator('.table-manager-card').evaluateAll(cards=>cards.map(card=>{
    const button=card.querySelector('.danger')!,style=getComputedStyle(card);
    return Math.abs(card.getBoundingClientRect().bottom-button.getBoundingClientRect().bottom-parseFloat(style.paddingBottom)-parseFloat(style.borderBottomWidth));
  }));
  expect(bottomAlignment.every(gap=>gap<1)).toBe(true);
  const card=page.locator('[data-table-id="other-table"]');await expect(card).toContainText('Other lab');await expect(card.getByRole('table',{name:'Other_Table preview',exact:true})).toContainText('Other entry');
  await expect(card).toContainText('1 rows / 2 columns');await expect(card).not.toContainText('records');
  await expect(card).toContainText('42');const title=card.getByRole('button',{name:'Table name: Other_Table',exact:true});
  const beforeTitle=await title.boundingBox(),beforeDetail=await card.locator('.table-manager-sheet').boundingBox(),beforePreview=await card.locator('.table-manager-preview').boundingBox();
  if(isMobile){await title.tap();await title.tap();}else await title.dblclick();
  const editor=await card.locator('.table-manager-name-editor').boundingBox();expect(editor!.height).toBe(beforeTitle!.height);
  expect((await card.locator('.table-manager-sheet').boundingBox())!.y).toBe(beforeDetail!.y);expect((await card.locator('.table-manager-preview').boundingBox())!.y).toBe(beforePreview!.y);
  await card.getByRole('textbox',{name:'Table name',exact:true}).fill('Ingredients');await card.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('#table-manager-error')).toContainText('already in use');
  await card.getByRole('textbox',{name:'Table name',exact:true}).fill('Other_Renamed');await card.getByRole('textbox',{name:'Table name',exact:true}).press('Enter');
  await expect(card.getByRole('button',{name:'Table name: Other_Renamed',exact:true})).toBeVisible();
  await page.getByRole('searchbox',{name:'Search tables',exact:true}).fill('Other lab');await expect(page.locator('.table-manager-card')).toHaveCount(1);
  await card.getByRole('button',{name:'Table name: Other_Renamed',exact:true}).press('Enter');
  await card.getByRole('textbox',{name:'Table name',exact:true}).fill('Canceled_Name');await card.getByRole('textbox',{name:'Table name',exact:true}).press('Escape');
  await expect(page.getByRole('dialog',{name:'Table manager',exact:true})).toBeVisible();await expect(card.getByRole('button',{name:'Table name: Other_Renamed',exact:true})).toBeVisible();
  await page.getByRole('searchbox',{name:'Search tables',exact:true}).fill('no such table');await expect(page.locator('#dropdown-source-cards')).toHaveText('No matching tables');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  expect((await snapshot(page)).tables.find(table=>table.id==='other-table')!.name).toBe('Other_Renamed');
  await page.reload();await page.getByRole('button',{name:'Table manager',exact:true}).click();await expect(page.locator('[data-table-id="other-table"]')).toContainText('Other_Renamed');
});

test('sheet name navigates to an offscreen table header and reveals it',async({page})=>{
  await fixture(page,true);await page.locator('td[data-r="0"][data-c="5"]').click();await page.getByRole('button',{name:'Table manager',exact:true}).click();
  await page.getByRole('button',{name:'Go to Other_Table on Other lab',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.grid')).toHaveAttribute('aria-label','Other lab');
  const header=page.locator('td[data-r="70"][data-c="8"]');await expect(header).toBeInViewport();await expect(header).toContainText('Thing');await expect(header).toHaveClass(/selected/);
  const after=await snapshot(page),owner=after.sheets.find(sheet=>sheet.name==='Other lab')!;expect(owner.rows[70].hidden).toBe(false);expect(owner.columns[8].hidden).toBe(false);expect(owner.groups.find(group=>group.id==='hidden-table-group')!.collapsed).toBe(false);
  await page.reload();await expect(page.locator('.grid')).toHaveAttribute('aria-label','Other lab');await expect(header).toBeInViewport();
});

test('table sorting tracks actual cell edits and table visits and preserves the chosen order after reload',async({page})=>{
  await fixture(page);await page.locator('td[data-r="0"][data-c="5"]').click();await page.getByRole('button',{name:'Table manager',exact:true}).click();
  const chooseSort=async(name:string)=>{await page.getByRole('combobox',{name:'Sort tables',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();};
  const names=()=>page.locator('.table-manager-name').allTextContents();
  const alphabetical=(await names()).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true}));
  expect(await names()).toEqual(alphabetical);
  await chooseSort('Z-A');expect(await names()).toEqual([...alphabetical].reverse());
  await chooseSort('A-Z');expect(await names()).toEqual(alphabetical);
  await page.getByRole('button',{name:'Go to Other_Table on Other lab',exact:true}).click();
  await page.locator('td[data-r="1"][data-c="1"]').click();await page.locator('#formula').fill('43');await page.locator('#formula').press('Enter');
  const edited=await snapshot(page),time=edited.tableActivity!['other-table'].editedAt!;
  expect(time).toBeGreaterThan(0);expect(edited.tableActivity!['other-table'].visits).toBe(1);
  await page.getByRole('button',{name:'Table lab',exact:true}).click();
  await page.locator('td[data-r="0"][data-c="5"]').click();await page.locator('#formula').fill('100');await page.locator('#formula').press('Enter');
  expect((await snapshot(page)).tableActivity!['other-table'].editedAt).toBe(time);
  await page.getByRole('button',{name:'Table manager',exact:true}).click();await chooseSort('Last activity');expect((await names())[0]).toBe('Other_Table');
  await page.getByRole('button',{name:'Go to Other_Table on Other lab',exact:true}).click();
  await page.getByRole('button',{name:'Table lab',exact:true}).click();await page.getByRole('button',{name:'Table manager',exact:true}).click();
  await chooseSort('Frequently used');expect((await names())[0]).toBe('Other_Table');
  const used=await snapshot(page);expect(used.tableActivity!['other-table']).toEqual({editedAt:time,visits:2});expect(used.tableManagerSort).toBe('frequent');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Table manager',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Sort tables',exact:true})).toContainText('Frequently used');expect((await names())[0]).toBe('Other_Table');
});

test('supporting sheets remain DD-owned after opening, leaving and reloading without changing dropdown links',async({page})=>{
  await fixture(page);const before=await snapshot(page),supporting=before.dropdownData!.sheets;
  expect(supporting.length).toBeGreaterThan(0);
  for(const sheet of supporting)await expect(page.locator(`.sheet-tab[data-sheet="${sheet.id}"]`)).toHaveCount(0);
  const source=before.references!.find(source=>before.dropdownData!.tables.some(table=>table.id===source.table))!;
  await page.locator('.reference-manager').click();await page.locator(`.sheet-tab[data-reference="${source.id}"]`).click();
  await expect(page.locator('.sheet-tab.current[data-reference]')).toHaveAttribute('data-reference',source.id);
  await page.locator('.reference-manager').click();await page.getByRole('button',{name:'Table lab',exact:true}).click();
  await snapshot(page);await page.reload();
  for(const sheet of supporting)await expect(page.locator(`.sheet-tab[data-sheet="${sheet.id}"]`)).toHaveCount(0);
  const after=await snapshot(page);expect(after.references).toEqual(before.references);
  expect(after.dropdownData).toEqual(before.dropdownData);
  expect(after.sheets.map(sheet=>[sheet.id,sheet.supporting,sheet.validations])).toEqual(before.sheets.map(sheet=>[sheet.id,sheet.supporting,sheet.validations]));
});

test('create-table errors stay editable and overlapping tables or cancel leave existing contents intact',async({page})=>{
  await fixture(page);await select(page,'A1:B3');await page.keyboard.press('Control+t');await page.locator('#table-name').fill('Ingredients');
  await page.getByRole('button',{name:'Create table',exact:true}).click();await expect(page.locator('#table-create-error')).toContainText('already in use');
  await page.locator('#table-name').fill('Retry_Table');await page.getByRole('button',{name:'Create table',exact:true}).click();const before=await snapshot(page);
  await page.keyboard.press('Control+t');await page.locator('#table-name').fill('Overlap_Table');await page.getByRole('button',{name:'Create table',exact:true}).click();
  await expect(page.locator('#table-create-error')).toContainText('overlap');await page.keyboard.press('Escape');expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button',{name:'Collapse (blank) rows',exact:true}).click();
  expect((await snapshot(page)).sheets.find(sheet=>sheet.name==='Table lab')!.groups.find(group=>group.id==='recovery-group')!.collapsed).toBe(true);
});

test('table deletion requires confirmation, preserves cells, makes broken references explicit and supports undo',async({page})=>{
  await fixture(page);await page.locator('td[data-r="0"][data-c="5"]').click();await page.locator('#formula').fill('=SUM(Other_Table[Value])');await page.locator('#formula').press('Enter');
  const before=await snapshot(page),original=before.sheets.find(sheet=>sheet.name==='Other lab')!;
  await page.getByRole('button',{name:'Table manager',exact:true}).click();
  await page.getByRole('button',{name:'Delete Other_Table table',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Delete table?',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Cell contents remain');
  expect((await snapshot(page)).tables.some(table=>table.id==='other-table')).toBe(true);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('dialog',{name:'Table manager',exact:true})).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button',{name:'Delete Other_Table table',exact:true}).click();await page.getByRole('button',{name:'Delete table',exact:true}).click();
  await expect(page.locator('td[data-r="0"][data-c="5"]')).toContainText('#REF!');
  const deleted=await snapshot(page);expect(deleted.tables.some(table=>table.id==='other-table')).toBe(false);expect(deleted.sheets.find(sheet=>sheet.id===original.id)!.cells).toEqual(original.cells);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('td[data-r="0"][data-c="5"]')).toContainText('42');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await snapshot(page);await page.reload();await expect(page.locator('td[data-r="0"][data-c="5"]')).toContainText('#REF!');
});
