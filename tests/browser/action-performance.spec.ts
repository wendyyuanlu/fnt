import {expect,test,type Page} from '@playwright/test';

async function meals(page:Page):Promise<void>{
  await page.goto('/');await expect(page.locator('.grid')).toBeVisible();
  await page.evaluate(async()=>{
    const storage='/src/storage.ts',published='/src/published.ts';
    const {Store}=await import(/* @vite-ignore */storage),{loadPublishedTesting}=await import(/* @vite-ignore */published),store=await Store.open();
    try{const state=await store.load(),snapshot=await loadPublishedTesting();await store.save(snapshot.book,state.version,'Disposable action fixture');}finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Meals',exact:true}).click();
}
async function manager(page:Page):Promise<void>{
  await page.getByRole('button',{name:'Group controls',exact:true}).click();
  await page.getByRole('button',{name:'Manage groups',exact:true}).click();
}

test('group manager browses all cards lazily, saves scoped groups, and retains Undo after reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await meals(page);
  await page.locator('[data-action="range"]').click();await page.locator('#answer').fill('A1:A2');await page.locator('#answer').press('Enter');
  await manager(page);
  const cards=page.locator('[data-group-card]'),list=page.locator('.group-card-list'),initial=await cards.count();
  expect(initial).toBe(274);await expect(cards.first().locator('.group-cell-preview')).toBeVisible();
  expect(await page.locator('[data-group-card] .group-cell-preview').count()).toBeLessThan(25);
  const lazyId=await page.locator('[data-group-card][data-lazy="true"]').first().getAttribute('data-group-card'),lazy=page.locator(`[data-group-card="${lazyId}"]`);await lazy.focus();
  await expect(lazy.locator('[data-toggle]')).toBeVisible();
  await list.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await expect(cards.last().locator('[data-toggle]')).toBeVisible();
  await page.locator('[data-create-kind="range"][data-create-axis="row"]').click();
  await expect(cards).toHaveCount(initial+1);
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  await manager(page);await expect(cards).toHaveCount(initial+1);
  await page.getByRole('button',{name:'Close group manager'}).click();
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
  await manager(page);await expect(cards).toHaveCount(initial);
  expect(errors).toEqual([]);
});

test('Find cancels obsolete scans and every one-character match remains browsable without expanding groups',async({page})=>{
  await meals(page);await page.locator('[data-action="find"]').click();
  const input=page.locator('#find-text'),count=page.locator('#find-count');
  await input.fill('a');await input.fill('apple');
  await expect(count).toHaveText('Results found (60)');
  await input.fill('a');await expect(count).toHaveText(/Results found \(\d+\)/);
  const total=Number((await count.innerText()).match(/\d+/)![0]);expect(total).toBe(9962);
  await page.evaluate(()=>{const next=document.querySelector<HTMLButtonElement>('#find-next-page')!;while(!next.disabled)next.click();});
  const last=page.locator(`[data-find-match="${total-1}"]`);
  expect(await last.getAttribute('data-find-match')).toBe(String(total-1));
  await last.click();
  await expect(page.locator('.grid td.active')).toBeVisible();
  await expect(page.locator('.grid td.active')).toContainText(/a/i);
});

test('complete Save reports success only after its recovery transaction commits',async({page})=>{
  await meals(page);
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args:Parameters<typeof put>){
      const result=put.apply(this,args);
      if(this.name==='history'&&(args[0] as {label?:string}).label==='Manual save'){
        const deadline=performance.now()+600,transaction=this.transaction;
        document.documentElement.dataset.checkpointPending='true';
        const keepAlive=()=>{
          if(performance.now()<deadline)this.get('disposable-save-test').onsuccess=keepAlive;
        };
        keepAlive();
        transaction.addEventListener('complete',()=>{document.documentElement.dataset.checkpointPending='false';});
      }
      return result;
    };
  });
  await page.locator('[data-action="save"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-checkpoint-pending','true');
  await expect(page.locator('#save-state')).not.toContainText('Saved');
  await expect(page.locator('html')).toHaveAttribute('data-checkpoint-pending','false');
  await expect(page.locator('#save-state')).toHaveText('Saved locally + recovery checkpoint');
  await page.reload();await expect(page.locator('.grid')).toBeVisible();
});

