import {allSheets,allTables,isFault,type Workbook,type Sheet,type Table,type Cell} from '../../src/model';
import {Engine,scalar} from '../../src/formula';

export type Category='value'|'structure';
export interface Difference{
  id:number;category:Category;label:string;sheet:string;table?:string;
  rows:string[];columns:string[];address?:string;left:unknown;right:unknown;
}
export interface Scope{
  id:string;sheetId:string;sheetName:string;name:string;left?:Sheet;right?:Sheet;
  leftTable?:Table;rightTable?:Table;rows:string[];columns:string[];differences:Difference[];
}
export interface Chunk{r1:number;r2:number;c1:number;c2:number;differences:Difference[]}
export type ChoiceAxis='row'|'column';
export function axisChoices(differences:readonly Difference[],sheet:string,axis:ChoiceAxis,identity:string|undefined){
  const dimension=axis==='row'?'rows':'columns';
  const relevant=identity?differences.filter(d=>d.sheet===sheet&&d[dimension].includes(identity)):[];
  const confined=(d:Difference)=>d[dimension].length===1&&!d.label.startsWith('Table ');
  return{targets:relevant.filter(confined),excluded:relevant.filter(d=>!confined(d))};
}
export function hasAxisCellPeers(differences:readonly Difference[],sheet:string,identity:Partial<Record<ChoiceAxis,string>>):boolean{
  return (['row','column'] as const).some(axis=>new Set(
    axisChoices(differences,sheet,axis,identity[axis]).targets.filter(d=>d.address).map(d=>d.address),
  ).size>1);
}

