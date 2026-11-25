import {expect,test,type Page} from '@playwright/test';

const cell=(page:Page,row:number,column:number)=>page.locator(`td[data-r="${row}"][data-c="${column}"]`);
async function fixture(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),
      {blankSheet,key,uid}=await import(p+'model.ts') as typeof import('../../src/model'),
      {createReference,addReferenceValue,referenceFormula}=await import(p+'references.ts') as typeof import('../../src/references'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=blankSheet('Touch input',180,6);
      s.columns.forEach(column=>column.width=100);
      s.cells[key(s.rows[1].id,s.columns[0].id)]={value:'Original note',format:{wrap:false},note:'Keep note'};
      s.cells[key(s.rows[2].id,s.columns[0].id)]={value:'Second note'};
      const first=createReference(book,'Touch source'),other=createReference(book,'Touch other');
      for(let i=0;i<120;i++)addReferenceValue(book,first,`Choice ${String(i).padStart(3,'0')}`);
      addReferenceValue(book,other,'Other choice');addReferenceValue(book,other,'Another choice');
      s.validations.push({id:uid(),sheet:s.id,rows:s.rows.slice(1).map(row=>row.id),columns:[s.columns[1].id],source:JSON.stringify({kind:'call',name:'VSTACK',args:[referenceFormula(first),referenceFormula(other)]})});
      book.sheets.unshift(s);await store.save(book,state.version,'Synthetic touch editing fixture');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Touch input',exact:true}).click();
}
async function savedCell(page:Page,row:number,column:number){
  await expect(page.locator('#save-state')).toContainText('Saved');
  return page.evaluate(async({row,column})=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets.find(s=>s.name==='Touch input')!;return s.cells[`${s.rows[row].id}:${s.columns[column].id}`];}finally{store.close();}
  },{row,column});
}

test('touch taps focus one bottom editor in the gesture, commit across cells and cancel safely; desktop keeps its top bar',async({page,isMobile})=>{
  await fixture(page);
  const bar=page.locator('#formula-form'),input=page.locator('#formula');
  if(!isMobile){await expect(bar).toBeVisible();await expect(bar).toHaveCSS('position','static');await expect(bar.locator('.address')).toBeVisible();await expect(bar.locator('.fx')).toBeVisible();return;}
  await expect(bar).toBeHidden();
  await page.evaluate(()=>document.addEventListener('pointerup',e=>{
    if((e.target as HTMLElement).closest('td[data-r]'))document.body.dataset.focusedInGesture=String(document.activeElement?.id==='formula');
  }));
  await cell(page,1,0).tap();await expect(input).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-focused-in-gesture','true');
  await expect(bar).toHaveCSS('position','fixed');await expect(bar.locator('.address')).toBeHidden();await expect(bar.locator('.fx')).toBeHidden();await expect(bar.locator('#calculation-state')).toBeHidden();
  await expect(bar.locator('input:visible')).toHaveCount(1);await expect(page.locator('.cell-inline-editor')).toHaveCount(0);
  const viewport=await page.evaluate(()=>({bottom:visualViewport!.offsetTop+visualViewport!.height}));
  const bounds=(await bar.boundingBox())!;expect(bounds.y+bounds.height).toBeCloseTo(viewport.bottom,0);
  await input.fill('First changed');await cell(page,2,0).tap();
  await expect(cell(page,1,0)).toHaveText('First changed');await expect(input).toBeFocused();await expect(input).toHaveValue('Second note');
  await input.fill('Do not keep');await input.press('Escape');await expect(bar).toBeHidden();await expect(cell(page,2,0)).toHaveText('Second note');
  await cell(page,1,0).tap();await input.fill('Committed once');await input.press('Enter');await expect(bar).toBeHidden();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,0)).toHaveText('First changed');
  expect(await savedCell(page,1,0)).toMatchObject({value:'First changed',format:{wrap:false},note:'Keep note'});
  await page.reload();await expect(cell(page,1,0)).toHaveText('First changed');await expect(bar).toBeHidden();
});

