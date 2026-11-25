import { outlineGroups, outlineLayer, precedingGroupMember,type SummaryRowLayout,type tableGroupProjection } from './grouping';
import {outlineMembers,type Group,type Sheet,type Table} from './model';

interface GroupingHost {
  sheet:Sheet;groups:Group[];grid:HTMLElement;rows:string[];columns:string[];tree:boolean;hints:boolean;
  tables:Table[];
  projection?:ReturnType<typeof tableGroupProjection>;
  rowLayouts:Map<string,SummaryRowLayout>;
  tableRowLayouts:Map<string,{column:string;rows:Map<string,SummaryRowLayout>}>;
  menuOpen:boolean;setMenuOpen:(open:boolean)=>void;
  change:(label:string,fn:()=>void,scope:{groups?:Group[];view?:boolean})=>boolean;selectAll:()=>void;manage:()=>void;
  refuse:(message:string)=>void;
  value:(row:string,column:string)=>string;
  scope?:()=>{enabled:boolean;table?:string};
  menuButton?:HTMLButtonElement;
}
const icon=(path:string)=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const chevrons=(collapsed:boolean,axis:Group['axis'])=>icon(`<g${axis==='column'?' transform="rotate(90 12 12)"':''}><path d="${collapsed?'M5 9l7-7 7 7M5 15l7 7 7-7':'M5 2l7 7 7-7M5 22l7-7 7 7'}"/></g>`);
const eye=(collapsed:boolean)=>icon(`<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${collapsed?'<path d="M3 3l18 18"/>':''}`);
const hierarchy=icon('<path vector-effect="non-scaling-stroke" d="M6 8v8q0 3 3 3h7"/><circle vector-effect="non-scaling-stroke" cx="6" cy="5" r="3"/><circle vector-effect="non-scaling-stroke" cx="19" cy="19" r="3"/>').replace('<svg ','<svg class="toolbar-icon" ');
let rememberedFocus:string|undefined;

export function firstLineControlTop(container:HTMLElement,value:HTMLElement,height=24):number{
  const text=document.createTreeWalker(value,NodeFilter.SHOW_TEXT).nextNode(),bounds=container.getBoundingClientRect();
  if(text){
    const range=document.createRange();range.selectNodeContents(text);
    const first=[...range.getClientRects()].find(rect=>rect.height>0);
    if(first)return first.top+first.height/2-bounds.top-height/2;
  }
  const display=value.closest<HTMLElement>('.cell-display')??value,style=getComputedStyle(display);
  const lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.2;
  return display.getBoundingClientRect().top+parseFloat(style.paddingTop)+lineHeight/2-bounds.top-height/2;
}

