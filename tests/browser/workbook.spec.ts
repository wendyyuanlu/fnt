import { expect, test, type Page } from '@playwright/test';

const cell=(page:Page,r:number,c:number)=>page.locator(`td[data-r="${r}"][data-c="${c}"]`);
async function edit(page:Page,r:number,c:number,value:string){
  await cell(page,r,c).click();
  if(await page.locator('#cell-date').isVisible())await page.getByRole('button',{name:'Close date picker',exact:true}).click();
  await page.getByRole('textbox',{name:'Cell value or formula',exact:true}).fill(value);await page.locator('#formula').press('Enter');
}
test('global scrollbars share four-pixel black thumbs while cell scrollbars remain hidden',async({page})=>{
  await page.goto('/');await expect(cell(page,1,0)).toBeVisible();
  const styles=await page.evaluate(()=>{
    const generic=document.createElement('div'),find=document.createElement('div'),tabs=document.createElement('div');
    generic.style.cssText='width:80px;height:80px;overflow:auto';generic.innerHTML='<div style="width:200px;height:200px"></div>';
    find.className='find-results-scroll';tabs.className='dropdown-source-tabs';tabs.innerHTML='<div role="tablist"></div>';document.body.append(generic,find,tabs);
    const appearance=(el:Element)=>({nativeWidth:getComputedStyle(el).scrollbarWidth,width:getComputedStyle(el,'::-webkit-scrollbar').width,height:getComputedStyle(el,'::-webkit-scrollbar').height,thumb:getComputedStyle(el,'::-webkit-scrollbar-thumb').backgroundColor,display:getComputedStyle(el,'::-webkit-scrollbar').display});
    return{visible:[generic,find,tabs.firstElementChild!,document.querySelector('.toolbar')!].map(appearance),hidden:[document.querySelector('td[data-r="1"][data-c="0"]')!,document.querySelector('td[data-r="1"][data-c="0"] .cell-display')!].map(appearance)};
  });
  for(const style of styles.visible){expect(style.nativeWidth).toBe('auto');expect(style.width).toBe('4px');expect(style.height).toBe('4px');expect(style.thumb).toBe('rgba(0, 0, 0, 0.5)');}
  for(const style of styles.hidden){expect(style.nativeWidth).toBe('none');expect(style.display).toBe('none');expect(style.width).toBe('0px');expect(style.thumb).toBe('rgba(0, 0, 0, 0.5)');}
});
test('Bottom aligns the last entered value with the viewport bottom, ignoring formula-only and empty tails',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0];
      s.cells[`${s.rows[80].id}:${s.columns[1].id}`]={value:0};s.rows[80].height=80;
      s.cells[`${s.rows[90].id}:${s.columns[1].id}`]={formula:{kind:'literal',value:42}};
      s.cells[`${s.rows[99].id}:${s.columns[1].id}`]={value:''};
      await store.save(state.book,state.version,'Synthetic bottom target');
    }finally{store.close();}
  });
  await page.reload();await page.locator('[data-action="bottom"]').click();
  await expect(cell(page,80,1)).toBeVisible();await expect(cell(page,80,1)).toHaveText('0');
  const gap=()=>cell(page,80,1).evaluate(td=>{const grid=document.querySelector<HTMLElement>('#grid-scroll')!;return td.closest('tr')!.getBoundingClientRect().bottom-grid.getBoundingClientRect().top-grid.clientTop-grid.clientHeight;});
  await expect.poll(gap).toBeCloseTo(0,0);
  await page.locator('[data-action="top"]').click();await expect(cell(page,0,0)).toBeVisible();
  await page.locator('[data-action="bottom"]').click();await expect.poll(gap).toBeCloseTo(0,0);
});
for(const scope of ['sheet','table'] as const)test(`column-divider auto-fit clears dates in nested ${scope} summaries, including offscreen values`,async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const before=await page.evaluate(async scope=>{
    const storage='/src/storage.ts',dates='/src/dates.ts',{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),{excelDate}=await import(/* @vite-ignore */dates) as typeof import('../../src/dates'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],owner=state.book.tables.find(table=>table.sheet===s.id)!,year=new Date().getFullYear();
      owner.rows=s.rows.slice(1,96).map(row=>row.id);s.columns[0].width=50;
      s.groups=[
        {id:'date-parent',axis:'row',kind:'summary',members:s.rows.slice(2,90).map(row=>row.id),collapsed:false,label:'Date parent',...(scope==='table'?{table:owner.id}:{})},
        {id:'date-child',axis:'row',kind:'summary',members:s.rows.slice(82,89).map(row=>row.id),collapsed:false,label:'Date child',...(scope==='table'?{table:owner.id}:{})}
      ];
      s.cells[`${s.rows[3].id}:${s.columns[0].id}`]={value:excelDate(year-1,11,30)!,format:{number:'date'}};
      s.cells[`${s.rows[82].id}:${s.columns[0].id}`]={formula:{kind:'literal',value:excelDate(year-2,12,31)!},format:{number:'date',bold:true}};
      s.cells[`${s.rows[83].id}:${s.columns[0].id}`]={value:excelDate(year,12,31)!,format:{number:'date',italic:true}};
      for(const i of [3,82,83])s.rows[i].height=27.75;
      await store.save(state.book,state.version,'Synthetic date auto-fit');return s;
    }finally{store.close();}
  },scope);
  const clipped=async(r:number)=>cell(page,r,0).evaluate(td=>{
    const display=td.querySelector('.cell-display')!,value=td.querySelector('.cell-value')!,range=document.createRange();range.selectNodeContents(value);
    return range.getBoundingClientRect().right>display.getBoundingClientRect().right-parseFloat(getComputedStyle(display).paddingRight)+.5;
  });
  await page.reload();await expect(cell(page,3,0)).toBeVisible();expect(await clipped(3)).toBe(true);
  await page.locator('[data-resize-column="0"]').dblclick({position:{x:4,y:24}});await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect(await clipped(3)).toBe(false);
  await page.locator('#row-jump').fill('83');await page.locator('#row-jump').press('Enter');
  await expect(cell(page,82,0)).toBeVisible();expect(await clipped(82)).toBe(false);expect(await clipped(83)).toBe(false);
  await page.reload();await expect(cell(page,82,0)).toBeVisible();expect(await clipped(82)).toBe(false);
  const after=await page.evaluate(async()=>{
    const storage='/src/storage.ts',{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book.sheets[0];}finally{store.close();}
  });
  expect(after.columns[0].width).toBeGreaterThan(before.columns[0].width!);
  expect(after.rows).toEqual(before.rows);expect(after.cells).toEqual(before.cells);expect(after.groups).toEqual(before.groups);
});
test('table header rows share the regular default height without overriding explicit heights',async({page})=>{
  await page.goto('/');await expect(cell(page,0,0)).toBeVisible();
  const height=(r:number)=>cell(page,r,0).evaluate(td=>td.closest('tr')!.getBoundingClientRect().height);
  expect(await height(0)).toBe(await height(2));expect(await height(0)).toBe(33);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0];s.rows[0].height=45;
      await store.save(state.book,state.version,'Synthetic explicit header height');
    }finally{store.close();}
  });
  await page.reload();await expect(cell(page,0,0)).toBeVisible();expect(await height(0)).toBe(60);expect(await height(2)).toBe(33);
});
test('fixed-height wrapped cells grow without clipping, preserve row formats, and keep summary text clear of controls',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const before=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0];
      s.groups=[{id:'fixed-summary',axis:'row',kind:'summary',members:s.rows.slice(2,7).map(r=>r.id),collapsed:false,label:'Fixed summary'}];
      s.columns[0].width=160;s.columns[1].width=130;
      for(const i of [2,3,4,5,6])s.rows[i].height=27.75;
      s.cells[`${s.rows[2].id}:${s.columns[0].id}`]={value:'Summary'};
      const texts=['First line\nSecond line','A very long wrapped sentence that needs several visual lines in a narrow column.','One\nTwo\nThree\nFour'];
      texts.forEach((value,i)=>s.cells[`${s.rows[i+3].id}:${s.columns[1].id}`]={value,format:{wrap:true}});
      s.cells[`${s.rows[6].id}:${s.columns[1].id}`]={value:'No wrap\nKeep the row height',format:{wrap:false}};
      await store.save(state.book,state.version,'Synthetic fixed wrapped rows');return s;
    }finally{store.close();}
  });
  await page.reload();await expect(cell(page,3,1)).toBeVisible();
  const geometry=async()=>page.evaluate(()=>{
    const wrapped=[3,4,5].map(r=>{
      const display=document.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="1"] .cell-display`)!;
      const range=document.createRange();range.selectNodeContents(display.querySelector('.cell-value')!);
      const bounds=display.getBoundingClientRect(),style=getComputedStyle(display),rects=[...range.getClientRects()];
      return {height:display.closest('tr')!.getBoundingClientRect().height,clipped:rects.some(rect=>rect.bottom>bounds.bottom-parseFloat(style.paddingBottom)+.5)};
    });
    const summary=document.querySelector('td[data-r="2"][data-c="0"]')!,button=summary.querySelector('.summary-chevron')!,range=document.createRange();
    range.selectNodeContents(summary.querySelector('.cell-value')!);
    return {wrapped,overlap:button.getBoundingClientRect().right>range.getBoundingClientRect().left,nowrapHeight:document.querySelector('td[data-r="6"][data-c="1"]')!.closest('tr')!.getBoundingClientRect().height};
  });
  const initial=await geometry();expect(initial.wrapped.every(r=>!r.clipped&&r.height>37)).toBe(true);expect(initial.overlap).toBe(false);expect(initial.nowrapHeight).toBeCloseTo(37,0);
  await page.locator('#row-jump').fill('70');await page.locator('#row-jump').press('Enter');
  await page.locator('#row-jump').fill('4');await page.locator('#row-jump').press('Enter');
  await expect(cell(page,3,1)).toBeVisible();expect(await geometry()).toEqual(initial);
  const after=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book.sheets[0];}finally{store.close();}
  });
  expect(after.rows).toEqual(before.rows);expect(after.cells).toEqual(before.cells);expect(after.groups).toEqual(before.groups);
});
for(const wrappedHeader of [false,true])test(`short saved rows never clip text, retain horizontal access and sticky wrapping (${wrappedHeader?'wrapped':'unwrapped'} header)`,async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const before=await page.evaluate(async wrappedHeader=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],table=state.book.tables.find(t=>t.sheet===s.id)!;
      table.rows=s.rows.slice(1,96).map(row=>row.id);s.columns[1].width=130;s.rows[0].height=6;
      if(wrappedHeader){
        table.columns[1].name='A wrapped header\nwith descenders gypqj';
        s.cells[`${table.header}:${table.columns[1].column}`]={value:table.columns[1].name,format:{wrap:true}};
      }
      const cases=[
        {value:'gypqj \u00e9',format:{wrap:false,bold:true,italic:true,underline:true}},
        {value:'One line\nAnother gypqj line\nFinal \u00e9 line',format:{wrap:true}},
        {value:'https://example.invalid/a-very-long-invented-link-with-a-readable-final-segment',format:{wrap:false}},
        {value:'https://example.invalid/a-very-long-invented-link-with-a-readable-final-segment',format:{wrap:true}},
        {value:'Keep the taller saved row',format:{wrap:false}}
      ];
      cases.forEach((cell,i)=>{s.rows[i+2].height=i===4?60:6;s.cells[`${s.rows[i+2].id}:${s.columns[1].id}`]=cell;});
      await store.save(state.book,state.version,'Synthetic short cells');return s;
    }finally{store.close();}
  },wrappedHeader);
  await page.reload();await expect(cell(page,2,1)).toBeVisible();
  const geometry=()=>page.evaluate(()=>{
    const cells=[2,3,4,5,6].map(r=>{
      const display=document.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="1"] .cell-display`)!,range=document.createRange();
      range.selectNodeContents(display.querySelector('.cell-value')!);
      const bounds=display.getBoundingClientRect(),style=getComputedStyle(display);
      return{clipped:[...range.getClientRects()].some(rect=>rect.top<bounds.top+parseFloat(style.paddingTop)-.5||rect.bottom>bounds.bottom-parseFloat(style.paddingBottom)+.5),verticalOverflow:display.scrollHeight>display.clientHeight+1,height:display.closest('tr')!.getBoundingClientRect().height};
    });
    const display=document.querySelector<HTMLElement>('td[data-r="4"][data-c="1"] .cell-display')!,text=document.createTreeWalker(display.querySelector('.cell-value')!,NodeFilter.SHOW_TEXT).nextNode()!,range=document.createRange();
    display.scrollLeft=display.scrollWidth;range.setStart(text,text.textContent!.length-1);range.setEnd(text,text.textContent!.length);
    const end=range.getBoundingClientRect(),bounds=display.getBoundingClientRect();
    return{cells,nowrap:getComputedStyle(display).whiteSpace,horizontalAccess:display.scrollLeft>0&&end.left>=bounds.left&&end.right<=bounds.right+.5};
  });
  const initial=await geometry();expect(initial.cells.every(cell=>!cell.clipped&&!cell.verticalOverflow)).toBe(true);expect(initial.cells[4].height).toBe(80);
  expect(initial.nowrap).toBe('nowrap');expect(initial.horizontalAccess).toBe(true);
  const longDisplay=cell(page,4,1).locator('.cell-display');
  await expect(longDisplay).toHaveCSS('overflow-x','auto');await expect(longDisplay).toHaveCSS('scrollbar-width','none');
  await longDisplay.evaluate(el=>{el.scrollLeft=0;});await longDisplay.hover();await page.mouse.wheel(1000,0);
  await expect.poll(()=>longDisplay.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  await page.locator('#row-jump').fill('70');await page.locator('#row-jump').press('Enter');
  const header=page.locator('.sticky-table-header[data-column="'+before.columns[1].id+'"]');
  await expect(header).toBeVisible();await expect(header).toHaveCSS('white-space',wrappedHeader?'pre-wrap':'nowrap');
  expect(await header.evaluate(el=>{
    const range=document.createRange();range.selectNodeContents(el);
    const bounds=el.getBoundingClientRect(),style=getComputedStyle(el);
    return [...range.getClientRects()].every(rect=>rect.top>=bounds.top+parseFloat(style.paddingTop)-.5&&rect.bottom<=bounds.bottom-parseFloat(style.paddingBottom)+.5);
  })).toBe(true);
  await page.locator('#row-jump').fill('3');await page.locator('#row-jump').press('Enter');
  await expect(cell(page,2,1)).toBeVisible();expect(await geometry()).toEqual(initial);
  await page.reload();await expect(cell(page,2,1)).toBeVisible();expect(await geometry()).toEqual(initial);
  const after=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book.sheets[0];}finally{store.close();}
  });
  expect(after.rows).toEqual(before.rows);expect(after.cells).toEqual(before.cells);
});
test('date display adapts by year without changing serials, formulas or text notes',async({page})=>{
  await page.goto('/');await expect(page.locator('.grid')).toBeVisible();
  const serials=await page.evaluate(async()=>{
    const storage='/src/storage.ts',dates='/src/dates.ts',{Store}=await import(/* @vite-ignore */storage) as typeof import('../../src/storage'),{excelDate}=await import(/* @vite-ignore */dates) as typeof import('../../src/dates'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],year=new Date().getFullYear(),values=[excelDate(year,9,29)!,excelDate(year,10,2)!,excelDate(year-1,9,29)!];
      values.forEach((value,i)=>{s.cells[`${s.rows[i+4].id}:${s.columns[0].id}`]=i===1?{formula:{kind:'literal',value},format:{number:'date'}}:{value,format:{number:'date'}};});
      s.cells[`${s.rows[7].id}:${s.columns[0].id}`]={value:'Recipe note: 9/29',format:{number:'date'}};
      s.cells[`${s.rows[8].id}:${s.columns[0].id}`]={value:values[0]};
      await store.save(state.book,state.version,'Synthetic date display');return{values,year};
    }finally{store.close();}
  });
  await page.reload();await expect(cell(page,4,0)).toHaveText('9/29');await expect(cell(page,5,0)).toHaveText('10/02');
  await expect(cell(page,6,0)).toHaveText(`${String((serials.year-1)%100).padStart(2,'0')}/09/29`);
  await expect(cell(page,7,0)).toHaveText('Recipe note: 9/29');await expect(cell(page,8,0)).toHaveText(String(serials.values[0]));
  await cell(page,4,0).click();await expect(page.locator('#formula')).toHaveValue(String(serials.values[0]));await page.getByRole('button',{name:'Close date picker',exact:true}).click();
  await cell(page,5,0).click();await expect(page.locator('#formula')).toHaveValue('='+serials.values[1]);await page.getByRole('button',{name:'Close date picker',exact:true}).click();
});
test('meal date formatting follows filled Meal cells without rewriting serials, formulas, notes or colors',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const before=await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{blankSheet,setInput,key}=await import(p+'model.ts') as typeof import('../../src/model'),{createTable}=await import(p+'table-management.ts') as typeof import('../../src/table-management'),{excelDate}=await import(p+'dates.ts') as typeof import('../../src/dates'),store=await Store.open();
    try{
      const state=(await store.load())!,s=blankSheet('Meal date preview',12,5);state.book.sheets.unshift(s);
      ['Meal','Date','Notes'].forEach((name,i)=>setInput(state.book,s,s.rows[0].id,s.columns[i].id,name));
      const t=createTable(state.book,s.id,{r1:0,r2:5,c1:0,c2:2},'DateMeals',true),year=new Date().getFullYear();
      setInput(state.book,s,s.rows[1].id,s.columns[0].id,'Invented first meal');setInput(state.book,s,s.rows[2].id,s.columns[0].id,'Invented earlier meal');setInput(state.book,s,s.rows[5].id,s.columns[0].id,'="Formula meal"');
      s.cells[key(s.rows[1].id,s.columns[1].id)]={value:excelDate(year,9,29)!,format:{bold:true,color:'#112233',background:'#abcdef'}};
      s.cells[key(s.rows[2].id,s.columns[1].id)]={value:excelDate(year-1,9,1)!};
      s.cells[key(s.rows[3].id,s.columns[1].id)]={value:'Recipe note: 100g, then chill',note:'Keep the full note',format:{wrap:false}};
      s.cells[key(s.rows[4].id,s.columns[1].id)]={value:excelDate(year,9,29)!};
      setInput(state.book,s,s.rows[5].id,s.columns[1].id,`=DATE(${year},11,1)`);
      s.cells[key(s.rows[5].id,s.columns[1].id)].format={color:'#AABBCC',background:'#ABCDEF'};
      await store.save(state.book,state.version,'Synthetic meal dates');sessionStorage.setItem('fnt-current-sheet',s.id);return{sheet:s,year,condition:t.columns[0].id};
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Meal date preview',exact:true}).click();await cell(page,1,1).click();
  const toggle=page.getByRole('button',{name:'Table-constrained header selection'});if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
  await page.locator('th[data-col="1"]').click();await page.locator('[data-action="format"]').click();
  await page.locator('#number-format').selectOption('date-compact');await page.locator('#date-format-condition').selectOption(before.condition);await page.getByRole('button',{name:'Apply to selection',exact:true}).click();
  await expect(cell(page,1,1)).toHaveText('9/29');await expect(cell(page,2,1)).toHaveText(`${String((before.year-1)%100).padStart(2,'0')}/9/01`);await expect(cell(page,3,1)).toHaveText('Recipe note: 100g, then chill');await expect(cell(page,5,1)).toHaveText('11/01');
  const address=(r:number)=>`${before.sheet.rows[r].id}:${before.sheet.columns[1].id}`;
  await expect(cell(page,4,1)).toHaveText(String(before.sheet.cells[address(4)].value));
  await expect(cell(page,1,1)).toHaveCSS('color','rgb(17, 34, 51)');
  const read=()=>page.evaluate(async()=>{const p='/src/storage.ts',{Store}=await import(p) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book.sheets[0];}finally{store.close();}});
  await expect(page.locator('#save-state')).toContainText(/^Saved/);const formatted=await read();
  for(const r of [1,2,3,4,5]){const original=before.sheet.cells[address(r)],after=formatted.cells[address(r)];expect(after.value).toEqual(original.value);expect(after.formula).toEqual(original.formula);expect(after.note).toEqual(original.note);}
  expect(formatted.cells[address(1)].format).toMatchObject({...before.sheet.cells[address(1)].format});
  expect(formatted.cells[address(5)].format).toMatchObject({...before.sheet.cells[address(5)].format});
  await cell(page,5,1).click();await expect(page.locator('#cell-date')).toHaveAttribute('type','date');await expect(page.locator('#cell-date')).toHaveValue(`${before.year}-11-01`);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  const geometry=await page.locator('.cell-date-picker').evaluate(el=>({top:el.getBoundingClientRect().top,cellBottom:document.querySelector('td[data-r="5"][data-c="1"]')!.getBoundingClientRect().bottom,gridFilter:getComputedStyle(document.querySelector('#grid-scroll')!).filter}));
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.cellBottom);expect(geometry.gridFilter).toBe('none');
  await page.getByRole('button',{name:'Close date picker',exact:true}).click();expect((await read()).cells).toEqual(formatted.cells);
  await cell(page,5,1).click();await page.locator('#cell-date').fill(`${before.year-1}-09-01`);
  await expect(cell(page,5,1)).toHaveText(`${String((before.year-1)%100).padStart(2,'0')}/9/01`);
  await page.locator('[data-action="undo"]').click();await expect(cell(page,5,1)).toHaveText('11/01');
  await page.locator('[data-action="undo"]').click();await expect(page.locator('#save-state')).toContainText(/^Saved/);expect((await read()).cells).toEqual(before.sheet.cells);
  await page.locator('[data-action="redo"]').click();await expect(cell(page,1,1)).toHaveText('9/29');
  await edit(page,4,0,'A newly named meal');await expect(cell(page,4,1)).toHaveText('9/29');
  await cell(page,4,1).click();await page.getByRole('button',{name:'Close date picker',exact:true}).click();await page.locator('#formula').fill('nov 22');await page.locator('#formula').press('Enter');await expect(cell(page,4,1)).toHaveText('11/22');
  await cell(page,4,1).click();await page.getByRole('button',{name:'Close date picker',exact:true}).click();await page.locator('#formula').fill("'nov 22");await page.locator('#formula').press('Enter');await expect(cell(page,4,1)).toHaveText('nov 22');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);expect((await read()).cells[address(4)]).toMatchObject({value:'nov 22',dateLiteral:true});
  await page.reload();await expect(cell(page,4,1)).toHaveText('nov 22');
  await edit(page,1,0,'');await expect(cell(page,1,1)).toHaveText(String(before.sheet.cells[address(1)].value));
});
test('overflowing unwrapped text reaches the right cell border, including custom-height rows',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async()=>{
    const p='/src/storage.ts',{Store}=await import(p) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets[0];s.columns[0].width=100;
      for(const r of [4,5,6])s.cells[`${s.rows[r].id}:${s.columns[0].id}`]={value:'Long text should reach the right border before it clips',format:{wrap:r===6}};
      s.rows[5].height=48;await store.save(state.book,state.version,'Synthetic edge clipping');
    }finally{store.close();}
  });
  await page.reload();
  for(const r of [4,5]){
    const geometry=await cell(page,r,0).evaluate(td=>{
      const display=td.querySelector<HTMLElement>('.cell-display')!,border=parseFloat(getComputedStyle(td).borderRightWidth);
      return{gap:td.getBoundingClientRect().right-display.getBoundingClientRect().right-border,padding:parseFloat(getComputedStyle(display).paddingRight),overflows:display.scrollWidth>display.clientWidth};
    });
    expect(geometry.gap).toBeCloseTo(0,1);expect(geometry.padding).toBe(0);expect(geometry.overflows).toBe(true);
  }
  await expect(cell(page,6,0)).toHaveCSS('padding-right','10px');await expect(cell(page,6,0)).toHaveClass(/wrapped/);
});
test('table end strokes follow visible identities and the true bottom through virtual scrolling and column moves',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,s=state.book.sheets.find(s=>s.name==='Ingredients')!,t=state.book.tables.find(t=>t.sheet===s.id)!;t.rows=s.rows.slice(1,72).map(r=>r.id);await store.save(state.book,state.version,'Synthetic long table');}finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await expect(cell(page,0,5)).toHaveClass(/table-right-edge/);await expect(cell(page,1,5)).toHaveClass(/table-right-edge/);
  await expect(page.locator('.table-bottom-edge')).toHaveCount(0);
  const stroke=await cell(page,1,5).evaluate(el=>getComputedStyle(el).borderRightColor),header=await cell(page,0,0).evaluate(el=>getComputedStyle(el).borderBottomColor);
  expect(stroke).toBe(header);
  await expect(cell(page,1,5)).toHaveCSS('border-right-width','1px');await expect(cell(page,1,5)).toHaveCSS('border-right-style','solid');
  await page.locator('#row-jump').fill('72');await page.locator('#row-jump').press('Enter');
  await expect(cell(page,71,5)).toHaveClass(/table-bottom-edge/);await expect(page.locator('.table-bottom-edge')).toHaveCount(6);
  await expect(cell(page,71,5)).toHaveCSS('border-bottom-color',header);
  await expect(cell(page,72,5)).not.toHaveClass(/table-bottom-edge|table-right-edge/);
  await page.locator('#row-jump').fill('2');await page.locator('#row-jump').press('Enter');
  await cell(page,1,5).click();await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
  await page.getByRole('button',{name:'Move column right',exact:true}).click();
  await expect(cell(page,1,6)).toHaveText('3.75');await expect(cell(page,1,6)).toHaveClass(/table-right-edge/);
  await expect(cell(page,1,5)).not.toHaveClass(/table-right-edge/);
  await page.locator('#row-jump').fill('72');await page.locator('#row-jump').press('Enter');
  await expect(cell(page,71,6)).toHaveClass(/table-bottom-edge/);await expect(cell(page,71,6)).toHaveClass(/table-right-edge/);
  await expect(cell(page,71,5)).not.toHaveClass(/table-bottom-edge/);
});
test('real grid editing, formulas, rename/move, undo, local reload, notes and picker',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(cell(page,1,3)).toHaveText('208.8');
  await edit(page,1,2,'200');await expect(cell(page,1,3)).toHaveText('232');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,3)).toHaveText('208.8');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(cell(page,1,3)).toHaveText('232');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await edit(page,0,5,'Energy density');await expect(cell(page,1,5)).toHaveText('3.75');
  await cell(page,1,5).click();await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
  await page.getByRole('button',{name:'Move column left',exact:true}).click();await expect(cell(page,1,4)).toHaveText('3.75');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('232');
  await cell(page,1,3).click();await expect(page.getByRole('textbox',{name:'Cell value or formula',exact:true})).toHaveValue(/Ingredients\[Energy density\]/);
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(cell(page,1,3)).toHaveText('232');
  await cell(page,1,5).dblclick();await expect(page.locator('#cell-editor')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#cell-editor').fill('Line one\nLine two');await expect(page.locator('#cell-note,#cell-link')).toHaveCount(0);await cell(page,2,5).click();await expect(page.locator('#cell-editor')).toHaveCount(0);
  await expect(cell(page,1,5)).toHaveCSS('white-space','nowrap');await expect(cell(page,1,5)).toHaveText('Line one\nLine two');
  await cell(page,1,1).click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Ingredients',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();
  await cell(page,1,1).click();await page.getByRole('searchbox',{name:'Search dropdown options'}).fill('oats');await page.locator('.cell-dropdown').getByRole('option').click();
  await expect(cell(page,1,1)).toHaveText('Example oats');await expect(cell(page,1,1)).toHaveClass(/linked/);await expect(cell(page,1,3)).toHaveText('750');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await edit(page,1,0,'Oats renamed');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,1)).toHaveText('Oats renamed');await expect(cell(page,1,3)).toHaveText('750');
  expect(errors).toEqual([]);await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
  await expect(page.locator('.brand,.notice,.sheet-heading,.bottom-caption')).toHaveCount(0);
  const layout=await page.evaluate(()=>({height:document.querySelector('#grid-scroll')!.getBoundingClientRect().height,viewport:innerHeight}));
  expect(layout.height/layout.viewport).toBeGreaterThan(.72);
});
test('backup restore preserves pre-restore recovery and copy outline survives selection',async({page})=>{
  await page.goto('/');await expect(cell(page,1,3)).toHaveText('208.8');
  await cell(page,1,2).click();await page.getByRole('button',{name:'Copy',exact:true}).click();await cell(page,2,2).click();await expect(cell(page,1,2)).toHaveClass(/copying/);
  await page.getByRole('button',{name:'Paste',exact:true}).click();await expect(cell(page,2,2)).toHaveText('180');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download independent full backup'}).click();const download=await event;
  const path=await download.path();expect(path).toBeTruthy();await page.getByRole('button',{name:'Close dialog'}).click();
  await edit(page,1,2,'250');await expect(cell(page,1,3)).toHaveText('290');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.locator('#restore').setInputFiles(path!);
  await expect(cell(page,1,3)).toHaveText('208.8');await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.getByRole('button',{name:'Recovery checkpoints'}).click();await expect(page.locator('[data-checkpoint]')).toContainText(['Before backup restore']);
});
test('switching cells commits formula-bar drafts rather than silently discarding them',async({page})=>{
  await page.goto('/');await cell(page,1,2).click();
  await page.getByRole('textbox',{name:'Cell value or formula',exact:true}).fill('120');
  await expect(page.locator('#save-state')).toContainText('not saved yet');
  await cell(page,2,2).click();
  await expect(cell(page,1,2)).toHaveText('120');await expect(cell(page,1,3)).toHaveText('139.2');
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(cell(page,1,2)).toHaveText('120');
});
test('checkpoint restore keeps full recovery and pending IDs, and disconnects the previous sync destination',async({page})=>{
  await page.goto('/');await page.locator('[data-action="save"]').click();
  await expect(page.locator('#save-state')).toContainText('recovery checkpoint');
  await edit(page,1,2,'250');await expect(page.locator('#save-state')).toContainText('Saved');
  const before=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{
      const state=await store.load(),configured=await store.metadata(state.version,(s:object)=>({...s,sync:{owner:'example',repo:'invented-data',branch:'main',path:'book.json'},remoteSha:'invented-sha'}));
      return{pending:configured.pending.map((p:{id:string})=>p.id),version:configured.version};
    }finally{store.close();}
  });
  let uploads=0;await page.route('https://api.github.com/**',async route=>{uploads++;await route.abort();});
  await page.reload();await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.getByRole('button',{name:'Recovery checkpoints',exact:true}).click();
  const versionBeforeRestore=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{return(await store.load()).version;}finally{store.close();}
  });
  await page.locator('[data-checkpoint]').filter({hasText:'Manual save'}).click();
  await expect(page.locator('#save-state')).toContainText('Checkpoint restored locally - sync disconnected');
  await expect(cell(page,1,2)).toHaveText('180');
  const result=await page.evaluate(async()=>{
    const storage='/src/storage.ts',archive='/src/archive.ts',{Store}=await import(/* @vite-ignore */storage),{parseArchive}=await import(/* @vite-ignore */archive),store=await Store.open();
    try{
      const state=await store.load(),history=await store.history(),saved=parseArchive(history.find((h:{label:string})=>h.label==='Before backup restore').backup);
      const daily=saved.state.book.sheets.find((s:{name:string})=>s.name==='Daily log');
      return{disconnected:!state.sync&&!state.remoteSha,pending:state.pending.map((p:{id:string})=>p.id),recoveryVersion:saved.state.version,recoveryRepo:saved.state.sync.repo,recoveryQuantity:daily.cells[`${daily.rows[1].id}:${daily.columns[2].id}`].value};
    }finally{store.close();}
  });
  expect(result.disconnected).toBe(true);expect(result.pending).toEqual(expect.arrayContaining(before.pending));expect(result.recoveryVersion).toBeGreaterThanOrEqual(versionBeforeRestore);expect(result.recoveryQuantity).toBe(250);expect(result.recoveryRepo).toBe('invented-data');expect(uploads).toBe(0);
});
test('date formatting agrees with formula serials at the 1900 boundary and persists after reload',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await edit(page,1,1,'=DATE(1900,2,29)');await page.locator('[data-action="format"]').click();await page.locator('#number-format').selectOption('date');await page.getByRole('button',{name:'Apply to selection',exact:true}).click();
  await expect(cell(page,1,1)).toHaveText('00/02/29');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(cell(page,1,1)).toHaveText('00/02/29');
  await edit(page,1,1,'=DATE(1900,3,1)');await expect(cell(page,1,1)).toHaveText('00/03/01');
  await edit(page,1,1,'=DATE(1900,1,1)');await expect(cell(page,1,1)).toHaveText('00/01/01');
});
test('in-cell and formula-bar typing share one draft, one commit and one undo',async({page})=>{
  await page.goto('/');await cell(page,1,2).click();await page.keyboard.type('120');
  const bar=page.getByRole('textbox',{name:'Cell value or formula',exact:true}),inline=page.getByRole('textbox',{name:'Edit selected cell',exact:true});
  await expect(bar).toHaveValue('120');await expect(inline).toHaveValue('120');
  await bar.fill('=60*2');await expect(inline).toHaveValue('=60*2');await expect(cell(page,1,3)).toHaveText('208.8');
  await inline.fill('=50*2');await expect(bar).toHaveValue('=50*2');
  await inline.press('Enter');await expect(cell(page,1,2)).toHaveText('100');await expect(cell(page,1,3)).toHaveText('116');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,2)).toHaveText('180');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(cell(page,1,2)).toHaveText('100');
  await cell(page,1,2).click();await page.keyboard.type('999');await inline.press('Escape');
  await expect(cell(page,1,2)).toHaveText('100');await expect(bar).toHaveValue('=(50*2)');
});
test('long multiline cells never show scrollbar gutters while typing and retain their full text',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const target=cell(page,1,1),text=Array.from({length:20},(_,i)=>`Invented note ${i+1}: ${'Long text without wrapping. '.repeat(20)}`).join('\n');
  await target.click();await page.keyboard.type('x');
  const inline=page.getByRole('textbox',{name:'Edit selected cell',exact:true});
  await inline.fill(text);await inline.press('Control+End');
  const metrics=await inline.evaluate(el=>{
    if(!(el instanceof HTMLTextAreaElement))throw Error('Expected the in-cell textarea.');
    const style=getComputedStyle(el);
    return{horizontal:el.scrollWidth>el.clientWidth,vertical:el.scrollHeight>el.clientHeight,
      width:el.offsetWidth-el.clientWidth-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth),height:el.offsetHeight-el.clientHeight-parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth),
      scrolled:el.scrollTop>0,webkit:getComputedStyle(el,'::-webkit-scrollbar').display};
  });
  expect(metrics).toEqual({horizontal:true,vertical:true,width:0,height:0,scrolled:true,webkit:'none'});
  await inline.press('End');await page.keyboard.type('!');
  await expect(inline).toHaveValue(text+'!');await inline.press('Tab');
  await expect(target).toHaveText(text+'!');await expect(target).toHaveCSS('white-space','nowrap');await expect(target).toHaveCSS('overflow','hidden');
  await target.dblclick();await expect(page.locator('#cell-editor')).toHaveValue(text+'!');
  await cell(page,2,1).click();await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(target).toHaveText(text+'!');await expect(target).toHaveCSS('white-space','nowrap');
});
test('typing adjacent to a table expands formulas, while a gap remains freeform',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await edit(page,5,0,'Gap entry');await expect(cell(page,5,5)).toHaveText('');
  await edit(page,4,0,'Adjacent entry');await edit(page,4,1,'50');await edit(page,4,2,'100');
  await expect(cell(page,4,5)).toHaveText('2');await expect(cell(page,5,5)).toHaveText('');
  await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await expect(cell(page,4,5)).toHaveText('2');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await cell(page,2,1).click();
  await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('checkbox',{name:'Ingredients',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown'}).click();await cell(page,2,1).click();
  await page.getByRole('searchbox',{name:'Search dropdown options'}).fill('lentils');await page.locator('.cell-dropdown').getByRole('option').click();await edit(page,2,2,'100');
  await expect(cell(page,2,3)).toHaveText('116');await expect(cell(page,2,1)).toHaveClass(/linked/);
});
test('header boundary controls insert and move a selected column block without losing formulas',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator('th[data-col="1"] .column-index').click();
  await page.locator('th[data-col="2"] .column-index').click({modifiers:['Shift']});
  await page.locator('[data-move-column="1"]').click();
  await page.locator('[data-insert-column="6"]').click();
  await expect(cell(page,1,4)).toHaveText('40');await expect(cell(page,1,5)).toHaveText('150');await expect(cell(page,1,3)).toHaveText('3.75');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('208.8');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,1,1)).toHaveText('40');
  await page.locator('th[data-col="1"] .column-index').click();await page.locator('[data-insert-column="2"]').click();await expect(cell(page,0,2)).toHaveText('New column');await expect(cell(page,1,6)).toHaveText('3.75');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.locator('[data-row-select="1"]').hover();await page.locator('[data-insert-row="2"]').click();await expect(cell(page,2,5)).toHaveText('#DIV/0!');await expect(cell(page,3,0)).toHaveText('Example lentils');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(cell(page,2,0)).toHaveText('Example lentils');
});
test('desktop drag handle moves multiple columns without overwriting a destination',async({page,isMobile})=>{
  test.skip(isMobile,'Touch equivalent is exercised in the boundary-control test.');
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.locator('th[data-col="1"] .column-index').click();await page.locator('th[data-col="2"] .column-index').click({modifiers:['Shift']});
  await page.locator('[data-move-column="1"]').dragTo(page.locator('th[data-col="5"]'),{targetPosition:{x:130,y:14}});
  await expect(cell(page,1,4)).toHaveText('40');await expect(cell(page,1,5)).toHaveText('150');await expect(cell(page,1,3)).toHaveText('3.75');
  await page.getByRole('button',{name:'Daily log',exact:true}).click();await expect(cell(page,1,3)).toHaveText('208.8');
});
