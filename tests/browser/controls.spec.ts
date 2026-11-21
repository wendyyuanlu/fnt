import {expect,test} from '@playwright/test';

test('grouping shortcuts preserve nested identities, formulas, undo and saved groups',async({page})=>{
  await page.goto('/');
  const snapshot=()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book.sheets[0];}finally{store.close();}
  });
  await expect(page.locator('#save-state')).toContainText(/^Saved/);const before=await snapshot();
  await page.locator('[data-row-select="1"] .row-index').click();await page.locator('[data-row-select="6"] .row-index').click({modifiers:['Shift']});
  await page.keyboard.press('Control+g');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const parent=(await snapshot()).groups.at(-1)!;
  expect(parent.axis).toBe('row');expect(parent.kind).toBe('summary');expect(parent.members).toEqual(before.rows.slice(1,7).map(r=>r.id));
  await page.locator('[data-row-select="2"] .row-index').click();await page.locator('[data-row-select="3"] .row-index').click({modifiers:['Shift']});
  await page.keyboard.press('Control+g');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const child=(await snapshot()).groups.at(-1)!;expect(child.members).toEqual(before.rows.slice(2,4).map(r=>r.id));
  await page.keyboard.press('Control+Shift+g');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot()).groups).toContainEqual(parent);expect((await snapshot()).groups).not.toContainEqual(child);
  await page.keyboard.press('Control+z');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot()).groups).toContainEqual(child);
  await page.locator('th[data-col="1"] .column-index').click();await page.locator('th[data-col="2"] .column-index').click({modifiers:['Shift']});
  await page.keyboard.press('Control+g');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const grouped=await snapshot();expect(grouped.groups.at(-1)!.axis).toBe('column');expect(grouped.cells).toEqual(before.cells);
  await page.reload();await page.locator('th[data-col="1"] .column-index').click();await page.locator('th[data-col="2"] .column-index').click({modifiers:['Shift']});
  await page.keyboard.press('Control+Shift+g');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot()).groups).toEqual(grouped.groups.slice(0,-1));
});