export function mountGroupControls(host:GroupingHost):{drawRows:()=>void;positionMenu:()=>void;masterControl:(column:string)=>HTMLButtonElement|undefined;close:()=>void} {
  if(!host.groups.length&&!host.menuButton){host.setMenuOpen(false);return{drawRows:()=>{},positionMenu:()=>{},masterControl:()=>undefined,close:()=>{}};}
  const {sheet,grid}=host,table=grid.querySelector<HTMLTableElement>('.grid')!,entries=outlineGroups(host.groups),summaries=entries.filter(e=>e.group.kind==='summary'&&!e.group.table);
  const controller=new AbortController(),corner=table.querySelector<HTMLElement>('.corner')!;
  let menu:HTMLDivElement|undefined;
  let boundaryMenu:{element:HTMLDivElement;trigger:HTMLButtonElement}|undefined;
  let menuScrollTop=0,menuScrollLeft=0;
  function button(group:Group,depth:number):HTMLButtonElement {
    const plain=group.kind!=='summary',el=document.createElement('button');
    el.type='button';el.className='group-control';el.dataset.groupId=group.id;
    el.innerHTML=plain?eye(group.collapsed):group.axis==='row'?icon(`<path d="${group.collapsed?'M9 6l6 6-6 6':'M6 9l6 6 6-6'}"/>`):chevrons(group.collapsed,group.axis);
    if(!plain&&group.axis==='column'&&depth>1){const badge=document.createElement('span');badge.className='group-depth';badge.textContent=outlineLayer(depth);badge.setAttribute('aria-hidden','true');el.append(badge);}
    const action=plain?(group.collapsed?'Show':'Hide'):(group.collapsed?'Expand':'Collapse');
    el.setAttribute('aria-label',`${action} ${groupValueLabel(group)}${plain?'':` ${group.axis==='row'?'rows':'columns'}`}`);
    el.title=`${el.getAttribute('aria-label')}${plain?'':` · level ${outlineLayer(depth)}`}`;
    el.setAttribute(plain?'aria-pressed':'aria-expanded',String(!group.collapsed));
    el.onclick=e=>{e.stopPropagation();
      const scope=host.scope?.();if(scope?.enabled&&scope.table!==undefined&&group.table!==scope.table){host.refuse('This group belongs to another table or sheet scope. Select its table, or turn off Table selection first.');return;}
      host.change('Toggle group',()=>{group.collapsed=!group.collapsed;},{groups:[group]});
    };
    el.ondblclick=e=>e.stopPropagation();
    return el;
  }
  const menuButton=host.menuButton??document.createElement('button');menuButton.type='button';if(!host.menuButton)menuButton.className='group-control group-menu-button';menuButton.innerHTML=hierarchy;menuButton.setAttribute('aria-label','Group controls');menuButton.setAttribute('aria-expanded',String(host.menuOpen));menuButton.setAttribute('aria-haspopup','true');
  if(!host.menuButton)corner.prepend(menuButton);
  corner.querySelector<HTMLElement>('[data-action="select-all"]')?.remove();
  const header=(id:string)=>table.querySelector<HTMLElement>(`thead [data-col="${sheet.columns.findIndex(c=>c.id===id)}"]`);
  const valueLabels=new Map<Group,string>();
  function groupValueLabel(group:Group):string{
    const cached=valueLabels.get(group);if(cached!==undefined)return cached;
    const owner=host.tables.find(table=>table.id===group.table);
    const row=group.axis==='row'?(group.kind==='summary'?group.members[0]:sheet.rows.find(item=>group.members.includes(item.id))?.id):owner?.header??sheet.rows[0]?.id;
    const column=owner?sheet.columns.find(column=>owner.columns.some(field=>field.column===column.id))?.id:sheet.columns[0]?.id;
    const values=group.axis==='row'?[row&&column?host.value(row,column):'']:sheet.columns.filter(column=>group.members.includes(column.id)).map(member=>row?host.value(row,member.id):'');
    const label=values.map(value=>value.trim()||'(blank)').join(' · ');
    valueLabels.set(group,label);return label;
  }
  const tableLayouts=new Map(host.tables.filter(owner=>owner.sheet===sheet.id&&entries.some(entry=>entry.group.table===owner.id)).map(owner=>{
    const rowIds=new Set(owner.rows),columnIds=new Set(owner.columns.map(field=>field.column));
    const ownedRows=host.rows.filter(id=>id===owner.header||rowIds.has(id)),ownedColumns=host.columns.filter(id=>columnIds.has(id));
    const shownRows=ownedRows.filter(row=>ownedColumns.some(column=>host.projection?.display(row,column))),shownColumns=ownedColumns.filter(column=>ownedRows.some(row=>host.projection?.display(row,column)));
    return[owner.id,{owner,ownedRows,ownedColumns,shownRows,shownColumns}] as const;
  }));
  type Boundary={axis:Group['axis'];anchor?:string;start:boolean;entries:typeof entries};
  const boundaries=new Map<string,Boundary>();
  if(host.hints)for(const entry of entries.filter(entry=>entry.group.kind!=='summary')){
    const {group}=entry,layout=group.table?tableLayouts.get(group.table):undefined;
    if(group.table&&!layout)continue;
    const visible=layout?(group.axis==='row'?layout.shownRows:layout.shownColumns):(group.axis==='row'?host.rows:host.columns);
    const axis=group.axis==='row'?sheet.rows:sheet.columns,at=precedingGroupMember(sheet,group,visible);
    const first=axis.findIndex(item=>entry.members.has(item.id)),start=!at||axis.findIndex(item=>item.id===at)>=first;
    let anchor=at;
    if(layout){
      const sourceRow=group.axis==='row'?at??layout.owner.header:layout.owner.header;
      const sourceColumn=group.axis==='column'?at??layout.ownedColumns[0]:layout.shownColumns[0]??layout.ownedColumns[0];
      const display=sourceColumn?host.projection?.display(sourceRow,sourceColumn):undefined;
      anchor=(group.axis==='row'?display?.row:display?.column)??at;
    }
    const key=`${group.axis}:${anchor??''}:${start}`;
    const boundary=boundaries.get(key);
    if(boundary)boundary.entries.push(entry);else boundaries.set(key,{axis:group.axis,anchor,start,entries:[entry]});
  }
  function closeBoundaryMenu(focus=false):void{
    const previous=boundaryMenu;if(!previous)return;
    boundaryMenu=undefined;previous.element.remove();previous.trigger.setAttribute('aria-expanded','false');
    if(focus&&previous.trigger.isConnected)previous.trigger.focus({preventScroll:true});
  }
  function boundaryControl(boundary:Boundary):HTMLButtonElement{
    const targets=boundary.entries,collapsed=targets.every(entry=>entry.group.collapsed);
    const control=targets.length===1?button(targets[0].group,targets[0].depth):document.createElement('button');
    control.type='button';control.classList.add('group-control','plain-boundary-control');control.dataset.plainAxis=boundary.axis;
    if(targets.length===1)return control;
    control.innerHTML=eye(collapsed);control.setAttribute('aria-haspopup','menu');control.setAttribute('aria-expanded','false');
    control.setAttribute('aria-label',`Choose ${boundary.axis==='row'?'rows':'columns'}: ${targets.map(entry=>groupValueLabel(entry.group)).join(' · ')}`);
    control.title=control.getAttribute('aria-label')!;
    control.onclick=e=>{
      e.stopPropagation();
      if(boundaryMenu?.trigger===control){closeBoundaryMenu();return;}
      closeBoundaryMenu();closeMenu();
      const popup=document.createElement('div');popup.className='group-popover cell-dropdown-options plain-boundary-menu';
      popup.setAttribute('role','menu');popup.setAttribute('aria-label',`Choose ${boundary.axis==='row'?'row':'column'} group`);
      if('showPopover'in popup)popup.setAttribute('popover','manual');
      for(const entry of targets){
        const choice=button(entry.group,entry.depth),items=boundary.axis==='row'?sheet.rows:sheet.columns;
        choice.className='plain-boundary-choice';
        const positions=items.flatMap((item,i)=>entry.members.has(item.id)?[i+1]:[]),owner=host.tables.find(table=>table.id===entry.group.table);
        choice.textContent=`${choice.getAttribute('aria-label')} · ${boundary.axis==='row'?'rows':'columns'} ${positions[0]}–${positions.at(-1)}${owner?` · ${owner.name}`:''}`;
        choice.setAttribute('role','menuitem');choice.setAttribute('aria-label',choice.textContent);
        choice.addEventListener('click',()=>closeBoundaryMenu(),{capture:true});popup.append(choice);
      }
      document.body.append(popup);if('showPopover'in popup)popup.showPopover();
      boundaryMenu={element:popup,trigger:control};control.setAttribute('aria-expanded','true');
      const rect=control.getBoundingClientRect(),size=popup.getBoundingClientRect();
      popup.style.left=Math.max(8,Math.min(rect.left,innerWidth-size.width-8))+'px';popup.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-size.height-8))+'px';
      popup.addEventListener('keydown',event=>{
        event.stopPropagation();const options=[...popup.querySelectorAll<HTMLButtonElement>('button')],index=options.findIndex(option=>option===document.activeElement);
        if(event.key==='Escape'){event.preventDefault();closeBoundaryMenu(true);}
        else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
          event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
          options[next]?.focus({preventScroll:true});
        }else if(event.key==='Tab')closeBoundaryMenu();
      });
      popup.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    };
    control.ondblclick=e=>e.stopPropagation();return control;
  }
  function drawBoundary(boundary:Boundary,element:HTMLElement):void{
    const cluster=document.createElement('span');cluster.className=boundary.axis==='row'?'row-plain-hints':'plain-group-hints';
    if(boundary.start&&element!==corner)cluster.classList.add('plain-boundary-start');
    // Paint the boundary control over the following row header.
    if(boundary.axis==='row'&&element.dataset.rowSelect!==undefined){const layer=String(sheet.rows.length-Number(element.dataset.rowSelect)+4);element.style.zIndex=layer;element.style.setProperty('--outline-header-z',layer);}
    cluster.append(boundaryControl(boundary));element.append(cluster);
  }
  function masterChevron():HTMLButtonElement {
    const el=document.createElement('button');el.type='button';el.className='group-control master-chevron';
    const targets=()=>{
      const scope=host.scope?.();
      return entries.filter(entry=>entry.group.kind==='summary'&&(!scope?.enabled||entry.group.table===scope.table)).map(entry=>entry.group);
    };
    const groups=targets(),collapsed=groups.length>0&&groups.every(group=>group.collapsed),scope=host.scope?.(),owner=scope?.enabled&&host.tables.find(table=>table.id===scope.table);
    el.disabled=!groups.length;
    el.innerHTML=icon(`<path d="${collapsed?'M9 6l6 6-6 6':'M6 9l6 6 6-6'}"/>`);
    el.setAttribute('aria-expanded',String(!collapsed));
    el.setAttribute('aria-label',`${collapsed?'Expand':'Collapse'} all summary groups${owner?` in ${owner.name}`:scope?.enabled?' in sheet scope':' on this sheet'}`);
    el.title=el.getAttribute('aria-label')!;
    el.onclick=e=>{
      e.stopPropagation();const groups=targets();
      if(!groups.length){host.refuse('No summary groups belong to the selected scope. Turn off Table selection to toggle all summary groups on this sheet.');return;}
      const collapse=groups.some(group=>!group.collapsed);
      host.change(collapse?'Collapse all summary groups':'Expand all summary groups',()=>groups.forEach(group=>{group.collapsed=collapse;}),{groups});
    };
    el.ondblclick=e=>e.stopPropagation();return el;
  }
  function drawSummary(cell:HTMLElement|undefined|null,layout:SummaryRowLayout|undefined,offset=0,owner?:Table):void{
    if(!cell||!layout)return;
    const controls=document.createElement('span');controls.className='row-group-controls';
    for(const entry of layout.buttons){
      const el=button(entry.group,entry.depth);if(owner)el.setAttribute('aria-label',`${el.getAttribute('aria-label')} in ${owner.name}`);el.classList.add('summary-chevron');el.style.left=6+offset+entry.left+'px';controls.append(el);
    }
    if(controls.children.length)cell.append(controls);
    for(const entry of layout.rails){
      const rail=document.createElement('span');rail.className='row-outline-rail';rail.dataset.groupId=entry.group.id;rail.style.left=offset+entry.left+'px';
      if(entry.start)rail.classList.add('outline-start');
      if(entry.end)rail.classList.add('outline-end');
      if(entry.branch&&(entry.end||cell.querySelector('.cell-value')?.textContent?.trim())){const branch=document.createElement('span');branch.className='row-outline-branch';branch.style.width=entry.width+'px';rail.append(branch);}
      cell.append(rail);
    }
  }
  function drawRows():void {
    valueLabels.clear();closeBoundaryMenu();
    table.querySelectorAll('.row-group-controls,.row-outline-rail,.row-plain-hints,.plain-group-hints,.column-summary-controls,.column-summary-rail,.table-group-controls,.master-chevron').forEach(el=>el.remove());
    for(const boundary of boundaries.values())if(boundary.axis==='column'){
      const element=boundary.anchor?header(boundary.anchor):corner;if(element)drawBoundary(boundary,element);
    }
    const firstCell=table.querySelector<HTMLElement>(`tbody td[data-display-r="${sheet.rows.findIndex(row=>row.id===host.rows[0])}"][data-display-c="${sheet.columns.findIndex(column=>column.id===host.columns[0])}"]`);
    const hasMaster=entries.some(entry=>entry.group.kind==='summary'),masterInset=(cell:HTMLElement|null|undefined)=>hasMaster&&cell===firstCell?24:0;
    table.querySelectorAll<HTMLElement>('[data-table-group-inset]').forEach(cell=>{
      cell.style.setProperty('--summary-text-inset',cell.dataset.tableGroupInset!);
      cell.classList.toggle('summary-cell',parseFloat(cell.dataset.tableGroupInset!)>0);delete cell.dataset.tableGroupInset;
    });
    for(const th of table.querySelectorAll<HTMLElement>('tbody [data-row-select]')){
      const id=sheet.rows[Number(th.dataset.rowSelect)].id;
      const cell=th.parentElement?.querySelector<HTMLElement>('td[data-r]'),layout=host.rowLayouts.get(id);
      drawSummary(cell,layout,masterInset(cell));
      const firstRow=table.querySelector<HTMLElement>(`tbody [data-row-select="${sheet.rows.findIndex(r=>r.id===host.rows[0])}"]`)?.parentElement;
      if(firstRow&&firstRow===th.parentElement)for(const entry of summaries.filter(e=>e.group.axis==='column'&&host.columns.includes(e.group.members[0]))){
        const at=host.columns.indexOf(entry.group.members[0]),cell=firstRow.querySelector<HTMLElement>(`td[data-c="${sheet.columns.findIndex(c=>c.id===entry.group.members[0])}"]`);
        if(!cell)continue;
        let controls=cell.querySelector<HTMLElement>('.column-summary-controls');
        if(!controls){controls=document.createElement('span');controls.className='column-summary-controls';controls.style.left=6+masterInset(cell)+(at===0?host.rowLayouts.get(host.rows[0])?.inset??0:0)+'px';cell.append(controls);}
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
    }
    for(const boundary of boundaries.values())if(boundary.axis==='row'){
      const element=boundary.start&&boundary.anchor===host.rows[0]?corner:boundary.anchor?table.querySelector<HTMLElement>(`tbody [data-row-select="${sheet.rows.findIndex(row=>row.id===boundary.anchor)}"]`):!host.rows.length?corner:null;
      if(element)drawBoundary(boundary,element);
    }
    for(const [tableId,layout] of host.tableRowLayouts){
      const column=sheet.columns.findIndex(column=>column.id===layout.column);
      for(const cell of table.querySelectorAll<HTMLElement>(`tbody td[data-c="${column}"][data-r]`)){
        const row=sheet.rows[Number(cell.dataset.r)].id;
        drawSummary(cell,layout.rows.get(row),masterInset(cell)+(layout.column===host.columns[0]?host.rowLayouts.get(row)?.inset??0:0),tableLayouts.get(tableId)?.owner);
      }
    }
    for(const entry of entries.filter(e=>e.group.table&&e.group.kind==='summary')){
      if(entry.group.kind==='summary'&&entry.group.axis==='row')continue;
      const layout=tableLayouts.get(entry.group.table!);if(!layout)continue;
      const {owner,ownedRows,ownedColumns,shownRows,shownColumns}=layout;
      const anchor=entry.group.kind==='summary'?entry.group.members[0]:precedingGroupMember(sheet,entry.group,entry.group.axis==='row'?shownRows:shownColumns);
      const row=entry.group.axis==='row'?anchor:owner.header,column=entry.group.axis==='column'?anchor:shownColumns[0];
      const cell=table.querySelector<HTMLElement>(`td[data-r="${sheet.rows.findIndex(r=>r.id===row)}"][data-c="${sheet.columns.findIndex(c=>c.id===column)}"]`)
        ??(entry.group.kind!=='summary'?table.querySelector<HTMLElement>(`td[data-display-r="${sheet.rows.findIndex(r=>r.id===(row??ownedRows[0]))}"][data-display-c="${sheet.columns.findIndex(c=>c.id===(column??ownedColumns[0]))}"]`):null);
      if(!cell)continue;
      cell.removeAttribute('aria-hidden');
      let controls=cell.querySelector<HTMLElement>('.table-group-controls');
      if(!controls){controls=document.createElement('span');controls.className='table-group-controls';cell.append(controls);cell.dataset.tableGroupInset=cell.style.getPropertyValue('--summary-text-inset')||'0px';controls.style.left=6+parseFloat(cell.dataset.tableGroupInset)+'px';}
      const control=button(entry.group,entry.depth);
      control.setAttribute('aria-label',`${control.getAttribute('aria-label')} in ${owner.name}`);
      controls.append(control);cell.classList.add('summary-cell');
      cell.style.setProperty('--summary-text-inset',(parseFloat(cell.dataset.tableGroupInset!)+controls.children.length*26)+'px');
      if(host.tree&&entry.group.kind==='summary'&&entry.group.axis==='column'&&!entry.group.collapsed&&anchor){
        const start=shownColumns.indexOf(anchor),members=new Set(entry.group.members);let end=start;
        shownColumns.forEach((column,i)=>{if(members.has(column))end=Math.max(end,i);});
        for(let i=start;i>=0&&i<=end;i++){
          const target=table.querySelector<HTMLElement>(`td[data-r="${sheet.rows.findIndex(row=>row.id===owner.header)}"][data-c="${sheet.columns.findIndex(column=>column.id===shownColumns[i])}"]`);if(!target)continue;
          const rail=document.createElement('span');rail.className='column-summary-rail';rail.dataset.groupId=entry.group.id;rail.style.bottom=3+(entry.depth-1)*3+'px';
          if(i===start)rail.style.left='18px';if(i===end)rail.style.right='50%';target.append(rail);
        }
      }
    }
    if(hasMaster&&firstCell){
      const controls=document.createElement('span');controls.className='row-group-controls';
      const master=masterChevron();master.style.left='6px';controls.append(master);firstCell.append(controls);
    }
    const cells=new Set([...table.querySelectorAll<HTMLElement>('.row-group-controls,.column-summary-controls')].map(controls=>controls.closest<HTMLElement>('td')!));
    const positions=[...cells].flatMap(cell=>{
      const value=cell.querySelector<HTMLElement>('.cell-value');
      return value?[[cell,firstLineControlTop(cell,value)] as const]:[];
    });
    for(const [cell,top]of positions)cell.style.setProperty('--group-control-top',top+'px');
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
      toggle.onclick=()=>host.change(`Change ${name}`,()=>{sheet.outlineView={...sheet.outlineView,[property]:!value};},{view:true});
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
        el.onclick=()=>host.change('Toggle outline level',()=>targets.forEach(e=>{e.group.collapsed=!collapsed;}),{groups:targets.map(e=>e.group)});matrix.append(el);
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
  document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target as Node)&&!menuButton.contains(e.target as Node))closeMenu();if(boundaryMenu&&!boundaryMenu.element.contains(e.target as Node)&&!boundaryMenu.trigger.contains(e.target as Node))closeBoundaryMenu();},{capture:true,signal:controller.signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&boundaryMenu){e.preventDefault();e.stopPropagation();closeBoundaryMenu(true);}else if(menu&&e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenu(true);}},{capture:true,signal:controller.signal});
  window.addEventListener('resize',()=>{closeBoundaryMenu();if(menu)openMenu();},{signal:controller.signal});
  grid.addEventListener('scroll',()=>{closeBoundaryMenu();if(menu&&(grid.scrollTop!==menuScrollTop||grid.scrollLeft!==menuScrollLeft))closeMenu();},{signal:controller.signal});
  if(host.menuOpen){const popup=openMenu();if(rememberedFocus)popup.querySelector<HTMLButtonElement>(rememberedFocus)?.focus({preventScroll:true});}
  return {drawRows,positionMenu,masterControl:column=>column===host.columns[0]&&entries.some(entry=>entry.group.kind==='summary')?masterChevron():undefined,close:()=>{
    const active=document.activeElement instanceof HTMLButtonElement&&menu?.contains(document.activeElement)?document.activeElement:undefined;
    rememberedFocus=active?.dataset.outlineAxis?`[data-outline-axis="${active.dataset.outlineAxis}"][data-outline-level="${active.dataset.outlineLevel}"]`
      :active?.dataset.groupId?`[data-group-id="${active.dataset.groupId}"]`
      :active?.getAttribute('role')==='switch'?`[role="switch"][aria-label="${active.getAttribute('aria-label')}"]`:undefined;
    menu?.remove();closeBoundaryMenu();controller.abort();
  }};
}
