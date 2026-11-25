import {expect,test} from '@playwright/test';

for(const axis of ['row','column'] as const)test(`Add to group joins both preceding ${axis} group types, inherits Hypo, and survives Undo and reload`,async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const fixture=await page.evaluate(async axis=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage'),{uid}=await load('model'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets.find((s:{name:string})=>s.name==='Notebook')!;
      while(sheet.rows.length<8)sheet.rows.push({id:uid()});
      const items=axis==='row'?sheet.rows:sheet.columns,ids=items.map((item:{id:string})=>item.id);
      sheet.groups=[{id:'join-summary',axis,kind:'summary',members:ids.slice(1,4),collapsed:false,label:'Invented summary'},{id:'join-plain',axis,kind:'range',members:ids.slice(1,4),collapsed:false,label:'Invented plain'}];
      items[1].hypothetical=true;items[4].hypothetical=false;
      state.book.toolbarOrder=['action:hypothetical','action:pin'];
      await store.save(state.book,state.version,'Synthetic adjacent group test');
      return{sheet:sheet.id,ids,cells:sheet.cells};
    }finally{store.close();}
  },axis);
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const add=page.getByRole('button',{name:'Add to group',exact:true});
  expect(await add.evaluate(el=>el.nextElementSibling?.getAttribute('data-action'))).toBe('hypothetical');
  const hypo=page.locator('[data-action="hypothetical"]');
  expect(await add.evaluate(el=>[getComputedStyle(el).width,getComputedStyle(el).height])).toEqual(await hypo.evaluate(el=>[getComputedStyle(el).width,getComputedStyle(el).height]));
  await expect(add.locator('svg')).toHaveAttribute('stroke-width','1');
  const header=axis==='row'?page.locator('[data-row-select="4"] .row-index'):page.locator('th[data-col="4"] .column-index');
  await header.click();await add.click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const read=()=>page.evaluate(async({sheet,axis})=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage'),{hypotheticalMembers}=await load('grouping'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets.find((s:{id:string})=>s.id===sheet)!;return{groups:s.groups,cells:s.cells,tagged:[...hypotheticalMembers(s,axis)]};}finally{store.close();}
  },{sheet:fixture.sheet,axis});
  let saved=await read();expect(saved.groups.every((g:{members:string[]})=>g.members.includes(fixture.ids[4]))).toBe(true);
  expect(saved.tagged).toContain(fixture.ids[4]);expect(saved.cells).toEqual(fixture.cells);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  saved=await read();expect(saved.groups.every((g:{members:string[]})=>!g.members.includes(fixture.ids[4]))).toBe(true);expect(saved.tagged).not.toContain(fixture.ids[4]);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();saved=await read();expect(saved.tagged).toContain(fixture.ids[4]);expect(saved.cells).toEqual(fixture.cells);
  expect(await add.evaluate(el=>el.nextElementSibling?.getAttribute('data-action'))).toBe('hypothetical');
});
