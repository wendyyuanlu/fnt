import 'fake-indexeddb/auto';
import { describe, expect, it,vi } from 'vitest';
import { createDemo, uid } from '../src/model';
import { encode64, Store, SyncConflict, syncGitHub,validateBook, type LocalState } from '../src/storage';
import { parseArchive,readArchive,stringifyArchive } from '../src/archive';
import {getHypotheticalStyle} from '../src/hypothetical';

describe('recoverable local storage',()=>{
  it('continues the same blocked photo-storage upgrade after a legacy tab closes without replacing saved data',async()=>{
    const name=uid(),book=createDemo(),state:LocalState={book,version:7,pending:[{id:uid(),label:'Unsynced synthetic edit',time:'2026-01-01'}],updated:'2026-01-01'};
    const checkpoint={id:uid(),label:'Retained recovery copy',time:'2025-12-31',book:structuredClone(book)};
    const original={id:uid(),name:'Synthetic original.xlsx',data:'c3ludGhldGlj'};
    const legacyRequest=indexedDB.open(name,1);
    legacyRequest.onupgradeneeded=()=>{
      legacyRequest.result.createObjectStore('state');
      legacyRequest.result.createObjectStore('history',{keyPath:'id'});
      legacyRequest.result.createObjectStore('originals',{keyPath:'id'});
    };
    const legacy=await new Promise<IDBDatabase>((resolve,reject)=>{legacyRequest.onsuccess=()=>resolve(legacyRequest.result);legacyRequest.onerror=()=>reject(legacyRequest.error);});
    let store:Store|undefined;
    try{
      const tx=legacy.transaction(['state','history','originals'],'readwrite');
      tx.objectStore('state').put(state,'current');tx.objectStore('history').put(checkpoint);tx.objectStore('originals').put(original);
      await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
      let blocked:()=>void=()=>{},settled=false;
      const blockedNotice=new Promise<void>(resolve=>{blocked=resolve;});
      const opening=Store.open(name,blocked);
      void opening.then(()=>{settled=true;},()=>{settled=true;});
      await blockedNotice;
      expect(settled).toBe(false);
      legacy.close();
      store=await opening;
      expect(await store.load()).toEqual(state);
      expect(await store.history()).toEqual([checkpoint]);
      expect(await store.originals()).toEqual([original]);
      const reopened=await Store.open(name);
      try{expect(await reopened.load()).toEqual(state);}finally{reopened.close();}
    }finally{legacy.close();store?.close();}
  });
  it('stores comparison reviews separately from workbook data and isolates each tab review',async()=>{
    const name=uid(),store=await Store.open(name),book=createDemo(),right=structuredClone(book);right.title='Invented comparison only';
    const sources={left:{book,kind:'This device',label:'Local'},right:{book:right,kind:'Local JSON',label:'Invented'},baseRevision:book.revision};
    try{
      const state=await store.save(book,0,'Initial');
      await store.saveComparisonReview('one',sources,true);
      await store.saveComparisonReview('two',{...sources,right:undefined},true);
      const view={choices:[{key:'invented-difference',side:'right' as const}],history:[[]],category:'all' as const,specific:'',region:0,context:'1',firstCell:false,linked:true,choiceScope:'filtered',keepScope:'difference',latest:[],uploads:{}};
      await store.saveComparisonReview('one',{...sources,view},false);
      const reopened=await Store.open(name);
      try{expect(await reopened.comparisonReview('one')).toEqual({...sources,view});}finally{reopened.close();}
      expect(await store.load()).toEqual(state);
      await store.clearComparisonReview('one');expect(await store.comparisonReview('one')).toBeUndefined();
      expect(await store.comparisonReview('two')).toEqual({...sources,right:undefined,view:undefined});
    }finally{store.close();}
  });
  it('reopens the exact conflicting remote copy by destination without reading unrelated history, and clears obsolete pointers before a new conflict',async()=>{
    const store=await Store.open(uid()),config={owner:'example',repo:'private',branch:'main',path:'book.json'};
    try{
      let state=await store.save(createDemo(),0,'Initial');
      state=await store.metadata(state.version,state=>({...state,sync:config}));
      const remote=structuredClone(state.book);remote.title='Preserved conflicting revision';
      await store.checkpoint('Remote conflict - not applied',remote,[],true,{config,sha:'conflicting-sha'});
      expect(await store.syncConflict(config)).toEqual({book:remote,sha:'conflicting-sha'});
      expect(await store.syncConflict({...config,path:'other.json'})).toBeUndefined();
      await store.syncMetadata(state.version,{paused:true,review:true,clearConflict:true});
      expect(await store.syncConflict(config)).toBeUndefined();
      expect((await store.history()).some(copy=>copy.book.title===remote.title)).toBe(true);
    }finally{store.close();}
  });
  it('acknowledges only the captured sync operation IDs without materializing or losing newer journal edits and Undo',async()=>{
    const store=await Store.open(uid());
    try{
      let state=await store.save(createDemo(),0,'Initial');
      const captured=state.pending.map(operation=>operation.id);
      const history={undo:[{patch:[{path:['title'],exists:true,value:state.book.title}]}],redo:[]};
      const receipt=await store.saveChanges(state.book.id,1,state.version,'Newer edit',[{patch:[{path:['title'],exists:true,value:'Newer while syncing'}]}],history);
      const metadata=await store.syncMetadata(receipt.version,{sha:'confirmed',acknowledged:captured,paused:true,review:true});
      state=(await store.load())!;
      expect(state.book.title).toBe('Newer while syncing');expect(state.pending.map(operation=>operation.label)).toEqual(['Newer edit']);
      expect(state.remoteSha).toBe('confirmed');expect(state.syncReview).toBe(true);expect(state.syncPaused).toBe(true);
      expect(await store.undoHistory(metadata.version,state.book.id)).toEqual(history);
      await expect(store.syncMetadata(receipt.version,{acknowledged:state.pending.map(operation=>operation.id)})).rejects.toThrow('Another tab');
    }finally{store.close();}
  });
  it('never uploads an unresolved review or a transfer cancelled by opening comparison',async()=>{
    const book=createDemo(),state:LocalState={book,version:1,pending:[{id:'edit',label:'Edit',time:''}],updated:'',sync:{owner:'example',repo:'private',branch:'main',path:'book.json'}};
    let uploads=0;
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{if(init?.method==='PUT')uploads++;return new Response(JSON.stringify(String(_url).includes('/contents/')?{message:'Not found'}:{private:true,has_pages:false}),{status:String(_url).includes('/contents/')?404:200});}) as unknown as typeof fetch;
    await expect(syncGitHub({...state,syncReview:true},'invented',fetcher)).rejects.toThrow('paused');
    await expect(syncGitHub(state,'invented',fetcher,[],{canUpload:()=>false})).rejects.toThrow('paused');
    expect(uploads).toBe(0);
  });
  it('rejects stale automatic sync sources after complete or journaled saves',async()=>{
    const store=await Store.open(uid());
    try{
      const state=await store.save(createDemo(),0,'Initial');
      await store.assertVersion(state.version);
      const change=await store.saveChanges(state.book.id,1,state.version,'Journal edit',[{patch:[{path:['title'],exists:true,value:'Newer local workbook'}]}],{undo:[],redo:[]});
      await expect(store.assertVersion(state.version)).rejects.toThrow('Another tab');
      await store.assertVersion(change.version);
      const updated=await store.metadata(change.version,s=>s);
      await expect(store.assertVersion(change.version)).rejects.toThrow('Another tab');
      await store.assertVersion(updated.version);
    }finally{store.close();}
  });
  it('remembers device credentials only for the exact destination and excludes them from backups and recovery',async()=>{
    const name=uid(),store=await Store.open(name),config={owner:'example',repo:'private',branch:'main',path:'book.json'},token='invented-device-only-credential';
    try{
      let state=await store.save(createDemo(),0,'Initial');
      state=await store.metadata(state.version,s=>({...s,sync:config}));
      await store.rememberSyncToken(config,token);
      const reopened=await Store.open(name);
      try{
        expect(await reopened.syncToken(config)).toBe(token);
        for(const field of ['owner','repo','branch','path'] as const)expect(await reopened.syncToken({...config,[field]:'different'})).toBeUndefined();
      }finally{reopened.close();}
      const backup=await store.backup(state);
      await store.checkpoint('Independent recovery',state.book);
      expect(stringifyArchive(backup).includes(token)).toBe(false);
      expect(stringifyArchive(await store.history()).includes(token)).toBe(false);
      await store.rememberSyncToken();expect(await store.syncToken(config)).toBeUndefined();
      await store.rememberSyncToken(config,token);
      state=await store.restore(backup,state.version);expect(await store.syncToken(config)).toBeUndefined();
      await store.rememberSyncToken(config,token);
      await store.save(createDemo(),state.version,'Local import',false,undefined,{localOnly:true});
      expect(await store.syncToken(config)).toBeUndefined();
    }finally{store.close();}
  });
  it('preserves an exact divergent remote checkpoint instead of substituting a newer local journal',async()=>{
    const store=await Store.open(uid()),book=createDemo();
    try{
      const state=await store.save(book,0,'Initial');
      await store.saveChanges(book.id,1,state.version,'Local edit',[{patch:[{path:['title'],exists:true,value:'Latest local title'}]}],{undo:[],redo:[]});
      await store.checkpoint('Remote conflict',book,[],true);
      expect((await store.history()).find(entry=>entry.label==='Remote conflict')!.book.title).toBe(book.title);
      expect((await store.load())!.book.title).toBe('Latest local title');
    }finally{store.close();}
  });
  it('saves visits independently without content versions, migrates counters, merges tabs and carries them through backup and sync metadata',async()=>{
    const name=uid(),store=await Store.open(name),other=await Store.open(name),book=createDemo(),table=book.tables[0].id;
    book.tableActivity={[table]:{visits:20,editedAt:42}};
    const first=await store.save(book,0,'Content edit',false,undefined,{undoHistory:{undo:[],redo:[]}});
    await Promise.all([store.visit(book.id,table,20),other.visit(book.id,table,20)]);
    const loaded=(await store.load())!;
    expect(loaded.version).toBe(first.version);expect(loaded.book.tableActivity?.[table]).toEqual({visits:22,editedAt:42});
    expect(await store.undoHistory(first.version,book.id)).toEqual({undo:[],redo:[]});
    const backup=await store.backup(first);expect(backup.state.book.tableActivity?.[table].visits).toBe(22);
    const checkpoint=await store.checkpoint('Visits',book);expect(checkpoint).toBeUndefined();
    expect((await store.history())[0].book.tableActivity?.[table].visits).toBe(22);
    const synced=await store.metadata(first.version,s=>({...s,pending:[]}));
    expect(synced.book.tableActivity?.[table].visits).toBe(22);
    expect((await store.load())!.pending).toEqual([]);
    await store.visit(book.id,table,22);
    book.title='Edited while navigating';
    const saved=await store.save(book,synced.version,'Cell edit');
    expect(saved.book.title).toBe(book.title);expect(saved.book.tableActivity?.[table].visits).toBe(23);
    await expect(other.save(book,first.version,'Stale')).rejects.toThrow('Another tab');
    const restored=await store.restore(backup,saved.version);
    expect(restored.book.tableActivity?.[table].visits).toBe(22);
    expect((await store.load())!.book.tableActivity?.[table].visits).toBe(22);
    store.close();other.close();
  });
  it('captures one independent snapshot before asynchronous storage work',async()=>{
    const store=await Store.open(uid()),book=createDemo(),title=book.title;
    const saving=store.save(book,0,'Snapshot');book.title='After save began';
    const saved=await saving;expect(saved.book.title).toBe(title);
    saved.book.title='Changed returned state';expect((await store.load())!.book.title).toBe(title);
    store.close();
  });
  it('retains failed visit writes explicitly and preserves successful visits before workbook replacement',async()=>{
    const store=await Store.open(uid()),book=createDemo(),table=book.tables[0].id,first=await store.save(book,0,'Before navigation');
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Quota exceeded','QuotaExceededError');});
    await expect(store.visit(book.id,table,0)).rejects.toMatchObject({name:'QuotaExceededError'});fail.mockRestore();
    expect((await store.load())!.book.tableActivity).toBeUndefined();
    await store.visit(book.id,table,0);
    const replaced=await store.save(createDemo(),first.version,'Replace workbook',true);
    expect((await store.history())[0].book.tableActivity?.[table].visits).toBe(1);
    expect(replaced.pending.some(p=>p.label==='Visit table')).toBe(true);
    store.close();
  });
  it('saves undo and redo atomically, retains them across metadata saves, and rejects stale or replaced workbook history',async()=>{
    const name=uid(),store=await Store.open(name),book=createDemo(),history={undo:[{book:createDemo()}],redo:[]};
    const state=await store.save(book,0,'Edit',false,undefined,{undoHistory:history});
    const reopened=await Store.open(name);expect(await reopened.undoHistory(state.version,book.id)).toEqual(history);
    const metadata=await reopened.metadata(state.version,state=>({...state,sync:{owner:'example',repo:'private',branch:'main',path:'book.json'}}));
    expect(await reopened.undoHistory(metadata.version,book.id)).toEqual(history);
    expect(await reopened.undoHistory(state.version,book.id)).toBeUndefined();
    await expect(reopened.save(book,state.version,'Stale',false,undefined,{undoHistory:{undo:[],redo:[]}})).rejects.toThrow(/Another tab/);
    expect(await reopened.undoHistory(metadata.version,book.id)).toEqual(history);
    const replacement=await reopened.save(createDemo(),metadata.version,'Replace workbook');
    expect(await reopened.undoHistory(replacement.version,replacement.book.id)).toBeUndefined();
    reopened.close();store.close();
  });
  it('validates toolbar identities and restores their order from native recovery archives',async()=>{
    const store=await Store.open(uid()),book=createDemo();
    for(const toolbarOrder of [null,[''],['action:bold','action:bold'],['action:bold<script>']])expect(()=>validateBook({...book,toolbarOrder})).toThrow('Invalid toolbar order');
    book.toolbarOrder=['action:find','control:status-filter','action:bold','action:future-tool'];
    book.toolbarDividers=['action:find','action:future-tool'];
    expect(()=>validateBook({...book,toolbarDividers:['bad']})).toThrow('Invalid toolbar dividers');
    const saved=await store.save(book,0,'Toolbar order'),backup=parseArchive(stringifyArchive(await store.backup(saved))) as Awaited<ReturnType<Store['backup']>>;
    const changed=await store.save(createDemo(),saved.version,'Other workbook'),restored=await store.restore(backup,changed.version);
    expect(restored.book.toolbarOrder).toEqual(book.toolbarOrder);expect(restored.book.toolbarDividers).toEqual(book.toolbarDividers);expect(restored.book.sheets).toEqual(book.sheets);store.close();
  });
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
    const h=(await store.history())[0],backup=await readArchive(h.backup!) as {state:LocalState};
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
    const archive=await readArchive((await store.history())[0].backup!) as typeof incoming;
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
  it('loads a comparison copy read-only even at the acknowledged SHA, and never creates a missing remote file',async()=>{
    const book=createDemo(),state:LocalState={book,version:1,pending:[{id:'local',label:'Edit',time:''}],updated:'',remoteSha:'same',sync:{owner:'example',repo:'data',branch:'main',path:'book.json'}};
    const before=stringifyArchive(state),methods:string[]=[];
    const fetcher:typeof fetch=async(_url,init)=>{
      methods.push(init?.method??'GET');
      return new Response(JSON.stringify(methods.length===1?{private:true,has_pages:false}:{sha:'same',content:encode64(JSON.stringify({format:'fnt-sync-v1',book,operations:[]}))}));
    };
    expect((await syncGitHub(state,'synthetic',fetcher,[],{readOnly:true})).remote).toEqual(book);
    expect(methods).toEqual(['GET','GET']);expect(stringifyArchive(state)).toBe(before);
    let calls=0;
    await expect(syncGitHub(state,'synthetic',async(_url,init)=>{
      expect(init?.method).not.toBe('PUT');return ++calls===1?new Response(JSON.stringify({private:true,has_pages:false})):new Response('',{status:404});
    },[],{readOnly:true})).rejects.toThrow('No saved GitHub workbook');
    expect(calls).toBe(2);
  });
  it('reads known renamed sync files only after a missing legacy path, without changing the connection or pending edits',async()=>{
    for(const path of ['workbook.json','personal-workbook.json']){
      const book=createDemo(),remote=structuredClone(book);remote.title='Invented renamed remote';
      const state:LocalState={book,version:1,pending:[{id:'local',label:'Edit',time:''}],updated:'',remoteSha:'old-revision',sync:{owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path}};
      const before=stringifyArchive(state),reads:string[]=[];
      const fetcher:typeof fetch=async(input,init)=>{
        expect(init?.method??'GET').toBe('GET');
        const url=new URL(String(input)),file=decodeURIComponent(url.pathname.split('/contents/')[1]??'');
        if(!file)return Response.json({private:true,has_pages:false});
        reads.push(file);
        return file==='fnt-data.json'?Response.json({sha:'renamed-revision',encoding:'base64',content:encode64(JSON.stringify({format:'fnt-sync-v1',book:remote,operations:[]}))}):new Response('',{status:404});
      };
      const result=await syncGitHub(state,'invented',fetcher,[],{readOnly:true});
      expect(result.remote).toEqual(remote);expect(result.readPath).toBe('fnt-data.json');
      expect(reads).toEqual([path,'fnt-data.json']);expect(stringifyArchive(state)).toBe(before);
      reads.length=0;
      await expect(syncGitHub(state,'invented',fetcher)).rejects.toThrow('refusing to recreate');
      expect(reads).toEqual([path]);expect(stringifyArchive(state)).toBe(before);
    }
  });
  it('does not redirect existing legacy files or permission failures when comparing',async()=>{
    const state:LocalState={book:createDemo(),version:1,pending:[],updated:'',remoteSha:'old',sync:{owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:'personal-workbook.json'}};
    for(const status of [200,403]){
      const paths:string[]=[];
      const fetcher:typeof fetch=async(input,init)=>{
        expect(init?.method??'GET').toBe('GET');
        const file=new URL(String(input)).pathname.split('/contents/')[1];
        if(!file)return Response.json({private:true,has_pages:false});
        paths.push(file);
        return status===200?Response.json({sha:'old',content:encode64(JSON.stringify({format:'fnt-sync-v1',book:state.book,operations:[]}))}):new Response('',{status});
      };
      if(status===200)expect((await syncGitHub(state,'invented',fetcher,[],{readOnly:true})).readPath).toBe('personal-workbook.json');
      else await expect(syncGitHub(state,'invented',fetcher,[],{readOnly:true})).rejects.toThrow('(403)');
      expect(paths).toEqual(['personal-workbook.json']);
    }
  });
  const setup=():LocalState=>({book:createDemo(),version:1,pending:[{id:'op1',label:'Edit',time:'now'}],updated:'now',sync:{owner:'example',repo:'data',branch:'main',path:'book.json'}});
  const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  it('checks acknowledged revisions without downloading unchanged blobs or writing another commit',async()=>{
    const state=setup();state.remoteSha='base';state.pending=[];
    const paths:string[]=[];
    const result=await syncGitHub(state,'test',async url=>{
      paths.push(String(url));
      return paths.length===1?response({private:true,has_pages:false}):response({sha:'base',encoding:'none',size:90000000});
    },[],{base:structuredClone(state.book)});
    expect(result).toEqual({sha:'base'});expect(paths).toHaveLength(2);
  });
  it('does not let navigation-only journals create remote commits or conflict with newer workbook content',async()=>{
    const state=setup();state.remoteSha='base';state.pending[0].label='Visit table';
    const remote=createDemo();let calls=0;
    const result=await syncGitHub(state,'test',async(_url,init)=>{
      expect(init?.cache).toBe('no-store');expect(init?.method).not.toBe('PUT');calls++;
      return calls===1?response({private:true,has_pages:false}):response({sha:'new',content:encode64(JSON.stringify({format:'fnt-sync-v1',book:remote,operations:[]}))});
    });
    expect(result.remote).toEqual(remote);expect(calls).toBe(2);expect(state.pending).toHaveLength(1);
  });
  it('times out stalled requests and keeps pending edits for reconnection',async()=>{
    vi.useFakeTimers();
    try{
      const state=setup();
      const failed=expect(syncGitHub(state,'test',async()=>new Promise<Response>(()=>{}))).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30000);await failed;expect(state.pending).toHaveLength(1);
    }finally{vi.useRealTimers();}
  });
  it('also bounds a stalled response body after headers have arrived',async()=>{
    vi.useFakeTimers();
    try{
      const state=setup(),body=new ReadableStream<Uint8Array>();
      const failed=expect(syncGitHub(state,'test',async()=>new Response(body))).rejects.toThrow('transferring data');
      await vi.advanceTimersByTimeAsync(90000);await failed;expect(state.pending).toHaveLength(1);
    }finally{vi.useRealTimers();}
  });
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
    const state=setup(),remote=structuredClone(state.book);state.book.title='Local edit after acknowledged remote';state.remoteSha='base';let calls=0,uploaded:Record<string,unknown>={};
    const result=await syncGitHub(state,'test',async(_url,init)=>{
      calls++;if(calls===1)return response({private:true,has_pages:false});
      if(calls===2)return response({sha:'base',content:encode64(JSON.stringify({format:'fnt-sync-v1',book:remote,operations:[]}))});
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
