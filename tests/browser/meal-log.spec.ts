import {expect,test,type Page} from '@playwright/test';
import type {Table} from '../../src/model';
import {Engine} from '../../src/formula';
import {converterFields,converterLabels} from '../../src/nutrition-table';
import {parseArchive} from '../../src/archive';
import type {Backup} from '../../src/storage';

async function setup(page:Page,extraFoods=0,splitDays=false,firstDay=20){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const fixture=await page.evaluate(async({extraFoods,splitDays,firstDay})=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts');
    const {Store}=await load('storage') as typeof import('../../src/storage'),{addTableColumns,blankSheet,renameColumn,setInput,uid}=await load('model') as typeof import('../../src/model');
    const {masterLogging}=await load('day-logging') as typeof import('../../src/day-logging'),{defaultHeaderFormula}=await load('meal-block') as typeof import('../../src/meal-block'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=blankSheet('Log test',8+extraFoods,14);book.sheets.push(s);
      const table={id:uid(),name:'Master',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,6+extraFoods).map(row=>row.id),
        columns:['Date','Weight','isDay','Food','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Amount (g)','Amount','Unit','Exercise'].map((name,i)=>({id:uid(),name,column:s.columns[i].id,formulaDefault:i===4?'=IF([@Food]="",0,10)':undefined}))};
      book.tables.push(table);table.columns.forEach(field=>setInput(book,s,table.header,field.column,field.name));
      const input=(r:number,c:number,value:string)=>setInput(book,s,s.rows[r].id,s.columns[c].id,value);
      for(let r=1;r<6;r++)input(r,2,'=[@Weight]<>""');
      for(const r of [1,4]){input(r,1,'x');input(r,0,`=DATE(2026,11,${r===1?firstDay:firstDay+1})`);for(let c=4;c<10;c++)input(r,c,defaultHeaderFormula(book,table,table.columns[c].id));}
      const ingredients=book.tables.find(table=>table.name==='Ingredients')!;
      const source=book.sheets.find(sheet=>sheet.id===ingredients.sheet)!;renameColumn(book,ingredients,ingredients.columns[0].id,'Ingredients');
      const extra=source.columns.slice(6,11);
      ['Conversion Amount','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)'].forEach((name,i)=>setInput(book,source,ingredients.header,extra[i].id,name));
      addTableColumns(book,source,ingredients,extra.map(column=>column.id));
      for(const r of [2,3,5]){
        s.cells[`${s.rows[r].id}:${s.columns[3].id}`]={binding:{table:ingredients.id,row:ingredients.rows[0],column:ingredients.columns[0].id}};
        input(r,4,'=IF([@Food]="",0,10)');input(r,5,'20');input(r,10,'300');
      }
      for(let r=6;r<6+extraFoods;r++){
        input(r,2,'=[@Weight]<>""');
        if(splitDays&&r%10===0){input(r,1,'x');input(r,0,`=DATE(2026,11,21)+${r/10}`);input(r,4,'10');input(r,5,'20');}
        else{s.cells[`${s.rows[r].id}:${s.columns[3].id}`]={binding:{table:ingredients.id,row:ingredients.rows[0],column:ingredients.columns[0].id}};input(r,4,'=IF([@Food]="",0,10)');input(r,5,'20');input(r,10,'300');}
      }
      s.validations.push({id:uid(),rows:[...table.rows],columns:[s.columns[3].id],source:'=Ingredients[Ingredients]',sheet:s.id});
      s.dayLogging=masterLogging(book,s).config;
      await store.save(book,state.version,'Synthetic meal log');
      return{sheet:s.id,table:table.id,first:s.rows[2].id,latest:s.rows[5+extraFoods].id,ingredient:ingredients.id};
    }finally{store.close();}
  },{extraFoods,splitDays,firstDay});
  await page.reload();await page.getByRole('button',{name:'Log test',exact:true}).click();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('Saved locally + recovery checkpoint');
  return fixture;
}
async function read(page:Page,sheet:string,source=''){
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  return page.evaluate(async({id,source})=>{
    const storage=source+'/src/storage.ts',logging=source+'/src/day-logging.ts';
    const {Store}=await import(/* @vite-ignore */storage),{masterDayBlocks}=await import(/* @vite-ignore */logging),store=await Store.open();
    try{const state=(await store.load())!,sheet=state.book.sheets.find((s:{id:string})=>s.id===id)!;return{book:state.book,sheet,blocks:masterDayBlocks(state.book,sheet)};}finally{store.close();}
  },{id:sheet,source});
}
async function privateGalleryServer(page:Page){
  const files=new Map<string,{sha:string;content:string}>(),writes:string[]=[];let revision=0;
  const settings={private:true,pages:false,conflict:false,holdIndex:false},waiting:(()=>void)[]=[];
  await page.route('https://api.github.com/**',async route=>{
    const request=route.request(),url=new URL(request.url()),root='/repos/synthetic/private-photo-data',path=decodeURIComponent(url.pathname.split('/contents/')[1]??'');
    const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname===root)return json({private:settings.private,has_pages:settings.pages});
    if(!url.pathname.startsWith(root+'/contents/'))return json({message:'Synthetic destination not found'},404);
    if(request.method()==='PUT'){
      const body=request.postDataJSON() as {sha?:string;content:string};writes.push(path);
      if(path==='photos/index.json'&&settings.holdIndex)await new Promise<void>(resolve=>waiting.push(resolve));
      if(path==='photos/index.json'&&settings.conflict){settings.conflict=false;return json({message:'Synthetic conflict'},409);}
      if(files.get(path)?.sha!==body.sha)return json({message:'Synthetic revision conflict'},409);
      const sha=(++revision).toString(16).padStart(40,'0');files.set(path,{sha,content:body.content});return json({content:{sha}});
    }
    const file=files.get(path);return file?json({...file,encoding:'base64',size:Buffer.from(file.content,'base64').length}):json({message:'Not found'},404);
  });
  return{files,writes,settings,release:()=>{settings.holdIndex=false;for(const finish of waiting.splice(0))finish();}};
}
async function openPrivateGallery(page:Page){
  await page.locator('.meal-log-panel').getByRole('combobox',{name:'Food panels',exact:true}).click();
  await page.getByRole('option',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:'Private photo gallery',exact:true}).click();
  return page.getByRole('dialog',{name:'Private photo gallery',exact:true});
}
async function connectPrivateGallery(page:Page,automatic=false){
  const dialog=page.getByRole('dialog',{name:'Private photo gallery',exact:true});
  await dialog.getByLabel('Personal repository owner',{exact:true}).fill('synthetic');
  await dialog.getByLabel('Private data repository',{exact:true}).fill('private-photo-data');
  await dialog.getByLabel('Existing branch',{exact:true}).fill('main');
  await dialog.getByLabel('Separate gallery JSON path',{exact:true}).fill('photos/index.json');
  await dialog.getByLabel('Fine-grained token: Contents read/write for only this data repository',{exact:true}).fill('invented-gallery-token');
  await dialog.getByLabel('Automatically upload newly captured photos while connected',{exact:true}).setChecked(automatic);
  await dialog.getByRole('button',{name:'Connect and verify gallery',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('connected for this tab');
  return dialog;
}

test('Logged and Draft share the two-bar header without changing logged foods or losing Logged state',async({page,isMobile})=>{
  const fixture=await setup(page,80),toolbar=page.getByRole('navigation',{name:'Master logging'});
  expect(await toolbar.locator(':scope > button,.day-create > button').evaluateAll(buttons=>buttons.map(button=>button.textContent?.trim()||button.getAttribute('aria-label')))).toEqual(['Meal log','Draft','+ Day','Convert table','+ Food']);
  await expect(page.locator('#meal-draft')).toHaveClass(/icon-button/);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),formal=panel.getByRole('tab',{name:'Logged',exact:true}),draft=panel.getByRole('tab',{name:'Draft',exact:true});
  await expect(formal).toHaveAttribute('aria-selected','true');await expect(panel.getByRole('button',{name:'Get Nutrition',exact:true})).toBeEnabled();
  const top=(await panel.locator('.meal-log-header').boundingBox())!,days=(await panel.locator('.meal-log-day-bar').first().boundingBox())!;
  expect(days.y).toBeCloseTo(top.y+top.height,0);
  const card=panel.locator('[data-log-card]').last(),grams=card.getByRole('textbox',{name:'Grams',exact:true});
  await grams.fill('321');await card.locator('.meal-log-macros summary').click();
  const input=await grams.elementHandle(),date=await panel.locator('[data-log-date]').textContent(),scroll=panel.locator('#meal-log-formal');
  await scroll.evaluate(element=>element.scrollTop=500);
  const position=await scroll.evaluate(element=>element.scrollTop),before=await read(page,fixture.sheet);
  await draft.click();await expect(draft).toHaveAttribute('aria-selected','true');await expect(formal).toHaveAttribute('tabindex','-1');
  await expect(panel.getByRole('tabpanel',{name:'Draft',exact:true})).toBeVisible();
  await expect(panel.locator('.meal-log-day-bar').first()).toBeHidden();await expect(scroll).toBeHidden();await expect(panel.locator('.meal-log-footer').last()).toBeHidden();
  await expect(panel.getByLabel('Draft date',{exact:true})).toBeVisible();
  await draft.press('ArrowLeft');await expect(formal).toBeFocused();await expect(formal).toHaveAttribute('aria-selected','true');
  await expect(grams).toHaveValue('321');expect(await input!.evaluate(element=>element.isConnected)).toBe(true);
  await expect(card.locator('.meal-log-macros')).toHaveAttribute('open','');await expect(panel.locator('[data-log-date]')).toHaveText(date!);
  await expect.poll(()=>scroll.evaluate(element=>element.scrollTop)).toBe(position);
  const after=await read(page,fixture.sheet);expect(after.sheet).toEqual(before.sheet);expect(after.blocks).toEqual(before.blocks);
  if(!isMobile){
    await page.locator('#meal-draft').click();await expect(draft).toHaveAttribute('aria-selected','true');await expect(page.locator('#meal-draft')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#meal-log')).toHaveAttribute('aria-pressed','false');
    await page.locator('#meal-log').click();await expect(formal).toHaveAttribute('aria-selected','true');
  }
  await panel.getByRole('button',{name:'Close Meal log',exact:true}).click();
  await page.locator('#meal-draft').click();await expect(draft).toHaveAttribute('aria-selected','true');
  await expect(panel.getByRole('button',{name:'Get Nutrition',exact:true})).toBeEnabled();
  for(const width of isMobile?[390,320]:[1365]){
    await page.setViewportSize({width,height:844});
    expect(await panel.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
    const header=panel.locator('.meal-log-header');
    expect(await header.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
    await formal.click();
    expect(await panel.locator('.meal-log-day-bar').first().evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
    await draft.click();
  }
  await panel.getByRole('button',{name:'Close Meal log',exact:true}).click();await expect(panel).toHaveCount(0);
  await expect(page.locator('#error')).toBeHidden();
});
test('opening Draft on a Master with no days leaves rows, cells, groups and logging metadata untouched',async({page})=>{
  const fixture=await setup(page);
  await page.evaluate(async({sheet,table})=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,source=state.book.sheets.find(item=>item.id===sheet)!;
      state.book.tables.find(item=>item.id===table)!.rows=[];source.groups=[];delete source.mealLog;
      await store.save(state.book,state.version,'Synthetic empty Master');
    }finally{store.close();}
  },fixture);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const before=await read(page,fixture.sheet);expect(before.blocks).toEqual([]);
  await page.locator('#meal-draft').click();
  const panel=page.locator('.meal-log-panel');await expect(panel.getByRole('tab',{name:'Draft',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(panel.getByRole('tabpanel',{name:'Draft',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Close Meal log',exact:true}).click();
  const after=await read(page,fixture.sheet);expect(after.sheet).toEqual(before.sheet);expect(after.blocks).toEqual([]);
  expect(after.book.tables).toEqual(before.book.tables);
});
test('Draft saves food, hidden mode values and linked restaurant edits without creating Master rows',async({page,isMobile})=>{
  const fixture=await setup(page),before=await read(page,fixture.sheet);
  await page.locator('#meal-draft').click();
  const panel=page.locator('.meal-log-panel'),draft=panel.getByRole('region',{name:'Draft foods'}),cards=draft.locator('[data-draft-card]');
  await draft.locator('[data-draft-add]').click();
  const first=cards.first();
  await first.getByRole('textbox',{name:'Draft Food',exact:true}).fill('Synthetic red bean mochi');
  await first.getByRole('textbox',{name:'Restaurant',exact:true}).fill('Synthetic Kyoto Cafe');
  await first.getByRole('textbox',{name:'Restaurant',exact:true}).press('Tab');
  await first.getByRole('textbox',{name:'Draft Amount',exact:true}).fill('2');
  await first.getByRole('textbox',{name:'Draft Unit',exact:true}).fill('each');
  await first.getByRole('tab',{name:'Multi',exact:true}).click();
  await expect(first.getByRole('checkbox',{name:'Add as ingredient'})).toBeDisabled();
  await expect(first.getByRole('textbox',{name:'Draft Food',exact:true})).toHaveValue('Synthetic red bean mochi');
  await first.getByRole('tab',{name:'Single',exact:true}).click();
  await first.locator('.meal-log-notes summary').click();
  await first.getByRole('textbox',{name:'Draft Notes',exact:true}).fill('Synthetic label to check later');
  await first.getByRole('button',{name:'+ Food',exact:true}).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.last().getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Synthetic Kyoto Cafe');
  await cards.last().getByRole('textbox',{name:'Draft Food',exact:true}).fill('Synthetic second dish');
  await draft.getByRole('button',{name:'Restaurants',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Restaurants',exact:true});
  await dialog.getByRole('textbox',{name:'Restaurant name',exact:true}).fill('Synthetic Renamed Cafe');
  await dialog.getByRole('button',{name:'Rename',exact:true}).click();
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(first.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Synthetic Renamed Cafe');
  await expect(cards.last().getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Synthetic Renamed Cafe');
  await first.getByRole('button',{name:'Unlink restaurant',exact:true}).click();
  await expect(first.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('');
  await panel.getByRole('tab',{name:'Logged',exact:true}).click();
  await panel.getByRole('tab',{name:'Draft',exact:true}).click();
  await expect(first.getByRole('textbox',{name:'Draft Amount',exact:true})).toHaveValue('2');
  await expect(first.getByRole('textbox',{name:'Draft Unit',exact:true})).toHaveValue('each');
  await expect(first.getByRole('textbox',{name:'Draft Notes',exact:true})).toHaveValue('Synthetic label to check later');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  await expect(cards).toHaveCount(2);
  await expect(first.getByRole('textbox',{name:'Draft Food',exact:true})).toHaveValue('Synthetic red bean mochi');
  await expect(first.getByRole('textbox',{name:'Draft Amount',exact:true})).toHaveValue('2');
  await expect(cards.last().getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Synthetic Renamed Cafe');
  await first.getByRole('button',{name:'Delete draft food',exact:true}).click();
  await page.getByRole('dialog',{name:'Delete draft food?',exact:true}).getByRole('button',{name:'Delete food',exact:true}).click();
  await expect(cards).toHaveCount(1);await draft.getByRole('button',{name:'Undo',exact:true}).click();await expect(cards).toHaveCount(2);
  await draft.getByRole('button',{name:'Redo',exact:true}).click();await expect(cards).toHaveCount(1);
  await draft.getByRole('button',{name:'Undo',exact:true}).click();await expect(cards).toHaveCount(2);
  if(isMobile){await page.setViewportSize({width:320,height:844});expect(await draft.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);}
  const after=await read(page,fixture.sheet);
  // Opening Logged may remember field IDs, but Draft must not create consumption records.
  expect(after.sheet.rows).toEqual(before.sheet.rows);expect(after.sheet.cells).toEqual(before.sheet.cells);
  expect(after.book.tables.find((table:Table)=>table.id===fixture.table)?.rows).toEqual(before.book.tables.find((table:Table)=>table.id===fixture.table)?.rows);
  expect(after.book.foodCapture?.foods).toHaveLength(2);
});
test('Ingredient pane and direct table edits preserve serving independence, explicit manual choices and stable links after renames',async({page,isMobile})=>{
  const fixture=await setup(page);await page.locator('#meal-draft').click();
  const panel=page.locator('.meal-log-panel'),draft=panel.getByRole('region',{name:'Draft foods'}),editor=panel.getByRole('region',{name:'Ingredient editor'});
  const ingredients=async()=>{await panel.getByRole('combobox',{name:'Food panels',exact:true}).click();await page.getByRole('option',{name:'Ingredients',exact:true}).click();};
  await ingredients();
  const source=editor.locator('[data-ingredient-key]').first(),name=await source.getByRole('textbox',{name:'Ingredient Ingredient',exact:true}).inputValue();
  for(const [field,value]of [['Reference grams','25'],['Reference amount','1'],['Reference unit','each'],['Calories','70'],['Protein (g)','2'],['Fat (g)','3'],['Carbs (g)','8'],['Sugar (g)','0'],['Sodium (mg)','0']]){
    await source.getByRole('textbox',{name:'Ingredient '+field,exact:true}).fill(value);
  }
  await expect(source.getByRole('status')).toContainText('Draft edits saved locally');
  await source.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(source.getByRole('status')).toHaveText('Nutrition complete');
  const initialReview=page.getByRole('dialog',{name:'Review nutrition changes',exact:true});
  await expect(initialReview.locator('tbody tr')).toHaveCount(3);
  await expect(initialReview.locator('tbody tr').filter({hasText:'(Logged) / protein'})).toHaveCount(3);
  await initialReview.getByRole('button',{name:'Keep all manual',exact:true}).click();await initialReview.getByRole('button',{name:'Apply choices',exact:true}).click();
  await panel.getByRole('tab',{name:'Draft',exact:true}).click();await draft.locator('[data-draft-add]').click();
  const food=draft.locator('[data-draft-card]').first();
  await food.getByRole('textbox',{name:'Draft Food',exact:true}).fill('Original manual description');
  await food.getByRole('textbox',{name:'Draft Amount',exact:true}).fill('2');
  await food.getByRole('textbox',{name:'Draft Unit',exact:true}).fill('each');
  await food.locator('.meal-log-macros summary').click();await food.getByRole('textbox',{name:'Draft Calories',exact:true}).fill('99');
  await food.getByRole('combobox',{name:'Choose draft Ingredient',exact:true}).click();await expect(page.locator('.cell-dropdown input').first()).toBeFocused();await page.getByRole('option',{name,exact:true}).click();
  let review=page.getByRole('dialog',{name:'Review nutrition changes',exact:true});
  await review.getByRole('button',{name:'Keep all manual',exact:true}).click();await review.getByRole('button',{name:'Apply choices',exact:true}).click();
  await expect(food.getByRole('textbox',{name:'Draft Calories',exact:true})).toHaveValue('99');
  await expect(food.getByRole('textbox',{name:'Draft Grams',exact:true})).toHaveValue('50');
  await expect(food.getByRole('textbox',{name:'Draft Protein (g)',exact:true})).toHaveValue('4');
  await ingredients();await source.getByRole('textbox',{name:'Ingredient Calories',exact:true}).fill('80');
  await source.getByRole('button',{name:'Apply',exact:true}).click();
  review=page.getByRole('dialog',{name:'Review nutrition changes',exact:true});await expect(review).toBeVisible();
  await review.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(editor.getByRole('button',{name:'Review nutrition changes (1)',exact:true})).toBeVisible();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();await ingredients();
  await editor.getByRole('button',{name:'Review nutrition changes (1)',exact:true}).click();
  review=page.getByRole('dialog',{name:'Review nutrition changes',exact:true});
  await review.getByRole('button',{name:'Keep all manual',exact:true}).click();await review.getByRole('button',{name:'Apply choices',exact:true}).click();
  const saved=await read(page,fixture.sheet),mapping=saved.book.foodCapture.ingredientMappings.find((mapping:{table:string})=>mapping.table===fixture.ingredient);
  const target=saved.book.tables.find((table:Table)=>table.id===fixture.ingredient),sourceSheet=saved.book.sheets.find((sheet:{id:string})=>sheet.id===target.sheet);
  const column=target.columns.find((column:{id:string})=>column.id===mapping.fields.calories).column;
  const sourceRow=sourceSheet.rows.findIndex((row:{id:string})=>row.id===target.rows[0]),sourceColumn=sourceSheet.columns.findIndex((field:{id:string})=>field.id===column);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  const calorieCell=page.locator(`td[data-r="${sourceRow}"][data-c="${sourceColumn}"]`);await calorieCell.click();if(isMobile)await calorieCell.click();
  await page.locator('#formula').fill('90');await page.locator('#formula').press('Enter');
  review=page.getByRole('dialog',{name:'Review nutrition changes',exact:true});await expect(review).toBeVisible();
  await review.getByRole('button',{name:'Use all recalculated',exact:true}).click();await review.getByRole('button',{name:'Apply choices',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async ingredient=>{
    const storage='/src/storage.ts',model='/src/model.ts';
    const {Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),{renameColumn,setInput}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),store=await Store.open();
    try{
      const state=(await store.load())!,table=state.book.tables.find(table=>table.id===ingredient)!,sheet=state.book.sheets.find(sheet=>sheet.id===table.sheet)!;
      const name=table.columns[0];table.name='Synthetic renamed pantry';renameColumn(state.book,table,name.id,'Synthetic pantry name');setInput(state.book,sheet,table.rows[0],name.column,"'Renamed synthetic Ingredient");
      await store.save(state.book,state.version,'Synthetic source rename');
    }finally{store.close();}
  },fixture.ingredient);
  await page.reload();await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  await expect(food.getByRole('textbox',{name:'Draft Food',exact:true})).toHaveValue('Renamed synthetic Ingredient');
  await expect(food.getByRole('textbox',{name:'Draft Grams',exact:true})).toHaveValue('50');
  await food.locator('.meal-log-macros summary').click();
  await expect(food.getByRole('textbox',{name:'Draft Calories',exact:true})).toHaveValue('180');
  await expect(food.getByRole('textbox',{name:'Draft Amount',exact:true})).toHaveValue('2');
  await expect(food.getByRole('textbox',{name:'Draft Unit',exact:true})).toHaveValue('each');
});
for(const route of ['cell','bulk','bound'] as const)test(`Logged and Draft manual nutrition reviews survive ${route} source edits, mixed choices, Undo and consumption changes`,async({page,isMobile})=>{
  const fixture=await setup(page);
  const target=await page.evaluate(async({fixture,route})=>{
    const storage='/src/storage.ts',model='/src/model.ts',capture='/src/food-capture.ts',dates='/src/day-logging.ts';
    const {Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),{addRow,getCell,key,setInput}=await import(/* @vite-ignore */model) as typeof import('../../src/model');
    const {addDraftFood,captureData,rememberIngredients}=await import(/* @vite-ignore */capture) as typeof import('../../src/food-capture'),{localToday}=await import(/* @vite-ignore */dates) as typeof import('../../src/day-logging');
    const store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,mapping=rememberIngredients(book),table=book.tables.find(table=>table.id===mapping.table)!,source=book.sheets.find(sheet=>sheet.id===table.sheet)!;
      const column=(field:keyof typeof mapping.fields)=>table.columns.find(column=>column.id===mapping.fields[field])!.column;
      for(const [field,value]of [['weight','25'],['amount','1'],['unit','each'],['calories','70']] as const)setInput(book,source,table.rows[0],column(field),value);
      if(table.rows.length<2)addRow(book,source,source.rows.findIndex(row=>row.id===table.rows[0])+1,table);
      const log=book.tables.find(table=>table.id===fixture.table)!,sheet=book.sheets.find(sheet=>sheet.id===log.sheet)!;
      const calories=log.columns.find(column=>column.name==='Calories')!.column,weight=log.columns.find(column=>column.name==='Amount (g)')!.column;
      const ref=(sheet:string,row:string,column:string)=>({kind:'ref' as const,sheet,row,column,absRow:true,absCol:true});
      sheet.cells[key(fixture.latest,calories)]={...getCell(sheet,fixture.latest,calories),formula:{kind:'binary',op:'*',left:{kind:'binary',op:'/',left:ref(source.id,table.rows[0],column('calories')),right:ref(source.id,table.rows[0],column('weight'))},right:ref(sheet.id,fixture.latest,weight)}};
      setInput(book,sheet,fixture.latest,weight,'50');setInput(book,sheet,fixture.latest,calories,'99');
      if(route==='bound'){
        const foodColumn=log.columns.find(column=>column.name==='Food')!.column,name=table.columns.find(column=>column.id===mapping.fields.food)!;
        sheet.cells[key(fixture.latest,foodColumn)]={binding:{table:table.id,row:table.rows[0],column:name.id}};
        sheet.cells[key(fixture.latest,calories)]={value:99};
      }
      const food=addDraftFood(book,localToday());food.ingredient={table:table.id,row:table.rows[0]};food.values={food:'Original synthetic manual description',amount:'2',unit:'each',calories:'77'};
      captureData(book).selectedDate=food.date;
      await store.save(book,state.version,'Synthetic manual dependency fixture');
      return{row:source.rows.findIndex(row=>row.id===table.rows[0]),column:source.columns.findIndex(field=>field.id===column('calories')),calories,weight,sourceWeight:column('weight'),sourceRow:table.rows[0],sourceSheet:source.id};
    }finally{store.close();}
  },{fixture,route});
  await page.reload();await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),logged=panel.locator('[data-log-card]').first();
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  const cell=page.locator(`td[data-r="${target.row}"][data-c="${target.column}"]`);await cell.click();if(isMobile)await cell.click();
  if(route!=='bulk'){await page.locator('#formula').fill('80');await page.locator('#formula').press('Enter');}
  else await cell.evaluate(element=>{const data=new DataTransfer();data.setData('text/plain','80\n90');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  let review=page.getByRole('dialog',{name:'Review nutrition changes',exact:true});await expect(review).toBeVisible();
  await expect(review.locator('tbody tr')).toHaveCount(2);await expect(review).toContainText('160');
  await review.getByRole('button',{name:'Close dialog',exact:true}).click();
  const pending=await read(page,fixture.sheet);
  expect(pending.sheet.cells[`${fixture.latest}:${target.calories}`].value).toBe(99);expect(pending.book.foodCapture.foods[0].values.calories).toBe('77');
  expect(pending.book.foodCapture.nutritionConflicts).toHaveLength(2);
  await page.reload();await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-log').click();
  const openReview=async(count:number)=>{
    const trigger=panel.getByRole('combobox',{name:'Food panels',exact:true}),search=page.getByRole('searchbox',{name:'Search dropdown options',exact:true});
    await trigger.click();await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).toHaveCount(0);await expect(panel).toBeVisible();await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','false');
    await trigger.press('ArrowDown');await expect(search).toBeFocused();
    await page.getByRole('option',{name:`Review nutrition changes (${count})`,exact:true}).click();
  };
  await openReview(2);review=page.getByRole('dialog',{name:'Review nutrition changes',exact:true});
  await review.locator('tbody tr').filter({hasText:'(Logged)'}).getByRole('radio').last().check();
  await review.getByRole('button',{name:'Apply choices',exact:true}).click();
  let applied=await read(page,fixture.sheet);
  expect(new Engine(applied.book).cell(fixture.sheet,fixture.latest,target.calories)).toBe(160);
  expect(applied.book.foodCapture.foods[0].values.calories).toBe('77');expect(applied.book.foodCapture.nutritionConflicts).toEqual([]);
  await panel.locator('.meal-log-footer').getByRole('button',{name:'Undo',exact:true}).click();
  expect((await read(page,fixture.sheet)).book.foodCapture.nutritionConflicts).toHaveLength(2);
  await panel.locator('.meal-log-footer').getByRole('button',{name:'Redo',exact:true}).click();
  await logged.locator('.meal-log-macros summary').click();await logged.getByRole('textbox',{name:'Calories',exact:true}).fill('333');
  const grams=logged.getByRole('textbox',{name:'Grams',exact:true});if(!await grams.isVisible())await logged.locator('.meal-log-quantities summary').click();
  await grams.fill('60');await grams.press('Tab');
  await expect(page.getByRole('dialog',{name:'Review nutrition changes',exact:true})).toHaveCount(0);
  await openReview(1);review=page.getByRole('dialog',{name:'Review nutrition changes',exact:true});await expect(review).toContainText('192');
  await review.getByRole('button',{name:'Use all recalculated',exact:true}).click();await review.getByRole('button',{name:'Apply choices',exact:true}).click();
  applied=await read(page,fixture.sheet);expect(new Engine(applied.book).cell(fixture.sheet,fixture.latest,target.calories)).toBe(192);
  await page.reload();await page.getByRole('button',{name:'Log test',exact:true}).click();
  applied=await read(page,fixture.sheet);expect(new Engine(applied.book).cell(fixture.sheet,fixture.latest,target.calories)).toBe(192);
  expect(applied.sheet.cells[`${fixture.latest}:${target.weight}`].value).toBe(60);
  expect(applied.book.sheets.find((sheet:{id:string})=>sheet.id===target.sourceSheet).cells[`${target.sourceRow}:${target.sourceWeight}`].value).toBe(25);
  expect(applied.book.foodCapture.foods[0].values).toMatchObject({amount:'2',unit:'each',calories:'77'});expect(applied.book.foodCapture.nutritionConflicts).toEqual([]);
});
test('Multi requests without Notes survive durable read-back and reload',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-draft').click();
  const panel=page.locator('.meal-log-panel'),draft=panel.getByRole('region',{name:'Draft foods'});
  await draft.locator('[data-draft-add]').click();
  const card=draft.locator('[data-draft-card]').first();await card.getByRole('textbox',{name:'Draft Food',exact:true}).fill('First synthetic dish\nSecond synthetic dish');
  await card.getByRole('tab',{name:'Multi',exact:true}).click();
  await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();
  const before=await read(page,fixture.sheet),items=before.book.foodCapture.builder.items.filter((item:{kind:string})=>item.kind==='draft');
  expect(items.map((item:{values:{food:string}})=>item.values.food)).toEqual(['First synthetic dish','Second synthetic dish']);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await expect(page.locator('#error')).toBeHidden();
  const after=await read(page,fixture.sheet);expect(after.book.foodCapture.builder).toEqual(before.book.foodCapture.builder);
});
test('nutrition requests resume, validate reference servings, keep original descriptions and recopy live reviewed names and notes',async({page,context})=>{
  const fixture=await setup(page);await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('#meal-draft').click();
  const panel=page.locator('.meal-log-panel'),draft=panel.getByRole('region',{name:'Draft foods'}),cards=draft.locator('[data-draft-card]');
  await draft.locator('[data-draft-add]').click();
  await cards.first().getByRole('textbox',{name:'Draft Food',exact:true}).fill('Synthetic curry with 40g rice and sesame oil');
  await cards.first().getByRole('textbox',{name:'Restaurant',exact:true}).fill('Synthetic Bistro');await cards.first().getByRole('textbox',{name:'Restaurant',exact:true}).press('Tab');
  await cards.first().locator('.meal-log-notes summary').click();await cards.first().getByRole('textbox',{name:'Draft Notes',exact:true}).fill('Synthetic optional nutrition context');
  await draft.locator('[data-draft-add]').click();await cards.last().getByRole('textbox',{name:'Draft Food',exact:true}).fill('Synthetic missing-reference Ingredient');
  await cards.last().getByRole('checkbox',{name:'Add as ingredient',exact:true}).click();
  await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();
  const builder=panel.getByRole('region',{name:'Nutrition builder'}),items=builder.locator('[data-nutrition-item]');
  await expect(builder.getByRole('button',{name:'Prompt builder',exact:true})).toHaveCSS('font-weight','600');
  const curry=items.filter({has:page.locator('[data-original]',{hasText:'Original description: Synthetic curry with 40g rice and sesame oil'})});
  const ingredient=items.filter({has:page.locator('[data-original]',{hasText:'Original description: Synthetic missing-reference Ingredient'})});
  await expect(ingredient).toHaveCount(1);
  await builder.getByRole('button',{name:'Generate prompt',exact:true}).click();await expect(page.locator('#error')).toContainText('reference serving');
  await ingredient.getByRole('textbox',{name:'Nutrition reference serving',exact:true}).fill('40g');
  await builder.getByRole('button',{name:'Set missing to 100g',exact:true}).click();
  await expect(ingredient.getByRole('textbox',{name:'Nutrition reference serving',exact:true})).toHaveValue('40g');
  await builder.getByRole('button',{name:'Generate prompt',exact:true}).click();
  const prompt=builder.getByRole('textbox',{name:'Generated nutrition prompt',exact:true});
  await expect(prompt).toHaveValue(/"grams": 40/);await expect(prompt).not.toHaveValue(/Synthetic optional nutrition context/);
  await expect(builder.locator('[data-items]')).not.toHaveAttribute('open','');await builder.locator('[data-items] > summary').click();
  await curry.getByRole('checkbox',{name:'Include notes',exact:true}).check();
  await expect(prompt).toHaveValue(/Synthetic optional nutrition context/);
  await builder.getByRole('checkbox',{name:'Review names',exact:true}).check();
  await curry.getByRole('textbox',{name:'Dish name',exact:true}).fill('Reviewed synthetic curry');
  await expect(prompt).toHaveValue(/"dishName": "Reviewed synthetic curry"/);
  await expect(prompt).toHaveValue(/"originalDescription": "Synthetic curry with 40g rice and sesame oil"/);
  await builder.getByRole('button',{name:'Copy prompt',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain('"dishName": "Reviewed synthetic curry"');
  await expect(page.locator('#grid-scroll .copying')).toHaveCount(0);
  await curry.getByRole('textbox',{name:'Dish name',exact:true}).fill('Revised synthetic curry');
  await expect(builder.locator('[data-copy-status]')).toHaveText('Prompt changed — copy again.');
  await curry.getByRole('checkbox',{name:'Include notes',exact:true}).uncheck();
  await builder.getByRole('button',{name:'Copy prompt',exact:true}).click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());expect(copied).toContain('"dishName": "Revised synthetic curry"');expect(copied).not.toContain('Synthetic optional nutrition context');
  await expect(page.locator('#grid-scroll .copying')).toHaveCount(0);
  const before=await read(page,fixture.sheet),batch=before.book.foodCapture.builder;
  await page.reload();await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();
  await expect(prompt).toHaveValue(/"dishName": "Revised synthetic curry"/);
  await builder.getByRole('button',{name:'Back',exact:true}).click();
  await draft.locator('[data-draft-add]').click();await cards.last().getByRole('textbox',{name:'Draft Food',exact:true}).fill('Synthetic newcomer');
  await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();await expect(items.filter({hasText:'Synthetic newcomer'})).toHaveCount(0);
  await builder.getByRole('button',{name:'Check new food',exact:true}).click();await expect(items.filter({hasText:'Synthetic newcomer'})).toHaveCount(1);
  const after=await read(page,fixture.sheet),updated=after.book.foodCapture.builder;
  expect(updated.id).toBe(batch.id);
  for(const item of batch.items)expect(updated.items.find((candidate:{id:string})=>candidate.id===item.id)).toEqual(item);
  expect(after.book.foodCapture.foods[0].values.food).toBe('Synthetic curry with 40g rice and sesame oil');
});

test('real browser photo decoding bounds previews and rejects malformed imports without partial metadata',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-draft').click();
  const result=await page.evaluate(async()=>{
    const path='/src/photo-images.ts',{makePhotoThumbnail}=await import(/* @vite-ignore */path) as typeof import('../../src/photo-images');
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const context=canvas.getContext('2d')!;context.fillStyle='#153e36';context.fillRect(0,0,512,128);
    const original=globalThis.createImageBitmap,results:{fallback:boolean;mime:string;width:number;height:number;bytes:number;output:string}[]=[];
    try{
      for(const fallback of [false,true]){
        if(fallback)Reflect.set(globalThis,'createImageBitmap',undefined);
        for(const mime of ['image/png','image/jpeg','image/webp']){
          const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),mime)),preview=await makePhotoThumbnail(blob),decoded=await original(preview);
          results.push({fallback,mime,width:decoded.width,height:decoded.height,bytes:preview.size,output:preview.type});decoded.close();
        }
      }
    }finally{Reflect.set(globalThis,'createImageBitmap',original);}
    return results;
  });
  expect(result).toHaveLength(6);
  for(const entry of result){expect(entry.width).toBe(256);expect(entry.height).toBe(64);expect(entry.output).toBe('image/jpeg');expect(entry.bytes).toBeLessThanOrEqual(128*1024);}
  const draft=page.getByRole('region',{name:'Draft foods'}),before=await read(page,fixture.sheet);
  for(const [width,height,message]of [[8192,8192,'32 megapixels'],[10,10,'Photo preview failed']] as const){
    const bytes=Buffer.alloc(32);bytes.set([137,80,78,71,13,10,26,10]);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);
    const choice=page.waitForEvent('filechooser');await draft.getByRole('button',{name:'Add photo',exact:true}).click();
    await page.getByRole('dialog',{name:'Take photo',exact:true}).getByRole('button',{name:'Take photo',exact:true}).click();
    await(await choice).setFiles({name:'Synthetic invalid.png',mimeType:'image/png',buffer:bytes});
    await expect(page.getByRole('alert')).toContainText(message);await page.getByRole('button',{name:'Dismiss error',exact:true}).click();
    const after=await read(page,fixture.sheet);expect(after.book.foodCapture).toEqual(before.book.foodCapture);
  }
});

test('photo capture, organization and removal preserve original bytes, food links and recovery',async({page})=>{
  const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
  const fixture=await setup(page);await page.locator('#meal-draft').click();
  const draft=page.getByRole('region',{name:'Draft foods'});await draft.locator('[data-draft-add]').click();
  const card=draft.locator('[data-draft-card]').first();
  await card.getByRole('textbox',{name:'Draft Food',exact:true}).fill('Synthetic photo sushi');
  await card.getByRole('textbox',{name:'Restaurant',exact:true}).fill('Synthetic photo cafe');
  await card.getByRole('textbox',{name:'Restaurant',exact:true}).press('Tab');
  const image=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d')!;
    context.fillStyle='#267';context.fillRect(0,0,640,480);return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  const add=async(button:ReturnType<Page['getByRole']>,name:string)=>{
    const chooser=page.waitForEvent('filechooser');await button.click();const input=await chooser;
    await input.setFiles({name,mimeType:'image/png',buffer:image});
    await expect(draft.getByRole('button',{name:'Open photo '+name,exact:true}).locator('img')).toBeVisible();
    return read(page,fixture.sheet);
  };
  await draft.getByRole('button',{name:'Add photo',exact:true}).click();
  const camera=page.getByRole('dialog',{name:'Take photo',exact:true});
  await expect(camera).toHaveClass(/dialog-surface.*popover/);await expect(camera.locator('h2')).toHaveText('Take photo');
  await expect(camera.getByRole('checkbox',{name:'Save to gallery',exact:true})).not.toBeChecked();
  const general=await add(camera.getByRole('button',{name:'Take photo',exact:true}),'Synthetic general.png');
  expect(general.book.foodCapture.foods[0].photos).toEqual([]);expect(general.book.foodCapture.photos).toHaveLength(1);
  expect(downloads).toEqual([]);
  const linked=await add(card.getByRole('button',{name:'Upload photo',exact:true}),'Synthetic linked.png');
  expect(downloads).toEqual([]);
  expect(linked.book.foodCapture.foods[0].photos).toHaveLength(1);expect(linked.book.foodCapture.photos).toHaveLength(2);
  expect(linked.sheet).toEqual(general.sheet);
  await draft.getByRole('checkbox',{name:'Select photo Synthetic general.png',exact:true}).check();
  await draft.getByRole('combobox',{name:'Organize selected photos',exact:true}).click();
  await page.getByRole('option',{name:'Synthetic photo sushi',exact:true}).click();
  const organized=await read(page,fixture.sheet);
  expect(organized.book.foodCapture.foods[0].photos).toHaveLength(2);
  const archive=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,backup=await store.backup(state);return{photos:backup.photos,book:JSON.stringify(state.book)};}finally{store.close();}
  });
  expect(archive.photos).toHaveLength(2);
  for(const photo of archive.photos!){expect(Buffer.from(photo.data,'base64')).toEqual(image);expect(archive.book).not.toContain(photo.data);}
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  await expect(draft.locator('.photo-thumbnails img')).toHaveCount(2);
  await draft.getByRole('button',{name:'Open photo Synthetic general.png',exact:true}).click();
  const viewer=page.getByRole('dialog',{name:'Synthetic general.png',exact:true});
  await expect(viewer.locator('img')).toBeVisible();await expect(viewer.getByRole('link',{name:'Save to device',exact:true})).toHaveAttribute('download','Synthetic general.png');
  await viewer.getByRole('button',{name:'Close dialog',exact:true}).click();
  await draft.getByRole('checkbox',{name:'Select photo Synthetic linked.png',exact:true}).check();
  await draft.getByRole('button',{name:'Remove selected photos',exact:true}).click();
  await page.getByRole('dialog',{name:'Remove selected photos?',exact:true}).getByRole('button',{name:'Remove photos',exact:true}).click();
  expect((await read(page,fixture.sheet)).book.foodCapture.photos).toHaveLength(1);
  await draft.getByRole('button',{name:'Undo',exact:true}).click();
  const restored=await read(page,fixture.sheet);expect(restored.book.foodCapture.photos).toHaveLength(2);expect(restored.book.foodCapture.foods[0].photos).toHaveLength(2);
  await expect(draft.locator('.photo-thumbnails img')).toHaveCount(2);
  expect(downloads).toEqual([]);
});

test('only an explicit camera gallery choice requests a device copy after saving',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-draft').click();
  const draft=page.getByRole('region',{name:'Draft foods'}),downloads:string[]=[];
  page.on('download',download=>downloads.push(download.suggestedFilename()));
  await draft.getByRole('button',{name:'Add photo',exact:true}).click();
  let camera=page.getByRole('dialog',{name:'Take photo',exact:true});
  await camera.getByRole('checkbox',{name:'Save to gallery',exact:true}).check();
  await camera.getByRole('button',{name:'Close dialog',exact:true}).click();
  expect(downloads).toEqual([]);
  await draft.getByRole('button',{name:'Add photo',exact:true}).click();
  camera=page.getByRole('dialog',{name:'Take photo',exact:true});
  await expect(camera.getByRole('checkbox',{name:'Save to gallery',exact:true})).not.toBeChecked();
  await camera.getByRole('checkbox',{name:'Save to gallery',exact:true}).check();
  const chooser=page.waitForEvent('filechooser');await camera.getByRole('button',{name:'Take photo',exact:true}).click();
  const input=await chooser;expect(await input.element().getAttribute('capture')).toBe('environment');
  const image=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  const downloading=page.waitForEvent('download');
  await input.setFiles({name:'Synthetic camera copy.png',mimeType:'image/png',buffer:image});
  expect((await downloading).suggestedFilename()).toBe('Synthetic camera copy.png');
  const saved=await read(page,fixture.sheet);expect(saved.book.foodCapture.photos).toHaveLength(1);
  expect(downloads).toEqual(['Synthetic camera copy.png']);
  const original=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;return(await store.backup(state)).photos![0].data;}finally{store.close();}
  });expect(Buffer.from(original,'base64')).toEqual(image);
  await draft.getByRole('button',{name:'Open photo Synthetic camera copy.png',exact:true}).click();
  const viewer=page.getByRole('dialog',{name:'Synthetic camera copy.png',exact:true}),explicit=page.waitForEvent('download');
  await viewer.getByRole('link',{name:'Save to device',exact:true}).click();await explicit;
  await viewer.getByRole('button',{name:'Close dialog',exact:true}).click();
  await draft.getByRole('button',{name:'Undo',exact:true}).click();expect((await read(page,fixture.sheet)).book.foodCapture.photos).toEqual([]);
  await draft.getByRole('button',{name:'Redo',exact:true}).click();expect((await read(page,fixture.sheet)).book.foodCapture.photos).toHaveLength(1);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect(downloads).toEqual(['Synthetic camera copy.png','Synthetic camera copy.png']);
});

test('a failed photo save keeps originals in emergency backup and retries one atomic attachment',async({page})=>{
  const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
  const fixture=await setup(page);await page.locator('#meal-draft').click();
  const draft=page.getByRole('region',{name:'Draft foods'});await draft.locator('[data-draft-add]').click();await read(page,fixture.sheet);
  const image=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='state')throw new DOMException('Synthetic photo quota failure','QuotaExceededError');return original.apply(this,args);};
    document.addEventListener('restore-photo-save',()=>{IDBObjectStore.prototype.put=original;},{once:true});
  });
  await draft.getByRole('button',{name:'Take photo',exact:true}).click();
  const camera=page.getByRole('dialog',{name:'Take photo',exact:true});await camera.getByRole('checkbox',{name:'Save to gallery',exact:true}).check();
  const choice=page.waitForEvent('filechooser');await camera.getByRole('button',{name:'Take photo',exact:true}).click();
  await(await choice).setFiles({name:'Synthetic pending.png',mimeType:'image/png',buffer:image});
  await expect(page.locator('#save-state')).toContainText('NOT SAVED');
  await expect(draft.getByRole('button',{name:'Open photo Synthetic pending.png',exact:true}).locator('img')).toBeVisible();
  const before=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;return{photos:state.book.foodCapture?.photos??[],backup:await store.backup(state)};}finally{store.close();}
  });
  expect(before.photos).toEqual([]);expect(before.backup.photos??[]).toEqual([]);
  expect(downloads).toEqual([]);
  await page.getByRole('button',{name:'Dismiss error',exact:true}).click();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download independent full backup',exact:true}).click();
  const stream=await(await downloading).createReadStream(),parts:Buffer[]=[];for await(const part of stream!)parts.push(Buffer.from(part));
  const backup=parseArchive(Buffer.concat(parts).toString('utf8')) as Backup;
  expect(backup.state.book.foodCapture!.photos).toHaveLength(1);expect(backup.photos).toHaveLength(1);expect(backup.missingPhotos).toEqual([]);
  expect(Buffer.from(backup.photos![0].data,'base64')).toEqual(image);
  expect(backup.state.pending.some(change=>change.label==='Unsaved edits included in emergency backup')).toBe(true);
  await page.getByRole('dialog',{name:'Recovery',exact:true}).getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.evaluate(()=>document.dispatchEvent(new Event('restore-photo-save')));
  if(await page.getByRole('button',{name:'Dismiss error',exact:true}).isVisible())await page.getByRole('button',{name:'Dismiss error',exact:true}).click();
  await page.getByRole('button',{name:/^Save(?: workbook)?$/,exact:true}).click();
  const saved=await read(page,fixture.sheet);expect(saved.book.foodCapture.photos).toHaveLength(1);expect(saved.book.foodCapture.foods[0].photos).toHaveLength(1);
  expect(downloads).toHaveLength(1);expect(downloads[0]).toMatch(/\.fnt\.json$/);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  await expect(draft.getByRole('button',{name:'Open photo Synthetic pending.png',exact:true}).locator('img')).toBeVisible();
  expect((await read(page,fixture.sheet)).book.foodCapture.photos).toHaveLength(1);
});

