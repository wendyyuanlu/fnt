import {allSheets,allTables,addRow,insertTableRows,clone,deleteRows,moveRows,type Workbook} from './model';
import {ingredientKey,ingredientMapping,ingredientRecord,rememberIngredients,type IngredientIdentity} from './food-capture';
import {missingDependencies} from './comparison-merge';
import type {Ast} from './formula';

function source(book:Workbook,identity?:IngredientIdentity){
  const mapping=ingredientMapping(book),table=allTables(book).find(table=>table.id===(identity?.table??mapping.table));
  const sheet=allSheets(book).find(sheet=>sheet.id===table?.sheet);
  if(!table||!sheet||table.id!==mapping.table||identity&&!table.rows.includes(identity.row))throw Error('This Ingredient table or row was removed. Reopen TABLE before editing.');
  return{table,sheet};
}
export function addIngredientTableRow(book:Workbook,after?:IngredientIdentity):IngredientIdentity{
  return insertIngredientTableRows(book,1,after)[0];
}
export function addIngredientTableRows(book:Workbook,count:number,initialize?:(identity:IngredientIdentity,index:number)=>void):IngredientIdentity[]{
  return insertIngredientTableRows(book,count,undefined,initialize);
}
function insertIngredientTableRows(book:Workbook,count:number,after?:IngredientIdentity,initialize?:(identity:IngredientIdentity,index:number)=>void):IngredientIdentity[]{
  const {table,sheet}=source(book,after),anchor=after?.row??table.rows.at(-1)??table.header;
  if(!Number.isInteger(count)||count<1)throw Error('Insert at least one whole Ingredient row.');
  if(sheet.rows.length+count>100000)throw Error('There is not enough worksheet space to add the Ingredients.');
  const food=ingredientMapping(book).fields.food;
  if(!table.columns.some(column=>column.id===food))throw Error('Restore the Ingredient name field before adding an Ingredient.');
  rememberIngredients(book);
  const at=sheet.rows.findIndex(row=>row.id===anchor)+1;
  // Header-kind formulas may inspect the intermediate table size; retain single-row semantics for them.
  if(count===1||table.columns.some(column=>['ismeal','isday','meal','weight'].includes(column.name.toLowerCase()))){
    return Array.from({length:count},(_,index)=>{
      const identity={table:table.id,row:addRow(book,sheet,at+index,table).id};
      initialize?.(identity,index);return identity;
    });
  }
  return insertTableRows(book,sheet,at,count,table,(row,index)=>initialize?.({table:table.id,row:row.id},index)).map(row=>({table:table.id,row:row.id}));
}
export function moveIngredientTableRow(book:Workbook,identity:IngredientIdentity,direction:-1|1):void{
  const {table,sheet}=source(book,identity),at=table.rows.indexOf(identity.row),next=table.rows[at+direction];
  if(!next)throw Error('This Ingredient is already at the table boundary.');
  if(sheet.groups.some(group=>group.axis==='row'&&group.members.includes(identity.row)))throw Error('Move this grouped Ingredient in the spreadsheet to preserve its whole group.');
  moveRows(book,sheet,[identity.row],sheet.rows.findIndex(row=>row.id===next)+(direction===1?1:0),table);
}
function uncertainUse(node:Ast,name:string):boolean{
  if(node.kind==='literal')return typeof node.value==='string'&&!!name&&node.value.trim().toLocaleLowerCase()===name;
  if(node.kind==='call')return node.name.replace(/_xlfn\.|_xlws\./gi,'').toUpperCase()==='INDIRECT'||node.args.some(arg=>uncertainUse(arg,name));
  if(node.kind==='binary')return uncertainUse(node.left,name)||uncertainUse(node.right,name);
  if(node.kind==='range')return uncertainUse(node.start,name)||uncertainUse(node.end,name);
  if(node.kind==='unary'||node.kind==='spill')return uncertainUse(node.child,name);
  return false;
}
export function deleteIngredientTableRow(book:Workbook,identity:IngredientIdentity):void{
  const {table,sheet}=source(book,identity),columns=new Set(table.columns.map(column=>column.column));
  if(allTables(book).some(other=>other.id!==table.id&&other.sheet===sheet.id&&[other.header,...other.rows].includes(identity.row))||
    Object.entries(sheet.cells).some(([address,cell])=>address.startsWith(identity.row+':')&&!columns.has(address.split(':')[1])&&(cell.value!=null||cell.formula||cell.binding||cell.note||cell.link)))
    throw Error('This Ingredient row shares other data. Manage its cells in the spreadsheet instead.');
  if(sheet.groups.some(group=>group.axis==='row'&&group.members.includes(identity.row)))throw Error('Remove this Ingredient from its row group in the spreadsheet first.');
  const name=ingredientRecord(book,identity).values.food?.trim().toLocaleLowerCase()??'';
  for(const other of allSheets(book))for(const [address,cell]of Object.entries(other.cells)){
    if(other.id===sheet.id&&address.startsWith(identity.row+':'))continue;
    if(typeof cell.value==='string'&&!!name&&cell.value.trim().toLocaleLowerCase()===name||cell.formula&&uncertainUse(cell.formula,name)||cell.calculation&&uncertainUse(cell.calculation,name))
      throw Error('This Ingredient may be used by a name lookup or dynamic formula. Resolve its uses in the spreadsheet before deleting it.');
  }
  if(book.names.some(item=>uncertainUse(item.formula,name)))throw Error('A named formula may use this Ingredient. Resolve its uses before deleting it.');
  const previous=missingDependencies(book),candidate=clone(book),target=allSheets(candidate).find(item=>item.id===sheet.id)!;
  deleteRows(candidate,target,[identity.row]);
  if([...missingDependencies(candidate)].some(item=>!previous.has(item)))throw Error('This Ingredient is linked by food or formulas. Unlink or replace those references before deleting it.');
  deleteRows(book,sheet,[identity.row]);
  const key=ingredientKey(identity);
  if(book.foodCapture){delete book.foodCapture.ingredientEdits[key];delete book.foodCapture.ingredientDetails[key];}
}
