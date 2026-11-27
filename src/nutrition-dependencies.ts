import {calculationWorkLimit,maySpill,type Ast} from './formula';
import {allSheets,allTables,key,type Workbook} from './model';

const transparentCalls=new Set(['IF','IFERROR','SUM','AVERAGE','MIN','MAX','INDEX','MATCH','XLOOKUP','XMATCH','LET','ROW','ROWS','ISNUMBER','DATE','DATEDIF','FIND','LEFT','RIGHT','ROUND','VALUE','AND','OR','NOT','COUNT','COUNTA','ABS','INT','CONCAT','LEN','TRIM','LOWER','UPPER']);
export function nutritionDependencyFilter(book:Workbook,changed:ReadonlySet<string>,conversionsChanged?:()=>boolean){
  const sheets=new Map(allSheets(book).map(sheet=>[sheet.id,sheet])),tables=new Map(allTables(book).map(table=>[table.id,table])),names=new Map(book.names.map(name=>[name.id,name]));
  const cells=new Map<string,boolean>(),vectors=new Map<string,boolean>(),visiting=new Set<string>(),spillSheets=new Map<string,boolean>();
  const positions=new Map<string,{rows:Map<string,number>;columns:Map<string,number>}>();
  let remaining=calculationWorkLimit,expressionRemaining=0,active=0;
  const step=()=>--remaining>=0&&--expressionRemaining>=0;
  const project=(read:()=>boolean):boolean=>{
    if(active++===0)expressionRemaining=50000;
    try{return read();}finally{active--;}
  };
  // Unknown dependencies, spills, cycles and exhausted work budgets conservatively require review.
  function cell(sheetId:string,row:string,column:string):boolean{
    const id=`${sheetId}:${key(row,column)}`;
    if(changed.has(id))return true;
    const cached=cells.get(id);if(cached!==undefined)return cached;
    if(!step()||visiting.has(id)||visiting.size>150)return true;
    const sheet=sheets.get(sheetId);if(!sheet)return true;
    const value=sheet.cells[key(row,column)];
    visiting.add(id);
    let result:boolean;
    if(value?.formula)result=(value.spillHint??(!book.importReport&&maySpill(value.formula)))||calculation(value.formula,sheetId,row,column);
    else if(value?.binding){
      const table=tables.get(value.binding.table),field=table?.columns.find(column=>column.id===value.binding!.column);
      result=!table||!field||cell(table.sheet,value.binding.row,field.column);
    }else if(value?.value==null){
      let spills=spillSheets.get(sheetId);
      if(spills===undefined){spills=Object.values(sheet.cells).some(cell=>!!cell.formula&&(cell.spillHint??(!book.importReport&&maySpill(cell.formula))));spillSheets.set(sheetId,spills);}
      result=spills;
    }else result=false;
    visiting.delete(id);cells.set(id,result);return result;
  }
  function calculation(ast:Ast,sheet:string,row:string,column:string,depth=0):boolean{
    if(!step()||depth>150)return true;
    const visit=(node:Ast)=>calculation(node,sheet,row,column,depth+1);
    switch(ast.kind){
      case'literal':case'error':case'variable':return false;
      case'ref':return cell(ast.sheet,ast.row,ast.column);
      case'spill':return true;
      case'unary':return visit(ast.child);
      case'binary':return visit(ast.left)||visit(ast.right);
      case'call':return ast.name==='UNITFACTOR'&&conversionsChanged?conversionsChanged()||ast.args.some(visit):!transparentCalls.has(ast.name)||ast.args.some(visit);
      case'name':{
        const name=names.get(ast.id),id='name:'+ast.id;if(!name||visiting.has(id))return true;
        visiting.add(id);const result=calculation(name.formula,name.context,row,column,depth+1);visiting.delete(id);return result;
      }
      case'structured':{
        const table=tables.get(ast.table);if(!table||ast.mode==='totals')return true;
        const id=`table:${table.id}:${ast.mode}:${ast.columns.join(',')}:${ast.mode==='row'?row:''}`,cached=vectors.get(id);
        if(cached!==undefined)return cached;
        const columns=ast.columns.map(id=>table.columns.find(column=>column.id===id));if(columns.some(column=>!column))return true;
        const rows=ast.mode==='row'?[row]:ast.mode==='headers'?[table.header]:ast.mode==='all'?[table.header,...table.rows]:table.rows;
        const result=rows.some(row=>columns.some(column=>cell(table.sheet,row,column!.column)));vectors.set(id,result);return result;
      }
      case'range':{
        if(ast.start.kind!=='ref'||ast.end.kind!=='ref'||ast.start.sheet!==ast.end.sheet)return true;
        const target=sheets.get(ast.start.sheet);if(!target)return true;
        let at=positions.get(target.id);
        if(!at){at={rows:new Map(target.rows.map((row,index)=>[row.id,index])),columns:new Map(target.columns.map((column,index)=>[column.id,index]))};positions.set(target.id,at);}
        const r1=at.rows.get(ast.start.row),r2=at.rows.get(ast.end.row),c1=at.columns.get(ast.start.column),c2=at.columns.get(ast.end.column);
        if(r1===undefined||r2===undefined||c1===undefined||c2===undefined)return true;
        const id=`range:${target.id}:${Math.min(r1,r2)}:${Math.max(r1,r2)}:${Math.min(c1,c2)}:${Math.max(c1,c2)}`,cached=vectors.get(id);
        if(cached!==undefined)return cached;
        const columns=target.columns.slice(Math.min(c1,c2),Math.max(c1,c2)+1);
        const result=target.rows.slice(Math.min(r1,r2),Math.max(r1,r2)+1).some(row=>columns.some(column=>cell(target.id,row.id,column.id)));
        vectors.set(id,result);return result;
      }
    }
  }
  return{
    cell:(sheet:string,row:string,column:string)=>project(()=>cell(sheet,row,column)),
    calculation:(ast:Ast,sheet:string,row:string,column:string)=>project(()=>calculation(ast,sheet,row,column))
  };
}
