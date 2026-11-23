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
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await page.getByRole('switch',{name:'Tree view',exact:true}).click();
  await expect(nested).toHaveCSS('--summary-text-inset','24px');await expect(page.locator('.row-outline-rail')).toHaveCount(0);
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
    await expect(page.locator(neighbor)).toHaveClass(/scoped-hidden/);
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
  await page.getByRole('button',{name:'Collapse Right details rows in Right',exact:true}).click();
  await expect(page.locator('#error')).toContainText('another table or sheet scope');
  expect((await snapshot(page)).sheets[0].groups.find(group=>group.id==='right-summary')!.collapsed).toBe(false);
  await chooseTarget(page,'scope-right');await page.locator('th[data-col="6"] .column-index').click();
  await page.getByRole('button',{name:'Collapse Right details rows in Right',exact:true}).click();
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
    const toggle=page.getByRole('button',{name:`Create/remove ${kind==='summary'?'summary':'plain'} group`,exact:true});
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
  await grid.evaluate(el=>el.scrollTop=58*33+5);await expect(page.locator('td[data-r="59"][data-c="1"]')).toBeAttached();
  await grid.evaluate(el=>{const last=el.querySelector('td[data-r="59"][data-c="1"]')!;el.scrollTop+=last.getBoundingClientRect().bottom-el.querySelector('thead')!.getBoundingClientRect().bottom+1;});
  await expect(page.locator('.sticky-table-header[data-table="scope-top"]')).toHaveCount(0);
});
