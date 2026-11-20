import { expect, test, type Page } from '@playwright/test';

const cell=(page:Page,r:number,c:number)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`);
async function edit(page:Page,r:number,c:number,value:string){
  await cell(page,r,c).click();await page.getByRole('textbox',{name:'Cell value or formula',exact:true}).fill(value);await page.getByRole('button',{name:'Apply',exact:true}).click();
}
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
  await cell(page,1,5).dblclick();await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#cell-editor').fill('Line one\nLine two');await page.locator('#cell-note').fill('Private synthetic note');await page.getByRole('button',{name:'Apply changes'}).click();
  await expect(cell(page,1,5)).toHaveCSS('white-space','nowrap');await expect(cell(page,1,5)).toHaveText('Line one\nLine two');
  await cell(page,1,1).click();await page.getByRole('button',{name:'Choose source',exact:true}).click();
  await page.locator('#picker-source').selectOption({label:'Ingredients / Ingredient'});await page.locator('#picker-search').fill('oats');await page.locator('[data-record]').click();
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
  await page.locator('[data-checkpoint]').filter({hasText:'Manual save'}).click();
  await expect(page.locator('#save-state')).toContainText('Checkpoint restored locally - sync disconnected');
  await expect(cell(page,1,2)).toHaveText('180');
  const result=await page.evaluate(async()=>{
    const storage='/src/storage.ts',archive='/src/archive.ts',{Store}=await import(/* @vite-ignore */storage),{parseArchive}=await import(/* @vite-ignore */archive),store=await Store.open();
    try{
      const state=await store.load(),history=await store.history(),saved=parseArchive(history.find((h:{label:string})=>h.label==='Before backup restore').backup);
      return{disconnected:!state.sync&&!state.remoteSha,pending:state.pending.map((p:{id:string})=>p.id),recoveryVersion:saved.state.version,recoveryRepo:saved.state.sync.repo};
    }finally{store.close();}
  });
  expect(result.disconnected).toBe(true);expect(result.pending).toEqual(expect.arrayContaining(before.pending));expect(result.recoveryVersion).toBe(before.version);expect(result.recoveryRepo).toBe('invented-data');expect(uploads).toBe(0);
});
test('date formatting agrees with formula serials at the 1900 boundary and persists after reload',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await edit(page,1,1,'=DATE(1900,2,29)');await page.locator('[data-action="format"]').click();await page.locator('#number-format').selectOption('date');await page.getByRole('button',{name:'Apply to selection',exact:true}).click();
  await expect(cell(page,1,1)).toHaveText('1900-02-29');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(cell(page,1,1)).toHaveText('1900-02-29');
  await edit(page,1,1,'=DATE(1900,3,1)');await expect(cell(page,1,1)).toHaveText('1900-03-01');
  await edit(page,1,1,'=DATE(1900,1,1)');await expect(cell(page,1,1)).toHaveText('1900-01-01');
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
test('typing adjacent to a table expands formulas, while a gap remains freeform',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await edit(page,5,0,'Gap entry');await expect(cell(page,5,5)).toHaveText('');
  await edit(page,4,0,'Adjacent entry');await edit(page,4,1,'50');await edit(page,4,2,'100');
  await expect(cell(page,4,5)).toHaveText('2');await expect(cell(page,5,5)).toHaveText('');
  await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await expect(cell(page,4,5)).toHaveText('2');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await cell(page,2,1).click();
  await page.getByRole('button',{name:'Choose source',exact:true}).click();await page.locator('#picker-source').selectOption({label:'Ingredients / Ingredient'});
  await page.locator('#picker-search').fill('lentils');await page.locator('[data-record]').click();await edit(page,2,2,'100');
  await expect(cell(page,2,3)).toHaveText('116');await expect(cell(page,2,1)).toHaveClass(/linked/);
});
test('header boundary controls insert and move a selected column block without losing formulas',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator('th[data-col="1"]').click();
  await page.locator('th[data-col="2"]').click({modifiers:['Shift']});
  await page.locator('[data-move-column="1"]').click();
  await page.locator('[data-insert-column="6"]').click();
  await expect(cell(page,1,4)).toHaveText('40');await expect(cell(page,1,5)).toHaveText('150');await expect(cell(page,1,3)).toHaveText('3.75');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('208.8');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,1)).toHaveText('40');
  await page.locator('th[data-col="1"]').hover();await page.locator('[data-insert-column="2"]').click();await expect(cell(page,0,2)).toHaveText('New column');await expect(cell(page,1,6)).toHaveText('3.75');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.locator('[data-row-select="1"]').hover();await page.locator('[data-insert-row="2"]').click();await expect(cell(page,2,5)).toHaveText('#DIV/0!');await expect(cell(page,3,0)).toHaveText('Example lentils');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,2,0)).toHaveText('Example lentils');
});
test('desktop drag handle moves multiple columns without overwriting a destination',async({page,isMobile})=>{
  test.skip(isMobile,'Touch equivalent is exercised in the boundary-control test.');
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator('th[data-col="1"]').click();await page.locator('th[data-col="2"]').click({modifiers:['Shift']});
  await page.locator('[data-move-column="1"]').dragTo(page.locator('th[data-col="5"]'),{targetPosition:{x:130,y:14}});
  await expect(cell(page,1,4)).toHaveText('40');await expect(cell(page,1,5)).toHaveText('150');await expect(cell(page,1,3)).toHaveText('3.75');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('208.8');
});