test('FNT photos reuse stable gallery originals in Ingredients and Draft without duplicating bytes',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-draft').click();
  const draft=page.getByRole('region',{name:'Draft foods'}),panel=page.locator('.meal-log-panel');
  const image=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  const choice=page.waitForEvent('filechooser');await draft.getByRole('button',{name:'Add photo',exact:true}).click();
  await page.getByRole('dialog',{name:'Take photo',exact:true}).getByRole('button',{name:'Take photo',exact:true}).click();
  await(await choice).setFiles({name:'Synthetic reusable.png',mimeType:'image/png',buffer:image});
  await expect(draft.getByRole('button',{name:'Open photo Synthetic reusable.png',exact:true}).locator('img')).toBeVisible();
  const initial=await read(page,fixture.sheet),photo=initial.book.foodCapture.photos[0];
  await panel.getByRole('combobox',{name:'Food panels',exact:true}).click();await page.getByRole('option',{name:'Ingredients',exact:true}).click();
  const ingredients=panel.getByRole('region',{name:'Ingredient editor'}),ingredient=ingredients.locator('[data-ingredient-key]').first(),key=await ingredient.getAttribute('data-ingredient-key');
  const choose=async()=>{
    const picker=page.getByRole('dialog',{name:'FNT photos',exact:true});
    await picker.getByRole('checkbox',{name:'Select photo Synthetic reusable.png',exact:true}).check();
    await picker.getByRole('button',{name:'Attach selected photos',exact:true}).click();await expect(picker).toHaveCount(0);
  };
  await ingredient.getByRole('button',{name:'FNT photos',exact:true}).click();await choose();
  expect((await read(page,fixture.sheet)).book.foodCapture.ingredientDetails[key!].photos).toEqual([photo.id]);
  await panel.getByRole('tab',{name:'Draft',exact:true}).click();await draft.locator('[data-draft-add]').click();
  await draft.locator('[data-draft-card]').first().getByRole('button',{name:'FNT photos',exact:true}).click();await choose();
  const attached=await read(page,fixture.sheet);expect(attached.book.foodCapture.foods[0].photos).toEqual([photo.id]);expect(attached.book.foodCapture.photos).toHaveLength(1);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  await panel.getByRole('combobox',{name:'Food panels',exact:true}).click();await page.getByRole('option',{name:'Photos',exact:true}).click();
  const gallery=panel.getByRole('region',{name:'FNT photo gallery',exact:true});await expect(gallery.locator('.photo-thumbnails img')).toHaveCount(1);
  expect((await read(page,fixture.sheet)).book.foodCapture.ingredientDetails[key!].photos).toEqual([photo.id]);
});

