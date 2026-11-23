import {expect,test,type Page} from '@playwright/test';

async function snapshot(page:Page){
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
}
async function fixture(page:Page,narrowHeaders=false){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async(narrow)=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0];
      s.groups=[
        {id:'outer',axis:'row',kind:'summary',members:s.rows.slice(1,10).map(r=>r.id),collapsed:false,label:'Outer'},
        {id:'inner',axis:'row',kind:'summary',members:s.rows.slice(3,7).map(r=>r.id),collapsed:false,label:'Inner'},
        {id:'leaf',axis:'row',kind:'summary',members:s.rows.slice(4,6).map(r=>r.id),collapsed:false,label:'Leaf'},
        {id:'separate',axis:'row',kind:'summary',members:s.rows.slice(15,20).map(r=>r.id),collapsed:false,label:'Separate'},
        {id:'plain-row',axis:'row',kind:'range',members:s.rows.slice(10,12).map(r=>r.id),collapsed:false,label:'Notes'},
        {id:'col-outer',axis:'column',kind:'summary',members:s.columns.slice(0,9).map(c=>c.id),collapsed:false,label:'Nutrition'},
        {id:'col-inner',axis:'column',kind:'summary',members:s.columns.slice(1,3).map(c=>c.id),collapsed:false,label:'Macros'},
        {id:'plain-col',axis:'column',kind:'range',members:s.columns.slice(3,5).map(c=>c.id),collapsed:false,label:'Extras'}
      ];
      for(const i of [1,2,3,4,5,6,7,8,9,15,16,17,18,19]){
        const value=({1:'Outer summary',3:'Inner summary',4:'Leaf summary',5:'Nested detail',7:'Last direct child',15:'Separate summary',16:'Independent detail'} as Record<number,string>)[i]??'';
        s.cells[`${s.rows[i].id}:${s.columns[0].id}`]={value};
      }
      if(narrow){s.columns[0].width=40;s.columns[2].width=40;}
      const notes=state.book.sheets.find(s=>s.name==='Notebook')!;
      notes.groups=[{id:'notebook-group',axis:'row',kind:'summary',members:notes.rows.slice(1,3).map(r=>r.id),collapsed:false,label:'Notebook notes'}];
      await store.save(state.book,state.version,'Synthetic outlines');
    }finally{store.close();}
  },narrowHeaders);
  await page.reload();await expect(page.locator('.group-menu-button')).toBeVisible();
  return snapshot(page);
}
async function menu(page:Page){
  if(!await page.locator('.group-popover').count())await page.getByRole('button',{name:'Group controls',exact:true}).click();
  return page.locator('.group-popover');
}
test('group popover keeps its anchor after toggles with a rearranged and scrolled toolbar',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;state.book.toolbarOrder=['action:undo','action:redo','action:table-selection'];await store.save(state.book,state.version,'Synthetic rearranged group control');}finally{store.close();}
  });
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  await page.locator('.toolbar').evaluate(el=>{el.scrollLeft=40;});
  const popup=await menu(page),before=(await popup.boundingBox())!,scroll=await page.locator('.toolbar').evaluate(el=>el.scrollLeft);
  for(const name of ['Tree view','Plain group hints']){
    await popup.getByRole('switch',{name,exact:true}).click();
    const after=(await popup.boundingBox())!;expect(after.x).toBeCloseTo(before.x,0);expect(after.y).toBeCloseTo(before.y,0);
    expect(await page.locator('.toolbar').evaluate(el=>el.scrollLeft)).toBe(scroll);
  }
  await popup.locator('[data-outline-axis="row"][data-outline-level="0"]').click();
  const after=(await popup.boundingBox())!;expect(after.x).toBeCloseTo(before.x,0);expect(after.y).toBeCloseTo(before.y,0);
});
test('thousands of table rows with hundreds of summary groups remain responsive',async({page})=>{
  test.setTimeout(30000);
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets[0],table=state.book.tables.find(t=>t.sheet===sheet.id)!;
      const header=sheet.rows.find(row=>row.id===table.header)!;
      sheet.rows=[header,...Array.from({length:5000},(_,i)=>({id:`large-row-${i}`}))];table.rows=sheet.rows.slice(1).map(row=>row.id);
      sheet.cells=Object.fromEntries(Object.entries(sheet.cells).filter(([address])=>address.startsWith(header.id+':')));sheet.validations=[];
      sheet.groups=Array.from({length:250},(_,i)=>({id:`large-group-${i}`,axis:'row' as const,kind:'summary' as const,table:table.id,members:table.rows.slice(i*20,i*20+20),collapsed:false,label:`Synthetic group ${i}`}));
      await store.save(state.book,state.version,'Large synthetic table outlines');
    }finally{store.close();}
  });
  const start=Date.now();await page.reload();
  await expect(page.locator('td[data-r="1"] .table-group-controls')).toBeVisible();
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await expect(page.locator('.group-popover')).toBeVisible();
  expect(Date.now()-start).toBeLessThan(15000);
});
test('moving a nested two-row group outside its parents trims old memberships and rails, with reload and undo',async({page})=>{
  const before=await fixture(page),s=before.sheets[0],members=s.groups.find(g=>g.id==='leaf')!.members;
  await (await menu(page)).getByRole('switch',{name:'Tree view',exact:true}).click();
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await page.locator('[data-row-select="4"] .row-index').click();
  await page.locator('[data-move-row="4"]').click();
  await expect(page.locator('td[data-c="0"].moving')).toHaveCount(2);
  await page.locator('[data-insert-row="13"]').click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const after=await snapshot(page),moved=after.sheets[0],own=moved.groups.find(g=>g.id==='leaf')!;
  expect(own.members).toEqual(members);
  for(const id of ['outer','inner'])expect(moved.groups.find(g=>g.id===id)!.members.some(id=>members.includes(id))).toBe(false);
  expect(moved.cells).toEqual(s.cells);
  const anchor=moved.rows.findIndex(r=>r.id===members[0]),last=moved.rows.findIndex(r=>r.id===members[1]);
  await expect(page.locator(`td[data-r="${anchor}"][data-c="0"] .row-outline-rail[data-group-id="outer"]`)).toHaveCount(0);
  await expect(page.locator(`td[data-r="${last}"][data-c="0"] .row-outline-rail[data-group-id="leaf"]`)).toHaveClass(/outline-end/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshotAfterSave(page)).sheets[0].groups).toEqual(s.groups);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();expect((await snapshot(page)).sheets[0].groups).toEqual(moved.groups);
  await expect(page.locator(`td[data-r="${last}"][data-c="0"] .row-outline-rail[data-group-id="leaf"]`)).toHaveClass(/outline-end/);
});
async function snapshotAfterSave(page:Page){await expect(page.locator('#save-state')).toContainText(/^Saved/);return snapshot(page);}
test('expanded row groups keep full-width boundary strokes and cancel without changes',async({page})=>{
  const before=await fixture(page);
  await page.locator('[data-row-select="13"] .row-index').click();await page.locator('[data-move-row="13"]').click();
  await page.locator('[data-insert-row="4"]').hover();
  await expect(page.locator('.move-drop-guide[data-axis="row"]')).toHaveCount(1);
  await expect(page.locator('td[data-r="3"][data-c="0"]')).toHaveAttribute('data-drop-group','inner');
  await page.locator('[data-insert-row="13"]').hover();
  await expect(page.locator('.group-drop-target')).toHaveCount(0);
  const guide=page.locator('.move-drop-guide[data-axis="row"]');await expect(guide).toHaveCount(1);
  expect(await guide.evaluate(el=>Math.abs(el.getBoundingClientRect().width-document.querySelector('.grid')!.getBoundingClientRect().width))).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
test('expanded column groups keep full-height boundary strokes',async({page})=>{
  await fixture(page);
  await page.locator('th[data-col="9"] .column-index').click();await page.locator('[data-move-column="9"]').click();
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollLeft=0;});
  await page.locator('[data-insert-column="2"]').hover();
  await expect(page.locator('.move-drop-guide[data-axis="column"]')).toHaveCount(1);
  await expect(page.locator('td[data-r="0"][data-c="1"]')).toHaveAttribute('data-drop-group','col-inner');
  await page.locator('[data-insert-column="9"]').hover();
  await expect(page.locator('.group-drop-target')).toHaveCount(0);
  const guide=page.locator('.move-drop-guide[data-axis="column"]');await expect(guide).toHaveCount(1);
  expect(await guide.evaluate(el=>Math.abs(el.getBoundingClientRect().height-document.querySelector('.grid')!.getBoundingClientRect().height))).toBeLessThan(1);
  await page.keyboard.press('Escape');await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
});
test('native body drops retain precise boundaries inside expanded groups and preserve formula identities',async({page})=>{
  const before=await fixture(page);
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await page.locator('[data-move-row="13"]').dispatchEvent('dragstart',{dataTransfer:transfer});
  const target=page.locator('td[data-r="4"][data-c="0"]'),rect=await target.boundingBox();
  await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:rect!.x+10,clientY:rect!.y+2});
  await expect(page.locator('.move-drop-guide[data-axis="row"]')).toHaveCount(1);
  await expect(page.locator('td[data-r="3"][data-c="0"]')).toHaveAttribute('data-drop-group','inner');
  await target.dispatchEvent('drop',{dataTransfer:transfer});
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
  const after=(await snapshot(page)).sheets[0],id=before.sheets[0].rows[13].id;
  expect(after.rows[4].id).toBe(id);expect(after.groups.find(g=>g.id==='inner')!.members).toContain(id);
  expect(after.cells).toEqual(before.sheets[0].cells);
});
test('collapsed row targets show only a highlight and accept whole blocks without expanding',async({page})=>{
  const before=await fixture(page);
  await page.locator('.summary-chevron[data-group-id="inner"]').click();
  await page.locator('[data-row-select="13"] .row-index').click();await page.locator('[data-move-row="13"]').click();
  await page.locator('[data-insert-row="4"]').hover();
  await expect(page.locator('td[data-r="3"][data-c="0"]')).toHaveAttribute('data-drop-group','inner');
  await expect(page.locator('.move-drop-guide')).toHaveCount(0);
  await page.locator('[data-insert-row="4"]').click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const id=before.sheets[0].rows[13].id;
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups.find(g=>g.id==='inner')).toMatchObject({collapsed:true,members:expect.arrayContaining([id])});
  const saved=(await snapshot(page)).sheets[0];
  expect(saved.groups.find(g=>g.id==='outer')!.members).toContain(id);
  expect(saved.cells).toEqual(before.sheets[0].cells);
  await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
});
test('collapsed column targets show no stroke and accept native drops without expanding',async({page})=>{
  const before=await fixture(page);
  await page.locator('.column-summary-controls [data-group-id="col-inner"]').click();
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await page.locator('[data-move-column="9"]').dispatchEvent('dragstart',{dataTransfer:transfer});
  const target=page.locator('td[data-r="0"][data-c="1"]'),rect=await target.boundingBox();
  await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:rect!.x+rect!.width/2,clientY:rect!.y+rect!.height/2});
  await expect(target).toHaveAttribute('data-drop-group','col-inner');
  await expect(page.locator('.move-drop-guide')).toHaveCount(0);
  await target.dispatchEvent('drop',{dataTransfer:transfer});
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const after=(await snapshot(page)).sheets[0],id=before.sheets[0].columns[9].id;
  expect(after.groups.find(g=>g.id==='col-inner')).toMatchObject({collapsed:true,members:expect.arrayContaining([id])});
  expect(after.cells).toEqual(before.sheets[0].cells);
  await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
});
test('left chevrons retain summaries, independent branches, plain hints and formula identities',async({page})=>{
  const before=await fixture(page);
  await expect(page.locator('tr[data-row="1"] td:first-of-type [data-group-id="outer"]')).toBeVisible();
  await expect(page.locator('tbody th .row-group-controls')).toHaveCount(0);
  expect(await page.locator('.grid col').first().evaluate(el=>el.getBoundingClientRect().width)).toBe(78);
  await expect(page.locator('th[data-col="2"] .plain-group-hints [data-group-id="plain-col"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="outer"]').click();
  await expect(page.locator('[data-row-select="1"]')).toBeVisible();await expect(page.locator('[data-row-select="3"]')).toHaveCount(0);
  await expect(page.locator('[data-row-select="15"]')).toHaveCount(1);
  await expect(page.locator('tr[data-row="1"] td:first-of-type .row-plain-hints [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="plain-row"]').click();
  await expect(page.locator('.grid [data-group-id="plain-row"] path[d="M3 3l18 18"]')).toHaveCount(1);
  await expect(page.locator('[data-row-select="10"],[data-row-select="11"]')).toHaveCount(0);
  await expect(page.locator('.grid [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="col-outer"]').click();
  await expect(page.locator('th[data-col="0"]')).toHaveCount(1);await expect(page.locator('th[data-col="2"]')).toHaveCount(0);
  await expect(page.locator('th[data-col="0"] .plain-group-hints [data-group-id="plain-col"]')).toBeVisible();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  await page.reload();await expect(page.locator('.grid [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="outer"]').click();await expect(page.locator('[data-row-select="3"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-row-select="3"]')).toHaveCount(0);
});
test('left chevrons connect nested buttons and keep centered terminal caps through virtual scrolling and edits',async({page})=>{
  await fixture(page);await menu(page);await page.getByRole('switch',{name:'Tree view',exact:true}).click();
  await page.keyboard.press('Escape');
  const geometry=await page.locator('.grid').evaluate(table=>{
    const buttons=[...table.querySelectorAll<HTMLElement>('.summary-chevron')];
    const outlined=buttons.every(button=>{const style=getComputedStyle(button);return style.borderLeftStyle==='solid'&&parseFloat(style.borderLeftWidth)>0&&style.borderLeftColor!=='rgba(0, 0, 0, 0)';});
    const leftOfText=buttons.every(button=>{const text=button.closest('td')!.querySelector<HTMLElement>('.cell-display')!;return button.getBoundingClientRect().right<=text.getBoundingClientRect().left+parseFloat(getComputedStyle(text).paddingLeft);});
    const inner=table.querySelector('[data-group-id="inner"].summary-chevron')!.getBoundingClientRect(),branch=table.querySelector('tr[data-row="3"] .row-outline-rail[data-group-id="outer"] .row-outline-branch')!.getBoundingClientRect();
    return {outlined,leftOfText,connection:Math.abs(branch.right-inner.left),counts:buttons.some(b=>b.textContent?.trim()),glyphs:buttons.map(b=>b.querySelector('svg')!.getBoundingClientRect().width)};
  });
  expect(geometry.outlined).toBe(true);expect(geometry.leftOfText).toBe(true);expect(geometry.connection).toBeLessThan(1);expect(geometry.counts).toBe(false);expect(geometry.glyphs.every(n=>n===14)).toBe(true);
  const terminal=page.locator('.grid .row-outline-rail[data-group-id="outer"].outline-end');
  const measure=()=>terminal.evaluate(rail=>{
    const row=rail.closest('tr')!.getBoundingClientRect(),r=rail.getBoundingClientRect(),branch=rail.querySelector('.row-outline-branch')!.getBoundingClientRect();
    return {row:rail.closest('tr')!.dataset.row,center:Math.abs(branch.top-row.top-row.height/2),end:Math.abs(r.bottom-branch.top)};
  });
  expect((await measure()).row).toBe('9');expect((await measure()).center).toBeLessThan(1);expect((await measure()).end).toBeLessThan(1);
  await expect(page.locator('tr[data-row="2"] .row-outline-branch')).toHaveCount(0);
  const padding=await page.locator('td[data-r="3"][data-c="0"] .cell-display').evaluate(el=>getComputedStyle(el).paddingLeft);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=2400;});
  await expect(page.locator('.grid .summary-chevron[data-group-id="outer"]')).toHaveCount(0);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=0;});
  await expect(page.locator('.grid .summary-chevron[data-group-id="outer"]')).toBeVisible();
  expect(await page.locator('td[data-r="3"][data-c="0"] .cell-display').evaluate(el=>getComputedStyle(el).paddingLeft)).toBe(padding);
  expect((await measure()).end).toBeLessThan(1);
  await page.locator('td[data-r="16"][data-c="0"]').click();
  await page.locator('#formula').fill('');await page.locator('#formula').press('Enter');
  await expect(page.locator('.grid .row-outline-rail[data-group-id="separate"].outline-end')).toHaveCount(1);
  expect(await page.locator('.grid .row-outline-rail[data-group-id="separate"].outline-end').evaluate(el=>el.closest('tr')!.dataset.row)).toBe('19');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=0;});
  await page.locator('td[data-r="1"][data-c="0"] .cell-display').click();
  await page.reload();await expect(page.locator('.grid .summary-chevron[data-group-id="outer"]')).toBeVisible();
  expect((await measure()).end).toBeLessThan(1);
});
test('row grips stay centered and column grips stay above letters with grouping buttons beside them',async({page})=>{
  const before=await fixture(page,true);
  await expect(page.locator('td .row-move-control')).toHaveCount(0);
  for(const index of [1,9,12]){
    await page.locator(`[data-row-select="${index}"] .row-index`).click();
    const result=await page.locator(`[data-move-row="${index}"]`).evaluate(button=>{
      const svg=button.querySelector('svg')!.getBoundingClientRect(),row=button.closest('tr')!.getBoundingClientRect(),number=button.closest('tr')!.querySelector('.row-index')!.getBoundingClientRect();
      const overlaps=(a:DOMRect,b:DOMRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      return {center:Math.abs(svg.top+svg.height/2-row.top-row.height/2),numberOverlap:overlaps(svg,number),size:svg.width,header:button.parentElement!.tagName,
        leftOfGroups:[...button.closest('tr')!.querySelectorAll('.group-control')].every(el=>svg.right<=el.getBoundingClientRect().left),
        groupOverlap:[...button.closest('tr')!.querySelectorAll('.group-control')].some(el=>overlaps(svg,el.getBoundingClientRect()))};
    });
    expect(result.center).toBeLessThan(.75);expect(result.numberOverlap).toBe(false);expect(result.groupOverlap).toBe(false);expect(result.size).toBe(14);expect(result.header).toBe('TH');expect(result.leftOfGroups).toBe(true);
  }
  for(const index of [0,2,9]){
    await page.locator(`th[data-col="${index}"] .column-index`).click();
    const result=await page.locator(`[data-move-column="${index}"]`).evaluate(button=>{
      const svg=button.querySelector('svg')!.getBoundingClientRect(),label=button.closest('th')!.querySelector('.column-index')!.getBoundingClientRect();
      return{center:Math.abs(svg.left+svg.width/2-label.left-label.width/2),size:svg.width,aboveLetter:svg.bottom<=label.top,
        groupsBesideLetter:[...button.closest('th')!.querySelectorAll('.group-control')].every(el=>{const r=el.getBoundingClientRect();return Math.abs(r.top+r.height/2-label.top-label.height/2)<.75&&r.left>=label.left+label.width/2+7;}),
        groupOverlap:[...button.closest('th')!.querySelectorAll('.group-control')].some(el=>{const r=el.getBoundingClientRect();return svg.left<r.right&&svg.right>r.left&&svg.top<r.bottom&&svg.bottom>r.top;})};
    });
    expect(result.center).toBeLessThan(.75);expect(result.groupOverlap).toBe(false);expect(result.size).toBe(14);expect(result.aboveLetter).toBe(true);expect(result.groupsBesideLetter).toBe(true);
  }
  const gripPosition=()=>page.locator('[data-move-column="0"]').evaluate(button=>{
    const r=button.getBoundingClientRect(),header=button.closest('th')!.getBoundingClientRect(),label=button.closest('th')!.querySelector('.column-index')!.getBoundingClientRect();
    return{x:r.left+r.width/2-label.left-label.width/2,y:r.top-header.top};
  });
  const position=await gripPosition();
  expect(await page.locator('th[data-col="0"]').evaluate(el=>el.getBoundingClientRect().height)).toBe(40);
  await page.locator('.grid [data-group-id="col-outer"]').click();
  expect(await page.locator('th[data-col="0"]').evaluate(el=>el.getBoundingClientRect().height)).toBe(40);
  expect(await gripPosition()).toEqual(position);
  await expect(page.locator('td .row-move-control')).toHaveCount(0);
  await page.locator('.grid [data-group-id="col-outer"]').click();
  await page.locator('[data-move-column="9"]').click();
  await expect(page.locator('[data-insert-column="10"]')).toHaveAttribute('aria-label','Move columns after J');
  await page.locator('[data-move-column="9"]').click();
  await page.locator('[data-row-select="1"] .row-index').click();
  await page.locator('[data-move-row="1"]').click();
  await expect(page.locator('[data-insert-row="2"]')).toHaveAttribute('aria-label','Move rows after 2');
  await page.locator('[data-move-row="1"]').click();
  await expect(page.locator('[data-insert-row="2"]')).toHaveAttribute('aria-label','Insert row after 2');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot(page)).sheets[0].columns).toEqual(before.sheets[0].columns);
  await page.getByRole('button',{name:'Add sheet',exact:true}).click();
  await page.locator('#ask-form').getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('.toolbar .group-menu-button')).toBeVisible();
  await expect(page.locator('.corner .group-menu-button')).toHaveCount(0);
  expect(await page.locator('.grid col').first().evaluate(el=>el.getBoundingClientRect().width)).toBe(54);
  expect(await page.locator('th[data-col="0"]').evaluate(el=>el.getBoundingClientRect().height)).toBe(35);
  expect(await gripPosition()).toEqual(position);
  await expect(page.locator('td .row-move-control')).toHaveCount(0);
});
test('tree and hint preferences stay sheet-specific across re-renders, saves and reloads',async({page})=>{
  await fixture(page);await menu(page);await page.getByRole('switch',{name:'Tree view',exact:true}).click();
  await expect(page.locator('.grid')).toHaveClass(/tree-outline/);
  await expect(page.locator('.row-outline-rail')).not.toHaveCount(0);
  await expect(page.locator('.column-outline-row')).toHaveCount(0);
  await expect(page.locator('.column-summary-rail')).not.toHaveCount(0);
  await menu(page);await page.getByRole('switch',{name:'Plain group hints',exact:true}).click();
  await expect(page.locator('.row-plain-hints,.plain-group-hints')).toHaveCount(0);
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.keyboard.press('Escape');await expect(page.locator('.group-popover')).toHaveCount(0);await page.getByRole('button',{name:'Notebook',exact:true}).click();await menu(page);
  await expect(page.getByRole('switch',{name:'Plain group hints',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(page.getByRole('switch',{name:'Tree view',exact:true})).toHaveAttribute('aria-checked','false');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Daily log',exact:true}).click();
  await page.reload();await menu(page);
  await expect(page.getByRole('switch',{name:'Plain group hints',exact:true})).toHaveAttribute('aria-checked','false');
  await expect(page.getByRole('switch',{name:'Tree view',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('switch',{name:'Plain group hints',exact:true}).click();
  await page.locator('.group-popover [data-outline-axis="row"][data-outline-level="0"]').click();
  await expect(page.locator('.grid [data-group-id="plain-row"]')).toHaveCount(1);
  await page.keyboard.press('Escape');await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=2000;el.scrollLeft=400;});
  await expect(page.locator('tbody tr[data-row]')).not.toHaveCount(0);
  expect(await page.locator('.corner').evaluate(el=>el.getBoundingClientRect().height)).toBe(40);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;});
  await expect(page.locator('.grid [data-group-id="outer"]')).toBeVisible();
});
test('popover is content-sized, single levels omit duplicate controls and icons keep their shared styling',async({page})=>{
  await fixture(page);const popup=await menu(page);
  const large=await popup.evaluate(el=>el.getBoundingClientRect().width);
  const icons=await page.locator('.grid .group-control svg,.group-popover .group-control svg').evaluateAll(elements=>elements.map(el=>({size:el.getBoundingClientRect().width,header:!!el.closest('.grid'),stroke:el.getAttribute('stroke-width'),effect:getComputedStyle(el.querySelector('path')!).vectorEffect})));
  for(const icon of icons){expect(icon.size).toBe(icon.header?14:18);expect(icon.stroke).toBe('1');expect(icon.effect).toBe('non-scaling-stroke');}
  const toggles=page.locator('.group-popover .group-control');
  expect(await toggles.evaluateAll(elements=>elements.every(el=>getComputedStyle(el).backgroundColor==='rgb(255, 255, 255)'))).toBe(true);
  const rect=await popup.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(8);expect(rect!.x+rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width-7);
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;state.book.sheets[0].groups=state.book.sheets[0].groups.filter(g=>!['inner','leaf','col-inner'].includes(g.id));await store.save(state.book,state.version,'Single level');}finally{store.close();}
  });
  await page.reload();const small=await menu(page);
  await expect(small.locator('.outline-layer-grid strong')).toHaveText(['Rows','Columns']);
  await expect(small.locator('.outline-layer-grid button')).toHaveCount(2);
  expect(await small.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThan(large);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await expect(page.locator('.toolbar .group-menu-button')).toBeVisible();
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await expect(page.getByRole('button',{name:'Select all cells',exact:true})).toBeVisible();
});

  test('a plain group on a summary identity hides its entire group for both rows and columns',async({page})=>{
    const before=await fixture(page);
    for(const [axis,summary,child] of [['row','outer','inner'],['column','col-outer','col-inner']] as const){
      await page.locator(`.grid [data-group-id="${child}"]`).click();
      await page.locator(axis==='row'?'[data-row-select="1"] .row-index':'th[data-col="0"]').click();
      await page.keyboard.press('Control+Alt+g');await expect(page.locator('#save-state')).toContainText(/^Saved/);
      await expect.poll(async()=>{const group=(await snapshot(page)).sheets[0].groups.at(-1)!;return{axis:group.axis,kind:group.kind,members:group.members.length};}).toEqual({axis,kind:'range',members:1});
      const sheet=(await snapshot(page)).sheets[0],plain=sheet.groups.at(-1)!;
      expect(plain.axis).toBe(axis);expect(plain.kind).toBe('range');expect(plain.members).toHaveLength(1);
      await page.locator(`.grid [data-group-id="${plain.id}"]`).click();
      await expect(page.locator(axis==='row'?'[data-row-select="1"],[data-row-select="2"],[data-row-select="9"]':'th[data-col="0"],th[data-col="1"],th[data-col="8"]')).toHaveCount(0);
      await expect(page.locator(`.grid [data-group-id="${plain.id}"]`)).toBeVisible();
      await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
      await expect(page.locator(axis==='row'?'[data-row-select="1"]':'th[data-col="0"]')).toHaveCount(0);
      await page.locator(`.grid [data-group-id="${plain.id}"]`).click();
      await expect(page.locator(axis==='row'?'[data-row-select="1"]':'th[data-col="0"]')).toHaveCount(1);
      await expect(page.locator(axis==='row'?'[data-row-select="4"]':'th[data-col="2"]')).toHaveCount(0);
      await expect(page.locator('#save-state')).toContainText(/^Saved/);
      const groups=(await snapshot(page)).sheets[0].groups;
      expect(groups.find(g=>g.id===summary)!.collapsed).toBe(false);expect(groups.find(g=>g.id===child)!.collapsed).toBe(true);
    }
    expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  });

  for(const axis of ['row','column'] as const)test(`inserted and moved ${axis} members join enclosing groups, save and undo together`,async({page})=>{
    const before=await fixture(page),original=before.sheets[0],at=axis==='row'?5:2,sourceId=(axis==='row'?original.rows:original.columns)[axis==='row'?12:9].id;
    const enclosing=axis==='row'?['outer','inner','leaf']:['col-outer','col-inner'];
    const select=async(index:number)=>page.locator(axis==='row'?`[data-row-select="${index}"] .row-index`:`th[data-col="${index}"] .column-index`).click();
    const insert=(boundary:number)=>page.locator(axis==='row'?`[data-insert-row="${boundary}"]`:`[data-insert-column="${boundary}"]`);
    await select(at-1);await insert(at).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
    const added=(await snapshot(page)).sheets[0],insertedId=(axis==='row'?added.rows:added.columns)[at].id;
    for(const id of enclosing)expect(added.groups.find(g=>g.id===id)!.members).toContain(insertedId);
    for(const [address,value]of Object.entries(original.cells))expect(added.cells[address]).toEqual(value);
    await page.reload();const saved=(await snapshot(page)).sheets[0];
    for(const id of enclosing)expect(saved.groups.find(g=>g.id===id)!.members).toContain(insertedId);
    const sourceAt=(axis==='row'?saved.rows:saved.columns).findIndex(item=>item.id===sourceId);
    await select(sourceAt);await page.locator(axis==='row'?`[data-move-row="${sourceAt}"]`:`[data-move-column="${sourceAt}"]`).click();
    await select(at-1);await insert(at).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
    const moved=(await snapshot(page)).sheets[0];
    for(const id of enclosing)expect(moved.groups.find(g=>g.id===id)!.members).toContain(sourceId);
    expect(moved.cells).toEqual(saved.cells);
    await page.locator(`.grid [data-group-id="${enclosing[0]}"]`).click();
    await expect(page.locator(axis==='row'?`[data-row-select="${at}"]`:`th[data-col="${at}"]`)).toHaveCount(0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
    expect((await snapshot(page)).sheets[0].groups).toEqual(saved.groups);
    expect((await snapshot(page)).sheets[0].cells).toEqual(saved.cells);
    if(axis==='column'){
      await select(sourceAt);await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
      await page.getByRole('button',{name:'Move column left',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
      expect((await snapshot(page)).sheets[0].groups.find(g=>g.id==='col-outer')!.members).toContain(sourceId);
      await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
      expect((await snapshot(page)).sheets[0].groups).toEqual(saved.groups);
    }
  });

  test('group manager shows group types, real cell previews and affected coordinates without obscuring the sheet',async({page})=>{
    const before=await fixture(page);
    await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+Alt+g');
    await expect(page.locator('#save-state')).toContainText(/^Saved/);const plain=(await snapshot(page)).sheets[0].groups.at(-1)!;
    await menu(page);await page.getByRole('button',{name:'Manage groups',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'Groups on Daily log',exact:true}),card=panel.locator(`[data-group-card="${plain.id}"]`);
    await expect(panel).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(panel).toContainText('keeps its summary row/column visible');await expect(panel).toContainText('hides all its members');
    await expect(card).toContainText('Plain group');await expect(card).toContainText('Rows 2-10');await expect(card).toContainText('Selected rows 2 includes a summary');
    await expect(card.locator('tbody th')).toHaveText(['2','3','4','10']);
    await expect(panel.locator('[data-group-card="outer"]')).toContainText('Summary row 2 stays visible');
    await card.getByRole('button',{name:'Locate on sheet',exact:true}).click();await expect(page.locator('[data-row-select="1"]')).toHaveClass(/group-located/);
    await card.getByRole('button',{name:'Hide group',exact:true}).click();await expect(card).toContainText('All 9 rows hidden');
    await expect(page.locator('[data-row-select="1"]')).toHaveCount(0);
    await card.getByRole('button',{name:'Show group',exact:true}).click();await expect(page.locator('[data-row-select="1"]')).toHaveCount(1);
    await panel.getByRole('button',{name:'Close group manager',exact:true}).click();await expect(panel).toHaveCount(0);await expect(page.locator('.group-located')).toHaveCount(0);
    await expect(page.locator('#save-state')).toContainText(/^Saved/);
    expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
    await menu(page);await page.getByRole('button',{name:'Manage groups',exact:true}).click();
    const remove=panel.getByRole('button',{name:'Ungroup',exact:true});
    for(let i=0,count=await remove.count();i<count;i++)await remove.first().click();
    await expect(remove).toHaveCount(0);
    expect((await panel.boundingBox())!.height).toBeLessThan(400);
  });
