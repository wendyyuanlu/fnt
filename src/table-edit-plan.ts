import {displayFormula,Engine,type Ast} from './formula';
import { allSheets,allTables,addTableColumns,addTableRows,clone,getCell,inheritInsertedGroups,isFault,letters,uid,type Value,type Workbook} from './model';
import {editTableAxis,TableExpansionConflict,type TableAxisEdit,type CellMoveTrace} from './table-operations';
import {editSnapshot} from './undo-history';

export interface FormulaImpact{
  sheet:string;row:string;column:string;afterRow:string;afterColumn:string;
  before:string;after:string;reason:'broken'|'changed'|'updated'|'review';beforeValue:Value;afterValue:Value;
}
export interface TableEditPlan{
  book:Workbook;ids:string[];shift?:{axis:'row'|'column';count:number;boundary:number;impacts:FormulaImpact[]};
}
function sensitive(ast:Ast,book:Workbook,context:string,moved:ReadonlySet<string>):boolean{
  if(ast.kind==='call'){
    if(ast.name==='INDIRECT'){
      const source=ast.args[0];
      if(source?.kind!=='literal'||typeof source.value!=='string')return moved.size>0;
      const name=source.value.includes('!')?source.value.slice(0,source.value.lastIndexOf('!')).replace(/^'|'$/g,'').replace(/''/g,"'"):undefined;
      const id=name?allSheets(book).find(sheet=>sheet.name.toLowerCase()===name.toLowerCase())?.id:context;
      if(id&&moved.has(id))return true;
    }
    return ast.args.some(child=>sensitive(child,book,context,moved));
  }
  if(ast.kind==='binary')return sensitive(ast.left,book,context,moved)||sensitive(ast.right,book,context,moved);
  if(ast.kind==='unary'||ast.kind==='spill')return sensitive(ast.child,book,context,moved);
  if(ast.kind==='range')return sensitive(ast.start,book,context,moved)||sensitive(ast.end,book,context,moved);
  return false;
}
export function formulaImpacts(before:Workbook,after:Workbook,trace=new Map<string,{sheet:string;row:string;column:string}|null>()):FormulaImpact[]{
  const first=new Engine(before),second=new Engine(after),impacts:FormulaImpact[]=[];
  const beforeSheets=new Map(allSheets(before).map(s=>[s.id,s]));
  const movedSheets=new Set(allSheets(after).filter(sheet=>{const old=beforeSheets.get(sheet.id);return old&&(old.rows.length!==sheet.rows.length||old.columns.length!==sheet.columns.length||old.rows.some((row,i)=>row.id!==sheet.rows[i]?.id)||old.columns.some((column,i)=>column.id!==sheet.columns[i]?.id));}).map(sheet=>sheet.id));
  for(const s of allSheets(after)){
    const old=beforeSheets.get(s.id);if(!old)continue;
    const oldRows=new Map(old.rows.map((r,i)=>[r.id,i])),newRows=new Map(s.rows.map((r,i)=>[r.id,i]));
    const oldColumns=new Map(old.columns.map((c,i)=>[c.id,i])),newColumns=new Map(s.columns.map((c,i)=>[c.id,i]));
    for(const [address,previous] of Object.entries(old.cells)){
      const original=previous.formula??previous.calculation;if(!original)continue;
      const [row,column]=address.split(':'),id=`${s.id}:${address}`,target=trace.has(id)?trace.get(id):{sheet:s.id,row,column};
      if(!target)continue;
      const cell=getCell(s,target.row,target.column),ast=cell.formula??cell.calculation;if(!ast)continue;
      const from=displayFormula(original,before),to=displayFormula(ast,after);
      const moved=oldRows.get(row)!==newRows.get(target.row)||oldColumns.get(column)!==newColumns.get(target.column);
      const beforeValue=first.cell(s.id,row,column),afterValue=second.cell(s.id,target.row,target.column);
      const uncertain=isFault(beforeValue)&&beforeValue.error==='#LIMIT!'||isFault(afterValue)&&afterValue.error==='#LIMIT!';
      const broken=isFault(afterValue)&&(!isFault(beforeValue)||beforeValue.error!==afterValue.error);
      const changed=JSON.stringify(beforeValue)!==JSON.stringify(afterValue);
      const review=sensitive(ast,after,s.id,movedSheets);
      if(!moved&&from===to&&!broken&&!changed&&!uncertain&&!review)continue;
      impacts.push({sheet:s.id,row,column,afterRow:target.row,afterColumn:target.column,before:from,after:to,beforeValue,afterValue,reason:uncertain?'review':broken?'broken':changed?'changed':review?'review':'updated'});
    }
  }
  return impacts.sort((a,b)=>['broken','review','changed','updated'].indexOf(a.reason)-['broken','review','changed','updated'].indexOf(b.reason));
}
/** candidate must be an independent snapshot of book; it is consumed even if planning fails. */
export function planTableAxisEdit(book:Workbook,tableId:string,axis:'row'|'column',edit:TableAxisEdit,options:{candidate?:Workbook;trace?:CellMoveTrace}={}):TableEditPlan{
  if(options.candidate===book)throw Error('Table planning requires an independent candidate workbook.');
  const owner=allTables(book).find(table=>table.id===tableId);
  if(!owner)throw Error('The selected table no longer exists.');
  const next=options.candidate??editSnapshot(book,new Set([owner.sheet]));
  try{return{book:next,ids:editTableAxis(next,tableId,axis,edit,options.trace,{ownedCandidate:true})};}
  catch(error){
    if(!(error instanceof TableExpansionConflict))throw error;
    const table=allTables(next).find(t=>t.id===tableId)!,sheet=allSheets(next).find(s=>s.id===table.sheet)!,{boundary,count}=error;
    const items=axis==='row'?sheet.rows:sheet.columns;
    if(items.length+count>(axis==='row'?100_000:512))throw Error('There is not enough sheet space for this shift.');
    const crossing=allTables(next).filter(other=>{
      if(other.sheet!==sheet.id||other.id===tableId)return false;
      const members=new Set(axis==='row'?[other.header,...other.rows]:other.columns.map(field=>field.column));
      const positions=items.map((item,i)=>members.has(item.id)?i:-1).filter(i=>i>=0);
      return positions.length&&Math.min(...positions)<boundary&&Math.max(...positions)>=boundary;
    });
    const insertions=Array.from({length:count},()=>({id:uid(),label:'New column',width:145}));
    inheritInsertedGroups(sheet,axis,insertions.map(item=>({at:boundary,id:item.id})),new Set(crossing.map(other=>other.id)));
    if(axis==='row')sheet.rows.splice(boundary,0,...insertions.map(({id})=>({id})));else sheet.columns.splice(boundary,0,...insertions);
    for(const other of crossing)if(axis==='row')addTableRows(next,sheet,other,insertions.map(item=>item.id));else addTableColumns(next,sheet,other,insertions.map(item=>item.id));
    const trace=new Map<string,{sheet:string;row:string;column:string}|null>(),ids=editTableAxis(next,tableId,axis,edit,trace,{ownedCandidate:true});
    if(options.trace)for(const [source,target] of trace)options.trace(source,target);
    return{book:next,ids,shift:{axis,count,boundary,impacts:formulaImpacts(book,next,trace)}};
  }
}
export function formulaCellContext(book:Workbook,sheetId:string,row:string,column:string,engine=new Engine(book)):{address:string;columns:string[];rows:{number:number;cells:{value:string;focused:boolean}[]}[]}{
  const sheet=allSheets(book).find(s=>s.id===sheetId)!;
  const r=sheet.rows.findIndex(item=>item.id===row),c=sheet.columns.findIndex(item=>item.id===column);
  const firstRow=Math.max(0,r-1),firstColumn=Math.max(0,c-1),lastRow=Math.min(sheet.rows.length-1,r+1),lastColumn=Math.min(sheet.columns.length-1,c+1);
  const text=(value:Value):string=>Array.isArray(value)?value.map(text).join(', '):isFault(value)?value.error:value===null?'':String(value);
  return{address:`${sheet.name}!${letters(c)}${r+1}`,columns:sheet.columns.slice(firstColumn,lastColumn+1).map((_,i)=>letters(firstColumn+i)),rows:sheet.rows.slice(firstRow,lastRow+1).map((row,i)=>({
    number:firstRow+i+1,cells:sheet.columns.slice(firstColumn,lastColumn+1).map((column,j)=>({value:text(engine.cell(sheet.id,row.id,column.id)),focused:firstRow+i===r&&firstColumn+j===c}))
  }))};
}
