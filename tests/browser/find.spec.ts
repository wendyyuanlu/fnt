import {expect,test,type Page} from '@playwright/test';
const headerStyle=(el:Element)=>{const s=getComputedStyle(el);return{background:s.backgroundColor,color:s.color,size:s.fontSize,weight:s.fontWeight,right:s.borderRight,bottom:s.borderBottom};};
async function expectSecondRow(page:Page,target:number,previous:number){
  await expect.poll(()=>page.locator('#grid-scroll').evaluate((grid,{target,previous})=>{
    const header=grid.querySelector('thead')!.getBoundingClientRect(),before=grid.querySelector(`tr[data-row="${previous}"]`)!.getBoundingClientRect(),after=grid.querySelector(`tr[data-row="${target}"]`)!.getBoundingClientRect();
    return Math.max(Math.abs(before.top-header.bottom),Math.abs(after.top-before.bottom));
  },{target,previous})).toBeLessThan(2);
}

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
      delete s.cells[key(row,t.columns[2].column)];
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
  await expect(page.locator('#membership-feedback')).toHaveText('These are rows / columns that are currently sitting between table rows / columns but are not part of the table.');
  await expect(page.locator('#membership-panel .find-sheet-header')).toHaveText('Ingredients');
  await expect(page.locator('#membership-panel .find-table-header')).toHaveText('Table: Ingredients');
  await expect(page.locator('#membership-panel thead th').nth(1)).toHaveText('Position');
  expect((await page.locator('#membership-panel thead th').nth(1).boundingBox())!.width).toBe(60);
  const sheetLabel=await page.locator('#membership-panel .find-sheet-header th').evaluate(headerStyle),tableLabel=await page.locator('#membership-panel .find-table-header th').evaluate(headerStyle);
  expect(tableLabel).toEqual({...sheetLabel,weight:'400'});
  expect(sheetLabel.weight).toBe('600');
  await expect(page.locator('[data-membership-result] th')).toHaveText(['Row 3','Column C']);
  const row=page.locator('[data-membership-result]').filter({has:page.getByRole('checkbox',{name:'Ingredients Row 3',exact:true})});
  await expect(row.locator('[data-membership-context]')).toHaveCount(7);
  await expect(row.locator('[data-membership-context="A3"]')).toHaveText('Synthetic gap');
  await expect(row.locator('[data-membership-context="C3"]')).toHaveText('Existing column data');
  await expect(row.locator('[data-membership-context="D3"]')).toHaveText('');
  const column=page.locator('[data-membership-result]').filter({has:page.getByRole('checkbox',{name:'Ingredients Column C',exact:true})});
  await expect(column.locator('[data-membership-context="C1"]')).toHaveText('Extra field');
  await expect(column.locator('[data-membership-context="C3"]')).toHaveText('Existing column data');
  await expect(row.locator('[data-membership-context="A3"]')).toHaveCSS('border-right','1px solid rgb(230, 233, 225)');
  expect(await page.locator('[data-membership-result] th').first().evaluate(headerStyle)).toEqual(await page.locator('.grid thead th[data-col]:not(.column-selected)').first().evaluate(headerStyle));
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
  await page.keyboard.press('Control+z');await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();await expect(page.locator('.grid')).toBeVisible();await page.keyboard.press('Control+f');await page.getByRole('tab',{name:'Rows/Columns',exact:true}).click();await expect(page.locator('#membership-count')).toHaveText('2 sheet-only rows/columns');
});
test('Rows/Columns rejects conflicting table ownership without partially converting the selection',async({page})=>{
  await membershipFixture(page,true);
  await page.getByRole('checkbox',{name:'Ingredients Row 3',exact:true}).check();await page.getByRole('checkbox',{name:'Ingredients Column C',exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'Convert to table',exact:true}).click();
  await expect(page.locator('#membership-feedback')).toHaveAttribute('role','alert');await expect(page.locator('#membership-feedback')).toContainText('another table');
  await expect(page.getByRole('checkbox',{name:'Ingredients Column C',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog'}).click();await page.reload();await expect(page.locator('.grid')).toBeVisible();await page.keyboard.press('Control+f');await page.getByRole('tab',{name:'Rows/Columns',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Ingredients Row 3',exact:true})).toBeVisible();await expect(page.getByRole('checkbox',{name:'Ingredients Column C',exact:true})).toBeVisible();
});
for(const axis of ['row','column'] as const)test(`Rows/Columns ${axis} previews navigate to and select their source without converting it`,async({page})=>{
  await membershipFixture(page);
  const result=page.locator('[data-membership-result]').filter({has:page.getByRole('checkbox',{name:axis==='row'?'Ingredients Row 3':'Ingredients Column C',exact:true})});
  await result.locator('input').check();await expect(page.getByRole('dialog')).toBeVisible();
  if(axis==='row')await result.locator('[data-membership-context="A3"]').click();else{await result.focus();await result.press('Enter');}
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.grid')).toHaveAttribute('aria-label','Ingredients');
  await expect(page.locator('.grid')).toHaveClass(axis==='row'?/selection-rows/:/selection-columns/);
  await expect(page.locator(axis==='row'?'th[data-row-select="2"]':'th[data-col="2"]')).toHaveClass(axis==='row'?/row-selected/:/column-selected/);
  if(axis==='row')await expectSecondRow(page,2,1);else await expect(page.locator('#grid-scroll')).toHaveJSProperty('scrollTop',0);
  await page.keyboard.press('Control+f');await page.getByRole('tab',{name:'Rows/Columns',exact:true}).click();
  await expect(page.locator('#membership-count')).toHaveText('2 sheet-only rows/columns');
});
test('Text result navigation places the match second after the preceding visible variable-height row',async({page})=>{
  await fixture(page);await page.getByRole('button',{name:'Close dialog'}).click();
  await page.evaluate(async()=>{
    const model='/src/model.ts',storage='/src/storage.ts',{setInput}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=book.sheets.find(s=>s.name==='Notebook')!;
      s.rows[43].height=54;s.rows[44].hidden=true;
      setInput(book,s,s.rows[45].id,s.columns[1].id,'Navigation needle');
      setInput(book,s,s.rows[0].id,s.columns[1].id,'First row needle');
      await store.save(book,state.version,'Synthetic Find scroll context');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.keyboard.press('Control+f');await page.locator('#find-text').fill('Navigation needle');
  await page.locator('[data-find-match]').click();await expect(page.locator('.address')).toHaveText('B46');
  await page.getByRole('button',{name:'Close dialog'}).click();await expectSecondRow(page,45,43);
  await expect(page.locator('tr[data-row="44"]')).toHaveCount(0);
  await page.keyboard.press('Control+f');await page.locator('#find-text').fill('First row needle');await page.locator('[data-find-match]').click();await page.getByRole('button',{name:'Close dialog'}).click();
  await expect(page.locator('.address')).toHaveText('B1');await expect(page.locator('#grid-scroll')).toHaveJSProperty('scrollTop',0);
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
  expect(height).toBeLessThanOrEqual(page.viewportSize()!.height-24);await expect(page.locator('#replace-label')).toBeVisible();
  await expect(page.locator('#find-results th')).toHaveCount(0);
  await expect(page.locator('#find-help')).toHaveCount(0);
  await page.locator('#find-text').fill('Cottage');await expect(page.locator('#find-count')).toHaveText('Results found (5)');
  const matchedHeight=(await dialog.boundingBox())!.height;expect(matchedHeight).toBeGreaterThanOrEqual(height);
  await page.locator('#replace-text').fill('Fresh');
  expect((await dialog.boundingBox())!.height).toBe(matchedHeight);
  await page.getByRole('tab',{name:'Rows/Columns',exact:true}).click();await expect(page.locator('#replace-label')).toBeHidden();
  await page.getByRole('tab',{name:'Text',exact:true}).click();await expect(page.locator('#replace-text')).toHaveValue('Fresh');
  await page.keyboard.press('Control+f');await expect(page.locator('#find-text')).toBeFocused();
  await page.locator('#find-text').fill('no matches');await expect(page.locator('#find-count')).toHaveText('Results found (0)');
  await expect(page.locator('#find-results th')).toHaveCount(0);
  expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(matchedHeight);
});
test('Find stays 800px tall regardless of result count and shrinks inside shorter viewports',async({page})=>{
  const width=page.viewportSize()!.width;await page.setViewportSize({width,height:1200});await fixture(page);
  await page.evaluate(async()=>{
    const model='/src/model.ts',storage='/src/storage.ts',{setInput}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,book=state.book,s=book.sheets.find(s=>s.name==='Notebook')!;for(let r=6;r<30;r++)setInput(book,s,s.rows[r].id,s.columns[1].id,`Sizing match ${String(r).padStart(2,'0')}`);await store.save(book,state.version,'Synthetic dialog results');}finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.keyboard.press('Control+f');
  const dialog=page.getByRole('dialog'),input=page.locator('#find-text'),results=page.locator('#find-results'),scrolls=()=>results.evaluate(el=>el.scrollHeight>el.clientHeight+1);
  expect((await dialog.boundingBox())!.height).toBe(800);
  const controls=page.locator('#find-controls');
  await expect(controls).toHaveCSS('overflow-y','visible');
  expect(await controls.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  const expandedControls=(await controls.boundingBox())!.height,expandedResults=(await results.boundingBox())!.height;
  await page.locator('.find-options summary').click();
  expect((await controls.boundingBox())!.height).toBeLessThan(expandedControls);
  expect((await results.boundingBox())!.height).toBeGreaterThan(expandedResults);
  await page.locator('.find-options summary').click();
  await input.fill('Sizing match');await expect(page.locator('#find-count')).toHaveText('Results found (24)');
  expect((await dialog.boundingBox())!.height).toBe(800);expect(await scrolls()).toBe(true);
  await input.fill('Sizing match 06');await expect(page.locator('#find-count')).toHaveText('Results found (1)');
  expect((await dialog.boundingBox())!.height).toBe(800);expect(await scrolls()).toBe(false);
  await input.fill('no matches');await expect(page.locator('#find-count')).toHaveText('Results found (0)');
  expect((await dialog.boundingBox())!.height).toBe(800);
  await input.fill('Sizing match');await page.setViewportSize({width,height:600});
  const bounds=(await dialog.boundingBox())!,button=(await page.locator('#replace-all').boundingBox())!;
  expect(bounds.height).toBeLessThanOrEqual(580);expect(bounds.y).toBeGreaterThanOrEqual(10);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(590);expect(button.y+button.height).toBeLessThanOrEqual(bounds.y+bounds.height);
  expect(await scrolls()).toBe(true);
  expect(await controls.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  await page.setViewportSize({width,height:400});
  await page.locator('#replace-all').scrollIntoViewIfNeeded();await expect(page.locator('#replace-all')).toBeInViewport();
  await input.scrollIntoViewIfNeeded();await expect(input).toBeInViewport();
});
test('All scope stays synchronized, and results have sheet subheaders rather than a Sheet column',async({page})=>{
  await fixture(page);await page.locator('#find-text').fill('Cottage');
  await expect(page.locator('.find-scope label').first()).toHaveText('All');
  const all=page.getByRole('checkbox',{name:'All',exact:true});expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBe(true);
  await all.check();await expect(all).toBeChecked();await expect(page.locator('#find-count')).not.toHaveText('Results found (5)');
  const selected=await page.locator('input[name=scope]').evaluateAll(inputs=>inputs.every(input=>(input as HTMLInputElement).checked));expect(selected).toBe(true);
  await expect(page.locator('.find-results-panel .find-results-table thead th').first()).toHaveText('Cell');
  await expect(page.locator('.find-results-panel .find-table-header')).toHaveText('Table: Ingredients');
  await expect(page.locator('.find-context-address')).toHaveCount(0);
  const names=await page.locator('.find-sheet-header').allTextContents();expect(new Set(names).size).toBe(names.length);expect(names).toContain('Notebook');
  await page.getByRole('checkbox',{name:'Notebook',exact:true}).uncheck();expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBe(true);
  await all.check();await all.uncheck();await expect(page.locator('#find-count')).toHaveText('Results found (0)');await expect(page.locator('#find-feedback')).toContainText('Select at least one sheet');
});
test('result previews include the match and up to eight evaluated cells in the same row at both sheet edges',async({page})=>{
  await fixture(page);await page.getByRole('button',{name:'Close dialog'}).click();
  await page.evaluate(async()=>{
    const model='/src/model.ts',storage='/src/storage.ts',{setInput}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=book.sheets.find(s=>s.name==='Notebook')!;
      for(const r of [6,7,8])for(let c=0;c<s.columns.length;c++)setInput(book,s,s.rows[r].id,s.columns[c].id,`Context ${r}:${c}`);
      for(const [r,c] of [[6,0],[7,10],[8,s.columns.length-1]])setInput(book,s,s.rows[r].id,s.columns[c].id,'Preview needle');
      setInput(book,s,s.rows[6].id,s.columns[1].id,'=1+2');
      setInput(book,s,s.rows[6].id,s.columns[2].id,'<b>literal markup</b>');
      await store.save(book,state.version,'Synthetic row previews');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.keyboard.press('Control+f');await page.locator('#find-text').fill('Preview needle');
  await expect(page.locator('#find-count')).toHaveText('Results found (3)');
  const rows=page.locator('[data-find-match]');
  for(let i=0;i<3;i++){
    await expect(rows.nth(i).locator('[data-find-context]')).toHaveCount(8);await expect(rows.nth(i).locator('.find-context-match')).toContainText('Preview needle');
    expect((await rows.nth(i).locator('.find-context-match').boundingBox())!.width).toBe(160);
    expect((await rows.nth(i).locator('th').boundingBox())!.width).toBe(50);
    expect((await rows.nth(i).locator('td:not(.find-context-match)').first().boundingBox())!.width).toBe(110);
    await expect(rows.nth(i).locator('th')).toHaveCSS('text-align','left');
  }
  await expect(rows.nth(0).locator('[data-find-context]').first()).toHaveAttribute('data-find-context','A7');
  await expect(rows.nth(0).locator('[data-find-context]').last()).toHaveAttribute('data-find-context','H7');
  await expect(rows.nth(1).locator('[data-find-context]').first()).toHaveAttribute('data-find-context','H8');
  await expect(rows.nth(1).locator('[data-find-context]').last()).toHaveAttribute('data-find-context','O8');
  await expect(rows.nth(0).locator('[data-find-context="B7"]')).toHaveAttribute('title','3');
  await expect(rows.nth(0).locator('[data-find-context="C7"]')).toHaveAttribute('title','<b>literal markup</b>');
  await expect(rows.nth(0).locator('b')).toHaveCount(0);
  const appearance=(el:Element)=>{
    const style=getComputedStyle(el);
    return{right:style.borderRight,bottom:style.borderBottom,padding:style.padding,font:style.fontFamily,size:style.fontSize,lineHeight:style.lineHeight,height:style.height,background:style.backgroundColor};
  };
  expect(await rows.nth(0).locator('[data-find-context="B7"]').evaluate(appearance)).toEqual(await page.locator('.grid td[data-r="6"][data-c="1"]').evaluate(appearance));
  await expect(rows.nth(0).locator('.find-context-match')).toHaveCSS('background-color','rgb(209, 226, 215)');
  await expect(rows.nth(0).locator('.find-context-match')).toHaveCSS('box-shadow','none');
  const last=rows.nth(2).locator('[data-find-context]').last();
  await expect(last).toHaveClass('find-context-match');await last.scrollIntoViewIfNeeded();await last.click();
  await expect(page.locator('.address')).toHaveText(await last.getAttribute('data-find-context') as string);
  await page.locator('#find-text').fill('<b>');
  await expect(page.locator('.find-match-text')).toHaveText('<b>');await expect(page.locator('#find-results b')).toHaveCount(0);
});
test('table result headers appear once per preview and stick only until their own table ends',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const model='/src/model.ts',storage='/src/storage.ts',{blankSheet,key}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=blankSheet('Sticky preview fixture',70,10);book.sheets.unshift(s);
      for(const [name,header] of [['First',0],['Second',35]] as const){
        const table={id:`preview-${name}`,name:`Preview ${name}`,sheet:s.id,header:s.rows[header].id,rows:s.rows.slice(header+1,header+26).map(row=>row.id),columns:s.columns.slice(0,8).map((column,i)=>({id:`preview-${name}-${i}`,name:`${name} field ${i}`,column:column.id}))};
        book.tables.push(table);
        for(const field of table.columns)s.cells[key(table.header,field.column)]={value:field.name};
        for(const row of table.rows)for(const [i,field] of table.columns.entries())s.cells[key(row,field.column)]={value:i?`${name} value ${i}`:'Sticky preview needle'};
      }
      await store.save(book,state.version,'Synthetic sticky result tables');sessionStorage.setItem('fnt-current-sheet',s.id);
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Sticky preview fixture',exact:true}).click();await page.keyboard.press('Control+f');await page.locator('#find-text').fill('Sticky preview needle');
  await expect(page.locator('#find-count')).toHaveText('Results found (50)');
  const first=page.locator('[data-find-table="preview-First"]'),second=page.locator('[data-find-table="preview-Second"]'),scroller=page.locator('#find-results');
  await expect(first).toHaveCount(1);await expect(second).toHaveCount(1);
  await expect(first.locator('thead th')).toHaveText(['Cell',...Array.from({length:8},(_,i)=>`First field ${i}`)]);
  await expect(first.locator('tbody th').first()).toHaveText('A2');
  expect((await first.boundingBox())!.width).toBe(980);
  await expect(page.locator('#find-results .find-table-header')).toHaveText(['Table: Preview First','Table: Preview Second']);
  expect(await first.locator('thead th').first().evaluate(headerStyle)).toEqual(await page.locator('.grid thead th[data-col]:not(.column-selected)').first().evaluate(headerStyle));
  expect(await first.locator('tbody th').first().evaluate(headerStyle)).toEqual(await page.locator('.grid tbody th').last().evaluate(headerStyle));
  await expect(first.locator('tbody th').first()).toHaveCSS('text-align','left');
  expect(await first.evaluate(el=>[el.previousElementSibling?.previousElementSibling?.textContent,el.previousElementSibling?.textContent])).toEqual(['Sticky preview fixture','Table: Preview First']);
  await expect(page.locator('.find-context-address')).toHaveCount(0);
  await scroller.evaluate(el=>{el.scrollTop=150;});
  const top=(await scroller.boundingBox())!.y+1;
  expect((await first.locator('thead th').first().boundingBox())!.y).toBeCloseTo(top,0);
  await second.evaluate(el=>{const scroller=el.parentElement!;scroller.scrollTop+=el.getBoundingClientRect().top-scroller.getBoundingClientRect().top+50;});
  expect((await second.locator('thead th').first().boundingBox())!.y).toBeCloseTo(top,0);
  expect((await first.locator('thead th').first().boundingBox())!.y+33).toBeLessThanOrEqual(top);
});
test('case, whole-cell and wildcard searches work, and Find next honors direction',async({page})=>{
  await fixture(page);await page.locator('#find-text').fill('Cottage');
  const cell=page.locator('.find-context-match').first();
  await expect(cell).toHaveText('Cottage cheese');await expect(cell).toHaveCSS('font-weight','400');
  await expect(cell.locator('.find-match-text')).toHaveText('Cottage');await expect(cell.locator('.find-match-text')).toHaveCSS('font-weight','600');
  await page.getByRole('checkbox',{name:'Match case',exact:true}).check();await expect(page.locator('#find-count')).toHaveText('Results found (4)');
  await page.getByRole('checkbox',{name:'Match entire cell contents',exact:true}).check();await expect(page.locator('#find-count')).toHaveText('Results found (1)');
  await page.locator('#find-text').fill('Cott?ge*');await expect(page.locator('#find-count')).toHaveText('Results found (4)');
  await expect(cell.locator('.find-match-text')).toHaveText('Cottage cheese');
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
  const frame=await style('.find-scope'),results=await style('#find-results');
  expect(results.radius).toBe(frame.radius);expect(results.border).toBe(frame.border);
  await page.getByRole('button',{name:'Close dialog'}).click();await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.getByRole('button',{name:'Rename workbook',exact:true}).click();
  await page.locator('#answer').evaluate(el=>(el as HTMLInputElement).blur());
  expect(await style('#answer')).toEqual(find.input);
  expect(await style('#ask-form button.primary')).toEqual(find.button);expect(await style('dialog .close')).toEqual(find.close);
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
