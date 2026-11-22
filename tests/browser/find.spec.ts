import {expect,test,type Page} from '@playwright/test';

async function fixture(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const model='/src/model.ts',storage='/src/storage.ts',{setInput,key}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=book.sheets.find(s=>s.name==='Notebook')!,t=book.tables.find(t=>t.name==='Ingredients')!,ingredients=book.sheets.find(s=>s.id===t.sheet)!;
      setInput(book,ingredients,t.rows[0],t.columns[0].column,'Cottage linked');
      for(const [r,value]of [[1,'Cottage cheese'],[2,'cottage cheese'],[3,'Cottage'],[4,'="Cottage cheese"']] as const)setInput(book,s,s.rows[r].id,s.columns[1].id,value);
      s.cells[key(s.rows[5].id,s.columns[1].id)]={binding:{table:t.id,row:t.rows[0],column:t.columns[0].id}};
      await store.save(book,state.version,'Synthetic Find fixture');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.keyboard.press('Control+f');await expect(page.getByRole('dialog')).toBeVisible();
}
async function membershipFixture(page:Page,conflict=false){
  await fixture(page);await page.getByRole('button',{name:'Close dialog'}).click();
  await page.evaluate(async conflict=>{
    const model='/src/model.ts',storage='/src/storage.ts',{clone,key,moveColumns}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,t=book.tables.find(t=>t.name==='Ingredients')!,s=book.sheets.find(s=>s.id===t.sheet)!,row=t.rows[1],extra=s.columns[7].id;
      t.rows=t.rows.filter(id=>id!==row);s.cells[key(row,t.columns[0].column)]={value:'Synthetic gap',note:'Keep this note',format:{wrap:false}};
      s.cells[key(t.header,extra)]={value:'Extra field'};s.cells[key(row,extra)]={value:'Existing column data'};
      moveColumns(book,s,[extra],2);
      if(conflict)book.tables.push({...clone(t),id:'synthetic-owner',name:'Owner',header:s.rows[8].id,rows:[row],columns:[{...clone(t.columns[0]),id:'owner-field'}]});
      await store.save(book,state.version,'Synthetic membership gaps');
    }finally{store.close();}
  },conflict);
  await page.reload();await page.getByRole('button',{name:'Ingredients',exact:true}).click();await page.keyboard.press('Control+f');await page.getByRole('tab',{name:'Rows/Columns',exact:true}).click();
}
test('Rows/Columns converts selected gaps, preserves data and supports persisted undo',async({page})=>{
  await membershipFixture(page);
  await expect(page.locator('#membership-count')).toHaveText('2 sheet-only rows/columns');
  await expect(page.getByRole('dialog').getByRole('button',{name:'Convert to table',exact:true})).toBeDisabled();
  await expect(page.getByRole('checkbox',{name:'Ingredients Row 3',exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'Ingredients Column C',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'Select all membership results',exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'Convert to table',exact:true}).click();
  await expect(page.locator('#membership-count')).toHaveText('0 sheet-only rows/columns');await expect(page.locator('#membership-feedback')).toHaveText('Converted 2 row/column memberships.');
  await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.locator('#save-state')).toContainText('Saved');
  await expect(page.locator('td[data-r="2"][data-c="0"]')).toHaveText('Synthetic gap');await expect(page.locator('td[data-r="2"][data-c="2"]')).toHaveText('Existing column data');await expect(page.locator('td[data-r="2"].table-right-edge')).toHaveCount(1);
  const joined=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const {book}=(await store.load())!,t=book.tables.find(t=>t.name==='Ingredients')!,s=book.sheets.find(s=>s.id===t.sheet)!;return{row:t.rows.includes(s.rows[2].id),column:t.columns.some(c=>c.column===s.columns[2].id),cell:s.cells[`${s.rows[2].id}:${s.columns[0].id}`]};}finally{store.close();}
  });
  expect(joined).toMatchObject({row:true,column:true,cell:{value:'Synthetic gap',note:'Keep this note',format:{wrap:false}}});
  await page.keyboard.press('Control+z');await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();await page.keyboard.press('Control+f');await page.getByRole('tab',{name:'Rows/Columns',exact:true}).click();await expect(page.locator('#membership-count')).toHaveText('2 sheet-only rows/columns');
});
test('Rows/Columns rejects conflicting table ownership without partially converting the selection',async({page})=>{
  await membershipFixture(page,true);
  await page.getByRole('checkbox',{name:'Ingredients Row 3',exact:true}).check();await page.getByRole('checkbox',{name:'Ingredients Column C',exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'Convert to table',exact:true}).click();
  await expect(page.locator('#membership-feedback')).toHaveAttribute('role','alert');await expect(page.locator('#membership-feedback')).toContainText('another table');
  await expect(page.getByRole('checkbox',{name:'Ingredients Column C',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog'}).click();await page.reload();await page.keyboard.press('Control+f');await page.getByRole('tab',{name:'Rows/Columns',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Ingredients Row 3',exact:true})).toBeVisible();await expect(page.getByRole('checkbox',{name:'Ingredients Column C',exact:true})).toBeVisible();
});
for(const axis of ['row','column'] as const)test(`toolbar conversion joins all nested ${axis} summary members, including hidden descendants`,async({page})=>{
  await membershipFixture(page);await page.getByRole('button',{name:'Close dialog'}).click();
  await page.evaluate(async axis=>{
    const model='/src/model.ts',storage='/src/storage.ts',{moveColumns}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,t=book.tables.find(t=>t.name==='Ingredients')!,s=book.sheets.find(s=>s.id===t.sheet)!;
      if(axis==='column')moveColumns(book,s,[s.columns[8].id],4);
      const items=axis==='row'?s.rows:s.columns,members=items.slice(1,5).map(item=>item.id);
      s.groups.push({id:'conversion-summary',axis,kind:'summary',members,collapsed:true,label:'Synthetic summary'},{id:'conversion-nested',axis,kind:'summary',members:members.slice(2),collapsed:true,label:'Nested summary'});
      await store.save(book,state.version,'Synthetic nested conversion');
    }finally{store.close();}
  },axis);
  await page.reload();await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator(axis==='row'?'th[data-row-select="1"]':'th[data-col="1"]').click();
  await page.getByRole('button',{name:'Convert to table',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved');
  const result=await page.evaluate(async axis=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const{book}=(await store.load())!,t=book.tables.find(t=>t.name==='Ingredients')!,s=book.sheets.find(s=>s.id===t.sheet)!,group=s.groups.find(g=>g.id==='conversion-summary')!;return{joined:group.members.every(id=>axis==='row'?t.rows.includes(id):t.columns.some(c=>c.column===id)),collapsed:s.groups.filter(g=>g.id.startsWith('conversion-')).every(g=>g.collapsed),note:s.cells[`${s.rows[2].id}:${s.columns[0].id}`].note};}finally{store.close();}
  },axis);
  expect(result).toEqual({joined:true,collapsed:true,note:'Keep this note'});
});
test('Text combines search and replacement and preserves drafts across Rows/Columns',async({page})=>{
  await fixture(page);const dialog=page.getByRole('dialog'),height=(await dialog.boundingBox())!.height;
  expect(height).toBeGreaterThan(700);await expect(page.locator('#replace-label')).toBeVisible();
  await expect(page.locator('#find-help')).toHaveCount(0);
  await page.locator('#find-text').fill('Cottage');await expect(page.locator('#find-count')).toHaveText('Results found (5)');
  expect((await dialog.boundingBox())!.height).toBe(height);
  await page.locator('#replace-text').fill('Fresh');
  expect((await dialog.boundingBox())!.height).toBe(height);
  await page.getByRole('tab',{name:'Rows/Columns',exact:true}).click();await expect(page.locator('#replace-label')).toBeHidden();
  await page.getByRole('tab',{name:'Text',exact:true}).click();await expect(page.locator('#replace-text')).toHaveValue('Fresh');
  await page.keyboard.press('Control+f');await expect(page.locator('#find-text')).toBeFocused();
  await page.locator('#find-text').fill('no matches');await expect(page.locator('#find-count')).toHaveText('Results found (0)');
  expect((await dialog.boundingBox())!.height).toBe(height);
});
test('All scope stays synchronized, and results have sheet subheaders rather than a Sheet column',async({page})=>{
  await fixture(page);await page.locator('#find-text').fill('Cottage');
  await expect(page.locator('.find-scope label').first()).toHaveText('All');
  const all=page.getByRole('checkbox',{name:'All',exact:true});expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBe(true);
  await all.check();await expect(all).toBeChecked();await expect(page.locator('#find-count')).not.toHaveText('Results found (5)');
  const selected=await page.locator('input[name=scope]').evaluateAll(inputs=>inputs.every(input=>(input as HTMLInputElement).checked));expect(selected).toBe(true);
  await expect(page.locator('.find-results-panel .find-results-table thead th')).toHaveText(['Cell','Value']);
  const names=await page.locator('.find-sheet-header').allTextContents();expect(new Set(names).size).toBe(names.length);expect(names).toContain('Notebook');
  await page.getByRole('checkbox',{name:'Notebook',exact:true}).uncheck();expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBe(true);
  await all.check();await all.uncheck();await expect(page.locator('#find-count')).toHaveText('Results found (0)');await expect(page.locator('#find-feedback')).toContainText('Select at least one sheet');
});
test('case, whole-cell and wildcard searches work, and Find next honors direction',async({page})=>{
  await fixture(page);await page.locator('#find-text').fill('Cottage');
  await page.getByRole('checkbox',{name:'Match case',exact:true}).check();await expect(page.locator('#find-count')).toHaveText('Results found (4)');
  await page.getByRole('checkbox',{name:'Match entire cell contents',exact:true}).check();await expect(page.locator('#find-count')).toHaveText('Results found (1)');
  await page.locator('#find-text').fill('Cott?ge*');await expect(page.locator('#find-count')).toHaveText('Results found (4)');
  await page.getByRole('checkbox',{name:'Match case',exact:true}).uncheck();
  await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.locator('.address')).toHaveText('B2');
  await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.locator('.address')).toHaveText('B3');
  await page.getByRole('combobox',{name:'Direction',exact:true}).click();await page.getByRole('option',{name:'Up',exact:true}).click();await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.locator('.address')).toHaveText('B2');
});
test('Replace and Replace all preserve formulas and linked source identities',async({page})=>{
  await fixture(page);await page.locator('#find-text').fill('Cottage');await page.locator('#replace-text').fill('Fresh');
  await page.getByRole('button',{name:'Replace',exact:true}).click();await expect(page.locator('#find-count')).toHaveText('Results found (4)');
  await page.getByRole('button',{name:'Replace all',exact:true}).click();await expect(page.locator('#find-count')).toHaveText('Results found (2)');await expect(page.locator('#find-feedback')).toContainText('2 other results left unchanged');
  await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.locator('#save-state')).toContainText('Saved');
  await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Fresh cheese');await expect(page.locator('td[data-r="4"][data-c="1"]')).toHaveText('Cottage cheese');await expect(page.locator('td[data-r="5"][data-c="1"]')).toHaveText('Cottage linked');
  const kinds=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const {book}=(await store.load())!,s=book.sheets.find(s=>s.name==='Notebook')!;return [s.cells[`${s.rows[4].id}:${s.columns[1].id}`].formula?.kind,!!s.cells[`${s.rows[5].id}:${s.columns[1].id}`].binding];}finally{store.close();}
  });expect(kinds).toEqual(['literal',true]);
});
test('Ctrl+F commits an in-cell draft before opening the search dialog',async({page})=>{
  await fixture(page);await page.getByRole('button',{name:'Close dialog'}).click();
  await page.locator('td[data-r="6"][data-c="2"]').click();await page.keyboard.type('committed search draft');await page.keyboard.press('Control+f');
  await expect(page.getByRole('dialog')).toBeVisible();await page.locator('#find-text').fill('committed search draft');await expect(page.locator('#find-count')).toHaveText('Results found (1)');
});
test('Find reuses the existing dialog field and button styles without overflowing the viewport',async({page})=>{
  await fixture(page);
  await page.locator('#find-text').evaluate(el=>(el as HTMLInputElement).blur());
  const style=async(selector:string)=>page.locator(selector).evaluate(el=>{
    const css=getComputedStyle(el);return {radius:css.borderRadius,border:css.borderColor,padding:css.padding,font:css.fontFamily,size:css.fontSize};
  });
  const find={input:await style('#find-text'),button:await style('#find-next'),close:await style('.find-dialog .close')};
  await page.getByRole('button',{name:'Close dialog'}).click();await page.getByRole('button',{name:'Browse values',exact:true}).click();
  expect(await style('#browse-search')).toEqual(find.input);
  expect(await style('#browse-go')).toEqual(find.button);expect(await style('dialog .close')).toEqual(find.close);
  await page.getByRole('button',{name:'Close dialog'}).click();await page.keyboard.press('Control+f');
  const bounds=await page.getByRole('dialog').boundingBox(),button=await page.locator('#replace-all').boundingBox(),viewport=page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(button!.x+button!.width).toBeLessThanOrEqual(bounds!.x+bounds!.width);
  expect(button!.y+button!.height).toBeLessThanOrEqual(bounds!.y+bounds!.height);
  await expect(page.locator('#find-all-sheets')).toBeInViewport();
});
test('Focused Find input shares the dropdown active treatment without changing layout',async({page})=>{
  await fixture(page);
  const input=page.locator('#find-text'),dialog=page.getByRole('dialog'),height=(await dialog.boundingBox())!.height;
  const colors=async(selector:string)=>page.locator(selector).evaluate(el=>{const css=getComputedStyle(el);return {background:css.backgroundColor,border:css.borderColor};});
  const stroke=async(selector:string)=>page.locator(selector).evaluate(el=>{const css=getComputedStyle(el);return {border:css.borderWidth,outline:css.outlineWidth,offset:css.outlineOffset};});
  await expect(input).toBeFocused();const active=await colors('#find-text');
  expect(await stroke('#find-text')).toEqual({border:'1px',outline:'0px',offset:'0px'});
  await page.getByRole('combobox',{name:'Within',exact:true}).focus();expect(await colors('#find-within-trigger')).toEqual(active);
  expect(await stroke('#find-within-trigger')).toEqual({border:'1px',outline:'0px',offset:'0px'});
  expect(await colors('#find-text')).not.toEqual(active);
  await input.click();expect(await colors('#find-text')).toEqual(active);expect((await dialog.boundingBox())!.height).toBe(height);
});
test('Find dropdowns reuse spreadsheet popup options, synchronize scope and support keyboard dismissal',async({page})=>{
  await fixture(page);
  const within=page.getByRole('combobox',{name:'Within',exact:true});
  await expect(within).toHaveText('Selected sheets');await within.click();
  await expect(page.locator('.find-dialog .cell-dropdown')).toBeVisible();
  await expect(page.getByRole('listbox',{name:'Within options',exact:true}).getByRole('option')).toHaveText(['Selected sheets','Workbook']);
  await expect(page.getByRole('option',{name:'Selected sheets',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(within).toHaveText('Workbook');await expect(page.getByRole('checkbox',{name:'All',exact:true})).toBeChecked();await expect(within).toBeFocused();
  await page.getByRole('checkbox',{name:'Notebook',exact:true}).uncheck();await expect(within).toHaveText('Selected sheets');
  await within.press('ArrowDown');await page.keyboard.press('Escape');await expect(page.locator('.cell-dropdown')).toHaveCount(0);await expect(page.getByRole('dialog')).toBeVisible();await expect(within).toBeFocused();
  await within.click();await page.locator('#find-text').click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await within.click();await page.keyboard.press('Tab');await expect(page.getByRole('combobox',{name:'Direction',exact:true})).toBeFocused();
  await page.getByRole('combobox',{name:'Direction',exact:true}).click();await page.keyboard.press('Control+f');await expect(page.locator('.cell-dropdown')).toHaveCount(0);await expect(page.locator('#find-text')).toBeFocused();
});
