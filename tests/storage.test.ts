import 'fake-indexeddb/auto';
import { describe, expect, it,vi } from 'vitest';
import { createDemo, uid } from '../src/model';
import { encode64, Store, SyncConflict, syncGitHub, type LocalState } from '../src/storage';
import { parseArchive,stringifyArchive } from '../src/archive';
import {getHypotheticalStyle} from '../src/hypothetical';

describe('recoverable local storage',()=>{
  it('preserves independent treatment settings in saves and native recovery archives without rewriting cells',async()=>{
    const store=await Store.open(uid()),book=createDemo(),cells=structuredClone(book.sheets.map(s=>s.cells));
    book.hypotheticalStyle=getHypotheticalStyle(book);book.hypotheticalStyle.linked=false;
    book.hypotheticalStyle.label='Draft';book.hypotheticalStyle.columns.pattern='dots';book.hypotheticalStyle.columns.patternColor='#446677';
    book.hypotheticalStyle.rows.textOpacity=.65;book.hypotheticalStyle.rows.textColor='#665544';
    book.hypotheticalStyle.rows.badgeBorderStyle='dashed';book.hypotheticalStyle.rows.badgeDashSize=6;book.hypotheticalStyle.rows.badgeDashGap=3;
    const first=await store.save(book,0,'Treatment settings'),backup=parseArchive(stringifyArchive(await store.backup(first))) as Awaited<ReturnType<Store['backup']>>;
    const second=await store.save(createDemo(),first.version,'Another workbook'),restored=await store.restore(backup,second.version);
    expect(restored.book.hypotheticalStyle).toEqual(book.hypotheticalStyle);
    expect(restored.book.sheets.map(s=>s.cells)).toEqual(cells);store.close();
  });
  it('persists sheet-specific hints and tree settings through local save and backup restore',async()=>{
    const store=await Store.open(uid()),book=createDemo();
    book.sheets[0].outlineView={tree:true,plainGroupHints:false};
    book.sheets[1].outlineView={tree:false,plainGroupHints:true};
    const saved=await store.save(book,0,'Outline preferences'),backup=await store.backup(saved);
    expect((await store.load())!.book.sheets[0].outlineView).toEqual(book.sheets[0].outlineView);
    const changed=createDemo(),other=await store.save(changed,saved.version,'Other book');
    const restored=await store.restore(backup,other.version);
    expect(restored.book.sheets.slice(0,2).map(s=>s.outlineView)).toEqual(book.sheets.slice(0,2).map(s=>s.outlineView));
    store.close();
  });
  it('atomically archives the full pre-import state, retains pending edits and disconnects imported private data from sync',async()=>{
    const store=await Store.open(uid()),first=await store.save(createDemo(),0,'Existing edits');
    const configured=await store.metadata(first.version,s=>({...s,sync:{owner:'example',repo:'data',branch:'main',path:'book.json'},remoteSha:'prior'}));
    const recovery=stringifyArchive(await store.backup(configured)),imported=createDemo();imported.title='Local imported data';
    const result=await store.save(imported,configured.version,'Ingredients import',true,{id:'original',name:'invented.xlsx',data:'aW52ZW50ZWQ='},{localOnly:true,recoveryArchive:recovery});
    expect(result.sync).toBeUndefined();expect(result.remoteSha).toBeUndefined();
    expect(result.pending[0].id).toBe(first.pending[0].id);
    const h=(await store.history())[0],backup=parseArchive(h.backup!) as {state:LocalState};
    expect(backup.state.sync).toEqual(configured.sync);expect(backup.state.book.id).toBe(first.book.id);
    expect((await store.backup(result)).originals).toHaveLength(1);
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Quota exceeded','QuotaExceededError');});
    await expect(store.save(createDemo(),result.version,'Another import',true,{id:'failed',name:'failed.xlsx',data:''},{localOnly:true,recoveryArchive:recovery})).rejects.toMatchObject({name:'QuotaExceededError'});
    fail.mockRestore();
    expect((await store.load())?.version).toBe(result.version);
    expect((await store.history())).toHaveLength(1);
    expect((await store.backup(result)).originals.map(o=>o.id)).toEqual(['original']);store.close();
  });
  it('atomically saves workbook and pending IDs, reloads, rejects stale tabs, and preserves pre-restore copy',async()=>{
    const name=uid(),store=await Store.open(name),book=createDemo(),first=await store.save(book,0,'First');
    const reopened=await Store.open(name);expect((await reopened.load())?.pending[0].id).toBe(first.pending[0].id);
    book.title='Edited';const second=await store.save(book,1,'Edit');
    expect(second.pending).toHaveLength(2);expect((await reopened.load())?.book.title).toBe('Edited');
    await expect(reopened.save(createDemo(),1,'Stale tab')).rejects.toThrow('Another tab');
    const backup=await store.backup(first),restored=await store.restore(backup,second.version);
    expect(restored.book.title).not.toBe('Edited');expect((await store.history())[0].book.title).toBe('Edited');
    expect(restored.pending.map(p=>p.id)).toContain(first.pending[0].id);
    store.close();reopened.close();
  });
  it('restores a full archive locally with sync disconnected and an atomic independently recoverable pre-restore journal',async()=>{
    const store=await Store.open(uid()),first=await store.save(createDemo(),0,'Current edit',false,{id:'old',name:'old.xlsx',data:'b2xk'});
    const configured=await store.metadata(first.version,s=>({...s,sync:{owner:'example',repo:'data',branch:'main',path:'book.json'},remoteSha:'old-sha'}));
    const incoming={format:'fnt-backup' as const,version:1 as const,state:{...configured,book:createDemo(),pending:[{id:'incoming',label:'Incoming edit',time:'now'}]},originals:[{id:'new',name:'new.xlsx',data:'bmV3'}]};
    const restored=await store.restore(incoming,configured.version);
    expect(restored.sync).toBeUndefined();expect(restored.remoteSha).toBeUndefined();
    expect(restored.pending.map(p=>p.id)).toEqual(expect.arrayContaining([first.pending[0].id,'incoming']));
    const archive=parseArchive((await store.history())[0].backup!) as typeof incoming;
    expect(archive.state).toEqual(configured);expect(archive.originals.map(o=>o.id)).toEqual(['old']);
    const history=(await store.history()).length;
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Quota exceeded','QuotaExceededError');});
    await expect(store.restore(incoming,restored.version)).rejects.toMatchObject({name:'QuotaExceededError'});fail.mockRestore();
    expect((await store.load())?.version).toBe(restored.version);expect(await store.history()).toHaveLength(history);
    const broken={...incoming,state:{...incoming.state,pending:[incoming.state.pending[0],incoming.state.pending[0]]}};
    await expect(store.restore(broken,restored.version)).rejects.toThrow('journal');
    await expect(store.restore(incoming,configured.version)).rejects.toThrow('Another tab');store.close();
  });
  it('does not lose durable edits after network failure',async()=>{
    const store=await Store.open(uid()),state=await store.save(createDemo(),0,'Offline edit');
    state.sync={owner:'example',repo:'private-data',branch:'main',path:'book.json'};
    await expect(syncGitHub(state,'test',async()=>{throw Error('Offline');})).rejects.toThrow('Offline');
    expect((await store.load())?.pending).toHaveLength(1);store.close();
  });
  it('surfaces quota errors and leaves the last durable workbook and journal untouched',async()=>{
    const store=await Store.open(uid()),book=createDemo(),state=await store.save(book,0,'Before quota');
    book.title='Not durably saved';
    const write=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Quota exceeded','QuotaExceededError');});
    await expect(store.save(book,state.version,'Failed edit')).rejects.toMatchObject({name:'QuotaExceededError'});
    write.mockRestore();
    const recovered=await store.load();expect(recovered?.book.title).toBe(state.book.title);expect(recovered?.pending).toHaveLength(1);store.close();
  });
});
describe('private opt-in sync',()=>{
  const setup=():LocalState=>({book:createDemo(),version:1,pending:[{id:'op1',label:'Edit',time:'now'}],updated:'now',sync:{owner:'example',repo:'data',branch:'main',path:'book.json'}});
  const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  it('refuses public repositories without reading or uploading data',async()=>{
    let calls=0;await expect(syncGitHub(setup(),'test',async()=>{calls++;return response({private:false});})).rejects.toThrow('PRIVATE');expect(calls).toBe(1);
  });
  it('refuses private Pages repositories or unverifiable publishing state before reading data',async()=>{
    for(const body of [{private:true,has_pages:true},{private:true}]){
      let calls=0;await expect(syncGitHub(setup(),'test',async()=>{calls++;return response(body);})).rejects.toThrow('Pages disabled');expect(calls).toBe(1);
    }
  });
  it('refuses nutrition data in the website source repository',async()=>{
    const state=setup();state.sync!.owner='wendyyuanlu';state.sync!.repo='fnt';let calls=0;
    await expect(syncGitHub(state,'test',async()=>{calls++;return response({private:true,has_pages:false});})).rejects.toThrow('source repository');expect(calls).toBe(0);
  });
  it('preserves both versions on remote divergence and never PUTs',async()=>{
    const state=setup(),remote=createDemo();state.remoteSha='base';let calls=0;
    await expect(syncGitHub(state,'test',async()=>++calls===1?response({private:true,has_pages:false}):response({sha:'other',content:encode64(JSON.stringify({format:'fnt-sync-v1',book:remote,operations:[]}))}))).rejects.toBeInstanceOf(SyncConflict);
    expect(calls).toBe(2);expect(state.pending).toHaveLength(1);
  });
  it('uses CAS SHA and acknowledges only a successful upload',async()=>{
    const state=setup();state.remoteSha='base';let calls=0,uploaded:Record<string,unknown>={};
    const result=await syncGitHub(state,'test',async(_url,init)=>{
      calls++;if(calls===1)return response({private:true,has_pages:false});
      if(calls===2)return response({sha:'base',content:encode64(JSON.stringify({format:'fnt-sync-v1',book:state.book,operations:[]}))});
      uploaded=JSON.parse(String(init?.body));return response({content:{sha:'next'}});
    });
    expect(uploaded.sha).toBe('base');expect(result.sha).toBe('next');
  });
  it('recognizes retry after a lost acknowledgment without duplicate commits',async()=>{
    const state=setup();let calls=0;
    const result=await syncGitHub(state,'test',async()=>++calls===1?response({private:true,has_pages:false}):response({sha:'already-written',content:encode64(JSON.stringify({format:'fnt-sync-v1',book:state.book,operations:['op1']}))}));
    expect(result.sha).toBe('already-written');expect(calls).toBe(2);
  });
});
