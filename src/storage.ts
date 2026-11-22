import { clone, uid, type Workbook } from './model';
import { compressArchive, decompressArchive, stringifyArchive } from './archive';
import {validateHypotheticalStyle} from './hypothetical';

export interface Pending { id: string; label: string; time: string }
export interface SyncConfig { owner: string; repo: string; branch: string; path: string }
export interface LocalState {
  book: Workbook; version: number; pending: Pending[]; updated: string;
  sync?: SyncConfig; remoteSha?: string;
  publishedSnapshot?:string;
}
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
function validateOriginals(book:Workbook,originals:Original[]):void{
  if(!Array.isArray(originals)||originals.some(o=>!o||typeof o.id!=='string'||!o.id||typeof o.name!=='string'||typeof o.data!=='string')||new Set(originals.map(o=>o.id)).size!==originals.length)throw Error('Invalid original-package archive.');
  if(book.importReport&&!originals.some(o=>o.id===book.importReport!.originalId))throw Error('Backup is missing its preserved original workbook. Restore a complete independent backup.');
  if(book.references?.some(source=>source.origin&&!originals.some(o=>o.id===source.origin!.original)))throw Error('Backup is missing a supporting source original workbook. Restore a complete independent backup.');
}
export const request = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve,reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
const complete = (tx: IDBTransaction): Promise<void> => new Promise((resolve,reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error('Storage transaction aborted. The record may exceed browser storage limits.')); tx.onerror = () => reject(tx.error ?? Error('Storage transaction failed. Local edits have not been saved.'));
});
export function validateBook(value: unknown): asserts value is Workbook {
  if (!value || typeof value !== 'object') throw Error('Not a workbook.');
  const b = value as Partial<Workbook>;
  if (b.schema !== 1 || typeof b.id !== 'string' || typeof b.title !== 'string' || !Number.isInteger(b.revision) || !Array.isArray(b.sheets) || !b.sheets.length || !Array.isArray(b.tables) || !Array.isArray(b.names) || !b.pickerSources) throw Error('Invalid or unsupported workbook format.');
  if(b.hypotheticalStyle!==undefined)validateHypotheticalStyle(b.hypotheticalStyle);
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
  const id = (v: unknown) => { if (!safeId(v) || ids.has(v as string)) throw Error('Missing, invalid or duplicate identity in workbook.'); ids.add(v as string); };
  for (const s of b.sheets) {
    id(s.id);
    if (typeof s.name !== 'string' || !Array.isArray(s.rows) || !s.rows.length || s.rows.length>100000 || !Array.isArray(s.columns) || !s.columns.length || s.columns.length>512 || !s.cells || !Array.isArray(s.groups) || !Array.isArray(s.validations)) throw Error('Invalid or oversized sheet.');
    if(s.outlineView!==undefined&&(!s.outlineView||typeof s.outlineView!=='object'||Array.isArray(s.outlineView)||Object.entries(s.outlineView).some(([k,v])=>!['tree','plainGroupHints'].includes(k)||typeof v!=='boolean')))throw Error('Invalid sheet outline preferences.');
    s.rows.forEach(r => id(r.id)); s.columns.forEach(c => id(c.id));
    if([...s.rows,...s.columns].some(item=>item.hypothetical!==undefined&&typeof item.hypothetical!=='boolean'))throw Error('Invalid hypothetical tag.');
    for(const item of [...s.groups,...s.validations])if(!safeId(item.id))throw Error('Invalid layout/source identity.');
    for(const r of s.rows)if(r.height!==undefined&&(!Number.isFinite(r.height)||r.height<=0||r.height>409.5))throw Error('Invalid row height.');
    for(const g of s.groups)if(!['row','column'].includes(g.axis)||!Array.isArray(g.members)||g.members.some(m=>!safeId(m))||g.kind!==undefined&&!['summary','range'].includes(g.kind)||g.kind==='summary'&&g.members.length<2)throw Error('Invalid outline group.');
    if(!/^#[0-9a-f]{6}$/i.test(s.color))throw Error('Invalid tab color.');
    for(const c of s.columns)if(typeof c.label!=='string'||(c.width!==undefined&&(!Number.isFinite(c.width)||c.width<40||c.width>1000)))throw Error('Invalid column layout.');
    const rows = new Set(s.rows.map(r => r.id)), columns = new Set(s.columns.map(c => c.id));
    for(const g of s.groups)if(g.kind==='summary'&&(new Set(g.members).size!==g.members.length||g.members.some(id=>!(g.axis==='row'?rows:columns).has(id))))throw Error('A summary group has missing or duplicate members.');
    for (const [k,c] of Object.entries(s.cells)) {
      const [r,col] = k.split(':'); if (!rows.has(r) || !columns.has(col) || !c || typeof c !== 'object') throw Error('Invalid cell address.');
      if(c.formula)ast(c.formula);
      if(c.calculation)ast(c.calculation);
      if(c.format)for(const color of[c.format.color,c.format.background])if(color&&!/^#[0-9a-f]{6}$/i.test(color))throw Error('Invalid cell color.');
      if(c.format?.excelNumberFormat!==undefined&&typeof c.format.excelNumberFormat!=='string')throw Error('Invalid Excel number format.');
      if(c.value!==undefined&&c.value!==null&&!['string','number','boolean'].includes(typeof c.value)&&!(typeof c.value==='object'&&typeof c.value.error==='string'))throw Error('Invalid cell value.');
      if(typeof c.value==='number'&&!Number.isFinite(c.value))throw Error('Invalid numeric cell value.');
    }
  }
  for (const t of b.tables) {
    id(t.id);if(typeof t.name!=='string'||!Array.isArray(t.columns)||!Array.isArray(t.rows))throw Error('Invalid table.');
    const s=b.sheets.find(s=>s.id===t.sheet);if(!s||!s.rows.some(r=>r.id===t.header))throw Error('Missing table header.');
    const rows=new Set(s.rows.map(r=>r.id)),cols=new Set(s.columns.map(c=>c.id));
    if(t.rows.some(r=>!rows.has(r)))throw Error('Missing table record.');
    t.columns.forEach(c=>{id(c.id);if(!cols.has(c.column)||typeof c.name!=='string')throw Error('Missing table column.');});
  }
  for (const n of b.names) {id(n.id);ast(n.formula);}
  if(b.references!==undefined){
    if(!Array.isArray(b.references)||b.references.length>1000)throw Error('Invalid supporting sources.');
    for(const source of b.references){
      id(source.id);
      if(typeof source.name!=='string'||!['list','units','conversions','derived'].includes(source.kind)||!Array.isArray(source.archivedRows)||source.archivedRows.some(row=>!safeId(row)))throw Error('Invalid supporting source metadata.');
      for(const label of[source.label,source.group])if(label!==undefined&&(typeof label!=='string'||!label.trim()))throw Error('Invalid dropdown display name or group.');
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
    const state = await request(this.db.transaction('state').objectStore('state').get('current')) as LocalState | undefined;
    if (state) validateBook(state.book);
    return state;
  }
  async originalCount():Promise<number>{
    return request(this.db.transaction('originals').objectStore('originals').count());
  }
  async save(book: Workbook, expected: number, label: string, checkpoint = false, original?: {id:string;name:string;data:string}, options?:{localOnly?:boolean;recoveryArchive?:string;publishedSnapshot?:string}): Promise<LocalState> {
    const tx = this.db.transaction(['state','history','originals'],'readwrite'), done = complete(tx);
    const store = tx.objectStore('state');
    let result: LocalState | undefined, conflict = false, failure:unknown;
    const r = store.get('current');
    r.onsuccess = () => {
      try{
      const previous = r.result as LocalState | undefined;
      if ((previous?.version ?? 0) !== expected) { conflict = true; tx.abort(); return; }
      result = { ...previous, book: clone(book), version: expected+1,
        pending: [...previous?.pending ?? [], {id:uid(),label,time:new Date().toISOString()}], updated:new Date().toISOString() };
      if(options?.localOnly){delete result.sync;delete result.remoteSha;}
      if(options?.publishedSnapshot)result.publishedSnapshot=options.publishedSnapshot;
      if (checkpoint && previous) tx.objectStore('history').put({id:uid(),label:`Before ${label}`,time:new Date().toISOString(),book:previous.book,...(options?.recoveryArchive?{backup:options.recoveryArchive}:{})} satisfies Checkpoint);
      if (original) tx.objectStore('originals').put(original);
      store.put(result,'current');
      }catch(e){failure=e;tx.abort();}
    };
    try { await done; } catch (e) { if (conflict) throw Error('Another tab changed this workbook. Your edits are still in memory. Download a backup before reloading.'); throw failure??e; }
    return result!;
  }
  async metadata(expected: number, change: (state: LocalState) => LocalState): Promise<LocalState> {
    const tx = this.db.transaction('state','readwrite'), done = complete(tx), store = tx.objectStore('state');
    let result: LocalState, conflict = false;
    const r = store.get('current');
    r.onsuccess = () => {
      const state = r.result as LocalState;
      if (state.version !== expected) { conflict = true; tx.abort(); return; }
      result = { ...change(state), version:expected+1 }; store.put(result,'current');
    };
    try { await done; } catch (e) { if (conflict) throw Error('Workbook changed during this operation. Retry after saving.'); throw e; }
    return result!;
  }
  async checkpoint(label: string, book: Workbook, originals:Original[]=[]): Promise<void> {
    const tx = this.db.transaction(['history','originals'],'readwrite'), done = complete(tx);
    tx.objectStore('history').put({ id:uid(), label, time:new Date().toISOString(), book:clone(book) } satisfies Checkpoint);
    for(const original of originals)tx.objectStore('originals').put(original);
    await done;
  }
  async history(): Promise<Checkpoint[]> {
    return (await request(this.db.transaction('history').objectStore('history').getAll()) as Checkpoint[]).sort((a,b) => b.time.localeCompare(a.time));
  }
  async backup(state: LocalState): Promise<Backup> {
    return { format:'fnt-backup',version:1,state:clone(state),originals:await request(this.db.transaction('originals').objectStore('originals').getAll()) };
  }
  async restore(backup: Backup, expected: number): Promise<LocalState> {
    validateBackup(backup);
    const tx = this.db.transaction(['state','history','originals'],'readwrite'), done = complete(tx), store = tx.objectStore('state');
    let result: LocalState, conflict = false,failure:unknown;
    const r = store.get('current'),originals=tx.objectStore('originals').getAll();
    originals.onsuccess = () => {
      try{
      const previous = r.result as LocalState;
      if (previous.version !== expected) { conflict = true; tx.abort(); return; }
      const recovery=stringifyArchive({format:'fnt-backup',version:1,state:previous,originals:originals.result} satisfies Backup);
      tx.objectStore('history').put({id:uid(),label:'Before backup restore',time:new Date().toISOString(),book:previous.book,backup:recovery} satisfies Checkpoint);
      for (const original of backup.originals) tx.objectStore('originals').put(original);
      result = { ...previous, book:clone(backup.state.book), version:expected+1, updated:new Date().toISOString(),
        pending:[...new Map([...previous.pending,...backup.state.pending].map(p=>[p.id,p])).values(), {id:uid(),label:'Restore backup',time:new Date().toISOString()}] };
      delete result.sync;delete result.remoteSha;
      store.put(result,'current');
      }catch(e){failure=e;tx.abort();}
    };
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
export async function syncGitHub(state: LocalState, token: string, fetcher: typeof fetch = fetch, originals:Original[]=[]): Promise<{sha:string;remote?:Workbook;originals?:Original[]}> {
  const cfg = state.sync;
  if (!cfg || !token) throw Error('Connect a private repository and enter a token for this browser session.');
  if (!/^[\w.-]+$/.test(cfg.owner) || !/^[\w.-]+$/.test(cfg.repo) || !cfg.branch || !cfg.path || cfg.path.split('/').some(s => s === '..') || !cfg.path.endsWith('.json')) throw Error('Invalid sync destination. Use a JSON file in a private data repository.');
  if(`${cfg.owner}/${cfg.repo}`.toLowerCase()==='wendyyuanlu/fnt')throw Error('The website source repository cannot be used for nutrition data. Choose a separate private data repository with no Pages publishing.');
  const root = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const headers = { Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28' };
  const repo = await fetcher(root,{headers,redirect:'error'});
  if (!repo.ok) throw Error(`Cannot verify private repository (${repo.status}). Nothing uploaded.`);
  const info = await repo.json() as {private:boolean;has_pages?:boolean};
  if (!info.private) throw Error('Sync requires a PRIVATE repository. Nothing uploaded.');
  if(info.has_pages!==false)throw Error('Sync requires a private data repository with GitHub Pages disabled. Nothing uploaded.');
  const url = `${root}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(cfg.branch)}`;
  const response = await fetcher(url,{headers,cache:'no-store',redirect:'error'});
  let sha: string | undefined, remote: Workbook | undefined;
  if (response.ok) {
    let data = await response.json() as {sha:string;content:string;encoding?:string;size?:number};
    sha = data.sha;
    if(data.encoding==='none'||(!data.content&&data.size)){
      const blob=await fetcher(`${root}/git/blobs/${encodeURIComponent(sha)}`,{headers,cache:'no-store',redirect:'error'});
      if(!blob.ok)throw Error(`Cannot read larger remote workbook (${blob.status}). Nothing overwritten.`);
      data=await blob.json() as typeof data;
    }
    if(typeof data.content!=='string')throw Error('GitHub did not return file content. Nothing overwritten.');
    let envelope = JSON.parse(decode64(data.content)) as {format:string;book:Workbook;operations:string[];payload?:string;originals?:Original[]};
    if(envelope.format==='fnt-sync-v2'&&typeof envelope.payload==='string')envelope=decompressArchive(envelope.payload) as typeof envelope;
    if (envelope.format !== 'fnt-sync-v1') throw Error('Remote file is not an Fnt sync file. Nothing overwritten.');
    validateBook(envelope.book); remote = envelope.book;
    const remoteOriginals=envelope.originals??[];
    validateOriginals(remote,remoteOriginals);
    if (sha !== state.remoteSha) {
      if (!state.pending.length) return {sha,remote,originals:remoteOriginals};
      const pendingIds = state.pending.map(p => p.id);
      if (Array.isArray(envelope.operations) && pendingIds.every(id => envelope.operations.includes(id)) && stringifyArchive(remote) === stringifyArchive(state.book)) return {sha};
      throw new SyncConflict(remote,sha,remoteOriginals);
    }
  } else if (response.status !== 404) throw Error(`Cannot read sync file (${response.status}). Local edits retained.`);
  else if (state.remoteSha) throw Error('Remote file was removed. Local edits retained; refusing to recreate it silently.');
  if (!state.pending.length && sha) return {sha};
  validateOriginals(state.book,originals);
  const packed={format:'fnt-sync-v2',payload:compressArchive({format:'fnt-sync-v1',book:state.book,operations:state.pending.map(p=>p.id),originals})};
  const upload = await fetcher(url,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify({
    message:`Fnt: save ${state.pending.length} local changes`, branch:cfg.branch, ...(sha ? {sha} : {}),
    content:encode64(JSON.stringify(packed)),
  })});
  if (!upload.ok) throw Error(upload.status === 409 || upload.status === 422 ? 'Remote changed during upload. No overwrite; save again to inspect the conflict.' : `Sync failed (${upload.status}). Local edits retained.`);
  const ack = await upload.json() as {content:{sha:string}};
  if (!ack.content?.sha) throw Error('GitHub did not acknowledge a file revision. Sync not confirmed.');
  return {sha:ack.content.sha};
}
