import {expect,test,type Page} from '@playwright/test';

async function snapshot(page:Page){
  return page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{return(await store.load())!.book;}finally{store.close();}
  });
}
async function fixture(page:Page,narrowHeaders=false){
  await page.goto('/');await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.evaluate(async(narrow)=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0];
      s.groups=[
        {id:'outer',axis:'row',kind:'summary',members:s.rows.slice(1,10).map(r=>r.id),collapsed:false,label:'Outer'},
        {id:'inner',axis:'row',kind:'summary',members:s.rows.slice(3,7).map(r=>r.id),collapsed:false,label:'Inner'},
        {id:'leaf',axis:'row',kind:'summary',members:s.rows.slice(4,6).map(r=>r.id),collapsed:false,label:'Leaf'},
        {id:'separate',axis:'row',kind:'summary',members:s.rows.slice(15,20).map(r=>r.id),collapsed:false,label:'Separate'},
        {id:'plain-row',axis:'row',kind:'range',members:s.rows.slice(10,12).map(r=>r.id),collapsed:false,label:'Notes'},
        {id:'col-outer',axis:'column',kind:'summary',members:s.columns.slice(0,9).map(c=>c.id),collapsed:false,label:'Nutrition'},
        {id:'col-inner',axis:'column',kind:'summary',members:s.columns.slice(1,3).map(c=>c.id),collapsed:false,label:'Macros'},
        {id:'plain-col',axis:'column',kind:'range',members:s.columns.slice(3,5).map(c=>c.id),collapsed:false,label:'Extras'}
      ];
      for(const i of [1,2,3,4,5,6,7,8,9,15,16,17,18,19]){
        const value=({1:'Outer summary',3:'Inner summary',4:'Leaf summary',5:'Nested detail',7:'Last direct child',15:'Separate summary',16:'Independent detail'} as Record<number,string>)[i]??'';
        s.cells[`${s.rows[i].id}:${s.columns[0].id}`]={value};
      }
      if(narrow){s.columns[0].width=40;s.columns[2].width=40;}
      const notes=state.book.sheets.find(s=>s.name==='Notebook')!;
      notes.groups=[{id:'notebook-group',axis:'row',kind:'summary',members:notes.rows.slice(1,3).map(r=>r.id),collapsed:false,label:'Notebook notes'}];
      await store.save(state.book,state.version,'Synthetic outlines');
    }finally{store.close();}
  },narrowHeaders);
  await page.reload();await expect(page.locator('.group-menu-button')).toBeVisible();
  return snapshot(page);
}
async function menu(page:Page){
  if(!await page.locator('.group-popover').count())await page.getByRole('button',{name:'Group controls',exact:true}).click();
  return page.locator('.group-popover');
}
test('summary split toggles initial grouping, gates plus, and shares caret SVG styling',async({page})=>{
  const before=await fixture(page),scope=page.locator('.corner [data-action="table-selection"]');
  await expect(page.locator('.group-control[data-group-id="plain-row"]').first()).toHaveAttribute('title',/^Hide (?!.*plain range).+/);
  await expect(page.locator('.group-control[data-group-id="plain-col"]').first()).toHaveAttribute('title',/^Hide (?!.*plain range).+/);
  if(await scope.getAttribute('aria-pressed')==='true')await scope.click();
  await page.locator('[data-row-select="13"] .row-index').click();
  await page.locator('[data-row-select="14"] .row-index').click({modifiers:['Shift']});
  const split=page.locator('.summary-group-control'),plus=split.locator('.summary-group-add');
  await expect(split).toHaveAttribute('data-active','false');await expect(plus).toBeDisabled();await expect(plus).toHaveCSS('opacity','0.4');
  await split.getByRole('button',{name:'Create summary group',exact:true}).click();
  await expect(split).toHaveAttribute('data-active','true');await expect(plus).toBeEnabled();await expect(plus).toHaveCSS('opacity','1');
  const appearance=await page.evaluate(()=>{
    const svgStyle=(svg:Element)=>{
      const style=getComputedStyle(svg),path=getComputedStyle(svg.querySelector('path')!);
      return{width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,color:style.color,fill:style.fill,strokeWidth:path.strokeWidth,vectorEffect:path.vectorEffect};
    };
    return{plus:svgStyle(document.querySelector('.summary-group-add svg')!),caret:svgStyle(document.querySelector('.format-caret svg')!)};
  });
  expect(appearance.plus).toEqual(appearance.caret);
  await split.getByRole('button',{name:'Remove summary group',exact:true}).click();
  await expect(split).toHaveAttribute('data-active','false');await expect(plus).toBeDisabled();
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups).toEqual(before.sheets[0].groups);
});
for(const headerOffset of [0,3])test(`master chevron centers on the first line and stays in a sticky header at row ${headerOffset+1}, preserving data and undo`,async({page})=>{
  await fixture(page);
  await page.evaluate(async offset=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],table=state.book.tables.find(table=>table.sheet===s.id)!;
      table.header=s.rows[offset].id;table.rows=s.rows.slice(offset+1,96).map(row=>row.id);
      if(offset){
        for(const field of table.columns)s.cells[`${table.header}:${field.column}`]={value:field.name};
        for(const group of s.groups.filter(group=>group.axis==='row'))group.members=group.members.map(id=>s.rows[s.rows.findIndex(row=>row.id===id)+offset].id);
      }
      s.rows[0].height=60;s.rows[1+offset].height=60;s.groups.find(group=>group.id==='leaf')!.collapsed=true;
      s.cells[`${s.rows[1+offset].id}:${s.columns[0].id}`]={value:'Outer summary\nSecond line\nThird line',format:{wrap:true}};
      await store.save(state.book,state.version,'Synthetic sticky master chevron');
    }finally{store.close();}
  },headerOffset);
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  const scope=page.locator('.corner [data-action="table-selection"]');if(await scope.getAttribute('aria-pressed')==='true')await scope.click();
  const before=await snapshot(page),first=page.locator('td[data-r="0"][data-c="0"]'),master=first.locator('.master-chevron');
  await expect(master).toBeVisible();
  const geometry=await first.evaluate(td=>{
    const button=td.querySelector('.master-chevron')!,value=td.querySelector('.cell-value')!,range=document.createRange();range.selectNodeContents(value);
    const bounds=button.getBoundingClientRect(),controls=[...td.querySelectorAll('.group-control')].map(button=>button.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
    const line=range.getClientRects()[0];
    return{centered:Math.abs(bounds.top+bounds.height/2-line.top-line.height/2)<.5,left:bounds.left-td.getBoundingClientRect().left,overlap:controls.some((rect,i)=>i>0&&rect.left<controls[i-1].right-.5),textClear:controls.every(rect=>rect.right<=range.getBoundingClientRect().left)};
  });
  expect(geometry).toEqual({centered:true,left:6,overlap:false,textClear:true});
  expect(await page.locator(`td[data-r="${1+headerOffset}"][data-c="0"]`).evaluate(td=>{
    const range=document.createRange();range.selectNodeContents(td.querySelector('.cell-value')!);
    const first=range.getClientRects()[0],button=td.querySelector('.summary-chevron')!.getBoundingClientRect();
    return Math.abs(button.top+button.height/2-first.top-first.height/2);
  })).toBeLessThan(.5);
  const flags=async()=> (await snapshot(page)).sheets[0].groups.filter(group=>group.kind==='summary').map(group=>group.collapsed);
  await master.click();await expect.poll(flags).toEqual(Array(6).fill(true));
  await expect(master).toHaveAttribute('aria-expanded','false');
  await master.click();await expect.poll(flags).toEqual(Array(6).fill(false));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(flags).toEqual(Array(6).fill(true));
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(flags).toEqual(Array(6).fill(false));
  await page.reload();await expect(master).toBeVisible();expect(await flags()).toEqual(Array(6).fill(false));
  await page.locator('.grid thead [data-col="0"] .column-index').click();await page.locator('[data-action="pin"]').click();
  await page.locator('#row-jump').fill('70');await page.locator('#row-jump').press('Enter');
  const sticky=page.locator('.sticky-table-headers .master-chevron');await expect(sticky).toBeVisible();
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollLeft=240;});
  await expect.poll(async()=>sticky.evaluate(button=>{
    const bounds=button.getBoundingClientRect(),header=button.closest('.sticky-table-headers')!.querySelector('.sticky-table-header')!.getBoundingClientRect();
    const range=document.createRange();range.selectNodeContents(button.closest('.sticky-table-headers')!.querySelector('.sticky-table-header')!);const first=range.getClientRects()[0];
    return{centered:Math.abs(bounds.top+bounds.height/2-first.top-first.height/2)<.5,left:Math.round(bounds.left-header.left),hit:document.elementFromPoint(bounds.left+12,bounds.top+12)?.closest('.master-chevron')===button};
  })).toEqual({centered:true,left:6,hit:true});
  await sticky.click();await expect.poll(flags).toEqual(Array(6).fill(true));
  await sticky.click();await expect.poll(flags).toEqual(Array(6).fill(false));
  const after=await snapshot(page);
  expect(after.sheets.map(sheet=>sheet.cells)).toEqual(before.sheets.map(sheet=>sheet.cells));
  expect(after.sheets[0].rows).toEqual(before.sheets[0].rows);
  expect(after.sheets[0].groups.filter(group=>group.kind!=='summary')).toEqual(before.sheets[0].groups.filter(group=>group.kind!=='summary'));
  expect(after.sheets.slice(1).map(sheet=>sheet.groups)).toEqual(before.sheets.slice(1).map(sheet=>sheet.groups));
});
test('master chevron respects table selection and does not toggle sheet or plain groups',async({page})=>{
  await fixture(page);
  const owner=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],table=state.book.tables.find(table=>table.sheet===s.id)!;
      table.rows=s.rows.slice(1,21).map(row=>row.id);s.groups.filter(group=>group.axis==='row').forEach(group=>{group.table=table.id;});
      await store.save(state.book,state.version,'Synthetic master chevron scope');return table.id;
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  const scope=page.locator('.corner [data-action="table-selection"]');if(await scope.getAttribute('aria-pressed')!=='true')await scope.click();
  await page.locator('[data-row-select="3"] .row-index').click();
  const before=await snapshot(page);await page.locator('td[data-r="0"][data-c="0"] .master-chevron').click();
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups.filter(group=>group.table===owner&&group.kind==='summary').every(group=>group.collapsed)).toBe(true);
  const after=await snapshot(page);
  expect(after.sheets[0].groups.filter(group=>group.table!==owner||group.kind!=='summary')).toEqual(before.sheets[0].groups.filter(group=>group.table!==owner||group.kind!=='summary'));
});
for(const selection of ['rows','columns','cells'] as const)test(`summary split control adds a nested ${selection} group and removes only that group`,async({page})=>{
  await fixture(page);
  const scope=page.locator('.corner [data-action="table-selection"]');
  if(await scope.getAttribute('aria-pressed')==='true')await scope.click();
  const before=await snapshot(page),s=before.sheets[0],axis=selection==='columns'?'column':'row';
  await page.locator('[data-row-select="13"] .row-index').click();
  await page.mouse.move(0,0);
  expect(await page.locator('.summary-group-control').evaluate(el=>{
    const left=el.querySelector<HTMLButtonElement>('[data-action="summary-group"]')!,normal=document.querySelector('[data-action="plain-group"]')!;
    const appearance=(button:Element)=>{const style=getComputedStyle(button);return {color:style.color,opacity:style.opacity,border:style.borderColor,radius:style.borderRadius,background:style.backgroundColor};};
    return {enabled:!left.disabled,matches:JSON.stringify(appearance(left))===JSON.stringify(appearance(normal))};
  })).toEqual({enabled:true,matches:true});
  await expect(page.locator('.summary-group-add')).toBeDisabled();
  await expect(page.locator('.summary-group-add')).toHaveCSS('opacity','0.4');
  if(selection==='rows'){
    await page.locator('[data-row-select="3"] .row-index').click();
    await page.locator('[data-row-select="5"] .row-index').click({modifiers:['Shift']});
  }else if(selection==='columns'){
    await page.locator('.grid thead [data-col="1"] .column-index').click();
    await page.locator('.grid thead [data-col="3"] .column-index').click({modifiers:['Shift']});
  }else{
    await page.locator('td[data-r="3"][data-c="0"]').click();
    await page.locator('td[data-r="5"][data-c="0"]').click({modifiers:['Shift']});
  }
  const split=page.locator('.summary-group-control');
  await expect(split).toHaveAttribute('data-toolbar-tool','action:summary-group');
  await expect(split.getByRole('button',{name:'Remove summary group',exact:true})).toBeEnabled();
  expect(await split.locator('.summary-group-add').evaluate(el=>{
    const divider=getComputedStyle(el,'::before');
    return {width:divider.width,color:divider.backgroundColor,content:divider.content};
  })).toEqual({width:'1px',color:'rgb(221, 227, 220)',content:'""'});
  const appearance=await split.evaluate(el=>{
    const add=getComputedStyle(el.querySelector('.summary-group-add')!),remove=getComputedStyle(el.querySelector('[data-action="summary-group"]')!);
    return {shadow:getComputedStyle(el).boxShadow,addBorder:add.borderColor,addWidth:add.borderWidth,removeBorder:remove.borderColor};
  });
  expect(appearance.shadow).toContain('rgb(214, 223, 201)');expect(appearance.addBorder).toBe('rgba(0, 0, 0, 0)');expect(appearance.addWidth).toBe('1px');expect(appearance.removeBorder).toBe('rgba(0, 0, 0, 0)');
  await expect(split).toHaveCSS('background-color','rgb(232, 239, 223)');
  await expect(split.locator('.summary-group-add')).toBeEnabled();
  const icon=split.locator('.summary-group-add svg');
  expect(await icon.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))).toEqual({width:14,height:14});
  await split.getByRole('button',{name:'Add summary group',exact:true}).click();
  if(selection==='cells')await page.locator('[data-group-axis="row"]').click();
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups.length).toBe(s.groups.length+1);
  const added=(await snapshot(page)).sheets[0].groups.at(-1)!;
  expect(added.kind).toBe('summary');expect(added.axis).toBe(axis);expect(added.table).toBeUndefined();
  expect(added.members).toEqual((axis==='row'?s.rows.slice(3,6):s.columns.slice(1,4)).map(item=>item.id));
  expect((await snapshot(page)).sheets[0].groups.slice(0,-1)).toEqual(s.groups);
  await split.getByRole('button',{name:'Remove summary group',exact:true}).click();
  if(selection==='cells')await page.locator('[data-toggle-group-axis="row"]').click();
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups).toEqual(s.groups);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups.at(-1)?.id).toBe(added.id);
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  expect((await snapshot(page)).sheets[0].groups.at(-1)?.id).toBe(added.id);
  expect((await snapshot(page)).sheets.map(sheet=>sheet.cells)).toEqual(before.sheets.map(sheet=>sheet.cells));
});
for(const collapsed of [false,true])test(`plain grouping a table summary row includes its complete ${collapsed?'collapsed':'expanded'} summary and nested details`,async({page})=>{
  await fixture(page);
  const owner=await page.evaluate(async collapsed=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets[0],owner=state.book.tables.find(table=>table.sheet===sheet.id)!;
      owner.rows=sheet.rows.slice(1,21).map(row=>row.id);
      for(const group of sheet.groups.filter(group=>group.axis==='row'))group.table=owner.id;
      sheet.groups.find(group=>group.id==='outer')!.collapsed=collapsed;
      await store.save(state.book,state.version,'Table summary fixture');return owner.id;
    }finally{store.close();}
  },collapsed);
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  const scope=page.locator('.corner [data-action="table-selection"]');
  if(await scope.getAttribute('aria-pressed')!=='true')await scope.click();
  const before=await snapshot(page);
  await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+Alt+g');
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const grouped=await snapshot(page),plain=grouped.sheets[0].groups.at(-1)!;
  expect(plain.kind).toBe('range');expect(plain.table).toBe(owner);
  expect(grouped.sheets[0].groups.slice(0,-1)).toEqual(before.sheets[0].groups);
  await page.locator(`.grid .group-control[data-group-id="${plain.id}"]`).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  for(let row=1;row<10;row++)await expect(page.locator(`td[data-r="${row}"][data-c="0"]`)).toHaveCount(0);
  await expect(page.locator('td[data-r="10"][data-c="0"]')).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('td[data-r="1"][data-c="0"]')).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const undone=await snapshot(page);
  expect(undone.sheets[0].groups).toEqual(before.sheets[0].groups);
  expect(undone.sheets.map(sheet=>sheet.cells)).toEqual(before.sheets.map(sheet=>sheet.cells));
});
test('summary split control refuses an identical duplicate without removing the existing summary',async({page})=>{
  await fixture(page);
  const scope=page.locator('.corner [data-action="table-selection"]');
  if(await scope.getAttribute('aria-pressed')==='true')await scope.click();
  const before=await snapshot(page);
  await page.locator('[data-row-select="3"] .row-index').click();
  await page.locator('[data-row-select="6"] .row-index').click({modifiers:['Shift']});
  await page.getByRole('button',{name:'Add summary group',exact:true}).click();
  await expect(page.locator('#error')).toContainText('already grouped');
  expect((await snapshot(page)).sheets[0].groups).toEqual(before.sheets[0].groups);
});
test('summary split control preserves table scope when adding and removing a nested group',async({page})=>{
  await fixture(page);
  const owner=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets[0],table=state.book.tables.find(t=>t.sheet===sheet.id)!;
      table.rows=sheet.rows.slice(1,21).map(r=>r.id);
      for(const group of sheet.groups.filter(g=>g.axis==='row'))group.table=table.id;
      await store.save(state.book,state.version,'Scoped summary fixture');return table.id;
    }finally{store.close();}
  });
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  const scope=page.locator('.corner [data-action="table-selection"]');
  if(await scope.getAttribute('aria-pressed')!=='true')await scope.click();
  const before=await snapshot(page);
  await page.locator('[data-row-select="3"] .row-index').click();
  await page.locator('[data-row-select="5"] .row-index').click({modifiers:['Shift']});
  await page.getByRole('button',{name:'Add summary group',exact:true}).click();
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups.length).toBe(before.sheets[0].groups.length+1);
  expect((await snapshot(page)).sheets[0].groups.at(-1)?.table).toBe(owner);
  await page.getByRole('button',{name:'Remove summary group',exact:true}).click();
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups).toEqual(before.sheets[0].groups);
});
test('summary split control rearranges as one tool without executing either side',async({page})=>{
  await fixture(page);
  const before=await snapshot(page);
  await page.getByRole('button',{name:'Arrange toolbar',exact:true}).click();
  await page.locator('[data-action="add-summary-group"]').click();
  const split=page.locator('.summary-group-control');
  await expect(split).toHaveClass(/toolbar-tool-selected/);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async()=>{
    const order=(await snapshot(page)).toolbarOrder??[];
    return order.indexOf('action:summary-group')<order.indexOf('action:table-selection');
  }).toBe(true);
  expect((await snapshot(page)).sheets[0].groups).toEqual(before.sheets[0].groups);
  await page.getByRole('button',{name:'Finish arranging toolbar',exact:true}).click();
  await expect(split.locator('button')).toHaveCount(2);
});
test('group popover keeps its anchor after toggles with a rearranged and scrolled toolbar',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;state.book.toolbarOrder=['action:undo','action:redo','action:table-selection'];await store.save(state.book,state.version,'Synthetic rearranged group control');}finally{store.close();}
  });
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  await page.locator('.toolbar').evaluate(el=>{el.scrollLeft=40;});
  const popup=await menu(page),before=(await popup.boundingBox())!,scroll=await page.locator('.toolbar').evaluate(el=>el.scrollLeft);
  for(const name of ['Tree view','Plain group hints']){
    await popup.getByRole('switch',{name,exact:true}).click();
    const after=(await popup.boundingBox())!;expect(after.x).toBeCloseTo(before.x,0);expect(after.y).toBeCloseTo(before.y,0);
    expect(await page.locator('.toolbar').evaluate(el=>el.scrollLeft)).toBe(scroll);
  }
  await popup.locator('[data-outline-axis="row"][data-outline-level="0"]').click();
  const after=(await popup.boundingBox())!;expect(after.x).toBeCloseTo(before.x,0);expect(after.y).toBeCloseTo(before.y,0);
});
test('thousands of table rows with hundreds of summary groups remain responsive',async({page})=>{
  test.setTimeout(30000);
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,sheet=state.book.sheets[0],table=state.book.tables.find(t=>t.sheet===sheet.id)!;
      const header=sheet.rows.find(row=>row.id===table.header)!;
      sheet.rows=[header,...Array.from({length:5000},(_,i)=>({id:`large-row-${i}`}))];table.rows=sheet.rows.slice(1).map(row=>row.id);
      sheet.cells=Object.fromEntries(Object.entries(sheet.cells).filter(([address])=>address.startsWith(header.id+':')));sheet.validations=[];
      sheet.groups=Array.from({length:250},(_,i)=>({id:`large-group-${i}`,axis:'row' as const,kind:'summary' as const,table:table.id,members:table.rows.slice(i*20,i*20+20),collapsed:false,label:`Synthetic group ${i}`}));
      await store.save(state.book,state.version,'Large synthetic table outlines');
    }finally{store.close();}
  });
  const start=Date.now();await page.reload();
  await expect(page.locator('td[data-r="1"] .group-control[data-group-id="large-group-0"]')).toBeVisible();
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await expect(page.locator('.group-popover')).toBeVisible();
  expect(Date.now()-start).toBeLessThan(15000);
});
test('moving a nested two-row group outside its parents trims old memberships and rails, with reload and undo',async({page})=>{
  const before=await fixture(page),s=before.sheets[0],members=s.groups.find(g=>g.id==='leaf')!.members;
  const tree=(await menu(page)).getByRole('switch',{name:'Tree view',exact:true});
  if(await tree.getAttribute('aria-checked')!=='true')await tree.click();
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await page.locator('[data-row-select="4"] .row-index').click();
  await page.locator('[data-move-row="4"]').click();
  await expect(page.locator('td[data-c="0"].moving')).toHaveCount(2);
  await page.locator('[data-insert-row="13"]').click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const after=await snapshot(page),moved=after.sheets[0],own=moved.groups.find(g=>g.id==='leaf')!;
  expect(own.members).toEqual(members);
  for(const id of ['outer','inner'])expect(moved.groups.find(g=>g.id===id)!.members.some(id=>members.includes(id))).toBe(false);
  expect(moved.cells).toEqual(s.cells);
  const anchor=moved.rows.findIndex(r=>r.id===members[0]),last=moved.rows.findIndex(r=>r.id===members[1]);
  await expect(page.locator(`td[data-r="${anchor}"][data-c="0"] .row-outline-rail[data-group-id="outer"]`)).toHaveCount(0);
  await expect(page.locator(`td[data-r="${last}"][data-c="0"] .row-outline-rail[data-group-id="leaf"]`)).toHaveClass(/outline-end/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshotAfterSave(page)).sheets[0].groups).toEqual(s.groups);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.reload();expect((await snapshot(page)).sheets[0].groups).toEqual(moved.groups);
  await expect(page.locator(`td[data-r="${last}"][data-c="0"] .row-outline-rail[data-group-id="leaf"]`)).toHaveClass(/outline-end/);
});
async function snapshotAfterSave(page:Page){await expect(page.locator('#save-state')).toContainText(/^Saved/);return snapshot(page);}
test('expanded row groups keep full-width boundary strokes and cancel without changes',async({page})=>{
  const before=await fixture(page);
  await page.locator('[data-row-select="13"] .row-index').click();await page.locator('[data-move-row="13"]').click();
  await page.locator('[data-insert-row="4"]').hover();
  await expect(page.locator('.move-drop-guide[data-axis="row"]')).toHaveCount(1);
  await expect(page.locator('td[data-r="3"][data-c="0"]')).toHaveAttribute('data-drop-group','inner');
  await expect(page.locator('.group-context-outline[data-group-id="inner"]')).toHaveCount(1);
  await expect(page.locator('.group-context-outline')).toHaveCSS('border-top-style','dashed');
  await page.locator('[data-insert-row="13"]').hover();
  await expect(page.locator('.group-drop-target')).toHaveCount(0);
  await expect(page.locator('.group-context-outline,.group-summary-drop-outline')).toHaveCount(0);
  const guide=page.locator('.move-drop-guide[data-axis="row"]');await expect(guide).toHaveCount(1);
  expect(await guide.evaluate(el=>Math.abs(el.getBoundingClientRect().width-document.querySelector('.grid')!.getBoundingClientRect().width))).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
test('expanded column groups keep full-height boundary strokes',async({page})=>{
  await fixture(page);
  await page.locator('th[data-col="9"] .column-index').click();await page.locator('[data-move-column="9"]').click();
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollLeft=0;});
  await page.locator('[data-insert-column="2"]').hover();
  await expect(page.locator('.move-drop-guide[data-axis="column"]')).toHaveCount(1);
  await expect(page.locator('td[data-r="0"][data-c="1"]')).toHaveAttribute('data-drop-group','col-inner');
  await page.locator('[data-insert-column="9"]').hover();
  await expect(page.locator('.group-drop-target')).toHaveCount(0);
  const guide=page.locator('.move-drop-guide[data-axis="column"]');await expect(guide).toHaveCount(1);
  expect(await guide.evaluate(el=>Math.abs(el.getBoundingClientRect().height-document.querySelector('.grid')!.getBoundingClientRect().height))).toBeLessThan(1);
  await page.keyboard.press('Escape');await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
});
test('native body drops retain precise boundaries inside expanded groups and preserve formula identities',async({page})=>{
  const before=await fixture(page);
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await page.locator('[data-move-row="13"]').dispatchEvent('dragstart',{dataTransfer:transfer});
  const target=page.locator('td[data-r="4"][data-c="0"]'),rect=await target.boundingBox();
  await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:rect!.x+10,clientY:rect!.y+2});
  await expect(page.locator('.move-drop-guide[data-axis="row"]')).toHaveCount(1);
  await expect(page.locator('td[data-r="3"][data-c="0"]')).toHaveAttribute('data-drop-group','inner');
  await target.dispatchEvent('drop',{dataTransfer:transfer});
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
  const after=(await snapshot(page)).sheets[0],id=before.sheets[0].rows[13].id;
  expect(after.rows[4].id).toBe(id);expect(after.groups.find(g=>g.id==='inner')!.members).toContain(id);
  expect(after.cells).toEqual(before.sheets[0].cells);
});
test('collapsed row targets show only a highlight and accept whole blocks without expanding',async({page})=>{
  const before=await fixture(page);
  await page.locator('.summary-chevron[data-group-id="inner"]').click();
  await page.locator('[data-row-select="13"] .row-index').click();await page.locator('[data-move-row="13"]').click();
  await page.locator('[data-insert-row="4"]').hover();
  await expect(page.locator('td[data-r="3"][data-c="0"]')).toHaveAttribute('data-drop-group','inner');
  await expect(page.locator('.move-drop-guide')).toHaveCount(0);
  await page.locator('[data-insert-row="4"]').click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const id=before.sheets[0].rows[13].id;
  await expect.poll(async()=>(await snapshot(page)).sheets[0].groups.find(g=>g.id==='inner')).toMatchObject({collapsed:true,members:expect.arrayContaining([id])});
  const saved=(await snapshot(page)).sheets[0];
  expect(saved.groups.find(g=>g.id==='outer')!.members).toContain(id);
  expect(saved.cells).toEqual(before.sheets[0].cells);
  await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
});
test('collapsed column targets show no stroke and accept native drops without expanding',async({page})=>{
  const before=await fixture(page);
  await page.locator('.column-summary-controls [data-group-id="col-inner"]').click();
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await page.locator('[data-move-column="9"]').dispatchEvent('dragstart',{dataTransfer:transfer});
  const target=page.locator('td[data-r="0"][data-c="1"]'),rect=await target.boundingBox();
  await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:rect!.x+rect!.width/2,clientY:rect!.y+rect!.height/2});
  await expect(target).toHaveAttribute('data-drop-group','col-inner');
  await expect(page.locator('.group-summary-drop-outline[data-group-id="col-inner"]')).toHaveCount(1);
  await expect(page.locator('.move-drop-guide')).toHaveCount(0);
  await target.dispatchEvent('drop',{dataTransfer:transfer});
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const after=(await snapshot(page)).sheets[0],id=before.sheets[0].columns[9].id;
  expect(after.groups.find(g=>g.id==='col-inner')).toMatchObject({collapsed:true,members:expect.arrayContaining([id])});
  expect(after.cells).toEqual(before.sheets[0].cells);
  await expect(page.locator('.move-drop-guide,.group-drop-target,.moving')).toHaveCount(0);
});
test('shared bottom edges offer explicit parent or child append without adding layout space',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{const state=await store.load(),s=state.book.sheets[0];s.groups.find((g:{id:string})=>g.id==='inner').members=s.rows.slice(3,6).map((r:{id:string})=>r.id);await store.save(state.book,state.version,'Synthetic shared edge');}finally{store.close();}
  });
  await page.reload();const before=await snapshot(page),source=before.sheets[0].rows[13].id;
  const target=page.locator('td[data-r="5"][data-c="0"]'),height=await target.evaluate(el=>el.getBoundingClientRect().height);
  await page.locator('[data-row-select="13"] .row-index').click();await page.locator('[data-move-row="13"]').click();
  await target.hover({position:{x:80,y:height-2}});
  await expect(page.locator('.group-context-outline[data-group-id="leaf"]')).toHaveCount(1);
  expect(await target.evaluate(el=>el.getBoundingClientRect().height)).toBe(height);
  await target.click({position:{x:80,y:height-2}});
  const chooser=page.getByRole('dialog',{name:'Append inside which group?'});await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('button',{name:/Leaf summary/})).toHaveCount(1);await expect(chooser.getByRole('button',{name:/Inner summary/})).toHaveCount(1);
  await chooser.getByRole('button',{name:/Inner summary/}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  const after=(await snapshot(page)).sheets[0];
  expect(after.groups.find(g=>g.id==='inner')!.members).toContain(source);expect(after.groups.find(g=>g.id==='outer')!.members).toContain(source);
  expect(after.groups.find(g=>g.id==='leaf')!.members).toEqual(before.sheets[0].groups.find(g=>g.id==='leaf')!.members);
  expect(after.cells).toEqual(before.sheets[0].cells);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot(page)).sheets[0]).toEqual(before.sheets[0]);
});
test('summary drop outlines span the sheet axis or only the owning table axis',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path),store=await Store.open();
    try{
      const state=await store.load(),s=state.book.sheets.find((s:{name:string})=>s.name==='Notebook');
      const owner={id:'drop-outline-table',sheet:s.id,name:'Scoped outline',header:s.rows[1].id,rows:s.rows.slice(2,22).map((r:{id:string})=>r.id),columns:s.columns.slice(2,7).map((c:{id:string},i:number)=>({id:`outline-field-${i}`,column:c.id,name:`Field ${i+1}`}))};
      state.book.tables.push(owner);s.groups=[
        {id:'sheet-summary-row',axis:'row',kind:'summary',members:s.rows.slice(1,8).map((r:{id:string})=>r.id),collapsed:false,label:'Sheet row'},
        {id:'table-summary-row',axis:'row',kind:'summary',table:owner.id,members:s.rows.slice(3,6).map((r:{id:string})=>r.id),collapsed:false,label:'Table row'},
        {id:'sheet-summary-column',axis:'column',kind:'summary',members:s.columns.slice(0,2).map((c:{id:string})=>c.id),collapsed:false,label:'Sheet column'},
        {id:'table-summary-column',axis:'column',kind:'summary',table:owner.id,members:s.columns.slice(3,5).map((c:{id:string})=>c.id),collapsed:false,label:'Table column'}
      ];await store.save(state.book,state.version,'Synthetic scoped outlines');
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  for(const [axis,id,r,c,first,last] of [
    ['row','sheet-summary-row',1,0,0,15],['row','table-summary-row',3,2,2,6],
    ['column','sheet-summary-column',0,0,0,99],['column','table-summary-column',1,3,1,21]
  ] as const){
    const transfer=await page.evaluateHandle(()=>new DataTransfer()),handle=page.locator(axis==='row'?'[data-move-row="13"]':'[data-move-column="6"]');
    await handle.dispatchEvent('dragstart',{dataTransfer:transfer});
    const target=page.locator(`td[data-r="${r}"][data-c="${c}"]`),rect=(await target.boundingBox())!;
    await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2});
    const outline=page.locator(`.group-summary-drop-outline[data-group-id="${id}"]`);await expect(outline).toHaveCount(1);
    const extent=await page.evaluate(({axis,r,c,first,last})=>{
      const cells=[...document.querySelectorAll<HTMLElement>(axis==='row'?`td[data-r="${r}"]`:`td[data-c="${c}"]`)].filter(el=>{const index=Number(axis==='row'?el.dataset.c:el.dataset.r);return index>=first&&index<=last;}).map(el=>el.getBoundingClientRect());
      return axis==='row'?Math.max(...cells.map(rect=>rect.right))-Math.min(...cells.map(rect=>rect.left)):Math.max(...cells.map(rect=>rect.bottom))-Math.min(...cells.map(rect=>rect.top));
    },{axis,r,c,first,last});
    const bounds=(await outline.boundingBox())!;expect(Math.abs((axis==='row'?bounds.width:bounds.height)-extent)).toBeLessThan(1);
    await handle.dispatchEvent('dragend');await expect(page.locator('.group-context-outline,.group-summary-drop-outline')).toHaveCount(0);
  }
});
test('left chevrons retain summaries, independent branches, plain hints and formula identities',async({page})=>{
  const before=await fixture(page);
  await expect(page.locator('tr[data-row="1"] td:first-of-type .summary-chevron[data-group-id="outer"]')).toBeVisible();
  await expect(page.locator('tbody th .row-group-controls')).toHaveCount(0);
  expect(await page.locator('.grid col').first().evaluate(el=>el.getBoundingClientRect().width)).toBe(78);
  await expect(page.locator('th[data-col="2"] .plain-group-hints [data-group-id="plain-col"]')).toHaveCount(1);
  await page.locator('.grid .group-control[data-group-id="outer"]').click();
  await expect(page.locator('[data-row-select="1"]')).toBeVisible();await expect(page.locator('[data-row-select="3"]')).toHaveCount(0);
  await expect(page.locator('[data-row-select="15"]')).toHaveCount(1);
  await expect(page.locator('tr[data-row="1"] th .row-plain-hints [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid [data-group-id="plain-row"]').click();
  await expect(page.locator('.grid [data-group-id="plain-row"] path[d="M3 3l18 18"]')).toHaveCount(1);
  await expect(page.locator('[data-row-select="10"],[data-row-select="11"]')).toHaveCount(0);
  await expect(page.locator('.grid [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid .group-control[data-group-id="col-outer"]').click();
  await expect(page.locator('th[data-col="0"]')).toHaveCount(1);await expect(page.locator('th[data-col="2"]')).toHaveCount(0);
  await expect(page.locator('th[data-col="0"] .plain-group-hints [data-group-id="plain-col"]')).toBeVisible();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  await page.reload();await expect(page.locator('.grid [data-group-id="plain-row"]')).toHaveCount(1);
  await page.locator('.grid .group-control[data-group-id="outer"]').click();await expect(page.locator('[data-row-select="3"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-row-select="3"]')).toHaveCount(0);
});
for(const tableScoped of [false,true])for(const axis of ['row','column'] as const)test(`plain ${axis} header boundaries combine hidden groups, label actual values and restore only the chosen group (${tableScoped?'table':'sheet'})`,async({page})=>{
  await fixture(page);
  await page.evaluate(async({axis,tableScoped})=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],owner=state.book.tables.find(table=>table.sheet===s.id)!;
      owner.rows=s.rows.slice(1,96).map(row=>row.id);
      s.groups=[
        {id:'boundary-one',axis,kind:'range',members:(axis==='row'?s.rows.slice(3,5):s.columns.slice(1,3)).map(item=>item.id),collapsed:true,label:'Imported outline one',...(tableScoped?{table:owner.id}:{})},
        {id:'boundary-two',axis,kind:'range',members:(axis==='row'?s.rows.slice(5,7):s.columns.slice(3,5)).map(item=>item.id),collapsed:true,label:'Imported outline two',...(tableScoped?{table:owner.id}:{})}
      ];
      s.cells[`${s.rows[3].id}:${s.columns[0].id}`]={formula:{kind:'literal',value:'First hidden row'}};
      s.cells[`${s.rows[5].id}:${s.columns[0].id}`]={value:'Second hidden row'};
      ['Fat (g)','Carbs (g)','Sugar (g)','Protein (g)'].forEach((value,i)=>{s.cells[`${s.rows[0].id}:${s.columns[i+1].id}`]={value};});
      await store.save(state.book,state.version,'Synthetic shared boundaries');
    }finally{store.close();}
  },{axis,tableScoped});
  await page.reload();const scope=page.locator('.corner [data-action="table-selection"]');
  if(await scope.getAttribute('aria-pressed')==='true')await scope.click();
  const before=await snapshotAfterSave(page),control=page.locator(`.plain-boundary-control[data-plain-axis="${axis}"]`);
  await expect(control).toHaveCount(1);await expect(page.locator('tbody td .plain-boundary-control')).toHaveCount(0);
  const first=axis==='row'?'First hidden row':'Fat (g) · Carbs (g)',second=axis==='row'?'Second hidden row':'Sugar (g) · Protein (g)';
  await expect(control).toHaveAttribute('title',`Choose ${axis==='row'?'rows':'columns'}: ${first} · ${second}`);
  expect(await control.evaluate((el,axis)=>{
    const bounds=el.getBoundingClientRect(),header=el.closest('th')!.getBoundingClientRect();
    return{onBoundary:Math.abs(axis==='row'?bounds.top+bounds.height/2-header.bottom:bounds.left+bounds.width/2-header.right)<.5,hit:document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2)?.closest('.plain-boundary-control')===el};
  },axis)).toEqual({onBoundary:true,hit:true});
  if(axis==='column')expect(await control.evaluate(el=>{
    const bounds=el.getBoundingClientRect(),header=el.closest('th')!,move=header.querySelector('.move-control')!.getBoundingClientRect(),index=header.querySelector('.column-index')!.getBoundingClientRect();
    return{between:bounds.top>=move.bottom+1&&bounds.bottom<=index.top-1,taller:header.getBoundingClientRect().height>=63};
  })).toEqual({between:true,taller:true});
  await control.click();const choices=page.getByRole('menu',{name:`Choose ${axis} group`}).getByRole('menuitem');
  await expect(choices).toHaveCount(2);await expect(choices.nth(0)).toContainText(first);await expect(choices.nth(1)).toContainText(second);await expect(choices.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(choices.nth(1)).toBeFocused();await page.keyboard.press('Escape');
  await expect(page.locator('.plain-boundary-menu')).toHaveCount(0);await expect(control).toBeFocused();
  await control.click();await choices.nth(0).click();
  const flags=async()=>(await snapshotAfterSave(page)).sheets[0].groups.map(group=>group.collapsed);
  expect(await flags()).toEqual([false,true]);
  await expect(page.locator('.grid [data-group-id="boundary-one"]')).toHaveAttribute('title',`Hide ${first}`);
  const remaining=page.locator('.grid [data-group-id="boundary-two"]');await expect(remaining).toHaveAttribute('title',`Show ${second}`);await remaining.click();
  expect(await flags()).toEqual([false,false]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await flags()).toEqual([false,true]);
  await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await flags()).toEqual([false,false]);
  await page.reload();expect(await flags()).toEqual([false,false]);
  const after=await snapshotAfterSave(page);expect(after.sheets[0].cells).toEqual(before.sheets[0].cells);expect(after.sheets[0].rows).toEqual(before.sheets[0].rows);expect(after.sheets[0].columns).toEqual(before.sheets[0].columns);expect(after.tables).toEqual(before.tables);
});
test('row insertion between 331 and 332 survives focus scrolling at the viewport edge',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],owner=state.book.tables.find(table=>table.sheet===s.id)!;
      const model='/src/model.ts',{blankSheet}=await import(/* @vite-ignore */model) as typeof import('../../src/model');
      s.rows.push(...blankSheet('Synthetic extra rows',400,1).rows);
      owner.rows=s.rows.slice(1).map(row=>row.id);
      s.groups=[{id:'meal-block',axis:'row',kind:'summary',members:s.rows.slice(325,354).map(row=>row.id),collapsed:false,label:'Synthetic meal'}];
      await store.save(state.book,state.version,'Synthetic deep row insertion');
    }finally{store.close();}
  });
  await page.reload();const before=await snapshotAfterSave(page),grid=page.locator('#grid-scroll');
  await grid.evaluate(el=>{el.scrollTop=33*325;});const button=page.locator('[data-row-select="330"] [data-insert-row="331"]');await expect(button).toBeAttached();
  await button.evaluate(el=>{
    const grid=el.closest('#grid-scroll')!,bounds=el.getBoundingClientRect(),viewport=grid.getBoundingClientRect();
    grid.scrollTop+=bounds.top-(viewport.top+grid.clientHeight-6);
  });
  await page.waitForTimeout(100);const rect=(await button.boundingBox())!;
  await page.mouse.click(rect.x+rect.width/2,rect.y+3,{delay:200});
  await expect.poll(async()=>(await snapshotAfterSave(page)).sheets[0].rows.length).toBe(before.sheets[0].rows.length+1);
  const after=await snapshotAfterSave(page),id=after.sheets[0].rows[331].id;
  expect(after.sheets[0].rows[330].id).toBe(before.sheets[0].rows[330].id);expect(after.sheets[0].rows[332].id).toBe(before.sheets[0].rows[331].id);
  expect(after.sheets[0].groups[0].members).toContain(id);
  for(const [address,value]of Object.entries(before.sheets[0].cells))expect(after.sheets[0].cells[address]).toEqual(value);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshotAfterSave(page)).sheets[0].rows).toEqual(before.sheets[0].rows);
});
for(const tableScoped of [false,true])for(const axis of ['row','column'] as const)test(`summary chevron labels use current cell values (${axis}, ${tableScoped?'table':'sheet'})`,async({page})=>{
  await fixture(page);
  await page.evaluate(async({axis,tableScoped})=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],owner=state.book.tables.find(table=>table.sheet===s.id)!;
      owner.rows=s.rows.slice(1).map(row=>row.id);
      s.groups=[{id:'value-summary',axis,kind:'summary',members:(axis==='row'?s.rows.slice(3,6):s.columns.slice(1,4)).map(item=>item.id),collapsed:false,label:'Imported outline 1',...(tableScoped?{table:owner.id}:{})}];
      s.cells[`${s.rows[3].id}:${s.columns[0].id}`]={formula:{kind:'literal',value:'Calculated summary'}};
      ['Fat (g)','Carbs (g)','Sugar (g)'].forEach((value,i)=>{s.cells[`${s.rows[0].id}:${s.columns[i+1].id}`]={value};});
      await store.save(state.book,state.version,'Synthetic summary labels');
    }finally{store.close();}
  },{axis,tableScoped});
  await page.reload();const scope=page.locator('.corner [data-action="table-selection"]');if(await scope.getAttribute('aria-pressed')==='true')await scope.click();
  const control=page.locator('.group-control[data-group-id="value-summary"]'),suffix=` ${axis==='row'?'rows':'columns'} · level a`;
  await expect(control).toHaveAttribute('title',`Collapse ${axis==='row'?'Calculated summary':'Fat (g) · Carbs (g) · Sugar (g)'}${suffix}`);
  await page.locator(axis==='row'?'td[data-r="3"][data-c="0"]':'td[data-r="0"][data-c="2"]').click();
  await page.locator('#formula').fill('Updated value');await page.locator('#formula').press('Enter');
  const label=axis==='row'?'Updated value':'Fat (g) · Updated value · Sugar (g)';
  await expect(control).toHaveAttribute('title',`Collapse ${label}${suffix}`);const before=await snapshotAfterSave(page);
  await control.click();await expect(control).toHaveAttribute('title',`Expand ${label}${suffix}`);
  await snapshotAfterSave(page);await page.reload();await expect(control).toHaveAttribute('title',`Expand ${label}${suffix}`);
  expect((await snapshotAfterSave(page)).sheets[0].cells).toEqual(before.sheets[0].cells);
});
test('plain row labels refresh after an incremental first-cell edit',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],owner=state.book.tables.find(table=>table.sheet===s.id)!;
      owner.rows=s.rows.slice(1,96).map(row=>row.id);
      s.groups=[{id:'editable-label',axis:'row',kind:'range',members:s.rows.slice(3,5).map(row=>row.id),collapsed:false,label:'Imported outline'}];
      s.cells[`${s.rows[3].id}:${s.columns[0].id}`]={value:'Original first cell'};
      await store.save(state.book,state.version,'Synthetic editable label');
    }finally{store.close();}
  });
  await page.reload();const control=page.locator('.plain-boundary-control[data-group-id="editable-label"]');await expect(control).toHaveAttribute('title','Hide Original first cell');
  await page.locator('td[data-r="3"][data-c="0"]').click();await page.locator('#formula').fill('Updated first cell');await page.locator('#formula').press('Enter');
  await expect(control).toHaveAttribute('title','Hide Updated first cell');await snapshotAfterSave(page);
  await page.reload();await expect(control).toHaveAttribute('title','Hide Updated first cell');
});
for(const axis of ['row','column'] as const)test(`leading hidden ${axis} groups retain a visible header-boundary chooser`,async({page})=>{
  await fixture(page);
  await page.evaluate(async axis=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{
      const state=(await store.load())!,s=state.book.sheets[0],items=axis==='row'?s.rows:s.columns;
      s.groups=[0,2].map((at,i)=>({id:`leading-${i}`,axis,kind:'range',members:items.slice(at,at+2).map(item=>item.id),collapsed:true,label:`Leading ${i}`}));
      await store.save(state.book,state.version,'Synthetic leading boundaries');
    }finally{store.close();}
  },axis);
  await page.reload();const control=page.locator(`.plain-boundary-control[data-plain-axis="${axis}"]`);await expect(control).toHaveCount(1);await expect(control).toBeVisible();
  expect(await control.evaluate((el,axis)=>{
    const box=el.getBoundingClientRect(),header=el.closest('th')!.getBoundingClientRect();
    return{gap:Math.abs(axis==='row'?box.top+box.height/2-header.bottom:box.left+box.width/2-header.left),hit:document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.closest('.plain-boundary-control')===el};
  },axis)).toEqual({gap:0,hit:true});
  if(axis==='column')expect(await control.evaluate(el=>{
    const bounds=el.getBoundingClientRect(),header=el.closest('th')!,move=header.querySelector('.move-control')!.getBoundingClientRect(),index=header.querySelector('.column-index')!.getBoundingClientRect();
    return bounds.top>=move.bottom+1&&bounds.bottom<=index.top-1;
  })).toBe(true);
  await control.click();await expect(page.getByRole('menu',{name:`Choose ${axis} group`}).getByRole('menuitem')).toHaveCount(2);await page.keyboard.press('Escape');
});
test('left chevrons connect nested buttons and keep centered terminal caps through virtual scrolling and edits',async({page})=>{
  await fixture(page);await menu(page);const tree=page.getByRole('switch',{name:'Tree view',exact:true});if(await tree.getAttribute('aria-checked')!=='true')await tree.click();
  await page.keyboard.press('Escape');
  const geometry=await page.locator('.grid').evaluate(table=>{
    const buttons=[...table.querySelectorAll<HTMLElement>('.summary-chevron')];
    const outlined=buttons.every(button=>{const style=getComputedStyle(button);return style.borderLeftStyle==='solid'&&parseFloat(style.borderLeftWidth)>0&&style.borderLeftColor!=='rgba(0, 0, 0, 0)';});
    const leftOfText=buttons.every(button=>{const text=button.closest('td')!.querySelector<HTMLElement>('.cell-display')!;return button.getBoundingClientRect().right<=text.getBoundingClientRect().left+parseFloat(getComputedStyle(text).paddingLeft);});
    const inner=table.querySelector('[data-group-id="inner"].summary-chevron')!.getBoundingClientRect(),branch=table.querySelector('tr[data-row="3"] .row-outline-rail[data-group-id="outer"] .row-outline-branch')!.getBoundingClientRect();
    return {outlined,leftOfText,connection:Math.abs(branch.right-inner.left),counts:buttons.some(b=>b.textContent?.trim()),glyphs:buttons.map(b=>b.querySelector('svg')!.getBoundingClientRect().width)};
  });
  expect(geometry.outlined).toBe(true);expect(geometry.leftOfText).toBe(true);expect(geometry.connection).toBeLessThan(1);expect(geometry.counts).toBe(false);expect(geometry.glyphs.every(n=>n===14)).toBe(true);
  const terminal=page.locator('.grid .row-outline-rail[data-group-id="outer"].outline-end');
  const measure=()=>terminal.evaluate(rail=>{
    const row=rail.closest('tr')!.getBoundingClientRect(),r=rail.getBoundingClientRect(),branch=rail.querySelector('.row-outline-branch')!.getBoundingClientRect();
    return {row:rail.closest('tr')!.dataset.row,center:Math.abs(branch.top-row.top-row.height/2),end:Math.abs(r.bottom-branch.top)};
  });
  expect((await measure()).row).toBe('9');expect((await measure()).center).toBeLessThan(1);expect((await measure()).end).toBeLessThan(1);
  await expect(page.locator('tr[data-row="2"] .row-outline-branch')).toHaveCount(0);
  const padding=await page.locator('td[data-r="3"][data-c="0"] .cell-display').evaluate(el=>getComputedStyle(el).paddingLeft);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=2400;});
  await expect(page.locator('.grid .summary-chevron[data-group-id="outer"]')).toHaveCount(0);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=0;});
  await expect(page.locator('.grid .summary-chevron[data-group-id="outer"]')).toBeVisible();
  expect(await page.locator('td[data-r="3"][data-c="0"] .cell-display').evaluate(el=>getComputedStyle(el).paddingLeft)).toBe(padding);
  expect((await measure()).end).toBeLessThan(1);
  await page.locator('td[data-r="16"][data-c="0"]').click();
  await page.locator('#formula').fill('');await page.locator('#formula').press('Enter');
  await expect(page.locator('.grid .row-outline-rail[data-group-id="separate"].outline-end')).toHaveCount(1);
  expect(await page.locator('.grid .row-outline-rail[data-group-id="separate"].outline-end').evaluate(el=>el.closest('tr')!.dataset.row)).toBe('19');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=0;});
  await page.locator('td[data-r="1"][data-c="0"] .cell-display').click();
  await page.reload();await expect(page.locator('.grid .summary-chevron[data-group-id="outer"]')).toBeVisible();
  expect((await measure()).end).toBeLessThan(1);
});
test('row grips stay centered and column grips stay above letters with grouping buttons beside them',async({page})=>{
  const before=await fixture(page,true);
  await expect(page.locator('td .row-move-control')).toHaveCount(0);
  for(const index of [1,9,12]){
    await page.locator(`[data-row-select="${index}"] .row-index`).click();
    const result=await page.locator(`[data-move-row="${index}"]`).evaluate(button=>{
      const svg=button.querySelector('svg')!.getBoundingClientRect(),row=button.closest('tr')!.getBoundingClientRect(),number=button.closest('tr')!.querySelector('.row-index')!.getBoundingClientRect();
      const overlaps=(a:DOMRect,b:DOMRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      return {center:Math.abs(svg.top+svg.height/2-row.top-row.height/2),numberOverlap:overlaps(svg,number),size:svg.width,header:button.parentElement!.tagName,
        leftOfGroups:[...button.closest('tr')!.querySelectorAll('.group-control')].every(el=>svg.right<=el.getBoundingClientRect().left),
        groupOverlap:[...button.closest('tr')!.querySelectorAll('.group-control')].some(el=>overlaps(svg,el.getBoundingClientRect()))};
    });
    expect(result.center).toBeLessThan(.75);expect(result.numberOverlap).toBe(false);expect(result.groupOverlap).toBe(false);expect(result.size).toBe(14);expect(result.header).toBe('TH');expect(result.leftOfGroups).toBe(true);
  }
  for(const index of [0,2,9]){
    await page.locator(`th[data-col="${index}"] .column-index`).click();
    const result=await page.locator(`[data-move-column="${index}"]`).evaluate(button=>{
      const svg=button.querySelector('svg')!.getBoundingClientRect(),label=button.closest('th')!.querySelector('.column-index')!.getBoundingClientRect();
      return{center:Math.abs(svg.left+svg.width/2-label.left-label.width/2),size:svg.width,aboveLetter:svg.bottom<=label.top,
        groupsBesideLetter:[...button.closest('th')!.querySelectorAll('.group-control')].every(el=>{const r=el.getBoundingClientRect();return r.top>=svg.bottom&&r.bottom<=label.top;}),
        groupOverlap:[...button.closest('th')!.querySelectorAll('.group-control')].some(el=>{const r=el.getBoundingClientRect();return svg.left<r.right&&svg.right>r.left&&svg.top<r.bottom&&svg.bottom>r.top;})};
    });
    expect(result.center).toBeLessThan(.75);expect(result.groupOverlap).toBe(false);expect(result.size).toBe(14);expect(result.aboveLetter).toBe(true);expect(result.groupsBesideLetter).toBe(true);
  }
  const gripPosition=()=>page.locator('[data-move-column="0"]').evaluate(button=>{
    const r=button.getBoundingClientRect(),header=button.closest('th')!.getBoundingClientRect(),label=button.closest('th')!.querySelector('.column-index')!.getBoundingClientRect();
    return{x:r.left+r.width/2-label.left-label.width/2,y:r.top-header.top};
  });
  const position=await gripPosition();
  expect(await page.locator('th[data-col="0"]').evaluate(el=>el.getBoundingClientRect().height)).toBe(68);
  await page.locator('.grid [data-group-id="col-outer"]').click();
  expect(await page.locator('th[data-col="0"]').evaluate(el=>el.getBoundingClientRect().height)).toBe(68);
  expect(await gripPosition()).toEqual(position);
  await expect(page.locator('td .row-move-control')).toHaveCount(0);
  await page.locator('.grid [data-group-id="col-outer"]').click();
  await page.locator('[data-move-column="9"]').click();
  await expect(page.locator('[data-insert-column="10"]')).toHaveAttribute('aria-label','Move columns after J');
  await page.locator('[data-move-column="9"]').click();
  await page.locator('[data-row-select="1"] .row-index').click();
  await page.locator('[data-move-row="1"]').click();
  await expect(page.locator('[data-insert-row="2"]')).toHaveAttribute('aria-label','Move rows after 2');
  await page.locator('[data-move-row="1"]').click();
  await expect(page.locator('[data-insert-row="2"]')).toHaveAttribute('aria-label','Insert row after 2');
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  expect((await snapshot(page)).sheets[0].columns).toEqual(before.sheets[0].columns);
  await page.getByRole('button',{name:'Add sheet',exact:true}).click();
  await page.locator('#ask-form').getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('.toolbar .group-menu-button')).toBeVisible();
  await expect(page.locator('.corner .group-menu-button')).toHaveCount(0);
  expect(await page.locator('.grid col').first().evaluate(el=>el.getBoundingClientRect().width)).toBe(54);
  expect(await page.locator('th[data-col="0"]').evaluate(el=>el.getBoundingClientRect().height)).toBe(35);
  expect(await gripPosition()).toEqual(position);
  await expect(page.locator('td .row-move-control')).toHaveCount(0);
});
test('tree and hint preferences stay sheet-specific across re-renders, saves and reloads',async({page})=>{
  await fixture(page);await menu(page);
  await expect(page.locator('.grid')).toHaveClass(/tree-outline/);
  await expect(page.locator('.row-outline-rail')).not.toHaveCount(0);
  await expect(page.locator('.column-outline-row')).toHaveCount(0);
  await expect(page.locator('.column-summary-rail')).not.toHaveCount(0);
  await menu(page);await page.getByRole('switch',{name:'Plain group hints',exact:true}).click();
  await expect(page.locator('.row-plain-hints,.plain-group-hints')).toHaveCount(0);
  await expect(page.locator('#save-state')).toContainText(/^Saved/);
  await page.keyboard.press('Escape');await expect(page.locator('.group-popover')).toHaveCount(0);await page.getByRole('button',{name:'Notebook',exact:true}).click();await menu(page);
  await expect(page.getByRole('switch',{name:'Plain group hints',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(page.getByRole('switch',{name:'Tree view',exact:true})).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Daily log',exact:true}).click();
  await page.reload();await menu(page);
  await expect(page.getByRole('switch',{name:'Plain group hints',exact:true})).toHaveAttribute('aria-checked','false');
  await expect(page.getByRole('switch',{name:'Tree view',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('switch',{name:'Plain group hints',exact:true}).click();
  await page.locator('.group-popover [data-outline-axis="row"][data-outline-level="0"]').click();
  await expect(page.locator('.grid .group-control[data-group-id="plain-row"]')).toHaveCount(1);
  await page.keyboard.press('Escape');await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=2000;el.scrollLeft=400;});
  await expect(page.locator('tbody tr[data-row]')).not.toHaveCount(0);
  expect(await page.locator('.corner').evaluate(el=>el.getBoundingClientRect().height)).toBe(68);
  await page.locator('#grid-scroll').evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;});
  await expect(page.locator('.grid .group-control[data-group-id="outer"]')).toBeVisible();
});
test('popover is content-sized, single levels omit duplicate controls and icons keep their shared styling',async({page})=>{
  await fixture(page);const popup=await menu(page);
  const large=await popup.evaluate(el=>el.getBoundingClientRect().width);
  const icons=await page.locator('.grid .group-control svg,.group-popover .group-control svg').evaluateAll(elements=>elements.map(el=>({size:el.getBoundingClientRect().width,header:!!el.closest('.grid'),stroke:el.getAttribute('stroke-width'),effect:getComputedStyle(el.querySelector('path')!).vectorEffect})));
  for(const icon of icons){expect(icon.size).toBe(icon.header?14:18);expect(icon.stroke).toBe('1');expect(icon.effect).toBe('non-scaling-stroke');}
  const toggles=page.locator('.group-popover .group-control');
  expect(await toggles.evaluateAll(elements=>elements.every(el=>getComputedStyle(el).backgroundColor==='rgb(255, 255, 255)'))).toBe(true);
  const rect=await popup.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(8);expect(rect!.x+rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width-7);
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!;state.book.sheets[0].groups=state.book.sheets[0].groups.filter(g=>!['inner','leaf','col-inner'].includes(g.id));await store.save(state.book,state.version,'Single level');}finally{store.close();}
  });
  await page.reload();const small=await menu(page);
  await expect(small.locator('.outline-layer-grid strong')).toHaveText(['Rows','Columns']);
  await expect(small.locator('.outline-layer-grid button')).toHaveCount(2);
  expect(await small.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThan(large);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await expect(page.locator('.toolbar .group-menu-button')).toBeVisible();
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await expect(page.getByRole('button',{name:'Select all cells',exact:true})).toBeVisible();
});

  test('a plain group on a summary identity hides its entire group for both rows and columns',async({page})=>{
    const before=await fixture(page);
    for(const [axis,summary,child] of [['row','outer','inner'],['column','col-outer','col-inner']] as const){
      await page.locator(`.grid .group-control[data-group-id="${child}"]`).click();
      await page.locator(axis==='row'?'[data-row-select="1"] .row-index':'th[data-col="0"]').click();
      await page.keyboard.press('Control+Alt+g');await expect(page.locator('#save-state')).toContainText(/^Saved/);
      await expect.poll(async()=>{const group=(await snapshot(page)).sheets[0].groups.at(-1)!;return{axis:group.axis,kind:group.kind,members:group.members.length};}).toEqual({axis,kind:'range',members:1});
      const sheet=(await snapshot(page)).sheets[0],plain=sheet.groups.at(-1)!;
      expect(plain.axis).toBe(axis);expect(plain.kind).toBe('range');expect(plain.members).toHaveLength(1);
      await page.locator(`.grid .group-control[data-group-id="${plain.id}"]`).click();
      await expect(page.locator(axis==='row'?'[data-row-select="1"],[data-row-select="2"],[data-row-select="9"]':'th[data-col="0"],th[data-col="1"],th[data-col="8"]')).toHaveCount(0);
      await expect(page.locator(`.grid .plain-boundary-control[data-plain-axis="${axis}"]`).first()).toBeVisible();
      await expect(page.locator('#save-state')).toContainText(/^Saved/);await page.reload();
      await expect(page.locator(axis==='row'?'[data-row-select="1"]':'th[data-col="0"]')).toHaveCount(0);
      await menu(page);await page.locator(`.group-popover .group-control[data-group-id="${plain.id}"]`).click();await page.keyboard.press('Escape');
      await expect(page.locator(axis==='row'?'[data-row-select="1"]':'th[data-col="0"]')).toHaveCount(1);
      await expect(page.locator(axis==='row'?'[data-row-select="4"]':'th[data-col="2"]')).toHaveCount(0);
      await expect(page.locator('#save-state')).toContainText(/^Saved/);
      const groups=(await snapshot(page)).sheets[0].groups;
      expect(groups.find(g=>g.id===summary)!.collapsed).toBe(false);expect(groups.find(g=>g.id===child)!.collapsed).toBe(true);
    }
    expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
  });

  for(const axis of ['row','column'] as const)test(`inserted and moved ${axis} members join enclosing groups, save and undo together`,async({page})=>{
    const before=await fixture(page),original=before.sheets[0],at=axis==='row'?5:2,sourceId=(axis==='row'?original.rows:original.columns)[axis==='row'?12:9].id;
    const enclosing=axis==='row'?['outer','inner','leaf']:['col-outer','col-inner'];
    const select=async(index:number)=>page.locator(axis==='row'?`[data-row-select="${index}"] .row-index`:`th[data-col="${index}"] .column-index`).click();
    const insert=(boundary:number)=>page.locator(axis==='row'?`[data-insert-row="${boundary}"]`:`[data-insert-column="${boundary}"]`);
    await select(at-1);await insert(at).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
    const added=(await snapshot(page)).sheets[0],insertedId=(axis==='row'?added.rows:added.columns)[at].id;
    for(const id of enclosing)expect(added.groups.find(g=>g.id===id)!.members).toContain(insertedId);
    for(const [address,value]of Object.entries(original.cells))expect(added.cells[address]).toEqual(value);
    await page.reload();const saved=(await snapshot(page)).sheets[0];
    for(const id of enclosing)expect(saved.groups.find(g=>g.id===id)!.members).toContain(insertedId);
    const sourceAt=(axis==='row'?saved.rows:saved.columns).findIndex(item=>item.id===sourceId);
    await select(sourceAt);await page.locator(axis==='row'?`[data-move-row="${sourceAt}"]`:`[data-move-column="${sourceAt}"]`).click();
    await insert(at).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
    const moved=(await snapshot(page)).sheets[0];
    for(const id of enclosing)expect(moved.groups.find(g=>g.id===id)!.members).toContain(sourceId);
    expect(moved.cells).toEqual(saved.cells);
    await page.locator(`.grid .group-control[data-group-id="${enclosing[0]}"]`).click();
    await expect(page.locator(axis==='row'?`[data-row-select="${at}"]`:`th[data-col="${at}"]`)).toHaveCount(0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
    expect((await snapshot(page)).sheets[0].groups).toEqual(saved.groups);
    expect((await snapshot(page)).sheets[0].cells).toEqual(saved.cells);
    if(axis==='column'){
      await select(sourceAt);await page.getByRole('button',{name:'Rows & columns',exact:true}).click();
      await page.getByRole('button',{name:'Move column left',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
      expect((await snapshot(page)).sheets[0].groups.find(g=>g.id==='col-outer')!.members).toContain(sourceId);
      await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#save-state')).toContainText(/^Saved/);
      expect((await snapshot(page)).sheets[0].groups).toEqual(saved.groups);
    }
  });

  test('group manager shows group types, real cell previews and affected coordinates without obscuring the sheet',async({page})=>{
    const before=await fixture(page);
    await page.locator('[data-row-select="1"] .row-index').click();await page.keyboard.press('Control+Alt+g');
    await expect(page.locator('#save-state')).toContainText(/^Saved/);const plain=(await snapshot(page)).sheets[0].groups.at(-1)!;
    await menu(page);await page.getByRole('button',{name:'Manage groups',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'Groups on Daily log',exact:true}),card=panel.locator(`[data-group-card="${plain.id}"]`);
    await expect(panel).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(panel).toContainText('keeps its summary row/column visible');await expect(panel).toContainText('hides all its members');
    await expect(card).toContainText('Plain group');await expect(card).toContainText('Rows 2-10');await expect(card).toContainText('Selected rows 2 includes a summary');
    await expect(card.locator('tbody th')).toHaveText(['2','3','4','10']);
    await expect(panel.locator('[data-group-card="outer"]')).toContainText('Summary row 2 stays visible');
    await card.getByRole('button',{name:'Locate on sheet',exact:true}).click();await expect(page.locator('[data-row-select="1"]')).toHaveClass(/group-located/);
    await card.getByRole('button',{name:'Hide group',exact:true}).click();await expect(card).toContainText('All 9 rows hidden');
    await expect(page.locator('[data-row-select="1"]')).toHaveCount(0);
    await card.getByRole('button',{name:'Show group',exact:true}).click();await expect(page.locator('[data-row-select="1"]')).toHaveCount(1);
    await panel.getByRole('button',{name:'Close group manager',exact:true}).click();await expect(panel).toHaveCount(0);await expect(page.locator('.group-located')).toHaveCount(0);
    await expect(page.locator('#save-state')).toContainText(/^Saved/);
    expect((await snapshot(page)).sheets.map(s=>s.cells)).toEqual(before.sheets.map(s=>s.cells));
    await menu(page);await page.getByRole('button',{name:'Manage groups',exact:true}).click();
    const remove=panel.getByRole('button',{name:'Ungroup',exact:true});
    for(let i=0,count=await remove.count();i<count;i++)await remove.first().click();
    await expect(remove).toHaveCount(0);
    expect((await panel.boundingBox())!.height).toBeLessThan(400);
  });
