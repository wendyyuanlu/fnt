import {expect,test,type Page} from '@playwright/test';
import type {Workbook} from '../../src/model';
const records=(b:Workbook)=>JSON.stringify([[...b.tables,...(b.dropdownData?.tables??[])],[...b.sheets,...(b.dropdownData?.sheets??[])].map(s=>s.cells)]);

async function seedNavigation(page:Page){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const result=await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{createReference,setReferencePresentation,referenceTable}=await import(p+'references.ts') as typeof import('../../src/references'),{addRow,setInput}=await import(p+'model.ts') as typeof import('../../src/model'),store=await Store.open();
    try{
      const state=(await store.load())!,b=state.book,a=createReference(b,'Alpha'),z=createReference(b,'Beta'),c=createReference(b,'Gamma'),d=createReference(b,'Delta'),convert=createReference(b,'Convert','conversions');
      setReferencePresentation(b,z,'Beta','Other / Child');z.archived=true;setReferencePresentation(b,d,'Delta','Destination');
      const {table,sheet}=referenceTable(b,convert);
      const row=addRow(b,sheet,1,table);['tbsp','tsp','3'].forEach((value,i)=>setInput(b,sheet,row.id,table.columns[i].column,value));const notebook=b.sheets.find(s=>s.name==='Notebook')!;
      setInput(b,notebook,notebook.rows[1].id,notebook.columns[0].id,'=XLOOKUP("tbsp",Convert[From Unit],Convert[Conversion Factor],"")');
      await store.save(b,state.version,'Synthetic tab controls');
      return{a:a.id,z:z.id,c:c.id,d:d.id,convert:sheet.id,convertSource:convert.id,records:JSON.stringify([[...b.tables,...(b.dropdownData?.tables??[])],[...b.sheets,...(b.dropdownData?.sheets??[])].map(s=>s.cells)])};
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);return result;
}
async function persisted(page:Page){
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  return page.evaluate(async()=>{const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book;}finally{store.close();}});
}
const sourceTab=(page:Page,id:string)=>page.locator(`[data-reference="${id}"]:not([data-reference-group])`);

