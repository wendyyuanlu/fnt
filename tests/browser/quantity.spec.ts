import {expect,test} from '@playwright/test';

test('fraction quantities recalculate through formatting, preserve notes and inputs, reject invalid edits, and survive Undo/reload',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const original=await page.evaluate(async()=>{
    const load=(path:string)=>import(/* @vite-ignore */'/src/'+path+'.ts'),{Store}=await load('storage'),{uid,key,setInput}=await load('model'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets.find((s:{name:string})=>s.name==='Notebook')!;
      const table={id:uid(),name:'FractionPreview',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,4).map((r:{id:string})=>r.id),columns:['Ingredient','Amount','Unit','Grams'].map((name,i)=>({id:uid(),column:s.columns[i].id,name}))};
      state.book.tables.push(table);
      table.columns.forEach((c:{column:string;name:string})=>s.cells[key(table.header,c.column)]={value:c.name});
      s.cells[key(s.rows[1].id,s.columns[1].id)]={value:'1/8',note:'Keep this note'};
      s.cells[key(s.rows[2].id,s.columns[1].id)]={value:'1/2 shot glass  '};
      for(const r of table.rows)setInput(state.book,s,r,s.columns[3].id,'=IF(ISNUMBER(FractionPreview[@Amount]),FractionPreview[@Amount]*80,0)');
      await store.save(state.book,state.version,'Synthetic fraction quantities');return s.cells;
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const cell=(r:number,c:number)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`),formula=page.locator('#formula');
  await expect(cell(1,3)).toHaveText('0');
  await page.locator('th[data-col="1"]').click();await page.locator('[data-action="format"]').click();
  await page.locator('#number-format').selectOption('fraction');await page.getByRole('button',{name:'Apply to selection',exact:true}).click();
  await expect(cell(1,1)).toHaveText('1/8');await expect(cell(1,3)).toHaveText('10');
  await expect(cell(2,1)).toHaveText('1/2 shot glass  ');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const state=()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{return(await store.load())!.book.sheets.find((s:{name:string})=>s.name==='Notebook')!;}finally{store.close();}
  });
  const formatted=await state();
  for(const [key,cell]of Object.entries(formatted.cells)){
    const {format,...content}=cell as {format?:unknown};const {format:oldFormat,...oldContent}=(original as Record<string,{format?:unknown}>)[key]??{};
    expect(content).toEqual(oldContent);
  }
  await cell(1,1).click();await formula.fill('1½');await formula.press('Enter');
  await expect(cell(1,1)).toHaveText('1 1/2');await expect(cell(1,3)).toHaveText('120');
  await cell(1,1).click();await expect(formula).toHaveValue('1½');
  await formula.fill('1/0');await formula.press('Enter');await expect(page.locator('#error .error-message')).toContainText('zero');
  await formula.press('Escape');await expect(cell(1,1)).toHaveText('1 1/2');await expect(cell(1,3)).toHaveText('120');
  await page.locator('[data-action="undo"]').click();await expect(cell(1,1)).toHaveText('1/8');await expect(cell(1,3)).toHaveText('10');
  await page.locator('[data-action="redo"]').click();await expect(cell(1,3)).toHaveText('120');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await expect(cell(1,1)).toHaveText('1 1/2');await cell(1,1).click();await expect(formula).toHaveValue('1½');
  await formula.fill("'1/2");await formula.press('Enter');await expect(cell(1,3)).toHaveText('0');
  await cell(1,1).click();await expect(formula).toHaveValue("'1/2");await formula.press('Enter');await expect(cell(1,3)).toHaveText('0');
});
