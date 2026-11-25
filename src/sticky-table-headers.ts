import {getCell,type Sheet,type Table} from './model';
import {firstLineControlTop} from './grouping-ui';

export function mountStickyTableHeaders(host:{
  grid:HTMLElement;sheet:Sheet;tables:Table[];rows:{id:string;start:number;end:number}[];
  masked:(row:string,column:string)=>boolean;
  display?:(row:string,column:string)=>{row:string;column:string}|undefined;
  masterControl?:(column:string)=>HTMLButtonElement|undefined;
  select:(row:string,column:string,edit:boolean)=>void;
}):{draw:()=>void;close:()=>void}{
  const {grid,sheet}=host,positions=new Map(host.rows.map(row=>[row.id,row])),columnIndices=new Map(sheet.columns.map((column,i)=>[column.id,i]));
  const tables=host.tables.filter(table=>table.sheet===sheet.id).flatMap(table=>{
    const column=table.columns.find(field=>!host.masked(table.header,field.column))?.column;
    if(!column)return[];
    const displayRow=(row:string)=>host.display?host.display(row,column)?.row:row;
    const header=positions.get(displayRow(table.header)??''),visible=[table.header,...table.rows].flatMap(id=>{const row=displayRow(id);return row&&positions.has(row)?[positions.get(row)!]:[];});
    if(!header||!visible.length)return[];
    const last=visible.reduce((a,b)=>a.end>b.end?a:b);
    const range=document.createElement('div'),overlay=document.createElement('div');
    range.className='sticky-table-header-range';overlay.className='sticky-table-headers';overlay.setAttribute('aria-label','Sticky table headers');range.append(overlay);grid.append(range);
    return[{table,header,range,overlay,buttons:new Map<string,{slot:HTMLElement;button:HTMLButtonElement;masterSlot:HTMLElement}>(),get end(){return last.end;}}];
  }).sort((a,b)=>a.header.start-b.header.start);
  for(const entry of tables)grid.append(entry.range);
  const draw=()=>{
    const corner=grid.querySelector<HTMLElement>('.grid .corner'),head=grid.querySelector<HTMLElement>('.grid thead');
    if(!corner||!head)return;
    const height=head.getBoundingClientRect().height,scroll=grid.scrollTop,gutter=corner.getBoundingClientRect().width;
    const headings=new Map<number,{element:HTMLElement;left:number;width:number}>();
    let width=gutter;
    for(const heading of head.querySelectorAll<HTMLElement>('[data-col]')){
      const columnWidth=heading.getBoundingClientRect().width;
      headings.set(Number(heading.dataset.col),{element:heading,left:width,width:columnWidth});width+=columnWidth;
    }
    const winners=new Map<string,string>();
    for(const entry of tables)if(entry.header.start<scroll&&entry.end>scroll)for(const field of entry.table.columns)if(!host.masked(entry.table.header,field.column))winners.set(field.column,entry.table.id);
    for(const entry of tables){
      const rowHeight=entry.header.end-entry.header.start,{range,overlay}=entry;
      Object.assign(range.style,{top:entry.header.start+height+'px',height:entry.end-entry.header.start+'px',width:width+'px'});
      Object.assign(overlay.style,{top:height+'px',height:rowHeight+'px',width:width+'px',clipPath:`inset(0 ${Math.max(0,width-grid.scrollLeft-grid.clientWidth)}px 0 ${grid.scrollLeft+gutter}px)`});
      const active=entry.header.start<scroll&&entry.end>scroll,visible=new Set<string>();
      for(const field of entry.table.columns){
        if(!active||winners.get(field.column)!==entry.table.id||host.masked(entry.table.header,field.column))continue;
        const displayed=host.display?host.display(entry.table.header,field.column)?.column:field.column;
        const geometry=headings.get(columnIndices.get(displayed??'')??-1);
        if(!geometry)continue;
        visible.add(field.column);
        let controls=entry.buttons.get(field.column);
        if(!controls){
          const slot=document.createElement('div'),button=document.createElement('button'),masterSlot=document.createElement('div');
          slot.className='sticky-table-header-slot';button.type='button';button.className='sticky-table-header';button.dataset.table=entry.table.id;button.dataset.column=field.column;
          masterSlot.className='sticky-table-header-slot sticky-master-slot';
          button.onclick=e=>{e.stopPropagation();host.select(entry.table.header,field.column,false);};
          button.ondblclick=e=>{e.stopPropagation();host.select(entry.table.header,field.column,true);};
          slot.append(button);controls={slot,button,masterSlot};entry.buttons.set(field.column,controls);
        }
        const {slot,button}=controls,source=getCell(sheet,entry.table.header,field.column),pinned=geometry.element.style.position==='sticky';
        if(button.textContent!==field.name)button.textContent=field.name;
        button.setAttribute('aria-label',`${entry.table.name}: ${field.name} header`);
        button.style.whiteSpace=source.format?.wrap?'pre-wrap':'nowrap';
        button.style.overflowWrap=source.format?.wrap?'anywhere':'';
        Object.assign(button.style,{position:pinned?'sticky':'absolute',left:pinned?geometry.element.style.left:geometry.left+'px',right:pinned?geometry.element.style.right:'',marginLeft:pinned?geometry.left+'px':'0px',top:'0px',width:geometry.width+'px',height:rowHeight+'px',color:source.format?.color??'',background:source.format?.background??'',fontWeight:source.format?.bold===false?'400':'600',fontStyle:source.format?.italic?'italic':'normal',textDecoration:[source.format?.underline?'underline':'',source.format?.strikethrough?'line-through':''].filter(Boolean).join(' '),zIndex:pinned?'2':'1'});
        slot.style.zIndex=pinned?'2':'1';
        if(slot.parentElement!==overlay)overlay.append(slot);
        const master=host.masterControl?.(field.column);
        button.style.paddingLeft=master?'34px':'';
        if(master){
          const {masterSlot}=controls,previous=masterSlot.querySelector<HTMLButtonElement>('.master-chevron');
          const control=previous??master;
          if(previous){previous.innerHTML=master.innerHTML;previous.disabled=master.disabled;for(const name of ['aria-label','aria-expanded','title'])previous.setAttribute(name,master.getAttribute(name)!);}
          const top=firstLineControlTop(button,button);
          Object.assign(control.style,{position:pinned?'sticky':'absolute',left:pinned?parseFloat(geometry.element.style.left)+6+'px':geometry.left+6+'px',right:pinned?parseFloat(geometry.element.style.right)+geometry.width-30+'px':'',marginLeft:pinned?geometry.left+6+'px':'0px',top:top+'px',marginTop:pinned?top+'px':'0px',verticalAlign:'top'});
          if(!previous)masterSlot.append(control);
          masterSlot.style.zIndex=pinned?'3':'2';
          if(masterSlot.parentElement!==overlay)overlay.append(masterSlot);
        }else controls.masterSlot.remove();
      }
      for(const [column,controls]of entry.buttons)if(!visible.has(column)){controls.slot.remove();controls.masterSlot.remove();}
    }
  };
  const observer=new ResizeObserver(draw);observer.observe(grid);grid.addEventListener('scroll',draw,{passive:true});draw();
  return{draw,close:()=>{observer.disconnect();grid.removeEventListener('scroll',draw);for(const entry of tables)entry.range.remove();}};
}