test('photo picker and gallery retain every selected stable identity across pages',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-draft').click();await page.getByRole('region',{name:'Draft foods'}).locator('[data-draft-add]').click();await read(page,fixture.sheet);
  const ids=await page.evaluate(async()=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage') as typeof import('../../src/storage'),{inspectPhoto}=await load('food-photos') as typeof import('../../src/food-photos');
    const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png')),store=await Store.open();
    try{
      const state=(await store.load())!,photos=await Promise.all(Array.from({length:25},(_,index)=>inspectPhoto('synthetic-page-'+index,blob)));
      const date=state.book.foodCapture?.foods[0]?.date;if(date===undefined)throw Error('Synthetic Draft food date is missing.');
      state.book.foodCapture!.photos=photos.map((photo,index)=>({id:photo.id,name:`Page${String(index+1).padStart(2,'0')}.png`,date,mime:photo.mime,bytes:photo.bytes,digest:photo.digest}));
      await store.save(state.book,state.version,'Synthetic photo pages',false,undefined,{photos});return photos.map(photo=>photo.id);
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  await page.getByRole('region',{name:'Draft foods'}).locator('[data-draft-card]').first().getByRole('button',{name:'FNT photos',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'FNT photos',exact:true});
  await expect(picker.getByRole('button',{name:'Remove selected photos',exact:true})).toBeHidden();
  await picker.getByRole('checkbox',{name:'Select photo Page01.png',exact:true}).check();
  const removeBounds=await picker.getByRole('button',{name:'Remove selected photos',exact:true}).boundingBox();expect(removeBounds!.width).toBe(removeBounds!.height);
  await picker.getByRole('button',{name:'Next',exact:true}).click();await picker.getByRole('button',{name:'Next',exact:true}).click();
  await picker.getByRole('checkbox',{name:'Select photo Page25.png',exact:true}).check();await picker.getByRole('button',{name:'Previous',exact:true}).click();await picker.getByRole('button',{name:'Previous',exact:true}).click();
  await expect(picker.getByRole('checkbox',{name:'Select photo Page01.png',exact:true})).toBeChecked();
  await picker.getByRole('button',{name:'Attach selected photos',exact:true}).click();await expect(picker).toHaveCount(0);
  expect((await read(page,fixture.sheet)).book.foodCapture.foods[0].photos).toEqual([ids[0],ids[24]]);
  await page.locator('.meal-log-panel').getByRole('combobox',{name:'Food panels',exact:true}).click();await page.getByRole('option',{name:'Photos',exact:true}).click();
  const gallery=page.getByRole('region',{name:'FNT photo gallery',exact:true});
  await gallery.getByRole('checkbox',{name:'Select photo Page02.png',exact:true}).check();await gallery.getByRole('button',{name:'Next',exact:true}).click();
  await gallery.getByRole('checkbox',{name:'Select photo Page25.png',exact:true}).check();await gallery.getByRole('button',{name:'Remove selected photos',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Remove selected photos?',exact:true});await expect(confirmation).toContainText('Remove 2 photos');
  await confirmation.getByRole('button',{name:'Remove photos',exact:true}).click();
  const removed=await read(page,fixture.sheet);expect(removed.book.foodCapture.photos).toHaveLength(23);expect(removed.book.foodCapture.foods[0].photos).toEqual([ids[0]]);
  expect(removed.book.foodCapture.photos.some((photo:{id:string})=>photo.id===ids[1]||photo.id===ids[24])).toBe(false);
});

test('private gallery verifies opt-in, uploads separately and restores missing originals without replacing local metadata',async({page})=>{
  const retainedName='VeryLongUnbrokenFilename'.repeat(7)+'.png';
  const fixture=await setup(page),server=await privateGalleryServer(page);await page.locator('#meal-draft').click();
  const draft=page.getByRole('region',{name:'Draft foods'}),image=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  const choice=page.waitForEvent('filechooser');await draft.getByRole('button',{name:'Add photo',exact:true}).click();
  await page.getByRole('dialog',{name:'Take photo',exact:true}).getByRole('button',{name:'Take photo',exact:true}).click();
  await(await choice).setFiles({name:'Synthetic private.png',mimeType:'image/png',buffer:image});
  await expect(draft.getByRole('button',{name:'Open photo Synthetic private.png',exact:true}).locator('img')).toBeVisible();
  expect(server.writes).toEqual([]);await openPrivateGallery(page);let gallery=await connectPrivateGallery(page);
  expect(server.writes).toEqual([]);await gallery.getByRole('button',{name:'Upload local originals',exact:true}).click();
  await expect(gallery.getByRole('status')).toContainText('Confirmed 1 private photo originals');
  expect(server.writes.filter(path=>path.endsWith('.png'))).toHaveLength(1);expect(server.writes.filter(path=>path==='photos/index.json')).toHaveLength(1);
  const saved=await read(page,fixture.sheet),photo=saved.book.foodCapture.photos[0];expect(JSON.stringify(saved.book)).not.toContain('invented-gallery-token');
  await gallery.getByRole('button',{name:'Upload local originals',exact:true}).click();
  await expect(gallery.getByRole('status')).toContainText('Confirmed 1 private photo originals');expect(server.writes).toHaveLength(2);
  await gallery.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.evaluate(async({id,name})=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;state.book.foodCapture!.photos[0].name=name;await store.save(state.book,state.version,'Synthetic local photo rename');}finally{store.close();}
    const request=indexedDB.open('fnt-workbook-v1');
    await new Promise<void>((resolve,reject)=>{request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('photos','readwrite');tx.objectStore('photos').delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
  },{id:photo.id,name:retainedName});
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  await openPrivateGallery(page);gallery=await connectPrivateGallery(page);
  await gallery.getByRole('checkbox',{name:'Download private photo Synthetic private.png',exact:true}).check();
  await gallery.getByRole('button',{name:'Download selected originals',exact:true}).click();
  await expect(gallery.getByRole('status')).toContainText('Saved 1 selected originals');
  const restored=await read(page,fixture.sheet);expect(restored.book.foodCapture.photos).toHaveLength(1);expect(restored.book.foodCapture.photos[0].name).toBe(retainedName);
  const bytes=await page.evaluate(async id=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return Array.from(new Uint8Array(await(await store.photo(id)).blob.arrayBuffer()));}finally{store.close();}
  },photo.id);expect(Buffer.from(bytes)).toEqual(image);
  await gallery.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('region',{name:'FNT photo gallery',exact:true}).getByRole('button',{name:'Open photo '+retainedName,exact:true}).locator('img')).toBeVisible();
  expect(server.writes).toHaveLength(2);
  const index=server.files.get('photos/index.json')!,manifest=JSON.parse(Buffer.from(index.content,'base64').toString('utf8'));
  manifest.photos.push({...manifest.photos[0],id:'synthetic-remote-only',name:'Remote only.png'});
  server.files.set('photos/index.json',{sha:'f'.repeat(40),content:Buffer.from(JSON.stringify(manifest)).toString('base64')});
  await page.getByRole('button',{name:'Private photo gallery',exact:true}).click();gallery=page.getByRole('dialog',{name:'Private photo gallery',exact:true});
  await gallery.getByRole('button',{name:'Refresh private gallery',exact:true}).click();await expect(gallery.getByRole('status')).toContainText('2 photos');
  await gallery.getByRole('checkbox',{name:'Download private photo Remote only.png',exact:true}).check();
  await gallery.getByRole('button',{name:'Download selected originals',exact:true}).click();await expect(gallery.getByRole('status')).toContainText('Saved 1 selected originals');
  const imported=await read(page,fixture.sheet);expect(imported.book.foodCapture.photos).toHaveLength(2);
  expect(imported.book.foodCapture.photos.find((entry:{id:string})=>entry.id==='synthetic-remote-only').name).toBe('Remote only.png');
  await gallery.getByRole('button',{name:'Upload local originals',exact:true}).click();await expect(gallery.getByRole('status')).toContainText('different name or date');
  await gallery.getByRole('button',{name:'Review metadata conflict',exact:true}).click();
  const conflict=page.getByRole('dialog',{name:'Private photo metadata conflict',exact:true});await expect(conflict).toContainText(retainedName);await expect(conflict).toContainText('Synthetic private.png');
  expect(await conflict.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  await conflict.getByRole('button',{name:'Upload this local name and date',exact:true}).click();await expect(conflict).toHaveCount(0);
  expect(JSON.parse(Buffer.from(server.files.get('photos/index.json')!.content,'base64').toString('utf8')).photos.find((entry:{id:string})=>entry.id===photo.id).name).toBe(retainedName);
  expect(server.writes.filter(path=>path.endsWith('.png'))).toHaveLength(1);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  gallery=await openPrivateGallery(page);await expect(gallery.getByRole('status')).toContainText('disconnected');
  await expect(gallery.getByRole('button',{name:'Upload local originals',exact:true})).toBeDisabled();
  expect((await read(page,fixture.sheet)).book.foodCapture.photos).toHaveLength(2);
});

test('Logged and Draft reuse restaurant identities, inheritance and reviewed deletion with durable Undo',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),logged=panel.locator('[data-log-card]'),first=logged.first(),before=await read(page,fixture.sheet);
  const originalName=await first.getByRole('textbox',{name:'Food',exact:true}).inputValue();
  await first.getByRole('textbox',{name:'Restaurant',exact:true}).fill('Synthetic shared cafe');
  await first.getByRole('textbox',{name:'Restaurant',exact:true}).press('Tab');
  const clearance=await first.getByRole('textbox',{name:'Restaurant',exact:true}).evaluate(input=>({padding:parseFloat(getComputedStyle(input).paddingRight),button:input.parentElement!.querySelector('button')!.getBoundingClientRect().width}));
  expect(clearance.padding).toBeGreaterThanOrEqual(clearance.button+4);
  let saved=await read(page,fixture.sheet);
  expect(saved.sheet.cells).toEqual(before.sheet.cells);expect(saved.sheet.rows).toEqual(before.sheet.rows);
  const restaurant=saved.book.foodCapture.restaurants[0].id,key=`${fixture.table}:${fixture.latest}`;
  expect(saved.book.foodCapture.loggedDetails[key]).toEqual({restaurant});
  await first.getByRole('button',{name:'+ Food',exact:true}).click();
  await expect(logged).toHaveCount(2);await expect(page.locator('.cell-dropdown')).toBeVisible();await page.keyboard.press('Escape');
  const added=logged.last();await expect(added.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Synthetic shared cafe');
  await added.getByRole('textbox',{name:'Food',exact:true}).click();await page.getByRole('button',{name:'Custom',exact:true}).click();
  await added.getByRole('textbox',{name:'Food',exact:true}).fill('Synthetic inherited Logged dish');
  await added.getByRole('button',{name:'Unlink restaurant',exact:true}).click();await expect(added.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('');
  await panel.locator('.meal-log-footer').getByRole('button',{name:'Undo',exact:true}).click();
  await expect(added.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Synthetic shared cafe');
  await panel.getByRole('tab',{name:'Draft',exact:true}).click();
  const draft=panel.getByRole('region',{name:'Draft foods',exact:true});await draft.locator('[data-draft-add]').click();
  const draftFood=draft.locator('[data-draft-card]').first();await draftFood.getByRole('textbox',{name:'Draft Food',exact:true}).fill('Synthetic shared Draft dish');
  await draftFood.getByRole('combobox',{name:'Choose restaurant',exact:true}).click();
  await page.getByRole('option',{name:'Synthetic shared cafe',exact:true}).click();
  const draftClearance=await draftFood.getByRole('textbox',{name:'Restaurant',exact:true}).evaluate(input=>({padding:parseFloat(getComputedStyle(input).paddingRight),button:input.parentElement!.querySelector('button')!.getBoundingClientRect().width}));
  expect(draftClearance.padding).toBeGreaterThanOrEqual(draftClearance.button+4);
  await draft.getByRole('button',{name:'Restaurants',exact:true}).click();
  let manager=page.getByRole('dialog',{name:'Restaurants',exact:true});
  await manager.getByRole('textbox',{name:'Restaurant name',exact:true}).fill('Synthetic renamed cafe');await manager.getByRole('button',{name:'Rename',exact:true}).click();
  await manager.getByRole('button',{name:'Delete',exact:true}).click();
  let confirmation=page.getByRole('dialog',{name:'Delete restaurant?',exact:true});
  for(const name of [originalName,'Synthetic inherited Logged dish','Synthetic shared Draft dish'])await expect(confirmation).toContainText(name);
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await read(page,fixture.sheet)).book.foodCapture.restaurants).toEqual([{id:restaurant,name:'Synthetic renamed cafe'}]);
  await draft.getByRole('button',{name:'Restaurants',exact:true}).click();manager=page.getByRole('dialog',{name:'Restaurants',exact:true});
  await manager.getByRole('button',{name:'Delete',exact:true}).click();confirmation=page.getByRole('dialog',{name:'Delete restaurant?',exact:true});
  await confirmation.getByRole('button',{name:'Delete restaurant',exact:true}).click();
  saved=await read(page,fixture.sheet);expect(saved.book.foodCapture.restaurants).toEqual([]);
  expect(saved.book.foodCapture.loggedDetails[key]).toEqual({restaurantText:'Synthetic renamed cafe'});
  expect(saved.book.foodCapture.foods[0].restaurantText).toBe('Synthetic renamed cafe');
  await draft.getByRole('button',{name:'Undo',exact:true}).click();
  saved=await read(page,fixture.sheet);expect(saved.book.foodCapture.loggedDetails[key]).toEqual({restaurant});expect(saved.book.foodCapture.foods[0].restaurant).toBe(restaurant);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-log').click();
  await expect(logged).toHaveCount(2);for(const field of await logged.getByRole('textbox',{name:'Restaurant',exact:true}).all())await expect(field).toHaveValue('Synthetic renamed cafe');
  expect(await panel.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
});

test('automatic private photo transfer preserves local saves after index conflict and retries without duplicate originals',async({page})=>{
  const fixture=await setup(page),server=await privateGalleryServer(page);await page.locator('#meal-draft').click();
  await openPrivateGallery(page);let gallery=await connectPrivateGallery(page,true);expect(server.writes).toEqual([]);
  await gallery.getByRole('button',{name:'Close dialog',exact:true}).click();server.settings.conflict=true;
  const photos=page.getByRole('region',{name:'FNT photo gallery',exact:true}),image=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;return canvas.toDataURL('image/png').split(',')[1];
  }),'base64'),choice=page.waitForEvent('filechooser');await photos.getByRole('button',{name:'Upload photo',exact:true}).click();
  await(await choice).setFiles({name:'Synthetic queued.png',mimeType:'image/png',buffer:image});
  await expect(page.getByRole('alert')).toContainText('changed during transfer');
  await expect(page.locator('#save-state')).toContainText(/^Saved locally/);
  expect((await read(page,fixture.sheet)).book.foodCapture.photos).toHaveLength(1);
  await page.getByRole('button',{name:'Dismiss error',exact:true}).click();await photos.getByRole('button',{name:'Private photo gallery',exact:true}).click();
  gallery=page.getByRole('dialog',{name:'Private photo gallery',exact:true});
  await gallery.getByRole('button',{name:'Upload local originals',exact:true}).click();await expect(gallery.getByRole('status')).toContainText('Confirmed 1 private photo originals');
  expect(server.writes.filter(path=>path.endsWith('.png'))).toHaveLength(1);expect(server.writes.filter(path=>path==='photos/index.json')).toHaveLength(2);
  await gallery.getByRole('button',{name:'Disconnect gallery',exact:true}).click();
  await expect(gallery.getByRole('status')).toContainText('token was forgotten');
  await expect(gallery.getByRole('button',{name:'Upload local originals',exact:true})).toBeDisabled();
  const persisted=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return JSON.stringify(await store.backup((await store.load())!));}finally{store.close();}
  });expect(persisted).not.toContain('invented-gallery-token');expect(persisted).not.toContain('private-photo-data');
});

