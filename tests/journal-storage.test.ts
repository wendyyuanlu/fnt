import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {clone,createDemo,key,uid,type Workbook} from '../src/model';
import {parseArchive,stringifyArchive} from '../src/archive';
import {request,Store,validateBook,validateBookMetadata,type Backup} from '../src/storage';
import {applyUndo,type History,type UndoHistory} from '../src/undo-history';

const title=(value:string):History=>({patch:[{path:['title'],exists:true,value}]});
const history:UndoHistory={undo:[title('Previous')],redo:[title('Redo')]};
it('migrates an edited published-size legacy profile without replacing manual values, formatting, outlines or persistent history',async()=>{
  const book=(parseArchive(readFileSync(new URL('../public/testing-workbook.json',import.meta.url),'utf8')) as {book:Workbook}).book;
  const meals=book.sheets.find(s=>s.name==='Meals')!,s=book.sheets.find(s=>s.name==='Meal TEST DATA')!,address=key(s.rows[1].id,s.columns[2].id);
  const manual={value:434,format:{number:'percent' as const,color:'#193c34',background:'#ffffff'}};
  s.cells[address]=manual;meals.outlineView={...meals.outlineView,tree:true};book.revision=1129;
  book.tableActivity={[book.tables.find(t=>t.name==='Meals')!.id]:{visits:7}};
  const name=uid(),store=await Store.open(name),previousHistory:UndoHistory={undo:Array.from({length:5},(_,i)=>title(`Synthetic earlier title ${i}`)),redo:[]};
  try{
    await raw(name,state=>{state.put({book,version:19,updated:'2026-11-24T00:52:15.956Z',pending:[{id:'synthetic-edit',label:'Edit workbook',time:''}]},'current');state.put({version:19,book:book.id,history:previousHistory},'undo');});
    const receipt=await store.saveChanges(book.id,1130,19,'Scoped title',[title('Synthetic migrated title')],previousHistory),loaded=(await store.load())!;
    expect(loaded.book.id).toBe(book.id);expect(loaded.book.sheets.find(sheet=>sheet.id===s.id)!.cells[address]).toEqual(manual);
    expect(loaded.book.sheets.find(sheet=>sheet.id===meals.id)!.outlineView?.tree).toBe(true);
    expect(loaded.book.tableActivity).toEqual(book.tableActivity);expect(loaded.pending.some(p=>p.id==='synthetic-edit')).toBe(true);
    expect(await store.undoHistory(receipt.version,book.id)).toEqual(previousHistory);
    await store.compact(receipt.version);expect((await store.load())!.book).toEqual(loaded.book);
  }finally{store.close();}
},30000);
async function fixture(){
  const name=uid(),store=await Store.open(name),book=createDemo();
  const state=await store.save(book,0,'Initial',false,undefined,{undoHistory:{undo:[],redo:[]}});
  return{name,store,book,state};
}
async function raw(name:string,write:(store:IDBObjectStore)=>void){
  const db=await request(indexedDB.open(name,1)),tx=db.transaction('state','readwrite');
  const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  write(tx.objectStore('state'));await done;db.close();
}
function failRequest(store:IDBObjectStore,error:DOMException):IDBRequest<IDBValidKey>{
  const r=store.add({},'failed-write');
  Object.defineProperty(r,'error',{get:()=>error,set:()=>{}});
  return r;
}