test('grouping shortcuts resolve cell axes but never hijack text editing',async({page})=>{
  await page.goto('/');await page.locator('td[data-r="1"][data-c="5"]').click();await page.locator('td[data-r="2"][data-c="5"]').click({modifiers:['Shift']});
  await page.keyboard.press('Control+g');await expect(page.getByRole('dialog')).toContainText('Group selection');
  await page.getByRole('dialog').getByRole('button',{name:'Rows',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.locator('#formula').focus();await page.keyboard.press('Control+Shift+g');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('summary and plain range shortcuts preserve different collapse semantics in the grid and Excel',async({page})=>{
  await page.goto('/');
  await page.locator('[data-row-select="1"] .row-index').click();await page.locator('[data-row-select="3"] .row-index').click({modifiers:['Shift']});await page.keyboard.press('Control+g');
  await page.locator('[data-row-select="5"] .row-index').click();await page.locator('[data-row-select="6"] .row-index').click({modifiers:['Shift']});await page.keyboard.press('Control+Alt+g');
  await page.locator('th[data-col="1"] .column-index').click();await page.locator('th[data-col="2"] .column-index').click({modifiers:['Shift']});await page.keyboard.press('Control+g');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const xml=await page.evaluate(async()=>{
    const load=(path:string)=>import(/* @vite-ignore */'/src/'+path+'.ts'),{Store}=await load('storage'),{exportXlsx}=await load('xlsx-export');
    const dependency='/node_modules/.vite/deps/fflate.js',{unzipSync,strFromU8}=await import(/* @vite-ignore */dependency);
    const store=await Store.open();try{
      const state=await store.load();state.book.sheets[0].groups.forEach((g:{collapsed:boolean})=>g.collapsed=true);
      const saved=await store.save(state.book,state.version,'Synthetic collapsed group types');
      const bytes=await exportXlsx(await store.backup(saved)),parts=unzipSync(bytes);
      return strFromU8(parts['xl/worksheets/sheet1.xml']);
    }finally{store.close();}
  });
  expect(xml).toContain('summaryBelow="0"');expect(xml).toMatch(/<row r="2"(?![^>]*hidden="1")[^>]*collapsed="1"/);
  expect(xml).toMatch(/<row r="3"[^>]*hidden="1"/);expect(xml).toMatch(/<row r="6"[^>]*hidden="1"/);
  await page.reload();await expect(page.locator('[data-row-select="1"]')).toHaveCount(1);
  await expect(page.locator('[data-row-select="2"],[data-row-select="5"],[data-row-select="6"]')).toHaveCount(0);
  await expect(page.locator('th[data-col="1"]')).toHaveCount(1);await expect(page.locator('th[data-col="2"]')).toHaveCount(0);
});

test('table column dialog manages dropdowns and formula patterns without replacing manual overrides',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  const manual=page.locator('td[data-r="2"][data-c="5"]');
  await manual.click();await page.locator('#formula').fill('777');await page.locator('#formula').press('Enter');
  await page.locator('th[data-col="5"]').dblclick();await expect(page.getByRole('dialog')).toContainText('Table column');
  await page.locator('#column-dropdowns').click();
  await page.getByRole('checkbox',{name:/Country$/}).check();await page.getByRole('button',{name:'Apply dropdown',exact:true}).click();
  await expect(manual).toHaveText('777');
  await page.locator('th[data-col="5"]').dblclick();await expect(page.locator('#column-remove-dropdowns')).toBeEnabled();
  await page.locator('#column-dropdowns').click();await expect(page.getByRole('checkbox',{name:/Country$/})).toBeChecked();await page.keyboard.press('Escape');
  await page.locator('th[data-col="5"]').dblclick();await page.locator('#column-remove-dropdowns').click();
  await page.locator('th[data-col="5"]').dblclick();await expect(page.locator('#column-remove-dropdowns')).toBeDisabled();
  await page.locator('#column-formulas').click();await page.locator('#column-formula').fill('=SUM(');
  await page.getByRole('button',{name:'Apply formula',exact:true}).click();await expect(page.locator('#column-formula')).toBeVisible();
  await page.locator('#column-formula').fill('=42');await page.getByRole('button',{name:'Apply formula',exact:true}).click();
  await expect(page.locator('td[data-r="1"][data-c="5"]')).toHaveText('42');await expect(manual).toHaveText('777');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await expect(manual).toHaveText('777');
  await manual.click();await page.getByRole('button',{name:'Restore calculation',exact:true}).click();await expect(manual).toHaveText('42');
});

test('toolbar icons share size and styling while formatting and colors persist',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.toolbar-icon')).toHaveCount(17);
  const icons=await page.locator('.toolbar-icon').evaluateAll(elements=>elements.map(el=>{
    const svg=el.getBoundingClientRect(),button=el.closest('button')!.getBoundingClientRect();
    return{width:svg.width,height:svg.height,center:Math.abs(svg.top+svg.height/2-button.top-button.height/2),stroke:el.getAttribute('stroke-width'),view:el.getAttribute('viewBox'),text:el.querySelector('text')!==null,paths:[...el.querySelectorAll('path')].map(p=>({stroke:getComputedStyle(p).strokeWidth,effect:getComputedStyle(p).vectorEffect}))};
  }));
  for(const icon of icons){expect(icon.width).toBe(18);expect(icon.height).toBe(18);expect(icon.center).toBeLessThan(.5);expect(icon.stroke).toBe('1');expect(icon.view).toBe('0 0 24 24');expect(icon.text).toBe(false);for(const path of icon.paths){expect(path.stroke).toBe('1px');expect(path.effect).toBe('non-scaling-stroke');}}
  const cell=page.locator('td[data-r="1"][data-c="5"]');
  await cell.click();await page.getByRole('button',{name:'Italic',exact:true}).click();await page.getByRole('button',{name:'Strikethrough',exact:true}).click();await page.getByRole('button',{name:'Underline',exact:true}).click();
  await expect(cell).toHaveCSS('font-style','italic');await expect(cell).toHaveCSS('text-decoration-line','underline line-through');
  await expect(page.getByRole('button',{name:'Italic',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Text color',exact:true}).click();await expect(page.locator('.color-swatch')).toHaveCount(30);await page.locator('[data-color="#c00000"]').click();
  await page.getByRole('button',{name:'Cell background color',exact:true}).click();await page.locator('[data-color="#fff2cc"]').click();
  await expect(cell).toHaveCSS('color','rgb(192, 0, 0)');await expect(cell).toHaveCSS('background-color','rgb(255, 242, 204)');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell).not.toHaveCSS('background-color','rgb(255, 242, 204)');await expect(cell).toHaveCSS('color','rgb(192, 0, 0)');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(cell).toHaveCSS('background-color','rgb(255, 242, 204)');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(cell).toHaveCSS('font-style','italic');await expect(cell).toHaveCSS('text-decoration-line','underline line-through');await expect(cell).toHaveCSS('color','rgb(192, 0, 0)');await expect(cell).toHaveCSS('background-color','rgb(255, 242, 204)');
});

test('assigned dropdown opens directly from the cell, supports keyboard, manual text, and closes DD as a toggle',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await expect(page.locator('[data-action="picker"]')).toHaveCount(0);
  const cell=page.locator('td[data-r="1"][data-c="1"]');
  await cell.click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  await cell.click();await expect(page.locator('.cell-dropdown')).toBeVisible();
  await expect(page.locator('.cell-dropdown').getByRole('option')).toHaveText(['Taiwan','Japan','Canada','USA']);
  await page.getByRole('option',{name:'Canada',exact:true}).click();await expect(cell).toHaveText('Canada');await expect(cell).toHaveClass(/linked/);await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell).not.toHaveText('Canada');await cell.click();await page.keyboard.press('Escape');await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowDown');await page.getByRole('searchbox',{name:'Search dropdown options'}).fill('Jap');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(cell).toHaveText('Japan');
  await page.locator('[data-action="references"]').click();await page.locator('[data-reference]').filter({hasText:/^Country$/}).click();
  await page.locator('td[data-r]').filter({hasText:/^Japan$/}).click();await page.locator('#formula').fill('Renamed Japan');await page.locator('#formula').press('Enter');
  await page.getByRole('button',{name:'Close DD',exact:true}).click();await expect(cell).toHaveText('Renamed Japan');await expect(cell).toHaveClass(/linked/);
  await cell.dblclick();await expect(page.locator('#cell-editor')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await page.keyboard.press('Escape');
  await cell.click();await page.getByRole('button',{name:'Custom',exact:true}).click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);await page.getByRole('textbox',{name:'Edit selected cell',exact:true}).fill('Manual place');await page.keyboard.press('Enter');await expect(cell).toHaveText('Manual place');await expect(cell).not.toHaveClass(/linked/);
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await cell.click();await expect(page.getByRole('button',{name:'Custom',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('tab',{name:'Snack / Country',exact:true}).click();await expect(page.locator('.cell-dropdown').getByRole('option')).toHaveCount(4);await page.keyboard.press('Escape');
  const backgrounds=await page.locator('.app-header,.toolbar,.formula-bar,.grid-shell').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundColor));
  await page.locator('[data-action="references"]').click();await expect(page.locator('[data-action="back-workbook"]')).toHaveCount(0);await expect(page.locator('body')).toHaveClass(/dd-mode/);
  expect(await page.locator('.app-header,.toolbar,.formula-bar,.grid-shell').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundColor))).toEqual(backgrounds);
  await expect(page.locator('.grid thead th').first()).toHaveCSS('background-color','rgb(245, 241, 248)');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(247, 242, 250)');await expect(page.locator('html')).toHaveCSS('background-color','rgb(247, 242, 250)');await expect(page.locator('[data-action="picker"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Close DD',exact:true}).click();await expect(page.locator('body')).not.toHaveClass(/dd-mode/);
  await expect(page.locator('[data-action="back-workbook"]')).toHaveCount(0);await expect(cell).toHaveText('Manual place');expect(errors).toEqual([]);
});
test('multiple dropdown sources persist for cells and columns and grid previews stop at four options',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const cell=page.locator('td[data-r="2"][data-c="2"]');await cell.click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'Grid view',exact:true}).click();
  const dialog=page.getByRole('dialog'),height=await dialog.evaluate(el=>el.getBoundingClientRect().height);await expect(dialog).not.toContainText('row(s)');await page.getByRole('button',{name:'List view',exact:true}).click();expect(await dialog.evaluate(el=>el.getBoundingClientRect().height)).toBe(height);await page.getByRole('button',{name:'Grid view',exact:true}).click();expect(await dialog.evaluate(el=>el.getBoundingClientRect().height)).toBe(height);
  const category=page.locator('.dropdown-source-card').filter({has:page.getByRole('checkbox',{name:'Snack / Category',exact:true})});
  await expect(page.getByRole('checkbox',{name:/Ingredients.*(?:Sodium|Calories)/})).toHaveCount(0);
  await expect(page.getByRole('checkbox',{name:'Ingredients',exact:true})).toHaveCount(1);await expect(page.locator('.dropdown-source-card')).toHaveCount(8);
  await expect(category.locator('li')).toHaveText(['Chocolate','Gummy','Chip/Noodle','Cookie']);await expect(category.locator('li')).toHaveCount(4);
  expect(await page.locator('.dropdown-source-card').evaluateAll(cards=>cards.every(card=>card.querySelectorAll('li').length<=4))).toBe(true);
  await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('checkbox',{name:'Snack / Category',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown',exact:true}).click();
  await expect(cell).toHaveText('');await cell.click();await expect(page.locator('.cell-dropdown').getByRole('option')).toHaveCount(4);await expect(page.locator('.cell-dropdown').getByRole('tab')).toHaveText(['Snack / Country','Snack / Category']);await expect(page.getByRole('button',{name:'Custom',exact:true})).toHaveAttribute('aria-pressed','false');await expect(page.locator('.dropdown-option-group,.cell-dropdown .bottom')).toHaveCount(0);
  await page.locator('.cell-dropdown').getByRole('option',{name:'Japan',exact:true}).click();await expect(cell).toHaveText('Japan');await expect(cell).toHaveClass(/linked/);
  await page.locator('th[data-col="2"] .column-index').click();await page.locator('[data-action="dropdown-source"]').click();
  await expect(page.getByRole('checkbox',{name:'Snack / Country',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'Snack / Category',exact:true})).toBeChecked();
  await page.getByRole('checkbox',{name:'Snack / Category',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Snack / Flavour',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown',exact:true}).click();
  await expect(cell).toHaveText('Japan');await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await page.locator('td[data-r="3"][data-c="2"]').click();await expect(page.locator('.cell-dropdown').getByRole('option')).toHaveText(['Taiwan','Japan','Canada','USA']);await page.getByRole('tab',{name:'Snack / Flavour',exact:true}).click();await expect(page.locator('.cell-dropdown').getByRole('option')).toHaveText(['Savoury','Sweet','Mixed']);
  await page.keyboard.press('Escape');
});
test('formatting shortcuts act on selected cells and expose matching tooltip hints',async({page})=>{
  await page.goto('/');const cell=page.locator('td[data-r="1"][data-c="5"]');await cell.click();
  for(const key of ['b','i','u','5'])await page.keyboard.press('Control+'+key);
  await expect(cell).toHaveCSS('font-weight','700');await expect(cell).toHaveCSS('font-style','italic');await expect(cell).toHaveCSS('text-decoration-line','underline line-through');
  await page.keyboard.press('Control+Alt+w');await expect(cell).toHaveCSS('white-space','pre-wrap');await expect(page.getByRole('button',{name:'Wrap text',exact:true})).toHaveAttribute('aria-keyshortcuts','Control+Alt+w Meta+Alt+w');
  await page.keyboard.press('Control+Alt+c');await expect(page.getByRole('dialog')).toContainText('Text color');await page.locator('[data-color="#c00000"]').click();
  await page.keyboard.press('Control+Alt+b');await expect(page.getByRole('dialog')).toContainText('Cell background color');await page.locator('[data-color="#fff2cc"]').click();
  await expect(cell).toHaveCSS('color','rgb(192, 0, 0)');await expect(cell).toHaveCSS('background-color','rgb(255, 242, 204)');
  await page.keyboard.press('Control+Alt+n');await expect(page.locator('#number-format')).toBeVisible();await page.keyboard.press('Escape');
  await page.locator('#formula').focus();await page.keyboard.press('Control+b');await expect(cell).toHaveCSS('font-weight','700');
});
test('source tabs remember column defaults without rewriting links or linking matching manual text',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('th[data-col="2"] .column-index').click();await page.locator('[data-action="dropdown-source"]').click();await expect(page.getByRole('button',{name:'Grid view',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('checkbox',{name:'Snack / Category',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  const first=page.locator('td[data-r="2"][data-c="2"]'),second=page.locator('td[data-r="3"][data-c="2"]');
  await first.click();await page.locator('.cell-dropdown').getByRole('option',{name:'Japan',exact:true}).click();
  await first.click();await page.getByRole('tab',{name:'Snack / Category',exact:true}).click();await expect(first).toHaveText('Japan');await expect(first).toHaveClass(/linked/);await page.keyboard.press('Escape');
  await second.click();await expect(page.getByRole('tab',{name:'Snack / Category',exact:true})).toHaveAttribute('aria-selected','true');await page.locator('.cell-dropdown').getByRole('option',{name:'Cookie',exact:true}).click();
  await first.click();await expect(page.getByRole('tab',{name:'Snack / Country',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Custom',exact:true}).click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Edit selected cell'})).toHaveValue('Japan');await expect(first).toHaveClass(/linked/);await page.getByRole('textbox',{name:'Edit selected cell'}).fill('Japan');await page.keyboard.press('Enter');await expect(first).not.toHaveClass(/linked/);
  await expect(second).toHaveText('Cookie');await expect(second).toHaveClass(/linked/);await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await page.locator('td[data-r="4"][data-c="2"]').click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Edit selected cell'})).toBeFocused();await page.keyboard.press('Escape');await page.keyboard.press('Alt+ArrowDown');
  const manual=page.getByRole('button',{name:'Custom',exact:true});await expect(manual).toHaveAttribute('aria-pressed','true');await expect(manual).toHaveCSS('font-weight','700');await expect(manual.locator('.pencil-body')).toHaveCSS('fill','rgb(25, 87, 71)');await expect(page.locator('.cell-dropdown')).not.toContainText('Current value');await expect(page.locator('.cell-dropdown textarea,.dropdown-manual-form,.cell-dropdown .bottom')).toHaveCount(0);await expect(page.locator('.cell-dropdown').getByRole('option',{selected:true})).toHaveCount(0);
  await manual.click();await page.getByRole('textbox',{name:'Edit selected cell'}).fill('=Japan');await page.keyboard.press('Enter');await expect(page.locator('td[data-r="4"][data-c="2"]')).toHaveText('=Japan');await expect(page.locator('td[data-r="4"][data-c="2"]')).not.toHaveClass(/calculated|linked/);
  await second.click();await expect(page.getByRole('tab',{name:'Snack / Category',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Choose another source',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Dropdowns for selection');
});
test('formatting buttons track clicked cells and shortcut hints use compact key badges',async({page})=>{
  await page.goto('/');const first=page.locator('td[data-r="1"][data-c="5"]'),second=page.locator('td[data-r="2"][data-c="5"]');
  await first.click();for(const action of ['bold','italic','underline','strikethrough','wrap'])await page.locator(`[data-action="${action}"]`).click();
  await second.click();for(const action of ['bold','italic','underline','strikethrough','wrap'])await expect(page.locator(`[data-action="${action}"]`)).toHaveAttribute('aria-pressed','false');
  await first.click();for(const action of ['bold','italic','underline','strikethrough','wrap'])await expect(page.locator(`[data-action="${action}"]`)).toHaveAttribute('aria-pressed','true');
  const bold=page.getByRole('button',{name:'Bold',exact:true});await bold.hover();await expect(page.getByRole('tooltip')).toContainText('Bold');await expect(page.getByRole('tooltip').locator('kbd')).toHaveText(['Ctrl','B']);await expect(bold).not.toHaveAttribute('title');
  await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('button',{name:'Assign DD',exact:true}).hover();await expect(page.getByRole('tooltip')).toHaveCount(0);
  const wrap=page.getByRole('button',{name:'Wrap text',exact:true});await wrap.focus();await expect(page.getByRole('tooltip').locator('kbd')).toHaveText(['Ctrl','Alt','W']);await expect(wrap).toHaveAttribute('aria-describedby','shortcut-hint');
  await page.locator('[data-action="save"]').hover();await expect(page.getByRole('tooltip').locator('kbd')).toHaveText(['Ctrl','S']);
});
