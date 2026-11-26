import {expect,test,type Page} from '@playwright/test';

async function setup(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const fixture=await page.evaluate(async()=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts');
    const {Store}=await load('storage') as typeof import('../../src/storage'),{addTableColumns,blankSheet,renameColumn,setInput,uid}=await load('model') as typeof import('../../src/model');
    const {masterLogging}=await load('day-logging') as typeof import('../../src/day-logging'),{defaultHeaderFormula}=await load('meal-block') as typeof import('../../src/meal-block'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,s=blankSheet('Log test',8,13);book.sheets.push(s);
      const table={id:uid(),name:'Master',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,6).map(row=>row.id),
        columns:['Date','Weight','isDay','Food','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Amount (g)','Amount','Unit'].map((name,i)=>({id:uid(),name,column:s.columns[i].id,formulaDefault:i===4?'=IF([@Food]="",0,10)':undefined}))};
      book.tables.push(table);table.columns.forEach(field=>setInput(book,s,table.header,field.column,field.name));
      const input=(r:number,c:number,value:string)=>setInput(book,s,s.rows[r].id,s.columns[c].id,value);
      for(let r=1;r<6;r++)input(r,2,'=[@Weight]<>""');
      for(const r of [1,4]){input(r,1,'x');input(r,0,`=DATE(2026,11,${r===1?20:21})`);for(let c=4;c<10;c++)input(r,c,defaultHeaderFormula(book,table,table.columns[c].id));}
      const ingredients=book.tables.find(table=>table.name==='Ingredients')!;
      const source=book.sheets.find(sheet=>sheet.id===ingredients.sheet)!;renameColumn(book,ingredients,ingredients.columns[0].id,'Ingredients');
      const extra=source.columns.slice(6,11);
      ['Conversion Amount','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)'].forEach((name,i)=>setInput(book,source,ingredients.header,extra[i].id,name));
      addTableColumns(book,source,ingredients,extra.map(column=>column.id));
      for(const r of [2,3,5]){
        s.cells[`${s.rows[r].id}:${s.columns[3].id}`]={binding:{table:ingredients.id,row:ingredients.rows[0],column:ingredients.columns[0].id}};
        input(r,4,'=IF([@Food]="",0,10)');input(r,5,'20');input(r,10,'300');
      }
      s.validations.push({id:uid(),rows:[...table.rows],columns:[s.columns[3].id],source:'=Ingredients[Ingredients]',sheet:s.id});
      s.dayLogging=masterLogging(book,s).config;
      await store.save(book,state.version,'Synthetic meal log');
      return{sheet:s.id,table:table.id,first:s.rows[2].id,latest:s.rows[5].id,ingredient:ingredients.id};
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Log test',exact:true}).click();return fixture;
}
async function read(page:Page,sheet:string){
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  return page.evaluate(async id=>{
    const storage='/src/storage.ts',logging='/src/day-logging.ts';
    const {Store}=await import(/* @vite-ignore */storage),{masterDayBlocks}=await import(/* @vite-ignore */logging),store=await Store.open();
    try{const state=(await store.load())!,sheet=state.book.sheets.find((s:{id:string})=>s.id===id)!;return{book:state.book,sheet,blocks:masterDayBlocks(state.book,sheet)};}finally{store.close();}
  },sheet);
}

test('Meal log matches the sketch layout and live fields, uses the shared picker, adds ingredients and persists without Save',async({page,isMobile})=>{
  const fixture=await setup(page),toolbar=page.getByRole('navigation',{name:'Master logging'});
  expect(await toolbar.locator(':scope > button,.day-create > button').allTextContents()).toEqual(['Meal log','+ Day','+ Food']);
  await expect(page.locator('#new-day')).not.toHaveClass(/primary/);
  await page.locator('.day-create summary').click();await expect(page.locator('#date-settings')).toBeVisible();await page.locator('.day-create summary').click();
  const gridBefore=(await page.locator('.grid-shell').boundingBox())!;
  await page.getByRole('button',{name:'Meal log',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Meal log'}),bounds=(await panel.boundingBox())!;
  if(isMobile){
    const header=(await page.locator('.app-header').boundingBox())!,tabs=(await page.locator('.sheet-bar').boundingBox())!;
    expect(bounds.y).toBeCloseTo(header.y+header.height,0);expect(bounds.y+bounds.height).toBeCloseTo(tabs.y,0);expect(bounds.width).toBe(390);
  }else{
    expect(bounds.width).toBe(450);expect((await page.locator('.grid-shell').boundingBox())!.x-gridBefore.x).toBe(450);
  }
  await expect(panel.locator('[data-log-card]')).toHaveCount(1);await expect(panel.locator('[data-log-card]')).toHaveAttribute('data-log-card',fixture.latest);
  await panel.locator('.meal-log-footer [data-log-add]').click();
  await expect(panel.locator('[data-log-card]')).toHaveCount(2);
  const card=panel.locator('[data-log-card]').last();
  await expect(card.getByRole('textbox',{name:'Food',exact:true})).toBeFocused();
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();
  await expect(page.locator('.cell-dropdown [role="listbox"]')).toBeVisible();
  await page.getByRole('button',{name:'Custom',exact:true}).click();
  await expect(card.locator('details')).toHaveAttribute('open','');
  await card.getByRole('textbox',{name:'Food',exact:true}).fill('Invented midnight food');
  await card.getByRole('textbox',{name:'Calories',exact:true}).fill('123');
  await card.getByRole('textbox',{name:'Protein (g)',exact:true}).fill('25');
  await card.getByRole('textbox',{name:'Weight (g)',exact:true}).fill('300');
  await expect(card.getByRole('textbox',{name:'Weight (g)',exact:true})).toHaveAttribute('inputmode','decimal');
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
  await expect(card.getByRole('checkbox',{name:'Added to Ingredients',exact:true})).toBeChecked();
  const saved=await read(page,fixture.sheet),ingredient=saved.book.tables.find((t:{id:string})=>t.id===fixture.ingredient)!,destination=saved.book.sheets.find((s:{id:string})=>s.id===ingredient.sheet)!;
  const label=ingredient.columns.find((c:{name:string})=>c.name==='Ingredients')!,added=ingredient.rows.find((row:string)=>destination.cells[`${row}:${label.column}`]?.value==='Invented midnight food')!;
  const ingredientValue=(name:string)=>destination.cells[`${added}:${ingredient.columns.find((c:{name:string})=>c.name===name)!.column}`]?.value;
  expect(ingredientValue('Conversion Amount')).toBe(300);expect(ingredientValue('Conversion Unit')).toBe('g');expect(ingredientValue('Calories (kcal)')).toBe(123);
  const row=await card.getAttribute('data-log-card'),master=saved.book.tables.find((t:{id:string})=>t.id===fixture.table)!;
  expect(saved.sheet.cells[`${row}:${master.columns.find((c:{name:string})=>c.name==='Calories')!.column}`].value).toBe(123);
  await panel.getByRole('button',{name:'Close Meal log',exact:true}).click();await expect(panel).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'Meal log',exact:true}).click();
  await expect(page.locator('[data-log-card]').last().getByRole('textbox',{name:'Calories',exact:true})).toHaveValue('123');
  await expect(page.locator('#error')).toBeHidden();
});

test('focused field undo is live and choosing a linked Food restores only untouched manual snapshots',async({page})=>{
  const fixture=await setup(page);await page.getByRole('button',{name:'Meal log',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Meal log'}),card=panel.locator('[data-log-card]').first();
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();await page.getByRole('button',{name:'Custom',exact:true}).click();
  const protein=card.getByRole('textbox',{name:'Protein (g)',exact:true});
  await protein.fill('27');await protein.press('Control+z');await expect(protein).toHaveValue('20');
  await protein.press('Control+y');await expect(protein).toHaveValue('27');
  let saved=await read(page,fixture.sheet),table=saved.book.tables.find((table:{id:string})=>table.id===fixture.table)!,calories=table.columns.find((field:{name:string})=>field.name==='Calories')!.column;
  expect(saved.sheet.cells[`${fixture.latest}:${calories}`].calculation).toBeTruthy();expect(saved.sheet.cells[`${fixture.latest}:${calories}`].formula).toBeUndefined();
  await card.getByRole('button',{name:'Choose Food',exact:true}).click();await page.locator('.cell-dropdown [role="option"]').first().click();
  saved=await read(page,fixture.sheet);
  expect(saved.sheet.cells[`${fixture.latest}:${calories}`].formula).toBeTruthy();expect(saved.sheet.cells[`${fixture.latest}:${calories}`].calculation).toBeUndefined();
  await expect(card.locator('details')).toHaveAttribute('open','');await expect(protein).toHaveValue('27');
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
