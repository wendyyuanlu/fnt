import { allSheets,allTables,outlineMembers,summaryMoveMembers,type Group,type Sheet,type Workbook} from './model';

const projectionCache=new WeakMap<Workbook,Map<string,{signature:string;projection:ReturnType<typeof buildTableGroupProjection>}>>();
export function tableGroupProjection(book:Workbook,sheet:Sheet,rows:string[],columns:string[]){
  const tables=allTables(book).filter(table=>table.sheet===sheet.id);
  const signature=JSON.stringify([rows,columns,sheet.groups,tables.map(t=>[t.id,t.header,t.rows,t.columns.map(c=>c.column)])]);
  let cache=projectionCache.get(book);if(!cache){cache=new Map();projectionCache.set(book,cache);}
  const previous=cache.get(sheet.id);if(previous?.signature===signature)return previous.projection;
  const projection=buildTableGroupProjection(book,sheet,rows,columns);
  cache.set(sheet.id,{signature,projection});return projection;
}
function buildTableGroupProjection(book:Workbook,sheet:Sheet,rows:string[],columns:string[]){
  const entries=allTables(book).filter(table=>table.sheet===sheet.id).flatMap(table=>{
    const groups=sheet.groups.filter(group=>group.table===table.id&&group.collapsed);
    if(!groups.length)return[];
    const rowIds=new Set([table.header,...table.rows]),columnIds=new Set(table.columns.map(field=>field.column));
    const rowSlots=rows.filter(id=>rowIds.has(id)),columnSlots=columns.filter(id=>columnIds.has(id));
    const hidden=(axis:Group['axis'])=>new Set(groups.filter(group=>group.axis===axis).flatMap(group=>outlineMembers(group,sheet.groups)));
    const hiddenRows=hidden('row'),hiddenColumns=hidden('column');
    const visibleRows=rowSlots.filter(id=>!hiddenRows.has(id)),visibleColumns=columnSlots.filter(id=>!hiddenColumns.has(id));
    return[{table:table.id,rows:new Set(rowSlots),columns:new Set(columnSlots),
      sourceRows:new Map(rowSlots.map((id,i)=>[id,visibleRows[i]])),sourceColumns:new Map(columnSlots.map((id,i)=>[id,visibleColumns[i]])),
      displayRows:new Map(visibleRows.map((id,i)=>[id,rowSlots[i]])),displayColumns:new Map(visibleColumns.map((id,i)=>[id,columnSlots[i]]))}];
  });
  const owner=(row:string,column:string)=>entries.find(entry=>entry.rows.has(row)&&entry.columns.has(column));
  return{
    source(row:string,column:string):{row:string;column:string}|undefined{
      const entry=owner(row,column);if(!entry)return{row,column};
      const sourceRow=entry.sourceRows.get(row),sourceColumn=entry.sourceColumns.get(column);
      return sourceRow&&sourceColumn?{row:sourceRow,column:sourceColumn}:undefined;
    },
    display(row:string,column:string):{row:string;column:string}|undefined{
      const entry=owner(row,column);if(!entry)return{row,column};
      const displayRow=entry.displayRows.get(row),displayColumn=entry.displayColumns.get(column);
      return displayRow&&displayColumn?{row:displayRow,column:displayColumn}:undefined;
    },
    axis(table:string,axis:Group['axis'],slot:string):string|undefined{
      const entry=entries.find(entry=>entry.table===table);
      return entry&&(axis==='row'?entry.rows:entry.columns).has(slot)?(axis==='row'?entry.sourceRows:entry.sourceColumns).get(slot):slot;
    }
  };
}