test('Chrome DD pills nest tightly with one short trailing divider and keep surrounding controls unchanged',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{setReferencePresentation}=await import(p+'references.ts') as typeof import('../../src/references'),store=await Store.open();
    try{const state=(await store.load())!;for(const source of state.book.references??[])if(source.catalog?.table.startsWith('Snack'))setReferencePresentation(state.book,source,source.label??source.name,'Snack / Chocolate / Imported');await store.save(state.book,state.version,'Synthetic three-level DD');}finally{store.close();}
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.locator('[data-action="references"]').click();
  const chrome=page.locator('.reference-group-depth-1').filter({has:page.locator('[data-reference-group="Snack"]')});
  await chrome.locator('[data-reference]:not([data-reference-group])').filter({hasText:/^Country$/}).click();
  const surrounding=await page.locator('.app-header,.toolbar,.formula-bar,.grid-shell,.tabs>[data-reference]:not([data-reference-group])').evaluateAll(elements=>elements.map(el=>({className:el.className,background:getComputedStyle(el).backgroundColor,padding:getComputedStyle(el).padding,font:getComputedStyle(el).fontSize})));
  await expect(chrome.locator('[data-reference-group]')).toHaveCount(3);
  const styles=await chrome.evaluate(el=>({
    outer:{height:getComputedStyle(el,'::after').height,width:getComputedStyle(el,'::after').width,color:getComputedStyle(el,'::after').backgroundColor,right:getComputedStyle(el,'::after').right},
    inner:[...el.querySelectorAll('.reference-tab-group')].map(group=>getComputedStyle(group,'::after').content),
    gaps:[el,...el.querySelectorAll('.reference-tab-group,.reference-group-members')].map(group=>getComputedStyle(group).gap)
  }));
  expect(styles.outer).toEqual({height:'12px',width:'1px',color:'rgb(218, 220, 224)',right:'0px'});expect(styles.inner.every(c=>c==='none')).toBe(true);expect(styles.gaps.every(g=>g==='2px')).toBe(true);
  const imported=chrome.locator('[data-reference-group="Snack / Chocolate / Imported"]');
  expect(await imported.evaluate(button=>{const svg=button.querySelector('svg')!,rect=svg.getBoundingClientRect();return{width:rect.width,height:rect.height,paddingRight:getComputedStyle(button).paddingRight,path:svg.querySelector('path')!.getAttribute('d'),stroke:svg.getAttribute('stroke'),strokeWidth:svg.getAttribute('stroke-width'),transform:getComputedStyle(svg).transform};})).toEqual({width:14,height:14,paddingRight:'3px',path:'m3 4 3 3 3-3',stroke:'currentColor',strokeWidth:'1',transform:'matrix(0, 1, -1, 0, 0, 0)'});
  await expect(page.locator('.format-caret svg')).toHaveCount(2);
  expect(await page.locator('.format-caret svg').evaluateAll(icons=>icons.every(svg=>svg.getBoundingClientRect().width===14&&svg.getBoundingClientRect().height===14&&svg.querySelector('path')!.getAttribute('d')==='m3 4 3 3 3-3'))).toBe(true);
  await imported.click();await expect(chrome.locator('.reference-group-depth-3>.reference-group-members')).toBeHidden();
  expect(await imported.locator('svg').evaluate(svg=>getComputedStyle(svg).transform)).toBe('matrix(0, -1, 1, 0, 0, 0)');
  await imported.click();
  await chrome.locator('[data-reference]:not([data-reference-group])').filter({hasText:/^Country$/}).click();
  await expect(page.locator('body')).toHaveClass(/dd-mode/);await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await expect(chrome.locator('.reference-group-depth-3>.reference-group-members')).toBeVisible();
  expect(await page.locator('.app-header,.toolbar,.formula-bar,.grid-shell,.tabs>[data-reference]:not([data-reference-group])').evaluateAll(elements=>elements.map(el=>({className:el.className,background:getComputedStyle(el).backgroundColor,padding:getComputedStyle(el).padding,font:getComputedStyle(el).fontSize})))).toEqual(surrounding);
  await imported.click();await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
  await expect(page.locator('body')).toHaveClass(/dd-mode/);await expect(page.locator('[data-reference-group="Snack / Chocolate / Imported"]')).toHaveAttribute('aria-expanded','false');
  const root=page.locator('.reference-group-depth-1').filter({has:page.locator('[data-reference-group="Snack"]')});
  expect(await root.evaluate(el=>getComputedStyle(el,'::after').display)).not.toBe('none');
  await page.locator('[data-reference-group="Snack"]').click();
  expect(await root.evaluate(el=>getComputedStyle(el,'::after').display)).toBe('none');
  await page.locator('[data-reference-group="Snack"]').click();
  expect(await root.evaluate(el=>getComputedStyle(el,'::after').display)).not.toBe('none');
  await page.getByRole('button',{name:'DD settings',exact:true}).click();
  const caret=page.getByRole('combobox',{name:'Group'}).locator('.format-caret svg');
  await expect(caret).toHaveCount(1);expect(await caret.evaluate(svg=>svg.getBoundingClientRect().width)).toBe(14);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
});

test('expanding workbook categories does not select or outline their member tabs',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const path='/src/',{Store}=await import(path+'storage.ts') as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book;
      book.sheetTabGroups={...book.sheetTabGroups,...Object.fromEntries(book.sheets.slice(0,3).map(sheet=>[sheet.id,'Tests']))};
      book.sheetTabCollapsed=['Tests'];await store.save(book,state.version,'Synthetic workbook category');
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const category=page.locator('[data-sheet-group="Tests"]'),members=page.locator('.sheet-tab-group').filter({has:category}).locator('[data-sheet]');
  await expect(category).toHaveClass(/tab-category/);
  expect(await category.locator('svg').evaluate(svg=>({width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,transform:getComputedStyle(svg).transform}))).toEqual({width:14,height:14,transform:'matrix(0, -1, 1, 0, 0, 0)'});
  await category.click();await expect(members).toHaveCount(3);await expect(members.first()).toBeVisible();
  expect(await category.locator('svg').evaluate(svg=>getComputedStyle(svg).transform)).toBe('matrix(0, 1, -1, 0, 0, 0)');
  expect(await category.evaluate(button=>({padding:getComputedStyle(button).padding,border:getComputedStyle(button).borderWidth,radius:getComputedStyle(button).borderRadius}))).toEqual({padding:'3px 3px 3px 7px',border:'0px',radius:'5px'});
  await expect(page.locator('.sheet-tab.tab-multi-selected')).toHaveCount(0);
  expect(await members.evaluateAll(tabs=>tabs.every(tab=>tab.getAttribute('aria-pressed')==='false'&&getComputedStyle(tab,'::before').content==='none'))).toBe(true);
  await category.click();await category.click();await expect(page.locator('.sheet-tab.tab-multi-selected')).toHaveCount(0);
  await members.first().click();await members.last().click({modifiers:['Shift']});
  await expect(page.locator('.sheet-tab.tab-multi-selected')).toHaveCount(3);
  await category.click();await category.click();await expect(page.locator('.sheet-tab.tab-multi-selected')).toHaveCount(0);
});

