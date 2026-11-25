import {scalar,type Engine} from './formula';
import {allTables,isFault,key,type Cell,type Value,type Workbook} from './model';

const textCaches=new WeakMap<Engine,Map<string,{cell:Cell;value:Value;text:string;context?:string}>>();

export function cachedCellText(engine:Engine,sheet:string,row:string,column:string,cell:Cell,format:(value:Value)=>string,context?:string):string{
  let cache=textCaches.get(engine);
  if(!cache){cache=new Map();textCaches.set(engine,cache);}
  const address=`${sheet}:${key(row,column)}`,previous=cache.get(address);
  if(previous?.cell===cell&&previous.context===context&&engine.cache.has(address)&&Object.is(previous.value,engine.cache.get(address)))return previous.text;
  const value=engine.cell(sheet,row,column),text=format(value);
  cache.set(address,{cell,value,text,context});return text;
}
export function dateFormatContext(engine:Engine,book:Workbook,sheet:string,row:string,cell:Cell,year=new Date().getFullYear()){
  const when=cell.format?.dateWhen;let enabled=true,error:string|undefined;
  if(when){
    const table=allTables(book).find(table=>table.id===when.table),field=table?.columns.find(field=>field.id===when.column);
    if(!table||!field||table.sheet!==sheet||!table.rows.includes(row)){enabled=false;error='#REF!';}
    else{
      const value=scalar(engine.cell(sheet,row,field.column));
      if(isFault(value)){enabled=false;error=value.error;}
      else enabled=typeof value==='string'?!!value.trim():value!==null;
    }
  }
  return{enabled,error,year,key:`${year}:${enabled}:${error??''}`};
}
