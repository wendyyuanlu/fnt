import {expect,test} from '@playwright/test';

test('Master-only logging controls preserve settings drafts, create real and undated days, and undo chronological date corrections',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const fixture=await page.evaluate(async()=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage'),{uid,setInput}=await load('model'),{masterLogging}=await load('day-logging'),{excelDate,excelDateText}=await load('dates'),{defaultHeaderFormula}=await load('meal-block'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets.find((s:{name:string})=>s.name==='Notebook')!;
      while(s.rows.length<9)s.rows.push({id:uid()});
      const table={id:uid(),name:'Master',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,7).map((row:{id:string})=>row.id),columns:['Date','isDay','Weight','Food','Calories','Notes'].map((name,i)=>({id:uid(),name,column:s.columns[i].id,formulaDefault:i===4?'=IF([@Food]="",0,5)':undefined}))};
      state.book.tables.push(table);const input=(r:number,c:number,value:string)=>setInput(state.book,s,s.rows[r].id,s.columns[c].id,value);
      table.columns.forEach((field:{name:string},i:number)=>input(0,i,field.name));
      for(let r=1;r<=6;r++)input(r,1,'=[@Weight]<>""');
      input(1,2,'x');input(4,2,'(Tues)');input(1,0,'=DATE(2026,11,20)');
      for(const [r,formula]of [[2,'=A2'],[3,'=A3'],[4,'=A4+1'],[5,'=A5'],[6,'=A6']] as const)input(r,0,formula);
      for(const r of [1,4]){input(r,4,defaultHeaderFormula(state.book,table,table.columns[4].id));s.groups.push({id:uid(),axis:'row',kind:'summary',members:s.rows.slice(r,r+3).map((row:{id:string})=>row.id),collapsed:false,label:'Invented day'});}
      for(const r of [2,3,5,6]){input(r,3,'Invented food '+r);input(r,4,String(r*10));}
      input(2,5,'Keep this invented note');
      s.dayLogging={...masterLogging(state.book,s).config,nextDate:excelDate(2026,11,22)};
      await store.save(state.book,state.version,'Synthetic day logging');
      return{sheet:s.id,table:table.id,cursor:excelDateText(s.dayLogging.nextDate)};
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const controls=page.getByRole('navigation',{name:'Master logging',exact:true});
  await expect(controls).toBeVisible();expect(await controls.locator('#new-day,#add-food,#date-settings').allTextContents()).toEqual(['New day','Food','New day settings']);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await expect(controls).toHaveCount(0);
  await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('#date-settings').click();await expect(page.locator('#logging-date')).toHaveValue(fixture.cursor!);
  await page.locator('#logging-direction').selectOption('backward');await page.locator('#logging-reset').check();
  const today=await page.evaluate(()=>{const now=new Date();return`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;});
  await expect(page.locator('#logging-date')).toHaveValue(today);await expect(page.locator('#logging-direction')).toHaveValue('backward');
  expect(await page.locator('#logging-date').evaluate(el=>el.parentElement?.nextElementSibling?.querySelector('input')?.id)).toBe('logging-reset');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('#date-settings').click();await expect(page.locator('#logging-date')).toHaveValue(fixture.cursor!);await expect(page.locator('#logging-reset')).not.toBeChecked();
  await page.locator('#logging-date').fill('2026-11-19');await page.locator('#logging-direction').selectOption('backward');
  await page.getByRole('button',{name:'Apply settings',exact:true}).click();await page.locator('#new-day').click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const read=()=>page.evaluate(async({sheet})=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage'),{masterDayBlocks,masterLogging}=await load('day-logging'),{Engine,scalar}=await load('formula'),{excelDateText}=await load('dates'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets.find((s:{id:string})=>s.id===sheet)!,context=masterLogging(state.book,s),engine=new Engine(state.book);
      return{cursor:excelDateText(s.dayLogging.nextDate),direction:s.dayLogging.direction,blocks:masterDayBlocks(state.book,s).map((block:{header:string;rows:string[];date:number})=>({...block,index:s.rows.findIndex((row:{id:string})=>row.id===block.header),date:excelDateText(block.date),label:scalar(engine.cell(s.id,block.header,context.label.column)),total:scalar(engine.cell(s.id,block.header,context.table.columns[4].column))})),groups:s.groups};
    }finally{store.close();}
  },fixture);
  let saved=await read();expect(saved.cursor).toBe('2026-11-18');expect(saved.direction).toBe('backward');expect(saved.blocks[0].date).toBe('2026-11-19');expect(saved.blocks[0].total).toBe(0);
  const real=saved.blocks[0].header;
  await page.locator('.day-create summary').click();await page.getByRole('button',{name:'New hypothetical day',exact:true}).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.locator('#save-state')).toContainText(/^Saved/);
  saved=await read();expect(saved.cursor).toBe('2026-11-18');const hypothetical=saved.blocks.at(-1)!;expect(hypothetical.date).toBeUndefined();expect(hypothetical.label).toBe('Hypothetical');
  await page.locator('#add-food').click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  saved=await read();expect(saved.cursor).toBe('2026-11-18');expect(saved.blocks.at(-1)!.rows).toHaveLength(3);
  await page.locator('[data-action="newest-date-page"]').click();await page.locator('[data-action="top"]').click();
  const realBlock=saved.blocks.find((block:{header:string})=>block.header===real)!;
  await page.locator(`td[data-r="${realBlock.index}"][data-c="0"]`).click();await page.locator('#formula').fill('2026-11-24');await page.locator('#formula').press('Enter');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);saved=await read();
  expect(saved.blocks.at(-2)!.header).toBe(real);expect(saved.blocks.at(-2)!.date).toBe('2026-11-24');expect(saved.blocks.at(-1)!.header).toBe(hypothetical.header);expect(saved.cursor).toBe('2026-11-18');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  saved=await read();expect(saved.blocks[0].header).toBe(real);expect(saved.blocks[0].date).toBe('2026-11-19');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();saved=await read();expect(saved.blocks.at(-2)!.date).toBe('2026-11-24');expect(saved.cursor).toBe('2026-11-18');
  await page.locator('[data-action="newest-date-page"]').click();await page.locator('[data-action="top"]').click();
  const source=saved.blocks[0],target=saved.blocks.find((block:{header:string})=>block.header===real)!;
  await page.locator(`td[data-r="${source.index}"][data-c="0"]`).click();
  await page.getByRole('button',{name:'Copy',exact:true}).click();
  await page.locator(`td[data-r="${target.index}"][data-c="0"]`).click();
  await page.getByRole('button',{name:'Paste',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  saved=await read();const pasted=saved.blocks.find((block:{header:string})=>block.header===real)!;
  expect(pasted.date).toBe(source.date);expect(saved.cursor).toBe('2026-11-18');
  await expect(page.locator(`td[data-r="${pasted.index}"][data-c="0"]`)).toHaveClass(/selected/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  saved=await read();expect(saved.blocks.find((block:{header:string})=>block.header===real)!.date).toBe('2026-11-24');
  await expect(page.locator('#error')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
