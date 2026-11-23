import {expect,test} from '@playwright/test';

test('real Meals navigation saves only visits, retains drafts and place, and restores editable calculations',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('.grid')).toBeVisible();
  await page.evaluate(async()=>{
    const storage='/src/storage.ts',published='/src/published.ts';
    const {Store}=await import(/* @vite-ignore */storage),{loadPublishedTesting}=await import(/* @vite-ignore */published),store=await Store.open();
    try{const state=await store.load(),snapshot=await loadPublishedTesting();await store.save(snapshot.book,state.version,'Isolated real Meals fixture');}finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Meals',exact:true}).click();
  const baseline=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{
      const state=await store.load(),table=state.book.tables.find((t:{name:string})=>t.name==='Meals'),sheet=state.book.sheets.find((s:{id:string})=>s.id===table.sheet);
      return{version:state.version,visits:state.book.tableActivity?.[table.id]?.visits??0,formulas:Object.entries(sheet.cells).filter(([,cell])=>!!(cell as {formula?:unknown}).formula).map(([key,cell])=>[key,JSON.stringify((cell as {formula:unknown}).formula)])};
    }finally{store.close();}
  });
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=3300;});
  await page.waitForTimeout(100);
  const before=await page.locator('td[data-r][data-c="8"]').first().evaluate(cell=>({r:cell.getAttribute('data-r')!,c:cell.getAttribute('data-c')!,text:cell.textContent}));
  const nutrient=page.locator(`td[data-r="${before.r}"][data-c="${before.c}"]`);
  await nutrient.click();const formula=await page.locator('#formula').inputValue();expect(formula).toMatch(/^=/);
  const scroll=await page.locator('#grid-scroll').evaluate(el=>el.scrollTop);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.getByRole('button',{name:'Meals',exact:true}).click();
  await expect(page.locator('#formula')).toHaveValue(formula);
  expect(await page.locator('#grid-scroll').evaluate(el=>el.scrollTop)).toBeCloseTo(scroll,0);
  await page.waitForTimeout(700);
  const navigation=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{const state=await store.load(),table=state.book.tables.find((t:{name:string})=>t.name==='Meals');return{version:state.version,visits:state.book.tableActivity?.[table.id]?.visits??0};}finally{store.close();}
  });
  expect(navigation.version).toBe(baseline.version);expect(navigation.visits).toBeGreaterThan(baseline.visits);
  await page.locator('#formula').fill('12345');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Meals',exact:true}).click();
  await expect(nutrient).toContainText('12345');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#formula')).toHaveValue(formula);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(nutrient).toContainText('12345');
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(nutrient).toContainText('12345');
  await nutrient.click();await page.getByRole('button',{name:'Restore calculation',exact:true}).click();
  await expect(page.locator('#formula')).toHaveValue(formula);
  await expect(page.locator('#save-state')).toContainText('Saved');
  const formulas=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{const state=await store.load(),table=state.book.tables.find((t:{name:string})=>t.name==='Meals'),sheet=state.book.sheets.find((s:{id:string})=>s.id===table.sheet);return Object.entries(sheet.cells).filter(([,cell])=>!!(cell as {formula?:unknown}).formula).map(([key,cell])=>[key,JSON.stringify((cell as {formula:unknown}).formula)]);}finally{store.close();}
  });
  expect(formulas).toEqual(baseline.formulas);expect(errors).toEqual([]);
  const inputs=await page.evaluate(async()=>{
    const storage='/src/storage.ts',formula='/src/formula.ts';
    const {Store}=await import(/* @vite-ignore */storage),{Engine,scalar}=await import(/* @vite-ignore */formula),store=await Store.open();
    try{
      const state=await store.load(),t=state.book.tables.find((t:{name:string})=>t.name==='Meals'),s=state.book.sheets.find((s:{id:string})=>s.id===t.sheet),engine=new Engine(state.book);
      const detail=t.rows.slice(1,11).find((row:string)=>typeof s.cells[`${row}:${t.columns[4].column}`]?.value==='number'&&Number(scalar(engine.cell(s.id,row,t.columns[8].column)))>0);
      return{summary:s.rows.findIndex((r:{id:string})=>r.id===t.rows[0]),detail:s.rows.findIndex((r:{id:string})=>r.id===detail),grams:s.cells[`${detail}:${t.columns[4].column}`].value};
    }finally{store.close();}
  });
  await page.locator('#row-jump').fill(String(inputs.summary+1));await page.locator('#row-jump').press('Enter');
  for(const [row,column,value]of [[inputs.detail,4,String(inputs.grams*2)],[inputs.summary,2,'7']] as const){
    const summary=page.locator(`td[data-r="${inputs.summary}"][data-c="8"]`),before=await summary.innerText();
    await page.locator(`td[data-r="${row}"][data-c="${column}"]`).click();await page.locator('#formula').fill(value);await page.locator('#formula').press('Enter');
    await expect(page.locator('#save-state')).toContainText('Saved');
    const expected=await page.evaluate(async()=>{
      const storage='/src/storage.ts',formula='/src/formula.ts';
      const {Store}=await import(/* @vite-ignore */storage),{Engine,scalar}=await import(/* @vite-ignore */formula),store=await Store.open();
      try{const state=await store.load(),t=state.book.tables.find((t:{name:string})=>t.name==='Meals');return Number(scalar(new Engine(state.book).cell(t.sheet,t.rows[0],t.columns[8].column))).toPrecision(11);}finally{store.close();}
    });
    await expect(summary).toHaveText(String(+expected));expect(await summary.innerText()).not.toBe(before);
  }
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Saved');expect(errors).toEqual([]);
});
