import {expect,test} from '@playwright/test';

test('dialog close controls share a real 18px icon and are actions, not toggles',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const check=async()=>{
    const close=page.locator('.dialog-heading > .close').last(),icon=close.locator('svg.toolbar-icon');
    await expect(close).toHaveAttribute('type','button');await expect(close).not.toHaveAttribute('aria-pressed');await expect(close).not.toHaveAttribute('aria-expanded');
    await expect(close).toHaveText('');await expect(icon).toHaveAttribute('width','18');await expect(icon).toHaveAttribute('height','18');await expect(icon).toHaveAttribute('stroke-width','1');
    expect(await close.boundingBox()).toMatchObject({width:24,height:24});await close.click();await expect(close).toHaveCount(0);
  };
  await page.getByRole('button',{name:'Rows & columns',exact:true}).click();await check();
  await page.getByRole('button',{name:'Text color',exact:true}).click();await check();
  await page.getByRole('button',{name:'Group controls',exact:true}).click();await page.getByRole('button',{name:'Manage groups',exact:true}).click();await check();
});

test('all dialog families inherit one responsive surface and heading stylesheet',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const width=page.viewportSize()!.width;
  await page.addStyleTag({content:':root{--dialog-radius:17px;--dialog-padding:13px;--dialog-h1-size:23px;--dialog-h2-size:19px}'});
  const check=async(popover=false)=>{
    const surface=page.getByRole('dialog'),title=surface.locator('.dialog-heading').locator('h1,h2');
    await expect(surface).toHaveClass(/dialog-surface/);
    await expect(surface).toHaveCSS('border-radius','17px');await expect(surface).toHaveCSS('padding','13px');
    expect((await surface.boundingBox())!.width).toBe(Math.min(popover?336:600,width-20));
    await expect(title).toHaveCSS('font-size',popover?'19px':'23px');
    expect(await title.evaluate(el=>el.tagName)).toBe(popover?'H2':'H1');
    await surface.locator('.close').click();
  };
  await page.keyboard.press('Control+f');await check();
  await page.getByRole('button',{name:'Rows & columns',exact:true}).click();await check();
  await page.locator('.tab-actions').getByRole('button',{name:'Sheet settings',exact:true}).click();await check();
  await page.getByRole('button',{name:'Group controls',exact:true}).click();await page.getByRole('button',{name:'Manage groups',exact:true}).click();await check();
  await page.getByRole('button',{name:'Text color',exact:true}).click();await check(true);
  await page.locator('.reference-manager').click();
  await page.locator('.tab-actions').getByRole('button',{name:'Dropdown settings',exact:true}).click();await check();
  await page.locator('.sheet-tab.current[data-reference]').click({button:'right'});
  await page.getByRole('menuitem',{name:'Group',exact:true}).click();await check();
  await page.setViewportSize({width:320,height:600});
  await page.getByRole('button',{name:'Text color',exact:true}).click();
  const popover=page.getByRole('dialog'),bounds=(await popover.boundingBox())!;
  expect(bounds.width).toBe(300);expect(bounds.x).toBeGreaterThanOrEqual(10);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(310);expect(bounds.y).toBeGreaterThanOrEqual(10);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(590);
});

test('row and column insertion buttons share 16px sizing and centered 6px plus icons',async({page})=>{
  await page.goto('/');await expect(page.locator('.row-boundary').first()).toBeAttached();
  for(const selector of ['.row-boundary','.row-start','.grid thead .boundary-control']){
    const dimensions=await page.locator(selector).first().evaluate(button=>{
      const bounds=button.getBoundingClientRect(),icon=getComputedStyle(button,'::before');
      return{width:bounds.width,height:bounds.height,iconWidth:icon.width,iconHeight:icon.height,backgroundSize:icon.backgroundSize,left:icon.left,top:icon.top};
    });
    expect(dimensions).toMatchObject({width:16,height:16,iconWidth:'6px',iconHeight:'6px',backgroundSize:'6px 1.5px, 1.5px 6px'});
    expect(dimensions.left).toBe(dimensions.top);
  }
});

