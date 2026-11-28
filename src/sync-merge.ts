import {allSheets,type Workbook,type Cell} from './model';
import {applyUndo,structuralUndo,type UndoHistory,type History} from './undo-history';

type RecordValue=Record<string,unknown>;
export interface SyncMerge{local:Workbook;remote:Workbook;conflicts:string[]}
const record=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function syncEqual(a:unknown,b:unknown):boolean{
  if(Object.is(a,b))return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,i)=>syncEqual(value,b[i]));
  if(!record(a)||!record(b))return false;
  const keys=new Set([...Object.keys(a),...Object.keys(b)]);
  for(const key of keys)if(!syncEqual(a[key],b[key]))return false;
  return true;
}
const deviceFields=['toolbarOrder','toolbarDividers','sheetTabCollapsed','tableManagerSort','tableActivity'] as const;
function shared(book:Workbook):Workbook{
  const result={...book,revision:0};
  for(const key of deviceFields)delete result[key];
  const sheet=(s:Workbook['sheets'][number])=>{
    const result={...s,groups:s.groups.map(group=>({...group,collapsed:false}))};
    delete result.outlineView;return result;
  };
  result.sheets=book.sheets.map(sheet);
  if(book.dropdownData)result.dropdownData={...book.dropdownData,sheets:book.dropdownData.sheets.map(sheet)};
  return result;
}
export const sameSharedWorkbook=(a:Workbook,b:Workbook):boolean=>syncEqual(shared(a),shared(b));
export function withDevicePreferences(incoming:Workbook,local:Workbook):Workbook{
  const result={...incoming};
  for(const key of deviceFields){
    if(local[key]===undefined)delete result[key];
    else Object.assign(result,{[key]:local[key]});
  }
  const previous=new Map(allSheets(local).map(sheet=>[sheet.id,sheet]));
  const sheet=(s:Workbook['sheets'][number])=>{
    const old=previous.get(s.id);if(!old)return s;
    const groups=new Map(old.groups.map(group=>[group.id,group]));
    const result={...s,groups:s.groups.map(group=>({...group,collapsed:groups.get(group.id)?.collapsed??group.collapsed}))};
    if(old.outlineView===undefined)delete result.outlineView;else result.outlineView=old.outlineView;
    return result;
  };
  result.sheets=incoming.sheets.map(sheet);
  if(incoming.dropdownData)result.dropdownData={...incoming.dropdownData,sheets:incoming.dropdownData.sheets.map(sheet)};
  return result;
}