test('touch dropdown shares editing and filtering, retains sources and pagination, and commits the exact choice binding',async({page,isMobile})=>{
  test.skip(!isMobile,'Touch-specific shared input; desktop dropdown coverage remains in controls.');
  await fixture(page);const input=page.locator('#formula'),popup=page.locator('.cell-dropdown');
  await cell(page,1,1).tap();await expect(input).toBeFocused();await expect(popup).toBeVisible();
  await expect(popup.locator('input')).toHaveCount(0);await expect(popup.getByRole('option')).toHaveCount(80);
  await page.getByRole('button',{name:'Next dropdown options',exact:true}).tap();await expect(input).toBeFocused();await expect(popup.getByRole('option').first()).toHaveText('Choice 080');
  await input.fill('Choice 119');await expect(popup.getByRole('option')).toHaveText(['Choice 119']);
  await page.getByRole('tab',{name:'Touch other',exact:true}).tap();await expect(input).toBeFocused();await expect(popup).toContainText('No matching options.');
  await input.fill('choice');await expect(popup.getByRole('option')).toHaveText(['Other choice','Another choice']);
  await page.getByRole('tab',{name:'Touch source',exact:true}).tap();await input.fill('Choice 119');
  await expect(popup.getByRole('option')).toHaveText(['Choice 119']);
  await expect(page.locator('#save-state')).toContainText('Editing cell');
  await page.getByRole('option',{name:'Choice 119',exact:true}).tap();
  await expect(cell(page,1,1)).toHaveText('Choice 119');await expect(cell(page,1,1)).toHaveClass(/linked/);await expect(input).toBeHidden();
  const stored=await savedCell(page,1,1);expect(stored?.binding).toBeDefined();expect(stored?.value).toBeUndefined();
  const bound=await page.evaluate(async binding=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{allSheets,allTables}=await import(p+'model.ts') as typeof import('../../src/model'),store=await Store.open();
    try{const book=(await store.load())!.book,t=allTables(book).find(t=>t.id===binding!.table)!,field=t.columns.find(c=>c.id===binding!.column)!,s=allSheets(book).find(s=>s.id===t.sheet)!;return s.cells[`${binding!.row}:${field.column}`].value;}finally{store.close();}
  },stored?.binding);
  expect(bound).toBe('Choice 119');
  await cell(page,1,1).tap();await page.getByRole('button',{name:'Hide cell choices',exact:true}).tap();
  await page.getByRole('button',{name:'Show cell choices',exact:true}).tap();await expect(input).toHaveValue('Choice 119');
  await expect(page.locator('#save-state')).toContainText('Saved');await input.press('Enter');
  expect(await savedCell(page,1,1)).toEqual(stored);
  await cell(page,1,1).tap();await page.getByRole('button',{name:'Hide cell choices',exact:true}).tap();await expect(popup).toHaveCount(0);await expect(input).toBeFocused();
  await input.fill('Own direct entry');await page.getByRole('button',{name:'Show cell choices',exact:true}).tap();await expect(popup).toContainText('No matching options.');await expect(input).toHaveValue('Own direct entry');
  await page.getByRole('button',{name:'Hide cell choices',exact:true}).tap();await input.press('Enter');await expect(cell(page,1,1)).toHaveText('Own direct entry');await expect(cell(page,1,1)).not.toHaveClass(/linked/);
  await cell(page,1,1).tap();await input.fill('=not a formula');await page.getByRole('button',{name:'Custom',exact:true}).tap();await expect(input).toBeFocused();await input.fill('=still literal');await input.press('Enter');
  expect(await savedCell(page,1,1)).toMatchObject({value:'=still literal'});await expect(cell(page,1,1)).not.toHaveClass(/calculated/);
});

