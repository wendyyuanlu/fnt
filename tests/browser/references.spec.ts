import { expect,test,type Page } from '@playwright/test';
const rows=(p:Page)=>p.locator('.grid tbody tr[data-row]:has(td:not(.table-header))');
const saved=(p:Page)=>expect(p.locator('#save-state')).toContainText(/^Saved/);
const dd=async(p:Page,name?:string)=>{await p.locator('[data-action="references"]').click();if(name)await p.locator('[data-reference]').filter({hasText:new RegExp('^'+name+'$')}).click();};
async function edit(p:Page,text:string){await p.locator('#formula').fill(text);await p.locator('#formula').press('Enter');}
async function snapshot(p:Page){await saved(p);return p.evaluate(async()=>{const path='/src/',{Store}=await import(path+'storage.ts') as typeof import('../../src/storage'),s=await Store.open();try{return await s.backup((await s.load())!);}finally{s.close();}});}

test('approved 02 navigation preserves actions, exact spacing, nested styling and native scrolling',async({page})=>{
  await page.goto('/');await saved(page);
  const before=await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{createReference,addReferenceValue,setReferencePresentation}=await import(p+'references.ts') as typeof import('../../src/references'),{allSheets}=await import(p+'model.ts') as typeof import('../../src/model'),store=await Store.open();
    try{
      const state=(await store.load())!,a=createReference(state.book,'Synthetic first'),b=createReference(state.book,'Synthetic second');
      addReferenceValue(state.book,a,'First choice');addReferenceValue(state.book,b,'Second choice');
      setReferencePresentation(state.book,a,'Synthetic first','Preview / Mid / Deep');setReferencePresentation(state.book,b,'Synthetic second','Preview / Mid');
      await store.save(state.book,state.version,'Synthetic nested tabs');return allSheets(state.book).map(s=>s.cells);
    }finally{store.close();}
  });
  await page.reload();
  const add=page.locator('.sheet-bar [data-action="new-sheet"]'),toggle=page.locator('.sheet-bar [data-action="references"]');
  expect(await add.evaluate(el=>el.parentElement!.className)).toBe('tabs');
  expect(await add.evaluate(el=>el.previousElementSibling!.matches('.sheet-tab,.reference-tab-group'))).toBe(true);
  expect(await add.evaluate(el=>el.nextElementSibling!.className)).toBe('tab-drop-marker');
  const size=(locator:ReturnType<Page['locator']>)=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height};});
  const expectActionGaps=async()=>{
    const gaps=await page.locator('.sheet-bar').evaluate(bar=>{
      const rail=bar.querySelector<HTMLElement>('.tabs')!,settings=bar.querySelector('.tab-actions button')!,add=rail.querySelector('.tab-add-action')!,dd=bar.querySelector('.reference-manager')!;
      rail.scrollLeft=0;
      return{leading:rail.firstElementChild!.getBoundingClientRect().left-settings.getBoundingClientRect().right,trailing:add.getBoundingClientRect().left-add.previousElementSibling!.getBoundingClientRect().right,dd:dd.getBoundingClientRect().left-rail.getBoundingClientRect().right};
    });
    expect(gaps.leading).toBeCloseTo(gaps.trailing,5);expect(gaps.trailing).toBe(4);expect(gaps.dd).toBe(8);
  };
  await expectActionGaps();
  expect(await size(toggle)).toEqual(await size(add));expect(await size(add)).toEqual({width:32,height:32});
  await page.locator('.sheet-bar [data-action="sheet-settings"]').click();await expect(page.getByRole('dialog')).toContainText('Sheet settings');await page.keyboard.press('Escape');
  await add.click();await expect(page.getByRole('dialog')).toContainText('New sheet');await page.keyboard.press('Escape');
  await toggle.click();await page.locator('.sheet-bar button[data-reference]').filter({hasText:/^Synthetic first$/}).click();
  await expectActionGaps();
  const root=page.locator('[data-reference-group="Preview"]'),middle=page.locator('[data-reference-group="Preview / Mid"]'),deep=page.locator('[data-reference-group="Preview / Mid / Deep"]'),selected=page.locator('.sheet-bar .sheet-tab.current');
  for(const category of [root,middle,deep]){
    await expect(category).toHaveCSS('padding','4px 4px 5px 6px');await expect(category).toHaveCSS('gap','1px');
    await expect(category).toHaveCSS('line-height','16px');await expect(category).toHaveCSS('font-size','12px');
  }
  await expect(selected).toHaveCSS('padding','4px 5px 5px');await expect(selected).toHaveCSS('line-height','14px');await expect(selected).toHaveCSS('border-radius','10px');
  const styles=await page.evaluate(()=>{
    const bar=document.querySelector('.sheet-bar')!,current=bar.querySelector('.current')!,deep=bar.querySelector('[data-reference-group="Preview / Mid / Deep"]')!,middle=bar.querySelector('[data-reference-group="Preview / Mid"]')!;
    const expected=(percent:number)=>{const el=document.createElement('span');el.style.backgroundColor=`color-mix(in srgb,#e4d7ed ${percent}%,white)`;bar.append(el);const color=getComputedStyle(el).backgroundColor;el.remove();return color;};
    const icon=bar.querySelector('.reference-manager svg')!;
    return{barPadding:getComputedStyle(bar).padding,groupGap:getComputedStyle(bar.querySelector('.tabs')!).gap,itemGap:getComputedStyle(deep.parentElement!).gap,underline:getComputedStyle(current,'::after').height,deep:getComputedStyle(deep).backgroundColor,expectedDeep:expected(45),middle:getComputedStyle(middle).backgroundColor,expectedMiddle:expected(65),divider:getComputedStyle(deep.parentElement!,'::after').height,trailingDivider:getComputedStyle(bar.querySelector('.tabs')!.lastElementChild!.previousElementSibling!,'::after').content,paths:[...icon.querySelectorAll('path')].map(path=>path.getAttribute('d')),stroke:icon.getAttribute('stroke-width')};
  });
  expect(styles.barPadding).toBe('0px 8px');expect(styles.groupGap).toBe('4px');expect(styles.itemGap).toBe('3px');expect(styles.underline).toBe('2.5px');
  expect(styles.deep).toBe(styles.expectedDeep);expect(styles.middle).toBe(styles.expectedMiddle);expect(styles.divider).toBe('12px');expect(styles.trailingDivider).toBe('none');
  expect(styles.paths).toEqual(['M7 16H3V4h5a6 6 0 0 1 4.472 2','M9 8h5a6 6 0 0 1 0 12H9Z']);expect(styles.stroke).toBe('1');
  expect(await size(toggle)).toEqual(await size(page.locator('.sheet-bar [data-action="new-reference"]')));
  const ddAdd=page.locator('.sheet-bar [data-action="new-reference"]');
  expect(await ddAdd.evaluate(el=>el.parentElement!.className)).toBe('tabs');
  expect(await ddAdd.evaluate(el=>el.previousElementSibling!.matches('.sheet-tab,.reference-tab-group'))).toBe(true);
  await deep.click();await expect(deep).toHaveAttribute('aria-expanded','false');
  expect(await deep.evaluate(el=>getComputedStyle(el,'::after').height)).toBe('2.5px');
  await deep.click();await expect(selected).toBeVisible();
  await page.locator('.sheet-bar [data-action="reference-settings"]').click();await expect(page.getByRole('dialog')).toContainText('Dropdown settings');await page.keyboard.press('Escape');
  await page.locator('.sheet-bar').evaluate(el=>{(el as HTMLElement).style.width='200px';});
  const rail=page.locator('.sheet-bar>.tabs');await rail.evaluate(el=>{el.scrollLeft=0;});
  const fade=()=>page.locator('.sheet-bar').evaluate(el=>getComputedStyle(el,'::after').opacity);
  await expect.poll(fade).toBe('1');
  await rail.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await expect.poll(fade).toBe('0');
  expect(await rail.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  await expect(ddAdd).toBeVisible();await ddAdd.click();await expect(page.getByRole('dialog')).toContainText('New dropdown list or conversions');await page.keyboard.press('Escape');
  const after=await page.evaluate(async()=>{const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{allSheets}=await import(p+'model.ts') as typeof import('../../src/model'),store=await Store.open();try{return allSheets((await store.load())!.book).map(s=>s.cells);}finally{store.close();}});
  expect(after).toEqual(before);
});

