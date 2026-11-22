import { compile,Engine,maySpill,scalar,type Ast } from './formula';

export type Scalar = string | number | boolean | null | Fault;
export interface Fault { error: string; detail?: string }
export type Value = Scalar | Value[];
export interface Format {
  bold?: boolean; italic?:boolean; underline?: boolean; strikethrough?:boolean; wrap?: boolean;
  color?: string; background?: string; number?: string; excelNumberFormat?: string;
}
export interface Cell {
  value?: Scalar; formula?: Ast; calculation?: Ast; original?: string; format?: Format; note?: string; link?: string;
  spillHint?: boolean;
  binding?: { table: string; row: string; column: string };
}
export interface Column { id: string; label: string; width?: number; hidden?: boolean; hypothetical?:boolean }
export interface Row { id: string; hidden?: boolean; height?: number; status?: 'real' | 'planned' | 'hypothetical'; hypothetical?:boolean }
export interface Group { id: string; axis: 'row' | 'column'; members: string[]; collapsed: boolean; label: string; kind?:'summary'|'range' }
export function hypotheticalTagDescendants(sheet:Sheet,axis:Group['axis'],ids:string[]):Set<string>{
  const selected=new Set(ids),descendants=new Set<string>();
  for(const group of sheet.groups)if(group.axis===axis&&group.kind==='summary'&&selected.has(group.members[0])){
    for(const id of summaryMoveMembers(sheet,axis,group.members))if(id!==group.members[0])descendants.add(id);
  }
  return descendants;
}
export function setHypotheticalTag(sheet:Sheet,axis:Group['axis'],ids:string[],enabled:boolean,overwriteChildren=false):void{
  const items=axis==='row'?sheet.rows:sheet.columns,selected=new Set(ids);
  if(!ids.length||ids.some(id=>!items.some(item=>item.id===id)))throw Error('Select existing rows or columns to change their hypothetical tag.');
  const descendants=hypotheticalTagDescendants(sheet,axis,ids);
  for(const item of items){
    if(descendants.has(item.id)){if(overwriteChildren)delete item.hypothetical;}
    else if(selected.has(item.id))item.hypothetical=enabled;
  }
}
export function outlineMembers(group:Group,groups:readonly Group[]=[]):string[] {
  if(group.kind==='summary')return group.members.slice(1);
  const members=new Set(group.members);
  let changed=true;
  while(changed){
    changed=false;
    for(const summary of groups)if(summary.axis===group.axis&&summary.kind==='summary'&&members.has(summary.members[0])){
      for(const id of summary.members)if(!members.has(id)){members.add(id);changed=true;}
    }
  }
  return [...members];
}
export interface Validation { id: string; rows: string[]; columns: string[]; source: string; sheet: string; values?: string[]; originalSource?: string }
export interface Sheet {
  id: string; name: string; color: string; columns: Column[]; rows: Row[];
  cells: Record<string, Cell>; groups: Group[]; validations: Validation[];
  supporting?:boolean;
  outlineView?:{tree?:boolean;plainGroupHints?:boolean};
}
export interface ReferenceSource {
  id:string;name:string;kind:'list'|'units'|'conversions'|'derived';table?:string;column?:string;
  label?:string;group?:string;
  archived?:boolean;archivedRows:string[];
  origin?:{original:string;table?:string;definition?:string};
  catalog?:{id:string;table:string;rows?:string[]};
  derived?:{table:string;column:string;filter?:{column:string;value:Scalar}};
  conversion?:{from:string;to:string;factor:string};
  anchor?:{sheet:string;row:string;column:string};nameId?:string;
  deferredNames?:Named[];
}
export interface Table {
  id: string; name: string; sheet: string; rows: string[];
  columns: { id: string; column: string; name: string }[]; header: string;
}
export interface Named { id: string; name: string; sheet?: string; context: string; formula: Ast; original: string }
export interface HypotheticalTreatment {
  pattern:'none'|'lines'|'dots'|'crosshatch'|'grid'|'checkerboard';
  patternColor:string;patternOpacity:number;strokeWidth:number;gap:number;angle:number;
  textOpacity:number;textColor?:string;fillColor:string;fillOpacity:number;
  bold:boolean;italic:boolean;underline:boolean;badge:boolean;
  badgeColor:string;badgeBackground:string;badgeBorder:string;
  badgeBorderStyle?:'solid'|'dashed';badgeDashSize?:number;badgeDashGap?:number;
}
export interface HypotheticalStyle {
  label:string;badgeText?:string;linked:boolean;
  rows:HypotheticalTreatment;columns:HypotheticalTreatment;
}
export interface Workbook {
  schema: 1; id: string; title: string; revision: number; sheets: Sheet[]; tables: Table[]; names: Named[];
  pickerSources: Record<string, string>;
  references?:ReferenceSource[];
  catalogMigrations?:string[];
  hypotheticalStyle?:HypotheticalStyle;
  toolbarOrder?:string[];
  toolbarDividers?:string[];
  importReport?: { entries: string[]; formulaCount: number; unsupported: Record<string, number>; originalId: string };
}
export const uid = () => crypto.randomUUID();
export const key = (row: string, column: string) => `${row}:${column}`;
export const fault = (error: string, detail?: string): Fault => ({ error, ...(detail ? { detail } : {}) });
export const isFault = (v: Value): v is Fault => !!v && typeof v === 'object' && !Array.isArray(v) && 'error' in v;
export const clone = <T>(value: T): T => structuredClone(value);
export function letters(index: number): string {
  let out = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out;
  return out;
}
export function columnIndex(label: string): number {
  return [...label.replace(/\$/g, '').toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}
export function blankSheet(name: string, rowCount = 100, columnCount = 20): Sheet {
  return { id: uid(), name, color: '#307867',
    columns: Array.from({ length: columnCount }, (_, i) => ({ id: uid(), label: letters(i), width: 145 })),
    rows: Array.from({ length: rowCount }, () => ({ id: uid() })), cells: {}, groups: [], validations: [] };
}
export function getCell(sheet: Sheet, row: string, column: string): Cell {
  return sheet.cells[key(row, column)] ?? {};
}
export function setInput(book: Workbook, sheet: Sheet, row: string, column: string, input: string): void {
  const header=book.tables.find(t=>t.sheet===sheet.id&&t.header===row&&t.columns.some(c=>c.column===column));
  if(header){
    if(input.startsWith('='))throw Error('Table headers must be names, not formulas.');
    renameColumn(book,header,header.columns.find(c=>c.column===column)!.id,input);return;
  }
  if(input!=='')expandAdjacentTable(book,sheet,row,column);
  const previous = getCell(sheet, row, column);
  const cell: Cell = { format: previous.format, note: previous.note };
  if(!input.startsWith('='))cell.calculation=previous.formula??previous.calculation;
  if (input.startsWith('=')) {
    cell.original = input;
    try { cell.formula = compile(input, book, sheet.id, row, column); }
    catch (e) { cell.formula = { kind: 'error', value: fault('#PARSE!', String(e)) }; }
    cell.spillHint=maySpill(cell.formula);
  } else {
    cell.value = input === '' ? null : /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(input) ? Number(input)
      : input === 'TRUE' ? true : input === 'FALSE' ? false : input.startsWith("'") ? input.slice(1) : input;
    if(typeof cell.value==='number'&&!Number.isFinite(cell.value))cell.value=fault('#NUM!','Number is outside the supported numeric range.');
  }
  sheet.cells[key(row, column)] = cell;
}
export function tableAt(book: Workbook, sheet: string, row: string, column?: string): Table | undefined {
  return book.tables.find(t => t.sheet === sheet && (t.rows.includes(row) || t.header === row) && (!column || t.columns.some(c => c.column === column)));
}
export function uniqueName(names: string[], base: string): string {
  let name = base, n = 2;
  while (names.some(s => s.toLowerCase() === name.toLowerCase())) name = `${base}_${n++}`;
  return name;
}
export function renameColumn(book: Workbook, table: Table, id: string, name: string): void {
  if (!name.trim() || table.columns.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) throw Error('Column names must be nonempty and unique in the table.');
  const col = table.columns.find(c => c.id === id);
  if (!col) throw Error('Column no longer exists.');
  col.name = name;
  const sheet = book.sheets.find(s => s.id === table.sheet)!;
  sheet.cells[key(table.header, col.column)] = { ...getCell(sheet, table.header, col.column), value: name };
}
export function move<T>(items: T[], from: number, to: number): void {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) throw Error('Move is outside the sheet.');
  items.splice(to, 0, ...items.splice(from, 1));
}
export function deleteRows(book: Workbook, sheet: Sheet, ids: string[]): void {
  const removed=new Set(ids);
  sheet.rows = sheet.rows.filter(r => !removed.has(r.id));
  for (const t of book.tables.filter(t => t.sheet === sheet.id)) t.rows = t.rows.filter(r => !removed.has(r));
  book.tables = book.tables.filter(t => t.sheet!==sheet.id||!removed.has(t.header));
  for (const k of Object.keys(sheet.cells)) if (removed.has(k.split(':')[0])) delete sheet.cells[k];
  sheet.groups=sheet.groups.filter(g=>g.axis!=='row'||g.kind!=='summary'||!removed.has(g.members[0])).map(g=>g.axis==='row'?{...g,members:g.members.filter(id=>!removed.has(id))}:g).filter(g=>g.kind==='summary'?g.members.length>1:g.members.length);
  sheet.validations=sheet.validations.map(v=>({...v,rows:v.rows.filter(id=>!removed.has(id))})).filter(v=>v.rows.length);
}
export function deleteColumn(book: Workbook, sheet: Sheet, id: string): void {
  sheet.columns = sheet.columns.filter(c => c.id !== id);
  for (const t of book.tables.filter(t => t.sheet === sheet.id)) t.columns = t.columns.filter(c => c.column !== id);
  for (const k of Object.keys(sheet.cells)) if (k.endsWith(`:${id}`)) delete sheet.cells[k];
  book.tables=book.tables.filter(t=>t.sheet!==sheet.id||t.columns.length>0);
  sheet.groups=sheet.groups.filter(g=>g.axis!=='column'||g.kind!=='summary'||g.members[0]!==id).map(g=>g.axis==='column'?{...g,members:g.members.filter(c=>c!==id)}:g).filter(g=>g.kind==='summary'?g.members.length>1:g.members.length);
  sheet.validations=sheet.validations.map(v=>({...v,columns:v.columns.filter(c=>c!==id)})).filter(v=>v.columns.length);
}
export function addRow(book: Workbook, sheet: Sheet, at: number, table?: Table): Row {
  if(at<0||at>sheet.rows.length)throw Error('Row insertion is outside the sheet.');
  const row: Row = { id: uid() };
  inheritInsertedGroups(sheet,'row',[{at,id:row.id}]);
  sheet.rows.splice(at, 0, row);
  if (table) {
    const before = sheet.rows.slice(0, at).filter(r => table.rows.includes(r.id)).length;
    table.rows.splice(before, 0, row.id);
    inheritTableRow(book,sheet,table,row.id,before);
  }
  return row;
}
function stationaryGroupBounds(group:Group,positions:ReadonlyMap<string,number>,moving:ReadonlySet<string>):{first:number;last:number} {
  let first=Infinity,last=-1;
  for(const member of group.members){
    if(moving.has(member))continue;
    const position=positions.get(member);
    if(position!==undefined){first=Math.min(first,position);last=Math.max(last,position);}
  }
  return {first,last};
}
function inheritInsertedGroups(sheet:Sheet,axis:Group['axis'],insertions:{at:number;id:string}[],moving:ReadonlySet<string>=new Set()):void {
  if(!sheet.groups.some(group=>group.axis===axis))return;
  const positions=new Map((axis==='row'?sheet.rows:sheet.columns).map((item,index)=>[item.id,index]));
  for(const group of sheet.groups.filter(g=>g.axis===axis)){
    const {first,last}=stationaryGroupBounds(group,positions,moving);
    const members=new Set(group.members);
    for(const {at,id}of insertions){
      if(at<=first||at>last||members.has(id))continue;
      const before=group.members.findIndex((member,index)=>(group.kind!=='summary'||index>0)&&!moving.has(member)&&(positions.get(member)??-1)>=at);
      group.members.splice(before<0?group.members.length:before,0,id);members.add(id);
    }
  }
}
function inheritTableRow(book:Workbook,sheet:Sheet,table:Table,row:string,at:number,preserve=false,templates?:ReadonlySet<string>):void {
  const candidates=[...table.rows.slice(0,at).reverse(),...table.rows.slice(at+1)].filter(id=>!templates||templates.has(id));
  const marker=table.columns.find(c=>['ismeal','isday'].includes(c.name.toLowerCase())),label=table.columns.find(c=>['meal','weight'].includes(c.name.toLowerCase()));
  const engine=marker||label?new Engine(book):undefined;
  const isHeader=(id:string)=>{
    if(!engine)return false;
    let value=scalar(engine.cell(sheet.id,id,(marker??label)!.column));
    if(isFault(value))throw Error('Fix the meal/day header marker error before adding records.');
    if(marker&&value!==null&&value!=='')return value===true;
    if(marker&&label){value=scalar(engine.cell(sheet.id,id,label.column));if(isFault(value))throw Error('Fix the meal/day header label error before adding records.');}
    return value!==null&&value!=='';
  };
  const sameKind=candidates.filter(id=>isHeader(id)===isHeader(row));
  for(const col of table.columns){
    const current=getCell(sheet,row,col.column);
    if(preserve&&(current.formula||current.calculation||current.binding))continue;
    const matching=col===marker?candidates:sameKind;
    const template=matching.find(id=>getCell(sheet,id,col.column).formula??getCell(sheet,id,col.column).calculation)??matching[0];
    if(!template)continue;
    const source=getCell(sheet,template,col.column);
    const formula=source.formula??source.calculation;
    const inherited=formula?translate(formula,book,sheet.id,template,col.column,row,col.column):undefined;
    sheet.cells[key(row,col.column)]=preserve?{
      ...current,format:current.format??((current.value==null||current.value==='')&&!current.note&&!current.link&&source.format?clone(source.format):undefined),
      ...(inherited?current.value!=null&&current.value!==''?{calculation:inherited}:{formula:inherited,spillHint:maySpill(formula!)}:{})
    }:{format:source.format?clone(source.format):undefined,...(inherited?{formula:inherited,spillHint:maySpill(formula!)}:{})};
  }
  for(const validation of [...sheet.validations]){
    const columns=validation.columns.filter(c=>table.columns.some(col=>col.column===c)&&(!preserve||!sheet.validations.some(v=>v.rows.includes(row)&&v.columns.includes(c))));
    if(columns.length&&validation.rows.includes(candidates[0])&&!validation.rows.includes(row)){
      if(columns.length===validation.columns.length)validation.rows.push(row);
      else sheet.validations.push({...clone(validation),id:uid(),rows:[row],columns});
    }
  }
}
function tableRowsToAdd(book:Workbook,sheet:Sheet,table:Table,ids:string[]):string[]{
  const existing=new Set(sheet.rows.map(r=>r.id));
  if(!book.tables.includes(table)||table.sheet!==sheet.id||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!existing.has(id)))throw Error('Select existing rows and a table on their sheet.');
  if(ids.includes(table.header))throw Error('A table header cannot be converted into a record.');
  const members=new Set(table.rows),added=ids.filter(id=>!members.has(id)),columns=new Set(table.columns.map(c=>c.column));
  for(const id of added)if(book.tables.some(t=>t!==table&&t.sheet===sheet.id&&(t.header===id||t.rows.includes(id))&&t.columns.some(c=>columns.has(c.column))))throw Error('These rows already belong to another table using the same columns.');
  return added;
}
export function addTableRows(book:Workbook,sheet:Sheet,table:Table,ids:string[]):void{
  const added=tableRowsToAdd(book,sheet,table,ids);
  if(!added.length)throw Error('The selected rows already belong to this table.');
  const templates=new Set(table.rows),members=new Set([...table.rows,...added]);
  table.rows=sheet.rows.filter(r=>members.has(r.id)).map(r=>r.id);
  for(const id of added)inheritTableRow(book,sheet,table,id,table.rows.indexOf(id),true,templates);
}
export function addTableColumns(book:Workbook,sheet:Sheet,table:Table,ids:string[]):void{
  if(!book.tables.includes(table)||table.sheet!==sheet.id||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!sheet.columns.some(c=>c.id===id)))throw Error('Select existing columns and a table on their sheet.');
  const added=ids.filter(id=>!table.columns.some(c=>c.column===id)),rows=new Set([table.header,...table.rows]);
  if(!added.length)throw Error('The selected columns already belong to this table.');
  if(book.tables.some(t=>t!==table&&t.sheet===sheet.id&&[t.header,...t.rows].some(id=>rows.has(id))&&t.columns.some(c=>added.includes(c.column))))throw Error('These columns already belong to another table using the same rows.');
  for(const id of added){
    const column=sheet.columns.find(c=>c.id===id)!,header=getCell(sheet,table.header,id);
    const name=uniqueName(table.columns.map(c=>c.name),typeof header.value==='string'&&header.value.trim()?header.value.trim():column.label||`Column ${letters(sheet.columns.indexOf(column))}`);
    table.columns.push({id:uid(),column:id,name});
    if(header.value==null&&!header.formula&&!header.calculation&&!header.binding)sheet.cells[key(table.header,id)]={...header,value:name};
  }
  const positions=new Map(sheet.columns.map((c,i)=>[c.id,i]));
  table.columns.sort((a,b)=>positions.get(a.column)!-positions.get(b.column)!);
}
export type TableMembershipGap={sheet:string;table:string;axis:Group['axis'];member:string;index:number};
export function tableMembershipGaps(book:Workbook):TableMembershipGap[]{
  const gaps:TableMembershipGap[]=[];
  for(const table of book.tables){
    const sheet=book.sheets.find(s=>s.id===table.sheet)!;
    for(const axis of ['row','column'] as const){
      const items=axis==='row'?sheet.rows:sheet.columns,members=new Set(axis==='row'?[table.header,...table.rows]:table.columns.map(c=>c.column));
      const positions=items.flatMap((item,index)=>members.has(item.id)?[index]:[]);
      if(!positions.length)continue;
      for(let index=positions[0]+1;index<positions.at(-1)!;index++)if(!members.has(items[index].id))gaps.push({sheet:sheet.id,table:table.id,axis,member:items[index].id,index});
    }
  }
  return gaps;
}
export function expandAdjacentTable(book:Workbook,sheet:Sheet,row:string,column:string):Table|undefined {
  if(tableAt(book,sheet.id,row,column))return;
  const at=sheet.rows.findIndex(r=>r.id===row);
  if(at<1)return;
  const candidates=book.tables.filter(t=>t.sheet===sheet.id&&t.columns.some(c=>c.column===column)&&
    Math.max(sheet.rows.findIndex(r=>r.id===t.header),...t.rows.map(id=>sheet.rows.findIndex(r=>r.id===id)))===at-1);
  if(candidates.length!==1)return;
  const table=candidates[0];
  if(book.tables.some(t=>t!==table&&t.sheet===sheet.id&&(t.header===row||t.rows.includes(row))&&t.columns.some(c=>table.columns.some(x=>x.column===c.column))))return;
  if(table.columns.some(c=>{
    const cell=getCell(sheet,row,c.column);return cell.formula||cell.calculation||cell.binding||cell.value!=null&&cell.value!==''||cell.note||cell.link;
  }))return;
  table.rows.push(row);
  inheritTableRow(book,sheet,table,row,table.rows.length-1);
  if(at===sheet.rows.length-1)sheet.rows.push({id:uid()});
  return table;
}
export function insertColumn(book:Workbook,sheet:Sheet,at:number,scope?:Table):Column {
  if(at<0||at>sheet.columns.length)throw Error('Column insertion is outside the sheet.');
  const right=sheet.columns[at]?.id,column:Column={id:uid(),label:'New column',width:145};
  inheritInsertedGroups(sheet,'column',[{at,id:column.id}]);
  sheet.columns.splice(at,0,column);
  for(const t of book.tables.filter(t=>t.sheet===sheet.id&&(!scope||t.id===scope.id))){
    const index=scope?t.columns.filter(c=>sheet.columns.findIndex(x=>x.id===c.column)<at).length:t.columns.findIndex(c=>c.column===right);
    if(index>=0){
      const name=uniqueName(t.columns.map(c=>c.name),'New column');
      t.columns.splice(index,0,{id:uid(),column:column.id,name});sheet.cells[key(t.header,column.id)]={value:name};
    }
  }
  return column;
}
export function summaryMoveMembers(sheet:Sheet,axis:Group['axis'],ids:string[]):string[]{
  const chosen=new Set(ids);let added=true;
  while(added){added=false;for(const g of sheet.groups)if(g.axis===axis&&g.kind==='summary'&&chosen.has(g.members[0]))for(const id of g.members)if(!chosen.has(id)){chosen.add(id);added=true;}}
  return[...chosen];
}
function moveGroupPlan(sheet:Sheet,axis:Group['axis'],ids:string[],boundary:number):{group:Group;inside:boolean;whole:boolean}[]{
  const moving=new Set(ids),positions=new Map((axis==='row'?sheet.rows:sheet.columns).map((item,i)=>[item.id,i]));
  return sheet.groups.filter(group=>group.axis===axis).map(group=>{
    const members=group.kind==='summary'?[group.members[0],...outlineMembers(group,sheet.groups)]:outlineMembers(group,sheet.groups);
    const {first,last}=stationaryGroupBounds({...group,members},positions,new Set());
    return {group,inside:boundary>first&&boundary<=last,whole:group.members.every(id=>moving.has(id))};
  });
}
function applyMoveGroupPlan(sheet:Sheet,axis:Group['axis'],ids:string[],plan:ReturnType<typeof moveGroupPlan>):void{
  const moving=new Set(ids),items=axis==='row'?sheet.rows:sheet.columns,positions=new Map(items.map((item,i)=>[item.id,i])),ordered=items.filter(item=>moving.has(item.id));
  for(const {group,inside,whole} of plan){
    if(whole)continue;
    if(!inside){group.members=group.members.filter(id=>!moving.has(id));continue;}
    for(const item of ordered){
      if(group.members.includes(item.id))continue;
      const at=positions.get(item.id)!,before=group.members.findIndex((member,index)=>(group.kind!=='summary'||index>0)&&(positions.get(member)??-1)>=at);
      group.members.splice(before<0?group.members.length:before,0,item.id);
    }
  }
}
export function moveTargetGroups(sheet:Sheet,axis:Group['axis'],ids:string[],boundary:number,scope?:Table):Group[]{
  const items=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!items.includes(id))||boundary<0||boundary>items.length)throw Error('Invalid move preview.');
  const moving=summaryMoveMembers(sheet,axis,ids);
  if(axis==='row'&&scope&&moving.some(id=>!scope.rows.includes(id)))throw Error('Move options, not the list header.');
  return moveGroupPlan(sheet,axis,moving,boundary).filter(target=>target.inside&&!target.whole).map(target=>target.group);
}
export function groupMoveTarget(sheet:Sheet,axis:Group['axis'],ids:string[],groupId:string,scope?:Table):{group:Group;members:string[];boundary:number;parents:Group[]}{
  const items=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id),group=sheet.groups.find(g=>g.id===groupId&&g.axis===axis);
  if(!group||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!items.includes(id)))throw Error('Invalid group move.');
  const members=summaryMoveMembers(sheet,axis,ids),coverage=(g:Group)=>new Set(g.kind==='summary'?[g.members[0],...outlineMembers(g,sheet.groups)]:outlineMembers(g,sheet.groups)),target=coverage(group);
  if(group.kind==='summary'&&members.includes(group.members[0])||[...target].every(id=>members.includes(id)))throw Error('A group cannot be moved into itself.');
  if(axis==='row'&&scope&&members.some(id=>!scope.rows.includes(id)))throw Error('Move options, not the list header.');
  const positions=items.map((id,i)=>target.has(id)?i:-1).filter(i=>i>=0);if(!positions.length)throw Error('The destination group has no rows or columns.');
  const parents=sheet.groups.filter(g=>{if(g===group||g.axis!==axis)return false;const parent=coverage(g);return parent.size>target.size&&[...target].every(id=>parent.has(id));});
  return {group,members,boundary:positions.reduce((last,position)=>Math.max(last,position),-1)+1,parents};
}
export function moveIntoGroup(book:Workbook,sheet:Sheet,axis:Group['axis'],ids:string[],groupId:string,scope?:Table):number{
  const target=groupMoveTarget(sheet,axis,ids,groupId,scope);
  const at=axis==='row'?moveRows(book,sheet,ids,target.boundary,scope):moveColumns(book,sheet,ids,target.boundary);
  const moving=new Set(target.members),ordered=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id).filter(id=>moving.has(id));
  for(const group of [target.group,...target.parents])for(const id of ordered)if(!group.members.includes(id))group.members.push(id);
  return at;
}
export function moveRows(book:Workbook,sheet:Sheet,ids:string[],boundary:number,scope?:Table):number{
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!sheet.rows.some(r=>r.id===id))||boundary<0||boundary>sheet.rows.length)throw Error('Invalid row move.');
  ids=summaryMoveMembers(sheet,'row',ids);
  const selected=new Set(ids),groups=moveGroupPlan(sheet,'row',ids,boundary);
  if(scope){
    if(ids.some(id=>!scope.rows.includes(id)))throw Error('Move options, not the list header.');
    const slots=sheet.rows.map((r,i)=>scope.rows.includes(r.id)?i:-1).filter(i=>i>=0),records=slots.map(i=>sheet.rows[i]);
    const columns=new Set(scope.columns.map(c=>c.column));
    for(const row of records){
      if(book.tables.some(t=>t.id!==scope.id&&t.sheet===sheet.id&&(t.header===row.id||t.rows.includes(row.id)))||Object.entries(sheet.cells).some(([address,c])=>address.startsWith(row.id+':')&&!columns.has(address.split(':')[1])&&(c.value!=null||c.formula||c.binding||c.note||c.link)))throw Error('These rows share other data. Move them in the full sheet instead.');
    }
    const at=slots.filter((i,n)=>i<boundary&&!selected.has(records[n].id)).length,moving=records.filter(r=>selected.has(r.id)),remaining=records.filter(r=>!selected.has(r.id));
    remaining.splice(at,0,...moving);slots.forEach((i,n)=>sheet.rows[i]=remaining[n]);scope.rows=remaining.map(r=>r.id);
    applyMoveGroupPlan(sheet,'row',ids,groups);
    return slots[at];
  }
  const at=sheet.rows.slice(0,boundary).filter(r=>!selected.has(r.id)).length,moving=sheet.rows.filter(r=>selected.has(r.id));
  const remaining=sheet.rows.filter(r=>!selected.has(r.id)),positions=new Map(remaining.map((row,index)=>[row.id,index]));
  const targets=book.tables.filter(t=>t.sheet===sheet.id&&!selected.has(t.header)).flatMap(table=>{
    const members=[table.header,...table.rows].flatMap(id=>positions.has(id)?[positions.get(id)!]:[]);
    if(!members.length||at<=Math.min(...members)||at>Math.max(...members))return[];
    const added=tableRowsToAdd(book,sheet,table,ids);return added.length?[{table,added}]:[];
  });
  for(let i=0;i<targets.length;i++)for(const other of targets.slice(i+1))if(targets[i].added.some(id=>other.added.includes(id))&&targets[i].table.columns.some(c=>other.table.columns.some(x=>x.column===c.column)))throw Error('The destination overlaps multiple tables using the same columns.');
  sheet.rows=remaining;sheet.rows.splice(at,0,...moving);
  applyMoveGroupPlan(sheet,'row',ids,groups);
  for(const target of targets)addTableRows(book,sheet,target.table,target.added);
  for(const table of book.tables.filter(t=>t.sheet===sheet.id))table.rows.sort((a,b)=>sheet.rows.findIndex(r=>r.id===a)-sheet.rows.findIndex(r=>r.id===b));
  return at;
}
export function moveColumns(book:Workbook,sheet:Sheet,ids:string[],boundary:number):number {
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!sheet.columns.some(c=>c.id===id))||boundary<0||boundary>sheet.columns.length)throw Error('Invalid column move.');
  ids=summaryMoveMembers(sheet,'column',ids);
  const moving=sheet.columns.filter(c=>ids.includes(c.id)),groups=moveGroupPlan(sheet,'column',ids,boundary);
  const at=sheet.columns.slice(0,boundary).filter(c=>!ids.includes(c.id)).length;
  sheet.columns=sheet.columns.filter(c=>!ids.includes(c.id));
  sheet.columns.splice(at,0,...moving);
  applyMoveGroupPlan(sheet,'column',ids,groups);
  for(const t of book.tables.filter(t=>t.sheet===sheet.id))t.columns.sort((a,b)=>sheet.columns.findIndex(c=>c.id===a.column)-sheet.columns.findIndex(c=>c.id===b.column));
  return at;
}
export function translate(ast: Ast, book: Workbook, sheetId: string, fromRow: string, fromCol: string, toRow: string, toCol: string, targetSheetId=sheetId): Ast {
  const sheet = book.sheets.find(s => s.id === sheetId)!;
  const destination=book.sheets.find(s=>s.id===targetSheetId)!;
  const dr = destination.rows.findIndex(r => r.id === toRow) - sheet.rows.findIndex(r => r.id === fromRow);
  const dc = destination.columns.findIndex(c => c.id === toCol) - sheet.columns.findIndex(c => c.id === fromCol);
  return mapAst(ast, node => {
    if(node.kind==='structured'&&node.implicit){
      const source=book.tables.find(t=>t.id===node.table),target=tableAt(book,targetSheetId,toRow,toCol);
      if(source&&target&&source.id!==target.id)return{...node,table:target.id,columns:node.columns.map(id=>{
        const name=source.columns.find(c=>c.id===id)?.name;
        return target.columns.find(c=>c.name.toLowerCase()===name?.toLowerCase())?.id??'deleted';
      })};
    }
    if (node.kind !== 'ref') return node;
    const target = book.sheets.find(s => s.id === node.sheet);
    if (!target) return node;
    const newTarget=!node.explicit&&node.sheet===sheetId?destination:target;
    return { ...node,sheet:newTarget.id,
      row: newTarget.rows[target.rows.findIndex(r=>r.id===node.row)+(node.absRow?0:dr)]?.id??'deleted',
      column: newTarget.columns[target.columns.findIndex(c=>c.id===node.column)+(node.absCol?0:dc)]?.id??'deleted' };
  });
}
export function mapAst(ast: Ast, fn: (node: Ast) => Ast): Ast {
  let node = clone(ast);
  if (node.kind === 'binary') node = { ...node, left: mapAst(node.left, fn), right: mapAst(node.right, fn) };
  if (node.kind === 'unary' || node.kind === 'spill') node = { ...node, child: mapAst(node.child, fn) };
  if (node.kind === 'range') node = { ...node, start: mapAst(node.start, fn), end: mapAst(node.end, fn) };
  if (node.kind === 'call') node = { ...node, args: node.args.map(x => mapAst(x, fn)) };
  return fn(node);
}
export function fillCells(book:Workbook,sheet:Sheet,source:{r1:number;r2:number;c1:number;c2:number},target:{r1:number;r2:number;c1:number;c2:number}):void {
  if(target.r1<0||target.c1<0||target.r2>=sheet.rows.length||target.c2>=sheet.columns.length||source.r1<target.r1||source.r2>target.r2||source.c1<target.c1||source.c2>target.c2)throw Error('Fill range is outside the sheet.');
  if((target.r2-target.r1+1)*(target.c2-target.c1+1)>200_000)throw Error('Fill exceeds the safe cell limit.');
  const height=source.r2-source.r1+1,width=source.c2-source.c1+1;
  const cells=sheet.rows.slice(source.r1,source.r2+1).map(r=>sheet.columns.slice(source.c1,source.c2+1).map(c=>clone(getCell(sheet,r.id,c.id))));
  for(let r=target.r1;r<=target.r2;r++)for(let c=target.c1;c<=target.c2;c++){
    if(r>=source.r1&&r<=source.r2&&c>=source.c1&&c<=source.c2)continue;
    const sr=source.r1+((r-source.r1)%height+height)%height,sc=source.c1+((c-source.c1)%width+width)%width,row=sheet.rows[r].id,column=sheet.columns[c].id;
    if(book.tables.some(t=>t.sheet===sheet.id&&t.header===row&&t.columns.some(x=>x.column===column)))throw Error('Fill cannot overwrite table headers.');
    const cell=clone(cells[sr-source.r1][sc-source.c1]);
    if(cell.formula||cell.binding||cell.value!=null&&cell.value!=='')expandAdjacentTable(book,sheet,row,column);
    if(cell.formula)cell.formula=translate(cell.formula,book,sheet.id,sheet.rows[sr].id,sheet.columns[sc].id,row,column);
    else if(typeof cell.value==='string'&&/\d+$/.test(cell.value)&&height===1&&width===1){
      const offset=r===source.r1?c-source.c1:r-source.r1;
      cell.value=cell.value.replace(/\d+$/,n=>String(Number(n)+offset));
    }
    if(cell.calculation)cell.calculation=translate(cell.calculation,book,sheet.id,sheet.rows[sr].id,sheet.columns[sc].id,row,column);
    sheet.cells[key(row,column)]=cell;
  }
}
export function duplicateSheet(book: Workbook, source: Sheet): Sheet {
  const mapping = new Map<string, string>([[source.id, uid()]]);
  for (const r of source.rows) mapping.set(r.id, uid());
  for (const c of source.columns) mapping.set(c.id, uid());
  const tables = book.tables.filter(t => t.sheet === source.id);
  for (const t of tables) { mapping.set(t.id, uid()); for (const c of t.columns) mapping.set(c.id, uid()); }
  const scopedNames = book.names.filter(n => n.sheet === source.id);
  for (const n of scopedNames) mapping.set(n.id, uid());
  const remap = (v: unknown): unknown => {
    if (typeof v === 'string') return mapping.get(v) ?? v;
    if (Array.isArray(v)) return v.map(remap);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]));
    return v;
  };
  const copy = remap(source) as Sheet;
  copy.name = uniqueName(book.sheets.map(s => s.name), `${source.name} copy`);
  copy.cells = Object.fromEntries(Object.entries(source.cells).map(([k, v]) => [k.split(':').map(id => mapping.get(id) ?? id).join(':'), remap(v) as Cell]));
  for (const t of tables) {
    const copied = remap(t) as Table;
    copied.name = uniqueName(book.tables.map(x => x.name), `${t.name}_copy`);
    book.tables.push(copied);
  }
  for (const n of scopedNames) book.names.push(remap(n) as Named);
  copy.groups = copy.groups.map(g => ({ ...g, id: uid() }));
  book.sheets.push(copy);
  return copy;
}
export function createDemo(): Workbook {
  const ingredients = blankSheet('Ingredients', 80, 12), meals = blankSheet('Meals', 100, 12);
  const journal = blankSheet('Daily log', 100, 12), notes = blankSheet('Notebook', 100, 16);
  const book: Workbook = { schema: 1, id: uid(), title: 'My nutrition workbook', revision: 0,
    sheets: [journal, ingredients, meals, notes], tables: [], names: [], pickerSources: {} };
  function table(sheet: Sheet, name: string, headers: string[], data: (string | number)[][]): void {
    const t: Table = { id: uid(), name, sheet: sheet.id, header: sheet.rows[0].id,
      columns: headers.map((name, i) => ({ id: uid(), column: sheet.columns[i].id, name })),
      rows: data.map((_, i) => sheet.rows[i + 1].id) };
    book.tables.push(t);
    [headers, ...data].forEach((row, i) => row.forEach((v, j) => setInput(book, sheet, sheet.rows[i].id, sheet.columns[j].id, String(v))));
  }
  table(ingredients, 'Ingredients', ['Ingredient', 'Serving (g)', 'Calories (kcal)', 'Protein (g)', 'Conversion Unit', 'Calories per g'],
    [['Example oats', 40, 150, 5, 'cup', '=[@[Calories (kcal)]]/[@[Serving (g)]]'],
      ['Example lentils', 100, 116, 9, 'g', '=[@[Calories (kcal)]]/[@[Serving (g)]]'],
      ['Example yogurt', 170, 100, 17, 'tub', '=[@[Calories (kcal)]]/[@[Serving (g)]]']]);
  table(meals, 'Meals', ['Meal', 'Ingredient', 'Amount (g)', 'Calories', 'Notes'],
    [['Example breakfast', 'Example oats', 60, '=XLOOKUP([@Ingredient],Ingredients[Ingredient],Ingredients[Calories per g],"")*[@[Amount (g)]]', 'Synthetic examples only. Replace with your own data.'],
      ['', 'Example yogurt', 170, '=XLOOKUP([@Ingredient],Ingredients[Ingredient],Ingredients[Calories per g],"")*[@[Amount (g)]]', '']]);
  table(journal, 'DailyLog', ['Date', 'Food', 'Amount (g)', 'Calories', 'Status', 'Notes'],
    [['2026-01-01', 'Example lentils', 180, '=XLOOKUP([@Food],Ingredients[Ingredient],Ingredients[Calories per g],"")*[@[Amount (g)]]', 'real', 'Start anywhere. Every cell is editable.']]);
  setInput(book, notes, notes.rows[0].id, notes.columns[0].id, 'A little room to think.');
  setInput(book, notes, notes.rows[2].id, notes.columns[0].id, 'Freeform cells, independent tables, and your own formulas.');
  setInput(book, notes, notes.rows[4].id, notes.columns[0].id, '=SUM(DailyLog[Calories])');
  notes.cells[key(notes.rows[0].id, notes.columns[0].id)].format = { bold: true };
  return book;
}
