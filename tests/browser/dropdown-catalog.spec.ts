import { expect,test } from '@playwright/test';
const records='.grid tbody tr[data-row]:has(td:not(.table-header))';
const values=(page:import('@playwright/test').Page)=>page.locator(records+' td').evaluateAll(nodes=>nodes.map(n=>n.textContent??''));
const choose=async(page:import('@playwright/test').Page,name:string)=>page.locator('[data-reference]').filter({hasText:new RegExp('^'+name+'$')}).click();

const expected=[
  {name:'IngredientType',values:['Seasoning','Staple','Whole','Premade']},
  {name:'Period',values:['','Spotting','Yes']},
  {name:'AnimalType',values:['🐔 Chicken','🦃 Turkey','🐮 Beef','🐷 Pork']},
  {name:'Table14',values:['🍦 Snack',' ']},
  {name:'SnackCountry',values:['Taiwan','Japan','Canada','USA']},
  {name:'SnackFlavour',values:['Savoury','Sweet','Mixed']},
  {name:'SnackCategory',values:['Chocolate','Gummy','Chip/Noodle','Cookie','Pastry','Biscuit','Bread','Pudding/Custard']}
];
test('fresh browser automatically displays every original dropdown in DD and the source picker, then persists edits without reseeding',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Lists & conversions',exact:true}).click();
  for(const list of expected){
    await choose(page,list.name);
    await expect.poll(()=>values(page)).toEqual(list.values);
  }
  await choose(page,'SnackCountry');await page.locator(records+' td').first().click();
  await page.locator('#formula').fill('User country');await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.locator(records+' th').first().click();await page.locator('[data-action="archive-options"]').click();
  await page.getByRole('button',{name:'Close lists & conversions',exact:true}).click();
  await page.locator('[data-action="dropdown-source"]').click();
  await expect(page.locator('#dropdown-source option').filter({hasText:/^SnackCountry$/})).toHaveCount(1);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();
  await page.getByRole('button',{name:'Lists & conversions',exact:true}).click();
  await expect(page.locator('[data-reference]')).toHaveCount(7);
  await choose(page,'SnackCountry');
  await expect(page.locator(records+' td').first()).toHaveText('User country');
  await expect(page.locator(records).first()).toHaveClass(/archived/);
});
test('older saved profile receives catalogs once with full recovery and existing IDs, custom source and pending edits intact',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  const old=await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{createDemo,key}=await import(p+'model.ts') as typeof import('../../src/model'),{createReference,addReferenceValue}=await import(p+'references.ts') as typeof import('../../src/references'),store=await Store.open();
    try{
      const state=(await store.load())!,book=createDemo(),ref=createReference(book,'SnackCountry');
      addReferenceValue(book,ref,'Keep custom value');book.sheets[0].cells[key(book.sheets[0].rows[2].id,book.sheets[0].columns[0].id)]={value:'Unsynced original note'};
      const saved=await store.save(book,state.version,'Old profile edit');return{book:saved.book,pending:saved.pending};
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Lists & conversions',exact:true}).click();
  await choose(page,'SnackCountry');await expect(page.locator(records+' td').first()).toHaveText('Keep custom value');
  await choose(page,'SnackCountry_2');await expect.poll(()=>values(page)).toEqual(['Taiwan','Japan','Canada','USA']);
  const proof=await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{parseArchive}=await import(p+'archive.ts') as typeof import('../../src/archive'),store=await Store.open();
    try{const state=(await store.load())!,history=await store.history();return{state,prior:parseArchive(history.find(h=>h.label==='Before Add original Dropdowns catalogs')!.backup!)};}finally{store.close();}
  });
  expect(proof.state.book.id).toBe(old.book.id);expect(proof.state.book.sheets.slice(0,4)).toEqual(old.book.sheets.slice(0,4));expect(proof.state.pending.slice(0,-1)).toEqual(old.pending);
  expect((proof.prior as {state:{book:unknown}}).state.book).toEqual(old.book);
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Lists & conversions',exact:true}).click();await expect(page.locator('[data-reference]')).toHaveCount(8);
});