test('new photo captures queue behind slow private transfers without blocking local food edits',async({page})=>{
  const fixture=await setup(page),server=await privateGalleryServer(page);await page.locator('#meal-draft').click();await openPrivateGallery(page);
  const gallery=await connectPrivateGallery(page,true);await gallery.getByRole('button',{name:'Close dialog',exact:true}).click();
  const photos=page.getByRole('region',{name:'FNT photo gallery',exact:true}),image=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  server.settings.holdIndex=true;
  try{
    for(const name of ['Queued first.png','Queued second.png']){
      const choice=page.waitForEvent('filechooser');await photos.getByRole('button',{name:'Upload photo',exact:true}).click();
      await(await choice).setFiles({name,mimeType:'image/png',buffer:image});
      await expect(photos.getByRole('button',{name:'Open photo '+name,exact:true}).locator('img')).toBeVisible();
      await expect(page.locator('#save-state')).toContainText(/^Saved locally/);
      await expect(photos.getByRole('button',{name:'Upload photo',exact:true})).toBeEnabled();
      if(name==='Queued first.png')await expect.poll(()=>server.writes.filter(path=>path==='photos/index.json').length).toBe(1);
    }
    expect((await read(page,fixture.sheet)).book.foodCapture.photos).toHaveLength(2);
    await page.locator('.meal-log-header').getByRole('tab',{name:'Draft',exact:true}).click();
    const draft=page.getByRole('region',{name:'Draft foods'});await draft.locator('[data-draft-add]').click();
    await draft.getByRole('textbox',{name:'Draft Food',exact:true}).fill('Editable during private transfer');
    expect((await read(page,fixture.sheet)).book.foodCapture.foods[0].values.food).toBe('Editable during private transfer');
    server.release();
    await expect.poll(()=>{
      const file=server.files.get('photos/index.json');return file?JSON.parse(Buffer.from(file.content,'base64').toString('utf8')).photos.length:0;
    }).toBe(2);
    expect(server.writes.filter(path=>path.endsWith('.png'))).toHaveLength(1);
  }finally{server.release();}
});

