import {expect,test,type Page,type TestInfo} from '@playwright/test';

test.skip(!process.env.FNT_HOME_COOKED_URL,'Requires a dedicated existing-data-only synthetic fixture server.');
async function setup(page:Page){
  const unexpected:string[]=[],errors:string[]=[],origin=new URL(process.env.FNT_HOME_COOKED_URL!).origin;
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin||url.pathname.startsWith('/testing-workbook')){unexpected.push(url.origin+url.pathname);return route.abort();}
    if(url.pathname==='/__home-cooked-fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Invented Home cooked fixture</title>'});
    return route.continue();
  });
  await page.goto(origin+'/__home-cooked-fixture');
  const fixture=await page.evaluate(async()=>{
    const {Store}=await import(new URL('/src/storage.ts',location.href).href);
    const {syntheticConverterBook}=await import(new URL('/tests/converter-polish-fixture.ts',location.href).href);
    const book=syntheticConverterBook(),data=book.foodCapture;
    data.selectedDate=45000;data.restaurants=[{id:'legacy-home',name:'  HOME COOKED  '},{id:'cafe',name:'Synthetic cafe'}];
    data.loggedDetails={[`${book.tables[0].id}:${book.tables[0].rows[1]}`]:{restaurant:'legacy-home'}};
    data.foods[0].restaurant='legacy-home';delete data.foods[0].restaurantText;
    data.foods[0].values={...data.foods[0].values,calories:'123',protein:'0',notes:'Specified oil: 2g'};
    delete data.builder;delete data.converter;
    const store=await Store.open();
    try{
      if(await store.load())throw Error('Home cooked requires an empty disposable context.');
      await store.save(book,0,'Invented Home cooked fixture');
      return{sheets:book.sheets,table:book.tables[0].id,row:book.tables[0].rows[1],registry:data.restaurants,loggedDetails:data.loggedDetails,first:data.foods[0].id};
    }finally{store.close();}
  });
  await page.goto(origin+'/');
  await expect(page.locator('td[data-r][data-c]').first()).toBeVisible();
  await page.getByRole('button',{name:'Meal log',exact:true}).click();
  return{fixture,unexpected,errors};
}
async function saved(page:Page){
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  return page.evaluate(async()=>{
    const {Store}=await import(new URL('/src/storage.ts',location.href).href),store=await Store.open();
    try{return(await store.load()).book;}finally{store.close();}
  });
}
async function chooseHome(page:Page,card:ReturnType<Page['locator']>,touch:boolean,info?:TestInfo){
  const trigger=card.getByRole('combobox',{name:'Choose restaurant',exact:true});
  if(touch)await trigger.tap();else await trigger.press('ArrowDown');
  const options=page.getByRole('option');
  await expect(options.first()).toHaveText('Home cooked');await expect(options.filter({hasText:/home cooked/i})).toHaveCount(1);
  if(info)await page.screenshot({path:info.outputPath('home-cooked-picker.png')});
  if(touch)await options.first().tap();else await options.first().press('Enter');
  await expect(card.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Home cooked');
  await trigger.click();await expect(page.getByRole('option',{name:'Home cooked',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Escape');
}
test('Home cooked Draft choice inherits, unlinks and survives Undo/reload without changing Logged data',async({page,isMobile},info)=>{
  const {fixture,unexpected,errors}=await setup(page),panel=page.locator('.meal-log-panel'),logged=panel.locator('[data-log-card]').first();
  await expect(logged).toBeVisible();
  await expect(logged.getByRole('combobox',{name:'Choose restaurant',exact:true})).toHaveCount(0);
  let book=await saved(page);expect(book.foodCapture.loggedDetails).toEqual(fixture.loggedDetails);
  expect(book.foodCapture.restaurants).toEqual(fixture.registry);
  expect(book.sheets.map((sheet:{cells:unknown})=>sheet.cells)).toEqual(fixture.sheets.map((sheet:{cells:unknown})=>sheet.cells));
  await panel.getByRole('tab',{name:'Draft',exact:true}).click();
  const draft=panel.getByRole('region',{name:'Draft foods',exact:true}),first=draft.locator('[data-draft-card]').first();
  await chooseHome(page,first,isMobile,info);
  await first.getByRole('button',{name:'+ Food',exact:true}).click();
  const inherited=draft.locator('[data-draft-card]').nth(1);
  await expect(inherited.locator('[data-restaurant-heading]')).toHaveText('Home cooked');
  await inherited.getByRole('button',{name:'Unlink restaurant',exact:true}).click();
  await expect(inherited.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('');
  await draft.getByRole('button',{name:'Undo',exact:true}).click();
  book=await saved(page);expect(book.foodCapture.foods[1].restaurantText).toBe('Home cooked');
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  book=await saved(page);expect(book.foodCapture.loggedDetails).toEqual(fixture.loggedDetails);
  expect(book.foodCapture.foods[0].restaurantText).toBe('Home cooked');expect(book.foodCapture.foods[1].restaurantText).toBe('Home cooked');
  expect(book.foodCapture.restaurants).toEqual(fixture.registry);
  expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
test('Home cooked combines a legacy link and typed composition in one request without changing nutrition',async({page},info)=>{
  const {fixture,unexpected,errors}=await setup(page),panel=page.locator('.meal-log-panel');
  await panel.getByRole('tab',{name:'Draft',exact:true}).click();
  const draft=panel.getByRole('region',{name:'Draft foods',exact:true}),first=draft.locator('[data-draft-card]').first();
  await expect(first.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Home cooked');
  await first.getByRole('button',{name:'+ Food',exact:true}).click();
  const second=draft.locator('[data-draft-card]').nth(1);
  await second.getByRole('button',{name:'Unlink restaurant',exact:true}).click();
  await second.getByRole('textbox',{name:'Draft Food',exact:true}).fill('Synthetic second home dish');
  await second.getByRole('textbox',{name:'Restaurant',exact:true}).evaluate(element=>{
    if(!(element instanceof HTMLInputElement))throw Error('Expected the shared restaurant input.');
    const input=element;
    input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    input.value='  home COOKED  ';
    input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:input.value}));
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await second.getByRole('textbox',{name:'Restaurant',exact:true}).press('Tab');
  await expect(second.getByRole('textbox',{name:'Restaurant',exact:true})).toHaveValue('Home cooked');
  const before=await saved(page);
  expect(before.foodCapture.foods[0].restaurant).toBe('legacy-home');expect(before.foodCapture.foods[0].values.calories).toBe('123');expect(before.foodCapture.foods[0].values.protein).toBe('0');
  await panel.getByRole('button',{name:'Get nutrition',exact:true}).click();
  const builder=page.getByRole('region',{name:'Nutrition builder',exact:true});
  await builder.getByRole('button',{name:'Generate prompt',exact:true}).click();
  const prompt=await builder.getByRole('textbox',{name:'Generated nutrition prompt',exact:true}).inputValue();
  expect(prompt.match(/### Draft food \/ Home cooked/g)).toHaveLength(1);
  expect(prompt.match(/"restaurant": "Home cooked"/g)).toHaveLength(3);
  expect(prompt).toContain('For dishes I label homemade or Home cooked');expect(prompt).toContain('If I specify an amount, use that instead.');
  await page.screenshot({path:info.outputPath('home-cooked-prompt.png')});
  const after=await saved(page);expect(after.foodCapture.foods).toEqual(before.foodCapture.foods);expect(after.foodCapture.restaurants).toEqual(fixture.registry);
  expect(after.sheets.map((sheet:{cells:unknown})=>sheet.cells)).toEqual(fixture.sheets.map((sheet:{cells:unknown})=>sheet.cells));
  expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});
