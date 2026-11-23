import type {Sheet,Table} from './model';

export type SelectionKind='cells'|'rows'|'columns';
export interface SelectionBounds {r1:number;r2:number;c1:number;c2:number}
export interface SelectionArea {sheet:string;kind:SelectionKind;rows:string[];columns:string[];table?:string}

export function headerSelectionTables(sheet:Sheet,tables:readonly Table[],axis:'row'|'column',index:number):Table[] {
  const id=(axis==='row'?sheet.rows:sheet.columns)[index]?.id;
  return tables.filter(table=>table.sheet===sheet.id&&(axis==='row'?table.header===id||table.rows.includes(id):table.columns.some(field=>field.column===id)));
}
export function nearestHeaderTables(tables:readonly Table[],axis:'row'|'column',positions:ReadonlyMap<string,{start:number;end:number}>,viewport:{start:number;end:number}):Table[] {
  const ranked=tables.flatMap(table=>{
    const ids=axis==='column'?[table.header,...table.rows]:table.columns.map(field=>field.column);
    const spans=ids.flatMap(id=>positions.has(id)?[positions.get(id)!]:[]);
    if(!spans.length)return[];
    const visible=spans.filter(span=>span.end>viewport.start&&span.start<viewport.end);
    const distance=Math.min(...(visible.length?visible:spans).map(span=>Math.max(0,span.start-viewport.start,viewport.start-span.end)));
    return[{table,visible:visible.length>0,distance}];
  });
  const eligible=ranked.some(entry=>entry.visible)?ranked.filter(entry=>entry.visible):ranked;
  const distance=Math.min(...eligible.map(entry=>entry.distance));
  return eligible.filter(entry=>Math.abs(entry.distance-distance)<1).map(entry=>entry.table);
}
export function tableHeaderBounds(sheet:Sheet,table:Table,axis:'row'|'column',index:number,anchor?:number):SelectionBounds {
  const rows=sheet.rows.flatMap((row,i)=>row.id===table.header||table.rows.includes(row.id)?[i]:[]);
  const columns=sheet.columns.flatMap((column,i)=>table.columns.some(field=>field.column===column.id)?[i]:[]);
  if(!rows.length||!columns.length||!(axis==='row'?rows:columns).includes(index))throw Error('This header is outside the selected table.');
  const start=(axis==='row'?rows:columns).includes(anchor??-1)?anchor!:index;
  return axis==='row'?{r1:Math.min(start,index),r2:Math.max(start,index),c1:columns[0],c2:columns.at(-1)!}:
    {r1:rows[0],r2:rows.at(-1)!,c1:Math.min(start,index),c2:Math.max(start,index)};
}

export function captureSelection(sheet:Sheet,bounds:SelectionBounds,kind:SelectionKind,table?:Table):SelectionArea {
  if(table)return{sheet:sheet.id,kind,table:table.id,
    rows:sheet.rows.slice(bounds.r1,bounds.r2+1).filter(r=>r.id===table.header||table.rows.includes(r.id)).map(r=>r.id),
    columns:sheet.columns.slice(bounds.c1,bounds.c2+1).filter(c=>table.columns.some(field=>field.column===c.id)).map(c=>c.id)};
  return {sheet:sheet.id,kind,rows:kind==='columns'?[]:sheet.rows.slice(bounds.r1,bounds.r2+1).map(r=>r.id),columns:kind==='rows'?[]:sheet.columns.slice(bounds.c1,bounds.c2+1).map(c=>c.id)};
}
function runs(ids:string[],items:{id:string}[]):[number,number][] {
  const selected=new Set(ids),result:[number,number][]=[];
  items.forEach((item,i)=>{if(!selected.has(item.id))return;const last=result.at(-1);if(last&&last[1]+1===i)last[1]=i;else result.push([i,i]);});
  return result;
}
export function selectionRanges(sheet:Sheet,active:SelectionBounds,areas:SelectionArea[],table?:Table,tables?:readonly Table[]):SelectionBounds[] {
  const rectangles:SelectionBounds[]=table?[]:[active];
  for(const area of table?[captureSelection(sheet,active,'cells',table),...areas]:areas){
    if(area.sheet!==sheet.id)continue;
    const owner=area.table?(tables?.find(t=>t.id===area.table&&t.sheet===sheet.id)??(table?.id===area.table?table:undefined)):undefined;
    if(area.table&&tables&&!owner)continue;
    const rows=!area.table&&area.kind==='columns'?[[0,sheet.rows.length-1]]:runs(owner?area.rows.filter(id=>id===owner.header||owner.rows.includes(id)):area.rows,sheet.rows);
    const columns=!area.table&&area.kind==='rows'?[[0,sheet.columns.length-1]]:runs(owner?area.columns.filter(id=>owner.columns.some(field=>field.column===id)):area.columns,sheet.columns);
    for(const [r1,r2] of rows)for(const [c1,c2] of columns)rectangles.push({r1,r2,c1,c2});
  }
  const edges=[...new Set(rectangles.flatMap(r=>[r.r1,r.r2+1]))].sort((a,b)=>a-b),result:SelectionBounds[]=[],lastByColumns=new Map<string,SelectionBounds>();
  for(let i=0;i<edges.length-1;i++){
    const r1=edges[i],r2=edges[i+1]-1,intervals=rectangles.filter(r=>r.r1<=r1&&r.r2>=r2).map(r=>[r.c1,r.c2]).sort((a,b)=>a[0]-b[0]),merged:number[][]=[];
    for(const interval of intervals){const last=merged.at(-1);if(last&&interval[0]<=last[1]+1)last[1]=Math.max(last[1],interval[1]);else merged.push([...interval]);}
    for(const [c1,c2] of merged){
      const key=c1+':'+c2,last=lastByColumns.get(key);
      if(last&&last.r2+1===r1)last.r2=r2;
      else{const rectangle={r1,r2,c1,c2};result.push(rectangle);lastByColumns.set(key,rectangle);}
    }
  }
  return result;
}
export const selectionCount=(ranges:SelectionBounds[]):number=>ranges.reduce((count,r)=>count+(r.r2-r.r1+1)*(r.c2-r.c1+1),0);
