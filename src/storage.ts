import { clone, uid, type Workbook } from './model';
import { compressArchive, decompressArchive, stringifyArchive } from './archive';
import {validateHypotheticalStyle} from './hypothetical';
import {applyUndo,type History,type UndoHistory} from './undo-history';
import {githubFormDefaults,withPrivateGitHub} from './github-client';
import {validateMealLog} from './meal-log';
import {runSyncCodec} from './sync-processing';

export interface Pending { id: string; label: string; time: string }
export interface SyncConfig { owner: string; repo: string; branch: string; path: string }
export interface LocalState {
  book: Workbook; version: number; pending: Pending[]; updated: string;
  sync?: SyncConfig; remoteSha?: string;syncPaused?:boolean;syncReview?:boolean;
  publishedSnapshot?:string;
}
export const hasPendingContent=(state:LocalState):boolean=>state.pending.some(operation=>operation.label!=='Visit table');
export interface Checkpoint { id: string; label: string; time: string; book: Workbook; backup?: string }
export interface Backup {
  format: 'fnt-backup'; version: 1; state: LocalState;
  originals: { id: string; name: string; data: string }[];
}
export function validateBackup(backup:Backup):void {
  if(!backup||backup.format!=='fnt-backup'||backup.version!==1||!backup.state||!Array.isArray(backup.state.pending)||!Array.isArray(backup.originals))throw Error('Invalid workbook backup.');
  if(backup.state.pending.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.label!=='string'||typeof p.time!=='string')||new Set(backup.state.pending.map(p=>p.id)).size!==backup.state.pending.length)throw Error('Invalid backup pending-operation journal.');
  validateBook(backup.state.book);
  validateOriginals(backup.state.book,backup.originals);
}
type Original=Backup['originals'][number];
interface Navigation {visits:Record<string,number>;pending:Pending[]}
interface JournalHead {
  state:Omit<LocalState,'book'>;book:string;revision:number;baseVersion:number;count:number;
}
interface JournalEntry {version:number;book:string;revision:number;forward:History[]}
const journalHeadKey='journal:head';
const syncCredentialKey='device:sync-credential';
const journalRange=()=>IDBKeyRange.bound('journal:entry:','journal:entry:\uffff');
const journalKey=(version:number)=>`journal:entry:${String(version).padStart(16,'0')}`;
const journalError=()=>Error('Saved change journal is damaged. Restore from recovery before continuing.');
function validateForward(forward:History[]):void{
  if(!Array.isArray(forward)||!forward.length)throw journalError();
  for(const entry of forward){
    if(!entry||typeof entry!=='object'||'book'in entry)throw Error('Full workbook changes require a complete save.');
    if('cells'in entry){
      if(!Array.isArray(entry.cells)||entry.cells.some(c=>!c||typeof c.sheet!=='string'||typeof c.key!=='string'||c.key.split(':').length!==2||[c.sheet,...c.key.split(':')].some(key=>!/^[a-zA-Z0-9_.-]{1,128}$/.test(key))||c.value!==undefined&&(!c.value||typeof c.value!=='object'||Array.isArray(c.value))))throw journalError();
    }else if('patch'in entry){
      if(!Array.isArray(entry.patch)||entry.patch.some(c=>!c||!Array.isArray(c.path)||!c.path.length||typeof c.exists!=='boolean'||c.path.some(key=>typeof key!=='string'&&!(typeof key==='number'&&Number.isSafeInteger(key)&&key>=0)||['__proto__','constructor','prototype'].includes(String(key)))||['id','schema'].includes(String(c.path[0]))))throw journalError();
    }else throw journalError();
  }
}
function validateHead(head:JournalHead):void{
  if(!head||typeof head.book!=='string'||!Number.isSafeInteger(head.revision)||!Number.isSafeInteger(head.baseVersion)||head.baseVersion<0||!Number.isSafeInteger(head.count)||head.count<0||!head.state||!Number.isSafeInteger(head.state.version)||head.state.version!==head.baseVersion+head.count||typeof head.state.updated!=='string'||!Array.isArray(head.state.pending)||head.state.pending.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.label!=='string'||typeof p.time!=='string')||new Set(head.state.pending.map(p=>p.id)).size!==head.state.pending.length)throw journalError();
}
// Keep all reads in the caller's transaction: no tab can replace the base while it is replayed.
function readState(store:IDBObjectStore,success:(state:LocalState|undefined,head:JournalHead|undefined)=>void,fail:(error:unknown)=>void):void{
  const current=store.get('current'),headRequest=store.get(journalHeadKey),entries=store.getAll(journalRange());
  let remaining=3;
  const ready=()=>{
    if(--remaining)return;
    try{
      let state=current.result as LocalState|undefined;
      const head=headRequest.result as JournalHead|undefined,records=entries.result as JournalEntry[];
      if(head){
        validateHead(head);
        if(!state||state.version!==head.baseVersion||state.book.id!==head.book||records.length!==head.count)throw journalError();
        let book=state.book;
        for(let i=0;i<records.length;i++){
          const entry=records[i];
          if(!entry||entry.version!==head.baseVersion+i+1||entry.book!==head.book||!Number.isSafeInteger(entry.revision))throw journalError();
          validateForward(entry.forward);
          for(const change of entry.forward)book=applyUndo(book,change).book;
          book.revision=entry.revision;
        }
        if(book.id!==head.book||book.revision!==head.revision)throw journalError();
        state={...head.state,book};
      }else if(records.length)throw journalError();
      if(!state){success(undefined,head);return;}
      const navigation=store.get(navigationKey(state.book.id));
      navigation.onsuccess=()=>{
        try{const result=withNavigation(state!,navigation.result);validateBook(result.book);success(result,head);}
        catch(e){fail(e);}
      };
    }catch(e){fail(e);}
  };
  current.onsuccess=ready;headRequest.onsuccess=ready;entries.onsuccess=ready;
}
function resetJournal(store:IDBObjectStore,state:LocalState):void{
  const {book,...metadata}=state;
  store.delete(journalRange());
  store.put({state:metadata,book:book.id,revision:book.revision,baseVersion:state.version,count:0} satisfies JournalHead,journalHeadKey);
}
const navigationKey=(book:string)=>`navigation:${book}`;
function withNavigation(state:LocalState,navigation?:Navigation):LocalState{
  if(!navigation)return state;
  const activity={...state.book.tableActivity};
  for(const [id,visits]of Object.entries(navigation.visits))activity[id]={...activity[id],visits:Math.max(activity[id]?.visits??0,visits)};
  return{...state,book:{...state.book,tableActivity:activity},pending:[...new Map([...state.pending,...navigation.pending].map(p=>[p.id,p])).values()]};
}
function validateOriginals(book:Workbook,originals:Original[]):void{
  if(!Array.isArray(originals)||originals.some(o=>!o||typeof o.id!=='string'||!o.id||typeof o.name!=='string'||typeof o.data!=='string')||new Set(originals.map(o=>o.id)).size!==originals.length)throw Error('Invalid original-package archive.');
  if(book.importReport&&!originals.some(o=>o.id===book.importReport!.originalId))throw Error('Backup is missing its preserved original workbook. Restore a complete independent backup.');
  if(book.references?.some(source=>source.origin&&!originals.some(o=>o.id===source.origin!.original)))throw Error('Backup is missing a supporting source original workbook. Restore a complete independent backup.');
}
export const request = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve,reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
const complete = (tx: IDBTransaction): Promise<void> => new Promise((resolve,reject) => {
  let requestError:DOMException|null= null;
  tx.oncomplete = () => resolve();
  tx.onerror = event => {if(!event.defaultPrevented&&!requestError)requestError=(event.target as IDBRequest).error??tx.error;};
  tx.onabort = () => reject(requestError??tx.error??Error('Storage transaction aborted. The record may exceed browser storage limits.'));
});
export function validateBook(value: unknown): asserts value is Workbook {
  validateWorkbook(value,true);
}
/** Only for proven metadata-only edits to an already validated workbook with untouched cells. */
export function validateBookMetadata(book:Workbook):void{
  validateWorkbook(book,false);
}
/** Only for cell-only replay against an already validated, structurally unchanged workbook. */
export function validateCellChanges(book:Workbook,changes:readonly {sheet:string;key:string}[]):void{
  const selected=new Map<string,Set<string>>();
  for(const change of changes){let keys=selected.get(change.sheet);if(!keys)selected.set(change.sheet,keys=new Set());keys.add(change.key);}
  const sheets=[...book.sheets,...book.dropdownData?.sheets??[]],targets:Workbook['sheets']=[];
  for(const [id,keys]of selected){
    const sheet=sheets.find(s=>s.id===id);if(!sheet)throw Error('Invalid cell sheet.');
    const rows=new Set<string>(),columns=new Set<string>(),cells:typeof sheet.cells={};
    for(const address of keys){
      const parts=address.split(':');if(parts.length!==2)throw Error('Invalid cell address.');
      rows.add(parts[0]);columns.add(parts[1]);
      if(Object.prototype.hasOwnProperty.call(sheet.cells,address))cells[address]=sheet.cells[address];
    }
    const selectedRows=sheet.rows.filter(r=>rows.has(r.id)),selectedColumns=sheet.columns.filter(c=>columns.has(c.id));
    if(selectedRows.length!==rows.size||selectedColumns.length!==columns.size)throw Error('Invalid cell address.');
    targets.push({...sheet,rows:selectedRows,columns:selectedColumns,cells,groups:[],validations:[]});
  }
  if(targets.length)validateBook({schema:1,id:book.id,title:book.title,revision:book.revision,sheets:targets,tables:[],names:[],pickerSources:{}});
}
function validateWorkbook(value:unknown,cells:boolean):asserts value is Workbook{
  if (!value || typeof value !== 'object') throw Error('Not a workbook.');
  const b = value as Partial<Workbook>;
  if (b.schema !== 1 || typeof b.id !== 'string' || typeof b.title !== 'string' || !Number.isInteger(b.revision) || !Array.isArray(b.sheets) || !b.sheets.length || !Array.isArray(b.tables) || !Array.isArray(b.names) || !b.pickerSources) throw Error('Invalid or unsupported workbook format.');
  if(b.dropdownData!==undefined&&(!b.dropdownData||typeof b.dropdownData!=='object'||!Array.isArray(b.dropdownData.sheets)||!Array.isArray(b.dropdownData.tables)))throw Error('Invalid DD storage.');
  const sheets=[...b.sheets,...b.dropdownData?.sheets??[]],tables=[...b.tables,...b.dropdownData?.tables??[]];
  if(b.dropdownData?.tables.some(table=>!b.dropdownData!.sheets.some(sheet=>sheet.id===table.sheet))||b.tables.some(table=>!b.sheets!.some(sheet=>sheet.id===table.sheet)))throw Error('A table is stored outside its owning sheet collection.');
  if(b.hypotheticalStyle!==undefined)validateHypotheticalStyle(b.hypotheticalStyle);
  for(const field of ['toolbarOrder','toolbarDividers'] as const){
    const ids=b[field];
    if(ids!==undefined&&(!Array.isArray(ids)||ids.length>256||ids.some(id=>typeof id!=='string'||!/^(action|control):[a-zA-Z0-9_-]{1,100}$/.test(id))||new Set(ids).size!==ids.length))throw Error(`Invalid toolbar ${field==='toolbarOrder'?'order':'dividers'}.`);
  }
  if(b.catalogMigrations!==undefined&&(!Array.isArray(b.catalogMigrations)||b.catalogMigrations.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_.-]{1,128}$/.test(id))||new Set(b.catalogMigrations).size!==b.catalogMigrations.length))throw Error('Invalid catalog migration history.');
  const ids = new Set<string>();
  const checked=new WeakSet<object>();
  const ast=(v:unknown,depth=0):void=>{
    if(!v||typeof v!=='object'||Array.isArray(v)||depth>150)throw Error('Invalid or excessively deep formula AST.');
    if(checked.has(v))return;
    checked.add(v);
    const n=v as Record<string,unknown>,strings=(...keys:string[])=>keys.every(k=>typeof n[k]==='string');
    switch(n.kind){
      case 'literal':if((n.value!==null&&!['string','number','boolean'].includes(typeof n.value))||(typeof n.value==='number'&&!Number.isFinite(n.value)))throw Error('Invalid literal.');break;
      case 'error':if(!n.value||typeof n.value!=='object'||typeof(n.value as {error?:unknown}).error!=='string')throw Error('Invalid formula error.');break;
      case 'ref':if(!strings('sheet','row','column')||typeof n.absRow!=='boolean'||typeof n.absCol!=='boolean')throw Error('Invalid reference.');break;
      case 'structured':if(!strings('table','mode')||!Array.isArray(n.columns)||n.columns.some(c=>typeof c!=='string')||!['data','row','all','headers','totals'].includes(String(n.mode)))throw Error('Invalid table reference.');break;
      case 'name':if(!strings('id'))throw Error('Invalid named reference.');break;
      case 'variable':if(!strings('name'))throw Error('Invalid variable.');break;
      case 'binary':if(!['+','-','*','/','^','&','=','<>','<','>','<=','>='].includes(String(n.op)))throw Error('Invalid operator.');ast(n.left,depth+1);ast(n.right,depth+1);break;
      case 'unary':if(!['+','-','%'].includes(String(n.op)))throw Error('Invalid unary operator.');ast(n.child,depth+1);break;
      case 'range':ast(n.start,depth+1);ast(n.end,depth+1);break;
      case 'spill':ast(n.child,depth+1);break;
      case 'call':if(!strings('name')||!Array.isArray(n.args))throw Error('Invalid function.');n.args.forEach(a=>ast(a,depth+1));break;
      default:throw Error('Unknown formula AST node.');
    }
  };
  const safeId=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(v);
  if(b.sheetTabGroups!==undefined&&(!b.sheetTabGroups||typeof b.sheetTabGroups!=='object'||Array.isArray(b.sheetTabGroups)||Object.entries(b.sheetTabGroups).some(([id,group])=>!safeId(id)||typeof group!=='string'||!group.trim()||group.length>120)))throw Error('Invalid visual sheet groups.');
  if(b.sheetTabCollapsed!==undefined&&(!Array.isArray(b.sheetTabCollapsed)||b.sheetTabCollapsed.some(group=>typeof group!=='string'||!group.trim()||group.length>120)||new Set(b.sheetTabCollapsed).size!==b.sheetTabCollapsed.length))throw Error('Invalid collapsed sheet groups.');
  if(b.tableManagerSort!==undefined&&!['activity','frequent','az','za'].includes(b.tableManagerSort))throw Error('Invalid table manager sort.');
  if(b.tableActivity!==undefined&&(!b.tableActivity||typeof b.tableActivity!=='object'||Array.isArray(b.tableActivity)||Object.entries(b.tableActivity).some(([id,activity])=>!safeId(id)||!activity||typeof activity!=='object'||Array.isArray(activity)||activity.editedAt!==undefined&&(!Number.isSafeInteger(activity.editedAt)||activity.editedAt<0)||activity.visits!==undefined&&(!Number.isSafeInteger(activity.visits)||activity.visits<0))))throw Error('Invalid table activity.');
  const id = (v: unknown) => { if (!safeId(v) || ids.has(v as string)) throw Error('Missing, invalid or duplicate identity in workbook.'); ids.add(v as string); };
  for (const s of sheets) {
    id(s.id);
    if (typeof s.name !== 'string' || !Array.isArray(s.rows) || !s.rows.length || s.rows.length>100000 || !Array.isArray(s.columns) || !s.columns.length || s.columns.length>512 || !s.cells || !Array.isArray(s.groups) || !Array.isArray(s.validations)) throw Error('Invalid or oversized sheet.');
    if(s.outlineView!==undefined&&(!s.outlineView||typeof s.outlineView!=='object'||Array.isArray(s.outlineView)||Object.entries(s.outlineView).some(([k,v])=>!['tree','plainGroupHints'].includes(k)||typeof v!=='boolean')))throw Error('Invalid sheet outline preferences.');
    if(s.pagination!==undefined)validatePagination(s.pagination);
    if(s.dayLogging!==undefined)validateDayLogging(s.dayLogging);
    if(s.mealLog!==undefined)validateMealLog(s.mealLog);
    s.rows.forEach(r => id(r.id)); s.columns.forEach(c => id(c.id));
    if([...s.rows,...s.columns].some(item=>item.hypothetical!==undefined&&typeof item.hypothetical!=='boolean'))throw Error('Invalid hypothetical tag.');
    for(const item of [...s.rows,...s.columns])if(item.hypotheticalTables!==undefined&&(!item.hypotheticalTables||typeof item.hypotheticalTables!=='object'||Array.isArray(item.hypotheticalTables)||Object.entries(item.hypotheticalTables).some(([table,value])=>!safeId(table)||typeof value!=='boolean')))throw Error('Invalid table hypo tag.');
    for(const item of [...s.groups,...s.validations])if(!safeId(item.id))throw Error('Invalid layout/source identity.');
    for(const r of s.rows)if(r.height!==undefined&&(!Number.isFinite(r.height)||r.height<=0||r.height>409.5))throw Error('Invalid row height.');
    for(const g of s.groups)if(!['row','column'].includes(g.axis)||!Array.isArray(g.members)||g.members.some(m=>!safeId(m))||g.table!==undefined&&!safeId(g.table)||g.kind!==undefined&&!['summary','range'].includes(g.kind)||g.kind==='summary'&&g.members.length<2)throw Error('Invalid outline group.');
    if(!/^#[0-9a-f]{6}$/i.test(s.color))throw Error('Invalid tab color.');
    for(const c of s.columns)if(typeof c.label!=='string'||(c.width!==undefined&&(!Number.isFinite(c.width)||c.width<40||c.width>1000)))throw Error('Invalid column layout.');
    for(const c of s.columns)if(c.wrap!==undefined&&typeof c.wrap!=='boolean')throw Error('Invalid column wrap default.');
    const rows = new Set(s.rows.map(r => r.id)), columns = new Set(s.columns.map(c => c.id));
    for(const g of s.groups)if(g.kind==='summary'&&(new Set(g.members).size!==g.members.length||g.members.some(id=>!(g.axis==='row'?rows:columns).has(id))))throw Error('A summary group has missing or duplicate members.');
    if(cells)for (const [k,c] of Object.entries(s.cells)) {
      const [r,col] = k.split(':'); if (!rows.has(r) || !columns.has(col) || !c || typeof c !== 'object') throw Error('Invalid cell address.');
      if(c.formula)ast(c.formula);
      if(c.calculation)ast(c.calculation);
      if(c.dateLiteral!==undefined&&typeof c.dateLiteral!=='boolean')throw Error('Invalid literal date text.');
      if(c.dayDateTable!==undefined&&!safeId(c.dayDateTable))throw Error('Invalid inherited day-date table.');
      if(c.fractionInput!==undefined&&typeof c.fractionInput!=='string'||c.fractionLiteral!==undefined&&typeof c.fractionLiteral!=='boolean')throw Error('Invalid fraction input metadata.');
      if(c.format)for(const color of[c.format.color,c.format.background])if(color&&!/^#[0-9a-f]{6}$/i.test(color))throw Error('Invalid cell color.');
      if(c.format?.excelNumberFormat!==undefined&&typeof c.format.excelNumberFormat!=='string')throw Error('Invalid Excel number format.');
      if(c.format?.dateWhen!==undefined&&(!c.format.dateWhen||typeof c.format.dateWhen!=='object'||!safeId(c.format.dateWhen.table)||!safeId(c.format.dateWhen.column)))throw Error('Invalid conditional date format.');
      if(c.value!==undefined&&c.value!==null&&!['string','number','boolean'].includes(typeof c.value)&&!(typeof c.value==='object'&&typeof c.value.error==='string'))throw Error('Invalid cell value.');
      if(typeof c.value==='number'&&!Number.isFinite(c.value))throw Error('Invalid numeric cell value.');
    }
  }
  for (const t of tables) {
    id(t.id);if(typeof t.name!=='string'||!Array.isArray(t.columns)||!Array.isArray(t.rows))throw Error('Invalid table.');
    const s=sheets.find(s=>s.id===t.sheet);if(!s||!s.rows.some(r=>r.id===t.header))throw Error('Missing table header.');
    const rows=new Set(s.rows.map(r=>r.id)),cols=new Set(s.columns.map(c=>c.id));
    if(t.rows.some(r=>!rows.has(r)))throw Error('Missing table record.');
    t.columns.forEach(c=>{id(c.id);if(!cols.has(c.column)||typeof c.name!=='string')throw Error('Missing table column.');if(c.wrap!==undefined&&typeof c.wrap!=='boolean')throw Error('Invalid table column wrap default.');});
  }
  for (const n of b.names) {id(n.id);ast(n.formula);}
  if(b.references!==undefined){
    if(!Array.isArray(b.references)||b.references.length>1000)throw Error('Invalid supporting sources.');
    for(const source of b.references){
      id(source.id);
      if(typeof source.name!=='string'||!['list','units','conversions','derived'].includes(source.kind)||!Array.isArray(source.archivedRows)||source.archivedRows.some(row=>!safeId(row)))throw Error('Invalid supporting source metadata.');
      for(const label of[source.label,source.group])if(label!==undefined&&(typeof label!=='string'||!label.trim()))throw Error('Invalid dropdown display name or group.');
      if(source.workbookOnly!==undefined&&typeof source.workbookOnly!=='boolean')throw Error('Invalid dropdown navigation preference.');
      if(source.catalog&&(!safeId(source.catalog.id)||!safeId(source.catalog.table)||source.catalog.rows!==undefined&&(!Array.isArray(source.catalog.rows)||source.catalog.rows.some(r=>!safeId(r))||new Set(source.catalog.rows).size!==source.catalog.rows.length)))throw Error('Invalid bundled catalog provenance.');
      for(const identity of[source.table,source.column,source.nameId,source.origin?.original,source.derived?.table,source.derived?.column,...Object.values(source.conversion??{}),...Object.values(source.anchor??{})])if(identity!==undefined&&!safeId(identity))throw Error('Invalid supporting source binding.');
      if(source.derived?.filter&&!safeId(source.derived.filter.column))throw Error('Invalid derived filter binding.');
      if(source.deferredNames)for(const n of source.deferredNames){id(n.id);ast(n.formula);}
    }
  }
}
export class Store {
  constructor(private db: IDBDatabase) {}
  static async open(name = 'fnt-workbook-v1'): Promise<Store> {
    const r = indexedDB.open(name,1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('state');
      r.result.createObjectStore('history',{keyPath:'id'});
      r.result.createObjectStore('originals',{keyPath:'id'});
    };
    return new Store(await request(r));
  }
  async load(): Promise<LocalState | undefined> {
    const tx=this.db.transaction('state'),done=complete(tx);
    let result:LocalState|undefined,failure:unknown;
    readState(tx.objectStore('state'),state=>{result=state;},e=>{failure=e;tx.abort();});
    try{await done;}catch(e){throw failure??e;}return result;
  }
  async assertVersion(expected:number):Promise<void>{
    const tx=this.db.transaction('state'),done=complete(tx),store=tx.objectStore('state'),head=store.get(journalHeadKey),current=store.get('current');
    await done;
    if(head.result)validateHead(head.result);
    if((head.result?.state.version??current.result?.version)!==expected)throw Error('Another tab changed this workbook. Sync paused; preserve this tab before reloading.');
  }
  /** Append forward patches and independent undo/redo together; complete replacements use save(). */
  async saveChanges(bookId:string,revision:number,expected:number,label:string,forward:History[],undoHistory:UndoHistory):Promise<{version:number;pending:Pending[];updated:string}>{
    validateForward(forward);
    if(!Number.isSafeInteger(revision)||!Number.isSafeInteger(expected)||expected<0||typeof label!=='string'||!undoHistory||!Array.isArray(undoHistory.undo)||!Array.isArray(undoHistory.redo))throw journalError();
    const changes=clone(forward),history=undoHistory;
    const tx=this.db.transaction('state','readwrite'),done=complete(tx),store=tx.objectStore('state');
    let result:{version:number;pending:Pending[];updated:string}|undefined,failure:unknown;
    const fail=(e:unknown)=>{failure=e;tx.abort();};
    const append=(head:JournalHead)=>{
      try{
        if(head.book!==bookId||head.state.version!==expected)throw Error('Another tab changed this workbook. Your edits are still in memory. Download a backup before reloading.');
        const navigation=store.get(navigationKey(bookId));
        navigation.onsuccess=()=>{
          try{
            const updated=new Date().toISOString(),pending=[...new Map([...head.state.pending,...(navigation.result as Navigation|undefined)?.pending??[]].map(p=>[p.id,p])).values(),{id:uid(),label,time:updated}];
            result={version:expected+1,pending,updated};
            store.put({version:result.version,book:bookId,revision,forward:changes} satisfies JournalEntry,journalKey(result.version));
            store.put({...head,state:{...head.state,...result},revision,count:head.count+1} satisfies JournalHead,journalHeadKey);
            store.put({version:result.version,book:bookId,history},'undo');
          }catch(e){fail(e);}
        };
      }catch(e){fail(e);}
    };
    const r=store.get(journalHeadKey);
    r.onsuccess=()=>{
      try{
        if(r.result){validateHead(r.result);append(r.result);}
        else readState(store,state=>{
          try{
            if(!state||state.book.id!==bookId||state.version!==expected)throw Error('Another tab changed this workbook. Your edits are still in memory. Download a backup before reloading.');
            let book=state.book;
            for(const change of changes)book=applyUndo(book,change).book;
            book.revision=revision;validateBook(book);
            const {book:base,...metadata}=state;
            append({state:metadata,book:base.id,revision:base.revision,baseVersion:expected,count:0});
          }catch(e){fail(e);}
        },fail);
      }catch(e){fail(e);}
    };
    try{await done;}catch(e){throw failure??e;}return result!;
  }
  /** Materialize a bounded batch without creating another logical edit or discarding its pending IDs. */
  async compact(expected:number,checkpointLabel?:string):Promise<LocalState|undefined>{
    const tx=this.db.transaction(checkpointLabel?['state','history']:['state'],'readwrite'),done=complete(tx),store=tx.objectStore('state');
    let failure:unknown,result:LocalState|undefined;
    readState(store,(state,head)=>{
      try{
        if((state?.version??0)!==expected)throw Error('Workbook changed during this operation. Retry after saving.');
        if(state){
          result=state;
          if(head?.count||checkpointLabel)store.put(state,'current');
          resetJournal(store,state);
          if(checkpointLabel)tx.objectStore('history').put({id:uid(),label:checkpointLabel,time:new Date().toISOString(),book:state.book} satisfies Checkpoint);
        }
      }catch(e){failure=e;tx.abort();}
    },e=>{failure=e;tx.abort();});
    try{await done;}catch(e){throw failure??e;}return result;
  }
  async visit(book:string,table:string,previous:number):Promise<number>{
    const tx=this.db.transaction('state','readwrite'),done=complete(tx),store=tx.objectStore('state');
    let visits=previous,failure:unknown;
    const r=store.get(navigationKey(book));
    r.onsuccess=()=>{
      try{
      const navigation:Navigation=r.result??{visits:{},pending:[]};
      visits=Math.min(Number.MAX_SAFE_INTEGER,Math.max(previous,navigation.visits[table]??0)+1);
      navigation.visits[table]=visits;
      if(!navigation.pending.length)navigation.pending.push({id:uid(),label:'Visit table',time:new Date().toISOString()});
      store.put(navigation,navigationKey(book));
      }catch(e){failure=e;tx.abort();}
    };
    try{await done;}catch(e){throw failure??e;}return visits;
  }
  async originalCount():Promise<number>{
    return request(this.db.transaction('originals').objectStore('originals').count());
  }
  async originals():Promise<Original[]>{
    return await request(this.db.transaction('originals').objectStore('originals').getAll()) as Original[];
  }
  async syncToken(config:SyncConfig):Promise<string|undefined>{
    const saved=await request(this.db.transaction('state').objectStore('state').get(syncCredentialKey)) as {config?:SyncConfig;token?:unknown}|undefined;
    if(!saved||!saved.config||!(['owner','repo','branch','path'] as const).every(field=>saved.config![field]===config[field]))return;
    if(typeof saved.token!=='string'||!saved.token)throw Error('Remembered sync credential is damaged. Reconnect private sync on this device.');
    return saved.token;
  }
  async rememberSyncToken(config?:SyncConfig,token?:string):Promise<void>{
    const tx=this.db.transaction('state','readwrite'),done=complete(tx),store=tx.objectStore('state');
    if(config&&token)store.put({config:clone(config),token},syncCredentialKey);
    else store.delete(syncCredentialKey);
    await done;
  }
  async comparisonDeviceName():Promise<string|undefined>{
    const value=await request(this.db.transaction('state').objectStore('state').get('device:comparison-name')) as unknown;
    if(value!==undefined&&typeof value!=='string')throw Error('Saved device name is damaged. Enter it again before uploading a comparison copy.');
    return value;
  }
  async rememberComparisonDeviceName(name:string):Promise<void>{
    const tx=this.db.transaction('state','readwrite'),done=complete(tx);
    tx.objectStore('state').put(name,'device:comparison-name');await done;
  }
  async undoHistory(version:number,book:string):Promise<UndoHistory|undefined>{
    const saved=await request(this.db.transaction('state').objectStore('state').get('undo')) as {version:number;book:string;history:UndoHistory}|undefined;
    if(!saved||saved.version!==version||saved.book!==book)return;
    if(!saved.history||!Array.isArray(saved.history.undo)||!Array.isArray(saved.history.redo))throw Error('Saved undo history is damaged. Export a backup before continuing.');
    return saved.history;
  }
  async save(book: Workbook, expected: number, label: string, checkpoint = false, original?: {id:string;name:string;data:string}, options?:{localOnly?:boolean;recoveryArchive?:string;publishedSnapshot?:string;undoHistory?:UndoHistory;comparisonSync?:{config:SyncConfig;sha:string};pauseSync?:boolean}): Promise<LocalState> {
    const snapshot=clone(book);
    const tx = this.db.transaction(['state','history','originals'],'readwrite'), done = complete(tx);
    const store = tx.objectStore('state');
    let result: LocalState | undefined, conflict = false, failure:unknown;
    const navigation=store.get(navigationKey(snapshot.id));
    readState(store,previous=>{
      try{
      if ((previous?.version ?? 0) !== expected) { conflict = true; tx.abort(); return; }
      result = { ...previous, book: snapshot, version: expected+1,
        pending: [...previous?.pending ?? [], {id:uid(),label,time:new Date().toISOString()}], updated:new Date().toISOString() };
      result=withNavigation(result,navigation.result);
      if(previous){
        const priorNavigation=store.get(navigationKey(previous.book.id));
        priorNavigation.onsuccess=()=>{try{if(priorNavigation.result)store.put({...priorNavigation.result,pending:[]},navigationKey(previous.book.id));}catch(e){failure=e;tx.abort();}};
      }
      if(navigation.result)store.put({...navigation.result,pending:[]},navigationKey(snapshot.id));
      if(options?.localOnly){delete result.sync;delete result.remoteSha;store.delete(syncCredentialKey);}
      if(options?.comparisonSync){
        result.sync=clone(options.comparisonSync.config);result.remoteSha=options.comparisonSync.sha;
        result.syncPaused=false;
        result.syncReview=false;
        if(JSON.stringify(previous?.sync)!==JSON.stringify(result.sync))store.delete(syncCredentialKey);
      }
      if(options?.pauseSync){result.syncPaused=true;result.syncReview=false;}
      if(options?.publishedSnapshot)result.publishedSnapshot=options.publishedSnapshot;
      if (checkpoint && previous) tx.objectStore('history').put({id:uid(),label:`Before ${label}`,time:new Date().toISOString(),book:previous.book,...(options?.recoveryArchive?{backup:options.recoveryArchive}:{})} satisfies Checkpoint);
      if (original) tx.objectStore('originals').put(original);
      store.put(result,'current');
      resetJournal(store,result);
      if(options?.undoHistory)store.put({version:result.version,book:result.book.id,history:clone(options.undoHistory)},'undo');else store.delete('undo');
      }catch(e){failure=e;tx.abort();}
    },e=>{failure=e;tx.abort();});
    try { await done; } catch (e) { if (conflict) throw Error('Another tab changed this workbook. Your edits are still in memory. Download a backup before reloading.'); throw failure??e; }
    return result!;
  }
  async syncMetadata(expected:number,change:{sha?:string;acknowledged?:string[];paused?:boolean;review?:boolean}):Promise<Omit<LocalState,'book'>>{
    const tx=this.db.transaction('state','readwrite'),done=complete(tx),store=tx.objectStore('state');
    let result:Omit<LocalState,'book'>|undefined,failure:unknown;
    const update=(state:Omit<LocalState,'book'>,write:(metadata:Omit<LocalState,'book'>)=>void)=>{
      if(state.version!==expected)throw Error('Another tab changed this workbook. Sync acknowledgement was not applied; local edits retained.');
      const acknowledged=new Set(change.acknowledged??[]);
      result={...state,version:expected+1,pending:state.pending.filter(operation=>!acknowledged.has(operation.id)),
        ...(change.sha!==undefined?{remoteSha:change.sha}:{}),...(change.paused!==undefined?{syncPaused:change.paused}:{}),...(change.review!==undefined?{syncReview:change.review}:{})};
      write(result);
      const history=store.get('undo');
      history.onsuccess=()=>{const saved=history.result as {version:number}|undefined;if(saved?.version===expected)store.put({...saved,version:result!.version},'undo');};
    };
    const head=store.get(journalHeadKey);
    head.onsuccess=()=>{
      try{
        if(head.result){
          const saved=head.result as JournalHead;validateHead(saved);
          update(saved.state,state=>{
            store.put({version:state.version,book:saved.book,revision:saved.revision,forward:[{patch:[]}]} satisfies JournalEntry,journalKey(state.version));
            store.put({...saved,state,count:saved.count+1},journalHeadKey);
          });
        }
        else{
          const current=store.get('current');
          current.onsuccess=()=>{try{
            if(!current.result)throw Error('Saved workbook is missing.');
            const {book,...metadata}=current.result as LocalState;update(metadata,state=>store.put({...state,book},'current'));
          }catch(error){failure=error;tx.abort();}};
        }
      }catch(error){failure=error;tx.abort();}
    };
    try{await done;}catch(error){throw failure??error;}return result!;
  }
  async metadata(expected: number, change: (state: LocalState) => LocalState): Promise<LocalState> {
    const tx = this.db.transaction('state','readwrite'), done = complete(tx), store = tx.objectStore('state');
    let result: LocalState, conflict = false,failure:unknown;
    readState(store,previous=>{
      if (!previous||previous.version !== expected) { conflict = true; tx.abort(); return; }
      const navigation=store.get(navigationKey(previous.book.id));
      navigation.onsuccess=()=>{
      try{
      const state=previous;
      result = { ...change(state), version:expected+1 };validateBook(result.book);store.put(result,'current');resetJournal(store,result);
      if(navigation.result)store.put({...navigation.result,pending:[]},navigationKey(previous.book.id));
      const history=store.get('undo');
      history.onsuccess=()=>{
        try{
        const saved=history.result as {version:number;book:string;history:UndoHistory}|undefined;
        if(saved?.version===expected&&(state.book===result.book||JSON.stringify(state.book)===JSON.stringify(result.book)))store.put({...saved,version:result.version},'undo');
        else store.delete('undo');
        }catch(e){failure=e;tx.abort();}
      };
      }catch(e){failure=e;tx.abort();}
      };
    },e=>{failure=e;tx.abort();});
    try { await done; } catch (e) { if (conflict) throw Error('Workbook changed during this operation. Retry after saving.'); throw failure??e; }
    return result!;
  }
  async checkpoint(label: string, book: Workbook, originals:Original[]=[],exact=false): Promise<void> {
    book=clone(book);originals=clone(originals);
    const tx = this.db.transaction(['state','history','originals'],'readwrite'), done = complete(tx),store=tx.objectStore('state');
    let failure:unknown;
    readState(store,(state,head)=>{
      const navigation=store.get(navigationKey(book.id));
      navigation.onsuccess=()=>{
        try{
          const current=!exact&&head?.count&&state?.book.id===book.id&&book.revision<=head.revision?state.book:book;
          const snapshot=exact?current:withNavigation({book:current,pending:[],version:0,updated:''},navigation.result).book;
          tx.objectStore('history').put({ id:uid(), label, time:new Date().toISOString(), book:snapshot } satisfies Checkpoint);
          for(const original of originals)tx.objectStore('originals').put(original);
        }catch(e){failure=e;tx.abort();}
      };
    },e=>{failure=e;tx.abort();});
    try{await done;}catch(e){throw failure??e;}
  }
  async history(): Promise<Checkpoint[]> {
    return (await request(this.db.transaction('history').objectStore('history').getAll()) as Checkpoint[]).sort((a,b) => b.time.localeCompare(a.time));
  }
  async backup(state: LocalState): Promise<Backup> {
    const tx=this.db.transaction(['state','originals']),done=complete(tx),store=tx.objectStore('state'),originals=tx.objectStore('originals').getAll();
    let result:Backup|undefined,failure:unknown;
    readState(store,(current,head)=>{
      const navigation=store.get(navigationKey(state.book.id));
      navigation.onsuccess=()=>{
        try{
          // Historical and unsaved snapshots remain independent of the durable current view.
          const snapshot=head?.count&&current?.book.id===state.book.id&&current.version===state.version&&state.book.revision<=head.revision?current:state;
          result={format:'fnt-backup',version:1,state:clone(withNavigation(snapshot,navigation.result)),originals:originals.result};
        }catch(e){failure=e;tx.abort();}
      };
    },e=>{failure=e;tx.abort();});
    try{await done;}catch(e){throw failure??e;}return result!;
  }
  async restore(backup: Backup, expected: number): Promise<LocalState> {
    validateBackup(backup);
    const tx = this.db.transaction(['state','history','originals'],'readwrite'), done = complete(tx), store = tx.objectStore('state');
    let result: LocalState, conflict = false,failure:unknown;
    const originals=tx.objectStore('originals').getAll();
    readState(store,previous=>{
      try{
      if (!previous||previous.version !== expected) { conflict = true; tx.abort(); return; }
      const recovery=stringifyArchive({format:'fnt-backup',version:1,state:previous,originals:originals.result} satisfies Backup);
      tx.objectStore('history').put({id:uid(),label:'Before backup restore',time:new Date().toISOString(),book:previous.book,backup:recovery} satisfies Checkpoint);
      for (const original of backup.originals) tx.objectStore('originals').put(original);
      result = { ...previous, book:clone(backup.state.book), version:expected+1, updated:new Date().toISOString(),
        pending:[...new Map([...previous.pending,...backup.state.pending].map(p=>[p.id,p])).values(), {id:uid(),label:'Restore backup',time:new Date().toISOString()}] };
      delete result.sync;delete result.remoteSha;
      store.delete(syncCredentialKey);
      store.put(result,'current');
      resetJournal(store,result);
      store.delete(navigationKey(previous.book.id));store.delete(navigationKey(result.book.id));
      store.delete('undo');
      }catch(e){failure=e;tx.abort();}
    },e=>{failure=e;tx.abort();});
    try { await done; } catch (e) { if (conflict) throw Error('Another tab changed the workbook. Restore cancelled.'); throw failure??e; }
    return result!;
  }
  close(): void { this.db.close(); }
}
export function encode64(text: string): string {
  const bytes = new TextEncoder().encode(text); let binary = '';
  for (let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
export const decode64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,'')), c => c.charCodeAt(0)));
export class SyncConflict extends Error {
  constructor(public remote: Workbook, public sha: string,public originals:Original[]=[]) { super('Remote changes found. Both versions are preserved in recovery. No upload was made.'); }
}
export async function syncGitHub(state: LocalState, token: string, fetcher: typeof fetch = fetch, originals:Original[]=[],options?:{readOnly?:boolean;canUpload?:()=>boolean}): Promise<{sha:string;remote?:Workbook;originals?:Original[];readPath?:string}> {
  return privateSync(state,token,fetcher,originals,options?.readOnly===true,options?.canUpload);
}
async function privateSync(state:LocalState,token:string,fetcher:typeof fetch,originals:Original[],readOnly:boolean,canUpload?:()=>boolean):Promise<{sha:string;remote?:Workbook;originals?:Original[];readPath?:string}>{
  return withPrivateGitHub(state.sync,token,fetcher,async({root,headers,request,contentURL,config:cfg})=>{
  const url = `${root}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(cfg.branch)}`;
  let readPath=cfg.path,response=await request(url,{headers,cache:'no-store',redirect:'error'});
  if(readOnly&&response.status===404){
    const renamed=githubFormDefaults(cfg).path;
    if(renamed!==cfg.path){
      readPath=renamed;
      response=await request(contentURL(readPath),{headers,cache:'no-store',redirect:'error'});
    }
  }
  let sha: string | undefined, remote: Workbook | undefined;
  if (response.ok) {
    let data = await response.json() as {sha:string;content:string;encoding?:string;size?:number};
    sha = data.sha;
    if(typeof sha!=='string'||!sha)throw Error('GitHub did not return a file revision. Nothing overwritten.');
    if(!readOnly&&sha===state.remoteSha&&!hasPendingContent(state))return{sha};
    if(readOnly||sha!==state.remoteSha){
      if(data.encoding==='none'||(!data.content&&data.size)){
        const blob=await request(`${root}/git/blobs/${encodeURIComponent(sha)}`,{headers,cache:'no-store',redirect:'error'});
        if(!blob.ok)throw Error(`Cannot read larger remote workbook (${blob.status}). Nothing overwritten.`);
        data=await blob.json() as typeof data;
      }
      if(typeof data.content!=='string')throw Error('GitHub did not return file content. Nothing overwritten.');
      const envelope=await runSyncCodec({kind:'unpack',value:data.content}) as {format:string;book:Workbook;operations:string[];originals?:Original[]};
      if (envelope.format !== 'fnt-sync-v1') throw Error('Remote file is not an Fnt sync file. Nothing overwritten.');
      validateBook(envelope.book); remote = envelope.book;
      const remoteOriginals=envelope.originals??[];
      validateOriginals(remote,remoteOriginals);
      if (readOnly||!hasPendingContent(state)) return {sha,remote,originals:remoteOriginals,...(readOnly?{readPath}:{})};
      const pendingIds = state.pending.map(p => p.id);
      if (Array.isArray(envelope.operations) && pendingIds.every(id => envelope.operations.includes(id)) && stringifyArchive(remote) === stringifyArchive(state.book)) return {sha};
      throw new SyncConflict(remote,sha,remoteOriginals);
    }
  } else if (response.status !== 404) throw Error(`Cannot read sync file (${response.status}). Local edits retained.`);
  else if (!readOnly&&state.remoteSha) throw Error('Remote file was removed. Local edits retained; refusing to recreate it silently.');
  if(readOnly)throw Error(`No saved GitHub workbook exists at ${readPath}${readPath!==cfg.path?` (saved destination: ${cfg.path})`:''}. Check the path in Recovery > Private GitHub sync. Comparison did not upload anything.`);
  if (!hasPendingContent(state) && sha) return {sha};
  if(state.syncReview||canUpload&&!canUpload())throw Error('Sync paused for comparison review. No upload was made.');
  validateOriginals(state.book,originals);
  const content=await runSyncCodec({kind:'pack',value:{format:'fnt-sync-v1',book:state.book,operations:state.pending.map(p=>p.id),originals}});
  if(canUpload&&!canUpload())throw Error('Sync paused for comparison review. No upload was made.');
  const upload = await request(url,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify({
    message:`Fnt: save ${state.pending.length} local changes`, branch:cfg.branch, ...(sha ? {sha} : {}),
    content,
  })});
  if (!upload.ok) throw Error(upload.status === 409 || upload.status === 422 ? 'Remote changed during upload. No overwrite; save again to inspect the conflict.' : `Sync failed (${upload.status}). Local edits retained.`);
  const ack = await upload.json() as {content:{sha:string}};
  if (!ack.content?.sha) throw Error('GitHub did not acknowledge a file revision. Sync not confirmed.');
  return {sha:ack.content.sha};
  });
}
import {validatePagination} from './date-pagination';
import {validateDayLogging} from './day-logging';
