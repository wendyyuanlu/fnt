import {allSheets,clone,type Cell,type Workbook} from './model';

export const undoLimit=1000;
export interface Patch {path:(string|number)[];exists:boolean;value?:unknown}
export type History={book:Workbook}|{cells:{sheet:string;key:string;value?:Cell}[]}|{patch:Patch[]};
export interface UndoHistory {undo:History[];redo:History[]}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value:object,key:string|number)=>Object.prototype.hasOwnProperty.call(value,key);

export function structuralUndo(before:unknown,after:unknown,skipCells=false):History{
  const patch:Patch[]=[];
  const visit=(first:unknown,second:unknown,path:Patch['path'],exists=true)=>{
    if(Object.is(first,second))return;
    if(Array.isArray(first)&&Array.isArray(second)&&first.length!==second.length&&!first.slice(0,Math.min(first.length,second.length)).some((item,i)=>record(item)&&record(second[i])&&typeof item.id==='string'&&item.id!==second[i].id)){
      if(first.length>second.length)patch.push({path:[...path,'length'],exists:true,value:first.length});
      for(let i=0;i<Math.max(first.length,second.length);i++){
        if(i<first.length&&i<second.length)visit(first[i],second[i],[...path,i]);
        else patch.push({path:[...path,i],exists:i<first.length,value:clone(first[i])});
      }
      if(first.length<second.length)patch.push({path:[...path,'length'],exists:true,value:first.length});
      return;
    }
    if(Array.isArray(first)&&Array.isArray(second)&&first.length===second.length&&!first.some((item,i)=>record(item)&&record(second[i])&&typeof item.id==='string'&&item.id!==second[i].id)){
      first.forEach((value,i)=>visit(value,second[i],[...path,i]));return;
    }
    if(record(first)&&record(second)){
      for(const key of new Set([...Object.keys(first),...Object.keys(second)])){
        if(skipCells&&key==='cells'&&typeof first.id==='string'&&Array.isArray(first.rows))continue;
        if(own(first,key)&&own(second,key))visit(first[key],second[key],[...path,key]);
        else patch.push({path:[...path,key],exists:own(first,key),value:clone(first[key])});
      }
      return;
    }
    patch.push({path,exists,value:clone(first)});
  };
  visit(before,after,[]);
  return{patch};
}

// Editing commands replace stored cells; unchanged cells and ASTs can stay shared.
export function editSnapshot(book:Workbook,cellSheets?:ReadonlySet<string>):Workbook{
  const empty=(s:ReturnType<typeof allSheets>[number])=>({...s,cells:{}});
  const snapshot=clone({...book,sheets:book.sheets.map(empty),...(book.dropdownData?{dropdownData:{...book.dropdownData,sheets:book.dropdownData.sheets.map(empty)}}:{})});
  const sources=new Map(allSheets(book).map(s=>[s.id,s]));
  for(const s of allSheets(snapshot)){
    const cells=sources.get(s.id)!.cells;
    s.cells=!cellSheets||cellSheets.has(s.id)?{...cells}:cells;
  }
  return snapshot;
}

export function applyUndo(current:Workbook,entry:History):{book:Workbook;inverse:History}{
  if('book'in entry)return{book:clone(entry.book),inverse:{book:clone(current)}};
  let book:Workbook;
  if('cells'in entry){
    book={...current,sheets:[...current.sheets],...(current.dropdownData?{dropdownData:{...current.dropdownData,sheets:[...current.dropdownData.sheets]}}:{})};
    const copied=new Map<string,ReturnType<typeof allSheets>[number]>();
    const inverse:Extract<History,{cells:unknown}>={cells:[]};
    for(const change of entry.cells){
      let sheet=copied.get(change.sheet);
      if(!sheet){
        const list=book.sheets.some(sheet=>sheet.id===change.sheet)?book.sheets:book.dropdownData?.sheets;
        const index=list?.findIndex(sheet=>sheet.id===change.sheet)??-1;
        if(!list||index<0)throw Error('Undo target no longer exists. Restore from recovery.');
        sheet={...list[index],cells:{...list[index].cells}};list[index]=sheet;copied.set(change.sheet,sheet);
      }
      if(['__proto__','constructor','prototype'].includes(change.key))throw Error('Invalid undo cell key. Restore from recovery.');
      inverse.cells.push({sheet:sheet.id,key:change.key,value:clone(sheet.cells[change.key])});
      if(change.value)sheet.cells[change.key]=clone(change.value);else delete sheet.cells[change.key];
    }
    return{book,inverse};
  }
  book={...current};
  const copied=new WeakSet<object>([book]);
  const inverse:Patch[]=[];
  for(const change of entry.patch){
    if(!change.path.length||change.path.some(key=>['__proto__','constructor','prototype'].includes(String(key))))throw Error('Invalid undo history path. Restore from recovery.');
    let target:unknown=book;
    for(const key of change.path.slice(0,-1)){
      if(!target||typeof target!=='object'||!own(target,key))throw Error('Undo history does not match this workbook. Restore from recovery.');
      const container=target as Record<string|number,unknown>,child=container[key];
      if(!child||typeof child!=='object')throw Error('Undo history does not match this workbook. Restore from recovery.');
      if(!copied.has(child)){
        const copy=Array.isArray(child)?[...child]:{...child};
        container[key]=copy;copied.add(copy);
      }
      target=container[key];
    }
    if(!target||typeof target!=='object')throw Error('Undo history target is unavailable. Restore from recovery.');
    const container=target as Record<string|number,unknown>,key=change.path.at(-1)!;
    inverse.push({path:change.path,exists:own(container,key),value:clone(container[key])});
    if(change.exists)container[key]=clone(change.value);else delete container[key];
  }
  return{book,inverse:{patch:inverse.reverse()}};
}

export function capturePatch(book:Workbook,paths:Patch['path'][]):Extract<History,{patch:unknown}>{
  return{patch:paths.map(path=>{
    if(!path.length||path.some(key=>['__proto__','constructor','prototype'].includes(String(key))))throw Error('Invalid change path.');
    let target:unknown=book;
    for(const key of path.slice(0,-1)){
      if(!target||typeof target!=='object'||!own(target,key))throw Error('Change target no longer exists.');
      target=(target as Record<string|number,unknown>)[key];
    }

    if(!target||typeof target!=='object')throw Error('Change target no longer exists.');
    const container=target as Record<string|number,unknown>,key=path.at(-1)!;
    return{path,exists:own(container,key),value:clone(container[key])};
  })};
}

export function patchDifference(before:Extract<History,{patch:unknown}>,after:Extract<History,{patch:unknown}>):Extract<History,{patch:unknown}>{
  const patch:Patch[]=[];
  before.patch.forEach((first,i)=>{
    const second=after.patch[i];
    if(first.exists!==second.exists){patch.push(first);return;}
    const difference=structuralUndo({value:first.value},{value:second.value});
    if('patch'in difference)for(const change of difference.patch)patch.push({...change,path:[...first.path,...change.path.slice(1)]});
  });
  return{patch};
}
