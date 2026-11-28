import 'fake-indexeddb/auto';
import {describe,expect,it,vi} from 'vitest';
import {blankSheet,clone,key,uid,type Workbook} from '../src/model';
import {Store,encode64,request,syncGitHub,type Backup,type LocalState,type PrivateWorkbookSource} from '../src/storage';
import {readArchive} from '../src/archive';
import {syncCodec} from '../src/sync-codec';
import {captureData} from '../src/food-capture';
import {inspectPhoto} from '../src/food-photos';

const config={owner:'example',repo:'private',branch:'main',path:'replacement.json'};
const original={id:'invented-original',name:'Invented.xlsx',data:'AA=='};
function fixture(title='Invented replacement only'):Workbook{
  const sheet=blankSheet('Invented',4,2);
  sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:1};
  return{schema:1,id:uid(),title,revision:4,sheets:[sheet],tables:[],names:[],pickerSources:{}};
}
const source=(book=fixture('Invented GitHub copy')):PrivateWorkbookSource=>({config:clone(config),sha:'inspected-remote',book,originals:[]});
const raw=(name:string)=>request(indexedDB.open(name,2));
const records=(db:IDBDatabase,store='state')=>request(db.transaction(store).objectStore(store).getAll());
async function recovery(store:Store,label:string):Promise<Backup>{
  const entry=(await store.history()).find(entry=>entry.label===label)!;
  expect(entry.backup).toBeDefined();
  return await readArchive(entry.backup!) as Backup;
}
class Endpoint{
  sha='inspected-remote';book:Workbook;originals:Backup['originals']=[];puts=0;reads=0;
  race:409|422|undefined;getStatus=200;ack:'normal'|'missing'|'lost'='normal';
  constructor(book=fixture('Invented displaced remote')){this.book=clone(book);}
  fetch:typeof fetch=async(input,init)=>{
    if(!String(input).includes('/contents/'))return Response.json({private:true,has_pages:false});
    if(init?.method!=='PUT'){
      this.reads++;
      return Response.json({sha:this.sha,content:encode64(JSON.stringify({format:'fnt-sync-v1',book:this.book,originals:this.originals,operations:[]}))},{status:this.getStatus});
    }
    this.puts++;
    const body=JSON.parse(String(init.body)) as {sha:string;content:string;message:string};
    expect(body.message).toContain('explicitly replace');
    if(this.race){this.sha='newer-unseen-revision';this.book.title='Invented concurrent remote';return Response.json({}, {status:this.race});}
    expect(body.sha).toBe(this.sha);
    const written=syncCodec({kind:'unpack',value:body.content}) as {book:Workbook;originals:Backup['originals']};
    this.book=written.book;this.originals=written.originals;this.sha='confirmed-replacement';
    if(this.ack==='lost')throw Error('Invented lost acknowledgement');
    return Response.json(this.ack==='missing'?{}:{content:{sha:this.sha}});
  };
}
const local=(book=fixture('Invented selected local')):LocalState=>({book,version:1,pending:[],updated:'',sync:clone(config)});

