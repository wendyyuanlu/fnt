import { expect,test,type Page } from '@playwright/test';
const cell=(page:Page,r:number,c:number)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`);
async function edit(page:Page,r:number,c:number,value:string){
  await cell(page,r,c).click();await page.locator('#formula').fill(value);await page.locator('#formula').press('Enter');
}
async function range(page:Page,value:string){
  await page.locator('.selection-count').click();await page.locator('#answer').fill(value);await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();
}
test('freeform cell shifts and cut moves keep dependent formulas, undo and durable reload intact',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await edit(page,0,1,'2');await edit(page,1,1,'3');await edit(page,2,1,'4');await edit(page,0,3,'=SUM(B1:B3)');
  await cell(page,1,1).click();await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
  await page.getByRole('button',{name:'Insert cells, shift down',exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(cell(page,2,1)).toHaveText('3');await expect(cell(page,0,3)).toHaveText('9');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,1)).toHaveText('3');
  await range(page,'B1:B3');await page.getByRole('button',{name:'Cut',exact:true}).click();await cell(page,2,5).click();await page.getByRole('button',{name:'Paste',exact:true}).click();
  await expect(cell(page,2,5)).toHaveText('2');await expect(cell(page,0,1)).toHaveText('');await expect(cell(page,0,3)).toHaveText('9');
  await cell(page,0,3).click();await expect(page.locator('#formula')).toHaveValue(/F3:F5/);
  await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await expect(cell(page,2,5)).toHaveText('2');await expect(cell(page,0,3)).toHaveText('9');
});
test('non-first selected columns retain natural positions and stick at the left edge without editing data',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await edit(page,0,2,'2025-06-01');await edit(page,1,2,'2025-06-02');await edit(page,0,3,'Test note');
  await page.locator('th[data-col="2"] .column-index').click();await page.locator('th[data-col="3"] .column-index').click({modifiers:['Shift']});
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollLeft=el.querySelector<HTMLElement>('th[data-col="2"]')!.offsetLeft-el.querySelector<HTMLElement>('.corner')!.offsetWidth;});
  const before=await cell(page,0,2).boundingBox(),order=await page.locator('.grid thead [data-col]').evaluateAll(elements=>elements.map(el=>el.getAttribute('data-col')));
  await page.getByRole('button',{name:'Pin selected columns',exact:true}).click();
  await expect(cell(page,0,2)).toHaveCSS('position','sticky');await expect(cell(page,0,3)).toHaveCSS('position','sticky');
  expect((await cell(page,0,2).boundingBox())!.x).toBeCloseTo(before!.x,0);
  expect(await page.locator('.grid thead [data-col]').evaluateAll(elements=>elements.map(el=>el.getAttribute('data-col')))).toEqual(order);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollLeft=700;});
  const after=await cell(page,0,2).boundingBox(),corner=await page.locator('.corner').boundingBox();
  expect(after!.x).toBeCloseTo(corner!.x+corner!.width,0);
  expect((await cell(page,0,3).boundingBox())!.x).toBeCloseTo(after!.x+after!.width,0);
  await cell(page,1,2).click();
  await expect(page.locator('.address')).toHaveText('C2');await expect(cell(page,1,2)).toHaveText('2025-06-02');
  await page.getByRole('button',{name:'Unpin columns',exact:true}).click();await expect(cell(page,1,2)).toHaveCSS('position','relative');
});
test('a visible frozen column moves naturally in view and clamps to the right only when offscreen',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const heading=page.locator('th[data-col="11"]'),target=cell(page,0,11),grid=page.locator('#grid-scroll');
  await grid.evaluate(el=>{const heading=el.querySelector<HTMLElement>('th[data-col="11"]')!;el.scrollLeft=heading.offsetLeft-el.clientWidth/2;});
  await heading.locator('.column-index').click();const before=(await target.boundingBox())!;
  await page.getByRole('button',{name:'Pin selected columns',exact:true}).click();
  expect((await target.boundingBox())!.x).toBeCloseTo(before.x,0);
  await grid.evaluate(el=>{el.scrollLeft+=20;});
  expect((await target.boundingBox())!.x).toBeCloseTo(before.x-20,0);
  await grid.evaluate(el=>{el.scrollLeft=0;});
  const right=await grid.evaluate(el=>el.getBoundingClientRect().left+el.clientLeft+el.clientWidth),clamped=(await target.boundingBox())!;
  expect(clamped.x+clamped.width).toBeCloseTo(right,0);
  expect((await heading.boundingBox())!.x).toBeCloseTo(clamped.x,0);
  await page.getByRole('button',{name:'Unpin columns',exact:true}).click();
  expect((await target.boundingBox())!.x).toBeGreaterThan(right);
});
test('mobile touch range mode selects cells by dragging without changing their contents',async({page,isMobile,context})=>{
  test.skip(!isMobile,'Desktop range selection is covered by Shift-selection.');
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('.selection-count').click();await page.getByRole('button',{name:'Drag to select cells',exact:true}).click();
  const a=await cell(page,1,0).boundingBox(),b=await cell(page,3,1).boundingBox(),cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a!.x+a!.width/2,y:a!.y+a!.height/2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b!.x+b!.width/2,y:b!.y+b!.height/2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.selection-count')).toHaveText('6 cells');await expect(page.locator('.grid')).not.toHaveClass(/touch-select/);
  await expect(cell(page,1,0)).toHaveText('');await expect(cell(page,3,1)).toHaveText('');
});
test('corner drag-fill increments a text seed and remains a single undoable operation',async({page,isMobile,context})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();await edit(page,1,0,'Raisin 1');
  const handle=await page.getByRole('button',{name:'Drag to fill',exact:true}).boundingBox(),target=await cell(page,3,0).boundingBox();
  if(isMobile){
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:handle!.x+handle!.width/2,y:handle!.y+handle!.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:target!.x+target!.width/2,y:target!.y+target!.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }else{
    await page.mouse.move(handle!.x+handle!.width/2,handle!.y+handle!.height/2);await page.mouse.down();await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2);await page.mouse.up();
  }
  await expect(cell(page,2,0)).toHaveText('Raisin 2');await expect(cell(page,3,0)).toHaveText('Raisin 3');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,2,0)).toHaveText('Freeform cells, independent tables, and your own formulas.');await expect(cell(page,3,0)).toHaveText('');
});
