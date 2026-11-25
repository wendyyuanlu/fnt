import {expect,test,type Locator,type Page} from '@playwright/test';

async function fixture(page:Page,rowCount=24){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async rowCount=>{
    const model='/src/model.ts',catalog='/src/dropdown-catalog.ts',storage='/src/storage.ts';
    const [{blankSheet,createDemo,key},{seedDropdownCatalog},{Store}]=await Promise.all([
      import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>,
      import(/* @vite-ignore */catalog) as Promise<typeof import('../../src/dropdown-catalog')>,
      import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>
    ]);
    const book=seedDropdownCatalog(createDemo()).book,sheet=blankSheet('Five tables',rowCount,12);
    book.sheets.unshift(sheet);book.title='Synthetic table-selection fixture';
    sheet.columns.forEach(column=>column.width=82);
    sheet.groups=[{id:'outside-group',axis:'row',kind:'range',members:sheet.rows.slice(22).map(row=>row.id),collapsed:false,label:'Outside'}];
    for(const [name,r,c] of [['Top',2,1],['Middle',9,1],['Bottom',16,1],['Right',9,5],['Far-right',9,9]] as const){
      const table={id:'scope-'+name.toLowerCase(),name,sheet:sheet.id,header:sheet.rows[r].id,rows:sheet.rows.slice(r+1,r+5).map(row=>row.id),columns:sheet.columns.slice(c,c+3).map((column,i)=>({id:name+'-field-'+i,name:['Name','Qty','Note'][i],column:column.id}))};
      book.tables.push(table);
      for(const field of table.columns)sheet.cells[key(table.header,field.column)]={value:field.name};
      table.rows.forEach((row,i)=>table.columns.forEach(field=>sheet.cells[key(row,field.column)]={value:`${name} ${i+1} ${field.name}`}));
    }
    const store=await Store.open();try{const state=(await store.load())!;await store.save(book,state.version,'Synthetic multi-table selection');}finally{store.close();}
    sessionStorage.setItem('fnt-current-sheet',sheet.id);
  },rowCount);
  await page.reload();await expect(page.locator('.grid')).toHaveAttribute('aria-label','Five tables');
}
async function snapshot(page:Page){
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
}
const activate=(locator:Locator,mobile:boolean)=>mobile?locator.tap():locator.click();
async function chooseTarget(page:Page,id:string){
  const names:Record<string,string>={'scope-top':'Top','scope-middle':'Middle','scope-right':'Right'};
  await page.getByLabel('Table selection target',{exact:true}).click();
  await page.getByRole('option',{name:id?(names[id]??id):'Auto',exact:true}).click();
}
async function extend(page:Page,axis:'row'|'column',index:number,mobile:boolean){
  const target=page.locator(axis==='row'?`[data-row-select="${index}"] .row-index`:`th[data-col="${index}"] .column-index`);
  if(mobile){
    await page.locator('.selection-count').tap();
    await page.getByRole('button',{name:`Extend ${axis} selection on next header tap`,exact:true}).tap();
    await target.tap();
  }else await target.click({modifiers:['Shift']});
}
async function scopedSelection(page:Page,axis:'row'|'column',mobile:boolean){
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),mobile);
  await chooseTarget(page,'scope-middle');
  await activate(page.locator(axis==='row'?'[data-row-select="10"] .row-index':'th[data-col="1"] .column-index'),mobile);
  await extend(page,axis,axis==='row'?12:3,mobile);
}
async function groupFixture(page:Page,axis:'row'|'column',collapsed:boolean){
  await fixture(page);
  await page.evaluate(async({axis,collapsed})=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets[0],owner=state.book.tables.find(table=>table.id==='scope-middle')!;
      if(axis==='row'){
        owner.rows.push(sheet.rows[14].id);
        for(const field of owner.columns)sheet.cells[`${sheet.rows[14].id}:${field.column}`]={value:'Extra row '+field.name};
      }else{
        const field={id:'extra-field',name:'Extra',column:sheet.columns[4].id};owner.columns.push(field);
        sheet.cells[`${owner.header}:${field.column}`]={value:field.name};
        for(const row of owner.rows)sheet.cells[`${row}:${field.column}`]={value:'Extra column'};
      }
      const members=axis==='row'?owner.rows:owner.columns.map(field=>field.column);
      sheet.groups.push({id:'scoped-outer',axis,kind:'summary',table:owner.id,members:members.slice(0,3),collapsed:false,label:'Scoped parent'},{id:'scoped-inner',axis,kind:'summary',table:owner.id,members:members.slice(1,3),collapsed,label:'Scoped child'});
      sheet.outlineView={tree:true};
      await store.save(state.book,state.version,'Nested table summaries');
    }finally{store.close();}
  },{axis,collapsed});
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
}
test('table summary tree toggles local indentation and rails without changing adjacent tables',async({page})=>{
  await groupFixture(page,'row',false);
  const nested=page.locator('td[data-r="11"][data-c="1"]'),neighbor=page.locator('td[data-r="11"][data-c="5"]');
  await expect(nested).toHaveCSS('--summary-text-inset','48px');
  await expect(nested.locator('.row-outline-rail[data-group-id="scoped-outer"]')).toHaveCount(1);
  await expect(neighbor.locator('.row-outline-rail,.row-group-controls')).toHaveCount(0);await expect(neighbor).not.toHaveClass(/summary-cell/);
  const before=await snapshot(page);
  await nested.click();
  const colors=await nested.evaluate(cell=>{
    const rail=cell.querySelector('.row-outline-rail')!,button=document.querySelector('.grid .group-control[data-group-id="scoped-outer"]')!,tab=document.querySelector('.sheet-tab.current')!;
    return{rail:getComputedStyle(rail).borderLeftColor,button:getComputedStyle(button).borderColor,tab:getComputedStyle(tab,'::after').backgroundColor,active:getComputedStyle(document.querySelector('.grid td.active')!).outlineColor};
  });
  expect(colors.rail).toBe(colors.button);expect(colors.tab).toBe(colors.active);
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Tree view',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('switch',{name:'Tree view',exact:true}).click();
  await expect(nested).toHaveCSS('--summary-text-inset','24px');await expect(page.locator('.row-outline-rail')).toHaveCount(0);
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(nested).toHaveCSS('--summary-text-inset','24px');
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Tree view',exact:true})).toHaveAttribute('aria-checked','false');
  await page.getByRole('switch',{name:'Tree view',exact:true}).click();
  await expect(nested).toHaveCSS('--summary-text-inset','48px');await page.keyboard.press('Escape');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(nested).toHaveCSS('--summary-text-inset','48px');
  expect((await snapshot(page)).sheets.map(sheet=>sheet.cells)).toEqual(before.sheets.map(sheet=>sheet.cells));
});
for(const axis of ['row','column'] as const)for(const collapsed of [false,true])test(`table-constrained ${axis} drops join ${collapsed?'collapsed':'expanded'} summaries and parents without moving neighbors`,async({page,isMobile})=>{
  await groupFixture(page,axis,collapsed);
  if(axis==='column'&&!collapsed)await expect(page.locator('td[data-r="9"][data-c="2"] .column-summary-rail')).not.toHaveCount(0);
  await page.getByRole('button',{name:'Table-constrained header selection',exact:true}).click();await chooseTarget(page,'scope-middle');
  const source=page.locator(axis==='row'?'td[data-r="14"][data-c="1"]':'td[data-r="9"][data-c="4"]');
  const display=Number(await source.getAttribute(axis==='row'?'data-display-r':'data-display-c'));
  await page.locator(axis==='row'?`[data-row-select="${display}"] .row-index`:`th[data-col="${display}"] .column-index`).click();
  const before=await snapshot(page),owner=before.tables.find(table=>table.id==='scope-middle')!,own=new Set([owner.header,...owner.rows].flatMap(row=>owner.columns.map(field=>`${row}:${field.column}`)));
  const neighbors=(book:typeof before)=>Object.fromEntries(Object.entries(book.sheets[0].cells).filter(([address])=>!own.has(address)));
  const handle=page.locator(axis==='row'?`[data-move-row="${display}"]`:`[data-move-column="${display}"]`),target=page.locator('.grid .group-control[data-group-id="scoped-inner"]');
  if(isMobile){await handle.click();await target.click();}
  else{
    const transfer=await page.evaluateHandle(()=>new DataTransfer());await handle.dispatchEvent('dragstart',{dataTransfer:transfer});
    const rect=(await target.boundingBox())!;await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2});
    await expect(target.locator('xpath=ancestor::td')).toHaveAttribute('data-drop-group','scoped-inner');
    await target.dispatchEvent('drop',{dataTransfer:transfer});
  }
  const after=await snapshot(page),inner=after.sheets[0].groups.find(group=>group.id==='scoped-inner')!,outer=after.sheets[0].groups.find(group=>group.id==='scoped-outer')!;
  expect(inner.members).toHaveLength(3);expect(inner.collapsed).toBe(collapsed);expect(outer.members).toHaveLength(4);
  expect(neighbors(after)).toEqual(neighbors(before));expect(after.sheets[0].rows).toEqual(before.sheets[0].rows);expect(after.sheets[0].columns).toEqual(before.sheets[0].columns);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  const undone=await snapshot(page);expect(undone.sheets[0].groups).toEqual(before.sheets[0].groups);expect(undone.sheets[0].cells).toEqual(before.sheets[0].cells);
});
test('existing headers constrain selection, resolve shared axes, extend on touch and never add cell-edge targets',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await activate(page.locator('th[data-col="2"] .column-index'),isMobile);
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Top');
  await activate(page.locator('[data-row-select="11"] .row-index'),isMobile);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.selection-count')).toHaveText('3 cells');
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  await expect(page.locator('td.selected')).toHaveCount(3);
  await activate(page.locator('[data-row-select="11"] .row-index'),isMobile);
  await expect(page.locator('.selection-count')).toHaveText('3 cells');
  await extend(page,'row',12,isMobile);await expect(page.locator('.selection-count')).toHaveText('6 cells');
  await expect(page.locator('td[data-r="11"][data-c="5"]')).not.toHaveClass(/selected/);
  await chooseTarget(page,'scope-right');
  await activate(page.locator('[data-row-select="11"] .row-index'),isMobile);
  await expect(page.locator('td[data-r="11"][data-c="5"]')).toHaveClass(/selected/);
  await expect(page.locator('td[data-r="11"][data-c="1"]')).not.toHaveClass(/selected/);
  await activate(page.locator('th[data-col="2"] .column-index'),isMobile);
  await expect(page.locator('#error')).toContainText('outside the chosen table');
  await page.getByRole('button',{name:'Dismiss error'}).click();
  await chooseTarget(page,'');
  await page.locator('td[data-r="9"][data-c="1"]').click({position:{x:35,y:1}});
  await expect(page.locator('.selection-count')).toHaveText('1 cells');
  await expect(page.locator('[data-table-row-select],.table-edge-target,.table-selection-handle')).toHaveCount(0);
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await activate(page.locator('[data-row-select="11"] .row-index'),isMobile);
  await expect(page.locator('.selection-count')).toHaveText(`${before.sheets[0].columns.length} cells`);
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
test('Auto row selection follows the left viewport edge across side-by-side tables regardless of the active cell',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  await page.addStyleTag({content:'#grid-scroll{max-width:280px}'});
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await chooseTarget(page,'scope-right');
  const row=page.locator('[data-row-select="11"] .row-index');
  await activate(row,isMobile);await expect(page.locator('#selection-scope-label')).toHaveText('Table: Right');
  await chooseTarget(page,'');
  await page.locator('#grid-scroll').evaluate(grid=>{grid.scrollLeft=0;});
  await activate(row,isMobile);await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  await expect(page.locator('.selection-count')).toHaveText('3 cells');
  for(const [column,owner] of [[5,'Right'],[9,'Far-right']] as const){
    await page.locator('#grid-scroll').evaluate((grid,column)=>{
      const header=grid.querySelector(`thead [data-col="${column}"]`)!,corner=grid.querySelector('.corner')!;
      grid.scrollLeft+=header.getBoundingClientRect().left-corner.getBoundingClientRect().right+10;
    },column);
    await activate(row,isMobile);await expect(page.locator('#selection-scope-label')).toHaveText('Table: '+owner);
    await expect(page.locator('.selection-count')).toHaveText('3 cells');
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
for(const axis of ['row','column'] as const)for(const kind of ['summary','range'] as const){
  test(`${kind} ${axis} groups belong to their selected table, compact only its cells and persist`,async({page,isMobile})=>{
    await fixture(page);const before=await snapshot(page);
    await scopedSelection(page,axis,isMobile);
    await activate(page.getByRole('button',{name:'Group controls',exact:true}),isMobile);
    await activate(page.getByRole('button',{name:'Manage groups',exact:true}),isMobile);
    await page.locator(`[data-create-kind="${kind}"][data-create-axis="${axis}"]`).click();
    const grouped=await snapshot(page),group=grouped.sheets[0].groups.find(g=>g.table==='scope-middle')!;
    expect(group.axis).toBe(axis);expect(group.kind).toBe(kind);
    await expect(page.locator(`[data-group-card="${group.id}"]`)).toContainText('Table: Middle');
    await page.getByRole('button',{name:'Close group manager'}).click();
    await page.locator(`.group-control[data-group-id="${group.id}"]`).click();
    const r=axis==='row'?11:10,c=axis==='row'?1:2;
    await expect(page.locator(`td[data-r="${r}"][data-c="${c}"]`)).toHaveCount(0);
    await expect(page.locator(`td[data-r="${r}"][data-c="5"]`)).not.toHaveClass(/scoped-hidden/);
    await expect(page.locator('td[data-r="17"][data-c="2"]')).not.toHaveClass(/scoped-hidden/);
    expect((await snapshot(page)).sheets[0].cells).toEqual(before.sheets[0].cells);
    await page.reload();
    await expect(page.locator(`td[data-r="${r}"][data-c="${c}"]`)).toHaveCount(0);
    const after=await snapshot(page);
    expect(after.sheets[0].groups.find(g=>g.id===group.id)).toMatchObject({table:'scope-middle',collapsed:true});
    expect(after.sheets[0].rows).toEqual(before.sheets[0].rows);
    if(axis==='row'&&kind==='summary'){
      await page.locator('td[data-r="10"][data-c="1"] .cell-value').click();
      await page.keyboard.press('ArrowDown');await expect(page.locator('.address')).toHaveText('B14');
    }
  });
}
  test('combined table compaction moves displayed cells up and left, edits original identities and restores neighbors unchanged',async({page,isMobile})=>{
    await fixture(page);
    await page.evaluate(async()=>{
      const model='/src/model.ts',storage='/src/storage.ts',[{key,setInput},{Store}]=await Promise.all([import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>,import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>]);
      const store=await Store.open();try{
        const state=(await store.load())!,book=state.book,sheet=book.sheets[0];
        sheet.groups.push({id:'compact-row',kind:'range',axis:'row',table:'scope-middle',members:[sheet.rows[11].id],collapsed:false,label:'Inner row'},
          {id:'compact-column',kind:'range',axis:'column',table:'scope-middle',members:[sheet.columns[2].id],collapsed:false,label:'Inner column'});
        setInput(book,sheet,sheet.rows[0].id,sheet.columns[0].id,'=D13');
        sheet.cells[key(sheet.rows[12].id,sheet.columns[3].id)].note='Retained note';
        await store.save(book,state.version,'Compaction fixture');
      }finally{store.close();}
    });
    await page.reload();const before=await snapshot(page),original=before.sheets[0];
    const cell=page.locator('td[data-r="12"][data-c="3"]'),neighbor=page.locator('td[data-r="12"][data-c="5"]');
    const initial=(await cell.boundingBox())!,neighborBefore=(await neighbor.boundingBox())!;
    await activate(page.locator('[data-group-id="compact-row"]'),isMobile);
    await activate(page.locator('[data-group-id="compact-column"]'),isMobile);
    await expect(cell).toHaveAttribute('data-display-r','11');await expect(cell).toHaveAttribute('data-display-c','2');
    const compacted=(await cell.boundingBox())!,neighborAfter=(await neighbor.boundingBox())!;
    expect(compacted.y).toBeLessThan(initial.y);expect(compacted.x).toBeLessThan(initial.x);
    expect(neighborAfter.x).toBe(neighborBefore.x);expect(neighborAfter.y).toBe(neighborBefore.y);
    await expect(cell.locator('.note-dot')).toHaveCount(1);
    await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);await chooseTarget(page,'scope-middle');
    await activate(page.locator('[data-row-select="11"] .row-index'),isMobile);
    await expect(page.locator('.address')).toHaveText('D13');
    await activate(page.locator('th[data-col="2"] .column-index'),isMobile);await expect(page.locator('.address')).toHaveText('D14');
    await activate(cell.locator('.cell-value'),isMobile);await page.locator('#formula').fill('Edited projected cell');await page.locator('#formula').press('Enter');
    await page.keyboard.press('ArrowRight');await expect(page.locator('.address')).toHaveText('E12');
    await page.keyboard.press('ArrowLeft');await expect(page.locator('.address')).toHaveText('D13');
    await expect(page.locator('td[data-r="0"][data-c="0"] .cell-value')).toHaveText('Edited projected cell');
    const edited=await snapshot(page),updated=edited.sheets[0];
    for(const [address,value]of Object.entries(original.cells)){
      if(address===`${original.rows[12].id}:${original.columns[3].id}`)continue;
      expect(updated.cells[address]).toEqual(value);
    }
    await activate(page.locator('[data-group-id="compact-row"]'),isMobile);await activate(page.locator('[data-group-id="compact-column"]'),isMobile);
    await expect(cell).toHaveAttribute('data-display-r','12');await expect(cell).toHaveAttribute('data-display-c','3');
    expect((await cell.boundingBox())!.x).toBe(initial.x);expect((await cell.boundingBox())!.y).toBe(initial.y);
    expect(updated.rows).toEqual(original.rows);expect(updated.columns).toEqual(original.columns);expect(edited.tables).toEqual(before.tables);
  });
for(const axis of ['row','column'] as const){
  test(`table ${axis} hypo can override a sheet tag without changing neighboring tables or cell data`,async({page,isMobile})=>{
    await fixture(page);const before=await snapshot(page);
    await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
    await chooseTarget(page,'scope-middle');
    const header=page.locator(axis==='row'?'[data-row-select="11"] .row-index':'th[data-col="2"] .column-index');
    await activate(header,isMobile);
    await activate(page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}),isMobile);
    await expect(page.locator('td[data-r="11"][data-c="2"]')).toHaveClass(/hypothetical-cell/);
    await expect(page.locator('td[data-r="11"][data-c="5"]')).not.toHaveClass(/hypothetical-cell/);
    await expect(page.locator('td[data-r="17"][data-c="2"]')).not.toHaveClass(/hypothetical-cell/);
    await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
    await activate(header,isMobile);
    await activate(page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}),isMobile);
    await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
    await chooseTarget(page,'scope-middle');await activate(header,isMobile);
    await activate(page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}),isMobile);
    await expect(page.locator('td[data-r="11"][data-c="2"]')).not.toHaveClass(/hypothetical-cell/);
    const neighbor=axis==='row'?'td[data-r="11"][data-c="5"]':'td[data-r="17"][data-c="2"]';
    await expect(page.locator(neighbor)).toHaveClass(/hypothetical-cell/);
    const saved=await snapshot(page),item=axis==='row'?saved.sheets[0].rows[11]:saved.sheets[0].columns[2];
    expect(item.hypothetical).toBe(true);expect(item.hypotheticalTables?.['scope-middle']).toBe(false);
    expect(saved.sheets[0].cells).toEqual(before.sheets[0].cells);
    await page.reload();await expect(page.locator('td[data-r="11"][data-c="2"]')).not.toHaveClass(/hypothetical-cell/);
    await expect(page.locator(neighbor)).toHaveClass(/hypothetical-cell/);
    await page.locator('[data-action="hypothetical-visibility"]').click();
    await expect(page.locator('td[data-r="11"][data-c="2"]')).not.toHaveClass(/scoped-hidden/);
    await expect(page.locator(neighbor)).toHaveCount(0);
    const compactedNeighbor=page.locator(axis==='row'?'td[data-r="12"][data-c="5"]':'td[data-r="17"][data-c="3"]');
    await expect(compactedNeighbor).toHaveAttribute(axis==='row'?'data-display-r':'data-display-c',axis==='row'?'11':'2');
    expect((await snapshot(page)).sheets[0].cells).toEqual(before.sheets[0].cells);
  });
}
test('table deletion removes only selected records and leaves sheet axes and adjacent table data intact',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  await scopedSelection(page,'row',isMobile);
  await activate(page.getByRole('button',{name:'Rows & columns',exact:true}),isMobile);
  await activate(page.getByRole('button',{name:'Delete selected rows',exact:true}),isMobile);
  await page.locator('#confirm').click();
  const after=await snapshot(page),original=before.sheets[0],saved=after.sheets[0],owner=before.tables.find(table=>table.id==='scope-middle')!;
  expect(saved.rows).toEqual(original.rows);expect(saved.columns).toEqual(original.columns);
  expect(after.tables.find(table=>table.id===owner.id)!.rows).toHaveLength(1);
  for(const [address,cell] of Object.entries(original.cells)){
    const [row,column]=address.split(':');if(!owner.rows.includes(row)||!owner.columns.some(field=>field.column===column))expect(saved.cells[address]).toEqual(cell);
  }
});
test('Auto follows the nearest table at the viewport top even when the active cell belongs to another table',async({page,isMobile})=>{
  await fixture(page,90);const before=await snapshot(page);
  await activate(page.locator('td[data-r="3"][data-c="2"]'),isMobile);
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  const column=page.locator('th[data-col="2"] .column-index');
  await activate(column,isMobile);await expect(page.locator('#selection-scope-label')).toHaveText('Table: Top');
  const align=async(row:number)=>page.locator('#grid-scroll').evaluate((grid,row)=>{
    const target=grid.querySelector<HTMLElement>(`tr[data-row="${row}"]`)!;
    grid.scrollTop+=target.getBoundingClientRect().top-grid.querySelector('thead')!.getBoundingClientRect().bottom+10;
    grid.dispatchEvent(new Event('scroll'));
  },row);
  await align(11);
  await activate(column,isMobile);await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  await expect(page.locator('.selection-count')).toHaveText('5 cells');
  await align(18);
  await activate(column,isMobile);await expect(page.locator('#selection-scope-label')).toHaveText('Table: Bottom');
  await chooseTarget(page,'scope-top');
  await activate(column,isMobile);await expect(page.locator('#selection-scope-label')).toHaveText('Table: Top');
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
test('Auto uses sheet selection for table-free headers without switching off or broadening table-owned ranges',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  const toggle=page.getByRole('button',{name:'Table-constrained header selection'});
  await activate(toggle,isMobile);
  await activate(page.locator('[data-row-select="0"] .row-index'),isMobile);
  await expect(page.locator('#selection-scope-label')).toHaveText('Sheet selection');
  await expect(page.locator('.selection-count')).toHaveText(`${before.sheets[0].columns.length} cells`);
  await extend(page,'row',1,isMobile);await expect(page.locator('.selection-count')).toHaveText(`${before.sheets[0].columns.length*2} cells`);
  await activate(page.locator('th[data-col="0"] .column-index'),isMobile);
  await expect(page.locator('.selection-count')).toHaveText(`${before.sheets[0].rows.length} cells`);
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await activate(page.locator('th[data-col="2"] .column-index'),isMobile);
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Top');
  await expect(page.locator('.selection-count')).toHaveText('5 cells');
  await extend(page,'column',0,isMobile);
  await expect(page.locator('#selection-scope-label')).toHaveText('Sheet selection');
  await expect(page.locator('.selection-count')).toHaveText(`${before.sheets[0].rows.length} cells`);
  await chooseTarget(page,'scope-top');
  await activate(page.locator('th[data-col="0"] .column-index'),isMobile);
  await expect(page.locator('#error')).toContainText('outside the chosen table');
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
test('noncontiguous table fields never include intervening freeform cells or fill their bounding box',async({page,isMobile})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,table=state.book.tables.find(t=>t.id==='scope-top')!;table.columns.splice(1,1);await store.save(state.book,state.version,'Synthetic field membership gap');}finally{store.close();}
  });
  await page.reload();const before=await snapshot(page);
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await chooseTarget(page,'scope-top');
  await activate(page.locator('th[data-col="1"] .column-index'),isMobile);await extend(page,'column',3,isMobile);
  await expect(page.locator('.selection-count')).toHaveText('10 cells');
  await expect(page.locator('td[data-r="3"][data-c="2"]')).not.toHaveClass(/selected/);
  await activate(page.getByRole('button',{name:'Fill down',exact:true}),isMobile);
  await expect(page.locator('#error')).toContainText('requires one rectangular range');
  expect((await snapshot(page)).sheets[0].cells).toEqual(before.sheets[0].cells);
});
test('table column DD assignment respects the chosen owner rather than earlier active-cell context',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  await activate(page.locator('td[data-r="3"][data-c="2"]'),isMobile);await page.keyboard.press('Escape');
  await activate(page.getByRole('button',{name:'Table-constrained header selection'}),isMobile);
  await chooseTarget(page,'scope-middle');
  await activate(page.locator('th[data-col="2"] .column-index'),isMobile);
  await activate(page.getByRole('button',{name:'Assign DD',exact:true}),isMobile);
  await page.getByRole('button',{name:'List view',exact:true}).click();
  await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();
  await activate(page.getByRole('button',{name:'Apply dropdown',exact:true}),isMobile);
  const after=await snapshot(page),sheet=after.sheets[0],table=after.tables.find(t=>t.id==='scope-middle')!;
  expect(sheet.validations).toHaveLength(1);expect(sheet.validations[0].rows).toEqual(table.rows);
  expect(sheet.validations[0].columns).toEqual([table.columns[1].column]);
  expect(sheet.cells).toEqual(before.sheets[0].cells);
});
test('reload and visiting DD retain table ownership instead of silently broadening saved header selections',async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);await scopedSelection(page,'row',isMobile);
  await page.reload();
  const toggle=page.getByRole('button',{name:'Table-constrained header selection'});
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('Table selection target',{exact:true})).toHaveAttribute('data-value','scope-middle');
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  await expect(page.locator('.selection-count')).toHaveText('9 cells');
  await activate(page.locator('[data-action="references"]'),isMobile);
  await activate(page.getByRole('button',{name:'Close DD',exact:true}),isMobile);
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  await expect(page.locator('.selection-count')).toHaveText('9 cells');
  await activate(page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}),isMobile);await snapshot(page);
  await activate(page.getByRole('button',{name:'Undo',exact:true}),isMobile);
  await expect(page.locator('#selection-scope-label')).toHaveText('Table: Middle');
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
test('the split control stays compact, checks its menu target and enables selection when choosing while off',async({page,isMobile})=>{
  await fixture(page);
  const toggle=page.getByRole('button',{name:'Table-constrained header selection'}),target=page.getByLabel('Table selection target',{exact:true});
  await expect(page.locator('.corner [data-action="select-all"]')).toHaveCount(0);
  await chooseTarget(page,'scope-middle');await expect(toggle).toHaveAttribute('aria-pressed','true');
  await activate(toggle,isMobile);await expect(toggle).toHaveAttribute('aria-pressed','false');
  await target.click();await expect(page.getByRole('option',{name:'Middle',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('option',{name:'Auto',exact:true})).toHaveCount(1);
  await page.getByRole('option',{name:'Middle',exact:true}).click();await expect(toggle).toHaveAttribute('aria-pressed','true');
  const geometry=await page.locator('.table-selection-control').evaluate(control=>{
    const buttons=[...control.querySelectorAll('button')],divider=getComputedStyle(buttons[1],'::before');
    return{height:control.getBoundingClientRect().height,width:control.getBoundingClientRect().width,buttons:buttons.map(button=>button.getBoundingClientRect().width),divider:{top:divider.top,bottom:divider.bottom,height:divider.height,color:divider.backgroundColor},stroke:getComputedStyle(control).boxShadow};
  });
  expect(geometry).toMatchObject({height:24,width:42,buttons:[24,18],divider:{top:'4px',bottom:'4px',height:'16px'}});
  expect(geometry.stroke).toContain(geometry.divider.color);
});
for(const axis of ['row','column'] as const)test(`table ${axis} duplication and rearrangement preserve neighbors and survive reload`,async({page,isMobile})=>{
  await fixture(page);const before=await snapshot(page);
  await chooseTarget(page,'scope-top');
  await activate(page.locator(axis==='row'?'[data-row-select="4"] .row-index':'th[data-col="2"] .column-index'),isMobile);
  await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
  await page.getByRole('button',{name:`Duplicate selected ${axis==='row'?'rows':'columns'}`,exact:true}).click();
  const duplicate=await snapshot(page),owner=duplicate.tables.find(table=>table.id==='scope-top')!;
  expect(axis==='row'?owner.rows.length:owner.columns.length).toBe(axis==='row'?5:4);
  const others=(book:typeof before)=>book.tables.filter(table=>table.id.startsWith('scope-')&&table.id!=='scope-top').map(table=>({table,cells:[table.header,...table.rows].map(row=>table.columns.map(field=>book.sheets[0].cells[`${row}:${field.column}`]))}));
  expect(others(duplicate)).toEqual(others(before));expect(duplicate.sheets[0].rows).toEqual(before.sheets[0].rows);expect(duplicate.sheets[0].columns).toEqual(before.sheets[0].columns);
  await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
  await page.getByRole('button',{name:axis==='row'?'Move rows to top':'Move column left',exact:true}).click();
  expect(others(await snapshot(page))).toEqual(others(before));
  await page.reload();await expect(page.getByLabel('Table selection target',{exact:true})).toHaveAttribute('data-value','scope-top');
  const current=await snapshot(page);expect(axis==='row'?current.tables.find(table=>table.id==='scope-top')!.rows.length:current.tables.find(table=>table.id==='scope-top')!.columns.length).toBe(axis==='row'?5:4);
});
test('table-mode block moves, grouping and new hypo headers stay local; shared resizing is refused',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const storage='/src/storage.ts',{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=book.sheets[0],top=book.tables.find(table=>table.id==='scope-top')!;
      top.columns[0].name='Meal';top.columns[1].name='isMeal';
      top.rows.forEach((row,i)=>{s.cells[`${row}:${top.columns[0].column}`]={value:i===0?'First':i===2?'Second':''};s.cells[`${row}:${top.columns[1].column}`]={value:i%2===0};});
      const side={...top,id:'scope-side',name:'Side',columns:s.columns.slice(5,8).map((column,i)=>({id:`side-field-${i}`,name:`Side ${i}`,column:column.id}))};
      book.tables.push(side);for(const row of [side.header,...side.rows])for(const field of side.columns)s.cells[`${row}:${field.column}`]={value:`Neighbor ${s.rows.findIndex(item=>item.id===row)} ${field.name}`};
      await store.save(book,state.version,'Synthetic meal blocks');
    }finally{store.close();}
  });
  await page.reload();const before=await snapshot(page),s=before.sheets[0],other=(book:typeof before)=>[2,3,4,5,6].map(row=>[5,6,7].map(column=>book.sheets[0].cells[`${s.rows[row].id}:${s.columns[column].id}`]));
  await chooseTarget(page,'scope-top');await page.locator('td[data-r="5"][data-c="1"]').click();
  await page.getByRole('button',{name:'Meal / day',exact:true}).click();await page.getByRole('button',{name:'Group & move to top',exact:true}).click();
  const moved=await snapshot(page);expect(moved.sheets[0].cells[`${s.rows[3].id}:${s.columns[1].id}`].value).toBe('Second');
  expect(moved.sheets[0].groups).toContainEqual(expect.objectContaining({table:'scope-top',kind:'summary',members:[s.rows[3].id,s.rows[4].id]}));expect(other(moved)).toEqual(other(before));
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshot(page)).sheets[0].cells).toEqual(s.cells);
  await page.getByRole('button',{name:'Meal / day',exact:true}).click();await page.locator('#block-label').fill('New meal');await page.locator('#block-status').selectOption('hypothetical');
  await page.getByRole('button',{name:'Create explicit meal',exact:true}).click();
  const created=await snapshot(page),row=created.tables.find(table=>table.id==='scope-top')!.rows.at(-1)!;
  expect(created.sheets[0].cells[`${row}:${s.columns[1].id}`].value).toBe('New meal');
  expect(created.sheets[0].rows.find(item=>item.id===row)).toMatchObject({hypotheticalTables:{'scope-top':true}});expect(created.sheets[0].rows.find(item=>item.id===row)?.status).not.toBe('hypothetical');expect(other(created)).toEqual(other(before));
  await page.locator('[data-resize-column="1"]').focus();await page.locator('[data-resize-column="1"]').press('Enter');await expect(page.locator('#error')).toContainText('shared across the sheet');
  expect((await snapshot(page)).sheets[0].columns).toEqual(s.columns);
});
async function collision(page:Page,broken:boolean){
  await fixture(page);
  await page.evaluate(async broken=>{
    const storage='/src/storage.ts',formula='/src/formula.ts';
    const [{Store},{compile}]=await Promise.all([import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>,import(/* @vite-ignore */formula) as Promise<typeof import('../../src/formula')>]);
    const store=await Store.open();try{
      const state=(await store.load())!,book=state.book,s=book.sheets[0];
      s.cells[`${s.rows[7].id}:${s.columns[1].id}`]={value:'Note below Pantry'};
      if(broken)s.cells[`${s.rows[12].id}:${s.columns[11].id}`]={formula:compile('=INDIRECT("L14")',book,s.id,s.rows[12].id,s.columns[11].id)};
      await store.save(book,state.version,'Synthetic collision fixture');
    }finally{store.close();}
  },broken);await page.reload();await chooseTarget(page,'scope-top');await page.locator('[data-row-select="4"] .row-index').click();
}
for(const tableMode of [false,true])test(`copied outlines follow ${tableMode?'table records':'sheet cell IDs'} through insertion, movement and Undo`,async({page})=>{
  await fixture(page);
  if(tableMode)await chooseTarget(page,'scope-middle');
  const source=page.locator('td[data-r="11"][data-c="1"]');await source.click();
  const label=await source.innerText();await page.getByRole('button',{name:'Copy',exact:true}).click();
  await page.locator('[data-row-select="10"] .row-index').click();await page.locator('[data-row-select="10"]').hover();await page.locator('[data-insert-row="11"]').click();
  await expect(page.locator('td[data-r="12"][data-c="1"]')).toHaveText(label);
  await expect(page.locator('td[data-r="12"][data-c="1"]')).toHaveClass(/copying/);await expect(page.locator('td[data-r="11"][data-c="1"]')).not.toHaveClass(/copying/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(source).toHaveClass(/copying/);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('td[data-r="12"][data-c="1"]')).toHaveClass(/copying/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.locator('[data-row-select="11"] .row-index').click();await page.locator('[data-move-row="11"]').click();
  await page.locator('[data-row-select="13"]').hover();await page.locator('[data-insert-row="14"]').click();
  await expect(page.locator('td[data-c="1"].copying')).toHaveText(label);
  await expect(source).not.toHaveClass(/copying/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(source).toHaveClass(/copying/);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('td[data-c="1"].copying')).toHaveText(label);
});
for(const accept of [false,true])test(`copied outlines ${accept?'follow confirmed':'retain cancelled'} conversion-table insertion`,async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],table=state.book.tables.find(table=>table.id==='scope-middle')!;
      table.rows.forEach((row,i)=>{s.cells[`${row}:${table.columns[0].column}`]={value:'From '+i};s.cells[`${row}:${table.columns[1].column}`]={value:i+1};s.cells[`${row}:${table.columns[2].column}`]={value:'To '+i};});
      state.book.references!.push({id:'outline-conversions',name:'Outline conversions',kind:'conversions',table:table.id,column:table.columns[0].id,archivedRows:[],conversion:{from:table.columns[0].id,to:table.columns[2].id,factor:table.columns[1].id}});
      s.cells[`${s.rows[0].id}:${s.columns[0].id}`]={binding:{table:table.id,row:table.rows[0],column:table.columns[0].id}};
      state.book.dropdownData!.sheets.push(s);
      state.book.dropdownData!.tables.push(...state.book.tables.filter(owner=>owner.sheet===s.id));
      state.book.sheets=state.book.sheets.filter(sheet=>sheet.id!==s.id);state.book.tables=state.book.tables.filter(owner=>owner.sheet!==s.id);
      sessionStorage.setItem('fnt-view:'+state.book.id,JSON.stringify({reference:'outline-conversions',sheet:s.id,row:s.rows[11].id,column:s.columns[1].id,scroll:0,left:0,tableMode:true,scope:table.id,target:table.id}));
      await store.save(state.book,state.version,'Disposable conversion outline fixture');
    }finally{store.close();}
  });await page.reload();await expect(page.locator('.grid')).toHaveAttribute('aria-label','Outline conversions');
  await page.locator('td[data-r="11"][data-c="1"]').click();await page.getByRole('button',{name:'Copy',exact:true}).click();
  await page.locator('[data-row-select="10"] .row-index').click();await page.locator('[data-row-select="10"]').hover();await page.locator('[data-insert-row="11"]').click();
  await expect(page.getByRole('heading',{name:'Change conversion factor?',exact:true})).toBeVisible();
  await expect(page.locator('td[data-r="11"][data-c="1"]')).toHaveClass(/copying/);
  await page.getByRole('button',{name:accept?'Confirm':'Close dialog',exact:true}).click();
  const destination=accept?12:11;
  await expect(page.locator(`td[data-r="${destination}"][data-c="1"]`)).toHaveClass(/copying/);
  await expect(page.locator(`td[data-r="${destination}"][data-c="1"]`)).toHaveText('From 1');
  if(accept){await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('td[data-r="11"][data-c="1"]')).toHaveClass(/copying/);await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('td[data-r="12"][data-c="1"]')).toHaveClass(/copying/);}
});
for(const kind of ['cell','sheet-row','sheet-row-compacted'] as const)test(`matched clipboard baseline preserves warmed lookup dependencies after ${kind} paste and reload`,async({page},info)=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async kind=>{
    const model='/src/model.ts',storage='/src/storage.ts';
    const [{blankSheet,setInput},{Store}]=await Promise.all([import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>,import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>]);
    const s=blankSheet('Clipboard baseline',35,8);s.id='clipboard-sheet';s.rows.forEach((row,i)=>row.id='row-'+i);s.columns.forEach((column,i)=>column.id='column-'+i);
    const make=(id:string,name:string,header:number,rows:number[],fields:string[])=>({id,name,sheet:s.id,header:s.rows[header].id,rows:rows.map(r=>s.rows[r].id),columns:fields.map((name,c)=>({id:id+'-field-'+c,name,column:s.columns[c].id}))});
    const meals=make('meals','Meals',0,[1,2,3,4,5,6],['Meal','Ingredient','Amount','Total','Unit']),ingredients=make('ingredients','Ingredients',10,[11,12,13],['Ingredients','Conversion Unit','Quantity']);
    const book:import('../../src/model').Workbook={schema:1,id:'clipboard-baseline',title:'Deterministic clipboard baseline',revision:0,sheets:[s],tables:[meals,ingredients],names:[],pickerSources:{}};
    for(const table of book.tables)for(const field of table.columns)s.cells[`${table.header}:${field.column}`]={value:field.name};
    for(const [r,label,unit] of [[11,'Same','g'],[12,'Same','kg'],[13,'Other','oz']] as const){s.cells[`row-${r}:column-0`]={value:label};s.cells[`row-${r}:column-1`]={value:unit};}
    for(const r of [1,2,3,4,5,6]){s.cells[`row-${r}:column-0`]={value:'Meal '+r};s.cells[`row-${r}:column-1`]={binding:{table:ingredients.id,row:'row-'+(r===2?12:13),column:ingredients.columns[0].id}};s.cells[`row-${r}:column-2`]={value:r*5};setInput(book,s,'row-'+r,'column-3',`=SUM(C${r}:C${r+1})`);setInput(book,s,'row-'+r,'column-4','=XLOOKUP(Meals[@Ingredient],Ingredients[Ingredients],Ingredients[Conversion Unit],"")');}
    if(kind==='sheet-row-compacted'){s.groups=[{id:'clipboard-compact',axis:'row',kind:'summary',table:meals.id,members:['row-1','row-2'],collapsed:true,label:'Compacted rows'}];s.cells['row-3:column-1'].binding!.row='row-12';}
    const store=await Store.open();try{const current=(await store.load())!;await store.save(book,current.version,'Deterministic clipboard regression fixture');}finally{store.close();}
    sessionStorage.setItem('fnt-current-sheet',s.id);
  },kind);await page.reload();
  const cell=(r:number,c:number)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`),before=await snapshot(page);
  const destination=kind==='sheet-row-compacted'?5:4,source=kind==='sheet-row-compacted'?3:2,total=kind==='sheet-row'?25:35;
  await expect(cell(destination,4)).toHaveText('oz');await expect(cell(source,4)).toHaveText('g');
  if(kind==='cell')await cell(2,1).click();else await page.locator('[data-row-select="2"] .row-index').click();
  await page.getByRole('button',{name:'Copy',exact:true}).click();
  if(kind==='cell')await cell(4,1).click();else await page.locator('[data-row-select="4"] .row-index').click();
  await page.getByRole('button',{name:'Paste',exact:true}).click();
  const pasted=await snapshot(page);
  const warm={unit:await cell(destination,4).innerText(),total:await cell(destination,3).innerText()};
  const cold=await page.evaluate(async destination=>{
    const formula='/src/formula.ts',storage='/src/storage.ts';
    const [{Engine},{Store}]=await Promise.all([import(/* @vite-ignore */formula) as Promise<typeof import('../../src/formula')>,import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>]);
    const store=await Store.open();try{const book=(await store.load())!.book,engine=new Engine(book);return{total:engine.cell('clipboard-sheet','row-'+destination,'column-3'),unit:engine.cell('clipboard-sheet','row-'+destination,'column-4')};}finally{store.close();}
  },destination);
  await info.attach('matched-clipboard-paste',{body:JSON.stringify({kind,before,pasted,warm,cold}),contentType:'application/json'});
  await expect(page.locator('#error')).toBeHidden();await expect(cell(destination,4)).toHaveText('g');
  await expect(cell(destination,3)).toHaveText(String(total));
  expect(pasted.sheets[0].cells[`row-${destination}:column-1`].binding).toEqual(before.sheets[0].cells[`row-${source}:column-1`].binding);
  expect(pasted.sheets[0].cells[`row-${destination}:column-4`].formula).toEqual(before.sheets[0].cells[`row-${destination}:column-4`].formula);
  await cell(11,1).click();await page.locator('#formula').fill('lb');await page.locator('#formula').press('Enter');
  await expect(cell(destination,4)).toHaveText('lb');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(destination,4)).toHaveText('g');
  const restored=await snapshot(page);await page.reload();await expect(cell(destination,4)).toHaveText('g');await expect(cell(destination,3)).toHaveText(String(total));
  const fresh=await page.evaluate(async destination=>{
    const formula='/src/formula.ts',storage='/src/storage.ts';
    const [{Engine},{Store}]=await Promise.all([import(/* @vite-ignore */formula) as Promise<typeof import('../../src/formula')>,import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>]);
    const store=await Store.open();try{const book=(await store.load())!.book,engine=new Engine(book);return{total:engine.cell('clipboard-sheet','row-'+destination,'column-3'),unit:engine.cell('clipboard-sheet','row-'+destination,'column-4')};}finally{store.close();}
  },destination);
  expect(fresh).toEqual({total,unit:'g'});
  await info.attach('matched-clipboard-state',{body:JSON.stringify({kind,before,pasted,restored,fresh}),contentType:'application/json'});
});
test('table header insertion keeps a ten-record selection when choosing another boundary in the same table',async({page})=>{
  await fixture(page,80);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets[0],owner=state.book.tables.find(t=>t.id==='scope-middle')!;state.book.tables=state.book.tables.filter(t=>t.id!=='scope-bottom');owner.rows=s.rows.slice(10,24).map(row=>row.id);await store.save(state.book,state.version,'Disposable multi-record insertion');}finally{store.close();}
  });await page.reload();
  await chooseTarget(page,'scope-middle');await page.locator('[data-row-select="10"] .row-index').click();await extend(page,'row',19,false);
  await expect(page.locator('.selection-count')).toHaveText('30 cells');
  const before=await snapshot(page);
  await page.locator('[data-row-select="23"]').hover();await page.locator('[data-insert-row="24"]').click();
  const after=await snapshot(page);
  expect(after.tables.find(t=>t.id==='scope-middle')!.rows).toHaveLength(24);
  expect(after.sheets[0].rows).toEqual(before.sheets[0].rows);
  expect(after.tables.filter(t=>t.id!=='scope-middle')).toEqual(before.tables.filter(t=>t.id!=='scope-middle'));
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect((await snapshot(page)).tables.find(t=>t.id==='scope-middle')!.rows).toEqual(before.tables.find(t=>t.id==='scope-middle')!.rows);
});
test('copying a compacted sheet row uses displayed cells and actual formula origins when pasted at a table cell',async({page})=>{
  await groupFixture(page,'row',true);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',model='/src/model.ts';
    const [{Store},{setInput}]=await Promise.all([import(/* @vite-ignore */path) as Promise<typeof import('../../src/storage')>,import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>]);
    const store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],right=state.book.tables.find(t=>t.id==='scope-right')!;
      for(const r of [12,13]){setInput(state.book,s,s.rows[r].id,s.columns[2].id,String(r));setInput(state.book,s,s.rows[r].id,s.columns[3].id,'=[@Qty]*2');}
      s.cells[`${s.rows[13].id}:${s.columns[1].id}`]={binding:{table:right.id,row:right.rows[0],column:right.columns[0].id},format:{background:'#fff2cc'}};
      await store.save(state.book,state.version,'Disposable projected clipboard formulas');
    }finally{store.close();}
  });await page.reload();
  const before=await snapshot(page),source=page.locator('td[data-r="13"][data-c="3"]');
  await expect(source).toHaveAttribute('data-display-r','12');await expect(source).toHaveText('26');
  await page.locator('[data-row-select="12"] .row-index').click();await page.getByRole('button',{name:'Copy',exact:true}).click();
  await page.locator('td[data-r="17"][data-c="2"]').click();await page.getByRole('button',{name:'Paste',exact:true}).click();
  await expect(page.locator('#error')).toBeHidden();await expect(page.locator('td[data-r="17"][data-c="3"]')).toHaveText('26');
  await expect(page.locator('td[data-r="17"][data-c="1"]')).toHaveText('Right 1 Name');
  const after=await snapshot(page),s=after.sheets[0],old=before.sheets[0];
  expect(s.cells[`${s.rows[17].id}:${s.columns[1].id}`]).toEqual(old.cells[`${old.rows[13].id}:${old.columns[1].id}`]);
  expect(s.cells[`${s.rows[17].id}:${s.columns[3].id}`].formula).toBeTruthy();
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshot(page)).sheets[0].cells).toEqual(old.cells);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await snapshot(page);await page.reload();
  await expect(page.locator('td[data-r="17"][data-c="3"]')).toHaveText('26');
});
test('native single-cell copy from an empty dropdown search replaces the old row clipboard and preserves linked identity',async({page,isMobile})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],right=state.book.tables.find(t=>t.id==='scope-right')!;
      s.validations.push({id:'copy-dd',sheet:s.id,rows:[s.rows[10].id,s.rows[11].id],columns:[s.columns[1].id],source:'Right[Name]'});
      s.cells[`${s.rows[10].id}:${s.columns[1].id}`]={binding:{table:right.id,row:right.rows[0],column:right.columns[0].id}};
      await store.save(state.book,state.version,'Disposable native clipboard dropdown');
    }finally{store.close();}
  });await page.reload();
  const original=(await snapshot(page)).sheets[0],binding=original.cells[`${original.rows[10].id}:${original.columns[1].id}`].binding;
  await page.locator('[data-row-select="10"] .row-index').click();await page.getByRole('button',{name:'Copy',exact:true}).click();
  await page.locator('td[data-r="10"][data-c="1"]').click();
  if(isMobile){await expect(page.locator('.cell-dropdown input')).not.toBeFocused();await page.locator('.cell-dropdown input').tap();}
  await expect(page.locator('.cell-dropdown input')).toBeFocused();
  const clipboard=await page.evaluateHandle(()=>{
    const data=new DataTransfer();document.activeElement!.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data;
  });
  await page.locator('td[data-r="11"][data-c="1"]').click();
  if(isMobile)await page.locator('.cell-dropdown input').tap();
  await expect(page.locator('.cell-dropdown input')).toBeFocused();
  await page.locator('.cell-dropdown input').evaluate((input,data)=>input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})),clipboard);
  await expect(page.locator('#error')).toBeHidden();await expect(page.locator('td[data-r="11"][data-c="1"]')).toHaveText('Right 1 Name');
  await expect.poll(async()=>{const s=(await snapshot(page)).sheets[0];return s.cells[`${s.rows[11].id}:${s.columns[1].id}`].binding;}).toEqual(binding);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('td[data-r="11"][data-c="1"]')).toHaveText('Middle 2 Name');
});
for(const grouped of [false,true])test(`whole-sheet row insertion and paste preserve both shared tables and summaries ${grouped?'with groups':'without groups'}`,async({page})=>{
  await fixture(page);
  await page.evaluate(async grouped=>{
    const storage='/src/storage.ts',model='/src/model.ts';
    const [{Store},{setInput}]=await Promise.all([import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>,import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>]),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0];
      for(const name of ['Middle','Right']){
        const table=state.book.tables.find(t=>t.name===name)!;
        for(const [i,row]of table.rows.entries()){
          setInput(state.book,s,row,table.columns[1].column,String(i+(name==='Middle'?3:7)));
          setInput(state.book,s,row,table.columns[2].column,`=${name}[@Qty]*2`);
        }
        if(grouped)s.groups.push({id:name+'-paste-group',axis:'row',kind:'summary',table:table.id,members:[...table.rows],collapsed:false,label:name});
      }
      setInput(state.book,s,s.rows[0].id,s.columns[0].id,'=SUM(D10:D14)');
      await store.save(state.book,state.version,'Disposable whole-sheet insertion');
    }finally{store.close();}
  },grouped);await page.reload();
  const before=await snapshot(page);
  await page.locator('[data-row-select="10"] .row-index').click();
  await page.locator('[data-row-select="12"] .row-index').click({modifiers:['Shift']});
  await expect(page.locator('.selection-count')).toHaveText(`${before.sheets[0].columns.length*3} cells`);
  await page.getByRole('button',{name:'Copy',exact:true}).click();
  if(grouped)await page.locator('[data-row-select="9"] [data-insert-row="10"]').click();
  else{await page.getByRole('button',{name:'Rows & columns',exact:true}).click();await page.locator('dialog [data-op="0"]').click();}
  const inserted=await snapshot(page);
  for(const name of ['Middle','Right'])expect(inserted.tables.find(t=>t.name===name)!.rows).toHaveLength(7);
  await page.getByRole('button',{name:'Paste',exact:true}).click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('td[data-r="10"][data-c="3"]')).toHaveText('6');
  await expect(page.locator('td[data-r="10"][data-c="7"]')).toHaveText('14');
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('60');
  const pasted=await snapshot(page),s=pasted.sheets[0],original=before.sheets[0];
  expect(s.cells[`${s.rows[10].id}:${s.columns[3].id}`].formula).toEqual(original.cells[`${original.rows[10].id}:${original.columns[3].id}`].formula);
  await page.locator('td[data-r="10"][data-c="2"]').click();await page.locator('#formula').fill('7');await page.locator('#formula').press('Enter');
  await expect(page.locator('td[data-r="10"][data-c="3"]')).toHaveText('14');
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('68');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('60');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('36');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect((await snapshot(page)).sheets).toEqual(before.sheets);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();
  await snapshot(page);await page.reload();
  await expect(page.locator('td[data-r="10"][data-c="3"]')).toHaveText('6');
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('60');
});
test('whole-sheet record paste repairs an interior ownership gap and an earlier dependent summary, with durable Undo',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const storage='/src/storage.ts',model='/src/model.ts';
    const [{Store},{addRow,setInput,clone}]=await Promise.all([import(/* @vite-ignore */storage) as Promise<typeof import('../../src/storage')>,import(/* @vite-ignore */model) as Promise<typeof import('../../src/model')>]),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],table=state.book.tables.find(t=>t.name==='Middle')!;
      for(const [i,row]of table.rows.entries()){setInput(state.book,s,row,table.columns[1].column,String(i+3));setInput(state.book,s,row,table.columns[2].column,'=Middle[@Qty]*2');}
      setInput(state.book,s,s.rows[0].id,s.columns[0].id,'=SUM(D10:D14)');
      const source=s.rows[10].id,row=addRow(state.book,s,11);
      for(const column of s.columns)s.cells[`${row.id}:${column.id}`]=clone(s.cells[`${source}:${column.id}`]??{});
      await store.save(state.book,state.version,'Disposable legacy sheet-row membership gap');
    }finally{store.close();}
  });await page.reload();
  await expect(page.locator('td[data-r="11"][data-c="3"]')).toHaveText('#VALUE!');
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('#VALUE!');
  const before=await snapshot(page);
  await page.locator('[data-row-select="10"] .row-index').click();await page.getByRole('button',{name:'Copy',exact:true}).click();
  await page.locator('[data-row-select="11"] .row-index').click();await page.getByRole('button',{name:'Paste',exact:true}).click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('td[data-r="11"][data-c="3"]')).toHaveText('6');
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('42');
  for(const name of ['Middle','Right'])expect((await snapshot(page)).tables.find(t=>t.name===name)!.rows).toHaveLength(5);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect((await snapshot(page)).sheets).toEqual(before.sheets);
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('#VALUE!');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await snapshot(page);await page.reload();
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('42');
});
for(const axis of ['row','column'] as const)test(`sheet ${axis} selection remains visible over compacted tables and custom fills`,async({page})=>{
  await groupFixture(page,axis,true);
  const source=axis==='row'?{r:13,c:1}:{r:9,c:4},slot=axis==='row'?12:3;
  await page.evaluate(async source=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets[0],key=`${s.rows[source.r].id}:${s.columns[source.c].id}`;s.cells[key].format={background:'#ffffff'};await store.save(state.book,state.version,'Disposable selected fill');}finally{store.close();}
  },source);await page.reload();
  const cell=page.locator(`td[data-r="${source.r}"][data-c="${source.c}"]`);
  await page.locator(axis==='row'?`[data-row-select="${slot}"] .row-index`:`th[data-col="${slot}"] .column-index`).click();
  await expect(page.locator('#selection-scope-label')).toHaveText('Sheet selection');
  await expect(cell).toHaveClass(/selected/);
  await expect(cell).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(cell).not.toHaveCSS('background-image','none');
  await page.getByRole('button',{name:'Pin selected columns',exact:true}).click();
  await expect(cell).toHaveClass(/selected/);
  await page.locator('td[data-r="0"][data-c="0"]').click();
  await expect(cell).not.toHaveClass(/selected/);await expect(cell).toHaveCSS('background-image','none');
  await expect(cell).toHaveCSS('background-color','rgb(255, 255, 255)');
});
for(const collapsed of [false,true])test(`sheet-row drops into ${collapsed?'compacted':'expanded'} table groups do not jump or change unintended records`,async({page})=>{
  await fixture(page,180);
  await page.evaluate(async collapsed=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],owner=state.book.tables.find(t=>t.id==='scope-middle')!;
      state.book.tables=state.book.tables.filter(t=>!['scope-top','scope-bottom'].includes(t.id));
      owner.rows=s.rows.slice(10,170).map(row=>row.id);
      owner.rows.forEach((row,i)=>owner.columns.forEach(field=>s.cells[`${row}:${field.column}`]={value:`Record ${i} ${field.name}`}));
      s.groups=[{id:'sheet-drop-target',axis:'row',kind:'summary',table:owner.id,members:s.rows.slice(140,143).map(row=>row.id),collapsed,label:'Destination'}];
      await store.save(state.book,state.version,'Disposable deep group move');
    }finally{store.close();}
  },collapsed);await page.reload();
  const scroller=page.locator('#grid-scroll');await scroller.evaluate(el=>{el.scrollTop=33*135;});
  await page.locator('[data-row-select="147"] .row-index').click();
  const top=await scroller.evaluate(el=>el.scrollTop),before=await snapshot(page);
  const target=page.locator('.grid .group-control[data-group-id="sheet-drop-target"]'),rect=(await target.boundingBox())!;
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await page.locator('[data-move-row="147"]').dispatchEvent('dragstart',{dataTransfer:transfer});
  await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2});
  await target.dispatchEvent('drop',{dataTransfer:transfer,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2});
  await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBe(top);
  const after=await snapshot(page);
  if(collapsed){
    await expect(page.locator('#error')).toContainText('Turn on Table selection');
    expect(after.sheets[0].cells).toEqual(before.sheets[0].cells);expect(after.sheets[0].groups).toEqual(before.sheets[0].groups);
  }else{
    await expect(page.locator('#error')).toBeHidden();
    expect(after.sheets[0].groups[0].members).toHaveLength(4);
    const neighbor=(book:typeof before)=>Object.fromEntries(Object.entries(book.sheets[0].cells).filter(([key])=>before.sheets[0].columns.slice(5).some(column=>key.endsWith(':'+column.id))));
    expect(neighbor(after)).toEqual(neighbor(before));
    await page.getByRole('button',{name:'Undo',exact:true}).click();const undone=await snapshot(page);
    expect(undone.sheets[0].cells).toEqual(before.sheets[0].cells);expect(undone.sheets[0].groups).toEqual(before.sheets[0].groups);
  }
});
test('Auto table selection without an owning table can both expand and collapse a group with durable Undo',async({page})=>{
  await groupFixture(page,'row',true);
  const before=await snapshot(page);
  await page.getByRole('button',{name:'Table-constrained header selection',exact:true}).click();
  await chooseTarget(page,'');
  await page.locator('td[data-r="0"][data-c="0"]').click();
  await page.getByRole('button',{name:'Expand Middle 2 Name rows in Middle',exact:true}).click();
  await expect(page.getByRole('button',{name:'Collapse Middle 2 Name rows in Middle',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Collapse Middle 2 Name rows in Middle',exact:true}).click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.getByRole('button',{name:'Expand Middle 2 Name rows in Middle',exact:true})).toBeVisible();
  const after=await snapshot(page);
  expect(after.sheets[0].groups.find(group=>group.id==='scoped-inner')!.collapsed).toBe(true);
  expect(after.sheets.map(sheet=>sheet.cells)).toEqual(before.sheets.map(sheet=>sheet.cells));
  await page.locator('[data-action="undo"]').click();
  await expect(page.getByRole('button',{name:'Collapse Middle 2 Name rows in Middle',exact:true})).toBeVisible();
  await page.locator('[data-action="redo"]').click();
  await expect(page.getByRole('button',{name:'Expand Middle 2 Name rows in Middle',exact:true})).toBeVisible();
  await snapshot(page);await page.reload();
  await expect(page.getByRole('button',{name:'Expand Middle 2 Name rows in Middle',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Table-constrained header selection',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('hypo visibility compacts only tagged table records and fields without changing stored data',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets[0];s.rows[10].hypotheticalTables={'scope-middle':true};s.columns[2].hypotheticalTables={'scope-middle':true};await store.save(state.book,state.version,'Disposable table hypo compaction');}finally{store.close();}
  });
  await page.reload();const before=await snapshot(page);
  await page.locator('[data-action="hypothetical-visibility"]').click();
  const moved=page.locator('td[data-r="11"][data-c="3"]');
  await expect(moved).toHaveText('Middle 2 Note');
  await expect(moved).toHaveAttribute('data-display-r','10');
  await expect(moved).toHaveAttribute('data-display-c','2');
  await expect(page.locator('td[data-r="10"][data-c="1"],td[data-r="11"][data-c="2"]')).toHaveCount(0);
  await expect(page.locator('td[data-r="10"][data-c="5"]')).toHaveText('Right 1 Name');
  await expect(page.locator('td[data-r="10"][data-c="5"]')).toHaveAttribute('data-display-r','10');
  expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  await page.locator('[data-action="hypothetical-visibility"]').click();
  await expect(moved).toHaveAttribute('data-display-r','11');
  await expect(moved).toHaveAttribute('data-display-c','3');
});
test('direct group controls cannot toggle a neighboring table while selection is locked elsewhere',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],right=state.book.tables.find(table=>table.id==='scope-right')!;
      s.groups.push({id:'right-summary',axis:'row',table:right.id,kind:'summary',members:right.rows.slice(0,3),collapsed:false,label:'Right details'});
      await store.save(state.book,state.version,'Synthetic neighboring table outline');
    }finally{store.close();}
  });
  await page.reload();await chooseTarget(page,'scope-middle');await page.locator('[data-row-select="10"] .row-index').click();
  await page.getByRole('button',{name:'Collapse Right 1 Name rows in Right',exact:true}).click();
  await expect(page.locator('#error')).toContainText('another table or sheet scope');
  expect((await snapshot(page)).sheets[0].groups.find(group=>group.id==='right-summary')!.collapsed).toBe(false);
  await chooseTarget(page,'scope-right');await page.locator('th[data-col="6"] .column-index').click();
  await page.getByRole('button',{name:'Collapse Right 1 Name rows in Right',exact:true}).click();
  expect((await snapshot(page)).sheets[0].groups.find(group=>group.id==='right-summary')!.collapsed).toBe(true);
});
async function insertOne(page:Page){
  await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
  await page.getByRole('button',{name:'Insert row above',exact:true}).click();
}
for(const axis of ['row','column'] as const)for(const kind of ['summary','range'] as const){
  test(`toolbar ${kind} ${axis} toggle creates and removes only the selected table group`,async({page,isMobile})=>{
    await fixture(page);const before=await snapshot(page);
    await scopedSelection(page,axis,isMobile);
    const toggle=page.locator(kind==='summary'?'button[data-action="summary-group"]':'button[data-action="plain-group"]');
    await expect(toggle).toHaveAttribute('aria-pressed','false');
    const styling=(button:HTMLElement)=>{
      const style=getComputedStyle(button);
      return Object.fromEntries(['width','height','min-height','padding','border-radius','display','align-items','justify-content','gap'].map(property=>[property,style.getPropertyValue(property)]));
    };
    expect(await toggle.evaluate(styling)).toEqual(await page.getByRole('button',{name:'Add/remove Hypo tag',exact:true}).evaluate(styling));
    await activate(toggle,isMobile);const grouped=await snapshot(page);
    const group=grouped.sheets[0].groups.find(group=>group.table==='scope-middle')!;
    expect(group).toMatchObject({axis,kind,collapsed:false});
    expect(grouped.sheets[0].cells).toEqual(before.sheets[0].cells);
    expect(grouped.tables).toEqual(before.tables);
    await expect(toggle).toHaveAttribute('aria-pressed','true');
    await page.reload();await expect(toggle).toHaveAttribute('aria-pressed','true');
    await activate(toggle,isMobile);
    expect((await snapshot(page)).sheets[0].groups).toEqual(before.sheets[0].groups);
    await expect(toggle).toHaveAttribute('aria-pressed','false');
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    expect((await snapshot(page)).sheets[0].groups).toContainEqual(group);
    await expect(toggle).toHaveAttribute('aria-pressed','true');
  });
}
for(const axis of ['row','column'] as const)for(const occupied of [false,true]){
  test(`table ${axis} insertion preserves both scroll offsets with ${occupied?'confirmed collision':'blank formatting and validation'}`,async({page})=>{
    await fixture(page,90);
    await page.evaluate(async({axis,occupied})=>{
      const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
      try{
        const state=(await store.load())!,s=state.book.sheets[0],row=s.rows[axis==='row'?7:4].id,column=s.columns[axis==='row'?1:4].id;
        s.cells[`${row}:${column}`]={value:occupied?'Keep neighboring content':'',format:{wrap:false}};
        s.validations.push({id:'empty-growth-rule',sheet:s.id,rows:[row],columns:[column],values:['one','two'],source:''});
        await store.save(state.book,state.version,'Synthetic table-growth metadata');
      }finally{store.close();}
    },{axis,occupied});
    await page.reload();await chooseTarget(page,'scope-top');
    await page.locator(axis==='row'?'[data-row-select="4"] .row-index':'th[data-col="2"] .column-index').click();
    await page.addStyleTag({content:'#grid-scroll{max-width:280px}'});
    const grid=page.locator('#grid-scroll');
    await grid.evaluate(el=>{el.scrollTop=410;el.scrollLeft=130;el.dispatchEvent(new Event('scroll'));});
    const before=await grid.evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));
    expect(before.top).toBeGreaterThan(0);expect(before.left).toBeGreaterThan(0);
    await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
    await page.getByRole('button',{name:axis==='row'?'Insert row above':'Insert column left',exact:true}).click();
    if(occupied){await expect(page.locator('.table-expansion-dialog')).toBeVisible();await page.locator('#confirm-table-expansion').click();}
    else await expect(page.locator('.table-expansion-dialog')).toHaveCount(0);
    await snapshot(page);
    await expect.poll(()=>grid.evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}))).toEqual(before);
  });
}
test('occupied growth asks before shifting, omits formula text when unaffected, and skips exactly the requested times',async({page})=>{
  await collision(page,false);const before=await snapshot(page);
  await insertOne(page);const d=page.locator('.table-expansion-dialog');
  await expect(d).toContainText('1 row');await expect(d.locator('.formula-impact')).toHaveCount(0);
  await page.locator('#cancel-table-expansion').click();expect((await snapshot(page)).sheets).toEqual(before.sheets);
  await insertOne(page);await page.locator('#skip-table-expansion').check();await page.locator('#skip-table-expansion-count').fill('2');
  await page.locator('#confirm-table-expansion').click();
  for(let i=0;i<2;i++){await insertOne(page);await expect(page.locator('.table-expansion-dialog')).toHaveCount(0);await snapshot(page);}
  const after=await snapshot(page);expect(after.tables.find(table=>table.id==='scope-top')!.rows).toHaveLength(7);
  expect(after.sheets[0].cells[`${before.sheets[0].rows[7].id}:${before.sheets[0].columns[1].id}`].value).toBe('Note below Pantry');
  await insertOne(page);await expect(page.locator('.table-expansion-dialog')).toBeVisible();await page.locator('#cancel-table-expansion').click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshot(page)).tables.find(table=>table.id==='scope-top')!.rows).toHaveLength(6);
});
test('shift confirmation audits actual broken formulas and previews surrounding cells before and after',async({page})=>{
  await collision(page,true);const before=await snapshot(page);await insertOne(page);
  const d=page.locator('.table-expansion-dialog'),card=d.locator('.formula-context-card').filter({hasText:'Would break'}).first();
  await expect(card).toBeVisible();await expect(card.locator('.context-focus')).not.toHaveText('#CYCLE!');
  await expect(card.locator('.formula-context-grid td')).toHaveCount(9);
  await card.getByRole('button',{name:'After',exact:true}).click();await expect(card.locator('.context-error')).toHaveText('#CYCLE!');
  await expect(card.locator('.formula-context-expression')).toContainText('INDIRECT');
  await page.locator('#cancel-table-expansion').click();expect((await snapshot(page)).sheets).toEqual(before.sheets);
});
test('table headers remain sticky through virtual scrolling, align horizontally and disappear after the last row',async({page})=>{
  await fixture(page,90);
  await page.evaluate(async()=>{
    const storage='/src/storage.ts',{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage');
    const store=await Store.open();try{
      const state=(await store.load())!,book=state.book,s=book.sheets[0],top=book.tables.find(table=>table.id==='scope-top')!;
      book.tables=book.tables.filter(table=>!['scope-middle','scope-bottom'].includes(table.id));
      top.rows=s.rows.slice(3,60).map(row=>row.id);await store.save(book,state.version,'Synthetic long table');
    }finally{store.close();}
  });
  await page.reload();const grid=page.locator('#grid-scroll');
  await grid.evaluate(el=>el.scrollTop=40*33+5);
  const header=page.locator('.sticky-table-header[data-table="scope-top"]').first();
  await expect(header).toBeVisible();await expect(page.locator('td[data-r="2"][data-c="1"]')).toHaveCount(0);
  const alignment=await header.evaluate(button=>{
    const grid=button.closest('#grid-scroll')!,column=button.getAttribute('data-column'),headers=[...grid.querySelectorAll<HTMLElement>('.grid thead [data-col]')],target=headers.find(el=>el.textContent?.trim().startsWith('B'))!;
    return{top:Math.abs(button.getBoundingClientRect().top-grid.querySelector('thead')!.getBoundingClientRect().bottom),left:Math.abs(button.getBoundingClientRect().left-target.getBoundingClientRect().left),column};
  });
  expect(alignment.top).toBeLessThan(2);expect(alignment.left).toBeLessThan(2);
  await grid.evaluate(el=>{
    const edge=el.querySelector('thead')!.getBoundingClientRect().bottom;
    const row=[...el.querySelectorAll<HTMLElement>('tbody th')].find(th=>th.getBoundingClientRect().bottom>edge)!;
    const rect=row.getBoundingClientRect();el.scrollTop+=rect.top-edge+rect.height/2;
  });
  await expect.poll(()=>grid.evaluate(el=>{const edge=el.querySelector('thead')!.getBoundingClientRect().bottom;return[...el.querySelectorAll<HTMLElement>('tbody th')].some(th=>{const rect=th.getBoundingClientRect();return rect.top<edge-5&&rect.bottom>edge;});})).toBe(true);
  const layering=await grid.evaluate(el=>{
    const head=el.querySelector<HTMLElement>('thead')!,edge=head.getBoundingClientRect().bottom;
    const row=[...el.querySelectorAll<HTMLElement>('tbody th')].find(th=>{
      const r=th.getBoundingClientRect();return r.top<edge-5&&r.bottom>edge;
    })!;
    row.querySelector<HTMLButtonElement>('button')!.focus({preventScroll:true});
    const corner=head.querySelector<HTMLElement>('.corner')!,r=corner.getBoundingClientRect();
    const header=el.querySelector<HTMLElement>('.sticky-table-header[data-table="scope-top"]')!,h=header.getBoundingClientRect();
    return{
      focusedRow:row.matches(':focus-within'),
      columnHeaderOnTop:!!document.elementFromPoint(r.right-5,edge-4)?.closest('thead'),
      tableHeaderOnTop:document.elementFromPoint(h.left+h.width/2,h.top+5)===header
    };
  });
  expect(layering).toEqual({focusedRow:true,columnHeaderOnTop:true,tableHeaderOnTop:true});
  await grid.evaluate(el=>el.scrollTop=58*33+5);await expect(page.locator('td[data-r="59"][data-c="1"]')).toBeAttached();
  await grid.evaluate(el=>{const last=el.querySelector('td[data-r="59"][data-c="1"]')!;el.scrollTop+=last.getBoundingClientRect().bottom-el.querySelector('thead')!.getBoundingClientRect().bottom+1;});
  await expect(page.locator('.sticky-table-header[data-table="scope-top"]')).toHaveCount(0);
});
test('native table headers anchor before redraw with scoped compaction, wrapped rows, horizontal pins and retained focus',async({page})=>{
  await fixture(page,100);
  await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=book.sheets[0],top=book.tables.find(t=>t.id==='scope-top')!,right=book.tables.find(t=>t.id==='scope-right')!;
      book.tables=book.tables.filter(t=>!['scope-middle','scope-bottom','scope-far-right'].includes(t.id));
      top.rows=s.rows.slice(3,65).map(r=>r.id);right.rows=s.rows.slice(10,70).map(r=>r.id);
      s.columns.forEach(c=>c.width=160);
      s.groups.push({id:'native-summary',axis:'row',kind:'summary',table:top.id,members:s.rows.slice(4,9).map(r=>r.id),collapsed:true,label:'Keep scoped grouping'});
      s.cells[`${s.rows[40].id}:${s.columns[3].id}`]={value:'Wrapped header geometry '.repeat(20),format:{wrap:true}};
      await store.save(book,state.version,'Synthetic native sticky geometry');
    }finally{store.close();}
  });
  await page.reload();await page.locator('th[data-col="1"] .column-index').click();await page.locator('[data-action="pin"]').click();
  const grid=page.locator('#grid-scroll');await grid.evaluate(el=>{el.scrollTop=30*33;el.scrollLeft=450;});
  const header=page.locator('.sticky-table-header[data-table="scope-top"]').first(),right=page.locator('.sticky-table-header[data-table="scope-right"]').first();
  await expect(header).toBeVisible();await expect(right).toBeVisible();await header.focus();
  const samples=await grid.evaluate(async el=>{
    const samples:{top:number;left:number;focused:boolean}[]=[];
    for(const change of [180,-120,160,-80]){
      el.scrollTop+=change;
      const button=el.querySelector<HTMLElement>('.sticky-table-header[data-table="scope-top"]')!,head=el.querySelector<HTMLElement>('thead [data-col="1"]')!;
      samples.push({top:button.getBoundingClientRect().top-el.querySelector('thead')!.getBoundingClientRect().bottom,left:button.getBoundingClientRect().left-head.getBoundingClientRect().left,focused:document.activeElement===button});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }
    return samples;
  });
  expect(samples.every(s=>Math.abs(s.top)<2&&Math.abs(s.left)<2&&s.focused)).toBe(true);
  expect(await header.evaluate(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===button;})).toBe(true);
  await page.screenshot({path:test.info().outputPath('native-sticky-painted.png')});
  await header.click();await expect(page.locator('#formula')).toHaveValue('Name');
  await header.dblclick();await expect(page.locator('#answer')).toBeVisible();await page.locator('#answer').fill('Stable header');await page.locator('#answer').press('Enter');
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  const restored=await snapshot(page);expect(restored.tables.find(t=>t.id==='scope-top')!.columns[0].name).toBe('Name');
  expect(restored.sheets[0].groups.find(g=>g.id==='native-summary')).toMatchObject({table:'scope-top',collapsed:true});
});
test('native sticky header remains the touch target after vertical and pinned horizontal scrolling',async({browser})=>{
  const context=await browser.newContext({baseURL:test.info().project.use.baseURL,viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    const page=await context.newPage();await fixture(page,90);
    await page.locator('th[data-col="1"] .column-index').tap();await page.locator('[data-action="pin"]').tap();
    await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=130;el.scrollLeft=180;});
    const header=page.locator('.sticky-table-header[data-table="scope-top"]').first();await expect(header).toBeVisible();await header.tap();
    await expect(page.locator('#formula')).toHaveValue('Name');await expect(page.locator('.formula-bar .address')).toHaveText('B3');
  }finally{await context.close();}
});
