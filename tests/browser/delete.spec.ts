import { expect,test,type Page } from '@playwright/test';

const cell=(page:Page,r:number,c:number)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`);
async function snapshot(page:Page){
  await expect(page.locator('#save-state')).toContainText('Saved');
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{const{revision,tableActivity,...book}=(await store.load()).book;return book;}finally{store.close();}
  });
}
async function fixture(page:Page){
  await page.goto('/');await expect(cell(page,1,3)).toHaveText('208.8');
  await page.evaluate(async()=>{
    const model='/src/model.ts',storage='/src/storage.ts',{key,uid}=await import(/* @vite-ignore */model),{Store}=await import(/* @vite-ignore */storage),store=await Store.open();
    try{
      const state=await store.load(),b=state.book,s=b.sheets[1],t=b.tables[0],log=b.sheets[0],notes=b.sheets[3];
      s.rows[2].height=42;s.columns[5].width=190;
      s.groups.push({id:uid(),axis:'row',members:[s.rows[2].id,s.rows[3].id],collapsed:false,label:'Detail records'},{id:uid(),axis:'column',members:[s.columns[4].id,s.columns[5].id],collapsed:false,label:'Calculation columns'});
      s.validations.push({id:uid(),rows:t.rows,columns:[s.columns[4].id],sheet:s.id,source:'="g,cup"',values:['g','cup']});
      s.cells[key(s.rows[2].id,s.columns[5].id)]={...s.cells[key(s.rows[2].id,s.columns[5].id)],format:{bold:true},note:'Keep synthetic metadata'};
      log.cells[key(log.rows[1].id,log.columns[1].id)]={binding:{table:t.id,row:t.rows[1],column:t.columns[0].id}};
      notes.cells[key(notes.rows[1].id,notes.columns[1].id)]={value:7,format:{bold:true},note:'Keep on clear'};
      await store.save(b,state.version,'Synthetic keyboard fixture');
    }finally{store.close();}
  });
  await page.reload();await expect(cell(page,1,3)).toHaveText('208.8');
}
test('Delete removes multiple selected columns atomically and Undo restores all identities, references and metadata',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator('th[data-col="4"]').click();await page.locator('th[data-col="5"]').click({modifiers:['Shift']});
  await page.keyboard.press('Delete');await expect(page.locator('.grid')).toHaveAttribute('aria-colcount','10');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('#REF!');
  await page.keyboard.press('Control+z');await expect(cell(page,1,3)).toHaveText('208.8');expect(await snapshot(page)).toEqual(before);
  await page.reload();expect(await snapshot(page)).toEqual(before);
});
test('Delete removes Shift-selected rows, leaves a dangling source explicit, and one undo restores records and links',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator('[data-row-select="2"]').click();await page.locator('[data-row-select="3"]').click({modifiers:['Shift']});
  await page.keyboard.press('Delete');await expect(page.locator('.grid')).toHaveAttribute('aria-rowcount','78');await expect(cell(page,1,0)).toHaveText('Example oats');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,1)).toHaveText('#REF!');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,1)).toHaveText('Example lentils');expect(await snapshot(page)).toEqual(before);
});
test('cell and full-width/full-height cell ranges clear values without deleting structure or formatting',async({page})=>{
  await fixture(page);await page.getByRole('button',{name:'Notebook',exact:true}).click();const before=await snapshot(page);
  await cell(page,1,1).click();await page.keyboard.press('Delete');await expect(cell(page,1,1)).toHaveText('');await expect(cell(page,1,1)).toHaveCSS('font-weight','700');
  await page.keyboard.press('Control+z');await expect(cell(page,1,1)).toHaveText('7');expect(await snapshot(page)).toEqual(before);
  for(const range of ['A2:P2','B1:B100']){
    await page.locator('[data-action="range"]').click();await page.locator('#answer').fill(range);await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();
    await page.keyboard.press('Delete');await expect(cell(page,1,1)).toHaveText('');
    await expect(page.locator('.grid')).toHaveAttribute('aria-rowcount','100');await expect(page.locator('.grid')).toHaveAttribute('aria-colcount','16');
    await page.keyboard.press('Control+z');await expect(cell(page,1,1)).toHaveText('7');expect(await snapshot(page)).toEqual(before);
  }
});
test('Delete remains native in formula/inline/dialog/contenteditable inputs and is ignored during IME',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.locator('th[data-col="2"]').click();
  await page.locator('#grid-scroll').evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,isComposing:true})));
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('Control+f');await page.locator('#find-text').fill('invented');await page.locator('#find-text').press('Home');await page.locator('#find-text').press('Delete');await expect(page.locator('#find-text')).toHaveValue('nvented');await page.getByRole('button',{name:'Close dialog'}).click();expect(await snapshot(page)).toEqual(before);
  await page.evaluate(()=>{const el=document.createElement('div');el.contentEditable='true';el.id='native-edit';el.textContent='abc';document.body.append(el);el.focus();getSelection()!.collapse(el.firstChild,1);});
  await page.keyboard.press('Delete');await expect(page.locator('#native-edit')).toHaveText('ac');expect(await snapshot(page)).toEqual(before);await page.locator('#native-edit').evaluate(el=>el.remove());
  await cell(page,1,2).click();await page.keyboard.press('F2');
  const inline=page.getByRole('textbox',{name:'Edit selected cell',exact:true});
  await inline.press('Home');await inline.press('Delete');await expect(inline).toHaveValue('80');await inline.press('Escape');
  const formula=page.locator('#formula');await formula.focus();await formula.press('Home');await formula.press('Delete');await expect(formula).toHaveValue('80');await formula.press('Escape');expect(await snapshot(page)).toEqual(before);
});
