import { allSheets,allTables, columnIndex, fault, getCell, isFault, key, letters, tableAt, type Fault, type Scalar, type Value, type Workbook } from './model';
import { excelDate,excelDateParts } from './dates';
import {createFoodCaptureContext,quantityFactor,type FoodCaptureContext} from './food-capture';

export type Ast =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'error'; value: Fault }
  | { kind: 'ref'; sheet: string; row: string; column: string; absRow: boolean; absCol: boolean; explicit?: boolean }
  | { kind: 'structured'; table: string; columns: string[]; mode: 'data' | 'row' | 'all' | 'headers' | 'totals'; implicit?: boolean }
  | { kind: 'name'; id: string }
  | { kind: 'variable'; name: string }
  | { kind: 'binary'; op: string; left: Ast; right: Ast }
  | { kind: 'unary'; op: string; child: Ast }
  | { kind: 'range'; start: Ast; end: Ast }
  | { kind: 'spill'; child: Ast }
  | { kind: 'call'; name: string; args: Ast[] };

type Token = { type: 'number' | 'string' | 'word' | 'bracket' | 'symbol' | 'quoted'; text: string };
type Env = Map<string, Value | (() => Value)>;
const compiled = new WeakMap<Workbook, { revision: number; trees: Map<string, Ast> }>();
const normalName = (s: string) => s.replace(/_xlfn\.|_xlws\./gi, '').toUpperCase();
export const supportedFunctions = new Set(['IF', 'IFERROR', 'SUM', 'AVERAGE', 'MIN', 'MAX', 'INDEX', 'MATCH', 'XLOOKUP', 'XMATCH', 'FILTER', 'VSTACK', 'LET', 'ROW', 'ROWS', 'ISNUMBER', 'DATE', 'DATEDIF', 'FIND', 'LEFT', 'RIGHT', 'ROUND', 'VALUE', 'AND', 'OR', 'NOT', 'COUNT', 'COUNTA', 'ABS', 'INT', 'TODAY', 'CONCAT', 'LEN', 'TRIM', 'LOWER', 'UPPER', 'INDIRECT', 'ANCHORARRAY', 'UNITFACTOR']);
function tokenize(source: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let text = '', closed = false; i++;
      while (i < source.length) {
        if (source[i] === c) {
          if (source[i + 1] === c) { text += c; i += 2; }
          else { i++; closed = true; break; }
        } else text += source[i++];
      }
      if (!closed) throw Error('Unclosed quoted string.');
      out.push({ type: c === '"' ? 'string' : 'quoted', text }); continue;
    }
    if (c === '[') {
      const start = i; let depth = 0;
      do {
        if(source[i]==="'"&&/['[\]#@]/.test(source[i+1]??'')){i+=2;continue;}
        if (source[i] === '[') depth++; if (source[i] === ']') depth--; i++;
      } while (i < source.length && depth > 0);
      if (depth) throw Error('Unclosed structured reference.');
      out.push({ type: 'bracket', text: source.slice(start, i) }); continue;
    }
    const number = source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) { out.push({ type: 'number', text: number[0] }); i += number[0].length; continue; }
    const word = source.slice(i).match(/^[\p{L}_$\\][\p{L}\p{N}_.$\\]*/u);
    if (word) { out.push({ type: 'word', text: word[0] }); i += word[0].length; continue; }
    const error = source.slice(i).match(/^#(?:REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|SPILL!|CALC!|NULL!)/);
    if (error) { out.push({ type: 'word', text: error[0] }); i += error[0].length; continue; }
    const op = source.slice(i).match(/^(?:<>|<=|>=|[+\-*/^&=<>():,!%#;])/);
    if (!op) throw Error(`Unexpected character at ${i + 1}: ${c}`);
    out.push({ type: 'symbol', text: op[0] }); i += op[0].length;
  }
  return out;
}
export function compile(source: string, book: Workbook, sheetId: string, rowId: string, colId: string): Ast {
  let pool=compiled.get(book);
  if(!pool||pool.revision!==book.revision){pool={revision:book.revision,trees:new Map()};compiled.set(book,pool);}
  const tokens = tokenize(source.replace(/^=/, '')); let pos = 0;
  let localNames=new Set<string>();
  const peek = () => tokens[pos]?.text;
  const take = (s: string) => { if (peek() === s) { pos++; return true; } return false; };
  const expect = (s: string) => { if (!take(s)) throw Error(`Expected ${s}, found ${peek() ?? 'end'}.`); };
  const ref = (text: string, sid: string, explicit=false): Ast => {
    const m = text.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/);
    if (!m) return { kind: 'error', value: fault('#REF!', 'Invalid cell address.') };
    const sheet = allSheets(book).find(s => s.id === sid);
    return { kind: 'ref', sheet: sid, row: sheet?.rows[Number(m[4]) - 1]?.id ?? 'deleted',
      column: sheet?.columns[columnIndex(m[2])]?.id ?? 'deleted', absRow: !!m[3], absCol: !!m[1], explicit };
  };
  const structured = (text: string, tableName?: string): Ast => {
    const table = tableName ? allTables(book).find(t => t.name.toLowerCase() === tableName.toLowerCase()) : tableAt(book, sheetId, rowId, colId);
    if (!table) return { kind: 'error', value: fault('#REF!', `Unknown table ${tableName ?? '(this row)'}`) };
    const stack:{text:string;child:boolean}[]=[],leaves:string[]=[];
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==="'"&&/['[\]#@]/.test(text[i+1]??'')){if(stack.length)stack[stack.length-1].text+=c+text[++i];continue;}
      if(c==='['){if(stack.length)stack[stack.length-1].child=true;stack.push({text:'',child:false});}
      else if(c===']'){const leaf=stack.pop();if(leaf&&!leaf.child)leaves.push(leaf.text);}
      else if(stack.length)stack[stack.length-1].text+=c;
    }
    const metadata=leaves.filter(s=>s.startsWith('#')).map(s=>s.toLowerCase());
    let mode: Extract<Ast, {kind:'structured'}>['mode'] = 'data';
    if (/^\[\[?@/.test(text) || metadata.includes('#this row')) mode = 'row';
    if (metadata.includes('#all')) mode = 'all';
    if (metadata.includes('#headers')) mode = 'headers';
    if (metadata.includes('#totals')) mode = 'totals';
    const parts=leaves.filter(s=>s&&!s.startsWith('#')).map(s=>(mode==='row'?s.replace(/^@/,''):s).replace(/'(['[\]#@])/g,'$1'));
    const columns = parts.length ? parts.map(name => table.columns.find(c => c.name.toLowerCase() === name.toLowerCase())?.id ?? 'deleted') : table.columns.map(c => c.id);
    if (text.includes(']:[') && columns.length === 2) {
      const a = table.columns.findIndex(c => c.id === columns[0]), b = table.columns.findIndex(c => c.id === columns[1]);
      columns.splice(0, columns.length, ...table.columns.slice(Math.min(a,b), Math.max(a,b)+1).map(c => c.id));
    }
    return { kind: 'structured', table: table.id, columns, mode, implicit:!tableName };
  };
  const primary = (): Ast => {
    const token = tokens[pos++];
    if (!token) throw Error('Missing expression.');
    if (token.text === '(') { const result = expression(0); expect(')'); return result; }
    if (token.text === '+' || token.text === '-') return { kind: 'unary', op: token.text, child: expression(7) };
    if (token.type === 'number') {const value=Number(token.text);return Number.isFinite(value)?{kind:'literal',value}:{kind:'error',value:fault('#NUM!','Numeric literal exceeds the supported range.')};}
    if (token.type === 'string') return { kind: 'literal', value: token.text };
    if (token.type === 'bracket') return structured(token.text);
    if (token.text.startsWith('#')) return { kind: 'error', value: fault(token.text) };
    if (take('!')) {
      const sid = allSheets(book).find(s => s.name.toLowerCase() === token.text.toLowerCase())?.id ?? 'deleted';
      const address = tokens[pos++];
      if (!address) throw Error('Missing sheet address.');
      return ref(address.text, sid, true);
    }
    if (take('(')) {
      const args: Ast[] = [],name=normalName(token.text),outerNames=localNames;
      if(name==='LET')localNames=new Set(localNames);
      if (!take(')')) {
        do {
          if(name==='LET'&&args.length%2===0&&tokens[pos]?.type==='word'&&[',',';'].includes(tokens[pos+1]?.text))args.push({kind:'variable',name:tokens[pos++].text.toUpperCase()});
          else args.push(peek() === ',' || peek() === ')' ? { kind: 'literal', value: null } : expression(0));
          if(name==='LET'&&args.length%2===0){const binding=args[args.length-2];if(binding.kind==='variable')localNames.add(binding.name);}
        } while (take(',') || take(';'));
        expect(')');
      }
      localNames=outerNames;
      return { kind: 'call', name, args };
    }
    if (tokens[pos]?.type === 'bracket') return structured(tokens[pos++].text, token.text);
    if (/^\$?[A-Za-z]+\$?\d+$/.test(token.text)) return ref(token.text, sheetId);
    if (/^(TRUE|FALSE)$/i.test(token.text)) return { kind: 'literal', value: token.text.toUpperCase() === 'TRUE' };
    if(localNames.has(token.text.toUpperCase()))return{kind:'variable',name:token.text.toUpperCase()};
    const named = book.names.find(n => n.sheet === sheetId && n.name.toLowerCase() === token.text.toLowerCase())
      ?? book.names.find(n => !n.sheet && n.name.toLowerCase() === token.text.toLowerCase());
    return named ? { kind: 'name', id: named.id } : { kind: 'variable', name: token.text.toUpperCase() };
  };
  const precedence: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 6, ':': 8 };
  const expression = (min: number): Ast => {
    let left = primary();
    while (true) {
      if (take('%')) { left = { kind: 'unary', op: '%', child: left }; continue; }
      if (take('#')) { left = { kind: 'spill', child: left }; continue; }
      const op = peek(), p = precedence[op];
      if (p === undefined || p < min) break;
      pos++;
      let right = expression(p + (op === '^' ? 0 : 1));
      if (op === ':') {
        if (left.kind === 'ref' && right.kind === 'ref' && left.explicit && !right.explicit) {
          const rightRef=right,sourceSheet=allSheets(book).find(s=>s.id===rightRef.sheet),targetSheet=allSheets(book).find(s=>s.id===(left as Extract<Ast,{kind:'ref'}>).sheet);
          const r=sourceSheet?.rows.findIndex(r=>r.id===rightRef.row)??-1,c=sourceSheet?.columns.findIndex(c=>c.id===rightRef.column)??-1;
          right={...rightRef,sheet:left.sheet,row:targetSheet?.rows[r]?.id??'deleted',column:targetSheet?.columns[c]?.id??'deleted',explicit:true};
        }
        left = { kind: 'range', start: left, end: right };
      } else left = { kind: 'binary', op, left, right };
    }
    return left;
  };
  const ast = expression(0);
  if (pos !== tokens.length) throw Error(`Unexpected ${peek()}.`);
  const cacheKey=JSON.stringify(ast),cached=pool.trees.get(cacheKey);
  if(cached)return cached;
  pool.trees.set(cacheKey,ast);
  return ast;
}
export function displayFormula(ast: Ast, book: Workbook): string {
  const show = (n: Ast): string => {
    switch (n.kind) {
      case 'literal': return typeof n.value === 'string' ? `"${n.value.replace(/"/g, '""')}"` : n.value === null ? '' : typeof n.value === 'boolean' ? String(n.value).toUpperCase() : String(n.value);
      case 'error': return n.value.error;
      case 'ref': {
        const s = allSheets(book).find(s => s.id === n.sheet);
        const r = s?.rows.findIndex(r => r.id === n.row) ?? -1, c = s?.columns.findIndex(c => c.id === n.column) ?? -1;
        if (!s || r < 0 || c < 0) return '#REF!';
        return `${n.explicit?`'${s.name.replace(/'/g, "''")}'!`:''}${n.absCol ? '$' : ''}${letters(c)}${n.absRow ? '$' : ''}${r + 1}`;
      }
      case 'structured': {
        const t = allTables(book).find(t => t.id === n.table);
        if (!t) return '#REF!';
        const cols = n.columns.map(id => t.columns.find(c => c.id === id)?.name?.replace(/['[\]#@]/g,c=>"'"+c));
        if (cols.some(x => x === undefined)) return '#REF!';
        const prefix=n.implicit?'':t.name;
        if (n.mode === 'row' && cols.length === 1) return `${prefix}[@[${cols[0]}]]`;
        if (n.mode === 'data' && cols.length === 1) return `${prefix}[${cols[0]}]`;
        return `${prefix}[[${n.mode === 'all' ? '#All' : n.mode === 'headers' ? '#Headers' : n.mode === 'row' ? '#This Row' : '#Data'}],${cols.map(c => `[${c}]`).join(':')}]`;
      }
      case 'name': return book.names.find(x => x.id === n.id)?.name ?? '#REF!';
      case 'variable': return n.name;
      case 'binary': return `(${show(n.left)}${n.op}${show(n.right)})`;
      case 'unary': return n.op === '%' ? `(${show(n.child)})%` : `${n.op}(${show(n.child)})`;
      case 'range': return `${show(n.start)}:${show(n.end)}`;
      case 'spill': return `${show(n.child)}#`;
      case 'call': return `${n.name}(${n.args.map(show).join(',')})`;
    }
  };
  return `=${show(ast)}`;
}
export const flatten = (v: Value): Scalar[] => Array.isArray(v) ? v.flatMap(flatten) : [v];
export const scalar = (v: Value): Scalar => Array.isArray(v) ? scalar(v[0] ?? null) : v;
const text = (v: Value) => { const s = scalar(v); return s === null ? '' : isFault(s) ? s.error : typeof s === 'boolean' ? String(s).toUpperCase() : String(s); };
const number = (v: Value): number | Fault => {
  const s = scalar(v);
  if (isFault(s)) return s;
  if (s === null || s === '') return 0;
  if (typeof s === 'boolean') return s ? 1 : 0;
  const n = Number(s); return Number.isFinite(n) ? n : fault('#VALUE!', 'Expected a number.');
};
const truth = (v: Value): boolean | Fault => {
  const s = scalar(v);
  if (isFault(s)) return s;
  if (typeof s === 'string' && !/^(TRUE|FALSE)?$/i.test(s)) return fault('#VALUE!', 'Expected a logical value.');
  return typeof s === 'string' ? s.toUpperCase() === 'TRUE' : !!s;
};
function zip(a: Value, b: Value, fn: (x: Scalar, y: Scalar) => Value): Value {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length && a.length !== 1 && b.length !== 1) return fault('#VALUE!', 'Array sizes differ.');
    const len = Math.max(Array.isArray(a) ? a.length : 1, Array.isArray(b) ? b.length : 1);
    return Array.from({ length: len }, (_, i) => zip(Array.isArray(a) ? a[a.length === 1 ? 0 : i] : a, Array.isArray(b) ? b[b.length === 1 ? 0 : i] : b, fn));
  }
  return fn(a, b);
}
export const compare = (a: Scalar, b: Scalar): number => {
  const x = a === null ? (typeof b === 'string' ? '' : 0) : a;
  const y = b === null ? (typeof a === 'string' ? '' : 0) : b;
  if (typeof x !== typeof y) return (typeof x === 'boolean' ? 3 : typeof x === 'string' ? 2 : 1) - (typeof y === 'boolean' ? 3 : typeof y === 'string' ? 2 : 1);
  return typeof x === 'string' && typeof y === 'string' ? x.toLowerCase().localeCompare(y.toLowerCase()) : x === y ? 0 : x! < y! ? -1 : 1;
};
export function maySpill(ast:Ast,bindings=new Map<string,Ast>(),depth=0):boolean {
  if(depth>100)return false;
  if(ast.kind==='range'||ast.kind==='spill')return true;
  if(ast.kind==='structured')return ast.mode!=='row'||ast.columns.length>1;
  if(ast.kind==='variable'){const source=bindings.get(ast.name);return source?maySpill(source,bindings,depth+1):false;}
  if(ast.kind==='binary')return maySpill(ast.left,bindings,depth+1)||maySpill(ast.right,bindings,depth+1);
  if(ast.kind==='unary')return maySpill(ast.child,bindings,depth+1);
  if(ast.kind==='call'){
    if(['FILTER','VSTACK','ANCHORARRAY'].includes(ast.name))return true;
    if(ast.name==='LET'){
      const local=new Map(bindings);for(let i=0;i<ast.args.length-1;i+=2){const id=ast.args[i];if(id.kind==='variable')local.set(id.name,ast.args[i+1]);}
      return !!ast.args.length&&maySpill(ast.args.at(-1)!,local,depth+1);
    }
    if(ast.name==='IF'||ast.name==='IFERROR')return ast.args.slice(ast.name==='IF'?1:0).some(a=>maySpill(a,bindings,depth+1));
    if(ast.name==='XLOOKUP'){const returns=ast.args[2];return returns?.kind==='structured'&&returns.columns.length>1;}
    if(ast.name==='INDEX')return ast.args.slice(1).some(a=>a.kind==='literal'&&a.value===0);
  }
  return false;
}
export const calculationWorkLimit=500_000;
export class Engine {
  cache = new Map<string, Value>();
  visiting = new Set<string>();
  spills = new Map<string, Scalar>();
  private sheets: Map<string, Workbook['sheets'][number]>;
  private rowSets: Map<string, Set<string>>;
  private colSets: Map<string, Set<string>>;
  private dependents=new Map<string,Set<string>>();
  private stack:string[]=[];
  private lazyRefs=new WeakMap<()=>Value,{ast:Ast;env:Env}>();
  private remaining=calculationWorkLimit;
  private spillAnchors=new Map<string,{row:string;column:string;r:number;c:number}[]>();
  private rowPositions=new Map<string,Map<string,number>>();
  private columnPositions=new Map<string,Map<string,number>>();
  private tableRows=new Map<string,Set<string>>();
  private flatValues=new WeakMap<Value[],Scalar[]>();
  private exactMatches=new WeakMap<Scalar[],Map<Scalar,{first:number;last:number}>>();
  private vectorFaults=new WeakMap<Scalar[],{first?:Fault;compatibility?:Fault}>();
  private referenceRanges=new Map<string,{sheet:string;rows:string[];columns:string[]}>();
  private contiguousRows=new WeakMap<string[],{start:number;end:number;valid:boolean}>();
  private referenceMembers=0;
  private rangeSizes=new Map<string,number>();
  private rangeCells=0;
  private labelBindings=new Set<string>();
  private labelDomains=new Map<string,{table:string;column:string;header:string}[]>();
  private recordVectors=new WeakMap<string[],Map<string,{bindings:Set<string>;positions:Map<string,number>}>>();
  private faults(values:Scalar[]):{first?:Fault;compatibility?:Fault}{
    let result=this.vectorFaults.get(values);
    if(!result){
      result={first:values.find(isFault),compatibility:values.find((v):v is Fault=>isFault(v)&&['#UNSUPPORTED!','#LIMIT!'].includes(v.error))};
      this.vectorFaults.set(values,result);
    }
    return result;
  }
  private flat(value:Value):Scalar[]{
    if(!Array.isArray(value))return[value];
    let result=this.flatValues.get(value);
    if(!result){result=flatten(value);this.flatValues.set(value,result);}
    return result;
  }
  private depend(key:string):void{
    const parent=this.stack.at(-1);if(!parent||parent===key)return;
    let deps=this.dependents.get(key);if(!deps){deps=new Set();this.dependents.set(key,deps);}deps.add(parent);
  }
  private unitContext?:FoodCaptureContext;
  beginPass():void {this.remaining=calculationWorkLimit;this.unitContext=undefined;}
  rebindLayout(book:Workbook):boolean{
    if(book.tables!==this.book.tables||book.names!==this.book.names||book.references!==this.book.references||book.dropdownData?.tables!==this.book.dropdownData?.tables)return false;
    const sheets=allSheets(book);
    if(sheets.length!==this.sheets.size||sheets.some(s=>{
      const old=this.sheets.get(s.id);
      return !old||s.cells!==old.cells||s.rows.length!==old.rows.length||s.columns.length!==old.columns.length||
        s.rows.some((r,i)=>this.rowPositions.get(s.id)?.get(r.id)!==i)||s.columns.some((c,i)=>this.columnPositions.get(s.id)?.get(c.id)!==i);
    }))return false;
    this.book=book;this.unitContext=undefined;this.sheets=new Map(sheets.map(s=>[s.id,s]));return true;
  }
  rebindCells(book:Workbook,changed:string[]):boolean{
    if(book.tables!==this.book.tables||book.names!==this.book.names||book.references!==this.book.references||book.dropdownData?.tables!==this.book.dropdownData?.tables)return false;
    const affected=new Set(changed.map(id=>id.slice(0,id.indexOf(':')))),sheets=allSheets(book);
    if(sheets.length!==this.sheets.size||sheets.some(s=>{
      const old=this.sheets.get(s.id);
      return !old||s.rows!==old.rows||s.columns!==old.columns||s.validations!==old.validations||s.groups!==old.groups||s.name!==old.name||s.cells!==old.cells&&!affected.has(s.id);
    }))return false;
    this.book=book;this.sheets=new Map(sheets.map(s=>[s.id,s]));this.invalidate(changed);return true;
  }
  constructor(public book: Workbook) {
    this.sheets=new Map(allSheets(book).map(s=>[s.id,s]));
    this.rowSets=new Map(allSheets(book).map(s=>[s.id,new Set(s.rows.map(r=>r.id))]));
    this.colSets=new Map(allSheets(book).map(s=>[s.id,new Set(s.columns.map(c=>c.id))]));
    this.tableRows=new Map(allTables(book).map(t=>[t.id,new Set(t.rows)]));
    for(const source of book.references??[]){
      const table=allTables(book).find(t=>t.id===(source.derived?.table??source.table));
      const field=table?.columns.find(c=>c.id===(source.derived?.column??source.column));
      if(!table||!field)continue;
      this.labelBindings.add(`${table.id}:${field.id}`);
      const key=`${table.sheet}:${field.column}`,domains=this.labelDomains.get(key)??[];
      if(!domains.some(d=>d.table===table.id&&d.column===field.id))domains.push({table:table.id,column:field.id,header:table.header});
      this.labelDomains.set(key,domains);
    }
    for(const s of allSheets(book)){
      const rows=new Map(s.rows.map((r,i)=>[r.id,i])),cols=new Map(s.columns.map((c,i)=>[c.id,i]));
      this.rowPositions.set(s.id,rows);this.columnPositions.set(s.id,cols);
      this.spillAnchors.set(s.id,Object.entries(s.cells).filter(([,cell])=>cell.formula&&(cell.spillHint??(!book.importReport&&maySpill(cell.formula)))).map(([k])=>{
        const [row,column]=k.split(':');return{row,column,r:rows.get(row)!,c:cols.get(column)!};
      }));
    }
  }
  invalidate(changed:string[]):void {
    this.unitContext=undefined;
    let spillChanged=false;
    for(const id of changed){
      const [sheetId,row,column]=id.split(':'),s=this.sheets.get(sheetId);if(!s)continue;
      const previous=this.spillAnchors.get(sheetId)??[],cell=getCell(s,row,column),anchors=previous.filter(a=>a.row!==row||a.column!==column);
      if(anchors.length!==previous.length)spillChanged=true;
      if(cell.formula&&(cell.spillHint??(!this.book.importReport&&maySpill(cell.formula)))){
        anchors.push({row,column,r:this.rowPositions.get(sheetId)!.get(row)!,c:this.columnPositions.get(sheetId)!.get(column)!});spillChanged=true;
      }
      this.spillAnchors.set(sheetId,anchors);
    }
    if(this.spills.size||spillChanged){this.cache.clear();this.rangeSizes.clear();this.rangeCells=0;this.spills.clear();this.dependents.clear();return;}
    const pending=[...changed],seen=new Set<string>();
    while(pending.length){
      const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);this.cache.delete(id);
      for(const parent of this.dependents.get(id)??[])pending.push(parent);
    }
  }
  cell(sheetId: string, row: string, col: string): Value {
    const cacheKey = `${sheetId}:${key(row,col)}`;
    const parent=this.stack.at(-1);
    if(parent&&parent!==cacheKey){let set=this.dependents.get(cacheKey);if(!set){set=new Set();this.dependents.set(cacheKey,set);}set.add(parent);}
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;
    if (this.visiting.has(cacheKey)) return fault('#CYCLE!', 'Circular reference.');
    if(this.stack.length>150)return fault('#LIMIT!','Dependency depth exceeds the safe review-build limit.');
    const sheet = this.sheets.get(sheetId);
    if (!sheet || !this.rowSets.get(sheetId)!.has(row) || !this.colSets.get(sheetId)!.has(col)) return fault('#REF!');
    const cell = getCell(sheet, row, col);
    if (!cell.formula && cell.value == null && !cell.binding) {
      const anchors=this.spillAnchors.get(sheetId);
      if(anchors?.length&&!this.spills.has(cacheKey)){
        const r=sheet.rows.findIndex(r=>r.id===row),c=sheet.columns.findIndex(c=>c.id===col);
        for(const anchor of anchors)if(anchor.r<=r&&anchor.c<=c&&!this.visiting.has(`${sheetId}:${key(anchor.row,anchor.column)}`))this.cell(sheetId,anchor.row,anchor.column);
      }
      return this.spills.get(cacheKey) ?? null;
    }
    this.visiting.add(cacheKey);
    this.stack.push(cacheKey);
    let result: Value;
    try {
      if (cell.binding) {
        const t = allTables(this.book).find(t => t.id === cell.binding!.table);
        const c = t?.columns.find(c => c.id === cell.binding!.column);
        result = t && c && this.tableRows.get(t.id)!.has(cell.binding.row) ? this.cell(t.sheet, cell.binding.row, c.column) : fault('#REF!', 'Linked record was deleted.');
      } else result = cell.formula ? this.evaluate(cell.formula, sheetId, row, col) : cell.value ?? null;
      if(!cell.formula&&!cell.binding&&!cell.fractionLiteral&&cell.format?.number==='fraction'&&typeof result==='string'){
        const fraction=parseFraction(result);
        if(fraction.kind==='fraction')result=fraction.value;
        else if(fraction.kind==='invalid')result=fault(fraction.error,fraction.message);
      }
      if (Array.isArray(result)) {
        const matrix: Value[][] = result.map(v => Array.isArray(v) ? v : [v]);
        const ri = sheet.rows.findIndex(r => r.id === row), ci = sheet.columns.findIndex(c => c.id === col);
        let blocked = false;
        matrix.forEach((r, i) => r.forEach((_, j) => {
          if (i === 0 && j === 0) return;
          const rr = sheet.rows[ri+i], cc = sheet.columns[ci+j];
          const target = rr && cc ? getCell(sheet, rr.id, cc.id) : undefined;
          if(rr&&cc){const targetKey=`${sheetId}:${key(rr.id,cc.id)}`;let deps=this.dependents.get(targetKey);if(!deps){deps=new Set();this.dependents.set(targetKey,deps);}deps.add(cacheKey);}
          if (!target || target.formula || target.binding || target.value != null || this.spills.has(`${sheetId}:${key(rr.id,cc.id)}`)) blocked = true;
        }));
        if (blocked) result = fault('#SPILL!', 'Spill range is occupied or outside sheet.');
        else matrix.forEach((r,i) => r.forEach((v,j) => {
          if (i || j) this.spills.set(`${sheetId}:${key(sheet.rows[ri+i].id, sheet.columns[ci+j].id)}`, scalar(v));
        }));
      }
    } finally { this.visiting.delete(cacheKey);this.stack.pop(); }
    if(!this.flat(result!).some(v=>isFault(v)&&v.error==='#LIMIT!'))this.cache.set(cacheKey, result!);
    return result!;
  }
  evaluateCalculation(ast:Ast,sheet:string,row:string,column:string):Value{
    const id=`${sheet}:${key(row,column)}`;
    if(this.visiting.has(id))return fault('#CYCLE!','Circular reference.');
    this.invalidate([id]);this.visiting.add(id);this.stack.push(id);
    try{return this.evaluate(ast,sheet,row,column);}
    finally{this.stack.pop();this.visiting.delete(id);this.invalidate([id]);}
  }
  evaluate(ast: Ast, sheet: string, row: string, col: string, env:Env = new Map()): Value {
    if(--this.remaining<0)return fault('#LIMIT!','Calculation work limit reached. This workbook needs further compatibility/performance work; results are not authoritative.');
    const ev = (n: Ast) => this.evaluate(n, sheet, row, col, env);
    switch (ast.kind) {
      case 'literal': case 'error': return ast.value;
      case 'ref': return scalar(this.cell(ast.sheet, ast.row, ast.column));
      case 'spill': return ast.child.kind === 'ref' ? this.cell(ast.child.sheet, ast.child.row, ast.child.column) : ev(ast.child);
      case 'variable': {
        const v=env.get(ast.name);return typeof v==='function'?v():v??fault('#NAME?', `Unknown name ${ast.name}`);
      }
      case 'name': {
        const n = this.book.names.find(n => n.id === ast.id);
        if (!n) return fault('#REF!');
        const visit = `name:${n.id}`;
        if (this.visiting.has(visit)) return fault('#CYCLE!');
        this.visiting.add(visit);
        try { return this.evaluate(n.formula, n.context, row, col, env); } finally { this.visiting.delete(visit); }
      }
      case 'structured': {
        const t = allTables(this.book).find(t => t.id === ast.table);
        if (!t) return fault('#REF!', 'Table was deleted.');
        const columns = ast.columns.map(id => t.columns.find(c => c.id === id));
        if (columns.some(c => !c)) return fault('#REF!', 'Column was deleted.');
        if (ast.mode === 'totals') return fault('#UNSUPPORTED!', 'Totals-row references are preserved but not calculated.');
        const rows = ast.mode === 'row' ? [row] : ast.mode === 'headers' ? [t.header] : ast.mode === 'all' ? [t.header, ...t.rows] : t.rows;
        if (ast.mode === 'row' && !this.tableRows.get(t.id)!.has(row)) return fault('#VALUE!', 'This-row reference outside its table.');
        const cacheKey=`vector:${t.id}:${ast.mode}:${ast.columns.join(',')}`,parent=this.stack.at(-1);
        if(ast.mode!=='row'){
          if(parent){let deps=this.dependents.get(cacheKey);if(!deps){deps=new Set();this.dependents.set(cacheKey,deps);}deps.add(parent);}
          const cached=this.cache.get(cacheKey);if(cached)return cached;
          this.stack.push(cacheKey);
        }
        let result:Value[][];
        try{result = rows.map(r => columns.map(c => scalar(this.cell(t.sheet, r, c!.column))));}
        finally{if(ast.mode!=='row')this.stack.pop();}
        if(ast.mode!=='row'&&!this.flat(result).some(v=>isFault(v)&&v.error==='#LIMIT!'))this.cache.set(cacheKey,result);
        return ast.mode === 'row' && columns.length === 1 ? result[0][0] : result;
      }
      case 'range': {
        const start=this.reference(ast.start,sheet,row,col,env),end=this.reference(ast.end,sheet,row,col,env);
        if(!start||!end||start.sheet!==end.sheet)return fault('#REF!', 'Invalid range endpoints.');
        const target = this.sheets.get(start.sheet);
        if (!target) return fault('#REF!');
        const r1 = this.rowPositions.get(target.id)!.get(start.rows[0])??-1, r2 = this.rowPositions.get(target.id)!.get(end.rows.at(-1)!)??-1;
        const c1 = this.columnPositions.get(target.id)!.get(start.columns[0])??-1, c2 = this.columnPositions.get(target.id)!.get(end.columns.at(-1)!)??-1;
        if ([r1,r2,c1,c2].some(x => x < 0)) return fault('#REF!');
        const cacheKey=`range:${target.id}:${Math.min(r1,r2)}:${Math.max(r1,r2)}:${Math.min(c1,c2)}:${Math.max(c1,c2)}`;
        this.depend(cacheKey);const cached=this.cache.get(cacheKey);if(cached)return cached;
        this.stack.push(cacheKey);let value:Value;
        try{
          const columns=target.columns.slice(Math.min(c1,c2),Math.max(c1,c2)+1);
          value=target.rows.slice(Math.min(r1,r2),Math.max(r1,r2)+1).map(r=>columns.map(c=>scalar(this.cell(target.id,r.id,c.id))));
        }finally{this.stack.pop();}
        const size=(Math.abs(r2-r1)+1)*(Math.abs(c2-c1)+1);
        if(size<=100000&&!this.flat(value).some(v=>isFault(v)&&v.error==='#LIMIT!')){
          if(this.rangeSizes.has(cacheKey)){this.rangeCells-=this.rangeSizes.get(cacheKey)!;this.rangeSizes.delete(cacheKey);}
          while(this.rangeCells+size>100000){
            const oldest=this.rangeSizes.keys().next().value!;this.rangeCells-=this.rangeSizes.get(oldest)!;this.rangeSizes.delete(oldest);this.cache.delete(oldest);
          }
          this.rangeSizes.set(cacheKey,size);this.rangeCells+=size;this.cache.set(cacheKey,value);
        }
        return value;
      }
      case 'unary': return zip(ev(ast.child), 0, (a) => { const n = number(a); return isFault(n) ? n : ast.op === '-' ? -n : ast.op === '%' ? n/100 : n; });
      case 'binary': return zip(ev(ast.left), ev(ast.right), (a,b) => {
        if (isFault(a)) return a; if (isFault(b)) return b;
        if (ast.op === '&') return text(a)+text(b);
        if (['=', '<>', '<', '>', '<=', '>='].includes(ast.op)) {
          const c = compare(a,b);
          return ast.op === '=' ? c === 0 : ast.op === '<>' ? c !== 0 : ast.op === '<' ? c < 0 : ast.op === '>' ? c > 0 : ast.op === '<=' ? c <= 0 : c >= 0;
        }
        const x = number(a), y = number(b);
        if (isFault(x)) return x; if (isFault(y)) return y;
        if (ast.op === '/' && y === 0) return fault('#DIV/0!');
        const n = ast.op === '+' ? x+y : ast.op === '-' ? x-y : ast.op === '*' ? x*y : ast.op === '/' ? x/y : x**y;
        return Number.isFinite(n) ? n : fault('#NUM!');
      });
      case 'call': return this.call(ast, sheet, row, col, env);
    }
  }
  private reference(ast:Ast,sheet:string,row:string,col:string,env:Env):{sheet:string;rows:string[];columns:string[]}|undefined {
    if(ast.kind==='ref')return{sheet:ast.sheet,rows:[ast.row],columns:[ast.column]};
    if(ast.kind==='variable'){
      const binding=env.get(ast.name),ref=typeof binding==='function'?this.lazyRefs.get(binding):undefined;
      if(ref)return this.reference(ref.ast,sheet,row,col,ref.env);
    }
    if(ast.kind==='name'){
      const named=this.book.names.find(n=>n.id===ast.id);
      const marker=`reference-name:${ast.id}`;
      if(this.visiting.has(marker))return;
      if(named&&named.formula.kind!=='name'){
        this.visiting.add(marker);try{return this.reference(named.formula,named.context,row,col,env);}finally{this.visiting.delete(marker);}
      }
    }
    if(ast.kind==='range'){
      const start=this.reference(ast.start,sheet,row,col,env),end=this.reference(ast.end,sheet,row,col,env);
      if(!start||!end||start.sheet!==end.sheet)return;
      const s=this.sheets.get(start.sheet);if(!s)return;
      const r1=this.rowPositions.get(s.id)!.get(start.rows[0])??-1,r2=this.rowPositions.get(s.id)!.get(end.rows.at(-1)!)??-1,c1=this.columnPositions.get(s.id)!.get(start.columns[0])??-1,c2=this.columnPositions.get(s.id)!.get(end.columns.at(-1)!)??-1;
      if([r1,r2,c1,c2].some(i=>i<0))return;
      const cacheKey=`${s.id}:${Math.min(r1,r2)}:${Math.max(r1,r2)}:${Math.min(c1,c2)}:${Math.max(c1,c2)}`;
      let ref=this.referenceRanges.get(cacheKey);
      if(!ref){
        ref={sheet:s.id,rows:s.rows.slice(Math.min(r1,r2),Math.max(r1,r2)+1).map(r=>r.id),columns:s.columns.slice(Math.min(c1,c2),Math.max(c1,c2)+1).map(c=>c.id)};
        this.contiguousRows.set(ref.rows,{start:Math.min(r1,r2),end:Math.max(r1,r2),valid:true});
        const size=ref.rows.length+ref.columns.length;
        if(size<=100000){
          while(this.referenceMembers+size>100000){const oldest=this.referenceRanges.keys().next().value!,value=this.referenceRanges.get(oldest)!;this.referenceMembers-=value.rows.length+value.columns.length;this.referenceRanges.delete(oldest);}
          this.referenceRanges.set(cacheKey,ref);this.referenceMembers+=size;
        }
      }
      return ref;
    }
    if(ast.kind==='structured'){
      const t=allTables(this.book).find(t=>t.id===ast.table);if(!t)return;
      const cols=ast.columns.map(id=>t.columns.find(c=>c.id===id)?.column);if(cols.some(c=>!c))return;
      return{sheet:t.sheet,rows:ast.mode==='row'?[row]:ast.mode==='headers'?[t.header]:ast.mode==='all'?[t.header,...t.rows]:t.rows,columns:cols as string[]};
    }
    if(ast.kind==='call'&&ast.name==='INDEX'){
      const base=this.reference(ast.args[0],sheet,row,col,env);if(!base)return;
      const rr=number(ast.args[1]?this.evaluate(ast.args[1],sheet,row,col,env):1),cc=number(ast.args[2]?this.evaluate(ast.args[2],sheet,row,col,env):1);
      if(isFault(rr)||isFault(cc)||rr<0||cc<0||rr>base.rows.length||cc>base.columns.length)return;
      return{sheet:base.sheet,rows:rr===0?base.rows:[base.rows[Math.floor(rr)-1]],columns:cc===0?base.columns:[base.columns[Math.floor(cc)-1]]};
    }
    return;
  }
  private referenceMatch(ref:{sheet:string;rows:string[];columns:string[]},needle:Scalar,search:number):Value|undefined{
    if(ref.columns.length!==1||!ref.rows.length||isFault(needle))return;
    const sheet=this.sheets.get(ref.sheet),positions=this.rowPositions.get(ref.sheet);
    if(!sheet||!positions)return;
    const start=positions.get(ref.rows[0]),end=positions.get(ref.rows.at(-1)!);
    if(start===undefined||end===undefined)return;
    let contiguous=this.contiguousRows.get(ref.rows);
    if(!contiguous){contiguous={start,end,valid:end-start+1===ref.rows.length&&ref.rows.every((id,i)=>sheet.rows[start+i].id===id)};this.contiguousRows.set(ref.rows,contiguous);}
    if(!contiguous.valid)return;
    let match=-1,firstError:Scalar|undefined,compatibility:Scalar|undefined;
    // Compatibility errors anywhere in the reference still override a match.
    for(let at=start;at<=end;){
      const stop=Math.min(end+1,(Math.floor(at/128)+1)*128),column=ref.columns[0];
      const cacheKey=`match-range:${ref.sheet}:${column}:${at}:${stop}`;
      this.depend(cacheKey);
      let values=this.cache.get(cacheKey) as Scalar[]|undefined;
      if(!values){
        values=[];this.stack.push(cacheKey);
        try{for(let i=at;i<stop;i++)values.push(scalar(this.cell(ref.sheet,sheet.rows[i].id,column)));}
        finally{this.stack.pop();}
        if(!values.some(v=>isFault(v)&&v.error==='#LIMIT!'))this.cache.set(cacheKey,values);
      }
      const faults=this.faults(values);firstError??=faults.first;compatibility??=faults.compatibility;
      let matches=this.exactMatches.get(values);
      if(!matches){matches=new Map();this.exactMatches.set(values,matches);}
      let found=matches.get(needle);
      if(!found){
        found={first:-1,last:-1};
        for(let i=0;i<values.length;i++)if(!isFault(values[i])&&compare(values[i],needle)===0){if(found.first<0)found.first=i;found.last=i;}
        matches.set(needle,found);
      }
      const index=search===-1?found.last:found.first;
      if(index>=0&&(match<0||search===-1))match=at-start+index;
      at=stop;
    }
    return compatibility??(match>=0?match+1:firstError??fault('#N/A'));
  }
  private recordMatch(needle:Ast,lookup:Ast,sheet:string,row:string,col:string,env:Env):number|undefined{
    const input=this.reference(needle,sheet,row,col,env);
    if(!input||input.rows.length!==1||input.columns.length!==1)return;
    const owner=this.sheets.get(input.sheet),binding=owner&&getCell(owner,input.rows[0],input.columns[0]).binding;
    if(!binding||!this.labelBindings.has(`${binding.table}:${binding.column}`))return;
    const ref=this.reference(lookup,sheet,row,col,env);
    if(!ref||ref.columns.length!==1)return;
    let columns=this.recordVectors.get(ref.rows);
    if(!columns){columns=new Map();this.recordVectors.set(ref.rows,columns);}
    let vector=columns.get(`${ref.sheet}:${ref.columns[0]}`);
    if(!vector){
      const domains=(this.labelDomains.get(`${ref.sheet}:${ref.columns[0]}`)??[])
        .filter(d=>ref.rows.every(id=>id===d.header||this.tableRows.get(d.table)?.has(id)));
      vector={bindings:new Set(domains.map(d=>`${d.table}:${d.column}`)),positions:new Map(ref.rows.map((id,i)=>[id,i]))};
      columns.set(`${ref.sheet}:${ref.columns[0]}`,vector);
    }
    if(!vector.bindings.size)return;
    return vector.bindings.has(`${binding.table}:${binding.column}`)?vector.positions.get(binding.row)??-1:-1;
  }
  private call(ast: Extract<Ast, {kind:'call'}>, sheet: string, row: string, col: string, env: Env): Value {
    const args = ast.args, name = ast.name, ev = (i: number, fallback: Value = null) => args[i] ? this.evaluate(args[i],sheet,row,col,env) : fallback;
    if (!supportedFunctions.has(name)) return fault('#UNSUPPORTED!', `${name} is preserved, not calculated.`);
    if (name === 'IF') {
      const cond = ev(0), c = truth(cond);
      if (!Array.isArray(cond)) return isFault(c) ? c : ev(c ? 1 : 2, false);
      const yes = ev(1), no = ev(2,false);
      const choose = (c: Value, a: Value, b: Value): Value => {
        if (Array.isArray(c)) return c.map((v,i) => choose(v, Array.isArray(a) ? a[i] ?? a[0] : a, Array.isArray(b) ? b[i] ?? b[0] : b));
        const flag = truth(c); return isFault(flag) ? flag : flag ? a : b;
      };
      return choose(cond, yes, no);
    }
    if (name === 'IFERROR') {
      const v = ev(0);
      if (!Array.isArray(v)) return isFault(v)&&!['#UNSUPPORTED!','#LIMIT!'].includes(v.error) ? ev(1) : v;
      let replacement:Value,loaded=false;
      const fallback=(path:number[]):Value=>{
        if(!loaded){replacement=ev(1);loaded=true;}
        let value=replacement;
        for(const i of path)if(Array.isArray(value))value=value[value.length===1?0:i]??fault('#VALUE!','IFERROR fallback array dimensions differ.');
        return value;
      };
      const walk = (x: Value,path:number[]): Value => Array.isArray(x) ? x.map((v,i)=>walk(v,[...path,i])) : isFault(x)&&!['#UNSUPPORTED!','#LIMIT!'].includes(x.error) ? fallback(path) : x;
      return walk(v,[]);
    }
    if (name === 'LET') {
      if (args.length < 3 || args.length % 2 !== 1) return fault('#VALUE!', 'LET needs name/value pairs and a result.');
      const local = new Map(env);
      for (let i = 0; i < args.length-1; i += 2) {
        const id = args[i];
        if (id.kind !== 'variable') return fault('#NAME?', 'Invalid LET variable.');
        const scope=new Map(local),valueAst=args[i+1];let cached:Value,ready=false;
        const lazy=()=>{if(!ready){cached=this.evaluate(valueAst,sheet,row,col,scope);ready=true;}return cached;};
        this.lazyRefs.set(lazy,{ast:valueAst,env:scope});local.set(id.name,lazy);
      }
      return this.evaluate(args[args.length-1],sheet,row,col,local);
    }
    if (name === 'INDIRECT') {
      try { return this.evaluate(compile(`=${text(ev(0))}`,this.book,sheet,row,col),sheet,row,col,env); }
      catch { return fault('#REF!', 'Invalid INDIRECT address. Text references cannot follow renames.'); }
    }
    if (name === 'ANCHORARRAY') return args[0]?.kind === 'ref' ? this.cell(args[0].sheet,args[0].row,args[0].column) : ev(0);
    if(name==='ROWS'&&args.length===1&&args[0].kind==='structured'&&['data','all','headers'].includes(args[0].mode)){
      const source=args[0],cacheKey=`dimensions:${source.table}:${source.mode}:${source.columns.join(',')}`;
      this.depend(cacheKey);
      const cached=this.cache.get(cacheKey);if(typeof cached==='number')return cached;
      const ref=this.reference(source,sheet,row,col,env),target=ref&&this.sheets.get(ref.sheet);
      // ROWS historically propagates errors from values. Only bypass evaluation
      // when stored scalar cells prove there can be no formula or spill error.
      if(ref&&target&&!this.spillAnchors.get(target.id)?.length&&ref.rows.every(r=>ref.columns.every(c=>{
        const cell=getCell(target,r,c);return !cell.formula&&!cell.binding&&cell.value!=null&&!isFault(cell.value);
      }))){
        this.stack.push(cacheKey);
        try{for(const r of ref.rows)for(const c of ref.columns)this.depend(`${target.id}:${key(r,c)}`);}
        finally{this.stack.pop();}
        this.cache.set(cacheKey,ref.rows.length);return ref.rows.length;
      }
    }
    if((name==='XMATCH'||name==='MATCH')&&args[1]&&
      (args[1].kind==='range'||args[1].kind==='structured'&&['data','all','headers'].includes(args[1].mode))&&
      (args[2]?.kind==='literal'?args[2].value===0:name==='XMATCH')&&
      (name==='MATCH'||!args[3]||args[3].kind==='literal'&&(args[3].value===1||args[3].value===-1))){
      const needle=scalar(ev(0)),ref=this.reference(args[1],sheet,row,col,env);
      if(ref){
        const result=this.referenceMatch(ref,needle,name==='XMATCH'&&args[3]?.kind==='literal'?Number(args[3].value):1);
        if(result!==undefined){
          const record=isFault(needle)?undefined:this.recordMatch(args[0],args[1],sheet,row,col,env);
          if(record===undefined||isFault(result)&&['#UNSUPPORTED!','#LIMIT!'].includes(result.error))return result;
          return record>=0?record+1:isFault(result)?result:fault('#N/A');
        }
      }
    }
    if(['XLOOKUP','XMATCH','MATCH'].includes(name)){
      const needle=scalar(ev(0)),lookup=ev(1),hay=this.flat(lookup);
      if(isFault(needle))return needle;if(isFault(lookup))return lookup;
      const mode=number(name==='XLOOKUP'?ev(4,0):ev(2,name==='MATCH'?1:0)),search=number(name==='XLOOKUP'?ev(5,1):name==='XMATCH'?ev(3,1):1);
      if(isFault(mode))return mode;if(isFault(search))return search;
      if(![0,-1,1,2].includes(mode))return fault('#VALUE!','Invalid lookup match mode.');
      if(![1,-1].includes(search))return fault('#UNSUPPORTED!','Binary lookup search is not implemented.');
      const faults=this.faults(hay);if(faults.compatibility)return faults.compatibility;
      let index=mode===0?this.recordMatch(args[0],args[1],sheet,row,col,env):undefined;
      if(index===undefined){
        let matches=this.exactMatches.get(hay);if(!matches){matches=new Map();this.exactMatches.set(hay,matches);}
        let found=matches.get(needle);
        if(!found){
          found={first:-1,last:-1};
          for(let i=0;i<hay.length;i++)if(!isFault(hay[i])&&compare(hay[i],needle)===0){if(found.first<0)found.first=i;found.last=i;}
          matches.set(needle,found);
        }
        index=search===-1?found.last:found.first;
      }
      const indices=index<0&&mode!==0?hay.map((_,i)=>i):[];if(search===-1)indices.reverse();
      if(index<0&&mode===2&&typeof needle==='string'){
        let pattern='';for(let i=0;i<needle.length;i++){const c=needle[i];if(c==='~'&&i+1<needle.length){pattern+=needle[++i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}else pattern+=c==='*'?'.*':c==='?'?'.':c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
        const re=new RegExp(`^${pattern}$`,'i');index=indices.find(i=>!isFault(hay[i])&&re.test(text(hay[i])))??-1;
      }else if(index<0&&(mode===-1||mode===1)){
        const eligible=indices.filter(i=>!isFault(hay[i])&&(mode===-1?compare(hay[i],needle)<0:compare(hay[i],needle)>0));
        eligible.sort((a,b)=>mode===-1?compare(hay[b],hay[a]):compare(hay[a],hay[b]));index=eligible[0]??-1;
      }
      if(index<0)return faults.first??(name==='XLOOKUP'&&args[3]?ev(3):fault('#N/A'));
      if(name!=='XLOOKUP')return index+1;
      const ref=this.reference(args[2],sheet,row,col,env);
      if(ref){
        if(ref.rows.length===hay.length){
          const result=ref.columns.map(c=>scalar(this.cell(ref.sheet,ref.rows[index],c)));
          return result.length===1?result[0]:[result];
        }
        if(ref.rows.length===1&&ref.columns.length===hay.length)return scalar(this.cell(ref.sheet,ref.rows[0],ref.columns[index]));
        return fault('#VALUE!','Lookup and return dimensions differ.');
      }
      const returns=ev(2);if(isFault(returns))return returns;
      return Array.isArray(returns)&&returns.length===hay.length?returns[index]:fault('#VALUE!','Lookup and return dimensions differ.');
    }
    if(name==='INDEX'){
      const ref=this.reference(ast,sheet,row,col,env);
      if(ref){
        const matrix=ref.rows.map(r=>ref.columns.map(c=>scalar(this.cell(ref.sheet,r,c))));
        return matrix.length===1&&matrix[0].length===1?matrix[0][0]:matrix;
      }
    }
    if (name === 'ROW') {
      const ref = args[0];
      if (!ref) return (this.rowPositions.get(sheet)?.get(row)??-1)+1;
      const resolved=this.reference(ref,sheet,row,col,env);
      if(resolved){
        const s=this.sheets.get(resolved.sheet);if(!s)return fault('#REF!');
        const positions=resolved.rows.map(r=>(this.rowPositions.get(s.id)!.get(r)??-1)+1);
        if(positions.some(p=>p===0))return fault('#REF!');
        return positions.length===1?positions[0]:positions.map(p=>[p]);
      }
      if (ref.kind === 'ref') return allSheets(this.book).find(s => s.id === ref.sheet)?.rows.findIndex(r => r.id === ref.row)!+1 || fault('#REF!');
      if (ref.kind === 'structured') {
        const t = allTables(this.book).find(t => t.id === ref.table), s = allSheets(this.book).find(s => s.id === t?.sheet);
        return t && s ? (ref.mode === 'row' ? [row] : t.rows).map(r => [s.rows.findIndex(x => x.id === r)+1]) : fault('#REF!');
      }
      if (ref.kind === 'range' && ref.start.kind === 'ref' && ref.end.kind === 'ref') {
        const s = allSheets(this.book).find(s => s.id === (ref.start as Extract<Ast,{kind:'ref'}>).sheet);
        const a = s?.rows.findIndex(r => r.id === (ref.start as Extract<Ast,{kind:'ref'}>).row) ?? -1;
        const b = s?.rows.findIndex(r => r.id === (ref.end as Extract<Ast,{kind:'ref'}>).row) ?? -1;
        return a < 0 || b < 0 ? fault('#REF!') : Array.from({length:Math.abs(b-a)+1},(_,i) => [Math.min(a,b)+i+1]);
      }
      return fault('#VALUE!', 'ROW requires a reference.');
    }
    const values = args.map((_,i) => ev(i));
    if(!['ISNUMBER','XLOOKUP','FILTER','VSTACK'].includes(name)){
      for(const value of values){const error=this.faults(this.flat(value)).first;if(error)return error;}
    }
    const n = (i: number, fallback = 0) => number(values[i] ?? fallback);
    const numericValues=['SUM','AVERAGE','MIN','MAX','COUNT'].includes(name)?values.flatMap((value,i)=>args[i].kind==='literal'&&typeof value!=='object'?[number(value)]:this.flat(value)):[];
    if(['SUM','AVERAGE','MIN','MAX'].includes(name)){
      const error=numericValues.find(isFault);if(error)return error;
    }
    const nums = numericValues.filter((v): v is number => typeof v === 'number');
    switch (name) {
      case 'UNITFACTOR':{
        if(args.length!==2||values.some(Array.isArray))return fault('#VALUE!','UNITFACTOR requires two scalar unit names.');
        const dependency='unit-conversions';this.depend(dependency);this.stack.push(dependency);
        try{
          const factor=quantityFactor(this.book,String(values[0]??''),String(values[1]??''),this.unitContext??=createFoodCaptureContext(this.book,this));
          return factor??fault('#N/A','No finite conversion path connects these units.');
        }finally{this.stack.pop();}
      }
      case 'SUM': return nums.reduce((a,b) => a+b,0);
      case 'AVERAGE': return nums.length ? nums.reduce((a,b) => a+b,0)/nums.length : fault('#DIV/0!');
      case 'MIN': return nums.length ? Math.min(...nums) : 0;
      case 'MAX': return nums.length ? Math.max(...nums) : 0;
      case 'COUNT': return nums.length;
      case 'COUNTA': return values.flatMap(flatten).filter(v => v !== null).length;
      case 'ROWS': return Array.isArray(values[0]) ? values[0].length : 1;
      case 'ISNUMBER': return zip(values[0],null,a => typeof a === 'number');
      case 'AND': case 'OR': { const b = values.flatMap(flatten).map(truth); const e = b.find(isFault); return e ?? (name === 'AND' ? b.every(Boolean) : b.some(Boolean)); }
      case 'NOT': { const b = truth(values[0]); return isFault(b) ? b : !b; }
      case 'INDEX': {
        const rr = n(1,1), cc = n(2,1); if (isFault(rr)) return rr; if (isFault(cc)) return cc;
        const matrix = Array.isArray(values[0]) ? values[0].map(x => Array.isArray(x) ? x : [x]) : [[values[0]]];
        if (rr === 0) return matrix.map(r => r[cc-1] ?? fault('#REF!'));
        if (cc === 0) return matrix[rr-1] ?? fault('#REF!');
        return matrix[rr-1]?.[cc-1] ?? fault('#REF!');
      }
      case 'VSTACK': {
        if(!values.length)return fault('#VALUE!','VSTACK needs at least one array.');
        const rows=values.flatMap(value=>Array.isArray(value)?value.map(row=>Array.isArray(row)?row:[row]):[[value]]);
        const width=Math.max(0,...rows.map(row=>row.length));
        if(!width)return fault('#CALC!','Empty stack.');
        return rows.map(row=>Array.from({length:width},(_,i)=>row[i]??(i<row.length?null:fault('#N/A'))));
      }
      case 'FILTER': {
        const data = Array.isArray(values[0]) ? values[0] : [values[0]], include = flatten(values[1]);
        if(data.length===1&&Array.isArray(data[0])&&data[0].length===include.length&&include.length>1&&Array.isArray(values[1])&&values[1].length===1){
          const flags=include.map(truth),error=flags.find(isFault);if(error)return error;
          const result=data[0].filter((_,i)=>flags[i]);return result.length?[result]:args[2]?values[2]:fault('#CALC!','Empty array.');
        }
        if (data.length !== include.length) return fault('#VALUE!', 'FILTER array sizes differ.');
        const flags = include.map(truth), err = flags.find(isFault);
        if (err) return err;
        const result = data.filter((_,i) => flags[i]); return result.length ? result : args[2] ? values[2] : fault('#CALC!', 'Empty array.');
      }
      case 'DATE': {
        const y = n(0), m = n(1), d = n(2); if (isFault(y)) return y; if (isFault(m)) return m; if (isFault(d)) return d;
        return excelDate(y,m,d)??fault('#NUM!','Date is outside the Excel 1900 date-system range.');
      }
      case 'TODAY': { const d = new Date(); return excelDate(d.getFullYear(),d.getMonth()+1,d.getDate())??fault('#NUM!'); }
      case 'DATEDIF': {
        const a = n(0), b = n(1); if (isFault(a)) return a; if (isFault(b)) return b;
        const start=excelDateParts(a),end=excelDateParts(b);
        if(!start||!end||Math.floor(b)<Math.floor(a))return fault('#NUM!');
        const months=(end.year-start.year)*12+end.month-start.month-(end.day<start.day?1:0);
        const unit = text(values[2]).toUpperCase();
        return unit === 'D' ? Math.floor(b)-Math.floor(a) : unit === 'M' ? months : unit === 'Y' ? Math.floor(months/12) : unit === 'YM' ? months%12 : ['MD','YD'].includes(unit)?fault('#UNSUPPORTED!',`DATEDIF ${unit} legacy boundary behavior is not verified. No approximate result was substituted.`):fault('#NUM!','Invalid DATEDIF unit.');
      }
      case 'ROUND': case 'ABS': case 'INT': {
        const a = n(0), b = n(1); if (isFault(a)) return a; if (isFault(b)) return b;
        return name === 'ABS' ? Math.abs(a) : name === 'INT' ? Math.floor(a) : Math.sign(a)*Math.round((Math.abs(a)+Number.EPSILON)*10**b)/10**b;
      }
      case 'VALUE': {
        const value=scalar(values[0]);
        if(typeof value==='string'){
          const fraction=parseFraction(value);
          if(fraction.kind==='fraction')return fraction.value;
          if(fraction.kind==='invalid')return fault(fraction.error,fraction.message);
        }
        return n(0);
      }
      case 'LEFT': case 'RIGHT': {
        const count = n(1,1); if (isFault(count)) return count; if (count < 0) return fault('#VALUE!');
        return name === 'LEFT' ? text(values[0]).slice(0,Math.floor(count)) : count === 0 ? '' : text(values[0]).slice(-Math.floor(count));
      }
      case 'FIND': {
        const start = n(2,1); if (isFault(start)) return start;
        const i = text(values[1]).indexOf(text(values[0]),start-1); return start < 1 || i < 0 ? fault('#VALUE!') : i+1;
      }
      case 'CONCAT': return values.flatMap(flatten).map(text).join('');
      case 'LEN': return text(values[0]).length;
      case 'TRIM': return text(values[0]).trim().replace(/ +/g,' ');
      case 'UPPER': return text(values[0]).toUpperCase();
      case 'LOWER': return text(values[0]).toLowerCase();
      default: return fault('#UNSUPPORTED!',name);
    }
  }
}
import {parseFraction} from './quantity';
