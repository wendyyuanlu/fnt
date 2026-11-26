import {expect,test,type Page} from '@playwright/test';
import {zipSync,strToU8} from 'fflate';

const xml=(text:string)=>strToU8(text),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rels='http://schemas.openxmlformats.org/package/2006/relationships';
function masterXlsx(){
  const headers=['Date','Weight','Calories','Fat (g)','Carbs (g)','Sugar (g)','Protein (g)','Sodium (mg)','Food','Amount (g)','Amount','Unit','Exercise','Period','isDay'];
  return Buffer.from(zipSync({
    'xl/workbook.xml':xml(`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Master" sheetId="1" r:id="r1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels':xml(`<Relationships xmlns="${rels}"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml':xml(`<worksheet xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1">${headers.map((value,i)=>`<c r="${String.fromCharCode(65+i)}1" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row><row r="2"><c r="B2" t="inlineStr"><is><t>(Tues)</t></is></c><c r="C2"><f>1+2</f><v>999</v></c>${[3,4,5,6,7].map(i=>`<c r="${String.fromCharCode(65+i)}2"><f>0</f><v>999</v></c>`).join('')}<c r="I2" t="inlineStr"><is><t>Example oats</t></is></c></row><row r="3"><c r="C3"><v>717</v></c><c r="I3" t="inlineStr"><is><t>Unmatched synthetic food</t></is></c></row></sheetData><tableParts><tablePart r:id="t1"/></tableParts></worksheet>`),
    'xl/worksheets/_rels/sheet1.xml.rels':xml(`<Relationships xmlns="${rels}"><Relationship Id="t1" Target="../tables/table1.xml"/></Relationships>`),
    'xl/tables/table1.xml':xml(`<table xmlns="${ns}" name="Master" displayName="Master" ref="A1:O3"><tableColumns>${headers.map((name,i)=>i>=2&&i<=7?`<tableColumn id="${i+1}" name="${name}"><calculatedColumnFormula>${i===2?'1+2':'0'}</calculatedColumnFormula></tableColumn>`:`<tableColumn id="${i+1}" name="${name}"/>`).join('')}</tableColumns></table>`)
  }));
}
async function setup(page:Page,broken=false){
  await page.goto('/');await expect(page.locator('.grid')).toBeVisible();
  await page.evaluate(async broken=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{createDemo,uid,key}=await import(p+'model.ts') as typeof import('../../src/model'),{compile}=await import(p+'formula.ts') as typeof import('../../src/formula'),store=await Store.open();
    try{
      const state=(await store.load())!,book=createDemo(),ingredients=book.tables.find(t=>t.name==='Ingredients')!,meals=book.tables.find(t=>t.name==='Meals')!,sheet=book.sheets.find(s=>s.id===meals.sheet)!,filter={id:uid(),name:'isMeal',column:sheet.columns[5].id},nameId=uid();
      meals.columns.push(filter);for(const row of meals.rows)sheet.cells[key(row,filter.column)]={value:row===meals.rows[0]};
      book.references=[{id:uid(),name:'Ingredients',kind:'list',table:ingredients.id,column:ingredients.columns[0].id,archivedRows:[]},{id:uid(),name:'MealDD',kind:'derived',nameId,archivedRows:[],derived:{table:broken?uid():meals.id,column:meals.columns[0].id,filter:{column:filter.id,value:true}}}];
      book.names.push({id:nameId,name:'MealDD',context:sheet.id,original:'=FILTER(Meals[Meal],Meals[isMeal]=TRUE)',formula:compile('=FILTER(Meals[Meal],Meals[isMeal]=TRUE)',book,sheet.id,meals.rows[0],meals.columns[0].column)});
      const notes=book.sheets.find(s=>s.name==='Notebook')!;notes.cells[key(notes.rows[2].id,notes.columns[2].id)]={value:'Example oats'};
      await store.save(book,state.version,'Disposable synthetic Master destination',false,undefined,{undoHistory:{undo:[],redo:[]}});
    }finally{store.close();}
  },broken);await page.reload();await expect(page.locator('.grid')).toBeVisible();
}
async function stored(page:Page){
  return page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,history=await store.undoHistory(state.version,state.book.id);return {version:state.version,book:state.book,undo:history?.undo.length,originals:await store.originalCount(),checkpoints:(await store.history()).map(h=>({label:h.label,backup:!!h.backup}))};}finally{store.close();}
  });
}
async function review(page:Page){
  await page.getByRole('button',{name:'Recovery'}).click();
  await page.locator('#import-master').setInputFiles({name:'Synthetic Master.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:masterXlsx()});
  await expect(page.getByRole('dialog',{name:'Master import review',exact:true})).toBeVisible();
}
test('Master source conflict stages a private report without writing data, history or Undo',async({page})=>{
  await setup(page,true);const before=await stored(page);
  await review(page);await expect(page.getByRole('dialog')).toContainText('No workbook changes have been applied');
  await expect(page.getByRole('dialog')).toContainText('MealDD points to a missing source identity');
  await expect(page.locator('#master-apply')).toHaveCount(0);
  const download=page.waitForEvent('download');await page.locator('#master-download').click();expect((await download).suggestedFilename()).toBe('master-import-private-review.json');
  const after=await stored(page);expect(after).toEqual(before);
});
test('explicit conflict-free Master application preserves Custom/manual/formula cells, full recovery, original and persistent import Undo',async({page})=>{
  await setup(page);const before=await stored(page);
  await review(page);await expect(page.locator('#master-apply')).toBeVisible();
  expect((await stored(page)).version).toBe(before.version);
  await page.locator('#master-apply').click();await expect(page.getByRole('grid',{name:'Master',exact:true})).toBeVisible();
  await expect(page.locator('#save-state')).toContainText('Imported');
  const after=await stored(page),master=after.book.tables.find(t=>t.name==='Master')!,sheet=after.book.sheets.find(s=>s.id===master.sheet)!;
  expect(after.originals).toBe(1);expect(after.undo).toBe(1);expect(after.checkpoints.some(h=>h.label==='Before Master import'&&h.backup)).toBe(true);
  for(const old of before.book.sheets)expect(after.book.sheets.find(s=>s.id===old.id)).toEqual(old);
  expect(sheet.cells[`${master.rows[0]}:${master.columns[8].column}`].binding?.row).toBe(before.book.tables.find(t=>t.name==='Ingredients')!.rows[0]);
  expect(sheet.cells[`${master.rows[1]}:${master.columns[2].column}`].value).toBe(717);
  await expect(page.locator('td[data-r="1"][data-c="2"]')).toHaveText('3');
  await page.reload();await expect(page.getByRole('grid',{name:'Master',exact:true})).toBeVisible();await page.locator('[data-action="undo"]').click();
  await expect(page.locator('#save-state')).toContainText('Saved');
  expect((await stored(page)).book.tables.some(t=>t.name==='Master')).toBe(false);
  await page.reload();await expect(page.locator('.grid')).toBeVisible();await page.locator('[data-action="redo"]').click();
  await expect(page.locator('#save-state')).toContainText('Saved');expect((await stored(page)).book.tables.some(t=>t.name==='Master')).toBe(true);
});
test('Master application refuses a concurrent saved edit after preflight without replacing that edit',async({page})=>{
  await setup(page);await review(page);await expect(page.locator('#master-apply')).toBeVisible();
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;state.book.title='Preserved concurrent synthetic edit';state.book.revision++;await store.save(state.book,state.version,'Concurrent synthetic edit');}finally{store.close();}
  });
  const before=await stored(page);await page.locator('#master-apply').click();
  await expect(page.locator('#save-state')).toContainText('Master import not applied');
  const after=await stored(page);expect(after).toEqual(before);expect(after.book.tables.some(table=>table.name==='Master')).toBe(false);
});
