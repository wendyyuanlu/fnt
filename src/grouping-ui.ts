import { outlineGroups, outlineLayer, precedingGroupMember,type SummaryRowLayout,type tableGroupProjection } from './grouping';
import {outlineMembers,type Group,type Sheet,type Table} from './model';

interface GroupingHost {
  sheet:Sheet;groups:Group[];grid:HTMLElement;rows:string[];columns:string[];tree:boolean;hints:boolean;
  tables:Table[];
  projection?:ReturnType<typeof tableGroupProjection>;
  rowLayouts:Map<string,SummaryRowLayout>;
  menuOpen:boolean;setMenuOpen:(open:boolean)=>void;
  change:(label:string,fn:()=>void)=>boolean;selectAll:()=>void;manage:()=>void;
  refuse:(message:string)=>void;
  scope?:()=>{enabled:boolean;table?:string};
  menuButton?:HTMLButtonElement;
}
const icon=(path:string)=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const chevrons=(collapsed:boolean,axis:Group['axis'])=>icon(`<g${axis==='column'?' transform="rotate(90 12 12)"':''}><path d="${collapsed?'M5 9l7-7 7 7M5 15l7 7 7-7':'M5 2l7 7 7-7M5 22l7-7 7 7'}"/></g>`);
const eye=(collapsed:boolean)=>icon(`<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${collapsed?'<path d="M3 3l18 18"/>':''}`);
const hierarchy=icon('<path vector-effect="non-scaling-stroke" d="M6 8v8q0 3 3 3h7"/><circle vector-effect="non-scaling-stroke" cx="6" cy="5" r="3"/><circle vector-effect="non-scaling-stroke" cx="19" cy="19" r="3"/>').replace('<svg ','<svg class="toolbar-icon" ');
let rememberedFocus:string|undefined;

