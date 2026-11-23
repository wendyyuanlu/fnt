import {getCell,type Sheet,type Table} from './model';

export function mountStickyTableHeaders(host:{
  grid:HTMLElement;sheet:Sheet;tables:Table[];rows:{id:string;start:number;end:number}[];
  masked:(row:string,column:string)=>boolean;
  display?:(row:string,column:string)=>{row:string;column:string}|undefined;
  select:(row:string,column:string,edit:boolean)=>void;
}):{draw:()=>void;close:()=>void}{
  const {grid,sheet}=host,overlay=document.createElement('div'),positions=new Map(host.rows.map(row=>[row.id,row]));
  overlay.className='sticky-table-headers';overlay.setAttribute('aria-label','Sticky table headers');grid.append(overlay);
  const tables=host.tables.filter(table=>table.sheet===sheet.id).flatMap(table=>{
    const column=table.columns.find(field=>!host.masked(table.header,field.column))?.column;
    if(!column)return[];
    const displayRow=(row:string)=>host.display?host.display(row,column)?.row:row;
    const header=positions.get(displayRow(table.header)??''),visible=[table.header,...table.rows].flatMap(id=>{const row=displayRow(id);return row&&positions.has(row)?[positions.get(row)!]:[];});
    if(!header||!visible.length)return[];
    const last=visible.reduce((a,b)=>a.end>b.end?a:b);
    return[{table,header,get end(){return last.end;}}];
  });
  let signature='';
  const draw=()=>{
    const corner=grid.querySelector<HTMLElement>('.grid .corner'),head=grid.querySelector<HTMLElement>('.grid thead');
    if(!corner||!head)return;
    const box=grid.getBoundingClientRect(),edge=corner.getBoundingClientRect().right,height=head.getBoundingClientRect().height,scroll=grid.scrollTop;
    overlay.style.left=grid.scrollLeft+edge-box.left-grid.clientLeft+'px';overlay.style.top=scroll+height+'px';overlay.style.width=Math.max(0,grid.clientWidth-(edge-box.left))+'px';
    const cells=new Map<string,{table:Table;column:string;top:number;left:number;width:number;height:number;priority:number}>();
    for(const entry of tables){
      if(entry.header.start>=scroll||entry.end<=scroll)continue;
      const top=Math.min(0,entry.end-scroll-(entry.header.end-entry.header.start));
      for(const field of entry.table.columns){
        if(host.masked(entry.table.header,field.column))continue;
        const displayed=host.display?host.display(entry.table.header,field.column)?.column:field.column;
        const index=sheet.columns.findIndex(column=>column.id===displayed),heading=grid.querySelector<HTMLElement>(`.grid thead [data-col="${index}"]`);
        if(!heading)continue;const bounds=heading.getBoundingClientRect();
        if(bounds.right<=edge||bounds.left>=box.right)continue;
        const previous=cells.get(field.column);if(previous&&previous.priority>entry.header.start)continue;
        cells.set(field.column,{table:entry.table,column:field.column,top,left:bounds.left-edge,width:bounds.width,height:entry.header.end-entry.header.start,priority:entry.header.start});
      }
    }
    const next=JSON.stringify([...cells.values()].map(cell=>[cell.table.id,cell.column,cell.top,cell.left,cell.width,cell.height]));
    if(signature===next)return;signature=next;overlay.replaceChildren();
    for(const cell of cells.values()){
      const button=document.createElement('button'),field=cell.table.columns.find(field=>field.column===cell.column)!,source=getCell(sheet,cell.table.header,cell.column);
      button.type='button';button.className='sticky-table-header';button.textContent=field.name;button.setAttribute('aria-label',`${cell.table.name}: ${field.name} header`);
      button.dataset.table=cell.table.id;button.dataset.column=cell.column;
      Object.assign(button.style,{left:cell.left+'px',top:cell.top+'px',width:cell.width+'px',height:cell.height+'px',color:source.format?.color??'',background:source.format?.background??'',fontWeight:source.format?.bold===false?'400':'600',fontStyle:source.format?.italic?'italic':'normal',textDecoration:[source.format?.underline?'underline':'',source.format?.strikethrough?'line-through':''].filter(Boolean).join(' ')});
      const index=sheet.columns.findIndex(column=>column.id===cell.column),heading=grid.querySelector<HTMLElement>(`.grid thead [data-col="${index}"]`);
      button.style.zIndex=heading?.style.position==='sticky'?'2':'1';
      button.onclick=e=>{e.stopPropagation();host.select(cell.table.header,cell.column,false);};
      button.ondblclick=e=>{e.stopPropagation();host.select(cell.table.header,cell.column,true);};
      overlay.append(button);
    }
    overlay.style.height=Math.max(0,...[...cells.values()].map(cell=>cell.top+cell.height))+'px';
  };
  const observer=new ResizeObserver(draw);observer.observe(grid);draw();
  return{draw,close:()=>{observer.disconnect();overlay.remove();}};
}
