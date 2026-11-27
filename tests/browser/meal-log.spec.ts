import {expect,test,type Page} from '@playwright/test';

async function setup(page:Page,extraFoods=0,splitDays=false){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const fixture=await page.evaluate(async({extraFoods,splitDays})=>{
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
  },{extraFoods,splitDays});
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
    const field=(await card.locator('.meal-log-input').first().boundingBox())!,popup=(await page.locator('.cell-dropdown').boundingBox())!;
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
test('manual macros stay collapsed and blank macro draft metadata persists quietly through edits and reload',async({page})=>{
  const fixture=await setup(page);await page.locator('#meal-log').click();
  const panel=page.locator('.meal-log-panel'),card=panel.locator('[data-log-card]').last(),food=card.getByRole('textbox',{name:'Food',exact:true});
  await food.click();await page.getByRole('button',{name:'Custom',exact:true}).click();
  await expect(card.locator('.meal-log-macros')).not.toHaveAttribute('open','');
  await food.fill('Invented food');await food.click();await expect(page.locator('.cell-dropdown')).toHaveCount(0);
  const cell=async()=>{
    const state=await read(page,fixture.sheet),table=state.book.tables.find((table:{id:string})=>table.id===fixture.table)!;
    return state.sheet.cells[`${fixture.latest}:${table.columns.find((column:{name:string})=>column.name==='Food')!.column}`];
  };
  expect((await cell()).foodDraft).toBe(true);await expect(card).not.toContainText(/draft/i);
  await card.locator('.meal-log-macros summary').click();
  for(const name of ['Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)'])await card.getByRole('textbox',{name,exact:true}).fill('0');
  expect((await cell()).foodDraft).toBeUndefined();
  await card.getByRole('textbox',{name:'Fat (g)',exact:true}).fill('');await food.fill('');expect((await cell()).foodDraft).toBe(true);
  await page.reload();await page.locator('#meal-log').click();
  await expect(card.locator('.meal-log-macros')).not.toHaveAttribute('open','');await expect(food).not.toHaveAttribute('readonly','');await food.click();
  await expect(page.locator('.cell-dropdown')).toHaveCount(0);expect((await cell()).foodDraft).toBe(true);
  await expect(card).not.toContainText(/draft/i);
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
  await expect(page.getByRole('searchbox',{name:'Search dropdown options',exact:true})).toBeFocused();
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
