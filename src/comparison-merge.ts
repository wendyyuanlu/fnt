import {compare,align,meaningful,type Difference} from '../prototypes/comparison/comparison-model';
import {allSheets,allTables,clone,replaceTables,type Workbook,type Cell} from './model';
import {type Ast} from './formula';
import {validateBook} from './storage';

export interface ComparisonChoice{id:number;side:'left'|'right'}
const content=['value','formula','binding','note','link','dateLiteral','fractionInput','fractionLiteral','dayDateTable','original'] as const;
function property(target:object,name:string,value:unknown):void{
  if(['__proto__','constructor','prototype'].includes(name))throw Error('Unsafe comparison property. Neither workbook was changed.');
  if(value===undefined)Reflect.deleteProperty(target,name);else Reflect.set(target,name,clone(value));
}
function place<T extends {id:string}>(items:T[],value:T|undefined,id:string,source:readonly T[]):void{
  const at=items.findIndex(item=>item.id===id);
  if(!value){if(at>=0)items.splice(at,1);return;}
  if(at>=0){items[at]=clone(value);return;}
  const position=source.findIndex(item=>item.id===id),following=new Set(source.slice(position+1).map(item=>item.id));
  const next=items.findIndex(item=>following.has(item.id));items.splice(next<0?items.length:next,0,clone(value));
}
function reorder<T extends {id:string}>(items:T[],source:T[],ids:Set<string>):T[]{
  const byId=new Map(items.map(item=>[item.id,item])),kept=items.filter(item=>!ids.has(item.id)),before=new Map<string,string[]>();let pending:string[]=[];
  for(const item of source)if(ids.has(item.id)&&byId.has(item.id))pending.push(item.id);else if(byId.has(item.id)){if(pending.length)before.set(item.id,pending);pending=[];}
  return kept.flatMap(item=>[...(before.get(item.id)??[]).map(id=>byId.get(id)!),item]).concat(pending.map(id=>byId.get(id)!));
}
export function missingDependencies(book:Workbook):Set<string>{
  const missing=new Set<string>(),sheets=new Map(allSheets(book).map(sheet=>[sheet.id,{sheet,rows:new Set(sheet.rows.map(row=>row.id)),columns:new Set(sheet.columns.map(column=>column.id))}])),tables=new Map(allTables(book).map(table=>[table.id,table])),names=new Set(book.names.map(name=>name.id));
  const ast=(node:Ast,source:string):void=>{
    if(node.kind==='ref'){const sheet=sheets.get(node.sheet);if(!sheet?.rows.has(node.row)||!sheet.columns.has(node.column))missing.add(`cell reference ${node.sheet}/${node.row}/${node.column} in ${source}`);}
    else if(node.kind==='structured'){const table=tables.get(node.table);if(!table||node.columns.some(id=>!table.columns.some(column=>column.id===id)))missing.add(`table reference ${node.table}/${node.columns.join(',')} in ${source}`);}
    else if(node.kind==='name'){if(!names.has(node.id))missing.add(`named formula ${node.id} in ${source}`);}
    else if(node.kind==='binary'){ast(node.left,source);ast(node.right,source);}
    else if(node.kind==='range'){ast(node.start,source);ast(node.end,source);}
    else if(node.kind==='unary'||node.kind==='spill')ast(node.child,source);
    else if(node.kind==='call')node.args.forEach(node=>ast(node,source));
  };
  for(const {sheet,rows,columns}of sheets.values()){
    for(const [address,cell]of Object.entries(sheet.cells)){
      const [row,column]=address.split(':');
      if(!rows.has(row)||!columns.has(column))missing.add(`cell outside its sheet ${sheet.id}/${address}`);
      if(cell.formula)ast(cell.formula,`${sheet.id}/${address}/formula`);if(cell.calculation)ast(cell.calculation,`${sheet.id}/${address}/calculation`);
      if(cell.binding){const table=tables.get(cell.binding.table);if(!table?.rows.includes(cell.binding.row)||!table.columns.some(column=>column.id===cell.binding!.column))missing.add(`linked source ${cell.binding.table}/${cell.binding.row}/${cell.binding.column} in ${sheet.id}/${address}`);}
    }
    for(const group of sheet.groups)if(group.members.some(id=>!(group.axis==='row'?rows:columns).has(id))||group.table&&!tables.has(group.table))missing.add(`group ${group.id}`);
    for(const rule of sheet.validations)if(rule.rows.some(id=>!rows.has(id))||rule.columns.some(id=>!columns.has(id)))missing.add(`dropdown ${rule.id}`);
    if(sheet.dayLogging){const config=sheet.dayLogging,table=tables.get(config.table);if(!table||table.sheet!==sheet.id||[config.date,config.marker,config.label,...config.totals,...(config.food?[config.food]:[])].some(id=>!table.columns.some(field=>field.id===id)))missing.add(`day logging ${sheet.id}`);}
  }
  for(const table of tables.values()){
    const sheet=sheets.get(table.sheet);
    if(!sheet?.rows.has(table.header)||table.rows.some(id=>!sheet.rows.has(id))||table.columns.some(column=>!sheet.columns.has(column.column)))missing.add(`table membership ${table.id}`);
    for(const field of table.columns){const label=sheet?.sheet.cells[`${table.header}:${field.column}`]?.value;if(label!==field.name)missing.add(`table header ${table.id}/${field.id}`);}
  }
  for(const name of book.names)ast(name.formula,name.id);
  for(const food of book.foodCapture?.foods??[]){
    if(food.ingredient&&!tables.get(food.ingredient.table)?.rows.includes(food.ingredient.row))missing.add(`draft Ingredient ${food.id}/${food.ingredient.table}/${food.ingredient.row}`);
    if(food.loggingTarget&&tables.get(food.loggingTarget.table)?.sheet!==food.loggingTarget.sheet)missing.add(`draft logging target ${food.id}/${food.loggingTarget.table}/${food.loggingTarget.sheet}`);
  }
  return missing;
}
export async function mergeComparison(left:Workbook,right:Workbook,choices:readonly ComparisonChoice[]):Promise<Workbook>{
  validateBook(left);validateBook(right);
  const differences=await compare(left,right),byId=new Map(differences.map(difference=>[difference.id,difference])),selected=new Map<number,'left'|'right'>();
  for(const choice of choices){
    if(!Number.isSafeInteger(choice.id)||!byId.has(choice.id)||!['left','right'].includes(choice.side)||selected.has(choice.id))throw Error('The comparison selection is invalid. Reopen comparison and choose again.');
    selected.set(choice.id,choice.side);
  }
  if(!selected.size)throw Error('Choose at least one change before applying.');
  const result=clone(left),side=(difference:Difference)=>selected.get(difference.id)??'left',source=(difference:Difference)=>side(difference)==='right'?right:left;
  const chosen=(difference:Difference)=>side(difference)==='right'?difference.right:difference.left;
  const deletions=new Set<string>(),deletionKey=(...parts:string[])=>JSON.stringify(parts);
  for(const difference of differences)if(selected.get(difference.id)==='right'&&difference.right===undefined){
    const target=difference.target;
    if(target?.kind==='sheet'&&!target.property)deletions.add(deletionKey('sheet',target.id));
    if(target?.kind==='axis'&&!target.property)deletions.add(deletionKey(target.axis,target.sheet,target.id));
  }
  const sheet=(id:string)=>allSheets(result).find(sheet=>sheet.id===id);
  const requireTarget=<T extends object>(target:T|undefined,difference:Difference)=>{if(!target&&chosen(difference)!==undefined)throw Error(`${difference.label} needs its containing sheet, row, column or table. Choose the related structural changes and retry.`);return target;};
  for(const difference of differences){
    const target=difference.target;if(!target)throw Error('This comparison change has no safe apply target.');
    const origin=source(difference);
    if(target.kind==='sheet'&&!target.property){
      const value=allSheets(origin).find(sheet=>sheet.id===target.id);
      result.sheets=result.sheets.filter(sheet=>sheet.id!==target.id);
      if(result.dropdownData)result.dropdownData.sheets=result.dropdownData.sheets.filter(sheet=>sheet.id!==target.id);
      if(value){if(origin.sheets.includes(value))place(result.sheets,value,value.id,origin.sheets);else{result.dropdownData??={sheets:[],tables:[]};place(result.dropdownData.sheets,value,value.id,origin.dropdownData!.sheets);}}
    }else if(target.kind==='table'&&!target.property){
      const value=allTables(origin).find(table=>table.id===target.id),tables=allTables(result).filter(table=>table.id!==target.id);
      if(value)place(tables,value,value.id,allTables(origin));replaceTables(result,tables);
    }
  }
  for(const difference of differences){
    const target=difference.target!;
    if(target.kind==='axis'&&!target.property){
      const destination=sheet(target.sheet),origin=allSheets(source(difference)).find(sheet=>sheet.id===target.sheet);
      if(!requireTarget(destination,difference))continue;
      if(target.axis==='row')place(destination!.rows,origin?.rows.find(row=>row.id===target.id),target.id,origin?.rows??[]);
      else place(destination!.columns,origin?.columns.find(column=>column.id===target.id),target.id,origin?.columns??[]);
    }
  }
  for(const difference of differences){
    const target=difference.target!,value=chosen(difference);
    if(target.kind==='workbook')property(result,target.property,value);
    else if(target.kind==='sheet'&&target.property){const destination=requireTarget(sheet(target.id),difference);if(destination)property(destination,target.property,value);}
    else if(target.kind==='table'&&target.property){const destination=requireTarget(allTables(result).find(table=>table.id===target.id),difference);if(destination)property(destination,target.property,value);}
    else if(target.kind==='axis'&&target.property){
      const s=sheet(target.sheet),destination=requireTarget((target.axis==='row'?s?.rows:s?.columns)?.find(item=>item.id===target.id),difference);
      if(destination){
        if(target.table){destination.hypotheticalTables??={};property(destination.hypotheticalTables,target.table,value);}
        else property(destination,target.property,value);
      }
    }else if(target.kind==='cell'){
      const s=sheet(target.sheet),[row,column]=target.address.split(':'),origin=allSheets(source(difference)).find(sheet=>sheet.id===target.sheet)?.cells[target.address];
      const hasRow=s?.rows.some(item=>item.id===row),hasColumn=s?.columns.some(item=>item.id===column);
      if(!s||!hasRow||!hasColumn){
        const deletedParent=!s?deletions.has(deletionKey('sheet',target.sheet)):
          (hasRow||deletions.has(deletionKey('row',target.sheet,row)))&&(hasColumn||deletions.has(deletionKey('column',target.sheet,column)));
        // Older reviews omitted these cells; an explicit parent deletion includes their metadata.
        if(!selected.has(difference.id)&&target.part==='whole'&&meaningful(origin)===undefined&&deletedParent){
          if(s)delete s.cells[target.address];continue;
        }
        if(origin)throw Error(`${difference.label} needs its row and column. Choose their structural changes and retry.`);
        if(s)delete s.cells[target.address];continue;
      }
      if(target.part==='whole'){
        if(origin)s.cells[target.address]=clone(origin);else delete s.cells[target.address];
        continue;
      }
      const cell:Cell=clone(s.cells[target.address]??{});
      const keys=target.part==='format'?['format']:target.part==='metadata'?['format','calculation','spillHint']:target.part==='date'?[...content,'calculation','spillHint']:content;
      for(const name of keys)property(cell,name,origin?Reflect.get(origin,name):undefined);
      if(Object.values(cell).some(value=>value!==undefined))s.cells[target.address]=cell;else delete s.cells[target.address];
    }else if(target.kind==='group'||target.kind==='validation'){
      const s=requireTarget(sheet(target.sheet),difference),origin=allSheets(source(difference)).find(sheet=>sheet.id===target.sheet);
      if(!s)continue;
      if(target.kind==='group')place(s.groups,origin?.groups.find(group=>group.id===target.id),target.id,origin?.groups??[]);
      else place(s.validations,origin?.validations.find(rule=>rule.id===target.id),target.id,origin?.validations??[]);
    }
  }
  const moves=new Map<string,{sheet:string;axis:'row'|'column';ids:Set<string>}>();
  for(const difference of differences)if(difference.target?.kind==='order'&&side(difference)==='right'){
    const target=difference.target,key=`${target.sheet}/${target.axis}`;let move=moves.get(key);if(!move)moves.set(key,move={sheet:target.sheet,axis:target.axis,ids:new Set()});move.ids.add(target.id);
  }
  for(const move of moves.values()){
    const s=sheet(move.sheet),origin=allSheets(right).find(sheet=>sheet.id===move.sheet);if(!s||!origin)continue;
    if(move.axis==='row')s.rows=reorder(s.rows,origin.rows,move.ids);else s.columns=reorder(s.columns,origin.columns,move.ids);
  }
  for(const difference of differences)if(difference.target?.kind==='workbook-order'&&side(difference)==='right'){
    const target=difference.target,order=chosen(difference) as string[];
    if(target.property==='tables'){const tables=allTables(result),byId=new Map(tables.map(table=>[table.id,table]));replaceTables(result,align(order.filter(id=>byId.has(id)),tables.map(table=>table.id)).map(id=>byId.get(id)!));}
    else{const items=target.property==='sheets'?result.sheets:result.dropdownData?.sheets;if(items){const byId=new Map(items.map(sheet=>[sheet.id,sheet])),ordered=align(order.filter(id=>byId.has(id)),items.map(sheet=>sheet.id)).map(id=>byId.get(id)!);if(target.property==='sheets')result.sheets=ordered;else result.dropdownData!.sheets=ordered;}}
  }
  validateBook(result);
  const existing=new Set([...missingDependencies(left),...missingDependencies(right)]),introduced=[...missingDependencies(result)].filter(issue=>!existing.has(issue));
  if(introduced.length)throw Error(`These choices would break ${introduced.length} structural or formula dependencies (${introduced.slice(0,3).join('; ')}). Choose the related table, row, column, dropdown or formula changes and retry. Neither workbook was changed.`);
  return result;
}
