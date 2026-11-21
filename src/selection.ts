import type {Sheet} from './model';

export type SelectionKind='cells'|'rows'|'columns';
export interface SelectionBounds {r1:number;r2:number;c1:number;c2:number}
export interface SelectionArea {sheet:string;kind:SelectionKind;rows:string[];columns:string[]}

export function captureSelection(sheet:Sheet,bounds:SelectionBounds,kind:SelectionKind):SelectionArea {
  return {sheet:sheet.id,kind,rows:kind==='columns'?[]:sheet.rows.slice(bounds.r1,bounds.r2+1).map(r=>r.id),columns:kind==='rows'?[]:sheet.columns.slice(bounds.c1,bounds.c2+1).map(c=>c.id)};
}
function runs(ids:string[],items:{id:string}[]):[number,number][] {
  const selected=new Set(ids),result:[number,number][]=[];
  items.forEach((item,i)=>{if(!selected.has(item.id))return;const last=result.at(-1);if(last&&last[1]+1===i)last[1]=i;else result.push([i,i]);});
  return result;
}
export function selectionRanges(sheet:Sheet,active:SelectionBounds,areas:SelectionArea[]):SelectionBounds[] {
  const rectangles=[active];
  for(const area of areas){
    if(area.sheet!==sheet.id)continue;
    const rows=area.kind==='columns'?[[0,sheet.rows.length-1]]:runs(area.rows,sheet.rows);
    const columns=area.kind==='rows'?[[0,sheet.columns.length-1]]:runs(area.columns,sheet.columns);
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
