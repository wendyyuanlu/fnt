import { compile,Engine,maySpill,scalar,type Ast } from './formula';

export type Scalar = string | number | boolean | null | Fault;
export interface Fault { error: string; detail?: string }
export type Value = Scalar | Value[];
export interface Format {
  bold?: boolean; underline?: boolean; wrap?: boolean;
  color?: string; background?: string; number?: string; excelNumberFormat?: string;
}
export interface Cell {
  value?: Scalar; formula?: Ast; calculation?: Ast; original?: string; format?: Format; note?: string; link?: string;
  spillHint?: boolean;
  binding?: { table: string; row: string; column: string };
}
export interface Column { id: string; label: string; width?: number; hidden?: boolean }
export interface Row { id: string; hidden?: boolean; height?: number; status?: 'real' | 'planned' | 'hypothetical' }
export interface Group { id: string; axis: 'row' | 'column'; members: string[]; collapsed: boolean; label: string }
export interface Validation { id: string; rows: string[]; columns: string[]; source: string; sheet: string; values?: string[]; originalSource?: string }
export interface Sheet {
  id: string; name: string; color: string; columns: Column[]; rows: Row[];
  cells: Record<string, Cell>; groups: Group[]; validations: Validation[];
  supporting?:boolean;
}
export interface ReferenceSource {
  id:string;name:string;kind:'list'|'units'|'conversions'|'derived';table?:string;column?:string;
  archived?:boolean;archivedRows:string[];
  origin?:{original:string;table?:string;definition?:string};
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
export interface Workbook {
  schema: 1; id: string; title: string; revision: number; sheets: Sheet[]; tables: Table[]; names: Named[];
  pickerSources: Record<string, string>;
  references?:ReferenceSource[];
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
  sheet.groups=sheet.groups.map(g=>g.axis==='row'?{...g,members:g.members.filter(id=>!removed.has(id))}:g).filter(g=>g.members.length);
  sheet.validations=sheet.validations.map(v=>({...v,rows:v.rows.filter(id=>!removed.has(id))})).filter(v=>v.rows.length);
}
export function deleteColumn(book: Workbook, sheet: Sheet, id: string): void {
  sheet.columns = sheet.columns.filter(c => c.id !== id);
  for (const t of book.tables.filter(t => t.sheet === sheet.id)) t.columns = t.columns.filter(c => c.column !== id);
  for (const k of Object.keys(sheet.cells)) if (k.endsWith(`:${id}`)) delete sheet.cells[k];
  book.tables=book.tables.filter(t=>t.sheet!==sheet.id||t.columns.length>0);
  sheet.groups=sheet.groups.map(g=>g.axis==='column'?{...g,members:g.members.filter(c=>c!==id)}:g).filter(g=>g.members.length);
  sheet.validations=sheet.validations.map(v=>({...v,columns:v.columns.filter(c=>c!==id)})).filter(v=>v.columns.length);
}
export function addRow(book: Workbook, sheet: Sheet, at: number, table?: Table): Row {
  const row: Row = { id: uid() };
  sheet.rows.splice(at, 0, row);
  if (table) {
    const before = sheet.rows.slice(0, at).filter(r => table.rows.includes(r.id)).length;
    table.rows.splice(before, 0, row.id);
    inheritTableRow(book,sheet,table,row.id,before);
  }
  return row;
}
function inheritTableRow(book:Workbook,sheet:Sheet,table:Table,row:string,at:number):void {
  const candidates=[...table.rows.slice(0,at).reverse(),...table.rows.slice(at+1)];
  const marker=table.columns.find(c=>['ismeal','isday'].includes(c.name.toLowerCase())),label=table.columns.find(c=>['meal','weight'].includes(c.name.toLowerCase()));
  const engine=marker||label?new Engine(book):undefined;
  const isHeader=(id:string)=>{
    if(!engine)return false;
    const value=scalar(engine.cell(sheet.id,id,(marker??label)!.column));
    if(isFault(value))throw Error('Fix the meal/day header marker error before adding records.');
    return marker?value===true:value!==null&&value!=='';
  };
  const sameKind=candidates.filter(id=>isHeader(id)===isHeader(row));
  for(const col of table.columns){
    const matching=col===marker?candidates:sameKind;
    const template=matching.find(id=>getCell(sheet,id,col.column).formula??getCell(sheet,id,col.column).calculation)??matching[0];
    if(!template)continue;
    const source=getCell(sheet,template,col.column);
    const formula=source.formula??source.calculation;
    sheet.cells[key(row,col.column)]={
      format:source.format?clone(source.format):undefined,
      ...(formula?{formula:translate(formula,book,sheet.id,template,col.column,row,col.column),spillHint:maySpill(formula)}:{})
    };
  }
  for(const validation of [...sheet.validations]){
    const columns=validation.columns.filter(c=>table.columns.some(col=>col.column===c));
    if(columns.length&&validation.rows.includes(candidates[0])&&!validation.rows.includes(row)){
      if(columns.length===validation.columns.length)validation.rows.push(row);
      else sheet.validations.push({...clone(validation),id:uid(),rows:[row],columns});
    }
  }
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
export function insertColumn(book:Workbook,sheet:Sheet,at:number):Column {
  if(at<0||at>sheet.columns.length)throw Error('Column insertion is outside the sheet.');
  const right=sheet.columns[at]?.id,column:Column={id:uid(),label:'New column',width:145};
  sheet.columns.splice(at,0,column);
  for(const t of book.tables.filter(t=>t.sheet===sheet.id)){
    const index=t.columns.findIndex(c=>c.column===right);
    if(index>=0){
      const name=uniqueName(t.columns.map(c=>c.name),'New column');
      t.columns.splice(index,0,{id:uid(),column:column.id,name});sheet.cells[key(t.header,column.id)]={value:name};
    }
  }
  return column;
}
export function moveColumns(book:Workbook,sheet:Sheet,ids:string[],boundary:number):number {
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!sheet.columns.some(c=>c.id===id))||boundary<0||boundary>sheet.columns.length)throw Error('Invalid column move.');
  const moving=sheet.columns.filter(c=>ids.includes(c.id));
  const at=sheet.columns.slice(0,boundary).filter(c=>!ids.includes(c.id)).length;
  sheet.columns=sheet.columns.filter(c=>!ids.includes(c.id));
  sheet.columns.splice(at,0,...moving);
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
