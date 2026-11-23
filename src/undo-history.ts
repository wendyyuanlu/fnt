import {allSheets,clone,type Cell,type Workbook} from './model';

export const undoLimit=1000;
interface Patch {path:(string|number)[];exists:boolean;value?:unknown}
export type History={book:Workbook}|{cells:{sheet:string;key:string;value?:Cell}[]}|{patch:Patch[]};
export interface UndoHistory {undo:History[];redo:History[]}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value:object,key:string|number)=>Object.prototype.hasOwnProperty.call(value,key);

export function structuralUndo(before:Workbook,after:Workbook):History{
  const patch:Patch[]=[];
  const visit=(first:unknown,second:unknown,path:Patch['path'],exists=true)=>{
    if(Object.is(first,second))return;
    if(Array.isArray(first)&&Array.isArray(second)&&first.length===second.length&&!first.some((item,i)=>record(item)&&record(second[i])&&typeof item.id==='string'&&item.id!==second[i].id)){
      first.forEach((value,i)=>visit(value,second[i],[...path,i]));return;
    }
    if(record(first)&&record(second)){
      for(const key of new Set([...Object.keys(first),...Object.keys(second)])){
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

export function applyUndo(current:Workbook,entry:History):{book:Workbook;inverse:History}{
  if('book'in entry)return{book:clone(entry.book),inverse:{book:clone(current)}};
  const book=clone(current);
  if('cells'in entry){
    const inverse:Extract<History,{cells:unknown}>={cells:[]};
    for(const change of entry.cells){
      const sheet=allSheets(book).find(sheet=>sheet.id===change.sheet);
      if(!sheet)throw Error('Undo target no longer exists. Restore from recovery.');
      inverse.cells.push({sheet:sheet.id,key:change.key,value:clone(sheet.cells[change.key])});
      if(change.value)sheet.cells[change.key]=clone(change.value);else delete sheet.cells[change.key];
    }
    return{book,inverse};
  }
  const inverse:Patch[]=[];
  for(const change of entry.patch){
    if(!change.path.length||change.path.some(key=>['__proto__','constructor','prototype'].includes(String(key))))throw Error('Invalid undo history path. Restore from recovery.');
    let target:unknown=book;
    for(const key of change.path.slice(0,-1)){
      if(!target||typeof target!=='object'||!own(target,key))throw Error('Undo history does not match this workbook. Restore from recovery.');
      target=(target as Record<string|number,unknown>)[key];
    }
    if(!target||typeof target!=='object')throw Error('Undo history target is unavailable. Restore from recovery.');
    const container=target as Record<string|number,unknown>,key=change.path.at(-1)!;
    inverse.unshift({path:change.path,exists:own(container,key),value:clone(container[key])});
    if(change.exists)container[key]=clone(change.value);else delete container[key];
  }
  return{book,inverse:{patch:inverse}};
}