test('large dropdown options preserve End, Home, paging and selection',async({page})=>{
  await page.goto('/');await expect(page.locator('.grid')).toBeVisible();
  await page.evaluate(async()=>{
    const path='/src/dropdown-ui.ts',{mountDropdownOptions,dropdownOptionsKey}=await import(/* @vite-ignore */path);
    const panel=document.createElement('div');panel.id='isolated-options';panel.style.cssText='position:fixed;inset:20px;z-index:200;background:white;display:flex;flex-direction:column';document.body.append(panel);
    const {search,list}=mountDropdownOptions(panel,{choices:Array.from({length:1000},(_,i)=>i),value:(i:number)=>`Option ${i}`,selected:()=>false,choose:(i:number)=>panel.dataset.chosen=String(i),name:'Isolated',position:()=>{}});
    panel.onkeydown=e=>dropdownOptionsKey(e,search,list);search.focus();
  });

  const panel=page.locator('#isolated-options');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('End');
  await expect(panel.locator('[role=option]:focus')).toHaveText('Option 999');
  expect(await panel.locator('[role=option]').count()).toBeLessThanOrEqual(80);
  await page.keyboard.press('Home');await expect(panel.locator('[role=option]:focus')).toHaveText('Option 0');
  await page.getByRole('button',{name:'Next dropdown options'}).click();
  await panel.locator('[role=option]').first().click();await expect(panel).toHaveAttribute('data-chosen','80');
  await panel.getByRole('searchbox').fill('999');await panel.locator('[role=option]').click();await expect(panel).toHaveAttribute('data-chosen','999');
});