test('the extra 6px before row numbers selects the row instead of invoking its move grip',async({page,isMobile})=>{
  await page.goto('/');const number=page.locator('[data-row-select="3"] .row-index');
  await number.scrollIntoViewIfNeeded();
  await expect(number).toHaveCSS('padding-left','6px');
  const bounds=(await number.boundingBox())!,position={x:bounds.x+3,y:bounds.y+bounds.height/2};
  if(isMobile)await page.touchscreen.tap(position.x,position.y);else await page.mouse.click(position.x,position.y);
  await expect(page.locator('.grid')).toHaveClass(/selection-rows/);await expect(page.locator('[data-row-select="3"]')).toHaveClass(/row-selected/);
  await expect(page.locator('.grid')).not.toHaveClass(/rearranging/);
});
test('dropdown dialogs grow only for their visible sources and keep scrolling at the height cap',async({page})=>{
  const width=page.viewportSize()!.width;await page.setViewportSize({width,height:1200});
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,t=book.tables.find(t=>t.name==='Ingredients')!;
      book.references??=[];for(let i=0;i<26;i++)book.references.push({id:`dialog-sizing-source-${i}`,name:`Sizing source ${String(i).padStart(2,'0')}`,kind:'list',table:t.id,column:t.columns[0].id,archivedRows:[]});
      await store.save(book,state.version,'Synthetic dialog sources');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.getByRole('button',{name:'Assign DD',exact:true}).click();await page.getByRole('button',{name:'List view',exact:true}).click();
  const dialog=page.getByRole('dialog'),search=page.getByRole('searchbox',{name:'Search dropdown sources'}),cards=page.locator('#dropdown-source-cards'),scrolls=()=>cards.evaluate(el=>el.scrollHeight>el.clientHeight+1);
  expect((await dialog.boundingBox())!.height).toBeCloseTo(1000,0);expect(await scrolls()).toBe(true);
  await search.fill('Sizing source 0');await expect(cards.locator('label')).toHaveCount(10);
  const medium=(await dialog.boundingBox())!.height;
  expect(medium).toBeGreaterThan(480);expect(medium).toBeLessThan(1000);expect(await scrolls()).toBe(false);
  await search.fill('Sizing source 00');await expect(cards.locator('label')).toHaveCount(1);
  expect((await dialog.boundingBox())!.height).toBeLessThan(medium);expect(await scrolls()).toBe(false);
  await search.fill('');await page.setViewportSize({width,height:600});
  const bounds=(await dialog.boundingBox())!,apply=(await page.getByRole('button',{name:'Apply dropdown',exact:true}).boundingBox())!;
  expect(bounds.height).toBeLessThanOrEqual(580);expect(bounds.y).toBeGreaterThanOrEqual(10);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(590);expect(apply.y+apply.height).toBeLessThanOrEqual(bounds.y+bounds.height);
  expect(await scrolls()).toBe(true);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.locator('#title').click();
  expect((await page.getByRole('dialog').boundingBox())!.height).toBeLessThan(400);
});

