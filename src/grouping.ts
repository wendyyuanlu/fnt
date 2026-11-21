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
export function outlineGutter(entries:OutlineGroup[],rows:string[],_tree:boolean,lastRowNumber=rows.length,hints=true):number {
  const controls=hints&&entries.some(e=>e.group.axis==='row'&&e.group.kind!=='summary');
  return 48+(controls?24:0)+Math.max(0,String(lastRowNumber).length-3)*6;
}
export interface SummaryRowLayout {
  inset:number;
  buttons:{group:Group;depth:number;left:number}[];
  rails:{group:Group;left:number;start:boolean;end:boolean;branch:boolean;width:number}[];
}
export function summaryRowLayout(groups:Group[],rows:string[],tree:boolean,filled:(row:string)=>boolean):Map<string,SummaryRowLayout> {
  const positions=new Map(rows.map((id,i)=>[id,i])),layout=new Map<string,SummaryRowLayout>();
  const entries=outlineGroups(groups).filter(e=>e.group.axis==='row'&&e.group.kind==='summary'&&positions.has(e.group.members[0])).sort((a,b)=>a.depth-b.depth);
  const parents=new Map<string,number>(),texts=new Map<string,boolean>();
  const node=(id:string):SummaryRowLayout=>{
    let value=layout.get(id);
    if(!value){value={inset:0,buttons:[],rails:[]};layout.set(id,value);}
    return value;
  };
  for(const entry of entries){
    const anchor=entry.group.members[0],value=node(anchor),desired=tree?(entry.depth-1)*24:0;
    const left=Math.max(desired,...value.buttons.map(b=>b.left+26));
    value.buttons.push({group:entry.group,depth:entry.depth,left});value.inset=Math.max(value.inset,left+24);
    if(!tree)continue;
    for(const id of entry.members)if(id!==anchor&&positions.has(id)){
      parents.set(id,Math.max(parents.get(id)??0,entry.depth));
      node(id).inset=Math.max(node(id).inset,entry.depth*24);
    }
  }
  if(!tree)return layout;
  const hasText=(id:string):boolean=>{
    if(!texts.has(id))texts.set(id,filled(id));
    return texts.get(id)!;
  };
  for(const entry of entries.filter(e=>!e.group.collapsed)){
    const start=positions.get(entry.group.members[0])!,branches=new Set<string>();let end=start;
    for(const id of entry.members){
      const at=positions.get(id);
      if(at===undefined||at<=start)continue;
      end=Math.max(end,at);
      if(parents.get(id)===entry.depth&&hasText(id))branches.add(id);
    }
    if(end===start)continue;
    const control=node(rows[start]).buttons.find(b=>b.group.id===entry.group.id)!;
    for(let i=start;i<=end;i++){
      const value=node(rows[i]),left=18+control.left,target=value.buttons[0]?.left??entry.depth*24;
      value.rails.push({group:entry.group,left,start:i===start,end:i===end,branch:i===end||branches.has(rows[i]),width:Math.max(12,6+target-left)});
    }
  }
  return layout;
}
export const outlineLayer=(depth:number):string=>{
  let label='';
  for(let n=depth;n>0;n=Math.floor((n-1)/26))label=String.fromCharCode(97+(n-1)%26)+label;
  return label;
};
