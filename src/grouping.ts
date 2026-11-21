import {outlineMembers,type Group,type Sheet} from './model';

export interface OutlineGroup {group:Group;depth:number;members:Set<string>}
export function outlineGroups(groups:Group[]):OutlineGroup[] {
  const entries=groups.map(group=>({group,depth:1,members:new Set(group.kind==='summary'?group.members:outlineMembers(group,groups))}));
  const summaries=entries.filter(e=>e.group.kind==='summary').sort((a,b)=>b.members.size-a.members.size);
  for(const entry of summaries){
    const parents=summaries.filter(parent=>parent.group.axis===entry.group.axis&&parent.members.size>entry.members.size&&[...entry.members].every(id=>parent.members.has(id)));
    entry.depth=1+Math.max(0,...parents.map(parent=>parent.depth));
  }
  return entries;
}
export function precedingGroupMember(sheet:Sheet,group:Group,visible:string[]):string|undefined {
  const ids=(group.axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  const positions=group.members.map(id=>ids.indexOf(id)).filter(i=>i>=0);
  const first=positions.length?Math.min(...positions):0,shown=new Set(visible);
  return ids.slice(0,first).reverse().find(id=>shown.has(id))??visible[0];
}
export function outlineGutter(entries:OutlineGroup[],rows:string[],tree:boolean,lastRowNumber=rows.length):number {
  const shown=new Set(rows);
  const depth=tree?Math.max(1,...entries.filter(e=>e.group.axis==='row'&&e.group.kind==='summary'&&shown.has(e.group.members[0])).map(e=>e.depth)):1;
  return 48+Math.max(0,String(lastRowNumber).length-3)*6+(depth-1)*12;
}
export const outlineLayer=(depth:number):string=>{
  let label='';
  for(let n=depth;n>0;n=Math.floor((n-1)/26))label=String.fromCharCode(97+(n-1)%26)+label;
  return label;
};