describe('transactional workbook change journal',()=>{
  it('shares metadata validation while skipping only sheet cells and their formulas',()=>{
    const book=createDemo(),sheet=book.sheets[0],key=`${sheet.rows[0].id}:${sheet.columns[0].id}`;
    sheet.cells[key]={value:Number.NaN};
    expect(()=>validateBookMetadata(book)).not.toThrow();
    expect(()=>validateBook(book)).toThrow('Invalid numeric cell value.');
    sheet.cells[key]={formula:{kind:'unknown'} as never};
    expect(()=>validateBookMetadata(book)).not.toThrow();
    expect(()=>validateBook(book)).toThrow('Unknown formula AST node.');
    sheet.groups.push({id:uid(),axis:'row',kind:'summary',members:[sheet.rows[0].id,'missing-row'],collapsed:true,label:'Group'});
    expect(()=>validateBookMetadata(book)).toThrow('A summary group has missing or duplicate members.');
    sheet.groups.pop();
    book.names.push({id:uid(),name:'Broken',context:sheet.id,original:'=BROKEN()',formula:{kind:'unknown'} as never});
    expect(()=>validateBookMetadata(book)).toThrow('Unknown formula AST node.');
  });

  it('migrates an existing complete state and reloads cell, structural, group and history changes',async()=>{
    const {name,store,book,state}=await fixture(),sheet=book.sheets[0],key=`${sheet.rows[0].id}:${sheet.columns[0].id}`;
    await raw(name,s=>s.delete('journal:head'));
    const forward:History[]=[
      {cells:[{sheet:sheet.id,key,value:{value:47}}]},
      {patch:[{path:['sheetTabGroups'],exists:true,value:{[sheet.id]:'Meals'}},{path:['sheetTabCollapsed'],exists:true,value:['Meals']}]},
      title('Journal workbook'),
    ];
    const receipt=await store.saveChanges(book.id,book.revision+1,state.version,'Edit',forward,history);
    expect(receipt.version).toBe(state.version+1);expect(receipt.pending.map(p=>p.id)).toContain(state.pending[0].id);
    const reopened=await Store.open(name),loaded=(await reopened.load())!;
    expect(loaded.book.title).toBe('Journal workbook');expect(loaded.book.sheets[0].cells[key].value).toBe(47);
    expect(loaded.book.sheetTabGroups).toEqual({[sheet.id]:'Meals'});expect(loaded.book.sheetTabCollapsed).toEqual(['Meals']);
    expect(loaded.book.revision).toBe(book.revision+1);expect(await reopened.undoHistory(receipt.version,book.id)).toEqual(history);
    store.close();reopened.close();
  });

  it('reads and writes only journal metadata, patches, navigation and independent history after setup',async()=>{
    const {store,book,state}=await fixture();
    const first=await store.saveChanges(book.id,book.revision+1,state.version,'First',[title('First')],history);
    const reads=vi.spyOn(IDBObjectStore.prototype,'get'),all=vi.spyOn(IDBObjectStore.prototype,'getAll'),writes=vi.spyOn(IDBObjectStore.prototype,'put');
    await store.saveChanges(book.id,book.revision+2,first.version,'Second',[title('Second')],history);
    expect(reads.mock.calls.map(([key])=>key)).not.toContain('current');expect(all).not.toHaveBeenCalled();
    expect(writes.mock.calls.map(([,key])=>key)).not.toContain('current');
    expect(writes.mock.calls.every(([value])=>!('book'in value)||typeof value.book==='string')).toBe(true);
    reads.mockRestore();all.mockRestore();writes.mockRestore();store.close();
  });

  it('rejects stale tabs, mismatched workbook identities and unsafe full replacements',async()=>{
    const {name,store,book,state}=await fixture(),other=await Store.open(name);
    const saved=await store.saveChanges(book.id,book.revision+1,state.version,'Edit',[title('Durable')],history);
    await expect(other.saveChanges(book.id,book.revision+2,state.version,'Stale',[title('Lost')],{undo:[],redo:[]})).rejects.toThrow(/Another tab/);
    await expect(other.saveChanges('different',book.revision+2,saved.version,'Wrong',[title('Lost')],history)).rejects.toThrow(/Another tab/);
    await expect(store.saveChanges(book.id,book.revision+2,saved.version,'Replace',[{book:clone(book)}],history)).rejects.toThrow(/complete save/);
    await expect(store.compact(state.version)).rejects.toThrow(/changed/);
    expect((await store.load())!.book.title).toBe('Durable');expect(await store.undoHistory(saved.version,book.id)).toEqual(history);
    store.close();other.close();
  });

  it('rolls back patch, logical head and undo/redo together when quota is exhausted',async()=>{
    const {store,book,state}=await fixture(),first=await store.saveChanges(book.id,book.revision+1,state.version,'First',[title('Durable')],history);
    const original=IDBObjectStore.prototype.put;
    const failure=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(key==='undo')throw new DOMException('Quota exceeded','QuotaExceededError');
      return original.call(this,value,key!);
    });
    await expect(store.saveChanges(book.id,book.revision+2,first.version,'Failed',[title('Not durable')],{undo:[],redo:[]})).rejects.toMatchObject({name:'QuotaExceededError'});
    failure.mockRestore();
    const loaded=(await store.load())!;
    expect(loaded.version).toBe(first.version);expect(loaded.pending).toEqual(first.pending);expect(loaded.book.title).toBe('Durable');
    expect(await store.undoHistory(first.version,book.id)).toEqual(history);store.close();
  });

  it('retains original asynchronous request errors and rolls back the whole logical save',async()=>{
    const {name,store,book,state}=await fixture();
    await raw(name,s=>s.put({},'failed-write'));
    const original=IDBObjectStore.prototype.put,error=new DOMException('Original storage failure detail','UnknownError');
    const failure=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      return key==='undo'?failRequest(this,error):original.call(this,value,key!);
    });
    await expect(store.saveChanges(book.id,book.revision+1,state.version,'Failed',[title('Not durable')],history)).rejects.toBe(error);
    failure.mockRestore();
    expect(await store.load()).toEqual(state);expect(await store.undoHistory(state.version,book.id)).toEqual({undo:[],redo:[]});store.close();
  });

  it('compacts at the same logical version, preserves pending IDs/history, and starts a fresh journal',async()=>{
    const {name,store,book,state}=await fixture();
    let version=state.version;
    for(let i=0;i<33;i++)version=(await store.saveChanges(book.id,book.revision+i+1,version,'Edit',[title(`Edit ${i}`)],history)).version;
    const before=(await store.load())!;await store.compact(version);expect(await store.load()).toEqual(before);
    expect(await store.undoHistory(version,book.id)).toEqual(history);
    const reopened=await Store.open(name);expect(await reopened.load()).toEqual(before);
    const reads=vi.spyOn(IDBObjectStore.prototype,'get'),all=vi.spyOn(IDBObjectStore.prototype,'getAll');
    const next=await reopened.saveChanges(book.id,before.book.revision+1,version,'Next',[title('After compaction')],history);
    expect(reads.mock.calls.map(([key])=>key)).not.toContain('current');expect(all).not.toHaveBeenCalled();reads.mockRestore();all.mockRestore();
    expect(next.pending.slice(0,-1)).toEqual(before.pending);expect((await store.load())!.book.title).toBe('After compaction');
    store.close();reopened.close();
  });

  it('rolls back failed compaction without consuming records',async()=>{
    const {store,book,state}=await fixture();
    const saved=await store.saveChanges(book.id,book.revision+1,state.version,'Edit',[title('Durable')],history);
    const failure=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Quota exceeded','QuotaExceededError');});
    await expect(store.compact(saved.version)).rejects.toMatchObject({name:'QuotaExceededError'});failure.mockRestore();
    expect((await store.load())!.book.title).toBe('Durable');expect(await store.undoHistory(saved.version,book.id)).toEqual(history);
    await store.compact(saved.version);store.close();
  });

  it('serializes rapid commits and compaction without consuming newer same-tab or cross-tab edits',async()=>{
    const {name,store,book,state}=await fixture(),other=await Store.open(name);
    const first=store.saveChanges(book.id,book.revision+1,state.version,'First',[title('First')],history);
    const second=store.saveChanges(book.id,book.revision+2,state.version+1,'Second',[title('Second')],history);
    const staleCompaction=expect(store.compact(state.version+1)).rejects.toThrow(/changed/);
    const [,saved]=await Promise.all([first,second]);await staleCompaction;
    expect((await store.load())!.book.title).toBe('Second');expect(saved.pending).toHaveLength(3);
    const compact=store.compact(saved.version);
    const third=store.saveChanges(book.id,book.revision+3,saved.version,'Third',[title('Third')],{undo:[title('Second')],redo:[]});
    const [,latest]=await Promise.all([compact,third]);
    await expect(other.compact(saved.version)).rejects.toThrow(/changed/);
    await expect(other.saveChanges(book.id,book.revision+4,saved.version,'Stale',[title('Lost')],history)).rejects.toThrow(/Another tab/);
    const loaded=(await other.load())!;
    expect(loaded.book.title).toBe('Third');expect(loaded.version).toBe(latest.version);expect(loaded.pending).toEqual(latest.pending);
    expect(await store.undoHistory(latest.version,book.id)).toEqual({undo:[title('Second')],redo:[]});
    store.close();other.close();
  });

  it('materializes journals before complete saves and pre-replacement checkpoints',async()=>{
    const {store,book,state}=await fixture();
    const saved=await store.saveChanges(book.id,book.revision+1,state.version,'Patch',[title('Before replacement')],history);
    const snapshot=(await store.load())!.book;snapshot.title='Complete save';
    const complete=await store.save(snapshot,saved.version,'Save',true,undefined,{undoHistory:history});
    expect((await store.history())[0].book.title).toBe('Before replacement');
    expect((await store.load())!.book.title).toBe('Complete save');expect(complete.pending).toHaveLength(3);
    await expect(store.save(book,saved.version,'Stale')).rejects.toThrow(/Another tab/);
    await store.compact(complete.version);expect(await store.undoHistory(complete.version,book.id)).toEqual(history);store.close();
  });

  it('captures complete-save content synchronously before later edits to the live workbook',async()=>{
    const {store,book,state}=await fixture(),sheet=book.sheets[0],key=`${sheet.rows[0].id}:${sheet.columns[0].id}`;
    book.title='Captured';book.revision++;sheet.cells[key]={value:47};
    const expected=clone(book),saving=store.save(book,state.version,'Complete save');
    book.title='Later edit';book.revision++;sheet.cells[key].value=99;
    const saved=await saving;
    expect(saved.book).toEqual(expected);expect((await store.load())!.book).toEqual(expected);
    expect(saved.book.revision).toBe(book.revision-1);store.close();
  });

  it('captures checkpoint inputs synchronously while preserving independent archived originals',async()=>{
    const {store,book}=await fixture(),originals=[{id:'captured-original',name:'Captured.xlsx',data:'captured'}];
    book.title='Captured checkpoint';
    const checkpoint=store.checkpoint('Snapshot',book,originals);
    book.title='Later edit';originals[0].data='later';originals.push({id:'later-original',name:'Later.xlsx',data:'later'});
    await checkpoint;
    expect((await store.history())[0].book.title).toBe('Captured checkpoint');
    const backup=await store.backup((await store.load())!);
    expect(backup.originals).toEqual([{id:'captured-original',name:'Captured.xlsx',data:'captured'}]);store.close();
  });

  it('creates independent complete checkpoints and backups, then preserves current patches in restore recovery',async()=>{
    const {store,book,state}=await fixture();
    const saved=await store.saveChanges(book.id,book.revision+1,state.version,'Patch',[title('Backed up')],history);
    const logical={...state,...saved,book:applyUndo(book,title('Backed up')).book};logical.book.revision=book.revision+1;
    const backup=parseArchive(stringifyArchive(await store.backup(logical))) as Backup;
    await store.checkpoint('Patched checkpoint',book);expect((await store.history())[0].book.title).toBe('Backed up');
    const next=await store.saveChanges(book.id,book.revision+2,saved.version,'Next',[title('After backup')],history);
    expect(backup.state.book.title).toBe('Backed up');expect((await store.backup(state)).state.book.title).toBe(book.title);
    const restored=await store.restore(backup,next.version);
    expect(restored.book.title).toBe('Backed up');expect(restored.pending.map(p=>p.id)).toEqual(expect.arrayContaining(next.pending.map(p=>p.id)));
    const recovery=(await store.history()).find(h=>h.label==='Before backup restore')!;
    expect(recovery.book.title).toBe('After backup');expect((parseArchive(recovery.backup!) as Backup).state.pending).toEqual(next.pending);
    expect(await store.undoHistory(restored.version,book.id)).toBeUndefined();expect(await store.load()).toEqual(restored);store.close();
  });

  it('merges concurrent visit counters and clears acknowledged sync pending IDs without losing patches or history',async()=>{
    const {name,store,book,state}=await fixture(),other=await Store.open(name),table=book.tables[0].id;
    await store.visit(book.id,table,20);
    const first=await store.saveChanges(book.id,book.revision+1,state.version,'Edit',[title('Patched')],history);
    await other.visit(book.id,table,21);
    const loaded=(await store.load())!;expect(loaded.book.tableActivity?.[table].visits).toBe(22);
    expect((await store.backup(loaded)).state.book.tableActivity?.[table].visits).toBe(22);
    const synced=await store.metadata(first.version,s=>({...s,pending:[],remoteSha:'acknowledged',sync:{owner:'example',repo:'private',branch:'main',path:'book.json'}}));
    expect(synced.pending).toEqual([]);expect(synced.book.title).toBe('Patched');expect(synced.book.tableActivity?.[table].visits).toBe(22);
    expect((await other.load())!.pending).toEqual([]);expect(await store.undoHistory(synced.version,book.id)).toEqual(history);
    const next=await store.saveChanges(book.id,book.revision+2,synced.version,'Next',[title('Next')],history);
    expect(next.pending).toHaveLength(1);expect((await store.load())!.remoteSha).toBe('acknowledged');store.close();other.close();
  });

  it('does not consume the journal when a metadata callback fails',async()=>{
    const {store,book,state}=await fixture();
    const saved=await store.saveChanges(book.id,book.revision+1,state.version,'Edit',[title('Patched')],history);
    await expect(store.metadata(saved.version,()=>{throw Error('Callback failed');})).rejects.toThrow('Callback failed');
    expect((await store.load())!.book.title).toBe('Patched');expect((await store.load())!.version).toBe(saved.version);store.close();
  });

  it.each(['missing','unsafe','invalid'])('reports %s journal corruption without overwriting the base or clearing records',async(kind)=>{
    const {name,store,book,state}=await fixture();
    const saved=await store.saveChanges(book.id,book.revision+1,state.version,'Edit',[title('Patched')],history);
    const key=`journal:entry:${String(saved.version).padStart(16,'0')}`;
    await raw(name,s=>{
      if(kind==='missing')s.delete(key);
      else s.put({version:saved.version,book:book.id,revision:book.revision+1,forward:[kind==='unsafe'?{patch:[{path:['__proto__','polluted'],exists:true,value:true}]}:{patch:[{path:['sheets'],exists:true,value:[]}]}]},key);
    });
    await expect(store.load()).rejects.toThrow();await expect(store.compact(saved.version)).rejects.toThrow();
    await expect(store.save(book,saved.version,'Overwrite')).rejects.toThrow();
    expect(({} as {polluted?:boolean}).polluted).toBeUndefined();store.close();
  });
});
