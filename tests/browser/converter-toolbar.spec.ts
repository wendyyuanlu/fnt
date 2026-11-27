import {expect,test,type Locator,type Page} from '@playwright/test';

async function seed(page:Page,pendingConflict=false){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async(pendingConflict)=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts');
    const {Store}=await load('storage') as typeof import('../../src/storage');
    const {blankSheet,setInput,uid}=await load('model') as typeof import('../../src/model');
    const {masterLogging}=await load('day-logging') as typeof import('../../src/day-logging');
    const {captureData,newNutritionBatch}=await load('food-capture') as typeof import('../../src/food-capture');
    const {newConverterState}=await load('nutrition-converter') as typeof import('../../src/nutrition-converter');
    const store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,sheet=blankSheet('Converter toolbar fixture',8,14);
      const names=['Date','Weight','isDay','Food','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Amount (g)','Amount','Unit','Exercise'];
      const table={id:uid(),name:'Master',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1,3).map(row=>row.id),columns:names.map((name,index)=>({id:uid(),name,column:sheet.columns[index].id}))};
      book.sheets.push(sheet);book.tables.push(table);
      for(const field of table.columns)setInput(book,sheet,table.header,field.column,field.name);
      const put=(row:number,column:number,value:string)=>setInput(book,sheet,sheet.rows[row].id,sheet.columns[column].id,value);
      put(1,0,'45000');put(1,1,'x');put(1,2,'TRUE');put(2,3,"'Synthetic lunch");put(2,10,'47');
      sheet.dayLogging=masterLogging(book,sheet).config;
      const ingredients=book.tables.find(table=>table.name==='Ingredients')!;
      const source=book.sheets.find(sheet=>sheet.id===ingredients.sheet)!;
      const fields={food:'Ingredients',weight:'Serving (g)',amount:'Conversion Amount',unit:'Conversion Unit',calories:'Calories',protein:'Protein',fat:'Fat',carbs:'Carbs',sugar:'Sugar',sodium:'Sodium'};
      const columns=Object.entries(fields).map(([field,name],index)=>({id:'toolbar-'+field,column:source.columns[index].id,name}));
      ingredients.columns=columns;
      for(const column of columns)setInput(book,source,ingredients.header,column.column,column.name);
      const data=captureData(book);
      data.ingredientMappings=[{table:ingredients.id,fields:Object.fromEntries(columns.map(column=>[column.id.slice(8),column.id]))}];
      data.builder=newNutritionBatch(book,[45000],'Synthetic toolbar request');
      data.builder.workflow='builder';data.builder.items.forEach(item=>{item.selected=false;});
      const converter=newConverterState(data.builder.id);
      converter.raw='Keep this unfinished response';converter.removeDescription=true;
      if(data.builder.items[0])converter.choices[data.builder.items[0].id]={include:false,missingReason:'Keep this reviewed exclusion'};
      data.converter=converter;
      if(pendingConflict)data.ingredientEdits[`${ingredients.id}:${ingredients.rows.at(-1)!}`]={values:{calories:'95'},base:{calories:'Outdated reference'}};
      await store.save(book,state.version,'Synthetic converter toolbar fixture');
    }finally{store.close();}
  },pendingConflict);
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
}
async function snapshot(page:Page){
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!;
      return{batch:state.book.foodCapture!.builder!,converter:state.book.foodCapture!.converter!,tables:state.book.tables,sheets:state.book.sheets.map(({id,rows,columns,cells,groups})=>({id,rows,columns,cells,groups}))};
    }finally{store.close();}
  });
}
async function activate(button:Locator,touch:boolean){if(touch)await button.tap();else await button.click();}
async function reenter(page:Page,button:Locator,touch:boolean){
  if(touch)await page.locator('.meal-log-header button[aria-label^="Close "]').tap();
  await activate(button,touch);
}
test('both toolbar entrypoints resume the one saved converter without source-table writes or batch reset',async({page,isMobile},testInfo)=>{
  await seed(page);
  const before=await snapshot(page);
  await page.getByRole('button',{name:'Converter toolbar fixture',exact:true}).click();
  const master=page.getByRole('navigation',{name:'Master logging',exact:true}),entry=master.getByRole('button',{name:'Convert table',exact:true});
  await expect(entry).toHaveClass(/icon-button/);
  await expect(master.locator('.day-create + button')).toHaveAccessibleName('Convert table');
  await expect(entry.locator('svg.toolbar-icon')).toHaveCount(1);
  if(testInfo.repeatEachIndex===0){await entry.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('master-toolbar.png')});}
  await activate(entry,isMobile);
  const converter=page.getByRole('region',{name:'Nutrition table converter',exact:true});
  await expect(converter.getByRole('textbox',{name:'Nutrition response',exact:true})).toHaveValue(before.converter.raw);
  await expect(page.locator('[data-workflow="converter"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.meal-log-panel')).toHaveCount(1);
  if(testInfo.repeatEachIndex===0)await page.screenshot({path:testInfo.outputPath('converter-resume.png')});
  await reenter(page,entry,isMobile);
  await expect(converter).toBeVisible();
  await expect(page.locator('.meal-log-panel')).toHaveCount(1);
  const updated='New unfinished response typed after opening';
  await converter.getByRole('textbox',{name:'Nutrition response',exact:true}).fill(updated);
  await page.locator('.meal-log-panel').getByRole('button',{name:'Close Meal log',exact:true}).click();
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  const ingredientsEntry=page.getByRole('button',{name:'Convert table',exact:true});
  await expect(ingredientsEntry).toHaveClass(/icon-button/);
  expect(await ingredientsEntry.evaluate(button=>button.previousElementSibling?.getAttribute('data-action'))).toBe('ingredients-table');
  if(testInfo.repeatEachIndex===0){await ingredientsEntry.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('ingredients-toolbar.png')});}
  await activate(ingredientsEntry,isMobile);
  await reenter(page,ingredientsEntry,isMobile);
  await expect(page.getByRole('region',{name:'Nutrition table converter',exact:true})).toHaveCount(1);
  await expect(page.getByRole('textbox',{name:'Nutrition response',exact:true})).toHaveValue(updated);
  await expect(page.locator('[data-workflow="converter"]')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toContainText('Saved');
  const after=await snapshot(page);
  expect(after.batch.id).toBe(before.batch.id);
  expect(after.batch.items).toEqual(before.batch.items);
  expect(after.converter).toEqual({...before.converter,raw:updated});
  expect(after.tables).toEqual(before.tables);
  expect(after.sheets).toEqual(before.sheets);
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  await activate(page.getByRole('button',{name:'Convert table',exact:true}),isMobile);
  await expect(page.getByRole('textbox',{name:'Nutrition response',exact:true})).toHaveValue(updated);
  expect((await snapshot(page)).batch.id).toBe(before.batch.id);
});
test('fresh converter entry on Ingredients and empty Master creates one batch but no food or day rows',async({page,isMobile})=>{
  await seed(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,master=state.book.tables.find(table=>table.name==='Master')!;
      master.rows=[];
      delete state.book.foodCapture!.builder;delete state.book.foodCapture!.converter;
      await store.save(state.book,state.version,'Synthetic empty nutrition entry');
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  const before=await snapshot(page);
  await activate(page.getByRole('button',{name:'Convert table',exact:true}),isMobile);
  await expect(page.getByRole('region',{name:'Nutrition table converter',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Nutrition response',exact:true})).toHaveValue('');
  await reenter(page,page.getByRole('button',{name:'Convert table',exact:true}),isMobile);
  await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toContainText('Saved');
  const first=await snapshot(page);
  expect(first.batch.id).toBeTruthy();expect(first.converter.batch).toBe(first.batch.id);
  expect(first.batch.workflow).toBe('converter');expect(first.tables).toEqual(before.tables);expect(first.sheets).toEqual(before.sheets);
  await page.locator('.meal-log-panel').getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.locator('[data-capture-view="table"]')).toBeVisible();
  await page.locator('.meal-log-panel').getByRole('button',{name:'Close Ingredients TABLE',exact:true}).click();
  await page.getByRole('button',{name:'Converter toolbar fixture',exact:true}).click();
  await activate(page.getByRole('button',{name:'Convert table',exact:true}),isMobile);
  await expect(page.getByRole('region',{name:'Nutrition table converter',exact:true})).toBeVisible();
  await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toContainText('Saved');
  const after=await snapshot(page);
  expect(after.batch.id).toBe(first.batch.id);expect(after.converter).toEqual(first.converter);
  expect(after.tables).toEqual(before.tables);expect(after.sheets).toEqual(before.sheets);
});
test('one converter activation commits the focused TABLE edit without losing the click to a redraw',async({page,isMobile})=>{
  test.skip(isMobile,'Touch TABLE is full-screen; its hidden toolbar cannot be activated.');
  await seed(page);
  const before=await snapshot(page);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.getByRole('button',{name:'Ingredients TABLE',exact:true}).click();
  const table=page.locator('[data-capture-view="table"]'),calories=table.locator('[data-field="calories"]').last();
  const row=await calories.locator('xpath=ancestor::section[@data-row]').getAttribute('data-row');
  await calories.fill('95');
  await page.getByRole('button',{name:'Convert table',exact:true}).click();
  await expect(page.getByRole('region',{name:'Nutrition table converter',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Nutrition response',exact:true})).toHaveValue(before.converter.raw);
  await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toContainText('Saved');
  const after=await snapshot(page),ingredients=after.tables.find(table=>table.name==='Ingredients')!,source=after.sheets.find(sheet=>sheet.id===ingredients.sheet)!;
  expect(source.cells[`${row}:${ingredients.columns.find(column=>column.id==='toolbar-calories')!.column}`].value).toBe(95);
  expect(after.batch.id).toBe(before.batch.id);expect(after.batch.items).toEqual(before.batch.items);
  expect(after.converter).toEqual(before.converter);
});
test('a pending TABLE source conflict keeps the editor and old workflow until reviewed',async({page,isMobile})=>{
  test.skip(isMobile,'Touch TABLE is full-screen; its hidden toolbar cannot be activated.');
  await seed(page,true);
  const before=await snapshot(page);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.getByRole('button',{name:'Ingredients TABLE',exact:true}).click();
  const table=page.locator('[data-capture-view="table"]'),calories=table.locator('[data-field="calories"]').last();
  await expect(calories).toHaveValue('95');await calories.focus();
  await page.getByRole('button',{name:'Convert table',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Ingredient source changed',exact:true})).toBeVisible();
  await expect(table).toBeVisible();await expect(calories).toHaveValue('95');
  await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toContainText('Saved');
  const after=await snapshot(page);
  expect(after.batch).toEqual(before.batch);expect(after.converter).toEqual(before.converter);
  expect(after.tables).toEqual(before.tables);expect(after.sheets).toEqual(before.sheets);
});
