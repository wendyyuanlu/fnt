import { compile, Engine, type Ast } from './formula';
import { allTables,allSheets, fault, isFault, key, uid, type Cell, type Sheet, type Table, type Workbook } from './model';

export interface CellRange { r1:number; r2:number; c1:number; c2:number }
type Address={sheet:string;row:string;column:string};
const addressKey=(a:Address)=>`${a.sheet}:${key(a.row,a.column)}`;
const limit=200_000;

function checkRange(sheet:Sheet,b:CellRange):void {
  if(!Object.values(b).every(Number.isInteger)||b.r1<0||b.c1<0||b.r2<b.r1||b.c2<b.c1||b.r2>=sheet.rows.length||b.c2>=sheet.columns.length)throw Error('Cell range is outside the sheet.');
}
function occupied(cell:Cell|undefined):boolean {
  return !!cell&&(cell.value!=null||!!cell.formula||!!cell.calculation||!!cell.binding||!!cell.note||!!cell.link);
}
function protectTables(book:Workbook,addresses:Set<string>,owner?:Table):void {
  const sheets=new Set([...addresses].map(id=>id.slice(0,id.indexOf(':'))));
  for(const t of allTables(book).filter(t=>t!==owner&&sheets.has(t.sheet)))for(const r of [t.header,...t.rows])for(const c of t.columns){
    if(addresses.has(`${t.sheet}:${key(r,c.column)}`))throw Error('Partial cell moves cannot split table records. Move whole table rows or columns instead.');
  }
}
export function relocate(book:Workbook,mapping:Map<string,Address|null>,inserted=new Set<string>(),owner?:Table):void {
  const touched=new Set([...mapping.keys(),...[...mapping.values()].filter((a):a is Address=>a!==null).map(addressKey)]);
  protectTables(book,touched,owner);
  const sheets=new Map(allSheets(book).map(s=>[s.id,s]));
  const indices=new Map(allSheets(book).map(s=>[s.id,{rows:new Map(s.rows.map((r,i)=>[r.id,i])),columns:new Map(s.columns.map((c,i)=>[c.id,i]))}]));
  const touchedBounds=new Map<string,{row:number;column:number}>();
  for(const id of touched){
    const [sheet,row,column]=id.split(':'),index=indices.get(sheet)!,bounds=touchedBounds.get(sheet)??{row:-1,column:-1};
    bounds.row=Math.max(bounds.row,index.rows.get(row)!);bounds.column=Math.max(bounds.column,index.columns.get(column)!);touchedBounds.set(sheet,bounds);
  }
  let engine:Engine|undefined;
  for(const s of allSheets(book).filter(s=>touchedBounds.has(s.id)))for(const [k,cell]of Object.entries(s.cells)){
    if(!cell.spillHint)continue;
    const [row,column]=k.split(':'),r=indices.get(s.id)!.rows.get(row)!,c=indices.get(s.id)!.columns.get(column)!,bounds=touchedBounds.get(s.id);
    const potentiallyAffected=bounds&&bounds.row>=r&&bounds.column>=c;
    if(!potentiallyAffected)continue;
    const value=(engine??=new Engine(book)).cell(s.id,row,column);
    if(isFault(value)&&value.error==='#LIMIT!')throw Error('Cannot safely verify array boundaries within the calculation limit.');
    if([...engine.spills.keys()].some(id=>touched.has(id)))throw Error('This operation intersects generated spill cells. Edit the array anchor instead.');
  }
  const moved=new Map([...mapping].filter(([id,target])=>!target||addressKey(target)!==id));
  const memo=new WeakMap<Ast,Ast>();
  const rewrite=(ast:Ast):Ast=>{
    const cached=memo.get(ast);if(cached)return cached;
    let result:Ast=ast;
    if(ast.kind==='ref'){
      const id=addressKey(ast);
      if(moved.has(id)){
        const target=moved.get(id);
        result=target?{...ast,...target,explicit:ast.explicit||target.sheet!==ast.sheet}:{kind:'error',value:fault('#REF!','Referenced cell was deleted.')};
      }
    }else if(ast.kind==='range'&&ast.start.kind==='ref'&&ast.end.kind==='ref'&&ast.start.sheet===ast.end.sheet){
      const s=sheets.get(ast.start.sheet),index=indices.get(ast.start.sheet);
      const r1=index?.rows.get(ast.start.row),r2=index?.rows.get(ast.end.row),c1=index?.columns.get(ast.start.column),c2=index?.columns.get(ast.end.column);
      if(s&&r1!==undefined&&r2!==undefined&&c1!==undefined&&c2!==undefined){
        let affected=false;
        for(const id of moved.keys()){
          const [sheet,row,column]=id.split(':'),r=index!.rows.get(row),c=index!.columns.get(column);
          if(sheet===s.id&&r!==undefined&&c!==undefined&&r>=Math.min(r1,r2)&&r<=Math.max(r1,r2)&&c>=Math.min(c1,c2)&&c<=Math.max(c1,c2)){affected=true;break;}
        }
        if(affected){
          if((Math.abs(r2-r1)+1)*(Math.abs(c2-c1)+1)>limit)throw Error('Referenced range exceeds the safe cell-move limit. Move whole rows or columns instead.');
          const targets:Address[]=[];
          for(const r of s.rows.slice(Math.min(r1,r2),Math.max(r1,r2)+1))for(const c of s.columns.slice(Math.min(c1,c2),Math.max(c1,c2)+1)){
            const old={sheet:s.id,row:r.id,column:c.id},id=addressKey(old),target=mapping.has(id)?mapping.get(id):old;
            if(target)targets.push(target);
          }
          if(!targets.length)result={kind:'error',value:fault('#REF!','Referenced range was deleted.')};
          else{
            const targetSheet=sheets.get(targets[0].sheet)!,positions=indices.get(targetSheet.id)!;
            if(targets.some(a=>a.sheet!==targetSheet.id))throw Error('This move would split a referenced range across sheets. Move the entire range instead.');
            const rows=targets.map(a=>positions.rows.get(a.row)!),cols=targets.map(a=>positions.columns.get(a.column)!);
            const loR=Math.min(...rows),hiR=Math.max(...rows),loC=Math.min(...cols),hiC=Math.max(...cols);
            const mapped=new Set(targets.map(addressKey));
            if((hiR-loR+1)*(hiC-loC+1)>limit)throw Error('This move would expand a referenced range beyond the safe limit.');
            for(let r=loR;r<=hiR;r++)for(let c=loC;c<=hiC;c++){
              const id=`${targetSheet.id}:${key(targetSheet.rows[r].id,targetSheet.columns[c].id)}`;
              if(!mapped.has(id)&&!inserted.has(id))throw Error('This move would fragment a referenced range. Move the entire range or whole rows/columns instead.');
            }
            const endpoint=(original:Extract<Ast,{kind:'ref'}>,r:number,c:number):Ast=>({...original,sheet:targetSheet.id,row:targetSheet.rows[r].id,column:targetSheet.columns[c].id,explicit:original.explicit||targetSheet.id!==original.sheet});
            result={kind:'range',start:endpoint(ast.start,r1<=r2?loR:hiR,c1<=c2?loC:hiC),end:endpoint(ast.end,r1<=r2?hiR:loR,c1<=c2?hiC:loC)};
          }
        }
      }
    }else if(ast.kind==='binary'){
      const left=rewrite(ast.left),right=rewrite(ast.right);if(left!==ast.left||right!==ast.right)result={...ast,left,right};
    }else if(ast.kind==='unary'||ast.kind==='spill'){
      const child=rewrite(ast.child);if(child!==ast.child)result={...ast,child};
    }else if(ast.kind==='range'){
      const start=rewrite(ast.start),end=rewrite(ast.end);if(start!==ast.start||end!==ast.end)result={...ast,start,end};
    }else if(ast.kind==='call'){
      const args=ast.args.map(rewrite);if(args.some((arg,i)=>arg!==ast.args[i]))result={...ast,args};
    }
    memo.set(ast,result);return result;
  };
  const cells=new Map(allSheets(book).map(s=>[s.id,s.cells])),copied=new Set<string>();
  const writable=(sheet:string):Record<string,Cell>=>{
    if(!copied.has(sheet)){cells.set(sheet,{...cells.get(sheet)!});copied.add(sheet);}
    return cells.get(sheet)!;
  };
  const destinations=new Set([...mapping.values()].filter((a):a is Address=>a!==null).map(addressKey));
  for(const id of new Set([...moved.keys(),...[...destinations].filter(id=>!mapping.has(id))])){
    const [sheet,row,column]=id.split(':');delete writable(sheet)[key(row,column)];
  }
  for(const s of allSheets(book))for(const [k,cell]of Object.entries(s.cells)){
    const [row,column]=k.split(':'),old={sheet:s.id,row,column},id=addressKey(old),target=mapping.has(id)?mapping.get(id):old;
    if(!target)continue;
    if(!mapping.has(id)&&destinations.has(id))continue;
    if(cell.spillHint&&touched.has(id))throw Error('Move array formulas by editing their anchor, not by partial cell shifts or cuts.');
    let formula=cell.formula?rewrite(cell.formula):undefined;
    let calculation=cell.calculation?rewrite(cell.calculation):undefined;
    if((formula||calculation)&&target.sheet!==s.id){
      const qualify=(ast:Ast):Ast=>{
        if(ast.kind==='ref')return {...ast,explicit:ast.explicit||ast.sheet!==target.sheet};
        if(ast.kind==='binary')return {...ast,left:qualify(ast.left),right:qualify(ast.right)};
        if(ast.kind==='unary'||ast.kind==='spill')return {...ast,child:qualify(ast.child)};
        if(ast.kind==='range')return {...ast,start:qualify(ast.start),end:qualify(ast.end)};
        if(ast.kind==='call')return {...ast,args:ast.args.map(qualify)};
        return ast;
      };
      if(formula)formula=qualify(formula);
      if(calculation)calculation=qualify(calculation);
    }
    let binding=cell.binding;
    if(owner&&binding?.table===owner.id){
      const field=owner.columns.find(field=>field.id===binding!.column);
      if(field){
        const sourceId=addressKey({sheet:owner.sheet,row:binding.row,column:field.column});
        if(mapping.has(sourceId)){
          const source=mapping.get(sourceId);
          if(source)binding={...binding,row:source.row};
          else{binding=undefined;formula={kind:'error',value:fault('#REF!','Linked table record or field was deleted.')};}
        }
      }
    }
    const next=formula!==cell.formula||calculation!==cell.calculation||binding!==cell.binding?{...cell,...(formula?{formula}:{}),...(calculation?{calculation}:{}),...(cell.binding?{binding}:{})}:cell;
    const targetKey=key(target.row,target.column);
    if(cells.get(target.sheet)![targetKey]!==next)writable(target.sheet)[targetKey]=next;
  }
  const names=book.names.map(n=>{const formula=rewrite(n.formula);return formula===n.formula?n:{...n,formula};});
  const validations=new Map(allSheets(book).map(s=>[s.id,[] as Sheet['validations']]));
  for(const s of allSheets(book))for(const v of s.validations){
    const affected=v.rows.some(row=>v.columns.some(column=>mapping.has(`${s.id}:${key(row,column)}`)||destinations.has(`${s.id}:${key(row,column)}`)));
    let source=v.source;
    if(!v.values){
      const ast=v.source.startsWith('{')?JSON.parse(v.source) as Ast:compile(v.source,book,v.sheet,v.rows[0],v.columns[0]),mapped=rewrite(ast);
      if(affected||mapped!==ast)source=JSON.stringify(mapped);
    }
    if(!affected){validations.get(s.id)!.push(source===v.source?v:{...v,source});continue;}
    if(v.rows.length*v.columns.length>limit)throw Error('Validation range exceeds the safe cell-move limit.');
    const groups=new Map<string,{sheet:string;row:string;columns:string[]}>();
    for(const row of v.rows)for(const column of v.columns){
      const old={sheet:s.id,row,column},id=addressKey(old),target=mapping.has(id)?mapping.get(id):old;
      if(!target)continue;
      if(!mapping.has(id)&&destinations.has(id))continue;
      const groupKey=`${target.sheet}:${target.row}`,group=groups.get(groupKey)??{sheet:target.sheet,row:target.row,columns:[]};
      group.columns.push(target.column);groups.set(groupKey,group);
    }
    let first=true;
    for(const group of groups.values()){
      validations.get(group.sheet)!.push({...v,id:first?v.id:uid(),sheet:group.sheet,rows:[group.row],columns:group.columns,source});first=false;
    }
  }
  const references=book.references?.map(source=>{
    if(source.anchor){
      const id=addressKey(source.anchor);
      if(mapping.has(id)){const target=mapping.get(id);if(!target)throw Error('This edit would delete a DD source anchor. Change its connection first.');return{...source,anchor:{...target}};}
    }
    return source;
  });
  for(const s of allSheets(book)){
    s.cells=cells.get(s.id)!;
    const next=validations.get(s.id)!;if(next.length!==s.validations.length||next.some((v,i)=>v!==s.validations[i]))s.validations=next;
  }
  if(names.some((n,i)=>n!==book.names[i]))book.names=names;
  if(references?.some((r,i)=>r!==book.references?.[i]))book.references=references;
}
export function shiftCells(book:Workbook,sheet:Sheet,b:CellRange,direction:'right'|'down'|'left'|'up'):void {
  checkRange(sheet,b);
  const oldRows=sheet.rows,oldColumns=sheet.columns,mapping=new Map<string,Address|null>(),inserted=new Set<string>();
  const vertical=direction==='down'||direction==='up',insert=direction==='down'||direction==='right',size=vertical?b.r2-b.r1+1:b.c2-b.c1+1;
  if((vertical?sheet.rows.length-b.r1:sheet.columns.length-b.c1)*(vertical?b.c2-b.c1+1:b.r2-b.r1+1)>limit)throw Error('Cell shift exceeds the safe limit. Move whole rows or columns instead.');
  try{
    if(insert){
      if(vertical){if(sheet.rows.length+size>100_000)throw Error('Row limit reached.');sheet.rows=[...sheet.rows,...Array.from({length:size},()=>({id:uid()}))];}
      else{if(sheet.columns.length+size>512)throw Error('Column limit reached.');sheet.columns=[...sheet.columns,...Array.from({length:size},()=>({id:uid(),label:'New column',width:145}))];}
    }
    const start=vertical?b.r1:b.c1,end=vertical?oldRows.length:oldColumns.length;
    for(let i=start;i<end;i++)for(let j=vertical?b.c1:b.r1;j<=(vertical?b.c2:b.r2);j++){
      const r=vertical?i:j,c=vertical?j:i,old={sheet:sheet.id,row:oldRows[r].id,column:oldColumns[c].id};
      const targetIndex=insert?i+size:i-size;
      mapping.set(addressKey(old),!insert&&i<start+size?null:{sheet:sheet.id,row:sheet.rows[vertical?targetIndex:j].id,column:sheet.columns[vertical?j:targetIndex].id});
    }
    if(insert)for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++)inserted.add(`${sheet.id}:${key(sheet.rows[r].id,sheet.columns[c].id)}`);
    relocate(book,mapping,inserted);
  }catch(e){sheet.rows=oldRows;sheet.columns=oldColumns;throw e;}
}
export function cutCells(book:Workbook,source:Sheet,b:CellRange,target:Sheet,row:number,column:number):void {
  checkRange(source,b);
  const destination={r1:row,c1:column,r2:row+b.r2-b.r1,c2:column+b.c2-b.c1};checkRange(target,destination);
  const mapping=new Map<string,Address|null>();
  if((b.r2-b.r1+1)*(b.c2-b.c1+1)>limit)throw Error('Cut range exceeds the safe limit.');
  for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++)mapping.set(`${source.id}:${key(source.rows[r].id,source.columns[c].id)}`,{sheet:target.id,row:target.rows[row+r-b.r1].id,column:target.columns[column+c-b.c1].id});
  for(const a of mapping.values()){
    if(a&&!mapping.has(addressKey(a))&&occupied(target.cells[key(a.row,a.column)]))throw Error('Cut destination contains data, notes or links. Clear it deliberately or choose empty cells.');
  }
  relocate(book,mapping);
}
