import { displayFormula,Engine,scalar } from './formula';
import { moveRows,uid,type Sheet,type Table,type Workbook } from './model';

export function positionalBlock(book:Workbook,sheet:Sheet,table:Table,row:string,engine=new Engine(book)):string[]{
  const field=(name:string)=>table.columns.find(c=>c.name.toLowerCase()===name.toLowerCase());
  const flag=field('isDay')??field('isMeal'),label=field('Meal')??field('Weight');
  if(!flag&&!label)throw Error('This table needs a meal/day header marker.');
  const records=new Set(table.rows),ordered=sheet.rows.filter(r=>records.has(r.id)).map(r=>r.id);
  let start=ordered.indexOf(row);
  if(start<0)throw Error('Select a record inside the meal/day table.');
  const header=(id:string)=>{const value=scalar(engine.cell(sheet.id,id,(flag??label)!.column));return flag?value===true:value!==null&&value!=='';};
  while(start>=0&&!header(ordered[start]))start--;
  if(start<0)throw Error('These detail rows have no preceding meal/day header.');
  let end=start+1;while(end<ordered.length&&!header(ordered[end]))end++;
  return ordered.slice(start,end);
}
export function groupBlockToTop(book:Workbook,sheet:Sheet,table:Table,row:string):number{
  const members=positionalBlock(book,sheet,table,row),positions=members.map(id=>sheet.rows.findIndex(r=>r.id===id));
  if(positions.some((p,i)=>p!==positions[0]+i))throw Error('This block contains intervening non-table rows. Move those rows explicitly first.');
  const header=sheet.rows.findIndex(r=>r.id===table.header);
  if(header<0||positions[0]<=header)throw Error('The block must follow its table header.');
  const expand=sheet.groups.filter(g=>g.axis==='row'&&g.members.includes(members[0]));
  const at=moveRows(book,sheet,members,header+1);
  for(const g of expand)if(g.members.includes(members[0]))g.collapsed=false;
  const details=members.slice(1);
  if(details.length){
    const same=sheet.groups.find(g=>g.axis==='row'&&(g.kind==='summary'?g.members.length===members.length&&g.members.every(id=>members.includes(id)):g.members.length===details.length&&g.members.every(id=>details.includes(id))));
    if(same){same.collapsed=true;same.kind='summary';same.members=members;}
    else sheet.groups.push({id:uid(),axis:'row',members,kind:'summary',collapsed:true,label:'Meal / day details'});
  }
  return at;
}
export function defaultHeaderFormula(book:Workbook,table:Table,column:string,options?:{marker:string;boolean:boolean}):string{
  const field=(name:string)=>table.columns.find(c=>c.name.toLowerCase()===name.toLowerCase());
  const marker=options?table.columns.find(field=>field.id===options.marker):field('isDay')??field('isMeal')??field('Meal')??field('Weight'),portions=field('Portions');
  if(!marker)throw Error('This table needs a meal/day header marker.');
  const ref=(id:string,row=false)=>displayFormula({kind:'structured',table:table.id,columns:[id],mode:row?'row':'data'},book).slice(1);
  const source=ref(marker.id),values=ref(column),test=`(INDEX(${source},pos+1):INDEX(${source},count))${options?options.boolean?'=TRUE':'<>""':marker===field('isDay')||marker===field('isMeal')?'=TRUE':'<>""'}`;
  const divisor=portions?`/IF(${ref(portions.id,true)}="",1,${ref(portions.id,true)})`:'';
  return `=LET(pos,ROW()-ROW(INDEX(${source},1))+1,count,ROWS(${source}),IF(pos>=count,0,LET(next,IFERROR(XMATCH(TRUE,${test},0)+pos,count+1),IF(next<=pos+1,0,SUM(INDEX(${values},pos+1):INDEX(${values},next-1))${divisor}))))`;
}