test('public-sized tiny-table duplication saves only changed cells and retains structural Undo after reload',async({page})=>{
  await meals(page);await page.getByRole('button',{name:'Daily log',exact:true}).click();
  await page.getByRole('button',{name:'Table-constrained header selection',exact:true}).click();
  await page.locator('[data-row-select="1"]').click();await page.locator('[data-action="structure"]').click();
  await page.getByRole('button',{name:'Duplicate selected rows',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Saved');
  const result=await page.evaluate(async()=>{
    const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();
    try{const state=(await store.load())!,history=await store.undoHistory(state.version,state.book.id),entry=history?.undo.at(-1);if(!entry)throw Error('Saved structural Undo is missing.');return{rows:state.book.tables.find(t=>t.name==='DailyLog')!.rows.length,changes:'patch'in entry?entry.patch.length:'cells'in entry?entry.cells.length:Infinity};}finally{store.close();}
  });
  expect(result.rows).toBe(3);expect(result.changes).toBeLessThan(500);
  await page.reload();await expect(page.locator('.grid')).toBeVisible();await page.locator('[data-action="undo"]').click();
  await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();
  const rows=await page.evaluate(async()=>{const path='/src/storage.ts',{Store}=await import(/* @vite-ignore */path) as typeof import('../../src/storage'),store=await Store.open();try{return(await store.load())!.book.tables.find(t=>t.name==='DailyLog')!.rows.length;}finally{store.close();}});
  expect(rows).toBe(2);
});

test('scoped title changes repaint the heading and persist with Undo',async({page})=>{
  await page.goto('/');await expect(page.locator('#title')).toBeVisible();
  const before=await page.locator('#title').innerText();
  await page.locator('#title').click();await page.locator('#answer').fill('Scoped workbook title');await page.locator('#answer').press('Enter');
  await expect(page.locator('#title')).toHaveText('Scoped workbook title');
  await expect(page.locator('#save-state')).toContainText('Saved');
  await page.reload();await expect(page.locator('#title')).toHaveText('Scoped workbook title');
  await page.locator('[data-action="undo"]').click();await expect(page.locator('#title')).toHaveText(before);
});

test('paged DD choices retain explicit source identity for duplicate labels and Custom through search, Undo and reload',async({page})=>{
  await page.goto('/');await expect(page.locator('.grid')).toBeVisible();
  const sources=await page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{allTables}=await import(p+'model.ts') as typeof import('../../src/model'),{addReferenceValue,referenceLabel}=await import(p+'references.ts') as typeof import('../../src/references'),store=await Store.open();
    try{
      const state=(await store.load())!,book=state.book,result=[];
      for(const name of ['Country','Category']){
        const source=book.references!.find(source=>referenceLabel(source)===name&&source.group==='Snack');
        if(!source)throw Error(`Missing synthetic ${name} dropdown source.`);
        for(let i=0;i<85;i++)addReferenceValue(book,source,`${name} synthetic ${i}`);
        const row=addReferenceValue(book,source,'Shared food'),table=allTables(book).find(table=>table.id===source.table)!;
        result.push({table:table.id,row,column:source.column!});
      }
      await store.save(book,state.version,'Synthetic duplicate DD labels');return result;
    }finally{store.close();}
  });
  await page.reload();await page.getByRole('button',{name:'Notebook',exact:true}).click();
  const cell=page.locator('td[data-r="2"][data-c="2"]');
  await cell.click();await page.locator('[data-action="dropdown-source"]').click();await page.getByRole('button',{name:'List view',exact:true}).click();
  await page.getByRole('checkbox',{name:'Snack / Country',exact:true}).check();await page.getByRole('checkbox',{name:'Snack / Category',exact:true}).check();await page.getByRole('button',{name:'Apply dropdown',exact:true}).click();
  const binding=async()=>page.evaluate(async()=>{
    const p='/src/',{Store}=await import(p+'storage.ts') as typeof import('../../src/storage'),{key}=await import(p+'model.ts') as typeof import('../../src/model'),store=await Store.open();
    try{const book=(await store.load())!.book,s=book.sheets.find(s=>s.name==='Notebook')!;return s.cells[key(s.rows[2].id,s.columns[2].id)].binding;}finally{store.close();}
  });
  await cell.click();await page.getByRole('button',{name:'Next dropdown options',exact:true}).click();await page.getByRole('option',{name:'Shared food',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Saved');expect(await binding()).toEqual(sources[0]);
  await cell.click();await page.getByRole('tab',{name:'Snack / Category',exact:true}).click();await page.getByRole('searchbox',{name:'Search dropdown options'}).fill('Shared food');await page.getByRole('option',{name:'Shared food',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Saved');expect(await binding()).toEqual(sources[1]);
  await page.locator('[data-action="undo"]').click();await expect(page.locator('#save-state')).toContainText('Saved');expect(await binding()).toEqual(sources[0]);
  await page.locator('[data-action="redo"]').click();await expect(page.locator('#save-state')).toContainText('Saved');expect(await binding()).toEqual(sources[1]);
  await cell.click();await page.getByRole('button',{name:'Custom',exact:true}).click();await page.getByRole('textbox',{name:'Edit selected cell',exact:true}).fill('Shared food');await page.keyboard.press('Enter');
  await expect(cell).not.toHaveClass(/linked/);await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();
  await expect(cell).toHaveText('Shared food');expect(await binding()).toBeUndefined();
  await page.locator('[data-action="undo"]').click();await expect(page.locator('#save-state')).toContainText('Saved');await page.reload();
  await expect(cell).toHaveClass(/linked/);expect(await binding()).toEqual(sources[1]);
});

test('touch group actions retain real pointer coordinates',async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:5388/',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage();await meals(page);
    await page.getByRole('button',{name:'Group controls',exact:true}).tap();
    await page.getByRole('button',{name:'Manage groups',exact:true}).tap();
    await expect(page.locator('[data-group-card]').first().locator('[data-toggle]')).toBeVisible();
    await page.locator('[data-group-card]').first().locator('[data-toggle]').tap();
    await expect(page.locator('#save-state')).toContainText('Saved');
    await page.getByRole('button',{name:'Close group manager'}).tap();
    const cell=page.locator('.grid td[data-r][data-c]').first();await cell.tap();
    const r=await cell.getAttribute('data-r'),c=await cell.getAttribute('data-c');
    await expect(page.locator('.grid td.active')).toHaveAttribute('data-r',r!);await expect(page.locator('.grid td.active')).toHaveAttribute('data-c',c!);
  }finally{await context.close();}
});
