import { expect,test,type Page } from '@playwright/test';

const saved=async(page:Page)=>{await expect(page.locator('#save-state')).toContainText('Saved');};
const manager=async(page:Page)=>{await page.getByRole('button',{name:'Lists & conversions',exact:true}).click();};
const close=async(page:Page)=>{await page.getByRole('button',{name:'Close dialog',exact:true}).click();};
const edit=async(page:Page,text:string)=>{await page.locator('#formula').fill(text);await page.getByRole('button',{name:'Apply',exact:true}).click();};
const snapshot=async(page:Page)=>{await saved(page);return page.evaluate(async()=>{const path='/src/',{Store}=await import(path+'storage.ts') as typeof import('../../src/storage'),s=await Store.open();try{const state=await s.load();if(!state)throw Error('Missing local test workbook');return await s.backup(state);}finally{s.close();}});};

test('DD stays independently at bottom right while a long sheet-tab strip scrolls',async({page,isMobile})=>{
  await page.goto('/');await saved(page);
  await page.evaluate(async()=>{
    const path='/src/',{Store}=await import(path+'storage.ts') as typeof import('../../src/storage'),{blankSheet}=await import(path+'model.ts') as typeof import('../../src/model'),store=await Store.open();
    try{const state=await store.load();if(!state)throw Error('Missing local test workbook');for(let i=1;i<=12;i++)state.book.sheets.push(blankSheet('Invented extra tab '+i,10,4));await store.save(state.book,state.version,'Synthetic tab overflow');}finally{store.close();}
  });
  await page.reload();const dd=page.getByRole('button',{name:'Lists & conversions',exact:true});
  await expect(dd).toHaveText('DD');await expect(dd).toHaveAttribute('title','Dropdown lists & conversions');
  const position=()=>page.evaluate(()=>{
    const button=document.querySelector('.reference-manager')!,tabs=document.querySelector<HTMLElement>('.tabs')!,b=button.getBoundingClientRect(),t=tabs.getBoundingClientRect();
    return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom,tabsRight:t.right,viewportWidth:innerWidth,viewportHeight:innerHeight,overflows:tabs.scrollWidth>tabs.clientWidth,reachable:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('.reference-manager')===button};
  });
  const before=await position();expect(before.overflows).toBe(true);expect(before.right).toBeGreaterThanOrEqual(before.viewportWidth-9);expect(before.bottom).toBeGreaterThanOrEqual(before.viewportHeight-5);
  expect(before.x).toBeGreaterThanOrEqual(before.tabsRight);expect(before.width).toBeGreaterThanOrEqual(44);if(isMobile)expect(before.height).toBeGreaterThanOrEqual(44);
  await page.locator('.tabs').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  const after=await position();expect(after.x).toBe(before.x);expect(after.y).toBe(before.y);expect(after.reachable).toBe(true);
  await dd.click();await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Lists & conversions');
});

test('editable lists keep exact duplicate-label links, preserve manual text, archive new choices, and undo persisted changes',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('td[data-r="1"][data-c="0"]').click();await edit(page,'Same');
  await page.locator('td[data-r="1"][data-c="1"]').click();await manager(page);
  await page.locator('#new-list').click();await page.locator('#answer').fill('Invented types');await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();
  for(let i=0;i<2;i++){await page.getByRole('textbox',{name:'New list value',exact:true}).fill('Same');await page.getByRole('button',{name:'Add value',exact:true}).click();}
  await expect(page.locator('.reference-option')).toHaveCount(2);
  await page.locator('#reference-bind').click();await close(page);
  await page.getByRole('button',{name:'Choose source',exact:true}).click();
  await page.locator('.validation-values [data-choice="1"]').click();
  await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Same');
  await manager(page);await page.getByRole('textbox',{name:'List value 2',exact:true}).fill('Renamed');await page.getByRole('textbox',{name:'List value 2',exact:true}).press('Tab');
  await expect(page.getByRole('textbox',{name:'List value 2',exact:true})).toHaveValue('Renamed');
  await page.getByRole('button',{name:'Move option 2 earlier',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'List value 1',exact:true})).toHaveValue('Renamed');
  await page.locator('.reference-option').first().getByRole('button',{name:'Archive',exact:true}).click();
  await close(page);await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Renamed');await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Same');
  await page.getByRole('button',{name:'Choose source',exact:true}).click();
  await expect(page.locator('.validation-values [data-choice]')).toHaveCount(1);await expect(page.locator('.validation-values')).not.toContainText('Renamed');
  await close(page);await saved(page);await page.reload();
  await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Renamed');
  await manager(page);await page.locator('.reference-option').first().getByRole('button',{name:'Remove',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('1 linked cells');
  await page.locator('#replacement').selectOption({index:1});await page.locator('#delete-option').click();await expect(page.locator('.reference-option')).toHaveCount(1);
  await close(page);await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Same');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Renamed');
  await manager(page);await expect(page.locator('.reference-option')).toHaveCount(2);
  await page.getByRole('textbox',{name:'List value 2',exact:true}).focus();await page.keyboard.press('Delete');await expect(page.locator('.reference-option')).toHaveCount(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('derived lists use explicit live table/field/filter connections and exact row choices',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.locator('td[data-r="1"][data-c="1"]').click();
  await manager(page);await page.locator('#new-derived').click();await page.locator('#answer').fill('Meal choices');await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('#derived-status')).toContainText('unavailable');
  await page.locator('#derived-table').selectOption({label:'Meals'});await page.locator('#derived-column').selectOption({label:'Meal'});await page.locator('#derived-filter').selectOption({label:'Ingredient'});await page.locator('#derived-equals').fill('Example oats');
  await page.getByRole('button',{name:'Save connection',exact:true}).click();await expect(page.locator('#derived-status')).toHaveText('Live: 1 choices.');
  await page.locator('#reference-bind').click();await close(page);await page.getByRole('button',{name:'Choose source',exact:true}).click();
  await page.locator('.validation-values [data-choice="0"]').click();await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Example breakfast');
  await page.getByRole('button',{name:'Meals',exact:true}).click();await page.locator('td[data-r="1"][data-c="0"]').click();await edit(page,'Renamed invented meal');
  await page.getByRole('button',{name:'Notebook',exact:true}).click();await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('Renamed invented meal');
  await saved(page);await page.reload();await manager(page);await expect(page.locator('#derived-status')).toHaveText('Live: 1 choices.');
});