test('Convert belongs to DD while Shift-click selects workbook tabs without editing records',async({page})=>{
  const seed=await seedNavigation(page);
  await expect(page.locator(`[data-sheet="${seed.convert}"]`)).toHaveCount(0);
  await expect(page.locator('[data-action="structure"]')).toBeVisible();await expect(page.locator('.toolbar [data-action="groups"]')).toHaveCount(0);expect(await page.locator('.toolbar button:not([data-action="toolbar-layout"])').evaluateAll(buttons=>buttons.slice(-2).map(button=>button.getAttribute('data-action')))).toEqual(['tables','block']);
  await page.locator('[data-sheet]').first().click();await page.locator('[data-sheet]').last().click({modifiers:['Shift']});
  expect(await page.locator('[data-sheet].tab-multi-selected').count()).toBeGreaterThan(1);
  await page.locator('[data-action="references"]').click();await expect(sourceTab(page,seed.a)).toBeVisible();await sourceTab(page,seed.convertSource).click();
  await expect(page.locator('body')).toHaveClass(/dd-mode/);await expect(page.locator('.grid')).toContainText('tbsp');
  const b=await persisted(page);expect(records(b)).toBe(seed.records);
});
test('creates nested categories inside the group dropdown and duplicates selected DD tabs from either entry point',async({page})=>{
  const seed=await seedNavigation(page);await page.locator('[data-action="references"]').click();await sourceTab(page,seed.a).click();await page.getByRole('button',{name:'DD settings',exact:true}).click();
  await page.getByRole('combobox',{name:'Group'}).click();await expect(page.getByRole('button',{name:'Custom',exact:true})).toBeVisible();await page.getByRole('button',{name:'New category',exact:true}).click();
  const path=page.getByRole('textbox',{name:'New category path'});await path.fill('Fresh / Child / Leaf / Fourth');await page.getByRole('button',{name:'Create category',exact:true}).click();await expect(page.locator('.reference-category-create [role="alert"]')).toContainText('three');
  await path.fill('Destination');await path.press('Enter');await expect(page.locator('.reference-category-create [role="alert"]')).toContainText('already exists');
  await path.fill('Fresh / Child / Leaf');await path.press('Enter');await expect(page.getByRole('combobox',{name:'Group'})).toHaveText('Fresh / Child / Leaf');
  await page.getByRole('button',{name:'Duplicate',exact:true}).click();let b=await persisted(page),copy=b.references!.find(s=>s.name==='Alpha copy')!;
  expect(copy.group).toBe('Fresh / Child / Leaf');expect(copy.table).not.toBe(b.references!.find(s=>s.id===seed.a)?.table);await expect(sourceTab(page,copy.id)).toHaveClass(/current/);
  await sourceTab(page,copy.id).click({button:'right'});await page.getByRole('menuitem',{name:'Duplicate',exact:true}).click();b=await persisted(page);
  const second=b.references!.find(s=>s.name==='Alpha copy copy')!;expect(second.table).not.toBe(copy.table);await expect(sourceTab(page,second.id)).toHaveClass(/current/);
  await page.reload();await expect(sourceTab(page,second.id)).toBeVisible();await expect(page.locator('[data-reference-group="Fresh / Child / Leaf"]')).toBeVisible();
});

