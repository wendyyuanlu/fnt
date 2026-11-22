import {expect,test,type Page} from '@playwright/test';

async function fixture(page:Page,badges=true){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async(badges)=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets[0];
      s.groups=[{id:'summary',axis:'row',kind:'summary',members:s.rows.slice(1,4).map(r=>r.id),collapsed:false,label:'Summary'},
        {id:'col-summary',axis:'column',kind:'summary',members:s.columns.slice(1,4).map(c=>c.id),collapsed:false,label:'Columns'},
        {id:'plain',axis:'row',kind:'range',members:s.rows.slice(5,7).map(r=>r.id),collapsed:true,label:'Plain'}];
      for(let r=1;r<7;r++)s.cells[`${s.rows[r].id}:${s.columns[0].id}`]={value:`Example ${r}`};
      if(badges){
        const path='/src/hypothetical.ts',{getHypotheticalStyle}=await import(/* @vite-ignore */path) as typeof import('../../src/hypothetical');
        state.book.hypotheticalStyle=getHypotheticalStyle(state.book);
        state.book.hypotheticalStyle.rows.badge=true;state.book.hypotheticalStyle.columns.badge=true;
      }
      await store.save(state.book,state.version,'Synthetic hypothetical fixture');
    }finally{store.close();}
  },badges);await page.reload();
}
async function snapshot(page:Page){
  await expect(page.locator('#save-state')).toContainText('Saved');
  return page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book;}finally{store.close();}});
}
test('global errors overlay the bottom edge without moving the spreadsheet',async({page})=>{
  await fixture(page,false);await page.locator('td[data-r="2"][data-c="0"]').click();
  const layout=()=>page.evaluate(()=>['.app-header','#grid-scroll','.tabs'].map(selector=>{
    const r=document.querySelector(selector)!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
  }));
  const before=await layout();await page.keyboard.press('Control+h');
  const toast=page.locator('#error');await expect(toast).toContainText('Select entire rows or columns');
  await expect(toast).toHaveAttribute('role','alert');expect(await layout()).toEqual(before);
  const bounds=(await toast.boundingBox())!,viewport=page.viewportSize()!;
  expect(bounds.x).toBe(0);expect(bounds.width).toBe(viewport.width);expect(bounds.y+bounds.height).toBeCloseTo(viewport.height,1);
  expect(await toast.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+h');
  await expect(toast).toBeHidden();
});
test('row tags inherit, clear, persist and sit between the summary chevron and value',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+h');
  await expect(page.locator('td[data-c="0"] .hypothetical-badge')).toHaveCount(3);
  const s=(await snapshot(page)).sheets[0];expect(s.rows[1].hypothetical).toBe(true);expect(s.rows[2].hypothetical).toBeUndefined();expect(s.cells).toEqual(before.sheets[0].cells);
  const cell=page.locator('td[data-r="1"][data-c="0"]'),chevron=(await cell.locator('.summary-chevron').boundingBox())!,badge=(await cell.locator('.hypothetical-badge').boundingBox())!,value=(await cell.locator('.cell-value').boundingBox())!;
  expect(badge.x).toBeGreaterThanOrEqual(chevron.x+chevron.width);expect(value.x).toBeGreaterThanOrEqual(badge.x+badge.width);
  await page.reload();await expect(page.locator('td[data-c="0"] .hypothetical-badge')).toHaveCount(3);
  await page.locator('[data-row-select="2"] .row-index').click();await page.keyboard.press('Control+Shift+h');await expect(page.locator('td[data-r="2"] .hypothetical-badge')).toHaveCount(0);
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+Shift+h');await expect(page.locator('.hypothetical-badge')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.hypothetical-badge')).toHaveCount(2);
});
test('column tags inherit and inherited row tags disappear when dragged out of a summary',async({page})=>{
  await fixture(page);
  const columnCell=page.locator('td[data-r="0"][data-c="1"]'),height=(await columnCell.boundingBox())!.height;
  await page.locator('th[data-col="1"] .column-index').click();await page.keyboard.press('Control+h');
  await expect(page.locator('td[data-r="0"] .hypothetical-badge')).toHaveCount(3);
  const chevron=(await columnCell.locator('.column-summary-controls .group-control').boundingBox())!,badge=(await columnCell.locator('.hypothetical-badge').boundingBox())!,value=(await columnCell.locator('.cell-value').boundingBox())!;
  expect(badge.x).toBeGreaterThanOrEqual(chevron.x+chevron.width);expect(value.x).toBeGreaterThanOrEqual(badge.x+badge.width);expect((await columnCell.boundingBox())!.height).toBe(height);
  await page.locator('th[data-col="1"] .column-index').click();await page.keyboard.press('Control+Shift+h');await expect(page.locator('.hypothetical-badge')).toHaveCount(0);
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+h');
  await page.locator('[data-row-select="2"] .row-index').click();await page.locator('[data-move-row="2"]').click();await page.locator('[data-insert-row="9"]').click();
  const s=(await snapshot(page)).sheets[0],moved=s.rows.findIndex(row=>s.cells[`${row.id}:${s.columns[0].id}`]?.value==='Example 2');
  await expect(page.locator(`td[data-r="${moved}"] .hypothetical-badge`)).toHaveCount(0);expect(s.rows[moved].hypothetical).toBeUndefined();
});
test('ungrouping all plain groups is checkpointed and undoable without touching cells or summaries',async({page})=>{
  await fixture(page);const before=await snapshot(page);
  await page.getByRole('button',{name:'Group controls',exact:true}).click();await page.getByRole('button',{name:'Manage groups',exact:true}).click();
  await page.getByRole('button',{name:'Ungroup all plain groups (workbook)',exact:true}).click();
  const after=await snapshot(page);expect(after.sheets[0].groups).toEqual(before.sheets[0].groups.filter(g=>g.kind==='summary'));expect(after.sheets[0].cells).toEqual(before.sheets[0].cells);
  const saved=await page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.history()).some(item=>item.label==='Before ungrouping all plain groups');}finally{store.close();}});expect(saved).toBe(true);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshot(page)).sheets[0].groups).toEqual(before.sheets[0].groups);
});
test('D covers tagged rows and columns without badges, dimming only text and preserving cell formats',async({page})=>{
  await fixture(page,false);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets[0];s.cells[`${s.rows[2].id}:${s.columns[0].id}`].format={color:'#884466',background:'#f6eff2',bold:true,wrap:false};await store.save(state.book,state.version,'Synthetic formats');}finally{store.close();}
  });await page.reload();const before=await snapshot(page),cell=page.locator('td[data-r="2"][data-c="0"]'),rect=(await cell.boundingBox())!;
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+h');
  await expect(page.locator('td[data-c="0"].hypothetical-cell')).toHaveCount(3);await expect(page.locator('.hypothetical-badge')).toHaveCount(0);
  const style=await cell.evaluate(cell=>({background:getComputedStyle(cell).backgroundImage,opacity:getComputedStyle(cell).opacity}));
  expect(style.background).toContain('2px');expect(style.background).toContain('8px');expect(style.opacity).toBe('1');
  const text=await cell.locator('.cell-value').evaluate(el=>({opacity:getComputedStyle(el).opacity,color:getComputedStyle(el).color,bold:getComputedStyle(el).fontWeight}));
  expect(text).toEqual({opacity:'0.8',color:'rgb(136, 68, 102)',bold:'700'});expect((await cell.boundingBox())!.height).toBe(rect.height);
  await page.locator('th[data-col="1"] .column-index').click();await page.keyboard.press('Control+h');
  await expect(page.locator('td[data-c="1"].hypothetical-cell')).toHaveCount(await page.locator('td[data-c="1"]').count());
  expect(await page.locator('td[data-r="0"][data-c="0"] .cell-value').evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
  expect((await snapshot(page)).sheets[0].cells).toEqual(before.sheets[0].cells);
  const icon=page.locator('[data-action="hypothetical"] .toolbar-icon'),settings=page.locator('[data-action="hypothetical-settings"] .toolbar-icon');
  expect(await icon.locator('.stamp-frame').getAttribute('d')).toContain('a1.5 1.5');
  expect(await icon.locator('path:not(.stamp-frame)').evaluate(el=>{const r=(el as SVGGraphicsElement).getBBox();return {width:r.width,height:r.height};})).toEqual({width:9,height:10});
  await expect(settings.locator('rect')).toHaveAttribute('stroke-dasharray','2 2');
  await expect(settings.locator('rect')).toHaveAttribute('rx','1.5');
  const geometry=await settings.evaluate(el=>({width:el.getBoundingClientRect().width,stroke:getComputedStyle(el).strokeWidth,vector:el.querySelector('path')!.getAttribute('vector-effect')}));
  expect(geometry).toEqual({width:18,stroke:'1px',vector:'non-scaling-stroke'});
});
async function color(page:Page,id:string,value:string){
  await page.locator('#'+id).evaluate((input:HTMLInputElement,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},value);
}
async function pattern(page:Page,name:string){
  await page.getByRole('combobox',{name:'Pattern',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();
}
test('saves independently customizable treatments, colors and names, with row priority, reload and cancel',async({page})=>{
  await fixture(page,false);
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+h');
  await page.locator('th[data-col="1"] .column-index').click();await page.keyboard.press('Control+h');const before=await snapshot(page);
  await page.getByRole('button',{name:'Hypothetical treatments',exact:true}).click();
  await expect(page.locator('.treatment-axis + #hypothetical-preview')).toHaveCount(1);
  await expect(page.locator('.hypothetical-dialog h2')).toHaveText('Hypothetical styling');
  await expect(page.locator('.treatment-axis')).toBeHidden();
  const fields=page.locator('.treatment-fields'),sections=page.locator('.treatment-section');
  expect(await sections.locator('legend').allTextContents()).toEqual(['Pattern','Text','Fill','Badge']);
  for(let i=0;i<await sections.count();i++){
    if(i){const previous=(await sections.nth(i-1).boundingBox())!,current=(await sections.nth(i).boundingBox())!;expect(previous.y+previous.height).toBeLessThanOrEqual(current.y);}
    const controls=sections.nth(i).locator(':scope > label,:scope > .treatment-control');
    for(let j=1;j<await controls.count();j++){const previous=(await controls.nth(j-1).boundingBox())!,current=(await controls.nth(j).boundingBox())!;expect(previous.y+previous.height).toBeLessThanOrEqual(current.y);}
  }
  expect((await fields.boundingBox())!.height).toBeLessThan(650);
  expect(await page.locator('.hypothetical-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(page.locator('.hypothetical-dialog p.muted,#hyp-reset,#hyp-badge-text')).toHaveCount(0);
  const preview=(await page.locator('#hypothetical-preview').boundingBox())!,name=(await page.locator('#hyp-label').boundingBox())!;
  expect(name.y).toBeGreaterThan(preview.y+preview.height);
  const fieldsBounds=(await fields.boundingBox())!;expect(name.y).toBeGreaterThan(fieldsBounds.y+fieldsBounds.height);
  await page.locator('#hyp-label').fill('Draft');await pattern(page,'Crosshatch');
  await color(page,'hyp-patternColor','#4b6577');await page.locator('#hyp-strokeWidth').fill('3');await page.locator('#hyp-gap').fill('12');
  await page.locator('#hyp-angle').fill('45');await page.locator('#hyp-patternOpacity').fill('18');await page.locator('#hyp-textOpacity').fill('65');
  await page.locator('#hyp-fillOpacity').fill('35');await color(page,'hyp-fillColor','#fff0e0');
  await page.locator('#hyp-keep-color').uncheck();await color(page,'hyp-textColor','#6f3b55');await page.locator('#hyp-italic').check();await page.locator('#hyp-badge').check();
  await color(page,'hyp-badgeColor','#442244');await color(page,'hyp-badgeBackground','#ffeeff');await color(page,'hyp-badgeBorder','#665566');
  const dialog=page.locator('.hypothetical-dialog'),footer=dialog.locator('.treatment-footer');
  for(const portion of [0,.5,1]){
    await dialog.evaluate((el,portion)=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*portion;},portion);
    const bottom=(await dialog.boundingBox())!,buttons=(await footer.boundingBox())!;
    expect(buttons.y+buttons.height).toBeCloseTo(bottom.y+bottom.height-1,1);
  }
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(page.locator('#hyp-badgeDashSize')).toBeDisabled();
  await page.getByRole('combobox',{name:'Border',exact:true}).click();await page.getByRole('option',{name:'Dashed',exact:true}).click();
  await page.locator('#hyp-badgeDashSize').fill('6');await page.locator('#hyp-badgeDashGap').fill('3');
  await page.locator('#hyp-linked').uncheck();await expect(page.locator('.treatment-axis')).toBeVisible();await page.getByRole('button',{name:'Columns',exact:true}).click();
  await pattern(page,'Dots');await page.locator('#hyp-keep-color').check();await page.locator('#hyp-italic').uncheck();await page.locator('#hyp-badge').uncheck();await page.locator('#hyp-fillOpacity').fill('0');
  await color(page,'hyp-patternColor','#3f7566');await page.locator('#hyp-strokeWidth').fill('1.5');await page.locator('#hyp-gap').fill('8');await page.locator('#hyp-textOpacity').fill('90');
  await page.locator('.hypothetical-dialog').getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('.hypothetical-dialog')).toHaveCount(0);
  const after=await snapshot(page),style=after.hypotheticalStyle!;
  expect(style).toMatchObject({label:'Draft',linked:false,rows:{pattern:'crosshatch',patternColor:'#4b6577',strokeWidth:3,gap:12,angle:45,textOpacity:.65,textColor:'#6f3b55',fillOpacity:.35,italic:true,badge:true,badgeBorderStyle:'dashed',badgeDashSize:6,badgeDashGap:3},columns:{pattern:'dots',strokeWidth:1.5,gap:8,textOpacity:.9,badge:false}});
  expect(after.sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  const intersection=page.locator('td[data-r="1"][data-c="1"]'),columnOnly=page.locator('td[data-r="0"][data-c="1"]');
  expect(await intersection.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('repeating-linear-gradient');
  expect(await columnOnly.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('radial-gradient');
  expect(await intersection.locator('.cell-value').evaluate(el=>getComputedStyle(el).opacity)).toBe('0.65');
  expect(await columnOnly.locator('.cell-value').evaluate(el=>getComputedStyle(el).opacity)).toBe('0.9');
  const badge=page.locator('td[data-r="1"][data-c="0"] .hypothetical-badge .toolbar-icon');
  await expect(badge.locator('.stamp-frame,rect')).toHaveCount(0);
  expect(await badge.locator('path').evaluate(el=>{const r=(el as SVGGraphicsElement).getBBox();return {width:r.width,height:r.height};})).toEqual({width:16,height:16});
  const geometry=await badge.evaluate(el=>{
    const wrapper=el.closest('.hypothetical-badge')!,r=wrapper.getBoundingClientRect(),h=el.querySelector('path')!.getBoundingClientRect();
    return {width:r.width,height:r.height,padding:[h.left-r.left,r.right-h.right,h.top-r.top,r.bottom-h.bottom],border:getComputedStyle(wrapper,'::before').backgroundImage,fill:getComputedStyle(wrapper).backgroundColor};
  });
  expect(geometry.width).toBe(geometry.height);for(const padding of geometry.padding)expect(padding).toBeCloseTo(geometry.padding[0],2);
  expect(geometry.border).toContain('6px');expect(geometry.border).toContain('9px');expect(geometry.fill).toBe('rgb(255, 238, 255)');
  await page.reload();await page.getByRole('button',{name:'Hypothetical treatments',exact:true}).click();
  await expect(page.locator('#hyp-label')).toHaveValue('Draft');await expect(page.locator('#hyp-linked')).not.toBeChecked();await expect(page.locator('#hyp-gap')).toHaveValue('12');
  expect(await page.locator('.hypothetical-preview .hypothetical-badge .toolbar-icon').first().innerHTML()).toBe(await badge.innerHTML());
  await expect(page.locator('#hyp-badgeDashSize')).toHaveValue('6');await expect(page.locator('#hyp-badgeDashGap')).toHaveValue('3');
  await page.getByRole('combobox',{name:'Border',exact:true}).click();await page.getByRole('option',{name:'Solid',exact:true}).click();
  await expect(page.locator('#hyp-badgeDashSize')).toBeDisabled();
  const solid=await page.locator('.hypothetical-preview .hypothetical-badge').first().evaluate(el=>({border:getComputedStyle(el).borderColor,radius:getComputedStyle(el).borderRadius,dash:getComputedStyle(el,'::before').backgroundImage}));
  expect(solid).toEqual({border:'rgb(102, 85, 102)',radius:'0px',dash:'none, none, none, none'});
  await page.locator('#hyp-linked').check();await expect(page.locator('.treatment-axis')).toBeHidden();await page.locator('#hyp-textOpacity').fill('50');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await snapshot(page)).hypotheticalStyle).toEqual(style);
});
test('a failed treatment save is explicit, retains durable data and can be retried',async({page})=>{
  await fixture(page,false);const before=await snapshot(page);
  await page.getByRole('button',{name:'Hypothetical treatments',exact:true}).click();await page.locator('#hyp-textOpacity').fill('55');
  const restore=await page.evaluateHandle(()=>{
    const original=IDBObjectStore.prototype.put;let fail=true;
    IDBObjectStore.prototype.put=function(...args:Parameters<typeof original>){if(fail){fail=false;throw new DOMException('Synthetic quota exhausted','QuotaExceededError');}return original.apply(this,args);};
    return()=>{IDBObjectStore.prototype.put=original;};
  });
  await page.locator('.hypothetical-dialog').getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('.treatment-error')).toContainText('Synthetic quota exhausted');
  await expect(page.locator('.hypothetical-dialog')).toBeVisible();await expect(page.locator('.hypothetical-dialog').getByRole('button',{name:'Save',exact:true})).toBeEnabled();
  const durable=await page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book;}finally{store.close();}});
  expect(durable).toEqual(before);await restore.evaluate(fn=>fn());
  await page.locator('.hypothetical-dialog').getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('.hypothetical-dialog')).toHaveCount(0);
  expect((await snapshot(page)).hypotheticalStyle?.rows.textOpacity).toBe(.55);
});