test('touch editor and dropdown follow visual viewport keyboard geometry and commit on keyboard dismissal',async({page,isMobile})=>{
  test.skip(!isMobile,'Synthetic visual viewport verifies layout, not a physical phone keyboard.');
  await fixture(page);const input=page.locator('#formula'),bar=page.locator('#formula-form');
  await cell(page,1,1).tap();
  await page.evaluate(()=>{
    const viewport=window.visualViewport!;
    Object.defineProperty(viewport,'height',{configurable:true,value:360});Object.defineProperty(viewport,'offsetTop',{configurable:true,value:20});viewport.dispatchEvent(new Event('resize'));
  });
  await expect(input).toBeFocused();
  const bounds=(await bar.boundingBox())!,popup=(await page.locator('.cell-dropdown').boundingBox())!;
  expect(bounds.y+bounds.height).toBeCloseTo(380,0);expect(popup.y).toBeGreaterThanOrEqual(20);expect(popup.y+popup.height).toBeLessThanOrEqual(bounds.y);
  await input.fill('Keyboard-dismissed entry');
  await page.evaluate(()=>{
    const viewport=window.visualViewport!;
    Object.defineProperty(viewport,'height',{configurable:true,value:innerHeight});Object.defineProperty(viewport,'offsetTop',{configurable:true,value:0});viewport.dispatchEvent(new Event('resize'));
  });
  await expect(bar).toBeHidden();await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  expect(await savedCell(page,1,1)).toMatchObject({value:'Keyboard-dismissed entry'});
});

