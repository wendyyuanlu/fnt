import { expect,test,type Page } from '@playwright/test';

async function openLongSheet(page:Page){
  await page.goto('/');
  const backup=await page.evaluate(async()=>{
    const path='/src/model.ts',{blankSheet,key,uid}=await import(/* @vite-ignore */path),s=blankSheet('Continuous rows',5000,20);
    for(let i=0;i<5000;i++)s.cells[key(s.rows[i].id,s.columns[0].id)]={value:'Row '+(i+1)};
    s.rows[70].height=72;s.rows[100].hidden=true;
    s.groups.push({id:uid(),axis:'row',members:s.rows.slice(200,221).map((r:{id:string})=>r.id),collapsed:true,label:'Hidden details'});
    const book={schema:1,id:uid(),title:'Invented continuous sheet',revision:0,sheets:[s],tables:[],names:[],pickerSources:{}};
    return JSON.stringify({format:'fnt-backup',version:1,state:{book,version:1,pending:[],updated:'now'},originals:[]});
  });
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  await page.locator('#restore').setInputFiles({name:'invented.fnt.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('one continuous large sheet crosses row 60, respects groups/heights and preserves drafts and bindings while virtualized',async({page})=>{
  await openLongSheet(page);
  const scroller=page.locator('#grid-scroll'),cell=(r:number,c=0)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`);
  const version=()=>page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();try{return(await store.load()).version;}finally{store.close();}});
  const before=await version();
  expect(await scroller.evaluate(el=>el.scrollHeight)).toBeGreaterThan(150000);
  await scroller.evaluate(el=>{el.scrollTop=1800;});
  await expect(cell(59)).toHaveText('Row 60');await expect(cell(60)).toHaveText('Row 61');
  await expect(cell(70)).toHaveText('Row 71');expect((await cell(70).boundingBox())!.height).toBeGreaterThanOrEqual(95);
  expect(await page.locator('tbody tr[data-row]').count()).toBeLessThan(100);
  await scroller.evaluate(el=>{el.scrollTop=33*94;});await expect(cell(99)).toHaveCount(1);await expect(cell(100)).toHaveCount(0);await expect(cell(101)).toHaveCount(1);
  await scroller.evaluate(el=>{el.scrollTop=33*195;});await expect(cell(199)).toHaveCount(1);await expect(cell(200)).toHaveCount(0);await expect(cell(220)).toHaveCount(0);await expect(cell(221)).toHaveCount(1);
  expect(await version()).toBe(before);
  await page.locator('#row-jump').fill('4001');await page.locator('#row-jump').press('Enter');
  await expect(cell(4000)).toHaveText('Row 4001');await cell(4000,2).click();await page.locator('#formula').fill('123');await page.locator('#formula').press('Enter');
  await expect(page.locator('#save-state')).toContainText('Saved');
  const durable=await version(),position=await scroller.evaluate(el=>el.scrollTop);
  await cell(4000,2).click();await page.keyboard.type('456');
  await expect(page.getByRole('textbox',{name:'Edit selected cell',exact:true})).toHaveValue('456');
  await scroller.evaluate(el=>{el.scrollTop=0;});
  await expect(cell(0)).toHaveText('Row 1');await expect(page.locator('#formula')).toHaveValue('456');
  await expect(page.locator('#save-state')).toContainText('not saved yet');expect(await version()).toBe(durable);
  await scroller.evaluate((el,top)=>{el.scrollTop=top;},position);
  await expect(cell(4000)).toHaveText('Row 4001');await expect(page.getByRole('textbox',{name:'Edit selected cell',exact:true})).toHaveValue('456');
  await page.locator('#formula').press('Enter');await expect(cell(4000,2)).toHaveText('456');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(4000,2)).toHaveText('123');
  await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();
  await page.locator('#row-jump').fill('4001');await page.locator('#row-jump').press('Enter');await expect(cell(4000,2)).toHaveText('123');
});
test('hiding a selected hypo row preserves the nearby viewport through hide and show',async({page})=>{
  await openLongSheet(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{const state=await store.load(),s=state.book.sheets[0];for(const row of [...s.rows.slice(0,20),s.rows[4000]])row.hypothetical=true;await store.save(state.book,state.version,'Disposable hypo viewport fixture');}finally{store.close();}
  });
  await page.reload();
  await page.locator('#row-jump').fill('4001');await page.locator('#row-jump').press('Enter');
  const scroller=page.locator('#grid-scroll');
  const topRow=()=>scroller.evaluate(el=>{
    const top=el.getBoundingClientRect().top+el.querySelector('thead')!.getBoundingClientRect().height;
    return [...el.querySelectorAll<HTMLElement>('tr[data-row]')].find(row=>row.getBoundingClientRect().bottom>top)?.dataset.row;
  });
  await expect.poll(topRow).toBe('4000');
  await page.locator('[data-action="hypothetical-visibility"]').click();
  await expect.poll(topRow).toBe('4001');
  expect(await scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(100000);
  await expect(page.locator('td.active')).toBeVisible();
  await page.locator('[data-action="hypothetical-visibility"]').click();
  await expect.poll(topRow).toBe('4001');
});
test('a stationary row drag scrolls beyond the original virtual window in both directions and drops with Undo',async({page,isMobile})=>{
  test.skip(isMobile,'Native HTML dragging is desktop-only; mobile retains tap-then-destination moves.');
  await openLongSheet(page);const grid=page.locator('#grid-scroll');await grid.evaluate(el=>{el.scrollTop=33*300;});
  const read=()=>page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{return(await store.load()).book.sheets[0];}finally{store.close();}
  });
  const before=await read(),source=before.rows[310].id;
  await page.locator('[data-row-select="310"] .row-index').click();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const sourceHandle=page.locator('[data-move-row="310"]');await expect(sourceHandle).toBeVisible();
  const handle=await sourceHandle.evaluate(el=>el.getBoundingClientRect().toJSON()),bounds=(await grid.boundingBox())!,start=await grid.evaluate(el=>el.scrollTop);
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+12,handle.y+handle.height/2+4,{steps:4});
  await page.mouse.move(bounds.x+90,bounds.y+bounds.height-6,{steps:5});
  await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBeGreaterThan(start+500);
  const down=await grid.evaluate(el=>el.scrollTop);
  await page.mouse.move(bounds.x+90,bounds.y+6,{steps:5});
  await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBeLessThan(down-350);
  await page.mouse.move(bounds.x+90,bounds.y+bounds.height/2,{steps:5});await page.mouse.up();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await expect.poll(async()=>(await read()).rows.findIndex((row:{id:string})=>row.id===source)).not.toBe(310);
  expect((await read()).cells).toEqual(before.cells);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await read()).rows).toEqual(before.rows);expect((await read()).cells).toEqual(before.cells);
});
test('column dragging auto-scrolls left and right and pauses away from edges',async({page,isMobile})=>{
  test.skip(isMobile,'Native HTML dragging is desktop-only.');
  await openLongSheet(page);const grid=page.locator('#grid-scroll');await grid.evaluate(el=>{el.scrollLeft=200;});
  await page.locator('th[data-col="3"] .column-index').click();
  const handle=(await page.locator('[data-move-column="3"]').boundingBox())!,bounds=(await grid.boundingBox())!,start=await grid.evaluate(el=>el.scrollLeft);
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+12,handle.y+handle.height/2+4,{steps:4});
  await page.mouse.move(bounds.x+bounds.width-6,bounds.y+15,{steps:5});
  await expect.poll(()=>grid.evaluate(el=>el.scrollLeft)).toBeGreaterThan(start+400);
  const right=await grid.evaluate(el=>el.scrollLeft);
  await page.mouse.move(bounds.x+6,bounds.y+15,{steps:5});
  await expect.poll(()=>grid.evaluate(el=>el.scrollLeft)).toBeLessThan(right-300);
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+15,{steps:5});await page.waitForTimeout(100);
  const paused=await grid.evaluate(el=>el.scrollLeft);await page.waitForTimeout(150);expect(await grid.evaluate(el=>el.scrollLeft)).toBe(paused);
  await page.mouse.move(bounds.x+bounds.width-6,bounds.y+15,{steps:5});
  await expect.poll(()=>grid.evaluate(el=>el.scrollLeft)).toBeGreaterThan(paused+100);
  await page.keyboard.press('Escape');await page.mouse.up();
});
test('application edge scrolling continues without repeated dragover events and cancels on both axes',async({page})=>{
  await openLongSheet(page);const grid=page.locator('#grid-scroll');
  await page.evaluate(()=>document.fonts.ready);
  for(const axis of ['row','column'] as const){
    await grid.evaluate(el=>{el.scrollTop=33*300;el.scrollLeft=0;});await page.waitForTimeout(100);
    await page.locator(axis==='row'?'[data-row-select="310"] .row-index':'th[data-col="3"] .column-index').click();
    const start=await grid.evaluate((el,axis)=>axis==='row'?el.scrollTop:el.scrollLeft,axis);
    await page.evaluate(axis=>{
      const grid=document.querySelector<HTMLElement>('#grid-scroll')!,source=document.querySelector<HTMLElement>(axis==='row'?'[data-move-row="310"]':'[data-move-column="3"]')!;
      const transfer=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      const bounds=grid.getBoundingClientRect();grid.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:axis==='row'?bounds.left+90:bounds.right-6,clientY:axis==='row'?bounds.bottom-6:bounds.top+15}));
      grid.addEventListener('dragend',()=>source.dispatchEvent(new DragEvent('dragend')),{once:true});
    },axis);
    await expect.poll(()=>grid.evaluate((el,axis)=>axis==='row'?el.scrollTop:el.scrollLeft,axis)).toBeGreaterThan(start+150);
    await page.keyboard.press('Escape');await grid.dispatchEvent('dragend');await page.waitForTimeout(50);
    const stopped=await grid.evaluate((el,axis)=>axis==='row'?el.scrollTop:el.scrollLeft,axis);
    await page.waitForTimeout(150);expect(await grid.evaluate((el,axis)=>axis==='row'?el.scrollTop:el.scrollLeft,axis)).toBe(stopped);
    await expect(page.locator('.grid.rearranging')).toHaveCount(0);
  }
});
test('column drag/tap moves, pinning and undo retain the actual mid-sheet viewport rather than revealing the selection end',async({page,isMobile})=>{
  await openLongSheet(page);const scroller=page.locator('#grid-scroll');
  const position=()=>scroller.evaluate(el=>{
    const top=el.getBoundingClientRect().top+el.querySelector('thead')!.getBoundingClientRect().height;
    const row=Array.from(el.querySelectorAll<HTMLElement>('tr[data-row]')).find(r=>r.getBoundingClientRect().bottom>top);
    return{top:el.scrollTop,left:el.scrollLeft,row:row?.dataset.row,offset:row?row.getBoundingClientRect().top-top:0};
  });
  const stable=async(before:Awaited<ReturnType<typeof position>>)=>{
    await expect.poll(async()=>Math.abs((await position()).top-before.top)).toBeLessThan(2);
    const after=await position();expect(after.row).toBe(before.row);expect(Math.abs(after.left-before.left)).toBeLessThan(2);expect(Math.abs(after.offset-before.offset)).toBeLessThan(2);
  };
  const tap=async(selector:string)=>{
    const box=(await page.locator(selector).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if(isMobile)await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
    else await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  };
  await scroller.evaluate(el=>{el.scrollTop=50000;el.scrollLeft=400;});
  await expect.poll(async()=>Number(await page.locator('#row-jump').inputValue())).toBeGreaterThan(1400);
  if(!isMobile){
    await page.locator('th[data-col="3"] .column-index').click();await page.locator('th[data-col="4"] .column-index').click({modifiers:['Shift']});
    const before=await position();
    await scroller.evaluate(el=>el.addEventListener('drop',()=>{document.body.dataset.dropTop=String(el.scrollTop);document.body.dataset.dropLeft=String(el.scrollLeft);},{capture:true}));
    await page.locator('[data-move-column="3"]').dragTo(page.locator('th[data-col="7"]'),{targetPosition:{x:130,y:14}});
    const chosen=await page.evaluate(()=>({top:Number(document.body.dataset.dropTop),left:Number(document.body.dataset.dropLeft)}));
    // Drop reads the latest user/autoscrolled viewport, not a drag-start snapshot.
    await stable({...before,...chosen});await page.getByRole('button',{name:'Undo',exact:true}).click();await stable({...before,...chosen});
  }
  await scroller.evaluate(el=>{el.scrollLeft=0;});
  await page.locator('th[data-col="0"] .column-index').click();await page.locator('th[data-col="1"] .column-index').click({modifiers:['Shift']});
  await page.getByRole('button',{name:'Pin selected columns',exact:true}).click();
  await scroller.evaluate(el=>{el.scrollLeft=440;});const pinned=await position();
  await tap('[data-move-column="0"]');await stable(pinned);
  await tap('[data-insert-column="5"]');await stable(pinned);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await stable(pinned);
  await page.locator(`td[data-r="${Number(pinned.row)+1}"][data-c="0"]`).click();
  const single=await position();await tap('[data-move-column="0"]');await stable(single);
  await tap('[data-insert-column="5"]');await stable(single);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await stable(single);
});