const equality=new WeakMap<object,WeakSet<object>>();
export function equal(a:unknown,b:unknown):boolean{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  if(equality.get(a)?.has(b))return true;
  const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
  const keys=Object.keys(left).filter(k=>left[k]!==undefined),other=Object.keys(right).filter(k=>right[k]!==undefined);
  if(keys.length!==other.length||!keys.every(k=>Object.hasOwn(right,k)&&equal(left[k],right[k])))return false;
  let matches=equality.get(a);if(!matches)equality.set(a,matches=new WeakSet());matches.add(b);return true;
}
export function align(left:string[],right:string[]):string[]{
  const result=[...left],known=new Set(left);
  let pending:string[]=[];
  const before=new Map<string,string[]>(),after:string[]=[];
  for(const id of right){
    if(known.has(id)){if(pending.length){before.set(id,pending);pending=[];}}
    else{pending.push(id);known.add(id);}
  }
  after.push(...pending);
  return result.flatMap(id=>[...(before.get(id)??[]),id]).concat(after);
}
function moved(left:string[],right:string[]):string[]{
  const positions=new Map(right.map((id,index)=>[id,index])),common=left.filter(id=>positions.has(id));
  const tails:number[]=[],at:number[]=[],previous:number[]=[];
  for(let i=0;i<common.length;i++){
    const position=positions.get(common[i])!;let lo=0,hi=tails.length;
    while(lo<hi){const middle=(lo+hi)>>1;if(tails[middle]<position)lo=middle+1;else hi=middle;}
    previous[i]=lo?at[lo-1]:-1;tails[lo]=position;at[lo]=i;
  }
  const kept=new Set<string>();let index=at[tails.length-1];
  while(index!==undefined&&index>=0){kept.add(common[index]);index=previous[index];}
  return common.filter(id=>!kept.has(id));
}
function present(value:Record<string,unknown>):unknown{
  return Object.values(value).some(v=>v!==undefined)?value:undefined;
}
function changedProperties(a:object|undefined,b:object|undefined,skip:string[]):[string,unknown,unknown][]{
  const before:Record<string,unknown>=Object.fromEntries(Object.entries(a??{})),after:Record<string,unknown>=Object.fromEntries(Object.entries(b??{}));
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!skip.includes(key)&&!equal(before[key],after[key])).map(key=>[key,before[key],after[key]]);
}
const meaningful=(cell:Cell|undefined):unknown=>cell?present({
  value:cell.value===null?undefined:cell.value,formula:cell.formula,binding:cell.binding,note:cell.note,link:cell.link,
  dateLiteral:cell.dateLiteral,fractionInput:cell.fractionInput,fractionLiteral:cell.fractionLiteral,
  dayDateTable:cell.dayDateTable,
}):undefined;
const metadata=(cell:Cell|undefined):unknown=>cell?present({format:cell.format&&Object.keys(cell.format).length?cell.format:undefined,calculation:cell.calculation,spillHint:cell.spillHint}):undefined;
export const anchorLabel='Date anchored (original formula retained)';
export const anchorMismatchLabel='Date anchored (displayed date differs)';
export const anchorErrorLabel='Date anchored (date calculation needs review)';
export const isDateAnchorLabel=(label:string)=>[anchorLabel,anchorMismatchLabel,anchorErrorLabel].includes(label);
export function dayDateCells(book:Workbook,sheet:Sheet):Set<string>{
  const cells=new Set<string>(),engine=new Engine(book);
  for(const table of allTables(book).filter(t=>t.sheet===sheet.id&&(t.id===sheet.dayLogging?.table||t.name==='Master'))){
    const saved=sheet.dayLogging?.table===table.id?sheet.dayLogging:undefined;
    const date=table.columns.find(c=>saved?c.id===saved.date:c.name==='Date'),marker=table.columns.find(c=>saved?c.id===saved.marker:c.name==='isDay');
    if(!date||!marker)continue;
    for(const row of table.rows){
      const flag=scalar(engine.cell(sheet.id,row,marker.column));
      if(flag===true||typeof flag==='number'&&flag!==0||typeof flag==='string'&&flag!=='')cells.add(`${row}:${date.column}`);
    }
  }
  return cells;
}
function anchored(a:Cell|undefined,b:Cell|undefined):boolean{
  const fixed=a?.formula?b:a,formula=a?.formula?a:b;
  if(!fixed||fixed.formula||typeof fixed.value!=='number'||!Number.isFinite(fixed.value)||!formula?.formula||!equal(fixed.calculation,formula.formula))return false;
  const rest=(cell:Cell)=>{const {value,formula,...details}=meaningful(cell) as Record<string,unknown>;return details;};
  return equal(rest(fixed),rest(formula));
}
function anchorMetadata(cell:Cell|undefined):unknown{
  return cell?metadata({...cell,calculation:undefined,spillHint:undefined}):undefined;
}