test('bulk DD settings show selected tabs, preserve mixed values and apply nested groups atomically',async({page})=>{
  const seed=await seedNavigation(page);await page.locator('[data-action="references"]').click();await sourceTab(page,seed.a).click();await sourceTab(page,seed.z).click({modifiers:['Shift']});
  await expect(sourceTab(page,seed.a)).toHaveClass(/tab-multi-selected/);await expect(sourceTab(page,seed.z)).toHaveClass(/tab-multi-selected/);
  await page.getByRole('button',{name:'DD settings',exact:true}).click();
  await expect(page.locator('.reference-selected-tabs legend')).toHaveText('Selected tabs (2)');await expect(page.locator('.reference-selected-tabs')).toContainText('Other / Child / Beta');
  await expect(page.getByRole('combobox',{name:'Group'})).toHaveText('Mixed groups');
  expect(await page.locator('#reference-available').evaluate(el=>(el as HTMLInputElement).indeterminate)).toBe(true);
  await expect(page.locator('datalist,.reference-help')).toHaveCount(0);await expect(page.locator('.reference-availability')).toHaveText('Show in DD picker');
  await page.getByRole('combobox',{name:'Group'}).click();await page.getByRole('button',{name:'Custom',exact:true}).click();await page.locator('#reference-group').fill('Cancelled');await page.locator('#reference-group').press('Escape');
  await expect(page.getByRole('combobox',{name:'Group'})).toHaveText('Mixed groups');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  let b=await persisted(page);expect(b.references!.find(s=>s.id===seed.a)?.group).toBeUndefined();expect(b.references!.find(s=>s.id===seed.z)?.group).toBe('Other / Child');expect(b.references!.find(s=>s.id===seed.z)?.archived).toBe(true);
  await page.getByRole('button',{name:'DD settings',exact:true}).click();await page.getByRole('combobox',{name:'Group'}).click();await page.getByRole('button',{name:'Custom',exact:true}).click();
  await page.locator('#reference-group').fill('New / Child / Leaf / Fourth');await page.locator('#reference-group').press('Enter');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.locator('#reference-settings-error')).toContainText('three');expect((await persisted(page)).references!.find(s=>s.id===seed.a)?.group).toBeUndefined();
  await page.getByRole('combobox',{name:'Group'}).click();await page.getByRole('button',{name:'Custom',exact:true}).click();await page.locator('#reference-group').fill('New / Child / Leaf');await page.locator('#reference-group').press('Enter');
  await page.locator('#reference-available').check();await page.locator('#reference-available').uncheck();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  b=await persisted(page);for(const id of [seed.a,seed.z])expect(b.references!.find(s=>s.id===id)).toMatchObject({group:'New / Child / Leaf',archived:true});
  expect(b.references!.find(s=>s.id===seed.c)?.group).toBeUndefined();expect(records(b)).toBe(seed.records);
  await page.reload();await expect(page.locator('[data-reference-group="New / Child / Leaf"]')).toBeVisible();
});

test('group picker shares searchable keyboard options and drag nesting supports multi-selected DDs',async({page})=>{
  const seed=await seedNavigation(page);await page.locator('[data-action="references"]').click();await sourceTab(page,seed.a).click();await page.getByRole('button',{name:'DD settings',exact:true}).click();
  await page.getByRole('combobox',{name:'Group'}).click();
  expect(await page.locator('.reference-group-dropdown').evaluate(el=>{const r=el.getBoundingClientRect();return !!el.closest('dialog[open]')&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})).toBe(true);
  await page.getByRole('searchbox',{name:'Search groups'}).fill('Destination');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(page.getByRole('combobox',{name:'Group'})).toHaveText('Destination');
  await page.getByRole('combobox',{name:'Group'}).click();await page.getByRole('option',{name:'Standalone',exact:true}).click();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await sourceTab(page,seed.a).click();await sourceTab(page,seed.c).click({modifiers:['Shift']});
  const moving=sourceTab(page,seed.a),target=page.locator('[data-reference-group="Destination"]');
  const transfer=await page.evaluateHandle(()=>new DataTransfer());await moving.dispatchEvent('dragstart',{dataTransfer:transfer});
  const rect=await target.boundingBox();await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:rect!.x+rect!.width/2});await target.dispatchEvent('drop',{dataTransfer:transfer,clientX:rect!.x+rect!.width/2});await transfer.dispose();
  let b=await persisted(page);for(const id of [seed.a,seed.c])expect(b.references!.find(s=>s.id===id)?.group).toBe('Destination');expect(b.references!.find(s=>s.id===seed.z)?.group).toBe('Destination / Other / Child');
  expect(records(b)).toBe(seed.records);
  const category=page.locator('[data-reference-group="Destination"]');
  await expect(category).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();b=await persisted(page);expect(b.references!.find(s=>s.id===seed.a)?.group).toBeUndefined();expect(b.references!.find(s=>s.id===seed.z)?.group).toBe('Other / Child');
});
