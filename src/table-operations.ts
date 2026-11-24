import { allTables,allSheets,clone,createTranslationContext,getCell,groupMoveTarget,inheritTableRow,key,summaryMoveMembers,translate,uid,uniqueName,type Cell,type TranslationContext,type Workbook} from './model';
import {relocate} from './cell-operations';
import {Engine} from './formula';
import {editSnapshot} from './undo-history';

type Axis='row'|'column';
export type TableAxisEdit={kind:'insert';boundary:number;count:number}|{kind:'delete';ids:string[]}|{kind:'duplicate';ids:string[]}|{kind:'move';ids:string[];boundary:number;group?:string};
type Entry={source?:string;copy?:string};
export class TableExpansionConflict extends Error{
  constructor(public axis:Axis,public boundary:number,public count:number){
    super('Table expansion would overwrite neighboring data or another table. Confirm a sheet shift to make room first.');
  }
}

/** ownedCandidate opts out of rollback: book must be an independent, disposable snapshot. */
export type CellMoveTrace=(source:string,target:{sheet:string;row:string;column:string}|null)=>void;
export function editTableAxis(book:Workbook,tableId:string,axis:Axis,edit:TableAxisEdit,trace?:Map<string,{sheet:string;row:string;column:string}|null>|CellMoveTrace,options:{ownedCandidate?:boolean}={}):string[]{
  const owner=allTables(book).find(table=>table.id===tableId);
  if(!owner)throw Error('The selected table no longer exists.');
  const next=options.ownedCandidate?book:editSnapshot(book,new Set([owner.sheet])),table=allTables(next).find(t=>t.id===tableId);
  if(!table)throw Error('The selected table no longer exists.');
  const sheet=allSheets(next).find(s=>s.id===table.sheet)!;
  const items=axis==='row'?sheet.rows:sheet.columns,positions=new Map(items.map((item,i)=>[item.id,i]));
  const old=axis==='row'?[...table.rows]:table.columns.map(field=>field.column);
  if(!old.length&&axis==='column')throw Error('Keep at least one table field.');
  if(old.some((id,i)=>!positions.has(id)||i>0&&positions.get(id)!<=positions.get(old[i-1])!))throw Error('Repair the table ordering before editing its records or fields.');
  const selected=new Set(edit.kind==='insert'?[]:summaryMoveMembers({...sheet,groups:sheet.groups.filter(group=>group.table===table.id)},axis,edit.ids,table.id));
  if(edit.kind!=='insert'&&(!selected.size||[...selected].some(id=>!old.includes(id))))throw Error('Select only records or fields in this table, not its header or neighboring cells.');
  const joining=new Set<string>();
  if(edit.kind==='move'&&edit.group){
    const target=groupMoveTarget({...sheet,groups:sheet.groups.filter(group=>group.table===table.id)},axis,edit.ids,edit.group,table);
    if(target.boundary!==edit.boundary)throw Error('The destination group changed. Select it again.');
    for(const group of [target.group,...target.parents])joining.add(group.id);
  }
  const before=edit.kind==='insert'||edit.kind==='move'?old.filter(id=>positions.get(id)!<edit.boundary).length:0;
  if((edit.kind==='insert'||edit.kind==='move')&&(!Number.isInteger(edit.boundary)||edit.boundary<(axis==='row'?positions.get(table.header)!+1:positions.get(old[0])!)||edit.boundary>(positions.get(old.at(-1)??table.header)!+1)))throw Error('Choose a destination inside this table.');
  let entries:Entry[]=old.map(source=>({source})),addedAt=-1,addedCount=0;
  if(edit.kind==='insert'){
    if(!Number.isInteger(edit.count)||edit.count<1||edit.count>1000)throw Error('Insert between 1 and 1000 table records or fields at a time.');
    addedAt=before;addedCount=edit.count;entries.splice(before,0,...Array.from({length:edit.count},()=>({})));
  }else if(edit.kind==='delete')entries=entries.filter(entry=>!selected.has(entry.source!));
  else if(edit.kind==='duplicate'){
    const last=Math.max(...old.map((id,i)=>selected.has(id)?i:-1));addedAt=last+1;
    const copies=old.filter(id=>selected.has(id)).map(copy=>({copy}));addedCount=copies.length;entries.splice(addedAt,0,...copies);
  }else{
    const moving=entries.filter(entry=>selected.has(entry.source!));
    const at=old.slice(0,before).filter(id=>!selected.has(id)).length;
    entries=entries.filter(entry=>!selected.has(entry.source!));entries.splice(at,0,...moving);
  }
  if(axis==='column'&&!entries.length)throw Error('Keep at least one table field.');
  const slots=[...old],extra=Math.max(0,entries.length-old.length);
  const last=positions.get(old.at(-1)??table.header)!;
  if((axis==='row'?last+extra>=100_000:last+extra>=512))throw Error('Table expansion exceeds the sheet size limit.');
  const additions=Array.from({length:Math.max(0,last+extra+1-items.length)},()=>({id:uid(),label:'New column',width:145}));
  for(let i=1;i<=extra;i++)slots.push((items[last+i]??additions[last+i-items.length]).id);
  const across=axis==='row'?table.columns.map(field=>field.column):[table.header,...table.rows];
  if(slots.length*across.length>200_000)throw Error('This table edit exceeds the safe cell-operation limit.');
  const address=(member:string,cross:string)=>({sheet:sheet.id,row:axis==='row'?member:cross,column:axis==='row'?cross:member});
  const neighbors=allTables(next).filter(other=>other.id!==table.id&&other.sheet===sheet.id).map(other=>({rows:new Set([other.header,...other.rows]),columns:new Set(other.columns.map(field=>field.column))}));
  for(const slot of slots.slice(old.length))for(const cross of across){
    const target=address(slot,cross),cell=sheet.cells[key(target.row,target.column)];
    if(cell&&(cell.value!==undefined&&cell.value!==null&&cell.value!==''||cell.formula||cell.calculation||cell.binding||cell.note||cell.link||cell.spillHint))throw new TableExpansionConflict(axis,last+1,extra);
    if(neighbors.some(other=>other.rows.has(target.row)&&other.columns.has(target.column)))throw new TableExpansionConflict(axis,last+1,extra);
  }
  if(axis==='row')sheet.rows.push(...additions.map(({id})=>({id})));else sheet.columns.push(...additions);
  const itemById=new Map(items.map(item=>[item.id,item]));
  const snapshots=new Map<string,Cell[]>();
  if(edit.kind==='duplicate')for(const source of selected)snapshots.set(source,across.map(cross=>clone(getCell(sheet,address(source,cross).row,address(source,cross).column))));
  const oldFields=clone(table.columns),oldGroups=clone(sheet.groups),oldFlags=new Map(items.map(item=>[item.id,item.hypotheticalTables?.[table.id]]));
  const fieldByColumn=new Map(oldFields.map(field=>[field.column,field]));
  const mapping=new Map<string,ReturnType<typeof address>|null>(),axisMap=new Map<string,string>();
  const destinations=new Map(entries.flatMap((entry,i)=>entry.source?[[entry.source,slots[i]] as const]:[]));
  for(const source of old){
    const destination=destinations.get(source);
    if(destination)axisMap.set(source,destination);
    for(const cross of across){const from=address(source,cross);mapping.set(`${sheet.id}:${key(from.row,from.column)}`,destination?address(destination,cross):null);}
  }
  const inserted=new Set<string>();
  entries.forEach((entry,i)=>{if(!entry.source)for(const cross of across){const target=address(slots[i],cross);inserted.add(`${sheet.id}:${key(target.row,target.column)}`);}});
  relocate(next,mapping,inserted,table);
  const members=slots.slice(0,entries.length);
  if(axis==='row')table.rows=members;
  else{
    const names=oldFields.map(field=>field.name);
    table.columns=entries.map((entry,i)=>{
      if(entry.source)return{...fieldByColumn.get(entry.source)!,column:slots[i]};
      const source=entry.copy?fieldByColumn.get(entry.copy):undefined,name=uniqueName(names,source?source.name+' copy':'New column');names.push(name);
      return{id:uid(),column:slots[i],name};
    });
  }
  for(const slot of slots){const item=itemById.get(slot)!;if(item.hypotheticalTables)delete item.hypotheticalTables[table.id];}
  entries.forEach((entry,i)=>{
    const flag=oldFlags.get(entry.source??entry.copy??'');
    if(flag!==undefined){const item=itemById.get(slots[i])!;item.hypotheticalTables??={};item.hypotheticalTables[table.id]=flag;}
  });
  const oldPositions=new Map(old.map((id,index)=>[id,index])),memberPositions=new Map(members.map((id,index)=>[id,index]));
  sheet.groups=oldGroups.flatMap(group=>{
    if(group.table!==table.id||group.axis!==axis)return[group];
    if(group.kind==='summary'&&!axisMap.has(group.members[0]))return[];
    let original=group.members;
    const indices=group.members.map(id=>oldPositions.get(id)??-1).filter(i=>i>=0);
    if(edit.kind==='move'&&!group.members.every(id=>selected.has(id))){
      const inside=joining.has(group.id)||indices.length>0&&before>Math.min(...indices)&&before<=Math.max(...indices);
      original=inside?[...new Set([...group.members,...selected])]:group.members.filter(id=>!selected.has(id));
    }
    const mapped=original.flatMap(id=>axisMap.has(id)?[axisMap.get(id)!]:[]);
    if(addedAt>=0){
      if(indices.length&&addedAt>Math.min(...indices)&&addedAt<=Math.max(...indices))mapped.push(...members.slice(addedAt,addedAt+addedCount));
    }
    const ordered=[...new Set(mapped)].sort((a,b)=>memberPositions.get(a)!-memberPositions.get(b)!);
    if(group.kind==='summary'){const anchor=axisMap.get(group.members[0])!;ordered.splice(ordered.indexOf(anchor),1);ordered.unshift(anchor);}
    return ordered.length>=(group.kind==='summary'?2:1)?[{...group,members:ordered}]:[];
  });
  if(edit.kind==='duplicate'){
    const copies=new Map(entries.flatMap((entry,i)=>entry.copy?[[entry.copy,members[i]] as const]:[]));
    for(const group of oldGroups.filter(group=>group.table===table.id&&group.axis===axis&&group.members.every(id=>copies.has(id))))sheet.groups.push({...group,id:uid(),members:group.members.map(id=>copies.get(id)!)});
  }
  for(const reference of next.references??[])if(reference.table===table.id&&axis==='row'){
    reference.archivedRows=reference.archivedRows.flatMap(id=>axisMap.has(id)?[axisMap.get(id)!]:[]);
    if(reference.catalog?.rows)reference.catalog.rows=reference.catalog.rows.flatMap(id=>axisMap.has(id)?[axisMap.get(id)!]:[]);
  }
  let translation:TranslationContext|undefined;
  let inheritanceEngine:Engine|undefined;
  for(let i=0;i<entries.length;i++){
    const entry=entries[i];if(entry.source)continue;
    translation??=createTranslationContext(next);
    if(entry.copy){
      const moved=axisMap.get(entry.copy)!;
      across.forEach((cross,j)=>{
        const from=address(moved,cross),target=address(slots[i],cross),source=sheet.cells[key(from.row,from.column)]??snapshots.get(entry.copy!)![j],cell=clone(source);
        if(cell.formula)cell.formula=translate(cell.formula,next,sheet.id,from.row,from.column,target.row,target.column,sheet.id,translation);
        if(cell.calculation)cell.calculation=translate(cell.calculation,next,sheet.id,from.row,from.column,target.row,target.column,sheet.id,translation);
        sheet.cells[key(target.row,target.column)]=cell;
      });
    }else if(axis==='row'){
      if(table.columns.some(c=>['ismeal','isday','meal','weight'].includes(c.name.toLowerCase())))inheritanceEngine??=new Engine(next);
      inheritTableRow(next,sheet,table,slots[i],i,false,undefined,{translation,engine:inheritanceEngine});
    }
    else sheet.cells[key(table.header,slots[i])]={value:table.columns[i].name};
    const template=entry.copy??old[Math.min(addedAt,old.length-1)];
    const mappedTemplate=template?axisMap.get(template):undefined;
    if(mappedTemplate)for(const validation of [...sheet.validations]){
      const eligible=axis==='row'?validation.rows.includes(mappedTemplate):validation.columns.includes(mappedTemplate);
      const crossIds=axis==='row'?validation.columns:validation.rows,within=crossIds.filter(id=>across.includes(id));
      if(eligible&&within.length)sheet.validations.push({...clone(validation),id:uid(),rows:axis==='row'?[slots[i]]:within,columns:axis==='row'?within:[slots[i]]});
    }
  }
  if(axis==='column')for(const field of table.columns)sheet.cells[key(table.header,field.column)]={...getCell(sheet,table.header,field.column),value:field.name};
  if(next!==book)Object.assign(book,next);
  if(trace)for(const [source,target] of mapping){if(typeof trace==='function')trace(source,target);else trace.set(source,target);}
  return entries.flatMap((entry,i)=>edit.kind==='delete'?[]:edit.kind==='move'?entry.source&&selected.has(entry.source)?[members[i]]:[]:!entry.source?[members[i]]:[]);
}
