import {test,expect,type Page} from '@playwright/test';
import {blankSheet,key,type Workbook} from '../../src/model';
import {rememberIngredients,addDraftFood} from '../../src/food-capture';
import {masterLogging} from '../../src/day-logging';

function fixture(){
  const source=blankSheet('Ingredients',405,12),log=blankSheet('Daily log',5,13);
  const names=['Ingredients','Serving (g)','Conversion Amount','Conversion Unit','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Type','Calculated'];
  const columns=names.map((name,i)=>({id:'i'+i,name,column:source.columns[i].id}));
  const table={id:'ingredients',name:'Ingredients',sheet:source.id,header:source.rows[0].id,rows:source.rows.slice(1,401).map(row=>row.id),columns};
  const book:Workbook={schema:1,id:'ingredient-table-fixture',title:'Synthetic Ingredients TABLE',revision:0,sheets:[source,log],tables:[table],names:[],pickerSources:{}};
  for(const field of columns)source.cells[key(table.header,field.column)]={value:field.name};
  for(const [index,row]of table.rows.entries())for(const [i,column]of columns.entries())source.cells[key(row,column.column)]={value:i===0?'Invented '+index:i===3?'each':i===10?'Produce':i===1?100:i===2?1:i===4?200:2};
  source.cells[key(table.rows.at(-1)!,columns[4].column)]={value:null};
  source.validations=[{id:'type-options',sheet:source.id,rows:[...table.rows],columns:[columns[10].column],source:'"Produce,Premade"',values:['Produce','Premade']}];
  const logNames=['Date','Weight','isDay','Food','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Amount (g)','Amount','Unit'];
  const master={id:'master',name:'Master',sheet:log.id,header:log.rows[0].id,rows:log.rows.slice(1,3).map(row=>row.id),columns:logNames.map((name,i)=>({id:'m'+i,name,column:log.columns[i].id}))};
  book.tables.push(master);
  for(const field of master.columns)log.cells[key(master.header,field.column)]={value:field.name};
  log.cells[key(master.rows[0],master.columns[0].column)]={value:45000};
  log.cells[key(master.rows[0],master.columns[1].column)]={value:'x'};
  log.cells[key(master.rows[0],master.columns[2].column)]={value:true};
  log.dayLogging=masterLogging(book,log).config;
  log.mealLog={table:master.id,fields:{food:'m3',weight:'m10',calories:'m4'},ingredients:{table:table.id,fields:{food:'i0',weight:'i1',amount:'i2',unit:'i3',calories:'i4',protein:'i5',fat:'i6',carbs:'i7',sugar:'i8',sodium:'i9'}}};
  rememberIngredients(book);
  const food=addDraftFood(book,45000);food.values={food:'Invented 0',weight:'25',calories:'91'};food.ingredient={table:table.id,row:table.rows[0]};
  return{book,source,log,table,columns};
}
async function local(page:Page){
  return page.evaluate(async()=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
}
async function install(page:Page){
  const f=fixture();await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toHaveText('Saved locally + recovery checkpoint');
  await page.evaluate(async book=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;book.catalogMigrations=state.book.catalogMigrations;await store.save(book,state.version,'Synthetic TABLE fixture');sessionStorage.setItem('fnt-current-sheet',book.sheets[0].id);}finally{store.close();}
  },f.book);
  await page.reload();await expect(page.getByRole('button',{name:'Ingredients TABLE',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Ingredients TABLE',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Ingredients TABLE',exact:true});
  await expect(panel).toBeVisible();
  await expect(panel.locator(`[data-row="${f.table.rows.at(-1)}"] [data-field="food"]`)).toBeInViewport();
  return{...f,panel,list:panel.locator('.capture-pane[aria-label="Ingredients TABLE"] .capture-foods')};
}
test('TABLE creates actual rows, uses shared Type choices, and preserves real edits/history/reload',async({page},info)=>{
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:740});
  const f=await install(page),last=f.table.rows.at(-1)!;
  await expect(f.panel.locator(`[data-row="${last}"] [data-field="food"]`)).toHaveValue('Invented 399');
  await expect.poll(()=>f.panel.locator('[data-ingredient-key]').count()).toBeLessThan(12);
  expect(await f.panel.evaluate(element=>element.getBoundingClientRect().right<=innerWidth)).toBe(true);
  const order=await page.locator('.toolbar-tools').evaluate(element=>[...element.children].slice(0,5).map(child=>child.getAttribute('data-action')??child.getAttribute('data-toolbar-divider')));
  expect(order.slice(0,4)).toEqual(['undo','redo','action:redo','ingredients-table']);
  await f.panel.getByRole('button',{name:'+ Ingredient',exact:true}).click();
  const added=f.panel.locator('[data-ingredient-key]').last();
  const name=added.getByRole('textbox',{name:'Ingredient Food',exact:true});await name.fill('New synthetic source');await name.press('Tab');
  await expect.poll(async()=>(await local(page)).tables.find(table=>table.id===f.table.id)!.rows.length).toBe(401);
  const state=await local(page),row=state.tables.find(table=>table.id===f.table.id)!.rows.at(-1)!;
  await expect.poll(async()=>(await local(page)).sheets[0].cells[key(row,f.columns[0].column)]?.value).toBe('New synthetic source');
  const card=f.panel.locator(`[data-row="${row}"]`);
  await card.getByRole('button',{name:'Choose Ingredient Type',exact:true}).click();
  await page.getByRole('option',{name:'Premade',exact:true}).click();
  await expect(card.getByRole('textbox',{name:'Ingredient Type',exact:true})).toHaveValue('Premade');
  await f.panel.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(card.getByRole('textbox',{name:'Ingredient Type',exact:true})).toHaveValue('');
  await f.panel.getByRole('button',{name:'Redo',exact:true}).click();
  await expect(card.getByRole('textbox',{name:'Ingredient Type',exact:true})).toHaveValue('Premade');
  await card.getByRole('button',{name:'Move Ingredient up',exact:true}).click();
  await expect.poll(async()=>(await local(page)).tables.find(table=>table.id===f.table.id)!.rows.at(-2)).toBe(row);
  await card.getByRole('button',{name:'Move Ingredient down',exact:true}).click();
  await expect.poll(async()=>(await local(page)).tables.find(table=>table.id===f.table.id)!.rows.at(-1)).toBe(row);
  await card.getByRole('button',{name:'Insert Ingredient',exact:true}).click();
  await expect.poll(async()=>(await local(page)).tables.find(table=>table.id===f.table.id)!.rows.length).toBe(402);
  const blank=(await local(page)).tables.find(table=>table.id===f.table.id)!.rows.at(-1)!;
  await f.panel.locator(`[data-row="${blank}"]`).getByRole('button',{name:'Delete Ingredient',exact:true}).click();
  await expect.poll(async()=>(await local(page)).tables.find(table=>table.id===f.table.id)!.rows.length).toBe(401);
  await f.panel.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(async()=>(await local(page)).tables.find(table=>table.id===f.table.id)!.rows.at(-1)).toBe(blank);
  await f.panel.getByRole('button',{name:'Redo',exact:true}).click();
  await f.panel.getByRole('button',{name:'Close Ingredients TABLE',exact:true}).click();
  await page.keyboard.press('Control+s');await expect(page.locator('#save-state')).toHaveText('Saved locally + recovery checkpoint');await page.reload();
  await page.getByRole('button',{name:'Ingredients TABLE',exact:true}).click();
  await expect(page.locator(`[data-row="${row}"] [data-field="food"]`)).toHaveValue('New synthetic source');
  const saved=await local(page);expect(saved.foodCapture!.foods).toHaveLength(1);expect(saved.foodCapture!.foods[0].values).toMatchObject({weight:'25',calories:'91'});
});
test('TABLE preserves unfinished source edits through reload and shares explicit Apply recovery',async({page})=>{
  const f=await install(page),row=f.table.rows.at(-1)!,card=f.panel.locator(`[data-row="${row}"]`);
  const food=card.getByRole('textbox',{name:'Ingredient Food',exact:true});
  await food.fill('Unfinished synthetic rename');
  await expect.poll(async()=>(await local(page)).foodCapture?.ingredientEdits[`${f.table.id}:${row}`]?.values.food).toBe('Unfinished synthetic rename');
  await page.reload();await page.getByRole('button',{name:'Ingredients TABLE',exact:true}).click();
  const restored=page.getByRole('complementary',{name:'Ingredients TABLE',exact:true}).locator(`[data-row="${row}"]`);
  await expect(restored.getByRole('textbox',{name:'Ingredient Food',exact:true})).toHaveValue('Unfinished synthetic rename');
  await restored.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=>(await local(page)).sheets[0].cells[key(row,f.columns[0].column)]?.value).toBe('Unfinished synthetic rename');
});
test('TABLE commits the active field on manual Save and Escape without losing focus or source edits',async({page})=>{
  const f=await install(page),row=f.table.rows.at(-1)!,input=f.panel.locator(`[data-row="${row}"] [data-field="food"]`);
  await input.fill('Saved active source');await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('Saved locally + recovery checkpoint');
  expect((await local(page)).sheets[0].cells[key(row,f.columns[0].column)].value).toBe('Saved active source');
  await expect(input).toBeFocused();
  await input.fill('Closed active source');await input.press('Escape');
  await expect(f.panel).toHaveCount(0);
  await expect.poll(async()=>(await local(page)).sheets[0].cells[key(row,f.columns[0].column)]?.value).toBe('Closed active source');
});
test('TABLE keeps scroll stable, edits the same source, preserves manual nutrition and refuses linked deletion',async({page})=>{
  const f=await install(page);await f.list.evaluate(element=>element.scrollTop=0);
  const row=f.table.rows[0],card=f.panel.locator(`[data-row="${row}"]`);
  await expect(card.getByRole('textbox',{name:'Ingredient Food',exact:true})).toHaveValue('Invented 0');
  const input=card.getByRole('textbox',{name:'Ingredient Calories',exact:true});await input.fill('400');await input.press('Tab');
  await expect.poll(async()=>(await local(page)).sheets[0].cells[key(row,f.columns[4].column)]?.value).toBe(400);
  const state=await local(page);expect(state.foodCapture!.foods[0].values).toMatchObject({weight:'25',calories:'91'});
  expect(state.foodCapture!.nutritionConflicts?.[0].calculated.calories).toBe('100');
  const dialog=page.getByRole('dialog');if(await dialog.isVisible())await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect.poll(()=>f.list.evaluate(element=>element.scrollTop)).toBeLessThan(10);
  await card.getByRole('button',{name:'Delete Ingredient',exact:true}).click();
  await expect(page.locator('#error')).toContainText('linked');
  expect((await local(page)).tables.find(table=>table.id===f.table.id)!.rows).toContain(row);
});
test('TABLE uses the existing nutrition builder and returns without adding consumption or duplicate Ingredients',async({page})=>{
  const f=await install(page);await f.panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();
  await expect(f.panel.getByRole('tab',{name:'Logged',exact:true})).toBeHidden();
  await expect(f.panel.getByRole('heading',{name:'Get nutrition',exact:true})).toBeVisible();
  await f.panel.getByRole('button',{name:'Back',exact:true}).click();
  await expect(f.panel.locator('.capture-pane[aria-label="Ingredients TABLE"]')).toBeVisible();
  expect((await local(page)).tables.find(table=>table.id===f.table.id)!.rows).toHaveLength(400);
  await f.list.evaluate(element=>element.scrollTop=0);
  await expect(f.panel.locator(`[data-row="${f.table.rows[0]}"] [data-field="food"]`)).toBeInViewport();
  await page.locator(`[data-sheet="${f.log.id}"]`).click();
  await expect(page.getByRole('button',{name:'Ingredients TABLE',exact:true})).toHaveCount(0);
  await page.locator(`[data-sheet="${f.source.id}"]`).click();
  await expect(f.panel.locator(`[data-row="${f.table.rows.at(-1)}"] [data-field="food"]`)).toBeInViewport();
});