describe('explicit local replacement from a private workbook',()=>{
  it('backs up materialized local edits and retains review keys, credentials, originals and photos while replacing only the active copy',async()=>{
    const name=uid(),store=await Store.open(name),db=await raw(name);
    try{
      let prior=await store.save(fixture('Invented original local'),0,'Unsent local edit');
      const journal=await store.saveChanges(prior.book.id,5,prior.version,'Unsent journal edit',[{patch:[{path:['title'],exists:true,value:'Latest unsent journal title'}]}],{undo:[{book:clone(prior.book)}],redo:[]});
      prior=(await store.load())!;
      expect(prior.version).toBe(journal.version);
      prior=await store.metadata(prior.version,state=>({...state,sync:{...config,path:'previous.json'},syncPaused:true,syncReview:true}));
      await store.rememberSyncToken(prior.sync,'invented-remembered-token');
      await store.checkpoint('Independent original retained',prior.book,[original],true);
      const photo=await inspectPhoto('invented-local-photo',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],{type:'image/png'}));
      await store.putPhoto(photo);
      const review={choices:Array.from({length:603},(_,i)=>({key:`invented-${i}`,side:i%2?'left':'right'})),history:['invented retained review metadata']};
      await request(db.transaction('state','readwrite').objectStore('state').put(review,'comparison:view:retained'));
      const inspected=source(),expected=clone(inspected),beforePhotos=await records(db,'photos');
      await store.rememberSyncAttempt(config,{id:'obsolete-transfer',book:clone(prior.book)});
      const adopted=await store.usePrivateWorkbook(inspected,prior.version);
      expect(adopted).toMatchObject({book:{id:expected.book.id,title:expected.book.title},pending:[],sync:config,remoteSha:expected.sha,syncPaused:true,syncReview:false,version:prior.version+1});
      expect(adopted.book.revision).toBeGreaterThan(prior.book.revision);
      expect(await store.syncBase(config,expected.sha)).toEqual(expected.book);
      expect(await store.syncAttempt(config)).toBeUndefined();
      expect(await request(db.transaction('state').objectStore('state').get('comparison:view:retained'))).toEqual(review);
      expect(await records(db,'photos')).toEqual(beforePhotos);expect(await store.originals()).toEqual([original]);
      expect(await store.syncToken(prior.sync!)).toBe('invented-remembered-token');
      const backup=await recovery(store,'Before using latest GitHub copy');
      expect(backup.state).toMatchObject(prior);expect(backup.state.book.title).toBe('Latest unsent journal title');
      expect(backup.originals).toEqual([original]);
      expect(JSON.stringify(backup)).not.toContain('invented-remembered-token');
      inspected.book.title='Mutated returned caller source';
      expect((await store.load())!.book.title).toBe(expected.book.title);
    }finally{db.close();store.close();}
  });
  it.each(['use','prepare'] as const)('rejects a stale local version before %s without creating a recovery entry',async action=>{
    const store=await Store.open(uid());
    try{
      const saved=await store.save(fixture(),0,'Current');
      await expect(action==='use'?store.usePrivateWorkbook(source(),saved.version-1):store.preparePrivateReplacement(source(),saved.version-1)).rejects.toThrow('local workbook changed');
      expect(await store.load()).toEqual(saved);expect(await store.history()).toEqual([]);
    }finally{store.close();}
  });
  it.each(['use','prepare'] as const)('rejects an edit made during %s backup generation without acknowledging it',async action=>{
    const name=uid(),store=await Store.open(name),other=await Store.open(name);
    try{
      const saved=await store.save(fixture(),0,'Current'),backup=store.backupBlob.bind(store);
      const intercept=vi.spyOn(store,'backupBlob').mockImplementation(async(...args)=>{
        await other.save(fixture('Newer other-tab data'),saved.version,'Newer unsent operation');
        return backup(...args);
      });
      try{
        await expect(action==='use'?store.usePrivateWorkbook(source(),saved.version):store.preparePrivateReplacement(source(),saved.version)).rejects.toThrow('while recovery');
        expect((await store.load())!.book.title).toBe('Newer other-tab data');expect((await store.load())!.pending).toHaveLength(2);
        expect(await store.history()).toEqual([]);
      }finally{intercept.mockRestore();}
    }finally{other.close();store.close();}
  });
  it.each(['use','prepare'] as const)('does not replace anything if %s cannot create its full local backup',async action=>{
    const store=await Store.open(uid());
    try{
      const saved=await store.save(fixture(),0,'Current'),intercept=vi.spyOn(store,'backupBlob').mockRejectedValue(Error('Invented backup failure'));
      try{await expect(action==='use'?store.usePrivateWorkbook(source(),saved.version):store.preparePrivateReplacement(source(),saved.version)).rejects.toThrow('backup failure');}
      finally{intercept.mockRestore();}
      expect(await store.load()).toEqual(saved);expect(await store.history()).toEqual([]);
    }finally{store.close();}
  });
  it.each(['use','prepare','preserve'] as const)('rolls back %s metadata, history and originals together on storage failure',async action=>{
    const name=uid(),store=await Store.open(name),db=await raw(name);
    try{
      const saved=await store.save(fixture(),0,'Current'),before=await records(db),put=IDBObjectStore.prototype.put;
      const intercept=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
        if(this.name==='history')throw new DOMException('Invented full storage','QuotaExceededError');
        return put.call(this,value,key);
      });
      try{
        const inspected={...source(),originals:[original]};
        await expect(action==='use'?store.usePrivateWorkbook(inspected,saved.version):action==='prepare'?store.preparePrivateReplacement(inspected,saved.version):store.preservePrivateWorkbook(inspected,saved.version)).rejects.toMatchObject({name:'QuotaExceededError'});
      }finally{intercept.mockRestore();}
      expect(await records(db)).toEqual(before);expect(await store.load()).toEqual(saved);
      expect(await store.history()).toEqual([]);expect(await store.originals()).toEqual([]);
    }finally{db.close();store.close();}
  });
  it('rejects colliding original identities and keeps the existing bytes and local edits',async()=>{
    const store=await Store.open(uid());
    try{
      const saved=await store.save(fixture(),0,'Current');
      await store.checkpoint('Existing original',saved.book,[original],true);
      const before=await store.history();
      await expect(store.usePrivateWorkbook({...source(),originals:[{...original,data:'AQ=='}]},saved.version)).rejects.toThrow('different saved contents');
      expect(await store.load()).toEqual(saved);expect(await store.originals()).toEqual([original]);expect(await store.history()).toEqual(before);
    }finally{store.close();}
  });
  it('preserves the confirmed source before the first asynchronous storage read',async()=>{
    const store=await Store.open(uid());
    try{
      const saved=await store.save(fixture(),0,'Current'),inspected={...source(),originals:[clone(original)]},expected=clone(inspected);
      const applying=store.usePrivateWorkbook(inspected,saved.version);
      inspected.book.title='Changed during confirmation';inspected.originals[0].data='changed';inspected.config.path='changed.json';
      const adopted=await applying;
      expect(adopted.book.title).toBe(expected.book.title);expect(adopted.sync).toEqual(expected.config);
      expect(await store.originals()).toEqual(expected.originals);expect(await store.syncBase(config,expected.sha)).toEqual(expected.book);
    }finally{store.close();}
  });
  it('archives remote photo references truthfully without pretending their originals were downloaded',async()=>{
    const store=await Store.open(uid());
    try{
      const saved=await store.save(fixture(),0,'Current'),inspected=source();
      captureData(inspected.book).photos.push({id:'invented-remote-photo',date:20000,name:'Invented.png',digest:'a'.repeat(64),mime:'image/png',bytes:100});
      await store.preservePrivateWorkbook(inspected,saved.version);
      const backup=await recovery(store,'GitHub copy before explicit replacement');
      expect(backup.state.book).toEqual(inspected.book);expect(backup.missingPhotos).toEqual(['invented-remote-photo']);
      expect(backup.photos).toBeUndefined();expect(await store.load()).toEqual(saved);
    }finally{store.close();}
  });
  it.each(['use','prepare'] as const)('includes every available referenced local photo in the full backup before %s',async action=>{
    const store=await Store.open(uid());
    try{
      const photo=await inspectPhoto('invented-referenced-local-photo',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],{type:'image/png'}));
      const book=fixture();
      captureData(book).photos.push({id:photo.id,date:20000,name:'Invented local.png',digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      const saved=await store.save(book,0,'Unsent photo',false,undefined,{photos:[photo]});
      if(action==='use')await store.usePrivateWorkbook(source(),saved.version);
      else await store.preparePrivateReplacement(source(),saved.version);
      const backup=await recovery(store,action==='use'?'Before using latest GitHub copy':'Before replacing GitHub with this copy');
      expect(backup.state.book).toEqual(saved.book);expect(backup.photos).toHaveLength(1);
      expect(backup.photos![0]).toMatchObject({id:photo.id,digest:photo.digest,bytes:photo.bytes,mime:photo.mime});
      expect(backup.missingPhotos).toEqual([]);expect(await store.photo(photo.id,photo)).toEqual(photo);
    }finally{store.close();}
  });
  it('rejects a conflicting remote photo identity without altering local bytes or saving partial recovery state',async()=>{
    const store=await Store.open(uid());
    try{
      const photo=await inspectPhoto('invented-conflicting-photo',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],{type:'image/png'}));
      const saved=await store.save(fixture(),0,'Current',false,undefined,{photos:[photo]}),inspected=source();
      captureData(inspected.book).photos.push({id:photo.id,date:20000,name:'Invented remote.png',digest:'b'.repeat(64),mime:photo.mime,bytes:photo.bytes});
      await expect(store.usePrivateWorkbook(inspected,saved.version)).rejects.toThrow('photo identity');
      expect(await store.load()).toEqual(saved);expect(await store.photo(photo.id,photo)).toEqual(photo);
      expect(await store.history()).toEqual([]);
    }finally{store.close();}
  });
});