test('touch editor stays above a resized Chrome content viewport without mocking visualViewport',async({page,isMobile})=>{
  test.skip(!isMobile,'Android Chrome resizes both viewports for interactive-widget=resizes-content.');
  await fixture(page);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content',/interactive-widget=resizes-content/);
  const input=page.locator('#formula'),bar=page.locator('#formula-form'),original=page.viewportSize()!;
  await cell(page,1,1).tap();await input.fill('Content-resize entry');
  await page.setViewportSize({width:original.width,height:360});
  await expect(input).toBeFocused();await expect(input).toHaveValue('Content-resize entry');
  await expect.poll(async()=>{const rect=(await bar.boundingBox())!;return Math.round(rect.y+rect.height);}).toBe(360);
  const popup=(await page.locator('.cell-dropdown').boundingBox())!,bounds=(await bar.boundingBox())!;
  expect(popup.y+popup.height).toBeLessThanOrEqual(bounds.y);
  expect((await input.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.setViewportSize(original);
  await expect(bar).toBeHidden();
  expect(await savedCell(page,1,1)).toMatchObject({value:'Content-resize entry'});
});

test('touch editor also avoids an overlay keyboard when viewport dimensions do not shrink',async({page,isMobile})=>{
  test.skip(!isMobile,'Keyboard geometry fallback for an overlay keyboard.');
  await page.addInitScript(()=>{
    const keyboard=Object.assign(new EventTarget(),{boundingRect:new DOMRect(0,0,0,0)});
    Object.defineProperty(navigator,'virtualKeyboard',{configurable:true,value:keyboard});
  });
  await fixture(page);const input=page.locator('#formula'),bar=page.locator('#formula-form');
  await cell(page,1,1).tap();await input.fill('Overlay entry');
  const original=await page.evaluate(()=>visualViewport!.height);
  await page.evaluate(()=>{
    const keyboard=(navigator as Navigator&{virtualKeyboard:EventTarget&{boundingRect:DOMRect}}).virtualKeyboard;
    keyboard.boundingRect=new DOMRect(0,380,innerWidth,innerHeight-380);keyboard.dispatchEvent(new Event('geometrychange'));
  });
  expect(await page.evaluate(()=>visualViewport!.height)).toBe(original);
  await expect.poll(async()=>{const rect=(await bar.boundingBox())!;return Math.round(rect.y+rect.height);}).toBe(380);
  await expect(input).toBeFocused();await expect(input).toHaveValue('Overlay entry');
  const popup=(await page.locator('.cell-dropdown').boundingBox())!,bounds=(await bar.boundingBox())!;
  expect(popup.y+popup.height).toBeLessThanOrEqual(bounds.y);
  await page.evaluate(()=>{
    const keyboard=(navigator as Navigator&{virtualKeyboard:EventTarget&{boundingRect:DOMRect}}).virtualKeyboard;
    keyboard.boundingRect=new DOMRect(0,0,0,0);keyboard.dispatchEvent(new Event('geometrychange'));
  });
  await expect(bar).toBeHidden();
  expect(await savedCell(page,1,1)).toMatchObject({value:'Overlay entry'});
});

test('touch nutrition quantities default to decimals but retain full-keyboard drafts and field identity',async({page,isMobile})=>{
  test.skip(!isMobile,'Native keyboard hints apply to compact touch editing.');
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{blankSheet,key,uid}=await import(p+'model.ts') as typeof import('../../src/model'),store=await Store.open();
    try{
      const state=(await store.load())!,s=blankSheet('Numeric Master',30,8),headers=['Date','Weight','Food','Amount (g)','Amount','Unit','isDay'];
      const table={id:uid(),name:'Master',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,3).map(r=>r.id),columns:headers.map((name,i)=>({id:uid(),column:s.columns[i].id,name}))};
      headers.forEach((value,i)=>s.cells[key(s.rows[0].id,s.columns[i].id)]={value});
      s.cells[key(s.rows[1].id,s.columns[0].id)]={value:46000,format:{number:'date'}};
      s.cells[key(s.rows[1].id,s.columns[1].id)]={value:79};
      s.cells[key(s.rows[1].id,s.columns[6].id)]={value:true};
      state.book.sheets.unshift(s);state.book.tables.push(table);await store.save(state.book,state.version,'Synthetic keyboard field fixture');
    }finally{store.close();}
  });
  await page.reload();const input=page.locator('#formula');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await cell(page,1,1).tap();await cell(page,2,1).tap();await cell(page,2,1).dispatchEvent('dblclick');
  await expect(page.locator('#cell-editor')).toHaveCount(0);await expect(input).toBeFocused();await input.press('Escape');
  for(const [name,columns]of [['Numeric Master',[1,3,4]],['Meals',[2]],['Ingredients',[1,2,3]]] as const){
    await page.getByRole('button',{name,exact:true}).click();
    for(const column of columns){await cell(page,1,column).tap();await expect(input).toHaveAttribute('inputmode','decimal');await input.press('Escape');}
  }
  await cell(page,1,1).tap();await input.fill('1/2');
  await input.evaluate(input=>(input as HTMLInputElement).setSelectionRange(1,2));
  await page.getByRole('button',{name:'Use full keyboard',exact:true}).tap();
  await expect(input).toHaveAttribute('inputmode','text');await expect(input).toHaveValue('1/2');await expect(input).toBeFocused();
  expect(await input.evaluate(input=>[(input as HTMLInputElement).selectionStart,(input as HTMLInputElement).selectionEnd])).toEqual([1,2]);
  await page.getByRole('button',{name:'Use number keyboard',exact:true}).tap();
  await expect(input).toHaveAttribute('inputmode','decimal');await expect(input).toHaveValue('1/2');
  await input.press('Escape');await cell(page,1,0).tap();await expect(input).toHaveAttribute('inputmode','text');
  await expect(page.locator('.touch-keyboard-toggle')).toBeHidden();await input.press('Escape');
  await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{renameColumn}=await import(p+'model.ts') as typeof import('../../src/model'),store=await Store.open();
    try{const state=(await store.load())!,table=state.book.tables.find(t=>t.name==='Ingredients')!;renameColumn(state.book,table,table.columns[1].id,'Portion mass');await store.save(state.book,state.version,'Rename keyboard field');}finally{store.close();}
  });
  await page.reload();await cell(page,1,1).tap();await expect(input).toHaveAttribute('inputmode','decimal');
});