test('table selection stays centered in the corner and group controls use the toolbar icon-button styling',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.grid-footer span.desktop')).toHaveCount(0);
  await page.locator('[data-row-select="1"] .row-index').click();await page.locator('[data-row-select="3"] .row-index').click({modifiers:['Shift']});await page.keyboard.press('Control+g');
  const centered=async()=>{
    const corner=(await page.locator('.grid thead .corner').boundingBox())!,button=(await page.locator('.corner .table-selection-control').boundingBox())!;
    expect(Math.abs(button.x+button.width/2-corner.x-corner.width/2)).toBeLessThanOrEqual(1);
    expect(Math.abs(button.y+button.height/2-corner.y-corner.height/2)).toBeLessThanOrEqual(1);
  };
  await centered();await page.locator('[data-row-select="5"] .row-index').click();await page.locator('[data-row-select="6"] .row-index').click({modifiers:['Shift']});
  await page.keyboard.press('Control+Alt+g');await centered();
  await expect(page.locator('.toolbar .group-menu-button')).toHaveClass(/icon-button/);
  await expect(page.locator('.toolbar .table-selection-control,.corner .group-menu-button')).toHaveCount(0);
  const styles=await page.locator('.toolbar').evaluate(toolbar=>{
    const appearance=(button:Element)=>{const s=getComputedStyle(button);return[s.width,s.height,s.minHeight,s.padding,s.border,s.borderRadius,s.backgroundColor,s.color];};
    return{groups:appearance(toolbar.querySelector('.group-menu-button')!),bold:appearance(toolbar.querySelector('[data-action="bold"]')!)};
  });
  expect(styles.groups).toEqual(styles.bold);
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await expect(page.getByRole('group',{name:'Group controls menu',exact:true})).toBeVisible();
});
test('toolbar tools rearrange with mouse or touch, preserve actions and survive undo, reload and DD changes',async({page,isMobile})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const snapshot=()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
  const first=()=>page.locator('.toolbar [data-toolbar-tool]').first();
  const before=await snapshot();
  await page.getByRole('button',{name:'Arrange toolbar',exact:true}).click();
  const source=page.locator('.toolbar [data-action="bold"]'),target=page.locator('.toolbar [data-action="undo"]');
  await source.scrollIntoViewIfNeeded();
  if(isMobile){
    const from=(await source.boundingBox())!,to=(await target.boundingBox())!,session=await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x+from.width/2,y:from.y+from.height/2}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to.x+2,y:to.y+to.height/2}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
  }else await source.dragTo(target,{targetPosition:{x:2,y:16}});
  await expect(first()).toHaveAttribute('data-toolbar-tool','action:bold');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const reordered=await snapshot();expect(reordered.sheets).toEqual(before.sheets);expect(reordered.toolbarOrder?.[0]).toBe('action:bold');
  await page.getByRole('button',{name:'Finish arranging toolbar',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(first()).toHaveAttribute('data-toolbar-tool','action:undo');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(first()).toHaveAttribute('data-toolbar-tool','action:bold');
  await page.getByRole('button',{name:'Bold',exact:true}).click();await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();await expect(first()).toHaveAttribute('data-toolbar-tool','action:bold');
  expect((await snapshot()).sheets).toEqual(before.sheets);
  await page.locator('.reference-manager').click();await expect(page.getByRole('button',{name:'View/hide hypo rows/columns'})).toBeVisible();
  await page.getByRole('button',{name:'Arrange toolbar',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).focus();await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('.toolbar [data-toolbar-tool]').nth(1)).toHaveAttribute('data-toolbar-tool','action:redo');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const ddOrder=(await snapshot()).toolbarOrder!;
  expect(ddOrder).not.toContain('action:quick-add');expect(ddOrder).not.toContain('action:browse');
  await page.getByRole('button',{name:'Finish arranging toolbar',exact:true}).click();await page.locator('.reference-manager').click();
  await expect(page.getByRole('button',{name:'View/hide hypo rows/columns'})).toBeVisible();expect((await snapshot()).toolbarOrder).toEqual(ddOrder);
});
test('toolbar scroll stays in place after dragging, keyboard rearrangement and divider edits',async({page})=>{
  await page.setViewportSize({width:500,height:800});await page.goto('/');
  await page.getByRole('button',{name:'Arrange toolbar',exact:true}).click();
  const toolbar=page.locator('.toolbar'),scroll=()=>toolbar.evaluate(el=>el.scrollLeft);
  const order=()=>toolbar.locator('[data-toolbar-tool]').evaluateAll(elements=>elements.map(el=>el.getAttribute('data-toolbar-tool')));
  await toolbar.evaluate(el=>{el.scrollLeft=180;});expect(await scroll()).toBe(180);
  const source=toolbar.locator('[data-action="wrap"]'),target=toolbar.locator('[data-action="text-color"]');
  await source.dragTo(target,{targetPosition:{x:44,y:16}});
  await expect.poll(async()=>{const ids=await order();return ids.indexOf('action:wrap')>ids.indexOf('action:text-color');}).toBe(true);
  expect(await scroll()).toBe(180);
  await toolbar.evaluate(el=>{el.scrollLeft=210;});await source.focus();await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(async()=>{const ids=await order();return ids.indexOf('action:wrap')>ids.indexOf('action:background-color');}).toBe(true);
  expect(await scroll()).toBe(210);
  await page.getByRole('button',{name:'Add divider after Text color',exact:true}).click();expect(await scroll()).toBe(210);
  await page.getByRole('button',{name:'Remove divider after Text color',exact:true}).click();expect(await scroll()).toBe(210);
  await page.getByRole('button',{name:'Finish arranging toolbar',exact:true}).click();expect(await scroll()).toBe(210);
});
test('Shift ranges and Ctrl toggles move selected toolbar tools together without editing cells',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const cells=()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book.sheets.map(sheet=>sheet.cells);}finally{store.close();}
  });
  const before=await cells();await page.getByRole('button',{name:'Arrange toolbar',exact:true}).click();
  const bold=page.getByRole('button',{name:'Bold',exact:true}),italic=page.getByRole('button',{name:'Italic',exact:true}),underline=page.getByRole('button',{name:'Underline',exact:true});
  const selected=()=>page.locator('.toolbar-tool-selected').evaluateAll(elements=>elements.map(el=>el.getAttribute('data-toolbar-tool')));
  await bold.click();await underline.click({modifiers:['Control']});expect(await selected()).toEqual(['action:bold','action:underline']);
  await bold.click();await underline.click({modifiers:['Shift']});expect(await selected()).toEqual(['action:bold','action:italic','action:underline']);
  await italic.click({modifiers:['Control']});expect(await selected()).toEqual(['action:bold','action:underline']);
  await page.getByRole('button',{name:'Wrap text',exact:true}).click({modifiers:['Control','Shift']});
  expect(await selected()).toEqual(['action:bold','action:italic','action:underline','action:strikethrough','action:wrap']);
  for(const name of ['Italic','Strikethrough','Wrap text'])await page.getByRole('button',{name,exact:true}).click({modifiers:['Control']});
  expect(await selected()).toEqual(['action:bold','action:underline']);
  await bold.dragTo(page.getByRole('button',{name:'Undo',exact:true}),{targetPosition:{x:2,y:16}});
  const order=()=>page.locator('.toolbar [data-toolbar-tool]').evaluateAll(elements=>elements.map(el=>el.getAttribute('data-toolbar-tool')));
  expect((await order()).slice(0,3)).toEqual(['action:bold','action:underline','action:undo']);
  expect(await selected()).toEqual(['action:bold','action:underline']);
  await underline.focus();await page.keyboard.press('Alt+ArrowRight');
  expect((await order()).slice(0,3)).toEqual(['action:undo','action:bold','action:underline']);
  await expect(page.locator('#save-state')).toContainText(/^Saved/);expect(await cells()).toEqual(before);
  await page.getByRole('button',{name:'Finish arranging toolbar',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect((await order()).slice(0,3)).toEqual(['action:bold','action:underline','action:undo']);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await order()).slice(0,3)).toEqual(['action:undo','action:redo','action:bold']);
});
test('toolbar divider gaps add on hover, delete on click and share a durable uniform style',async({page})=>{
  await page.goto('/');
  const bold=page.getByRole('button',{name:'Bold',exact:true}),italic=page.getByRole('button',{name:'Italic',exact:true});
  const before=(await italic.boundingBox())!.x-((await bold.boundingBox())!.x+(await bold.boundingBox())!.width);
  await page.getByRole('button',{name:'Arrange toolbar',exact:true}).click();
  const gap=page.getByRole('button',{name:'Add divider after Bold',exact:true});
  const opacity=()=>gap.evaluate(el=>getComputedStyle(el,'::after').opacity);
  expect(await opacity()).toBe('0');await gap.hover();expect(await opacity()).toBe('0.5');
  expect((await italic.boundingBox())!.x-((await bold.boundingBox())!.x+(await bold.boundingBox())!.width)).toBeGreaterThan(before);
  await gap.click();await expect(page.getByRole('button',{name:'Remove divider after Bold',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add divider after Meal / day',exact:true}).click();
  const heights=await page.locator('.toolbar-divider').evaluateAll(elements=>elements.map(el=>getComputedStyle(el,'::after').height));
  expect(heights.length).toBeGreaterThan(1);expect(new Set(heights)).toEqual(new Set(['20px']));
  await page.getByRole('button',{name:'Remove divider after Redo',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add divider after Redo',exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Finish arranging toolbar',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-toolbar-divider="action:redo"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('[data-toolbar-divider="action:redo"]')).toHaveCount(0);
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(page.locator('[data-toolbar-divider="action:bold"]')).toHaveCount(1);await expect(page.locator('[data-toolbar-divider="action:redo"]')).toHaveCount(0);
  await expect(page.locator('[data-toolbar-divider="action:block"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Arrange toolbar',exact:true}).click();
  while(await page.locator('.toolbar-divider').count())await page.locator('.toolbar-divider').first().click();
  await page.getByRole('button',{name:'Finish arranging toolbar',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await expect(page.locator('.toolbar-divider')).toHaveCount(0);
});
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

test('repeated Ctrl+G keeps creating distinct groups without losing the shortcut',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const count=()=>page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();try{return(await store.load()).book.sheets[0].groups.length;}finally{store.close();}});
  const initial=await count();
  for(let i=0;i<6;i++){
    await page.locator(`[data-row-select="${1+i*2}"] .row-index`).click();
    await page.locator(`[data-row-select="${2+i*2}"] .row-index`).click({modifiers:['Shift']});
    await page.keyboard.press('Control+g');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#save-state')).toContainText(/^Saved/);
    expect(await count()).toBe(initial+i+1);
  }
});
test('grouping shortcuts resolve cell axes but never hijack text editing',async({page,isMobile})=>{
  await page.goto('/');await page.locator('td[data-r="1"][data-c="5"]').click();await page.locator('td[data-r="2"][data-c="5"]').click({modifiers:['Shift']});
  await page.keyboard.press('Control+g');await expect(page.getByRole('dialog')).toContainText('Group selection');
  await page.getByRole('dialog').getByRole('button',{name:'Rows',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  if(isMobile)await page.locator('td[data-r="1"][data-c="5"]').click();else await page.locator('#formula').focus();await page.keyboard.press('Control+Shift+g');
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

test('table column dialog manages dropdowns and formula patterns without replacing manual overrides',async({page,isMobile})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  const manual=page.locator('td[data-r="2"][data-c="5"]');
  await manual.click();await page.locator('#formula').fill('777');await page.locator('#formula').press('Enter');
  await page.locator('th[data-col="5"] .column-index').dblclick();await expect(page.getByRole('dialog')).toContainText('Table column');
  await page.locator('#column-dropdowns').click();
  await page.getByRole('checkbox',{name:/Country$/}).check();await page.getByRole('button',{name:'Apply dropdown',exact:true}).click();
  await expect(manual).toHaveText('777');
  await page.locator('th[data-col="5"] .column-index').dblclick();await expect(page.locator('#column-remove-dropdowns')).toBeEnabled();
  await page.locator('#column-dropdowns').click();await expect(page.getByRole('checkbox',{name:/Country$/})).toBeChecked();await page.keyboard.press('Escape');
  await page.locator('th[data-col="5"] .column-index').dblclick();await page.locator('#column-remove-dropdowns').click();
  await page.locator('th[data-col="5"] .column-index').dblclick();await expect(page.locator('#column-remove-dropdowns')).toBeDisabled();
  await page.locator('#column-formulas').click();await page.locator('#column-formula').fill('=SUM(');
  await page.getByRole('button',{name:'Apply formula',exact:true}).click();await expect(page.locator('#column-formula')).toBeVisible();
  await page.locator('#column-formula').fill('=42');await page.getByRole('button',{name:'Apply formula',exact:true}).click();
  await expect(page.locator('td[data-r="1"][data-c="5"]')).toHaveText('42');await expect(manual).toHaveText('777');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await expect(manual).toHaveText('777');
  await manual.click();if(isMobile)await page.locator('[data-action="format"]').click();await page.getByRole('button',{name:'Restore calculation',exact:true}).click();await expect(manual).toHaveText('42');
});

test('toolbar icons share size and styling while formatting and colors persist',async({page})=>{
  await page.goto('/');
  await expect(page.locator('[data-action="toolbar-layout"] .toolbar-icon')).toBeVisible();
  const icons=await page.locator('.toolbar .toolbar-icon:not(.summary-group-add .toolbar-icon)').evaluateAll(elements=>elements.map(el=>{
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

test('typing after keyboard navigation filters assigned DD without replacing data and respects saved Custom mode',async({page,isMobile})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('th[data-col="2"] .column-index').click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  const first=page.locator('td[data-r="2"][data-c="2"]'),second=page.locator('td[data-r="3"][data-c="2"]'),search=page.locator('.cell-dropdown input, .formula-bar.touch-editing #formula');
  const navigate=async(row:number)=>{await page.locator(`td[data-r="${row}"][data-c="1"]`).click();if(isMobile)await page.keyboard.press('Escape');await page.keyboard.press('ArrowRight');};
  await navigate(2);await page.keyboard.type('Jap');
  await expect(search).toHaveValue('Jap');await expect(search).toBeFocused();await expect(first).toHaveText('');
  if(isMobile)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(first).toHaveText('Japan');await expect(first).toHaveClass(/linked/);
  await navigate(2);await page.keyboard.type('Can');await expect(search).toHaveValue('Can');
  await page.keyboard.press('Escape');await expect(first).toHaveText('Japan');await expect(first).toHaveClass(/linked/);
  await navigate(3);await page.keyboard.press('Alt+ArrowDown');await page.getByRole('button',{name:'Custom',exact:true}).click();
  await (isMobile?page.locator('#formula'):page.getByRole('textbox',{name:'Edit selected cell'})).fill('Own place');await page.keyboard.press('Enter');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await navigate(4);await page.keyboard.type('=not a formula');
  await expect(page.locator('.cell-dropdown')).toHaveCount(0);await page.keyboard.press('Enter');
  await expect(page.locator('td[data-r="4"][data-c="2"]')).toHaveText('=not a formula');
  await expect(page.locator('td[data-r="4"][data-c="2"]')).not.toHaveClass(/calculated/);
  await navigate(2);await page.keyboard.type('raw');await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(first).toHaveText('Japan');await expect(first).toHaveClass(/linked/);
  await navigate(5);await page.keyboard.press('Alt+ArrowDown');await page.getByRole('tab',{name:'Snack / Country',exact:true}).click();await page.keyboard.press('Escape');
  await navigate(3);await page.keyboard.type('custom');await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(second).toHaveText('Own place');
  await navigate(5);await page.keyboard.type('Can');await expect(search).toHaveValue('Can');await page.keyboard.press('Escape');
});
test('assigned dropdown opens directly from the cell, supports keyboard, manual text, and closes DD as a toggle',async({page,isMobile})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await expect(page.locator('[data-action="picker"]')).toHaveCount(0);
  const cell=page.locator('td[data-r="1"][data-c="1"]');
  await cell.click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  await cell.click();await expect(page.locator('.cell-dropdown')).toBeVisible();
  await expect(page.locator('.cell-dropdown').getByRole('option')).toHaveText(['Taiwan','Japan','Canada','USA']);
  await page.getByRole('option',{name:'Canada',exact:true}).click();await expect(cell).toHaveText('Canada');await expect(cell).toHaveClass(/linked/);await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell).not.toHaveText('Canada');await cell.click();await page.keyboard.press('Escape');await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowDown');await page.locator('.cell-dropdown input, .formula-bar.touch-editing #formula').fill('Jap');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(cell).toHaveText('Japan');
  await page.locator('[data-action="references"]').click();await page.locator('[data-reference]').filter({hasText:/^Country$/}).click();
  await page.locator('td[data-r]').filter({hasText:/^Japan$/}).click();await page.locator('#formula').fill('Renamed Japan');await page.locator('#formula').press('Enter');
  await page.getByRole('button',{name:'Close DD',exact:true}).click();await expect(cell).toHaveText('Renamed Japan');await expect(cell).toHaveClass(/linked/);
  await cell.dblclick();await expect(page.locator('#cell-editor')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await page.keyboard.press('Escape');
  await cell.click();await page.getByRole('button',{name:'Custom',exact:true}).click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);await (isMobile?page.locator('#formula'):page.getByRole('textbox',{name:'Edit selected cell',exact:true})).fill('Manual place');await page.keyboard.press('Enter');await expect(cell).toHaveText('Manual place');await expect(cell).not.toHaveClass(/linked/);
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await cell.click();await expect(page.getByRole('button',{name:'Custom',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('tab',{name:'Snack / Country',exact:true}).click();await expect(page.locator('.cell-dropdown').getByRole('option')).toHaveCount(4);await page.keyboard.press('Escape');
  const backgrounds=await page.locator('.app-header,.toolbar,.formula-bar,.grid-shell').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundColor));
  await page.locator('[data-action="references"]').click();await expect(page.locator('[data-action="back-workbook"]')).toHaveCount(0);await expect(page.locator('body')).toHaveClass(/dd-mode/);
  expect(await page.locator('.app-header,.toolbar,.formula-bar,.grid-shell').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundColor))).toEqual(backgrounds);
  await expect(page.locator('.grid thead th').first()).toHaveCSS('background-color','rgb(245, 241, 248)');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(247, 242, 250)');await expect(page.locator('html')).toHaveCSS('background-color','rgb(247, 242, 250)');await expect(page.locator('[data-action="picker"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Close DD',exact:true}).click();await expect(page.locator('body')).not.toHaveClass(/dd-mode/);
  await expect(page.locator('[data-action="back-workbook"]')).toHaveCount(0);await expect(cell).toHaveText('Manual place');expect(errors).toEqual([]);
});
test('Assign DD shows assigned state for manual values and follows selection, removal, undo and reload',async({page,isMobile})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const cell=page.locator('td[data-r="1"][data-c="1"]'),assignment=page.getByRole('button',{name:'Assign DD',exact:true});
  await cell.click();await expect(assignment).toHaveAttribute('aria-pressed','false');
  await assignment.click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown',exact:true}).click();
  await expect(assignment).toHaveAttribute('aria-pressed','true');
  await page.locator('td[data-r="2"][data-c="2"]').click();await expect(assignment).toHaveAttribute('aria-pressed','false');
  await cell.click();await page.keyboard.press('Escape');await expect(assignment).toHaveAttribute('aria-pressed','true');
  if(isMobile)await cell.click();await page.locator('#formula').fill('Manual place');await page.locator('#formula').press('Enter');await cell.click();await page.keyboard.press('Escape');
  await expect(assignment).toHaveAttribute('aria-pressed','true');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();await cell.click();await page.keyboard.press('Escape');await expect(assignment).toHaveAttribute('aria-pressed','true');
  await assignment.click();await page.locator('#no-dropdown').click();await page.getByRole('button',{name:'Apply dropdown',exact:true}).click();
  await expect(assignment).toHaveAttribute('aria-pressed','false');await expect(cell).toHaveText('Manual place');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(assignment).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(assignment).toHaveAttribute('aria-pressed','false');
});
test('multiple dropdown sources persist for cells and columns and grid previews stop at four options',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const cell=page.locator('td[data-r="2"][data-c="2"]');await cell.click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'Grid view',exact:true}).click();
  const dialog=page.getByRole('dialog'),height=await dialog.evaluate(el=>el.getBoundingClientRect().height);await expect(dialog).not.toContainText('row(s)');await page.getByRole('button',{name:'List view',exact:true}).click();expect(await dialog.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(height);await page.getByRole('button',{name:'Grid view',exact:true}).click();expect(await dialog.evaluate(el=>el.getBoundingClientRect().height)).toBe(height);
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
test('formatting shortcuts act on selected cells and expose matching tooltip hints',async({page,isMobile})=>{
  await page.goto('/');const cell=page.locator('td[data-r="1"][data-c="5"]');await cell.click();
  if(isMobile)await page.keyboard.press('Escape');
  for(const key of ['b','i','u','5'])await page.keyboard.press('Control+'+key);
  await expect(cell).toHaveCSS('font-weight','700');await expect(cell).toHaveCSS('font-style','italic');await expect(cell).toHaveCSS('text-decoration-line','underline line-through');
  await page.keyboard.press('Control+Alt+w');await expect(cell).toHaveCSS('white-space','pre-wrap');await expect(page.getByRole('button',{name:'Wrap text',exact:true})).toHaveAttribute('aria-keyshortcuts','Control+Alt+w Meta+Alt+w');
  await page.keyboard.press('Control+Alt+c');await expect(page.getByRole('dialog')).toContainText('Text color');await page.locator('[data-color="#c00000"]').click();
  await page.keyboard.press('Control+Alt+b');await expect(page.getByRole('dialog')).toContainText('Cell background color');await page.locator('[data-color="#fff2cc"]').click();
  await expect(cell).toHaveCSS('color','rgb(192, 0, 0)');await expect(cell).toHaveCSS('background-color','rgb(255, 242, 204)');
  await page.keyboard.press('Control+Alt+n');await expect(page.locator('#number-format')).toBeVisible();await page.keyboard.press('Escape');
  if(isMobile)await cell.click();else await page.locator('#formula').focus();await page.keyboard.press('Control+b');await expect(cell).toHaveCSS('font-weight','700');
});
test('source tabs remember column defaults without rewriting links or linking matching manual text',async({page,isMobile})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('th[data-col="2"] .column-index').click();await page.locator('[data-action="dropdown-source"]').click();await expect(page.getByRole('button',{name:'Grid view',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('checkbox',{name:'Snack / Category',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  const first=page.locator('td[data-r="2"][data-c="2"]'),second=page.locator('td[data-r="3"][data-c="2"]'),manualInput=isMobile?page.locator('#formula'):page.getByRole('textbox',{name:'Edit selected cell'});
  await first.click();await page.locator('.cell-dropdown').getByRole('option',{name:'Japan',exact:true}).click();
  await first.click();await page.getByRole('tab',{name:'Snack / Category',exact:true}).click();await expect(first).toHaveText('Japan');await expect(first).toHaveClass(/linked/);await page.keyboard.press('Escape');
  await second.click();await expect(page.getByRole('tab',{name:'Snack / Category',exact:true})).toHaveAttribute('aria-selected','true');await page.locator('.cell-dropdown').getByRole('option',{name:'Cookie',exact:true}).click();
  await first.click();await expect(page.getByRole('tab',{name:'Snack / Country',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Custom',exact:true}).click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);await expect(manualInput).toHaveValue('Japan');await expect(first).toHaveClass(/linked/);await manualInput.fill('Japan');await page.keyboard.press('Enter');await expect(first).not.toHaveClass(/linked/);
  await expect(second).toHaveText('Cookie');await expect(second).toHaveClass(/linked/);await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await page.locator('td[data-r="4"][data-c="2"]').click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);await expect(manualInput).toBeFocused();await page.keyboard.press('Escape');await page.keyboard.press('Alt+ArrowDown');
  const manual=page.getByRole('button',{name:'Custom',exact:true});await expect(manual).toHaveAttribute('aria-pressed','true');await expect(manual).toHaveCSS('font-weight','700');await expect(manual.locator('.pencil-body')).toHaveCSS('fill','rgb(25, 87, 71)');await expect(page.locator('.cell-dropdown')).not.toContainText('Current value');await expect(page.locator('.cell-dropdown textarea,.dropdown-manual-form,.cell-dropdown .bottom')).toHaveCount(0);await expect(page.locator('.cell-dropdown').getByRole('option',{selected:true})).toHaveCount(0);
  await manual.click();await manualInput.fill('=Japan');await page.keyboard.press('Enter');await expect(page.locator('td[data-r="4"][data-c="2"]')).toHaveText('=Japan');await expect(page.locator('td[data-r="4"][data-c="2"]')).not.toHaveClass(/calculated|linked/);
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