describe('explicit confirmed-revision GitHub replacement',()=>{
  it('retains usable local Undo across reloads before uploading and after remote acknowledgement',async()=>{
    const name=uid(),endpoint=new Endpoint();
    let store=await Store.open(name);
    try{
      const before=fixture('Invented before local edit'),chosen=clone(before),history={undo:[{book:before}],redo:[]};
      chosen.title='Invented after local edit';
      const saved=await store.save(chosen,0,'Local edit',false,undefined,{undoHistory:history});
      const inspected=source(clone(endpoint.book)),prepared=await store.preparePrivateReplacement(inspected,saved.version);
      store.close();store=await Store.open(name);
      expect(await store.undoHistory(prepared.version,prepared.book.id)).toEqual(history);
      const result=await syncGitHub(prepared,'invented',endpoint.fetch,[],{replaceRemote:{sha:inspected.sha,preserve:async actual=>{await store.preservePrivateWorkbook(actual,prepared.version);}}});
      const final=await store.syncMetadata(prepared.version,{sha:result.sha,acknowledged:result.acknowledged,confirmed:result.confirmed,paused:true,review:false});
      store.close();store=await Store.open(name);
      expect(await store.undoHistory(final.version,prepared.book.id)).toEqual(history);
      expect((await store.load())!.book).toEqual(chosen);
    }finally{store.close();}
  });
  it('rolls back replacement preparation and recovery when local Undo cannot be retained',async()=>{
    const name=uid(),store=await Store.open(name),db=await raw(name);
    try{
      const book=fixture(),saved=await store.save(book,0,'Local edit',false,undefined,{undoHistory:{undo:[{book:clone(book)}],redo:[]}}),before=await records(db),put=IDBObjectStore.prototype.put;
      const intercept=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
        if(this.name==='state'&&key==='undo')throw new DOMException('Invented Undo storage failure','QuotaExceededError');
        return put.call(this,value,key);
      });
      try{await expect(store.preparePrivateReplacement(source(),saved.version)).rejects.toMatchObject({name:'QuotaExceededError'});}
      finally{intercept.mockRestore();}
      expect(await records(db)).toEqual(before);expect(await store.load()).toEqual(saved);expect(await store.history()).toEqual([]);
    }finally{db.close();store.close();}
  });
  it('supports a local-only copy, preserves both displaced versions, uploads exactly the chosen copy and acknowledges only captured pending IDs',async()=>{
    const name=uid(),store=await Store.open(name),db=await raw(name),endpoint=new Endpoint();
    try{
      const prior=await store.save(fixture('Invented local chosen instead of remote'),0,'Unsent local edit');
      const paused=await store.metadata(prior.version,state=>({...state,syncReview:true,syncPaused:true}));
      const retained={choices:[{key:'invented-undecided',side:'left'}]};
      await request(db.transaction('state','readwrite').objectStore('state').put(retained,'comparison:view:preserved'));
      const inspected=source(clone(endpoint.book)),prepared=await store.preparePrivateReplacement(inspected,paused.version);
      expect(prepared.book).toEqual(paused.book);expect(prepared.sync).toEqual(config);expect(prepared.syncReview).toBe(true);
      expect(prepared.pending.slice(0,-1)).toEqual(paused.pending);expect(prepared.pending.at(-1)!.label).toBe('Replace GitHub with this copy');
      expect((await recovery(store,'Before replacing GitHub with this copy')).state).toEqual(paused);
      const result=await syncGitHub(prepared,'invented-session-only-token',endpoint.fetch,[],{replaceRemote:{sha:inspected.sha,preserve:async actual=>{await store.preservePrivateWorkbook(actual,prepared.version);}},beforeUpload:async attempt=>{await store.assertVersion(prepared.version);await store.rememberSyncAttempt(config,attempt);}});
      expect(endpoint.puts).toBe(1);expect(endpoint.book).toEqual(prepared.book);
      expect(result.acknowledged).toEqual(prepared.pending.map(operation=>operation.id));
      expect((await recovery(store,'GitHub copy before explicit replacement')).state.book).toEqual(inspected.book);
      const metadata=await store.syncMetadata(prepared.version,{sha:result.sha,acknowledged:result.acknowledged,confirmed:result.confirmed,paused:true,review:false});
      expect(metadata.pending).toEqual([]);expect(metadata.syncReview).toBe(false);expect(metadata.syncPaused).toBe(true);
      expect(await request(db.transaction('state').objectStore('state').get('comparison:view:preserved'))).toEqual(retained);
    }finally{db.close();store.close();}
  });
  it('replaces deliberately even when the selected local copy has no pending operations',async()=>{
    const endpoint=new Endpoint(),selected=local(),preserve=vi.fn(async()=>{});
    const result=await syncGitHub(selected,'invented',endpoint.fetch,[],{replaceRemote:{sha:endpoint.sha,preserve}});
    expect(endpoint.book).toEqual(selected.book);expect(endpoint.puts).toBe(1);expect(preserve).toHaveBeenCalledOnce();
    expect(result.acknowledged).toEqual([]);
  });
  it('rejects a newer remote before preservation or upload instead of merging it',async()=>{
    const endpoint=new Endpoint(),before=clone(endpoint.book),preserve=vi.fn(async()=>{});
    await expect(syncGitHub(local(),'invented',endpoint.fetch,[],{replaceRemote:{sha:'older-confirmed-revision',preserve}})).rejects.toThrow('since the copy you confirmed');
    expect(endpoint.puts).toBe(0);expect(endpoint.book).toEqual(before);expect(preserve).not.toHaveBeenCalled();
  });
  it.each([409,422] as const)('does not refetch/retry a rejected CAS (%s) against unseen newer data',async status=>{
    const endpoint=new Endpoint(),preserve=vi.fn(async()=>{});endpoint.race=status;
    await expect(syncGitHub(local(),'invented',endpoint.fetch,[],{replaceRemote:{sha:endpoint.sha,preserve}})).rejects.toThrow('newer revision was not overwritten');
    expect(endpoint.puts).toBe(1);expect(endpoint.reads).toBe(1);expect(preserve).toHaveBeenCalledOnce();
    expect(endpoint.book.title).toBe('Invented concurrent remote');
  });
  it('does not recreate a removed remote file',async()=>{
    const endpoint=new Endpoint(),preserve=vi.fn(async()=>{});endpoint.getStatus=404;
    await expect(syncGitHub(local(),'invented',endpoint.fetch,[],{replaceRemote:{sha:endpoint.sha,preserve}})).rejects.toThrow('removed');
    expect(endpoint.puts).toBe(0);expect(preserve).not.toHaveBeenCalled();
  });
  it('does not upload when preserving the displaced remote fails',async()=>{
    const endpoint=new Endpoint(),before=clone(endpoint.book);
    await expect(syncGitHub(local(),'invented',endpoint.fetch,[],{replaceRemote:{sha:endpoint.sha,preserve:async()=>{throw Error('Invented remote backup failure');}}})).rejects.toThrow('remote backup failure');
    expect(endpoint.puts).toBe(0);expect(endpoint.book).toEqual(before);
  });
  it.each(['cancel','before-upload'] as const)('does not PUT after %s invalidates the action',async mode=>{
    const endpoint=new Endpoint(),preserve=vi.fn(async()=>{});
    await expect(syncGitHub(local(),'invented',endpoint.fetch,[],{replaceRemote:{sha:endpoint.sha,preserve},canUpload:()=>mode!=='cancel',beforeUpload:async()=>{throw Error('Invented before-upload cancellation');}})).rejects.toThrow(mode==='cancel'?'No upload':'before-upload cancellation');
    expect(endpoint.puts).toBe(0);
  });
  it.each(['lost','missing'] as const)('never acknowledges an uncertain %s response or silently retries',async ack=>{
    const endpoint=new Endpoint(),selected=local(),before=clone(selected);endpoint.ack=ack;
    await expect(syncGitHub(selected,'invented',endpoint.fetch,[],{replaceRemote:{sha:endpoint.sha,preserve:async()=>{}}})).rejects.toThrow(ack==='lost'?'lost acknowledgement':'not confirmed');
    expect(endpoint.puts).toBe(1);expect(endpoint.book).toEqual(before.book);expect(selected).toEqual(before);
  });
  it.each(['readOnly','planOnly'] as const)('rejects mixing replacement with %s before the first request',async mode=>{
    const endpoint=new Endpoint();
    await expect(syncGitHub(local(),'invented',endpoint.fetch,[],{[mode]:true,replaceRemote:{sha:endpoint.sha,preserve:async()=>{}}})).rejects.toThrow('recovery callback');
    expect(endpoint.reads).toBe(0);expect(endpoint.puts).toBe(0);
  });
  it('pins the confirmed revision before asynchronous workbook capture',async()=>{
    const endpoint=new Endpoint(),replacement={sha:endpoint.sha,preserve:async()=>{}};
    const uploading=syncGitHub(local(),'invented',endpoint.fetch,[],{replaceRemote:replacement});
    replacement.sha='changed-after-confirmation';
    await uploading;expect(endpoint.puts).toBe(1);
  });
  it('does not acknowledge newer local edits written while the confirmed replacement was uploading',async()=>{
    const store=await Store.open(uid()),endpoint=new Endpoint();
    try{
      const initial=await store.save(fixture(),0,'Original local edit'),prepared=await store.preparePrivateReplacement(source(endpoint.book),initial.version);
      const result=await syncGitHub(prepared,'invented',endpoint.fetch,[],{replaceRemote:{sha:endpoint.sha,preserve:async actual=>{await store.preservePrivateWorkbook(actual,prepared.version);}}});
      const newer=await store.save(fixture('Newer unsent local copy'),prepared.version,'Newer edit after request');
      await expect(store.syncMetadata(prepared.version,{sha:result.sha,acknowledged:result.acknowledged,confirmed:result.confirmed,paused:true,review:false})).rejects.toThrow('Another tab');
      expect(await store.load()).toEqual(newer);expect(newer.pending.at(-1)!.label).toBe('Newer edit after request');
    }finally{store.close();}
  });
});