test('failed private-gallery verification disconnects the old destination and prevents unsafe uploads',async({page})=>{
  await setup(page);const server=await privateGalleryServer(page);await page.locator('#meal-draft').click();await openPrivateGallery(page);
  const gallery=await connectPrivateGallery(page,true);
  for(const unsafe of ['public','pages','source']){
    server.settings.private=unsafe!=='public';server.settings.pages=unsafe==='pages';
    await gallery.getByLabel('Personal repository owner',{exact:true}).fill(unsafe==='source'?'wendyyuanlu':'synthetic');
    await gallery.getByLabel('Private data repository',{exact:true}).fill(unsafe==='source'?'fnt':'private-photo-data');
    await gallery.getByLabel('Fine-grained token: Contents read/write for only this data repository',{exact:true}).fill('invented-gallery-token');
    await gallery.getByRole('button',{name:'Connect and verify gallery',exact:true}).click();
    await expect(gallery.getByRole('status')).toContainText(unsafe==='public'?'PRIVATE':unsafe==='pages'?'Pages':'source');
    await expect(gallery.getByRole('button',{name:'Upload local originals',exact:true})).toBeDisabled();
    expect(server.writes).toEqual([]);
  }
});

test('retained generated prompts are revalidated before opening review or copying',async({page})=>{
  const fixture=await setup(page);
  const retained=await page.evaluate(async({ingredient})=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts');
    const {Store}=await load('storage') as typeof import('../../src/storage'),{setInput}=await load('model') as typeof import('../../src/model');
    const {captureData,newNutritionBatch,generateNutritionPrompt}=await load('food-capture') as typeof import('../../src/food-capture');
    const {Engine}=await load('formula') as typeof import('../../src/formula'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,table=book.tables.find(table=>table.id===ingredient)!,sheet=book.sheets.find(sheet=>sheet.id===table.sheet)!;
      for(const [name,value]of [['Serving (g)','25'],['Conversion Amount','1'],['Conversion Unit','each']]){
        setInput(book,sheet,table.rows[0],table.columns.find(column=>column.name===name)!.column,value);
      }
      const batch=newNutritionBatch(book,[45000],'Synthetic retained prompt verification',new Engine(book)),item=batch.items.find(item=>item.kind==='ingredient'&&item.reference?.row===table.rows[0])!;
      for(const candidate of batch.items)candidate.selected=candidate===item;
      item.values.weight='40';batch.prompt=generateNutritionPrompt(batch);item.values.weight='25';item.basis='40g';
      batch.generated=true;batch.promptOpen=true;batch.selectOpen=false;captureData(book).builder=batch;
      await store.save(book,state.version,'Synthetic retained generated prompt');
      return{batch:batch.id,item:item.id,cached:batch.prompt};
    }finally{store.close();}
  },{ingredient:fixture.ingredient});
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();
  const panel=page.locator('.meal-log-panel'),builder=panel.getByRole('region',{name:'Nutrition builder'});
  await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();
  await expect(builder.locator('[data-items]')).not.toHaveAttribute('open','');
  await expect(builder.getByRole('button',{name:'Copy prompt',exact:true})).toBeDisabled();
  await expect(builder.locator('[data-prompt-text]')).toHaveValue('');
  await expect(builder.locator('[data-prompt-issue]')).toContainText(/captured|reference/i);
  const recovered=(await read(page,fixture.sheet)).book.foodCapture.builder;
  expect(recovered.id).toBe(retained.batch);expect(recovered.prompt).toBe('');
  const selected=recovered.items.find((item:{id:string})=>item.id===retained.item);
  expect(selected.selected).toBe(true);expect(selected.basis).toBe('40g');expect(selected.values.weight).toBe('25');
  await builder.locator('[data-items] summary').click();await builder.getByRole('button',{name:'Use captured reference',exact:true}).click();
  await expect(builder.locator('[data-prompt-issue]')).toBeEmpty();
  await expect(builder.getByRole('button',{name:'Copy prompt',exact:true})).toBeEnabled();
  expect(await builder.locator('[data-prompt-text]').inputValue()).not.toBe(retained.cached);
  expect((await read(page,fixture.sheet)).book.foodCapture.builder.items.find((item:{id:string})=>item.id===retained.item).basis).toBe('');
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await read(page,fixture.sheet)).book.foodCapture.builder.items.find((item:{id:string})=>item.id===retained.item).basis).toBe('');
});

for(const scenario of ['normal','quota','changed-source'] as const)test(`tracked converter saves real dated food and receipt with reload, Undo and ${scenario==='quota'?'failed-save retry':scenario==='changed-source'?'source revalidation':'duplicate prevention'}`,async({page})=>{
  const failSave=scenario==='quota';
  const fixture=await setup(page);await page.locator('#meal-draft').click();
  const panel=page.locator('.meal-log-panel'),draft=panel.getByRole('region',{name:'Draft foods'}),builder=panel.getByRole('region',{name:'Nutrition builder'});
  await draft.locator('[data-draft-add]').click();
  const card=draft.locator('[data-draft-card]').first();
  for(const [name,value]of [['Draft Food','Original synthetic converter meal'],['Draft Grams','47'],['Draft Amount','2'],['Draft Unit','each'],['Restaurant','Synthetic converter cafe']])await card.getByRole('textbox',{name,exact:true}).fill(value);
  await card.getByRole('textbox',{name:'Restaurant',exact:true}).press('Tab');
  await card.locator('.meal-log-notes summary').click();await card.getByRole('textbox',{name:'Draft Notes',exact:true}).fill('Preserved synthetic note\nSecond line');
  await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();
  await builder.getByRole('button',{name:'Clear shown',exact:true}).click();
  await builder.locator('[data-nutrition-item]').filter({has:page.locator('[data-original]',{hasText:'Original description: Original synthetic converter meal'})}).locator('[data-field=selected]').check();
  await builder.getByRole('button',{name:'Generate prompt',exact:true}).click();
  const captured=await read(page,fixture.sheet),batch=captured.book.foodCapture.builder,item=batch.items.find((item:{selected:boolean})=>item.selected),original=captured.book.foodCapture.foods[0];
  const row:Record<string,string>={id:item.id,name:'AI synthetic converted meal',calories:'100',protein:'2',fat:'1',carbs:'20',sugar:'0',sodium:'3',weight:'',amount:'',unit:''};
  const raw=`Batch ID: ${batch.id}\n${converterFields.map(field=>converterLabels[field]).join('\t')}\n${converterFields.map(field=>row[field]).join('\t')}`;
  const converter=builder.getByRole('region',{name:'Nutrition table converter'});
  const openConverter=async()=>{
    await expect(converter).toBeVisible();
    await expect(builder.getByRole('button',{name:'Table converter',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(builder.getByRole('button',{name:'Prompt builder',exact:true})).toHaveAttribute('aria-pressed','false');
  };
  await expect(builder.getByRole('button',{name:'Prompt builder',exact:true})).toHaveAttribute('aria-pressed','true');
  await builder.getByRole('button',{name:'Table converter',exact:true}).click();
  await openConverter();await converter.getByRole('textbox',{name:'Nutrition response',exact:true}).fill(raw);await converter.getByRole('button',{name:'Process table',exact:true}).click();
  await converter.locator('[data-convert-table] [data-convert-field=name]').fill('Reviewed synthetic converted meal');
  await expect(converter.locator('[data-convert-status]')).toHaveText('Review saved automatically.');
  await builder.getByRole('button',{name:'Back',exact:true}).click();
  await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();await openConverter();
  await expect(converter.locator('[data-convert-table] [data-convert-field=name]')).toHaveValue('Reviewed synthetic converted meal');
  await builder.getByRole('button',{name:'Prompt builder',exact:true}).click();
  await expect(converter).toBeHidden();
  await builder.getByRole('button',{name:'Back',exact:true}).click();
  await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();
  await expect(builder.getByRole('button',{name:'Prompt builder',exact:true})).toHaveAttribute('aria-pressed','true');await expect(converter).toBeHidden();
  await builder.getByRole('button',{name:'Table converter',exact:true}).click();await openConverter();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();await openConverter();
  await expect(converter.getByRole('textbox',{name:'Nutrition response',exact:true})).toHaveValue(raw);
  await expect(converter.locator('[data-convert-table] [data-convert-field=name]')).toHaveValue('Reviewed synthetic converted meal');
  await converter.getByRole('button',{name:'Validate write-back preview',exact:true}).click();
  const preview=await read(page,fixture.sheet);expect(preview.sheet).toEqual(captured.sheet);expect(preview.book.foodCapture.foods).toEqual(captured.book.foodCapture.foods);
  if(scenario==='changed-source'){
    await expect(converter.getByRole('button',{name:'Apply reviewed nutrition',exact:true})).toBeEnabled();
    await builder.getByRole('button',{name:'Back',exact:true}).click();
    await draft.getByRole('textbox',{name:'Draft Amount',exact:true}).fill('9');
    await draft.getByRole('textbox',{name:'Draft Amount',exact:true}).press('Tab');
    expect((await read(page,fixture.sheet)).book.foodCapture.foods[0].values.amount).toBe('9');
    await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();await openConverter();
    await expect(converter.getByRole('button',{name:'Apply reviewed nutrition',exact:true})).toBeDisabled();
    await expect(converter.locator('[data-write-preview]')).toContainText('changed');
    await converter.getByRole('button',{name:'Validate write-back preview',exact:true}).click();
    await expect(converter.locator('[data-convert-error]')).toContainText(/changed|stale|differs/i);
    await expect(converter.getByRole('button',{name:'Apply reviewed nutrition',exact:true})).toBeDisabled();
    const rejected=await read(page,fixture.sheet);
    expect(rejected.sheet).toEqual(captured.sheet);expect(rejected.book.foodCapture.nutritionReceipts??[]).toEqual([]);
    expect(rejected.book.foodCapture.builder.items.find((candidate:{id:string})=>candidate.id===item.id)).toEqual(item);
    return;
  }
  if(failSave)await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='state')throw new DOMException('Synthetic converter quota failure','QuotaExceededError');return original.apply(this,args);};
    document.addEventListener('restore-converter-save',()=>{IDBObjectStore.prototype.put=original;},{once:true});
  });
  await converter.getByRole('button',{name:'Apply reviewed nutrition',exact:true}).click();
  if(failSave){
    await expect(converter.locator('[data-convert-status]')).toContainText('not saved');
    await expect(converter.getByRole('button',{name:'Apply reviewed nutrition',exact:true})).toBeDisabled();
    const durable=await page.evaluate(async()=>{
      const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
      try{return(await store.load())!.book;}finally{store.close();}
    });
    expect(durable.tables).toEqual(captured.book.tables);expect(durable.foodCapture!.foods).toEqual(captured.book.foodCapture.foods);expect(durable.foodCapture!.nutritionReceipts??[]).toEqual([]);
    await page.evaluate(()=>document.dispatchEvent(new Event('restore-converter-save')));
    await converter.getByRole('button',{name:'Retry saving review',exact:true}).click();
  }
  await expect(converter.locator('[data-convert-status]')).toHaveText('Applied and saved.');
  const applied=await read(page,fixture.sheet),receipts=applied.book.foodCapture.nutritionReceipts,receipt=receipts[0],entry=receipt.entries[0];
  expect(receipts).toHaveLength(1);expect(receipt.response.raw).toBe(raw);expect(entry.originalDraft).toEqual(original);expect(applied.book.foodCapture.foods).toHaveLength(0);
  expect(applied.book.foodCapture.loggedDetails[`${entry.target.table}:${entry.target.row}`]).toEqual({restaurant:original.restaurant});
  const table=applied.book.tables.find((table:Table)=>table.id===entry.target.table),engine=new Engine(applied.book);
  for(const [field,expected]of [['Food','Reviewed synthetic converted meal'],['Calories',100],['Amount (g)',47],['Amount',2],['Unit','each'],['Exercise','Preserved synthetic note\nSecond line'],['Date',original.date]]){
    expect(engine.cell(table.sheet,entry.target.row,table.columns.find((column:{name:string})=>column.name===field).column)).toBe(expected);
  }
  await expect(page.locator('#error')).toBeHidden();
  await builder.getByRole('button',{name:'Back',exact:true}).click();await draft.getByRole('button',{name:'Undo',exact:true}).click();
  const undone=await read(page,fixture.sheet);expect(undone.book.foodCapture.foods).toEqual(captured.book.foodCapture.foods);expect(undone.book.foodCapture.nutritionReceipts??[]).toEqual([]);expect(undone.book.tables).toEqual(captured.book.tables);
  await draft.getByRole('button',{name:'Redo',exact:true}).click();
  const redone=await read(page,fixture.sheet);expect(redone.book.foodCapture.nutritionReceipts).toEqual(receipts);expect(redone.book.tables).toEqual(applied.book.tables);
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-draft').click();await panel.getByRole('button',{name:'Get Nutrition',exact:true}).click();await openConverter();
  await expect(converter.locator('[data-convert-status]')).toHaveText('Applied and saved.');await expect(converter.getByRole('button',{name:'Apply reviewed nutrition',exact:true})).toBeDisabled();
  expect((await read(page,fixture.sheet)).book.tables).toEqual(applied.book.tables);
});