export function ungroupPlainGroups(book:Workbook):number{
  let count=0;
  for(const sheet of allSheets(book)){const summaries=sheet.groups.filter(group=>group.kind==='summary');count+=sheet.groups.length-summaries.length;sheet.groups=summaries;}
  return count;
}
export function hypotheticalMembers(sheet:Sheet,axis:Group['axis']):Set<string>{
  const items=axis==='row'?sheet.rows:sheet.columns,flags=new Map(items.map(item=>[item.id,item.hypothetical]));
  const groups=sheet.groups.filter(g=>!g.table);
  const parents=groups.filter(group=>group.axis===axis&&group.kind==='summary'&&flags.get(group.members[0])!==undefined)
    .map(group=>({anchor:group.members[0],members:new Set(summaryMoveMembers({...sheet,groups},axis,group.members))})).sort((a,b)=>a.members.size-b.members.size);
  return new Set(items.filter(item=>{
    if(item.hypothetical!==undefined)return item.hypothetical;
    const parent=parents.find(parent=>parent.anchor!==item.id&&parent.members.has(item.id));
    return parent!==undefined&&flags.get(parent.anchor)===true;
  }).map(item=>item.id));
}
export function groupContainsCell(book:Workbook,sheet:Sheet,group:Pick<Group,'table'>,row:string,column:string):boolean{
  if(!group.table)return true;
  const table=allTables(book).find(t=>t.id===group.table&&t.sheet===sheet.id);
  return!!table&&(table.header===row||table.rows.includes(row))&&table.columns.some(c=>c.column===column);
}
export function hypotheticalProjection(book:Workbook,sheet:Sheet,axis:Group['axis']):(row:string,column:string)=>boolean{
  const global=hypotheticalMembers(sheet,axis),items=axis==='row'?sheet.rows:sheet.columns;
  const owners=allTables(book).filter(t=>t.sheet===sheet.id).map(table=>{
    const rows=new Set([table.header,...table.rows]),columns=new Set(table.columns.map(c=>c.column));
    const owned=axis==='row'?rows:columns,groups=sheet.groups.filter(g=>g.table===table.id);
    const flags=new Map(items.map(item=>[item.id,item.hypotheticalTables?.[table.id]]));
    const parents=groups.filter(g=>g.axis===axis&&g.kind==='summary').map(g=>({
      anchor:g.members[0],members:new Set(summaryMoveMembers({...sheet,groups},axis,g.members,table.id)),
      enabled:flags.get(g.members[0]),
      seed:items.find(item=>item.id===g.members[0])?.hypothetical??(global.has(g.members[0])?true:undefined)
    })).sort((a,b)=>a.members.size-b.members.size);
    const members=new Set(items.filter(item=>{
      if(!owned.has(item.id))return false;
      const explicit=flags.get(item.id);if(explicit!==undefined)return explicit;
      const parent=parents.find(p=>p.enabled!==undefined&&p.anchor!==item.id&&p.members.has(item.id));
      if(parent)return parent.enabled!;
      if(item.hypothetical!==undefined)return item.hypothetical;
      const seeded=parents.find(p=>p.seed!==undefined&&p.anchor!==item.id&&p.members.has(item.id));
      return seeded?.seed??global.has(item.id);
    }).map(item=>item.id));
    return{rows,columns,members};
  });
  return(row,column)=>{
    const owner=owners.find(t=>t.rows.has(row)&&t.columns.has(column)),id=axis==='row'?row:column;
    return owner?owner.members.has(id):global.has(id);
  };
}

export interface OutlineGroup {group:Group;depth:number;members:Set<string>}
export function outlineGroups(groups:Group[]):OutlineGroup[] {
  const entries=groups.map(group=>({group,depth:1,members:new Set(group.kind==='summary'?group.members:outlineMembers(group,groups))}));
  const summaries=entries.filter(e=>e.group.kind==='summary').sort((a,b)=>b.members.size-a.members.size);
  for(const entry of summaries){
    const parents=summaries.filter(parent=>parent.group.table===entry.group.table&&parent.group.axis===entry.group.axis&&parent.members.size>entry.members.size&&[...entry.members].every(id=>parent.members.has(id)));
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
  return 54+(controls?24:0)+Math.max(0,String(lastRowNumber).length-3)*6;
}
export interface SummaryRowLayout {
  inset:number;
  buttons:{group:Group;depth:number;left:number}[];
  rails:{group:Group;left:number;start:boolean;end:boolean;branch:boolean;width:number}[];
}
const summaryLayouts=new WeakMap<Group,{signature:string;groups:Group[];layout:Map<string,SummaryRowLayout>}>();
export function constantSummaryRowLayout(groups:Group[],rows:string[],tree:boolean):Map<string,SummaryRowLayout>{
  if(!groups.length)return new Map();
  const signature=JSON.stringify([groups,rows,tree]),previous=summaryLayouts.get(groups[0]);
  if(previous?.signature===signature&&groups.every((group,i)=>previous.groups[i]===group))return previous.layout;
  const layout=summaryRowLayout(groups,rows,tree,()=>true);
  summaryLayouts.set(groups[0],{signature,groups,layout});return layout;
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