export async function compare(left:Workbook,right:Workbook,progress:(checked:number)=>void=()=>{},engines:readonly [Engine,Engine]=[new Engine(left),new Engine(right)]):Promise<Difference[]>{
  const differences:Difference[]=[],ls=new Map(allSheets(left).map(s=>[s.id,s])),rs=new Map(allSheets(right).map(s=>[s.id,s]));
  const tables=[...allTables(left),...allTables(right)].map(table=>({
    table,rows:new Set([table.header,...table.rows]),columns:new Set(table.columns.map(c=>c.column)),
  }));
  let checked=0,last=performance.now();
  const breathe=async()=>{if(performance.now()-last>12){progress(checked);await new Promise(resolve=>setTimeout(resolve,0));last=performance.now();}};
  const add=(category:Category,label:string,sheet:string,rows:string[],columns:string[],a:unknown,b:unknown,table?:string,address?:string)=>{
    differences.push({id:differences.length,category,label,sheet,table,rows,columns,left:a,right:b,address});
  };
  for(const sheetId of new Set([...ls.keys(),...rs.keys()])){
    const a=ls.get(sheetId),b=rs.get(sheetId),rowsA=new Map(a?.rows.map(r=>[r.id,r])),rowsB=new Map(b?.rows.map(r=>[r.id,r]));
    const colsA=new Map(a?.columns.map(c=>[c.id,c])),colsB=new Map(b?.columns.map(c=>[c.id,c]));
    const dates=new Set([...(a?dayDateCells(left,a):[]),...(b?dayDateCells(right,b):[])]);
    if(!a||!b)add('structure',a?'Sheet only in left copy':'Sheet only in right copy',sheetId,[],[],a?.name,b?.name);
    if(a&&b&&a.name!==b.name)add('structure','Sheet renamed',sheetId,[],[],a.name,b.name);
    for(const property of ['dayLogging','pagination'] as const)if(!equal(a?.[property],b?.[property]))add('structure',property==='dayLogging'?'Day logging settings':'Date navigation settings',sheetId,[],[],a?.[property],b?.[property]);
    for(const [property,before,after]of changedProperties(a,b,['id','name','cells','rows','columns','groups','validations','dayLogging','pagination']))add('structure',`Sheet ${property} changed`,sheetId,[],[],before,after);
    for(const address of new Set([...Object.keys(a?.cells??{}),...Object.keys(b?.cells??{})])){
      const ca=a?.cells[address],cb=b?.cells[address];checked++;
      if(!equal(ca,cb)){
        const [row,column]=address.split(':'),owner=tables.find(t=>t.table.sheet===sheetId&&t.rows.has(row)&&t.columns.has(column))?.table;
        const present=rowsA.has(row)&&rowsB.has(row)&&colsA.has(column)&&colsB.has(column);
        const dateAnchor=present&&dates.has(address)&&anchored(ca,cb);
        if(!equal(meaningful(ca),meaningful(cb))){
          let dateLabel=anchorLabel;
          if(dateAnchor){
            const av=scalar(engines[0].cell(sheetId,row,column)),bv=scalar(engines[1].cell(sheetId,row,column));
            dateLabel=isFault(av)||isFault(bv)?anchorErrorLabel:av!==bv?anchorMismatchLabel:anchorLabel;
          }
          const onlyFormula=!!ca?.formula!==!!cb?.formula,plain=ca?.formula?cb:ca,active=ca?.formula??cb?.formula;
          const formulaLabel=onlyFormula&&plain?.calculation&&equal(plain.calculation,active)?'Retained formula activated / deactivated':
            onlyFormula&&(plain?.value===undefined||plain.value===null||plain.value==='')?'Formula added / removed':'Formula changed';
          const label=dateAnchor?dateLabel:!present?'Added or removed cell':!equal(ca?.formula,cb?.formula)?formulaLabel:!equal(ca?.binding,cb?.binding)?'Linked source changed':!equal(ca?.note,cb?.note)&&equal(ca?.value,cb?.value)?'Note changed':'Value changed';
          add(present&&!dateAnchor?'value':'structure',label,sheetId,[row],[column],ca,cb,owner?.id,address);
        }
        const ma=dateAnchor?anchorMetadata(ca):metadata(ca),mb=dateAnchor?anchorMetadata(cb):metadata(cb);
        if(present&&!equal(ma,mb))add('structure','Cell formatting or retained calculation',sheetId,[row],[column],ma,mb,owner?.id,address);
      }
      if(checked%200===0)await breathe();
    }
    for(const [axis,aa,bb]of [['row',a?.rows??[],b?.rows??[]],['column',a?.columns??[],b?.columns??[]]] as const){
      const ma=new Map<string,typeof aa[number]>(aa.map(x=>[x.id,x])),mb=new Map<string,typeof bb[number]>(bb.map(x=>[x.id,x]));
      for(const id of new Set([...ma.keys(),...mb.keys()])){
        const x=ma.get(id),y=mb.get(id),rows=axis==='row'?[id]:[],columns=axis==='column'?[id]:[];
        if(!x||!y){add('structure',`${axis==='row'?'Row':'Column'} ${x?'only in left copy':'only in right copy'}`,sheetId,rows,columns,x,y);continue;}
        for(const property of new Set([...Object.keys(x),...Object.keys(y)])){
          if(property==='id')continue;
          const before=(x as unknown as Record<string,unknown>)[property],after=(y as unknown as Record<string,unknown>)[property];
          if(equal(before,after))continue;
          const label=/hypothetical/.test(property)?'Hypothetical tag':property==='status'?'Row status':`${axis==='row'?'Row':'Column'} ${property}`;
          if(property==='hypotheticalTables'){
            const p=before as Record<string,boolean>|undefined,q=after as Record<string,boolean>|undefined;
            for(const table of new Set([...Object.keys(p??{}),...Object.keys(q??{})]))if(p?.[table]!==q?.[table])add('structure',label,sheetId,rows,columns,p?.[table],q?.[table],table);
          }else add('structure',label,sheetId,rows,columns,before,after);
        }
      }
      for(const id of moved(aa.map(x=>x.id),bb.map(x=>x.id)))add('structure',`${axis==='row'?'Row':'Column'} order changed`,sheetId,axis==='row'?[id]:[],axis==='column'?[id]:[],aa.findIndex(x=>x.id===id)+1,bb.findIndex(x=>x.id===id)+1);
    }
    const ga=new Map(a?.groups.map(g=>[g.id,g])),gb=new Map(b?.groups.map(g=>[g.id,g]));
    for(const id of new Set([...ga.keys(),...gb.keys()])){
      const x=ga.get(id),y=gb.get(id);if(equal(x,y))continue;
      const members=[...new Set([...(x?.members??[]),...(y?.members??[])])],group=x??y!;
      add('structure',!x||!y?'Group added or removed':'Grouping changed',sheetId,group.axis==='row'?members:[],group.axis==='column'?members:[],x,y,group.table);
    }
    if(!equal(a?.validations,b?.validations)){
      const va=new Map(a?.validations.map(v=>[v.id,v])),vb=new Map(b?.validations.map(v=>[v.id,v]));
      for(const id of new Set([...va.keys(),...vb.keys()])){
        const x=va.get(id),y=vb.get(id);if(equal(x,y))continue;
        add('structure','Dropdown rule changed',sheetId,[...new Set([...(x?.rows??[]),...(y?.rows??[])])],[...new Set([...(x?.columns??[]),...(y?.columns??[])])],x,y);
      }
    }
    await breathe();
  }
  const ta=new Map(allTables(left).map(t=>[t.id,t])),tb=new Map(allTables(right).map(t=>[t.id,t]));
  for(const id of new Set([...ta.keys(),...tb.keys()])){
    const a=ta.get(id),b=tb.get(id),t=a??b!;
    if(!a||!b)add('structure','Table added or removed',t.sheet,[t.header,...t.rows],t.columns.map(c=>c.column),a,b,id);
    else{
      if(a.name!==b.name)add('structure','Table renamed',t.sheet,[t.header],t.columns.map(c=>c.column),a.name,b.name,id);
      if(a.sheet!==b.sheet)add('structure','Table sheet changed',t.sheet,[t.header],t.columns.map(c=>c.column),a.sheet,b.sheet,id);
      for(const axis of ['rows','columns','header'] as const)if(!equal(a[axis],b[axis])){
        const rows=axis==='rows'?[...new Set([...a.rows.filter(r=>!b.rows.includes(r)),...b.rows.filter(r=>!a.rows.includes(r))])]:[t.header];
        add('structure',`Table ${axis==='rows'?'row membership / order':axis==='columns'?'columns / calculations':'header'} changed`,t.sheet,rows.length?rows:[t.header],axis==='columns'?t.columns.map(c=>c.column):[],a[axis],b[axis],id);
      }
    }
  }
  for(const [property,before,after]of changedProperties(left,right,['sheets','tables','dropdownData','revision','tableActivity']))add('structure',`Workbook ${property} changed`,'@workbook',[],[],before,after);
  for(const [label,before,after]of [
    ['sheet order',left.sheets,right.sheets],
    ['DD sheet order',left.dropdownData?.sheets??[],right.dropdownData?.sheets??[]],
    ['table order',allTables(left),allTables(right)],
  ] as const){
    const a=before.map(item=>item.id),b=after.map(item=>item.id);
    if(!equal(a,b))add('structure',`Workbook ${label} changed`,'@workbook',[],[],a,b);
  }
  progress(checked);return differences;
}