export function mountGroupControls(host:GroupingHost):{drawRows:()=>void;positionMenu:()=>void;close:()=>void} {
  if(!host.groups.length&&!host.menuButton){host.setMenuOpen(false);return{drawRows:()=>{},positionMenu:()=>{},close:()=>{}};}
  const {sheet,grid}=host,table=grid.querySelector<HTMLTableElement>('.grid')!,entries=outlineGroups(host.groups),summaries=entries.filter(e=>e.group.kind==='summary'&&!e.group.table);
  const controller=new AbortController(),corner=table.querySelector<HTMLElement>('.corner')!;
  let menu:HTMLDivElement|undefined;
  let menuScrollTop=0,menuScrollLeft=0;
  function button(group:Group,depth:number):HTMLButtonElement {
    const plain=group.kind!=='summary',el=document.createElement('button');
    el.type='button';el.className='group-control';el.dataset.groupId=group.id;
    el.innerHTML=plain?eye(group.collapsed):group.axis==='row'?icon(`<path d="${group.collapsed?'M9 6l6 6-6 6':'M6 9l6 6 6-6'}"/>`):chevrons(group.collapsed,group.axis);
    if(!plain&&group.axis==='column'&&depth>1){const badge=document.createElement('span');badge.className='group-depth';badge.textContent=outlineLayer(depth);badge.setAttribute('aria-hidden','true');el.append(badge);}
    const action=plain?(group.collapsed?'Show':'Hide'):(group.collapsed?'Expand':'Collapse');
    el.setAttribute('aria-label',`${action} ${group.label} ${group.axis==='row'?'rows':'columns'}`);
    el.title=`${el.getAttribute('aria-label')} · ${plain?'plain range':`level ${outlineLayer(depth)}`}`;
    el.setAttribute(plain?'aria-pressed':'aria-expanded',String(!group.collapsed));
    el.onclick=e=>{e.stopPropagation();
      const scope=host.scope?.();if(scope?.enabled&&group.table!==scope.table&&!(group.collapsed&&!scope.table)){host.refuse('This group belongs to another table or sheet scope. Select its table, or turn off Table selection first.');return;}
      host.change('Toggle group',()=>{group.collapsed=!group.collapsed;});
    };
    el.ondblclick=e=>e.stopPropagation();
    return el;
  }
  const menuButton=host.menuButton??document.createElement('button');menuButton.type='button';if(!host.menuButton)menuButton.className='group-control group-menu-button';menuButton.innerHTML=hierarchy;menuButton.setAttribute('aria-label','Group controls');menuButton.setAttribute('aria-expanded',String(host.menuOpen));menuButton.setAttribute('aria-haspopup','true');
  if(!host.menuButton)corner.prepend(menuButton);
  corner.querySelector<HTMLElement>('[data-action="select-all"]')?.remove();
  const header=(id:string)=>table.querySelector<HTMLElement>(`thead [data-col="${sheet.columns.findIndex(c=>c.id===id)}"]`);
  const ranges=entries.filter(e=>e.group.kind!=='summary'&&!e.group.table);
  const rowHints=new Map<string,typeof ranges>();
  if(host.hints)for(const entry of ranges){
    const group=entry.group,at=precedingGroupMember(sheet,group,group.axis==='row'?host.rows:host.columns);
    if(group.axis==='row'){
      const key=at??'';rowHints.set(key,[...rowHints.get(key)??[],entry]);
    }else{
      const el=at?header(at):corner;
      if(el){
        let cluster=el.querySelector<HTMLElement>('.plain-group-hints');
        if(!cluster){cluster=document.createElement('span');cluster.className='plain-group-hints';el.append(cluster);}
        cluster.append(button(group,entry.depth));
      }
    }
  }
  for(const column of sheet.columns.filter(c=>host.columns.includes(c.id))){
    const controls=header(column.id)?.querySelectorAll<HTMLElement>('.group-control');
    controls?.forEach((control,index)=>{
      control.style.right=2+(controls.length-1-index)*26+'px';control.style.top='14px';
    });
  }
  const tableLayouts=new Map(host.tables.filter(owner=>owner.sheet===sheet.id&&entries.some(entry=>entry.group.table===owner.id)).map(owner=>{
    const rowIds=new Set(owner.rows),columnIds=new Set(owner.columns.map(field=>field.column));
    const ownedRows=host.rows.filter(id=>id===owner.header||rowIds.has(id)),ownedColumns=host.columns.filter(id=>columnIds.has(id));
    const shownRows=ownedRows.filter(row=>ownedColumns.some(column=>host.projection?.display(row,column))),shownColumns=ownedColumns.filter(column=>ownedRows.some(row=>host.projection?.display(row,column)));
    return[owner.id,{owner,ownedRows,ownedColumns,shownRows,shownColumns}] as const;
  }));
  function drawRows():void {
    table.querySelectorAll('.row-group-controls,.row-outline-rail,.row-plain-hints,.column-summary-controls,.column-summary-rail,.table-group-controls').forEach(el=>el.remove());
    table.querySelectorAll<HTMLElement>('[data-table-group-inset]').forEach(cell=>{
      cell.style.setProperty('--summary-text-inset',cell.dataset.tableGroupInset!);
      cell.classList.toggle('summary-cell',parseFloat(cell.dataset.tableGroupInset!)>0);delete cell.dataset.tableGroupInset;
    });
    for(const th of table.querySelectorAll<HTMLElement>('tbody [data-row-select]')){
      const id=sheet.rows[Number(th.dataset.rowSelect)].id;
      const parents=summaries.filter(e=>e.group.axis==='row'&&e.group.members[0]===id).sort((a,b)=>a.depth-b.depth);
      const cell=th.parentElement?.querySelector<HTMLElement>('td[data-r]'),layout=host.rowLayouts.get(id);
      const controls=document.createElement('span');controls.className='row-group-controls';
      for(const entry of layout?.buttons??[]){
        const el=button(entry.group,entry.depth);el.classList.add('summary-chevron');
        el.style.left=6+entry.left+'px';
        controls.append(el);
      }
      if(controls.children.length)cell?.append(controls);
      const hints=rowHints.get(id);
      for(const entry of layout?.rails??[]){
        const rail=document.createElement('span');rail.className='row-outline-rail';rail.dataset.groupId=entry.group.id;rail.style.left=entry.left+'px';
        if(entry.start)rail.classList.add('outline-start');
        if(entry.end)rail.classList.add('outline-end');
        if(entry.branch&&(entry.end||cell?.querySelector('.cell-value')?.textContent?.trim())){const branch=document.createElement('span');branch.className='row-outline-branch';branch.style.width=entry.width+'px';rail.append(branch);}
        cell?.append(rail);
      }
      const firstRow=table.querySelector<HTMLElement>(`tbody [data-row-select="${sheet.rows.findIndex(r=>r.id===host.rows[0])}"]`)?.parentElement;
      if(firstRow&&firstRow===th.parentElement)for(const entry of summaries.filter(e=>e.group.axis==='column'&&host.columns.includes(e.group.members[0]))){
        const at=host.columns.indexOf(entry.group.members[0]),cell=firstRow.querySelector<HTMLElement>(`td[data-c="${sheet.columns.findIndex(c=>c.id===entry.group.members[0])}"]`);
        if(!cell)continue;
        let controls=cell.querySelector<HTMLElement>('.column-summary-controls');
        if(!controls){controls=document.createElement('span');controls.className='column-summary-controls';controls.style.left=6+(at===0?host.rowLayouts.get(host.rows[0])?.inset??0:0)+'px';cell.append(controls);}
        controls.append(button(entry.group,entry.depth));
        if(host.tree&&!entry.group.collapsed){
          let end=at;host.columns.forEach((id,i)=>{if(entry.members.has(id))end=Math.max(end,i);});
          for(let i=at;i<=end;i++){
            const target=firstRow.querySelector<HTMLElement>(`td[data-c="${sheet.columns.findIndex(c=>c.id===host.columns[i])}"]`);
            const rail=document.createElement('span');rail.className='column-summary-rail';rail.style.bottom=3+(entry.depth-1)*3+'px';
            if(i===at)rail.style.left='18px';if(i===end)rail.style.right='50%';target?.append(rail);
          }
        }
      }
      if(!hints)continue;
      const cluster=document.createElement('span');cluster.className='row-plain-hints';
      hints.forEach(e=>cluster.append(button(e.group,e.depth)));
      if(!parents.length&&hints.length===1)th.append(cluster);
      else{
        const cell=th.parentElement?.querySelector<HTMLElement>('td[data-r]');
        if(cell){cell.classList.add('plain-hint-host');cell.style.setProperty('--plain-hint-width',hints.length*26+'px');cell.append(cluster);}
      }
    }
    if(!host.rows.length&&rowHints.has('')){
      const cluster=document.createElement('span');cluster.className='row-plain-hints';
      rowHints.get('')!.forEach(e=>cluster.append(button(e.group,e.depth)));corner.append(cluster);
    }
    for(const entry of entries.filter(e=>e.group.table&&(e.group.kind==='summary'||host.hints))){
      const layout=tableLayouts.get(entry.group.table!);if(!layout)continue;
      const {owner,ownedRows,ownedColumns,shownRows,shownColumns}=layout;
      const anchor=entry.group.kind==='summary'?entry.group.members[0]:precedingGroupMember(sheet,entry.group,entry.group.axis==='row'?shownRows:shownColumns);
      const row=entry.group.axis==='row'?anchor:owner.header,column=entry.group.axis==='column'?anchor:ownedColumns[0];
      const cell=table.querySelector<HTMLElement>(`td[data-r="${sheet.rows.findIndex(r=>r.id===row)}"][data-c="${sheet.columns.findIndex(c=>c.id===column)}"]`)
        ??(entry.group.kind!=='summary'?table.querySelector<HTMLElement>(`td[data-display-r="${sheet.rows.findIndex(r=>r.id===(row??ownedRows[0]))}"][data-display-c="${sheet.columns.findIndex(c=>c.id===(column??ownedColumns[0]))}"]`):null);
      if(!cell)continue;
      cell.removeAttribute('aria-hidden');
      let controls=cell.querySelector<HTMLElement>('.table-group-controls');
      if(!controls){controls=document.createElement('span');controls.className='table-group-controls';cell.append(controls);cell.dataset.tableGroupInset=cell.style.getPropertyValue('--summary-text-inset')||'0px';}
      const control=button(entry.group,entry.depth);
      control.setAttribute('aria-label',`${control.getAttribute('aria-label')} in ${owner.name}`);
      controls.append(control);cell.classList.add('summary-cell');
      cell.style.setProperty('--summary-text-inset',(parseFloat(cell.dataset.tableGroupInset!)+controls.children.length*26)+'px');
    }
  }
  function closeMenu(focus=false):void {
    menu?.remove();menu=undefined;host.setMenuOpen(false);menuButton.setAttribute('aria-expanded','false');
    if(focus)menuButton.focus({preventScroll:true});
  }
  function positionMenu():void{
    if(!menu)return;
    const rect=menuButton.getBoundingClientRect(),size=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-size.width-8))+'px';menu.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-size.height-8))+'px';
    menuScrollTop=grid.scrollTop;menuScrollLeft=grid.scrollLeft;
  }
  function openMenu():HTMLDivElement {
    menu?.remove();host.setMenuOpen(true);menuButton.setAttribute('aria-expanded','true');
    menu=document.createElement('div');menu.className='group-popover';menu.setAttribute('role','group');menu.setAttribute('aria-label','Group controls menu');
    if('showPopover'in menu)menu.setAttribute('popover','manual');
    const switchLine=(name:string,value:boolean,property:'tree'|'plainGroupHints')=>{
      const line=document.createElement('div');line.className='outline-switch-line';
      const label=document.createElement('span');label.textContent=name;
      const toggle=document.createElement('button');toggle.type='button';toggle.className='outline-switch';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',name);toggle.setAttribute('aria-checked',String(value));
      toggle.onclick=()=>host.change(`Change ${name}`,()=>{sheet.outlineView={...sheet.outlineView,[property]:!value};});
      line.append(label,toggle);return line;
    };
    menu.append(switchLine('Tree view',host.tree,'tree'));
    const scope=host.scope?.(),menuEntries=entries.filter(entry=>!scope?.enabled||entry.group.table===scope.table);
    const depth=Math.max(1,...menuEntries.filter(e=>e.group.kind==='summary').map(e=>e.depth)),matrix=document.createElement('div');matrix.className='outline-layer-grid';
    matrix.style.gridTemplateColumns=`50px repeat(${depth===1?1:depth+1},32px)`;
    if(depth>1){matrix.append(document.createElement('span'));for(const text of ['All',...Array.from({length:depth},(_,i)=>outlineLayer(i+1))]){const heading=document.createElement('strong');heading.textContent=text;matrix.append(heading);}}
    for(const axis of ['row','column'] as const){
      const hidden=(owner?:string)=>new Set(host.groups.filter(g=>g.table===owner&&g.axis===axis&&g.collapsed).flatMap(g=>outlineMembers(g,sheet.groups)));
      const label=document.createElement('strong');label.textContent=axis==='row'?'Rows':'Columns';label.className='outline-axis-label';matrix.append(label);
      for(const level of depth===1?[0]:[0,...Array.from({length:depth},(_,i)=>i+1)]){
        const targets=menuEntries.filter(e=>e.group.axis===axis&&(!level||e.group.kind==='summary'&&e.depth===level));
        const collapsed=targets.length>0&&targets.every(e=>e.group.collapsed||!level&&[...e.members].every(id=>hidden(e.group.table).has(id)));
        const el=document.createElement('button');el.type='button';el.className='group-control';el.innerHTML=chevrons(collapsed,axis);el.disabled=!targets.length;
        el.dataset.outlineAxis=axis;el.dataset.outlineLevel=String(level);el.setAttribute('aria-pressed',String(collapsed));el.setAttribute('aria-label',`${collapsed?'Expand':'Collapse'} ${level?'level '+outlineLayer(level):'all'} ${axis==='row'?'rows':'columns'}`);
        el.onclick=()=>host.change('Toggle outline level',()=>targets.forEach(e=>{e.group.collapsed=!collapsed;}));matrix.append(el);
      }
    }
    menu.append(matrix);
    const plain=document.createElement('div');plain.className='outline-plain-groups';plain.append(switchLine('Plain group hints',host.hints,'plainGroupHints'));
    for(const axis of ['row','column'] as const){
      const section=document.createElement('div');section.className='outline-plain-axis';const heading=document.createElement('strong');heading.textContent=axis==='row'?'Rows':'Columns';section.append(heading);
      for(const entry of menuEntries.filter(e=>e.group.kind!=='summary'&&e.group.axis===axis)){const line=document.createElement('div');line.className='outline-plain-line';const label=document.createElement('span');const owner=host.tables.find(t=>t.id===entry.group.table);label.textContent=entry.group.label+(owner?` (${owner.name})`:'');line.append(label,button(entry.group,entry.depth));section.append(line);}
      plain.append(section);
    }
    menu.append(plain);
    const actions=document.createElement('div');actions.className='outline-menu-actions';
    for(const [name,fn] of [['Select all cells',host.selectAll],['Manage groups',host.manage]] as const){const el=document.createElement('button');el.type='button';el.textContent=name;el.onclick=()=>{closeMenu();fn();};actions.append(el);}
    menu.append(actions);document.body.append(menu);if('showPopover'in menu)menu.showPopover();
    positionMenu();
    menu.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenu(true);}else e.stopPropagation();});
    return menu;
  }
  menuButton.onclick=e=>{e.stopPropagation();if(menu)closeMenu();else openMenu().querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});};
  document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target as Node)&&!menuButton.contains(e.target as Node))closeMenu();},{capture:true,signal:controller.signal});
  document.addEventListener('keydown',e=>{if(menu&&e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenu(true);}},{capture:true,signal:controller.signal});
  window.addEventListener('resize',()=>{if(menu)openMenu();},{signal:controller.signal});
  grid.addEventListener('scroll',()=>{if(menu&&(grid.scrollTop!==menuScrollTop||grid.scrollLeft!==menuScrollLeft))closeMenu();},{signal:controller.signal});
  if(host.menuOpen){const popup=openMenu();if(rememberedFocus)popup.querySelector<HTMLButtonElement>(rememberedFocus)?.focus({preventScroll:true});}
  return {drawRows,positionMenu,close:()=>{
    const active=document.activeElement instanceof HTMLButtonElement&&menu?.contains(document.activeElement)?document.activeElement:undefined;
    rememberedFocus=active?.dataset.outlineAxis?`[data-outline-axis="${active.dataset.outlineAxis}"][data-outline-level="${active.dataset.outlineLevel}"]`
      :active?.dataset.groupId?`[data-group-id="${active.dataset.groupId}"]`
      :active?.getAttribute('role')==='switch'?`[role="switch"][aria-label="${active.getAttribute('aria-label')}"]`:undefined;
    menu?.remove();controller.abort();
  }};
}
