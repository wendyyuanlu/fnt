import {expect,test} from '@playwright/test';

test('date pages are chronological with compact navigation, in-page Top/Bottom and calendar jumps without changing records',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const fixture=await page.evaluate(async()=>{
    const load=(name:string)=>import(/* @vite-ignore */'/src/'+name+'.ts'),{Store}=await load('storage'),{uid,key}=await load('model'),{excelDate,excelDateText,displayExcelDate}=await load('dates'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets.find((s:{name:string})=>s.name==='Notebook')!,latest=excelDate(2026,11,25);
      while(s.rows.length<602)s.rows.push({id:uid()});
      const table={id:uid(),name:'Master',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,601).map((r:{id:string})=>r.id),columns:['Date','isDay','Entry'].map((name,i)=>({id:uid(),name,column:s.columns[i].id}))};
      state.book.tables.push(table);
      table.columns.forEach((c:{name:string;column:string})=>s.cells[key(table.header,c.column)]={value:c.name});
      for(let i=0;i<200;i++){
        const r=i*3+1,offset=199-i;
        s.cells[key(s.rows[r].id,s.columns[0].id)]={value:latest-offset,format:{number:'date'}};
        s.cells[key(s.rows[r].id,s.columns[1].id)]={value:true};
        s.cells[key(s.rows[r].id,s.columns[2].id)]={value:'Day '+offset};
        for(let j=1;j<=2;j++){s.cells[key(s.rows[r+j].id,s.columns[2].id)]={value:'Detail '+offset+'.'+j};s.cells[key(s.rows[r+j].id,s.columns[0].id)]={formula:{kind:'ref',sheet:s.id,row:s.rows[r].id,column:s.columns[0].id,absRow:false,absCol:false},format:{number:'date'}};}
        s.groups.push({id:uid(),axis:'row',kind:'summary',members:s.rows.slice(r,r+3).map((r:{id:string})=>r.id),collapsed:false});
      }
      await store.save(state.book,state.version,'Synthetic calendar pagination');
      return{book:state.book.id,sheet:s.id,cells:s.cells,rows:s.rows,groups:s.groups,table,date:excelDateText(latest-199),range:displayExcelDate(latest-89)+'–'+displayExcelDate(latest)};
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const range=page.locator('[data-action="date-range"]'),grid=page.locator('#grid-scroll'),cell=(r:number)=>page.locator(`td[data-r="${r}"][data-c="2"]`);
  await expect(range).toHaveText(fixture.range);
  const footerHeight=(await page.locator('.grid-footer').boundingBox())!.height;
  await expect(cell(600)).toHaveText('Detail 0.2');
  const expectLanding=async(end:number)=>{
    await expect(page.locator(`tr[data-row="${end}"]`)).toBeVisible();
    const visible=await grid.evaluate((el,end)=>{
      const box=el.getBoundingClientRect(),bottom=box.top+el.clientTop+el.clientHeight;
      return [...el.querySelectorAll<HTMLElement>('tr[data-row]')].filter(row=>Number(row.dataset.row)>end&&row.getBoundingClientRect().top>=box.top&&row.getBoundingClientRect().bottom<=bottom+.5).map(row=>Number(row.dataset.row));
    },end);
    expect(visible).toEqual([601,602]);
  };
  await expectLanding(600);
  await page.locator('[data-row-select="600"]').hover();await page.locator('[data-move-row="600"]').click();
  await page.locator('[data-row-select="598"]').hover();await page.locator('[data-insert-row="599"]').first().click();
  await expect(cell(599)).toHaveText('Detail 0.2');await expect(cell(600)).toHaveText('Detail 0.1');
  await expect(range).toHaveText(fixture.range);await expect(page.locator('#error')).toBeHidden();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(600)).toHaveText('Detail 0.2');
  await page.locator('[data-row-select="598"] .row-index').click();await page.getByRole('button',{name:'Move to top',exact:true}).click();
  await expect(cell(1)).toHaveText('Day 0');await expect(range).toHaveText(fixture.range);await expect(page.locator('#error')).toBeHidden();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.locator('[data-action="bottom"]').click();await expect(cell(598)).toHaveText('Day 0');
  await page.locator('[data-row-select="600"] .row-index').click();await page.getByRole('button',{name:'Cut',exact:true}).click();
  await page.locator('[data-row-select="599"] .row-index').click();await page.getByRole('button',{name:'Paste',exact:true}).click();
  await expect(cell(599)).toHaveText('Detail 0.2');await expect(page.locator('#error')).toBeHidden();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(600)).toHaveText('Detail 0.2');
  await expect(page.locator('#row-jump')).toHaveCount(0);await expect(page.locator('.navigator [data-action="page-settings"]')).toHaveCount(0);
  await expect(page.locator('#quantity-diagnostic')).toHaveCount(0);await expect(page.getByRole('button',{name:'Oldest',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-action="quick-add"],[data-action="browse"]')).toHaveCount(0);
  for(const icon of await page.locator('.navigator .navigation-icon').all()){await expect(icon).toHaveCSS('width','14px');await expect(icon).toHaveCSS('height','14px');await expect(icon).toHaveAttribute('stroke-width','1');}
  for(const action of ['newest-date-page','prev','next']){const button=page.locator(`.navigator [data-action="${action}"]`);await expect(button).toHaveCSS('width','22px');await expect(button).toHaveCSS('height','22px');await expect(button).toHaveCSS('border-radius','0px');}
  await expect(page.locator('.navigator-divider')).toHaveCount(0);await expect(page.locator('[data-action="page-mode"] .date-pages-icon')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Notebook',exact:true})).toHaveCSS('border-radius','10px');
  await expect(page.getByRole('button',{name:'Ingredients',exact:true})).toHaveCSS('border-radius','7px');
  expect(await page.locator('.navigator').innerText()).not.toContain('Page 1');
  await page.locator('[data-action="bottom"]').click();await expect(cell(600)).toHaveText('Detail 0.2');
  expect(await grid.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await expect(range).toHaveText(fixture.range);
  await page.locator('[data-action="top"]').click();await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(0);
  await expect(cell(331)).toHaveText('Day 89');
  await expect(range).toHaveText(fixture.range);
  await page.locator('[data-action="next"]').click();await expect(cell(61)).toHaveText('Day 179');
  await page.locator('[data-action="bottom"]').click();await expect(cell(330)).toHaveText('Detail 90.2');
  await expectLanding(330);
  await page.locator('[data-action="top"]').click();await expect(cell(61)).toHaveText('Day 179');
  await range.click();await expect(page.getByRole('group',{name:'Date page picker',exact:true})).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('#date-page-jump').fill(fixture.date!);
  await expect(cell(1)).toHaveText('Day 199');await expect(page.locator('[data-action="next"]')).toBeDisabled();
  await page.locator('[data-action="newest-date-page"]').click();await expect(range).toHaveText(fixture.range);await expectLanding(600);
  await page.locator('[data-action="top"]').click();await page.locator('[data-action="newest-date-page"]').click();await expectLanding(600);
  await page.locator('[data-action="page-mode"]').click();await expect(page.locator('#page-display')).toHaveValue('calendar');
  await expect(range).toHaveText(fixture.range);
  await page.locator('#page-days').fill('30');await page.getByRole('button',{name:'Apply page settings',exact:true}).click();
  await page.locator('[data-action="top"]').click();
  await expect(cell(511)).toHaveText('Day 29');
  await page.locator('[data-action="undo"]').click();await page.locator('[data-action="top"]').click();await expect(cell(331)).toHaveText('Day 89');
  await page.locator('[data-action="redo"]').click();await page.locator('[data-action="top"]').click();await expect(cell(511)).toHaveText('Day 29');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const saved=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{const state=(await store.load())!;return{sheet:state.book.sheets.find((s:{name:string})=>s.name==='Notebook'),table:state.book.tables.find((t:{name:string})=>t.name==='Master')};}finally{store.close();}
  });
  expect(saved.sheet.cells).toEqual(fixture.cells);expect(saved.sheet.rows.slice(0,fixture.rows.length)).toEqual(fixture.rows);expect(saved.sheet.rows).toHaveLength(621);expect(saved.sheet.rows.slice(601).every((row:object)=>Object.keys(row).length===1)).toBe(true);expect(saved.sheet.groups).toEqual(fixture.groups);expect(saved.table).toEqual(fixture.table);
  expect(saved.sheet.pagination.days).toBe(30);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await expect(page.getByRole('button',{name:'Notebook',exact:true})).toHaveClass(/current/);await expect(cell(511)).toHaveText('Day 29');
  await page.locator('[data-action="page-mode"]').click();await page.locator('#page-display').selectOption('one');await page.getByRole('button',{name:'Apply page settings',exact:true}).click();await expect(page.locator('#row-jump')).toBeVisible();await expect(range).toHaveCount(0);
  await expect(page.locator('[data-action="page-mode"] .one-page-icon')).toHaveCount(1);await expect(page.locator('[data-action="page-mode"] .date-pages-icon')).toHaveCount(0);
  expect(await page.locator('.navigator [data-action="top"]').evaluate(el=>el.nextElementSibling?.getAttribute('data-action'))).toBe('bottom');
  expect((await page.locator('.grid-footer').boundingBox())!.height).toBe(footerHeight);
  await expect(page.locator('#row-jump')).toHaveCSS('height','22px');await expect(page.locator('#row-jump')).toHaveCSS('font-size','10px');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();await expect(page.locator('#row-jump')).toBeVisible();
  await page.locator('[data-action="bottom"]').click();await expectLanding(600);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await page.getByRole('button',{name:'Notebook',exact:true}).click();await expectLanding(600);
  await page.reload();await expectLanding(600);
  await grid.evaluate(el=>{el.scrollTop-=150;});
  await expect.poll(()=>page.evaluate(({book,sheet})=>JSON.parse(sessionStorage.getItem(`fnt-sheet-view:${book}:${sheet}`)!).atBottom,fixture)).toBe(false);
  const up=await grid.evaluate(el=>el.scrollTop);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await page.getByRole('button',{name:'Notebook',exact:true}).click();await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(up);
  await page.reload();await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(up);
  await page.locator('[data-action="top"]').click();await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(0);
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await page.getByRole('button',{name:'Notebook',exact:true}).click();await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(0);
  await page.reload();await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(0);
  await page.locator('[data-action="page-mode"]').click();await page.locator('#page-display').selectOption('calendar');await page.getByRole('button',{name:'Apply page settings',exact:true}).click();
  await page.locator('[data-action="next"]').click();await page.locator('[data-action="top"]').click();const olderRange=await range.innerText();
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await page.getByRole('button',{name:'Notebook',exact:true}).click();await expect(range).toHaveText(olderRange);await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(0);
  await page.reload();await expect(range).toHaveText(olderRange);await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(0);
});
test('fresh sheets start unlocked while explicit per-sheet locks and selected tabs survive navigation and reload',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const toggle=page.getByRole('button',{name:'Table-constrained header selection',exact:true});
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  const first=(await page.locator('.sheet-tab.current').innerText()).trim();
  await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await expect(toggle).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:first,exact:true}).click();await expect(toggle).toHaveAttribute('aria-pressed','true');
  await page.reload();await expect(toggle).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Notebook',exact:true}).click();await expect(toggle).toHaveAttribute('aria-pressed','false');
  await page.reload();await expect(page.getByRole('button',{name:'Notebook',exact:true})).toHaveClass(/current/);await expect(toggle).toHaveAttribute('aria-pressed','false');
});
