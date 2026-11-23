import { expect, test, type Page } from '@playwright/test';

const cell=(page:Page,r:number,c:number)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`);
async function edit(page:Page,r:number,c:number,value:string){
  await cell(page,r,c).click();await page.getByRole('textbox',{name:'Cell value or formula',exact:true}).fill(value);await page.locator('#formula').press('Enter');
}
test('date display adapts by year without changing serials, formulas or text notes',async({page})=>{
  await page.goto('/');await expect(page.locator('.grid')).toBeVisible();
  const serials=await page.evaluate(async()=>{
    const storage='/src/storage.ts',dates='/src/dates.ts',{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),{excelDate}=await import(/* @vite-ignore */dates) as typeof import('../../src/dates'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],year=new Date().getFullYear(),values=[excelDate(year,9,29)!,excelDate(year,10,2)!,excelDate(year-1,9,29)!];
      values.forEach((value,i)=>{s.cells[`${s.rows[i+4].id}:${s.columns[0].id}`]=i===1?{formula:{kind:'literal',value},format:{number:'date'}}:{value,format:{number:'date'}};});
      s.cells[`${s.rows[7].id}:${s.columns[0].id}`]={value:'Recipe note: 9/29',format:{number:'date'}};
      s.cells[`${s.rows[8].id}:${s.columns[0].id}`]={value:values[0]};
      await store.save(state.book,state.version,'Synthetic date display');return{values,year};
    }finally{store.close();}
  });
  await page.reload();await expect(cell(page,4,0)).toHaveText('9/29');await expect(cell(page,5,0)).toHaveText('10/02');
  await expect(cell(page,6,0)).toHaveText(`${String((serials.year-1)%100).padStart(2,'0')}/09/29`);
  await expect(cell(page,7,0)).toHaveText('Recipe note: 9/29');await expect(cell(page,8,0)).toHaveText(String(serials.values[0]));
  await cell(page,4,0).click();await expect(page.locator('#formula')).toHaveValue(String(serials.values[0]));
  await cell(page,5,0).click();await expect(page.locator('#formula')).toHaveValue('='+serials.values[1]);
});
test('table end strokes follow visible identities and the true bottom through virtual scrolling and column moves',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets.find(s=>s.name==='Ingredients')!,t=state.book.tables.find(t=>t.sheet===s.id)!;t.rows=s.rows.slice(1,72).map(r=>r.id);await store.save(state.book,state.version,'Synthetic long table');}finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await expect(cell(page,0,5)).toHaveClass(/table-right-edge/);await expect(cell(page,1,5)).toHaveClass(/table-right-edge/);
  await expect(page.locator('.table-bottom-edge')).toHaveCount(0);
  const stroke=await cell(page,1,5).evaluate(el=>getComputedStyle(el).borderRightColor),header=await cell(page,0,0).evaluate(el=>getComputedStyle(el).borderBottomColor);
  expect(stroke).toBe(header);
  await expect(cell(page,1,5)).toHaveCSS('border-right-width','1px');await expect(cell(page,1,5)).toHaveCSS('border-right-style','solid');
  await page.locator('#row-jump').fill('72');await page.locator('#row-jump').press('Enter');
  await expect(cell(page,71,5)).toHaveClass(/table-bottom-edge/);await expect(page.locator('.table-bottom-edge')).toHaveCount(6);
  await expect(cell(page,71,5)).toHaveCSS('border-bottom-color',header);
  await expect(cell(page,72,5)).not.toHaveClass(/table-bottom-edge|table-right-edge/);
  await page.locator('#row-jump').fill('2');await page.locator('#row-jump').press('Enter');
  await cell(page,1,5).click();await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
  await page.getByRole('button',{name:'Move column right',exact:true}).click();
  await expect(cell(page,1,6)).toHaveText('3.75');await expect(cell(page,1,6)).toHaveClass(/table-right-edge/);
  await expect(cell(page,1,5)).not.toHaveClass(/table-right-edge/);
  await page.locator('#row-jump').fill('72');await page.locator('#row-jump').press('Enter');
  await expect(cell(page,71,6)).toHaveClass(/table-bottom-edge/);await expect(cell(page,71,6)).toHaveClass(/table-right-edge/);
  await expect(cell(page,71,5)).not.toHaveClass(/table-bottom-edge/);
});
test('real grid editing, formulas, rename/move, undo, local reload, notes and picker',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(cell(page,1,3)).toHaveText('208.8');
  await edit(page,1,2,'200');await expect(cell(page,1,3)).toHaveText('232');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,3)).toHaveText('208.8');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(cell(page,1,3)).toHaveText('232');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await edit(page,0,5,'Energy density');await expect(cell(page,1,5)).toHaveText('3.75');
  await cell(page,1,5).click();await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
  await page.getByRole('button',{name:'Move column left',exact:true}).click();await expect(cell(page,1,4)).toHaveText('3.75');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('232');
  await cell(page,1,3).click();await expect(page.getByRole('textbox',{name:'Cell value or formula',exact:true})).toHaveValue(/Ingredients\[Energy density\]/);
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(cell(page,1,3)).toHaveText('232');
  await cell(page,1,5).dblclick();await expect(page.locator('#cell-editor')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#cell-editor').fill('Line one\nLine two');await expect(page.locator('#cell-note,#cell-link')).toHaveCount(0);await cell(page,2,5).click();await expect(page.locator('#cell-editor')).toHaveCount(0);
  await expect(cell(page,1,5)).toHaveCSS('white-space','nowrap');await expect(cell(page,1,5)).toHaveText('Line one\nLine two');
  await cell(page,1,1).click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Ingredients',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  await cell(page,1,1).click();await page.getByRole('searchbox',{name:'Search dropdown options'}).fill('oats');await page.locator('.cell-dropdown').getByRole('option').click();
  await expect(cell(page,1,1)).toHaveText('Example oats');await expect(cell(page,1,1)).toHaveClass(/linked/);await expect(cell(page,1,3)).toHaveText('750');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await edit(page,1,0,'Oats renamed');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,1)).toHaveText('Oats renamed');await expect(cell(page,1,3)).toHaveText('750');
  expect(errors).toEqual([]);await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
  await expect(page.locator('.brand,.notice,.sheet-heading,.bottom-caption')).toHaveCount(0);
  const layout=await page.evaluate(()=>({height:document.querySelector('#grid-scroll')!.getBoundingClientRect().height,viewport:innerHeight}));
  expect(layout.height/layout.viewport).toBeGreaterThan(.72);
});
test('backup restore preserves pre-restore recovery and copy outline survives selection',async({page})=>{
  await page.goto('/');await expect(cell(page,1,3)).toHaveText('208.8');
  await cell(page,1,2).click();await page.getByRole('button',{name:'Copy',exact:true}).click();await cell(page,2,2).click();await expect(cell(page,1,2)).toHaveClass(/copying/);
  await page.getByRole('button',{name:'Paste',exact:true}).click();await expect(cell(page,2,2)).toHaveText('180');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download independent full backup'}).click();const download=await event;
  const path=await download.path();expect(path).toBeTruthy();await page.getByRole('button',{name:'Close dialog'}).click();
  await edit(page,1,2,'250');await expect(cell(page,1,3)).toHaveText('290');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.locator('#restore').setInputFiles(path!);
  await expect(cell(page,1,3)).toHaveText('208.8');await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.getByRole('button',{name:'Recovery checkpoints'}).click();await expect(page.locator('[data-checkpoint]')).toContainText(['Before backup restore']);
});
test('switching cells commits formula-bar drafts rather than silently discarding them',async({page})=>{
  await page.goto('/');await cell(page,1,2).click();
  await page.getByRole('textbox',{name:'Cell value or formula',exact:true}).fill('120');
  await expect(page.locator('#save-state')).toContainText('not saved yet');
  await cell(page,2,2).click();
  await expect(cell(page,1,2)).toHaveText('120');await expect(cell(page,1,3)).toHaveText('139.2');
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(cell(page,1,2)).toHaveText('120');
});
test('checkpoint restore keeps full recovery and pending IDs, and disconnects the previous sync destination',async({page})=>{
  await page.goto('/');await page.locator('[data-action="save"]').click();
  await expect(page.locator('#save-state')).toContainText('recovery checkpoint');
  await edit(page,1,2,'250');await expect(page.locator('#save-state')).toContainText('Saved');
  const before=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{
      const state=await store.load(),configured=await store.metadata(state.version,(s:object)=>({...s,sync:{owner:'example',repo:'invented-data',branch:'main',path:'book.json'},remoteSha:'invented-sha'}));
      return{pending:configured.pending.map((p:{id:string})=>p.id),version:configured.version};
    }finally{store.close();}
  });
  let uploads=0;await page.route('https://api.github.com/**',async route=>{uploads++;await route.abort();});
  await page.reload();await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.getByRole('button',{name:'Recovery checkpoints',exact:true}).click();
  const versionBeforeRestore=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{return(await store.load()).version;}finally{store.close();}
  });
  await page.locator('[data-checkpoint]').filter({hasText:'Manual save'}).click();
  await expect(page.locator('#save-state')).toContainText('Checkpoint restored locally - sync disconnected');
  await expect(cell(page,1,2)).toHaveText('180');
  const result=await page.evaluate(async()=>{
    const storage='/src/storage.ts',archive='/src/archive.ts',{Store}=await import(/* @vite-ignore */storage),{parseArchive}=await import(/* @vite-ignore */archive),store=await Store.open();
    try{
      const state=await store.load(),history=await store.history(),saved=parseArchive(history.find((h:{label:string})=>h.label==='Before backup restore').backup);
      const daily=saved.state.book.sheets.find((s:{name:string})=>s.name==='Daily log');
      return{disconnected:!state.sync&&!state.remoteSha,pending:state.pending.map((p:{id:string})=>p.id),recoveryVersion:saved.state.version,recoveryRepo:saved.state.sync.repo,recoveryQuantity:daily.cells[`${daily.rows[1].id}:${daily.columns[2].id}`].value};
    }finally{store.close();}
  });
  expect(result.disconnected).toBe(true);expect(result.pending).toEqual(expect.arrayContaining(before.pending));expect(result.recoveryVersion).toBeGreaterThanOrEqual(versionBeforeRestore);expect(result.recoveryQuantity).toBe(250);expect(result.recoveryRepo).toBe('invented-data');expect(uploads).toBe(0);
});
test('date formatting agrees with formula serials at the 1900 boundary and persists after reload',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await edit(page,1,1,'=DATE(1900,2,29)');await page.locator('[data-action="format"]').click();await page.locator('#number-format').selectOption('date');await page.getByRole('button',{name:'Apply to selection',exact:true}).click();
  await expect(cell(page,1,1)).toHaveText('00/02/29');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(cell(page,1,1)).toHaveText('00/02/29');
  await edit(page,1,1,'=DATE(1900,3,1)');await expect(cell(page,1,1)).toHaveText('00/03/01');
  await edit(page,1,1,'=DATE(1900,1,1)');await expect(cell(page,1,1)).toHaveText('00/01/01');
});
test('in-cell and formula-bar typing share one draft, one commit and one undo',async({page})=>{
  await page.goto('/');await cell(page,1,2).click();await page.keyboard.type('120');
  const bar=page.getByRole('textbox',{name:'Cell value or formula',exact:true}),inline=page.getByRole('textbox',{name:'Edit selected cell',exact:true});
  await expect(bar).toHaveValue('120');await expect(inline).toHaveValue('120');
  await bar.fill('=60*2');await expect(inline).toHaveValue('=60*2');await expect(cell(page,1,3)).toHaveText('208.8');
  await inline.fill('=50*2');await expect(bar).toHaveValue('=50*2');
  await inline.press('Enter');await expect(cell(page,1,2)).toHaveText('100');await expect(cell(page,1,3)).toHaveText('116');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,2)).toHaveText('180');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(cell(page,1,2)).toHaveText('100');
  await cell(page,1,2).click();await page.keyboard.type('999');await inline.press('Escape');
  await expect(cell(page,1,2)).toHaveText('100');await expect(bar).toHaveValue('=(50*2)');
});
test('long multiline cells never show scrollbar gutters while typing and retain their full text',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const target=cell(page,1,1),text=Array.from({length:20},(_,i)=>`Invented note ${i+1}: ${'Long text without wrapping. '.repeat(20)}`).join('\n');
  await target.click();await page.keyboard.type('x');
  const inline=page.getByRole('textbox',{name:'Edit selected cell',exact:true});
  await inline.fill(text);await inline.press('Control+End');
  const metrics=await inline.evaluate(el=>{
    if(!(el instanceof HTMLTextAreaElement))throw Error('Expected the in-cell textarea.');
    const style=getComputedStyle(el);
    return{horizontal:el.scrollWidth>el.clientWidth,vertical:el.scrollHeight>el.clientHeight,
      width:el.offsetWidth-el.clientWidth-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth),height:el.offsetHeight-el.clientHeight-parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth),
      scrolled:el.scrollTop>0,webkit:getComputedStyle(el,'::-webkit-scrollbar').display};
  });
  expect(metrics).toEqual({horizontal:true,vertical:true,width:0,height:0,scrolled:true,webkit:'none'});
  await inline.press('End');await page.keyboard.type('!');
  await expect(inline).toHaveValue(text+'!');await inline.press('Tab');
  await expect(target).toHaveText(text+'!');await expect(target).toHaveCSS('white-space','nowrap');await expect(target).toHaveCSS('overflow','hidden');
  await target.dblclick();await expect(page.locator('#cell-editor')).toHaveValue(text+'!');
  await cell(page,2,1).click();await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(target).toHaveText(text+'!');await expect(target).toHaveCSS('white-space','nowrap');
});
test('typing adjacent to a table expands formulas, while a gap remains freeform',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await edit(page,5,0,'Gap entry');await expect(cell(page,5,5)).toHaveText('');
  await edit(page,4,0,'Adjacent entry');await edit(page,4,1,'50');await edit(page,4,2,'100');
  await expect(cell(page,4,5)).toHaveText('2');await expect(cell(page,5,5)).toHaveText('');
  await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await expect(cell(page,4,5)).toHaveText('2');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await cell(page,2,1).click();
  await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Ingredients',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();await cell(page,2,1).click();
  await page.getByRole('searchbox',{name:'Search dropdown options'}).fill('lentils');await page.locator('.cell-dropdown').getByRole('option').click();await edit(page,2,2,'100');
  await expect(cell(page,2,3)).toHaveText('116');await expect(cell(page,2,1)).toHaveClass(/linked/);
});
test('header boundary controls insert and move a selected column block without losing formulas',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator('th[data-col="1"] .column-index').click();
  await page.locator('th[data-col="2"] .column-index').click({modifiers:['Shift']});
  await page.locator('[data-move-column="1"]').click();
  await page.locator('[data-insert-column="6"]').click();
  await expect(cell(page,1,4)).toHaveText('40');await expect(cell(page,1,5)).toHaveText('150');await expect(cell(page,1,3)).toHaveText('3.75');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('208.8');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,1)).toHaveText('40');
  await page.locator('th[data-col="1"] .column-index').click();await page.locator('[data-insert-column="2"]').click();await expect(cell(page,0,2)).toHaveText('New column');await expect(cell(page,1,6)).toHaveText('3.75');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.locator('[data-row-select="1"]').hover();await page.locator('[data-insert-row="2"]').click();await expect(cell(page,2,5)).toHaveText('#DIV/0!');await expect(cell(page,3,0)).toHaveText('Example lentils');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,2,0)).toHaveText('Example lentils');
});
test('desktop drag handle moves multiple columns without overwriting a destination',async({page,isMobile})=>{
  test.skip(isMobile,'Touch equivalent is exercised in the boundary-control test.');
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator('th[data-col="1"] .column-index').click();await page.locator('th[data-col="2"] .column-index').click({modifiers:['Shift']});
  await page.locator('[data-move-column="1"]').dragTo(page.locator('th[data-col="5"]'),{targetPosition:{x:130,y:14}});
  await expect(cell(page,1,4)).toHaveText('40');await expect(cell(page,1,5)).toHaveText('150');await expect(cell(page,1,3)).toHaveText('3.75');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('208.8');
});