export function scopes(left:Workbook,right:Workbook,differences:Difference[]):Scope[]{
  const ls=new Map(allSheets(left).map(s=>[s.id,s])),rs=new Map(allSheets(right).map(s=>[s.id,s]));
  const lt=new Map(allTables(left).map(t=>[t.id,t])),rt=new Map(allTables(right).map(t=>[t.id,t]));
  const output:Scope[]=[];
  for(const sheetId of new Set(differences.map(d=>d.sheet))){
    const a=ls.get(sheetId),b=rs.get(sheetId),entries=differences.filter(d=>d.sheet===sheetId);
    const tableIds=[...new Set(entries.map(d=>d.table))].sort((a,b)=>Number(a===undefined)-Number(b===undefined));
    for(const tableId of tableIds){
      const tableA=tableId?lt.get(tableId):undefined,tableB=tableId?rt.get(tableId):undefined;
      output.push({id:`${sheetId}/${tableId??'outside'}`,sheetId,sheetName:a?.name??b?.name??'Workbook',name:tableA?.name??tableB?.name??(sheetId==='@workbook'?'Settings':'Outside tables / sheet structure'),
        left:a,right:b,leftTable:tableA,rightTable:tableB,
        rows:align(tableA?[tableA.header,...tableA.rows]:a?.rows.map(r=>r.id)??[],tableB?[tableB.header,...tableB.rows]:b?.rows.map(r=>r.id)??[]),
        columns:align(tableA?tableA.columns.map(c=>c.column):a?.columns.map(c=>c.id)??[],tableB?tableB.columns.map(c=>c.column):b?.columns.map(c=>c.id)??[]),
        differences:entries.filter(d=>d.table===tableId)});
    }
  }
  return output;
}
export function chunks(scope:Scope,entries:Difference[],context=2):Chunk[]{
  const ri=new Map(scope.rows.map((id,i)=>[id,i])),ci=new Map(scope.columns.map((id,i)=>[id,i]));
  const output:Chunk[]=[];
  for(const difference of entries){
    const rows=difference.rows.map(id=>ri.get(id)).filter((i):i is number=>i!==undefined);
    const columns=difference.columns.map(id=>ci.get(id)).filter((i):i is number=>i!==undefined);
    const seeds=rows.length>40?[rows[0],rows[rows.length-1]]:rows.length?rows:[0];
    for(const row of seeds){
      const first=columns.length?Math.min(...columns):0,last=columns.length?Math.max(...columns):Math.min(5,scope.columns.length-1);
      const rectangle={r1:Math.max(0,row-context),r2:Math.min(scope.rows.length-1,row+context),c1:Math.max(0,first-context),c2:Math.min(scope.columns.length-1,last+context),differences:[difference]};
      let merge=output.find(p=>p.r1<=rectangle.r2+1&&p.r2>=rectangle.r1-1&&p.c1<=rectangle.c2+1&&p.c2>=rectangle.c1-1&&Math.max(p.r2,rectangle.r2)-Math.min(p.r1,rectangle.r1)<40);
      if(merge){merge.r1=Math.min(merge.r1,rectangle.r1);merge.r2=Math.max(merge.r2,rectangle.r2);merge.c1=Math.min(merge.c1,rectangle.c1);merge.c2=Math.max(merge.c2,rectangle.c2);if(!merge.differences.includes(difference))merge.differences.push(difference);}
      else output.push(rectangle);
    }
  }
  return output.sort((a,b)=>a.r1-b.r1||a.c1-b.c1);
}