test('newest log opens at the bottom, stays open across sheets, and reuses toggled, calculated and square-button styles',async({page})=>{
  await setup(page,80);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),scroll=panel.locator('.meal-log-scroll');
  await expect.poll(()=>scroll.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThan(2);
  const buttonColor=await page.locator('#meal-log').evaluate(element=>({actual:getComputedStyle(element).backgroundColor,toggle:getComputedStyle(element.parentElement!).getPropertyValue('--toggle-background').trim()}));
  expect(buttonColor.actual).toBe('rgb(232, 239, 223)');expect(buttonColor.toggle).toBe('#e8efdf');
  const squares=await panel.locator('button.icon-button').evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return[rect.width,rect.height];}));
  for(const [width,height]of squares)expect(width).toBe(height);
  await panel.locator('[data-log-card]').last().locator('.meal-log-macros summary').click();
  const calculated=panel.locator('[data-log-field="calories"]').last();
  await expect(calculated).toHaveClass(/calculated/);await calculated.scrollIntoViewIfNeeded();
  await expect(calculated).toHaveCSS('color','rgb(100, 120, 82)');
  await scroll.evaluate(element=>element.scrollTop=500);
  const position=await scroll.evaluate(element=>element.scrollTop);
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(panel).toHaveCount(0);
  await page.getByRole('button',{name:'Log test',exact:true}).click();await expect(panel).toBeVisible();
  await expect.poll(()=>scroll.evaluate(element=>element.scrollTop)).toBe(position);
});
test('full-field Food tapping opens the shared picker below the field, manual inputs stay direct, and Notes preserves literal multiline Exercise values',async({page,isMobile})=>{
  const fixture=await setup(page);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),card=panel.locator('[data-log-card]').last(),food=card.getByRole('textbox',{name:'Food',exact:true});
  await food.click();await expect(page.locator('.cell-dropdown')).toBeVisible();
  if(!isMobile){
    const field=(await card.locator('.meal-log-input:has([data-log-field=food])').boundingBox())!,popup=(await page.locator('.cell-dropdown').boundingBox())!;
    expect(popup.x).toBeCloseTo(field.x,0);expect(popup.y).toBeGreaterThanOrEqual(field.y+field.height);
  }
  await page.getByRole('button',{name:'Custom',exact:true}).click();await food.click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await expect(card.locator('.meal-log-macros')).not.toHaveAttribute('open','');await card.locator('.meal-log-macros summary').click();
  await card.getByRole('textbox',{name:'Calories',exact:true}).fill('12.1');await card.getByRole('textbox',{name:'Protein (g)',exact:true}).fill('2.1');
  await expect(card.locator('[data-log-totals]')).toHaveText('13 cal · 3P');
  const notes=card.locator('.meal-log-notes');await expect(notes).not.toHaveAttribute('open','');
  expect(await notes.evaluate(element=>element.previousElementSibling?.classList.contains('meal-log-fields'))).toBe(true);
  await notes.locator('summary').click();await notes.getByRole('textbox',{name:'Notes',exact:true}).fill('=Literal notes\nSecond line\nhttps://example.invalid/recipe');
  const stored=await read(page,fixture.sheet),table=stored.book.tables.find((table:{id:string})=>table.id===fixture.table)!;
  expect(stored.sheet.cells[`${fixture.latest}:${table.columns.find((column:{name:string})=>column.name==='Exercise')!.column}`]).toMatchObject({value:'=Literal notes\nSecond line\nhttps://example.invalid/recipe'});
  await page.reload();await page.locator('#meal-log').click();await panel.locator('.meal-log-notes summary').click();
  await expect(panel.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('=Literal notes\nSecond line\nhttps://example.invalid/recipe');
});
test('manual macros stay collapsed and Needs nutrition requires all six values through edits and reload',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),card=panel.locator('[data-log-card]').last(),food=card.getByRole('textbox',{name:'Food',exact:true});
  await food.click();await page.getByRole('button',{name:'Custom',exact:true}).click();
  await expect(card.locator('.meal-log-macros')).not.toHaveAttribute('open','');
  await food.fill('Invented food');await food.click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  const cell=async()=>{
    const state=await read(page,fixture.sheet),table=state.book.tables.find((table:{id:string})=>table.id===fixture.table)!;
    return state.sheet.cells[`${fixture.latest}:${table.columns.find((column:{name:string})=>column.name==='Food')!.column}`];
  };
  expect((await cell()).foodDraft).toBe(true);await expect(card.locator('[data-log-needs-nutrition]')).toBeVisible();await expect(card).not.toContainText(/draft/i);
  await card.locator('.meal-log-macros summary').click();
  for(const name of ['Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)'])await card.getByRole('textbox',{name,exact:true}).fill('0');
  expect((await cell()).foodDraft).toBeUndefined();
  await expect(card.locator('[data-log-needs-nutrition]')).toBeHidden();
  await card.getByRole('textbox',{name:'Fat (g)',exact:true}).fill('');await expect(card.locator('[data-log-needs-nutrition]')).toBeVisible();
  await food.fill('');expect((await cell()).foodDraft).toBeUndefined();await expect(card.locator('[data-log-needs-nutrition]')).toBeHidden();
  await food.fill('Invented incomplete food');
  expect((await cell()).foodDraft).toBe(true);
  await page.reload();await page.locator('#meal-log').click();
  await expect(card.locator('.meal-log-macros')).not.toHaveAttribute('open','');await expect(food).not.toHaveAttribute('readonly','');await food.click();
  await expect(page.locator('.cell-dropdown')).toHaveCount(0);expect((await cell()).foodDraft).toBe(true);await expect(card.locator('[data-log-needs-nutrition]')).toBeVisible();
  await expect(card).not.toContainText(/draft/i);
});
test('manual mode rejects faulted nutrition for a named Food without partial cell writes',async({page})=>{
  const fixture=await setup(page);
  await page.evaluate(async fixture=>{
    const storage='/src/storage.ts',model='/src/model.ts';
    const {Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),{setInput}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets.find(sheet=>sheet.id===fixture.sheet)!,table=state.book.tables.find(table=>table.id===fixture.table)!;
      setInput(state.book,sheet,fixture.latest,table.columns.find(column=>column.name==='Fat (g)')!.column,'=1/0');
      await store.save(state.book,state.version,'Synthetic named-food formula error');
    }finally{store.close();}
  },fixture);
  await page.reload();await page.locator('#meal-log').click();
  const before=await read(page,fixture.sheet),card=page.locator(`[data-log-card="${fixture.latest}"]`);
  await card.getByRole('textbox',{name:'Food',exact:true}).click();
  await page.getByRole('button',{name:'Custom',exact:true}).click();
  await expect(page.locator('#error')).toContainText('Fix the Fat (g) error before using manual nutrition.');
  expect((await read(page,fixture.sheet)).sheet.cells).toEqual(before.sheet.cells);
});
test('linked foods use current Ingredient reference nutrition without changing links, consumption or formulas',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-log').click();
  const card=page.locator(`[data-log-card="${fixture.latest}"]`),tag=card.locator('[data-log-needs-nutrition]');
  await expect(tag).toBeVisible();await expect(card.getByRole('textbox',{name:'Food',exact:true})).toHaveAttribute('readonly','');
  const original=await read(page,fixture.sheet);
  const updateIngredient=async(complete:boolean)=>page.evaluate(async({fixture,complete})=>{
    const storage='/src/storage.ts',model='/src/model.ts',logging='/src/meal-log.ts';
    const {Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),{setInput}=await import(/* @vite-ignore */model) as typeof import('../../src/model'),{mealLogConfig}=await import(/* @vite-ignore */logging) as typeof import('../../src/meal-log'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets.find(sheet=>sheet.id===fixture.sheet)!,target=mealLogConfig(state.book,sheet).ingredients!;
      const table=state.book.tables.find(table=>table.id===target.table)!,source=state.book.sheets.find(sheet=>sheet.id===table.sheet)!;
      for(const field of ['calories','protein','fat','carbs','sugar','sodium'] as const)setInput(state.book,source,table.rows[0],table.columns.find(column=>column.id===target.fields[field])!.column,complete?'0':'');
      await store.save(state.book,state.version,'Synthetic reference nutrition edit');
    }finally{store.close();}
  },{fixture,complete});
  await updateIngredient(true);await page.reload();await page.locator('#meal-log').click();
  await expect(tag).toBeHidden();
  const complete=await read(page,fixture.sheet);
  expect(complete.sheet.cells).toEqual(original.sheet.cells);expect(complete.blocks).toEqual(original.blocks);
  await updateIngredient(false);await page.reload();await page.locator('#meal-log').click();
  await expect(tag).toBeVisible();
  const incomplete=await read(page,fixture.sheet);
  expect(incomplete.sheet.cells).toEqual(original.sheet.cells);expect(incomplete.blocks).toEqual(original.blocks);
});
test('a populated thousand-food day opens promptly and retains unrelated live fields through row changes',async({page})=>{
  const fixture=await setup(page,1000),panel=page.locator('.meal-log-panel');
  const opened=Date.now();await page.locator('#meal-log').click();
  await expect(panel.locator('[data-log-card]')).toHaveCount(1001);
  const openDuration=Date.now()-opened;expect(openDuration).toBeLessThan(3000);
  await panel.getByRole('button',{name:'Previous day',exact:true}).click();
  await expect(panel.locator('[data-log-card]')).toHaveCount(2);
  const switched=Date.now();await panel.getByRole('button',{name:'Next day',exact:true}).click();
  await expect(panel.locator('[data-log-card]')).toHaveCount(1001);
  const switchDuration=Date.now()-switched;expect(switchDuration).toBeLessThan(3000);
  console.info('Meal log 1,000-food day',test.info().project.name,{open:openDuration,switch:switchDuration});
  const grams=panel.locator(`[data-log-card="${fixture.latest}"] [data-log-field="weight"]`);
  await expect(grams).toHaveValue('300');await grams.fill('321');
  await panel.getByRole('button',{name:'Previous day',exact:true}).click();
  await panel.getByRole('button',{name:'Next day',exact:true}).click();
  await expect(grams).toHaveValue('321');
  const first=panel.locator('[data-log-card]').first(),retained=await first.elementHandle();
  await first.getByRole('textbox',{name:'Restaurant',exact:true}).fill('Invented retained cafe');
  await first.getByRole('textbox',{name:'Restaurant',exact:true}).press('Tab');
  await first.locator('.meal-log-macros summary').click();
  await first.locator('.meal-log-notes summary').click();
  const notes=first.getByRole('textbox',{name:'Notes',exact:true});
  await notes.fill('literal\nretained notes');await notes.evaluate((input:HTMLTextAreaElement)=>input.setSelectionRange(2,7));
  const updates=await first.evaluateHandle(card=>{
    const records:string[]=[],observer=new MutationObserver(changes=>records.push(...changes.map(change=>`${change.type}:${change.attributeName??''}`)));
    observer.observe(card,{attributes:true,childList:true,characterData:true,subtree:true});
    const ancestors=new Set<Node>(),disconnections:string[]=[];
    for(let node:Node|null=card;node;node=node.parentNode)ancestors.add(node);
    const attachment=new MutationObserver(changes=>{
      for(const change of changes)for(const node of change.removedNodes)if(ancestors.has(node))disconnections.push(node.nodeName);
    });
    attachment.observe(document.documentElement,{childList:true,subtree:true});
    return{records,observer,disconnections,attachment};
  });
  const checkRetained=async()=>{
    expect(await retained!.evaluate(card=>card.isConnected)).toBe(true);
    await expect(notes).toBeFocused();await expect(notes).toHaveValue('literal\nretained notes');
    expect(await notes.evaluate((input:HTMLTextAreaElement)=>[input.selectionStart,input.selectionEnd])).toEqual([2,7]);
    await expect(first.locator('.meal-log-macros')).toHaveAttribute('open','');
    await expect(first.locator('.meal-log-notes')).toHaveAttribute('open','');
    await expect(first.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Invented retained cafe');
    expect(await updates.evaluate(state=>state.records)).toEqual([]);
    expect(await updates.evaluate(state=>state.disconnections)).toEqual([]);
  };
  await panel.locator('[data-log-card]').last().getByRole('button',{name:'Delete food',exact:true}).dispatchEvent('click');
  await expect(panel.locator('[data-log-card]')).toHaveCount(1000);await checkRetained();
  await panel.getByRole('button',{name:'Undo',exact:true}).dispatchEvent('click');
  await expect(panel.locator('[data-log-card]')).toHaveCount(1001);await checkRetained();await expect(grams).toHaveValue('321');
  const saved=await read(page,fixture.sheet),table=saved.book.tables.find((table:{id:string})=>table.id===fixture.table)!;
  expect(saved.sheet.cells[`${fixture.latest}:${table.columns.find((column:{name:string})=>column.name==='Amount (g)')!.column}`].value).toBe(321);
  await panel.getByRole('button',{name:'Redo',exact:true}).dispatchEvent('click');
  await expect(panel.locator('[data-log-card]')).toHaveCount(1000);await checkRetained();
  await updates.evaluate(state=>{state.observer.disconnect();state.attachment.disconnect();});await updates.dispose();
});
test('public-sized food reordering finishes promptly and keeps stable row identities and Undo',async({page})=>{
  const fixture=await setup(page,6000,true);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),before=await panel.locator('[data-log-card]').evaluateAll(cards=>cards.map(card=>(card as HTMLElement).dataset.logCard));
  const started=Date.now();await panel.locator('[data-log-card]').last().getByRole('button',{name:'Move food up',exact:true}).click();
  await expect(panel.locator('[data-log-card]').nth(before.length-2)).toHaveAttribute('data-log-card',fixture.latest);
  const duration=Date.now()-started;console.info('Meal log 84,000-cell reorder',test.info().project.name,duration);
  test.info().annotations.push({type:'meal-reorder-ms',description:String(duration)});expect(duration).toBeLessThan(2000);
  await panel.getByRole('button',{name:'Undo',exact:true}).click();await expect(panel.locator('[data-log-card]').last()).toHaveAttribute('data-log-card',fixture.latest);
  const adding=Date.now();await panel.locator('.meal-log-footer [data-log-add]').click();
  await expect(page.getByRole('searchbox',{name:'Search dropdown options',exact:true})).toBeFocused();
  const addDuration=Date.now()-adding;console.info('Meal log 84,000-cell add and picker',test.info().project.name,addDuration);
  expect(addDuration).toBeLessThan(2000);await expect(panel.locator('[data-log-card]')).toHaveCount(before.length+1);
});

