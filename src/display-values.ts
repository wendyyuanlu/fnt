import {type Engine} from './formula';
import {key,type Cell,type Value} from './model';

const textCaches=new WeakMap<Engine,Map<string,{cell:Cell;value:Value;text:string}>>();

export function cachedCellText(engine:Engine,sheet:string,row:string,column:string,cell:Cell,format:(value:Value)=>string):string{
  let cache=textCaches.get(engine);
  if(!cache){cache=new Map();textCaches.set(engine,cache);}
  const address=`${sheet}:${key(row,column)}`,previous=cache.get(address);
  if(previous?.cell===cell&&engine.cache.has(address)&&Object.is(previous.value,engine.cache.get(address)))return previous.text;
  const value=engine.cell(sheet,row,column),text=format(value);
  cache.set(address,{cell,value,text});return text;
}
