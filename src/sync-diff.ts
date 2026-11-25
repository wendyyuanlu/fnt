import {allSheets,allTables,letters,type Cell,type Sheet,type Workbook} from './model';
import {displayFormula} from './formula';

export interface WorkbookDifference {
  kind:'Cell'|'Structure'|'Settings';
  location:string;
  local:string;
  remote:string;
}
function same(a:unknown,b:unknown):boolean{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,index)=>same(value,b[index]));
  const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left).filter(key=>left[key]!==undefined);
  return keys.length===Object.keys(right).filter(key=>right[key]!==undefined).length&&keys.every(key=>Object.hasOwn(right,key)&&same(left[key],right[key]));
}
const text=(value:unknown):string=>value===undefined?'Not present':JSON.stringify(value,null,2);
function* properties(local:object|undefined,remote:object|undefined,location:string,kind:WorkbookDifference['kind'],skip:string[]=[]):Generator<WorkbookDifference|undefined>{
  const left=local as Record<string,unknown>|undefined,right=remote as Record<string,unknown>|undefined;
  for(const name of new Set([...Object.keys(left??{}),...Object.keys(right??{})])){
    if(skip.includes(name))continue;
    yield same(left?.[name],right?.[name])?undefined:{kind,location:`${location} / ${name}`,local:text(left?.[name]),remote:text(right?.[name])};
  }
}
function* entities<T extends {id:string}>(local:T[],remote:T[],location:string,label:(value:T,index:number)=>string):Generator<WorkbookDifference|undefined>{
  const left=new Map(local.map((value,index)=>[value.id,{value,index}])),right=new Map(remote.map((value,index)=>[value.id,{value,index}]));
  for(const id of new Set([...left.keys(),...right.keys()])){
    const a=left.get(id),b=right.get(id),name=a?label(a.value,a.index):label(b!.value,b!.index);
    if(!a||!b)yield{kind:'Structure',location:`${location} / ${name}`,local:text(a?.value),remote:text(b?.value)};
    else if(same(a.value,b.value))yield undefined;
    else yield* properties(a.value,b.value,`${location} / ${name}`,'Structure',['id']);
  }
  const commonLeft=local.filter(value=>right.has(value.id)),commonRight=remote.filter(value=>left.has(value.id));
  yield same(commonLeft.map(value=>value.id),commonRight.map(value=>value.id))?undefined:{
    kind:'Structure',location:`${location} / relative order`,
    local:text(commonLeft.map(value=>({id:value.id,label:label(value,left.get(value.id)!.index)}))),
    remote:text(commonRight.map(value=>({id:value.id,label:label(value,right.get(value.id)!.index)}))),
  };
}
function cellText(book:Workbook,cell:Cell|undefined):string{
  if(!cell)return 'No saved cell';
  const lines:string[]=[];
  if(cell.formula)lines.push(`Formula: ${displayFormula(cell.formula,book)}`);
  if(Object.hasOwn(cell,'value'))lines.push(`Value (${cell.value===null?'blank':typeof cell.value}): ${text(cell.value)}`);
  if(cell.calculation)lines.push(`Retained calculation: ${displayFormula(cell.calculation,book)}`);
  for(const [name,value]of Object.entries(cell))if(value!==undefined&&!['formula','value','calculation'].includes(name))lines.push(`${name}: ${text(value)}`);
  return lines.join('\n')||'Empty saved cell';
}
function cellLocator(book:Workbook,sheet:Sheet):(address:string)=>string{
  const rows=new Map(sheet.rows.map((row,index)=>[row.id,index])),columns=new Map(sheet.columns.map((column,index)=>[column.id,index]));
  const tables=allTables(book).filter(table=>table.sheet===sheet.id).map(table=>({table,rows:new Set([table.header,...table.rows]),columns:new Map(table.columns.map(column=>[column.column,column]))}));
  return address=>{
    const [row,column]=address.split(':'),r=rows.get(row),c=columns.get(column);
    const table=tables.find(table=>table.rows.has(row)&&table.columns.has(column));
    const field=table?.columns.get(column),nameField=table?.table.columns.find(field=>/^(ingredients?|food|meal)$/i.test(field.name));
    const record=nameField?sheet.cells[`${row}:${nameField.column}`]?.value:undefined;
    return`${sheet.name}!${c===undefined?'?':letters(c)}${r===undefined?'?':r+1}${table?` / ${table.table.name}[${field!.name}]`:''}${typeof record==='string'&&record?` / ${record}`:''}`;
  };
}
/** Undefined steps let callers yield to the browser even across long unchanged regions. */
export function* workbookDifferences(local:Workbook,remote:Workbook):Generator<WorkbookDifference|undefined>{
  const left=new Map(allSheets(local).map(sheet=>[sheet.id,sheet])),right=new Map(allSheets(remote).map(sheet=>[sheet.id,sheet]));
  for(const id of new Set([...left.keys(),...right.keys()])){
    const a=left.get(id),b=right.get(id),scope=(a??b)!.name;
    const locateA=a?cellLocator(local,a):undefined,locateB=b?cellLocator(remote,b):undefined;
    const compare=(address:string):WorkbookDifference|undefined=>{
      const cellA=a?.cells[address],cellB=b?.cells[address];
      if(same(cellA,cellB))return;
      const locationA=locateA?.(address),locationB=locateB?.(address);
      const location=locationA&&locationB&&locationA!==locationB?`This device: ${locationA}\nGitHub: ${locationB}`:locationA??locationB!;
      return{kind:'Cell',location,local:cellText(local,cellA),remote:cellText(remote,cellB)};
    };
    if(a)for(const address in a.cells)yield compare(address);
    if(b)for(const address in b.cells)if(!a||!Object.hasOwn(a.cells,address))yield compare(address);
    if(!a||!b)yield{kind:'Structure',location:`Sheet / ${scope}`,local:a?`${a.rows.length} rows, ${a.columns.length} columns`:'Not present',remote:b?`${b.rows.length} rows, ${b.columns.length} columns`:'Not present'};
    yield* properties(a,b,`Sheet / ${scope}`,'Settings',['id','cells','rows','columns','groups','validations']);
    yield* entities(a?.rows??[],b?.rows??[],`${scope} / rows`,(_row,index)=>`Row ${index+1}`);
    yield* entities(a?.columns??[],b?.columns??[],`${scope} / columns`,(column,index)=>`${letters(index)} (${column.label})`);
    yield* entities(a?.groups??[],b?.groups??[],`${scope} / groups`,group=>group.label||group.id);
    yield* entities(a?.validations??[],b?.validations??[],`${scope} / dropdown rules`,rule=>rule.id);
  }
  yield* entities(allTables(local),allTables(remote),'Tables',table=>table.name);
  yield* entities(local.names,remote.names,'Named formulas',name=>name.name);
  yield* entities(local.references??[],remote.references??[],'Dropdown sources',source=>source.label??source.name);
  yield* properties(local,remote,'Workbook','Settings',['sheets','tables','dropdownData','names','references','revision','tableActivity']);
  for(const [name,a,b]of [
    ['Workbook sheet order',local.sheets,remote.sheets],
    ['DD sheet order',local.dropdownData?.sheets??[],remote.dropdownData?.sheets??[]],
  ] as const){
    yield same(a.map(sheet=>sheet.id),b.map(sheet=>sheet.id))?undefined:{kind:'Structure',location:name,local:text(a.map(sheet=>sheet.name)),remote:text(b.map(sheet=>sheet.name))};
  }
}