test('+ Food and picker taps focus the keyboard target immediately, retain keyboard layout, and honor remembered manual mode',async({page,isMobile})=>{
  const fixture=await setup(page);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),search=page.getByRole('searchbox',{name:'Search dropdown options',exact:true});
  await panel.locator('[data-log-card]').last().getByRole('textbox',{name:'Food',exact:true}).click();await expect(search).toBeFocused();
  await page.locator('.cell-dropdown [role="option"]').first().click();
  const grams=panel.locator('[data-log-card]').last().getByRole('textbox',{name:'Grams',exact:true});
  await grams.click();await grams.fill('321');
  if(isMobile)await page.evaluate(()=>{
    const viewport=window.visualViewport!,original=Object.getOwnPropertyDescriptor(window,'innerHeight')!;
    Object.defineProperty(viewport,'height',{configurable:true,value:innerHeight-300});
    Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>viewport.height});
    document.addEventListener('restore-entry-viewport',()=>{Object.defineProperty(window,'innerHeight',original);Reflect.deleteProperty(viewport,'height');viewport.dispatchEvent(new Event('resize'));},{once:true});
    viewport.dispatchEvent(new Event('resize'));
  });
  await panel.locator('.meal-log-footer [data-log-add]').click();await expect(search).toBeFocused();
  await expect(panel.locator('[data-log-card]').last().getByRole('textbox',{name:'Grams',exact:true})).toHaveValue('');
  if(isMobile){
    await expect(page.locator('.sheet-bar')).toBeHidden();
    const bottom=await page.evaluate(()=>window.visualViewport!.offsetTop+window.visualViewport!.height),footer=(await panel.locator('.meal-log-footer').boundingBox())!;
    expect(footer.y+footer.height).toBeLessThanOrEqual(bottom+1);
  }
  await search.fill('oat');await page.getByRole('button',{name:'Custom',exact:true}).click();
  await expect(panel.locator('[data-log-card]').last().getByRole('textbox',{name:'Food',exact:true})).toBeFocused();
  await panel.locator('[data-log-card]').first().locator('[data-log-insert]').click();
  await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  await expect(panel.locator('[data-log-card]').nth(1).getByRole('textbox',{name:'Food',exact:true})).toBeFocused();
  await read(page,fixture.sheet);
  if(isMobile)await page.evaluate(()=>document.dispatchEvent(new Event('restore-entry-viewport')));
  await page.reload();await page.locator('#meal-log').click();await panel.locator('.meal-log-footer [data-log-add]').click();
  await expect(page.locator('.cell-dropdown')).toHaveCount(0);await expect(panel.locator('[data-log-card]').last().getByRole('textbox',{name:'Food',exact:true})).toBeFocused();
});

test('touch Food labels and carets keep the DD search open through keyboard viewport changes',async({page,isMobile})=>{
  test.skip(!isMobile,'Native touch activation and keyboard viewport changes.');
  await setup(page);await page.locator('#meal-log').click();
  const card=page.locator('[data-log-card]').last(),field=card.locator('.meal-log-field').filter({has:page.locator('input[data-log-field="food"]')});
  const search=page.getByRole('searchbox',{name:'Search dropdown options',exact:true}),original=page.viewportSize()!;
  for(const target of [field.locator(':scope>span').first(),card.getByRole('textbox',{name:'Food',exact:true}),card.getByRole('button',{name:'Choose Food',exact:true})]){
    await target.tap();await expect(search).toBeFocused();
    await page.setViewportSize({width:original.width,height:460});
    await expect(search).toBeVisible();await expect(search).toBeFocused();
    await search.fill('oat');await expect(page.locator('.cell-dropdown [role="option"]').first()).toBeVisible();
    await search.press('Escape');await expect(page.locator('.cell-dropdown')).toHaveCount(0);
    await page.setViewportSize(original);
  }
});

test('empty inherited Grams stays blank without losing its formula; explicit zero and entered conversion quantities remain visible',async({page})=>{
  const fixture=await setup(page);
  await page.evaluate(async id=>{
    const module='/src/storage.ts',{Store}=await import(/* @vite-ignore */module) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,table=state.book.tables.find(table=>table.id===id)!;table.columns.find(column=>column.name==='Amount (g)')!.formulaDefault='=IF([@Amount]="",0,[@Amount]*100)';await store.save(state.book,state.version,'Invented Grams conversion');}finally{store.close();}
  },fixture.table);
  await page.reload();await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel');await expect(panel.locator('[data-log-card]').last().getByRole('textbox',{name:'Grams',exact:true})).toHaveValue('300');
  await panel.locator('.meal-log-footer [data-log-add]').click();await page.locator('.cell-dropdown [role="option"]').first().click();
  const card=panel.locator('[data-log-card]').last(),grams=card.getByRole('textbox',{name:'Grams',exact:true});
  await expect(grams).toHaveValue('');
  const cell=async()=>{const state=await read(page,fixture.sheet),table=state.book.tables.find((table:{id:string})=>table.id===fixture.table)!;return state.sheet.cells[`${await card.getAttribute('data-log-card')}:${table.columns.find((column:{name:string})=>column.name==='Amount (g)')!.column}`];};
  expect((await cell()).formula).toBeTruthy();await grams.fill('0');expect((await cell()).value).toBe(0);await expect(grams).toHaveValue('0');
  await panel.getByRole('button',{name:'Undo',exact:true}).click();await expect(grams).toHaveValue('');expect((await cell()).formula).toBeTruthy();
  await grams.press('Enter');await expect(card.getByRole('textbox',{name:'Amount',exact:true})).toBeFocused();expect((await cell()).formula).toBeTruthy();
  await card.getByRole('textbox',{name:'Amount',exact:true}).fill('2');await expect(grams).toHaveValue('200');
  await card.getByRole('textbox',{name:'Amount',exact:true}).fill('0');await expect(grams).toHaveValue('0');
});

test('Meal log hides sheet tabs for an overlay keyboard and keeps only its action footer above the keyboard',async({page,isMobile})=>{
  test.skip(!isMobile,'Touch overlay keyboard geometry.');
  await page.addInitScript(()=>{
    const keyboard=Object.assign(new EventTarget(),{boundingRect:new DOMRect(0,0,0,0)});
    Object.defineProperty(navigator,'virtualKeyboard',{configurable:true,value:keyboard});
  });
  await setup(page);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),footer=panel.locator('.meal-log-footer'),search=page.getByRole('searchbox',{name:'Search dropdown options',exact:true});
  await panel.locator('[data-log-card]').last().getByRole('textbox',{name:'Food',exact:true}).tap();await expect(search).toBeFocused();
  await page.evaluate(()=>{
    const keyboard=(navigator as Navigator&{virtualKeyboard:EventTarget&{boundingRect:DOMRect}}).virtualKeyboard;
    keyboard.boundingRect=new DOMRect(0,460,innerWidth,innerHeight-460);keyboard.dispatchEvent(new Event('geometrychange'));
  });
  await expect(page.locator('.sheet-bar')).toBeHidden();await expect.poll(async()=>Math.round((await footer.boundingBox())!.y+(await footer.boundingBox())!.height)).toBe(460);
  const popup=(await page.locator('.cell-dropdown').boundingBox())!;expect(popup.y+popup.height).toBeLessThanOrEqual((await footer.boundingBox())!.y);
  await footer.locator('[data-log-add]').tap();await expect(search).toBeFocused();await expect(page.locator('.sheet-bar')).toBeHidden();
  await page.evaluate(()=>{
    const keyboard=(navigator as Navigator&{virtualKeyboard:EventTarget&{boundingRect:DOMRect}}).virtualKeyboard;
    keyboard.boundingRect=new DOMRect(0,0,0,0);keyboard.dispatchEvent(new Event('geometrychange'));
  });
  await expect(page.locator('.sheet-bar')).toBeVisible();await expect(page.locator('#error')).toBeHidden();
});

test('Meal log keeps sheet tabs hidden while picker search uses a resized Chrome keyboard viewport',async({page,isMobile})=>{
  test.skip(!isMobile,'Chrome resizes both viewports for its keyboard.');
  await setup(page);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),original=page.viewportSize()!,footer=panel.locator('.meal-log-footer'),search=page.getByRole('searchbox',{name:'Search dropdown options',exact:true});
  await panel.locator('.meal-log-footer [data-log-add]').tap();await expect(search).toBeFocused();
  await page.setViewportSize({width:original.width,height:460});
  await expect(page.locator('.sheet-bar')).toBeHidden();await expect.poll(async()=>Math.round((await footer.boundingBox())!.y+(await footer.boundingBox())!.height)).toBe(460);
  const popup=(await page.locator('.cell-dropdown').boundingBox())!;expect(popup.y+popup.height).toBeLessThanOrEqual((await footer.boundingBox())!.y);
  await footer.locator('[data-log-add]').tap();await expect(search).toBeFocused();await expect(page.locator('.sheet-bar')).toBeHidden();
  await page.setViewportSize(original);await expect(page.locator('.sheet-bar')).toBeVisible();
});

test('Weight writes the summary row, not food Grams, and linked Meals quantities start collapsed with stable source identities',async({page})=>{
  const fixture=await setup(page);
  await page.evaluate(async id=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage') as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets.find(sheet=>sheet.id===id)!;
      sheet.validations[0].source='=VSTACK(Ingredients[Ingredients],Meals[Meal])';
      await store.save(state.book,state.version,'Invented Meals picker source');
    }finally{store.close();}
  },fixture.sheet);
  await page.reload();await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),weight=panel.getByRole('textbox',{name:'Weight',exact:true}),card=panel.locator('[data-log-card]').last();
  await expect(weight).toHaveValue('x');expect(await weight.evaluate(element=>element.closest('.meal-log-day-weight')?.nextElementSibling?.hasAttribute('data-log-card'))).toBe(true);
  await weight.fill('62.4');const saved=await read(page,fixture.sheet),table=saved.book.tables.find((table:{id:string})=>table.id===fixture.table)!;
  const header=saved.blocks.at(-1)!.header;
  expect(saved.sheet.cells[`${header}:${table.columns.find((column:{name:string})=>column.name==='Weight')!.column}`].value).toBe(62.4);
  expect(saved.sheet.cells[`${fixture.latest}:${table.columns.find((column:{name:string})=>column.name==='Amount (g)')!.column}`].value).toBe(300);
  await panel.getByRole('button',{name:'Undo',exact:true}).click();await expect(weight).toHaveValue('x');
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();await page.getByRole('tab',{name:'Meals',exact:true}).click();await page.getByRole('option',{name:'Example breakfast',exact:true}).click();
  const quantities=card.locator('.meal-log-quantities');await expect(quantities).not.toHaveAttribute('open','');await expect(card.getByRole('textbox',{name:'Grams',exact:true})).toBeHidden();
  await quantities.locator('summary').click();await expect(card.getByRole('textbox',{name:'Grams',exact:true})).toHaveValue('300');
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();await page.getByRole('option',{name:'Example breakfast',exact:true}).click();
  await expect(quantities).not.toHaveAttribute('open','');
  await read(page,fixture.sheet);
  await page.reload();await page.locator('#meal-log').click();await expect(card.locator('.meal-log-quantities')).not.toHaveAttribute('open','');
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();await expect(page.getByRole('tab',{name:'Meals',exact:true})).toHaveAttribute('aria-selected','true');
});