// Preserve insertion anchors and ordering by stable identity, not array position.
function sequence(base:string[],local:string[],remote:string[],ids:Set<string>):string[]|undefined{
  const filter=(items:string[])=>items.filter(id=>ids.has(id)),b=filter(base),l=filter(local),r=filter(remote),baseIds=new Set(base);
  const reordered=(items:string[])=>{const present=new Set(items);return!syncEqual(items.filter(id=>baseIds.has(id)),b.filter(id=>present.has(id)));};
  const lm=reordered(l),rm=reordered(r),edges=new Map([...ids].map(id=>[id,new Set<string>()])),degree=new Map([...ids].map(id=>[id,0]));
  const add=(items:string[],insertionsOnly:boolean,other:string[])=>{
    let anchor=baseIds.has(items[0])?items[0]:undefined;
    const following=new Map<string,string>();let next:string|undefined;
    for(let i=other.length-1;i>=0;i--){if(next!==undefined)following.set(other[i],next);if(baseIds.has(other[i]))next=other[i];}
    for(let i=1;i<items.length;i++){
      const a=items[i-1],z=items[i];
      // An insertion follows a moved anchor rather than pinning its old successor.
      const target=insertionsOnly&&!baseIds.has(a)&&baseIds.has(z)&&anchor!==undefined?following.get(anchor):z;
      if(!(insertionsOnly&&baseIds.has(a)&&baseIds.has(z))&&target!==undefined&&!edges.get(a)!.has(target)){
        edges.get(a)!.add(target);degree.set(target,degree.get(target)!+1);
      }
      if(baseIds.has(z))anchor=z;
    }
  };
  add(l,rm&&!lm,r);add(r,lm&&!rm,l);
  const rank=new Map(b.map((id,i)=>[id,i]));
  const compare=(a:string,z:string)=>(rank.get(a)??Infinity)-(rank.get(z)??Infinity)||(a<z?-1:a>z?1:0);
  const ready=[...ids].filter(id=>degree.get(id)===0).sort(compare),result:string[]=[];
  while(ready.length){
    const id=ready.shift()!;result.push(id);
    for(const next of edges.get(id)!){
      degree.set(next,degree.get(next)!-1);
      if(degree.get(next)===0){
        let lo=0,hi=ready.length;while(lo<hi){const mid=(lo+hi)>>>1;if(compare(ready[mid],next)<0)lo=mid+1;else hi=mid;}ready.splice(lo,0,next);
      }
    }
  }
  return result.length===ids.size?result:undefined;
}
const inputFields=new Set(['value','formula','calculation','original','spillHint','dateLiteral','fractionInput','fractionLiteral','binding']);
const restaurantFields=new Set(['restaurant','restaurantText']);
function valueMerger(conflicts:Set<string>){
  const visit=(b:unknown,l:unknown,r:unknown,path:string[],side:'local'|'remote'):unknown=>{
    if(syncEqual(l,r))return l;
    if(syncEqual(b,l))return r;
    if(syncEqual(b,r))return l;
    const collision=()=>{conflicts.add(path.join('/'));return side==='local'?l:r;};
    if(path.at(-2)==='cells'&&(l===undefined||record(l))&&(r===undefined||record(r))){l??={};r??={};}
    if(Array.isArray(l)&&Array.isArray(r)&&(b===undefined||Array.isArray(b))){
      const before=Array.isArray(b)?b:[],all=[...before,...l,...r];
      const strings=all.every(value=>typeof value==='string'),entities=all.every(value=>record(value)&&typeof value.id==='string');
      if((!strings&&!entities)||[before,l,r].some(items=>new Set(items.map(item=>strings?item:(item as RecordValue).id)).size!==items.length))return collision();
      const entries=(items:unknown[])=>new Map(items.map(item=>[String(strings?item:(item as RecordValue).id),item]));
      const bm=entries(before),lm=entries(l),rm=entries(r),values=new Map<string,unknown>();
      for(const id of new Set([...bm.keys(),...lm.keys(),...rm.keys()])){
        const value=visit(bm.get(id),lm.get(id),rm.get(id),[...path,id],side);
        if(value!==undefined)values.set(id,value);
      }
      const ids=new Set(values.keys()),order=sequence([...bm.keys()],[...lm.keys()],[...rm.keys()],ids);
      if(order)return order.map(id=>values.get(id));
      conflicts.add([...path,'order'].join('/'));
      const preferred=side==='local'?[...lm.keys()]:[...rm.keys()],preferredIds=new Set(preferred);
      return [...preferred.filter(id=>ids.has(id)),...[...ids].filter(id=>!preferredIds.has(id)).sort()].map(id=>values.get(id));
    }
    if(record(l)&&record(r)&&(b===undefined||record(b))){
      const fields=path.at(-2)==='cells'?inputFields:path.length===3&&path[0]==='foodCapture'&&['foods','loggedDetails'].includes(path[1])?restaurantFields:undefined;
      if(fields){
        const content=(value:RecordValue|undefined)=>Object.fromEntries(Object.entries(value??{}).filter(([key,value])=>
          fields.has(key)&&value!==undefined&&!(key==='value'&&value===null)&&
          !(fields===restaurantFields&&key==='restaurantText'&&typeof value==='string'&&!value.trim())
        ));
        const bc=content(b as RecordValue|undefined),lc=content(l),rc=content(r);
        let chosen:RecordValue;
        if(syncEqual(lc,rc)||syncEqual(bc,rc))chosen=lc;
        else if(syncEqual(bc,lc))chosen=rc;
        else{conflicts.add([...path,fields===inputFields?'input':'restaurant'].join('/'));chosen=side==='local'?lc:rc;}
        const result:RecordValue={...chosen};
        for(const key of new Set([...Object.keys(b??{}),...Object.keys(l),...Object.keys(r)])){
          if(fields.has(key))continue;
          const value=visit(record(b)?b[key]:undefined,l[key],r[key],[...path,key],side);
          if(value!==undefined)result[key]=value;
        }
        return result;
      }
      if(['formula','calculation'].includes(path.at(-1)??''))return collision();
      const result:RecordValue={};
      for(const key of new Set([...Object.keys(b??{}),...Object.keys(l),...Object.keys(r)])){
        if(['__proto__','constructor','prototype'].includes(key))throw Error('Unsafe workbook property in sync merge.');
        const value=visit(record(b)?b[key]:undefined,l[key],r[key],[...path,key],side);
        if(value!==undefined)result[key]=value;
      }
      return result;
    }
    return collision();
  };
  return visit;
}
export function mergeSyncWorkbooks(base:Workbook,local:Workbook,remote:Workbook):SyncMerge{
  if(base.id!==local.id||base.id!==remote.id){
    if(sameSharedWorkbook(base,local)||sameSharedWorkbook(local,remote))return{local:withDevicePreferences(remote,local),remote:withDevicePreferences(remote,local),conflicts:[]};
    if(sameSharedWorkbook(base,remote))return{local,remote:local,conflicts:[]};
    return{local,remote,conflicts:['workbook/identity']};
  }
  const conflicts=new Set<string>(),visit=valueMerger(conflicts);
  const b=shared(base),l=shared(local),r=shared(remote);
  const left=visit(b,l,r,[],'local') as Workbook,right=conflicts.size?visit(b,l,r,[],'remote') as Workbook:left;
  left.revision=right.revision=Math.max(local.revision,remote.revision);
  const merged=withDevicePreferences(left,local);
  return{local:merged,remote:right===left?merged:withDevicePreferences(right,local),conflicts:[...conflicts]};
}
export function rebaseSyncHistory(before:Workbook,after:Workbook,history:UndoHistory,merge:(base:Workbook,local:Workbook,remote:Workbook)=>SyncMerge):UndoHistory{
  const visit=valueMerger(new Set<string>()),axes=new WeakMap<object,Set<string>>();
  const ids=(items:{id:string}[])=>{let result=axes.get(items);if(!result)axes.set(items,result=new Set(items.map(item=>item.id)));return result;};
  const rebase=(stack:History[]):History[]=>{
    let original=before,merged=after;
    const originalCells=new Map<string,Extract<History,{cells:unknown}>['cells'][number]>(),mergedCells=new Map<string,Extract<History,{cells:unknown}>['cells'][number]>();
    const result:History[]=[];
    for(const entry of [...stack].reverse()){
      if('cells'in entry){
        const oldSheets=new Map(allSheets(original).map(sheet=>[sheet.id,sheet])),newSheets=new Map(allSheets(merged).map(sheet=>[sheet.id,sheet]));
        const cells:Extract<History,{cells:unknown}>['cells']=[];
        for(const change of entry.cells){
          const target=newSheets.get(change.sheet),old=oldSheets.get(change.sheet),[row,column]=change.key.split(':');
          const address=`${change.sheet}/${change.key}`,oldValue=originalCells.has(address)?originalCells.get(address)!.value:old?.cells[change.key];
          originalCells.set(address,change);
          if(!target||!old||!ids(target.rows).has(row)||!ids(target.columns).has(column))continue;
          const current=mergedCells.has(address)?mergedCells.get(address)!.value:target.cells[change.key];
          const value=visit(oldValue,change.value,current,['cells',change.key],'remote') as Cell|undefined;
          if(!syncEqual(value,current)){const rebased={...change,value};cells.push(rebased);mergedCells.set(address,rebased);}
        }
        result.unshift({cells});continue;
      }
      if(originalCells.size){original=applyUndo(original,{cells:[...originalCells.values()]}).book;originalCells.clear();}
      if(mergedCells.size){merged=applyUndo(merged,{cells:[...mergedCells.values()]}).book;mergedCells.clear();}
      const previous=applyUndo(original,entry).book;
      const next=merge(original,previous,merged).remote;
      result.unshift(structuralUndo(next,merged));original=previous;merged=next;
    }
    return result;
  };
  return{undo:rebase(history.undo),redo:rebase(history.redo)};
}
