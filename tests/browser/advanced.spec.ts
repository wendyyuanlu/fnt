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
test('non-first selected columns stay pinned and value/date browsing navigates without editing data',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await edit(page,0,2,'2025-06-01');await edit(page,1,2,'2025-06-02');await edit(page,0,3,'Test note');
  await page.locator('th[data-col="2"]').click();await page.locator('th[data-col="3"]').click({modifiers:['Shift']});
  await page.getByRole('button',{name:'Pin selected columns',exact:true}).click();
  await expect(cell(page,0,2)).toHaveCSS('position','sticky');await expect(cell(page,0,3)).toHaveCSS('position','sticky');
  const before=await cell(page,0,2).boundingBox();await page.locator('#grid-scroll').evaluate(el=>{el.scrollLeft=500;});
  const after=await cell(page,0,2).boundingBox();expect(Math.abs(after!.x-before!.x)).toBeLessThan(2);
  await page.getByRole('button',{name:'Browse values',exact:true}).click();await page.locator('#browse-column').selectOption('2');
  await expect(page.locator('#browse-preview')).toContainText('2025-06-01');
  await page.locator('#browse-position').focus();await page.locator('#browse-position').press('ArrowRight');
  await expect(page.locator('#browse-preview')).toContainText('2025-06-02');await page.getByRole('button',{name:'Go to row',exact:true}).click();
  await expect(page.locator('.address')).toHaveText('C2');await expect(cell(page,1,2)).toHaveText('2025-06-02');
  await page.getByRole('button',{name:'Unpin columns',exact:true}).click();await expect(cell(page,1,2)).toHaveCSS('position','relative');
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