test('DD uses the same grid, maintains duplicate identities and formats across row movement, archive, undo and reload',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.locator('td[data-r="1"][data-c="1"]').click();
  await dd(page);await page.locator('[data-action="new-reference"]').click();await page.locator('#answer').fill('Invented types');await page.getByRole('button',{name:'Create',exact:true}).click();
  const append=page.locator('.reference-append-row input');await append.focus();
  await expect(append).toHaveCSS('border-width','0px');await expect(append).toHaveCSS('border-radius','0px');await expect(append).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
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
for(const boundary of ['blank','occupied','gap'] as const)test(`dropdown at the table boundary (${boundary}) preserves freeform cells and table membership`,async({page})=>{
  await page.goto('/');await saved(page);
  await page.evaluate(async boundary=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),
      {blankSheet,key,setInput,uid}=await import(p+'model.ts') as typeof import('../../src/model'),
      {createTable}=await import(p+'table-management.ts') as typeof import('../../src/table-management'),
      {createReference,addReferenceValue,referenceFormula}=await import(p+'references.ts') as typeof import('../../src/references'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=blankSheet('Picker preview',8,12);book.sheets.unshift(s);
      for(const [index,name]of ['Food','Amount','Result'].entries())setInput(book,s,s.rows[0].id,s.columns[index+8].id,name);
      const table=createTable(book,s.id,{r1:0,r2:3,c1:8,c2:10},'PickerTable',true),source=createReference(book,'Synthetic food');
      addReferenceValue(book,source,'Invented option');
      setInput(book,s,s.rows[3].id,s.columns[9].id,'5');setInput(book,s,s.rows[3].id,s.columns[10].id,'=[@Amount]*2');
      s.validations.push({id:uid(),sheet:s.id,rows:[...table.rows],columns:[s.columns[8].id],source:JSON.stringify(referenceFormula(source))});
      if(boundary==='occupied')s.cells[key(s.rows[4].id,s.columns[9].id)]={note:'Preserve this existing note'};
      await store.save(book,state.version,'Synthetic table boundary');
    }finally{store.close();}
  },boundary);
  await page.reload();await page.getByRole('button',{name:'Picker preview',exact:true}).click();const before=await snapshot(page);
  const target=page.locator(`td[data-r="${boundary==='gap'?5:4}"][data-c="8"]`);await target.click();
  const picker=page.locator('.cell-dropdown');
  if(boundary!=='blank'){
    await expect(picker).toHaveCount(0);
    expect((await snapshot(page)).state.book.sheets.find(s=>s.name==='Picker preview')!.cells).toEqual(before.state.book.sheets.find(s=>s.name==='Picker preview')!.cells);
    expect((await snapshot(page)).state.book.tables).toEqual(before.state.book.tables);return;
  }
  await expect(picker.getByRole('option',{name:'Invented option',exact:true})).toBeVisible();
  expect((await snapshot(page)).state.book.tables).toEqual(before.state.book.tables);
  await page.keyboard.press('Escape');expect((await snapshot(page)).state.book.sheets.find(s=>s.name==='Picker preview')).toEqual(before.state.book.sheets.find(s=>s.name==='Picker preview'));
  await target.click();await picker.getByRole('option',{name:'Invented option',exact:true}).click();await expect(target).toHaveText('Invented option');
  const after=await snapshot(page),s=after.state.book.sheets.find(s=>s.name==='Picker preview')!,table=after.state.book.tables.find(t=>t.name==='PickerTable')!;
  expect(table.rows).toContain(s.rows[4].id);expect(s.cells[`${s.rows[4].id}:${s.columns[10].id}`].formula).toBeDefined();
  expect(s.validations[0].rows).toContain(s.rows[4].id);
  await page.locator('[data-action="undo"]').click();const undone=await snapshot(page);
  expect(undone.state.book.tables).toEqual(before.state.book.tables);
  const restored=undone.state.book.sheets.find(s=>s.name==='Picker preview')!,original=before.state.book.sheets.find(s=>s.name==='Picker preview')!;
  // Rendering may retain additional empty viewport buffer rows.
  expect({...restored,rows:restored.rows.slice(0,original.rows.length)}).toEqual(original);
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