test.describe('Meal log day integrity',()=>{
  test.use({timezoneId:'America/Denver'});
  async function groupedDays(page:Page,firstDay=25){
    await page.clock.setFixedTime(new Date('2026-11-27T04:29:00Z'));
    const fixture=await setup(page,3,false,firstDay);
    await page.evaluate(async id=>{
      const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts');
      const {Store}=await load('storage') as typeof import('../../src/storage'),{masterDayBlocks}=await load('day-logging') as typeof import('../../src/day-logging');
      const {excelDate}=await load('dates') as typeof import('../../src/dates'),{setInput,uid}=await load('model') as typeof import('../../src/model'),store=await Store.open();
      try{
        const state=(await store.load())!,sheet=state.book.sheets.find(sheet=>sheet.id===id)!;
        sheet.dayLogging!.nextDate=excelDate(2026,11,27)!;
        const blocks=masterDayBlocks(state.book,sheet);
        for(const block of blocks)for(const row of block.rows.slice(1))setInput(state.book,sheet,row,sheet.columns[0].id,`=A${sheet.rows.findIndex(row=>row.id===block.header)+1}`);
        sheet.groups=blocks.map(block=>({id:uid(),axis:'row',kind:'summary',members:block.rows,collapsed:false,label:'Synthetic day'}));
        await store.save(state.book,state.version,'Synthetic grouped days');
      }finally{store.close();}
    },fixture.sheet);
    await page.reload();await page.locator('#meal-log').click();return fixture;
  }
  test('clearing and retyping Weight never moves foods, removes a day, changes dates or consumes the cursor',async({page})=>{
    const fixture=await groupedDays(page),panel=page.locator('.meal-log-panel'),date=panel.getByRole('button',{name:'Choose log date',exact:true});
    const weight=panel.getByRole('textbox',{name:'Weight',exact:true}),before=await read(page,fixture.sheet),header=before.blocks.at(-1)!.header;
    const table=before.book.tables.find((table:{id:string})=>table.id===fixture.table)!,column=table.columns.find((field:{name:string})=>field.name==='Weight')!.column;
    const unchangedCells=Object.fromEntries(Object.entries(before.sheet.cells).filter(([address])=>address!==`${header}:${column}`));
    const foods=before.blocks.at(-1)!.rows.slice(1),check=async()=>{
      await expect(date).toHaveText('11/26');
      expect(await panel.locator('[data-log-card]').evaluateAll(cards=>cards.map(card=>(card as HTMLElement).dataset.logCard))).toEqual(foods);
      const saved=await read(page,fixture.sheet);
      expect(saved.blocks).toEqual(before.blocks);expect(saved.sheet.rows).toEqual(before.sheet.rows);expect(saved.sheet.groups).toEqual(before.sheet.groups);
      expect(saved.sheet.dayLogging.nextDate).toBe(before.sheet.dayLogging.nextDate);
      expect(Object.fromEntries(Object.entries(saved.sheet.cells).filter(([address])=>address!==`${header}:${column}`))).toEqual(unchangedCells);
    };
    await weight.click();await weight.press('Control+a');await weight.press('Backspace');await check();await expect(weight).toHaveValue('');await expect(weight).toBeFocused();
    await weight.pressSequentially('68.',{delay:30});await check();await expect(weight).toHaveValue('68.');
    await weight.pressSequentially('25',{delay:30});await check();await expect(weight).toHaveValue('68.25');
    await weight.fill('0');await check();await expect(weight).toHaveValue('0');
    await weight.fill('');await check();await weight.press('Control+z');await check();await expect(weight).toHaveValue('0');
    await weight.press('Control+y');await check();await expect(weight).toHaveValue('x');
    await weight.fill('');await panel.getByRole('button',{name:'Today',exact:true}).click();await check();
    await panel.getByRole('button',{name:'Previous day',exact:true}).click();await expect(date).toHaveText('11/25');
    await panel.getByRole('button',{name:'Next day',exact:true}).click();await check();
    await panel.getByRole('button',{name:'Undo',exact:true}).click();await check();
    await page.reload();await page.locator('#meal-log').click();await check();
  });
  test('Today creates the local 11/26 at 21:29, not UTC 11/27 or the next-day cursor',async({page})=>{
    const fixture=await groupedDays(page,24),before=await read(page,fixture.sheet),panel=page.locator('.meal-log-panel');
    await panel.getByRole('button',{name:'Today',exact:true}).click();await expect(panel.getByRole('button',{name:'Choose log date',exact:true})).toHaveText('11/26');
    const saved=await read(page,fixture.sheet),dates='/src/dates.ts',today=await page.evaluate(async path=>{
      const {excelDate}=await import(/* @vite-ignore */path) as typeof import('../../src/dates');return excelDate(2026,11,26);
    },dates);
    expect(saved.blocks.slice(0,-1)).toEqual(before.blocks);expect(saved.blocks.at(-1)!.date).toBe(today);
    expect(saved.sheet.dayLogging.nextDate).toBe(before.sheet.dayLogging.nextDate);
    await panel.getByRole('button',{name:'Today',exact:true}).click();expect((await read(page,fixture.sheet)).blocks).toEqual(saved.blocks);
  });
  test('date button invokes a visible native calendar in the tap gesture and navigates without moving food',async({page,isMobile})=>{
    const fixture=await groupedDays(page),before=await read(page,fixture.sheet);
    await page.evaluate(()=>{
      const native=HTMLInputElement.prototype.showPicker;
      HTMLInputElement.prototype.showPicker=function(){
        document.body.dataset.calendarInvocation=JSON.stringify({value:this.value,active:navigator.userActivation.isActive,width:this.getBoundingClientRect().width});
        native.call(this);
      };
    });
    const date=page.locator('.meal-log-panel').getByRole('button',{name:'Choose log date',exact:true});
    if(isMobile)await date.tap();else await date.click();
    const input=page.getByLabel('Log date',{exact:true});await expect(input).toBeVisible();
    await expect(page.locator('.cell-date-picker [role="alert"]')).toBeHidden();
    const invoked=await page.evaluate(()=>JSON.parse(document.body.dataset.calendarInvocation??'null'));
    expect(invoked).toMatchObject({value:'2026-11-26',active:true});expect(invoked.width).toBeGreaterThan(100);
    await input.fill('2026-11-25');await expect(date).toHaveText('11/25');
    const after=await read(page,fixture.sheet);expect(after.blocks).toEqual(before.blocks);expect(after.sheet.groups).toEqual(before.sheet.groups);
  });
  test('production bundle preserves grouped foods after clearing Weight, local Today, reload and opening the native calendar',async({page,isMobile})=>{
    const fixture=await groupedDays(page),before=await read(page,fixture.sheet),source=new URL(page.url()).origin;
    await page.goto(process.env.FNT_PUBLISHED_URL!);await expect(page.locator('#save-state')).toContainText(/^Saved/);
    await page.evaluate(async({source,book})=>{
      const storage=source+'/src/storage.ts',{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
      try{const state=(await store.load())!;await store.save(book,state.version,'Synthetic production day integrity');}finally{store.close();}
    },{source,book:before.book});
    await page.reload();await page.getByRole('button',{name:'Log test',exact:true}).click();await page.locator('#meal-log').click();
    const panel=page.locator('.meal-log-panel'),weight=panel.getByRole('textbox',{name:'Weight',exact:true}),date=panel.getByRole('button',{name:'Choose log date',exact:true});
    await weight.fill('');await expect(date).toHaveText('11/26');
    const cleared=await read(page,fixture.sheet,source);expect(cleared.blocks).toEqual(before.blocks);expect(cleared.sheet.groups).toEqual(before.sheet.groups);
    await expect(weight).toHaveValue('');await weight.pressSequentially('68.25');await panel.getByRole('button',{name:'Today',exact:true}).click();
    await expect(date).toHaveText('11/26');const saved=await read(page,fixture.sheet,source);
    expect(saved.blocks).toEqual(before.blocks);expect(saved.sheet.dayLogging.nextDate).toBe(before.sheet.dayLogging.nextDate);
    const header=before.blocks.at(-1)!.header,column=before.book.tables.find((table:{id:string})=>table.id===fixture.table)!.columns.find((field:{name:string})=>field.name==='Weight')!.column;
    expect(saved.sheet.cells[`${header}:${column}`].value).toBe(68.25);
    await page.reload();await page.locator('#meal-log').click();await expect(weight).toHaveValue('68.25');await expect(date).toHaveText('11/26');
    await page.evaluate(()=>{
      const native=HTMLInputElement.prototype.showPicker;
      HTMLInputElement.prototype.showPicker=function(){document.body.dataset.calendarInvocation=this.value;native.call(this);};
    });
    if(isMobile)await date.tap();else await date.click();
    await expect(page.locator('.cell-date-picker [role="alert"]')).toBeHidden();
    expect(await page.evaluate(()=>document.body.dataset.calendarInvocation)).toBe('2026-11-26');
    await page.getByLabel('Log date',{exact:true}).fill('2026-11-25');await expect(date).toHaveText('11/25');
    expect((await read(page,fixture.sheet,source)).blocks).toEqual(before.blocks);
  });
});

test('Meal log matches the sketch layout and live fields, uses the shared picker, adds ingredients and persists without Save',async({page,isMobile})=>{
  const fixture=await setup(page),toolbar=page.getByRole('navigation',{name:'Master logging'});
  expect(await toolbar.locator(':scope > button,.day-create > button').allTextContents()).toEqual(['Meal log','Draft','+ Day','+ Food']);
  await expect(page.locator('#new-day')).not.toHaveClass(/primary/);
  await page.locator('.day-create summary').click();await expect(page.locator('#date-settings')).toBeVisible();await page.locator('.day-create summary').click();
  const gridBefore=(await page.locator('.grid-shell').boundingBox())!;
  await page.getByRole('button',{name:'Meal log',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Meal log'}),bounds=(await panel.boundingBox())!;
  if(isMobile){
    const header=(await page.locator('.app-header').boundingBox())!,tabs=(await page.locator('.sheet-bar').boundingBox())!;
    expect(bounds.y).toBeCloseTo(header.y+header.height,0);expect(bounds.y+bounds.height).toBeCloseTo(tabs.y,0);expect(bounds.width).toBe(page.viewportSize()!.width);
  }else{
    expect(bounds.width).toBe(450);expect((await page.locator('.grid-shell').boundingBox())!.x-gridBefore.x).toBe(450);
  }
  await expect(panel.locator('[data-log-card]')).toHaveCount(1);await expect(panel.locator('[data-log-card]')).toHaveAttribute('data-log-card',fixture.latest);
  await panel.locator('.meal-log-footer [data-log-add]').click();
  await expect(panel.locator('[data-log-card]')).toHaveCount(2);
  const card=panel.locator('[data-log-card]').last();
  await expect(page.getByRole('searchbox',{name:'Search dropdown options',exact:true})).toBeFocused();
  const fieldBounds=(await card.locator('.meal-log-input:has([data-log-field=food])').boundingBox())!,pickerBounds=(await page.locator('.cell-dropdown').boundingBox())!;
  expect(pickerBounds.y+pickerBounds.height<=fieldBounds.y||pickerBounds.y>=fieldBounds.y+fieldBounds.height).toBe(true);
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();
  await expect(page.locator('.cell-dropdown [role="listbox"]')).toBeVisible();
  await page.getByRole('button',{name:'Custom',exact:true}).click();
  await expect(card.locator('.meal-log-macros')).not.toHaveAttribute('open','');await card.locator('.meal-log-macros summary').click();
  await card.getByRole('textbox',{name:'Food',exact:true}).fill('Invented midnight food');
  await card.getByRole('textbox',{name:'Calories',exact:true}).fill('123');
  await card.getByRole('textbox',{name:'Protein (g)',exact:true}).fill('25');
  await card.getByRole('textbox',{name:'Grams',exact:true}).fill('300');
  const incomplete=await read(page,fixture.sheet),incompleteTable=incomplete.book.tables.find((table:{id:string})=>table.id===fixture.table)!;
  expect(incomplete.sheet.cells[`${await card.getAttribute('data-log-card')}:${incompleteTable.columns.find((column:{name:string})=>column.name==='Food')!.column}`].foodDraft).toBe(true);
  await expect(card.getByRole('textbox',{name:'Grams',exact:true})).toHaveAttribute('inputmode','decimal');
  if(isMobile){
    await page.evaluate(()=>{
      const viewport=window.visualViewport!,original=Object.getOwnPropertyDescriptor(window,'innerHeight')!;
      Object.defineProperty(viewport,'height',{configurable:true,value:innerHeight-300});
      Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>viewport.height});
      document.addEventListener('restore-meal-viewport',()=>{Object.defineProperty(window,'innerHeight',original);Reflect.deleteProperty(viewport,'height');viewport.dispatchEvent(new Event('resize'));},{once:true});
      viewport.dispatchEvent(new Event('resize'));
    });
    const viewportBottom=await page.evaluate(()=>window.visualViewport!.offsetTop+window.visualViewport!.height),footer=(await panel.locator('.meal-log-footer').boundingBox())!;
    expect(footer.y+footer.height).toBeLessThanOrEqual(viewportBottom+1);await expect(page.locator('.sheet-bar')).toBeHidden();
    await panel.getByRole('button',{name:'Next field',exact:true}).click();await expect(card.getByRole('textbox',{name:'Amount',exact:true})).toBeFocused();
    await page.evaluate(()=>document.dispatchEvent(new Event('restore-meal-viewport')));
    await expect(page.locator('.sheet-bar')).toBeVisible();
  }
  await card.getByRole('checkbox',{name:'Add to Ingredients',exact:true}).click();
  await expect(card.getByRole('checkbox')).toHaveCount(0);await expect(card.getByRole('textbox',{name:'Food',exact:true})).toHaveAttribute('readonly','');
  const saved=await read(page,fixture.sheet),ingredient=saved.book.tables.find((t:{id:string})=>t.id===fixture.ingredient)!,destination=saved.book.sheets.find((s:{id:string})=>s.id===ingredient.sheet)!;
  const label=ingredient.columns.find((c:{name:string})=>c.name==='Ingredients')!,added=ingredient.rows.find((row:string)=>destination.cells[`${row}:${label.column}`]?.value==='Invented midnight food')!;
  const ingredientValue=(name:string)=>destination.cells[`${added}:${ingredient.columns.find((c:{name:string})=>c.name===name)!.column}`]?.value;
  expect(ingredientValue('Conversion Amount')).toBe(300);expect(ingredientValue('Conversion Unit')).toBe('g');expect(ingredientValue('Calories (kcal)')).toBe(123);
  const row=await card.getAttribute('data-log-card'),master=saved.book.tables.find((t:{id:string})=>t.id===fixture.table)!;
  expect(saved.sheet.cells[`${row}:${master.columns.find((c:{name:string})=>c.name==='Calories')!.column}`].value).toBe(123);
  expect(saved.sheet.cells[`${row}:${master.columns.find((c:{name:string})=>c.name==='Food')!.column}`].binding).toEqual({table:ingredient.id,row:added,column:label.id});
  await panel.getByRole('button',{name:'Undo',exact:true}).click();await expect(card.getByRole('checkbox',{name:'Add to Ingredients',exact:true})).toBeVisible();
  await expect(card.getByRole('textbox',{name:'Food',exact:true})).not.toHaveAttribute('readonly','');
  expect((await read(page,fixture.sheet)).book.tables.find((table:{id:string})=>table.id===ingredient.id)!.rows).not.toContain(added);
  await panel.getByRole('button',{name:'Redo',exact:true}).click();await expect(card.getByRole('checkbox')).toHaveCount(0);
  await panel.getByRole('button',{name:'Close Meal log',exact:true}).click();await expect(panel).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'Meal log',exact:true}).click();
  await page.locator('[data-log-card]').last().locator('.meal-log-macros summary').click();
  await expect(page.locator('[data-log-card]').last().getByRole('textbox',{name:'Calories',exact:true})).toHaveValue('123');
  await expect(page.locator('#error')).toBeHidden();
});

test('focused field undo is live and choosing a linked Food restores only untouched manual snapshots',async({page})=>{
  const fixture=await setup(page);await page.getByRole('button',{name:'Meal log',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Meal log'}),card=panel.locator('[data-log-card]').first();
  await card.locator('.meal-log-macros summary').click();
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();await page.getByRole('button',{name:'Custom',exact:true}).click();
  await expect(card.locator('.meal-log-macros')).not.toHaveAttribute('open','');
  await card.locator('.meal-log-macros summary').click();
  const protein=card.getByRole('textbox',{name:'Protein (g)',exact:true});
  await protein.fill('27');await protein.press('Control+z');await expect(protein).toHaveValue('20');
  await protein.press('Control+y');await expect(protein).toHaveValue('27');
  let saved=await read(page,fixture.sheet),table=saved.book.tables.find((table:{id:string})=>table.id===fixture.table)!,calories=table.columns.find((field:{name:string})=>field.name==='Calories')!.column;
  expect(saved.sheet.cells[`${fixture.latest}:${calories}`].calculation).toBeTruthy();expect(saved.sheet.cells[`${fixture.latest}:${calories}`].formula).toBeUndefined();
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();await page.locator('.cell-dropdown [role="option"]').first().click();
  saved=await read(page,fixture.sheet);
  expect(saved.sheet.cells[`${fixture.latest}:${calories}`].formula).toBeTruthy();expect(saved.sheet.cells[`${fixture.latest}:${calories}`].calculation).toBeUndefined();
  await expect(card.locator('details:not(.meal-log-notes)')).toHaveAttribute('open','');await expect(protein).toHaveValue('27');
  await panel.getByRole('button',{name:'Undo',exact:true}).click();
  saved=await read(page,fixture.sheet);expect(saved.sheet.cells[`${fixture.latest}:${calories}`].calculation).toBeTruthy();
  await expect(page.locator('#error')).toBeHidden();
});

test('Next field never rewrites untouched multiline cell content from its single-line display',async({page})=>{
  const fixture=await setup(page);
  await page.evaluate(async({sheet,latest})=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage') as typeof import('../../src/storage'),{setInput}=await load('model') as typeof import('../../src/model'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets.find(s=>s.id===sheet)!,table=state.book.tables.find(table=>table.sheet===sheet)!;
      setInput(state.book,s,latest,table.columns.find(column=>column.name==='Food')!.column,"'Invented\nmultiline food");
      await store.save(state.book,state.version,'Synthetic multiline food');
    }finally{store.close();}
  },fixture);
  await page.reload();await page.getByRole('button',{name:'Meal log',exact:true}).click();
  const food=page.locator('[data-log-card]').last().getByRole('textbox',{name:'Food',exact:true});await food.focus();await food.press('Enter');
  const saved=await read(page,fixture.sheet),table=saved.book.tables.find((table:{id:string})=>table.id===fixture.table)!;
  expect(saved.sheet.cells[`${fixture.latest}:${table.columns.find((column:{name:string})=>column.name==='Food')!.column}`].value).toBe('Invented\nmultiline food');
});

test('selection opens its day and matching field; insertion, ordering, delete, undo and Today share the spreadsheet history',async({page})=>{
  const fixture=await setup(page);
  await page.locator('td[data-r="2"][data-c="5"]').click();
  await page.getByRole('button',{name:'Meal log',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Meal log'}),first=panel.locator(`[data-log-card="${fixture.first}"]`);
  await expect(first.getByRole('textbox',{name:'Protein (g)',exact:true})).toBeFocused();
  await expect(page.locator('td.active')).toHaveAttribute('data-r','2');await expect(page.locator('td.active')).toHaveAttribute('data-c','5');
  await first.locator('[data-log-insert]').click();
  await expect(panel.locator('[data-log-card]')).toHaveCount(3);
  const next=panel.locator('[data-log-card]').nth(1);
  await next.getByRole('button',{name:'Choose Food',exact:true}).click();await page.getByRole('button',{name:'Custom',exact:true}).click();
  await next.getByRole('textbox',{name:'Food',exact:true}).fill('Invented inserted food');
  let saved=await read(page,fixture.sheet);
  expect(saved.blocks[0].rows).toHaveLength(4);
  expect(saved.blocks[0].rows[1]).toBe(fixture.first);
  expect(saved.sheet.groups.some((group:{kind:string;members:string[]})=>group.kind==='summary'&&group.members.includes(saved.blocks[0].rows[2]))).toBe(true);
  await next.getByRole('button',{name:'Move food down',exact:true}).click();
  await expect(panel.locator('[data-log-card]').last().getByRole('textbox',{name:'Food',exact:true})).toHaveValue('Invented inserted food');
  await panel.locator('[data-log-card]').last().getByRole('button',{name:'Delete food',exact:true}).click();
  await expect(panel.locator('[data-log-card]')).toHaveCount(2);
  await panel.getByRole('button',{name:'Undo',exact:true}).click();await expect(panel.locator('[data-log-card]')).toHaveCount(3);
  await panel.getByRole('button',{name:'Redo',exact:true}).click();await expect(panel.locator('[data-log-card]')).toHaveCount(2);
  await panel.getByRole('button',{name:'Today',exact:true}).click();
  saved=await read(page,fixture.sheet);const count=saved.blocks.length;
  await panel.getByRole('button',{name:'Today',exact:true}).click();expect((await read(page,fixture.sheet)).blocks.length).toBe(count);
  await panel.getByRole('button',{name:'Choose log date',exact:true}).click();
  await expect(page.getByLabel('Log date',{exact:true})).toBeVisible();await page.getByLabel('Log date',{exact:true}).fill('2026-11-20');
  await expect(panel.locator('[data-log-card]')).toHaveCount(2);
  await expect(page.locator('#error')).toBeHidden();
});