test('supporting Excel import preserves logs, archives all prior state, leaves absent original Meals unavailable and survives native roundtrip',async({page})=>{
  await page.goto('/');await saved(page);
  const fixture=await page.evaluate(async()=>{
    const path='/src/',dependency='/node_modules/fflate/esm/browser.js';
    const {createDemo,blankSheet,setInput,uid}=await import(path+'model.ts') as typeof import('../../src/model'),{exportXlsx}=await import(path+'xlsx-export.ts') as typeof import('../../src/xlsx-export'),{unzipSync,zipSync}=await import(dependency) as typeof import('fflate');
    const b=createDemo(),dropdowns=blankSheet('Dropdowns',90,6),convert=blankSheet('Convert',12,6),derived=blankSheet('MealDD',8,3);
    b.sheets.push(dropdowns,convert,derived);
    const meals=b.tables.find(t=>t.name==='Meals')!,mealSheet=b.sheets.find(s=>s.id===meals.sheet)!,flag=mealSheet.columns[5].id;
    meals.columns.push({id:uid(),column:flag,name:'isMeal'});setInput(b,mealSheet,meals.header,flag,'isMeal');meals.rows.forEach((row,i)=>setInput(b,mealSheet,row,flag,i===0?'TRUE':'FALSE'));
    function table(s:typeof dropdowns,name:string,at:number,headers:string[],rows:string[][]){
      const t={id:uid(),name,sheet:s.id,header:s.rows[at].id,rows:s.rows.slice(at+1,at+1+rows.length).map(r=>r.id),columns:headers.map((name,i)=>({id:uid(),column:s.columns[i].id,name}))};
      b.tables.push(t);[headers,...rows].forEach((row,i)=>row.forEach((v,j)=>setInput(b,s,s.rows[at+i].id,s.columns[j].id,v)));
    }
    ['IngredientType','Period','AnimalType','Table14','SnackCountry','SnackFlavour','SnackCategory'].forEach((name,i)=>table(dropdowns,name,i*5,[name+' field'],[['Invented A'],[name==='Period'?'':'Invented B']]));
    table(convert,'Convert',0,['From Unit','To Unit','Conversion Factor'],[['tbsp','tsp','3']]);setInput(b,derived,derived.rows[0].id,derived.columns[0].id,'=FILTER(Meals[Meal],Meals[isMeal]=TRUE)');
    const {compile}=await import(path+'formula.ts') as typeof import('../../src/formula'),original='=FILTER(Meals[Meal],Meals[isMeal]=TRUE)';
    b.names.push({id:uid(),name:'MealDD',context:derived.id,original,formula:compile(original,b,derived.id,derived.rows[0].id,derived.columns[0].id)});
    const parts=unzipSync(await exportXlsx({format:'fnt-backup',version:1,state:{book:b,version:1,pending:[],updated:'now'},originals:[]}));
    delete parts['fnt/backup.json.gz'];delete parts['fnt/manifest.json'];
    const bytes=zipSync(parts),{importXlsx}=await import(path+'xlsx.ts') as typeof import('../../src/xlsx');
    const subset=await importXlsx(Uint8Array.from(bytes).buffer,'subset.xlsx',{sheets:['Dropdowns','Convert','MealDD']}),omitted=subset.book.sheets.find(s=>s.name==='Meals')!;
    return{bytes:Array.from(bytes),omittedCells:Object.keys(omitted.cells).length,omittedTablePresent:subset.book.tables.some(t=>t.sheet===omitted.id&&t.name==='Meals'),formulaCount:subset.book.importReport!.formulaCount};
  });
  expect(fixture.omittedCells).toBe(0);expect(fixture.omittedTablePresent).toBe(true);expect(fixture.formulaCount).toBe(1);
  const buffer=Buffer.from(fixture.bytes);
  await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.locator('td[data-r="1"][data-c="0"]').click();await edit(page,'Existing local note');
  const before=await snapshot(page);let githubRequests=0;page.on('request',r=>{if(r.url().includes('api.github.com'))githubRequests++;});
  await manager(page);await page.locator('#import-references').setInputFiles({name:'invented-supporting.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  await expect(page.locator('#reference-notice')).toContainText('Imported 7 lists');await expect(page.locator('#reference-notice')).toContainText('1 conversion rules');
  await page.locator('#reference-source').selectOption({label:'Period'});await expect(page.locator('.reference-option')).toHaveCount(2);await expect(page.getByRole('textbox',{name:'List value 2',exact:true})).toHaveValue('');
  await page.locator('#reference-source').selectOption({label:'MealDD'});await expect(page.locator('#derived-status')).toContainText('Original derived source unavailable');
  await expect(page.locator('#derived-table')).toHaveValue('');await close(page);await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Existing local note');
  await expect(page.getByRole('button',{name:'Dropdowns',exact:true})).toHaveCount(0);
  const after=await snapshot(page);for(const original of before.state.book.sheets)expect(after.state.book.sheets.find(s=>s.id===original.id)).toEqual(original);
  expect(after.originals).toHaveLength(1);expect(after.state.sync).toBeUndefined();expect(after.state.pending.map(p=>p.id)).toEqual(expect.arrayContaining(before.state.pending.map(p=>p.id)));
  const proof=await page.evaluate(async()=>{
    const path='/src/',{Store}=await import(path+'storage.ts') as typeof import('../../src/storage'),{parseArchive}=await import(path+'archive.ts') as typeof import('../../src/archive'),{exportXlsx}=await import(path+'xlsx-export.ts') as typeof import('../../src/xlsx-export'),{importXlsx}=await import(path+'xlsx.ts') as typeof import('../../src/xlsx'),s=await Store.open();
    try{const state=await s.load();if(!state)throw Error('Missing local test workbook');const backup=await s.backup(state),history=await s.history(),prior=parseArchive(history.find(h=>h.label==='Before Supporting data import')!.backup!),restored=await importXlsx(Uint8Array.from(await exportXlsx(backup)).buffer,'roundtrip.xlsx');return{prior,identical:JSON.stringify(restored.nativeBackup)===JSON.stringify(backup)};}finally{s.close();}
  });
  expect(proof.prior).toEqual(before);expect(proof.identical).toBe(true);
  await page.reload();await manager(page);await page.locator('#import-attached-references').click();await expect(page.locator('#reference-notice')).toContainText('already imported');
  const again=await snapshot(page);expect(again.state.book).toEqual(after.state.book);expect(githubRequests).toBe(0);
  await page.locator('#reference-source').selectOption({label:'Units'});await page.getByRole('textbox',{name:'List value 1',exact:true}).fill('Invented spoon');await page.getByRole('textbox',{name:'List value 1',exact:true}).press('Tab');
  await page.locator('#reference-source').selectOption({label:'Convert'});
  await expect(page.locator('.conversion-rule').first().getByRole('combobox',{name:'From unit',exact:true}).locator('option:checked')).toContainText('Invented spoon');
  await close(page);await page.locator('td[data-r="1"][data-c="1"]').click();await edit(page,'=SUM(Convert[Conversion Factor])');
  await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('3');
  await manager(page);await page.locator('#reference-source').selectOption({label:'Convert'});
  await page.locator('.conversion-rule').first().getByRole('textbox',{name:'Conversion factor',exact:true}).fill('6');await page.locator('.conversion-rule').first().getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Recalculate affected records?');await page.locator('#confirm').click();
  await expect(page.locator('.conversion-rule').first().getByRole('textbox',{name:'Conversion factor',exact:true})).toHaveValue('6');
  await close(page);await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('6');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('3');await saved(page);await page.reload();await expect(page.locator('td[data-r="1"][data-c="1"]')).toHaveText('3');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