test('touch scrolling retains the original draft and explicit range selection does not open the editor',async({page,isMobile})=>{
  test.skip(!isMobile,'Touch-only selection and virtualized editing.');
  await fixture(page);const input=page.locator('#formula'),grid=page.locator('#grid-scroll');
  await cell(page,1,0).tap();await input.fill('Draft kept while scrolling');
  await grid.evaluate(el=>{el.scrollTop=2200;});await expect(grid).toHaveJSProperty('scrollTop',2200);
  await expect(input).toBeFocused();await expect(input).toHaveValue('Draft kept while scrolling');await expect(cell(page,1,0)).toHaveCount(0);
  await input.press('Enter');expect(await savedCell(page,1,0)).toMatchObject({value:'Draft kept while scrolling'});
  await page.locator('[data-action="top"]').click();await page.locator('.selection-count').click();await page.getByRole('button',{name:'Drag to select cells',exact:true}).click();
  const start=(await cell(page,1,0).boundingBox())!,end=(await cell(page,3,1).boundingBox())!;
  await page.mouse.move(start.x+20,start.y+15);await page.mouse.down();await page.mouse.move(end.x+20,end.y+15,{steps:5});await page.mouse.up();
  await expect(page.locator('.selection-count')).toHaveText('6 cells');await expect(input).toBeHidden();
});

test('expanded touch editing retains multiline text and wrapping without a competing bottom editor',async({page,isMobile})=>{
  test.skip(!isMobile,'Touch-specific transition out of the compact editor.');
  await fixture(page);const target=cell(page,1,0),text='A long first line\nSecond line stays intact';
  await target.dblclick();const expanded=page.locator('#cell-editor');
  await expect(expanded).toBeFocused();await expect(page.locator('#formula-form')).toBeHidden();
  await expanded.fill(text);await expanded.press('Control+Enter');
  expect(await savedCell(page,1,0)).toMatchObject({value:text,format:{wrap:false},note:'Keep note'});
  await target.dblclick();await expect(expanded).toHaveValue(text);await expanded.fill('Discard');await expanded.press('Escape');
  await expect(target).toHaveText(text);await expect(target).toHaveCSS('white-space','nowrap');
});

test('touch navigation remains tappable and commits drafts before changing DD or jumping rows',async({page,isMobile})=>{
  test.skip(!isMobile,'Touch editor must not cover or move navigation during a tap.');
  await fixture(page);const input=page.locator('#formula');
  await cell(page,1,0).tap();await input.fill('Saved before DD');
  await page.getByRole('button',{name:'Open DD',exact:true}).tap();await expect(page.getByRole('button',{name:'Close DD',exact:true})).toBeVisible();
  expect(await savedCell(page,1,0)).toMatchObject({value:'Saved before DD'});
  await page.getByRole('button',{name:'Close DD',exact:true}).tap();
  await cell(page,2,0).tap();await input.fill('Saved before jump');const jump=page.locator('#row-jump');
  await jump.tap();await expect(jump).toBeFocused();await jump.fill('121');await jump.press('Enter');
  await expect(cell(page,120,0)).toHaveClass(/active/);
  expect(await savedCell(page,2,0)).toMatchObject({value:'Saved before jump'});
});

test('native touch panning scrolls the grid without mistaking a swipe for an edit tap',async({page,isMobile})=>{
  test.skip(!isMobile,'Uses Chromium touch input, not a programmatic scroll.');
  await fixture(page);const grid=page.locator('#grid-scroll'),bounds=(await grid.boundingBox())!,session=await page.context().newCDPSession(page);
  const x=bounds.x+100,y=bounds.y+Math.min(300,bounds.height-30);
  try{
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=5;i++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*35}]});await page.waitForTimeout(20);}
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
    await expect(page.locator('#formula-form')).toBeHidden();
  }finally{await session.detach();}
});
