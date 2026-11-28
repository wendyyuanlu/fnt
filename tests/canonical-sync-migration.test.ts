import 'fake-indexeddb/auto';
import {describe,expect,it,vi} from 'vitest';
import {blankSheet,clone,key,uid,type Workbook} from '../src/model';
import {readArchive} from '../src/archive';
import {syncCodec} from '../src/sync-codec';
import {captureData} from '../src/food-capture';
import {inspectPhoto} from '../src/food-photos';
import {
  Store,canonicalSyncConfig,readCanonicalWorkbook,createCanonicalWorkbook,CanonicalWorkbookExists,CanonicalMigrationUncertain,syncGitHub,
  encode64,request,type Backup,type CanonicalMigration,type LocalState,type PrivateWorkbookSource,
} from '../src/storage';

const config={owner:'invented',repo:'private',branch:'main',path:'personal-workbook.json'};
const original={id:'invented-original',name:'Invented.xlsx',data:'AA=='};
function fixture(title='Invented local selection'):Workbook{
  const sheet=blankSheet('Invented',3,2);
  sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:1};
  return{schema:1,id:uid(),title,revision:4,sheets:[sheet],tables:[],names:[],pickerSources:{}};
}
interface File{sha:string;book:Workbook;originals:Backup['originals'];operations:string[];receipts:Record<string,string>}
class Endpoint{
  files=new Map<string,File>([[config.path,{sha:'legacy-revision',book:fixture('Invented legacy phone'),originals:[original],operations:[],receipts:{}}]]);
  calls:{method:string;path:string}[]=[];
  canonicalStatus=404;race:409|422|undefined;ack:'normal'|'missing'|'lost'='normal';readback:'normal'|'moved'|'wrong-receipt'='normal';
  moveLegacyAfterPut=false;
  source():PrivateWorkbookSource{const {sha,book,originals}=this.files.get(config.path)!;return{config:clone(config),sha,book:clone(book),originals:clone(originals)};}
  canonical(book=fixture('Invented existing canonical')):void{this.files.set('fnt-data.json',{sha:'existing-canonical',book,originals:[],operations:[],receipts:{}});}
  fetch:typeof fetch=async(input,init)=>{
    const url=new URL(String(input)),part=url.pathname.split('/contents/')[1],path=part?decodeURIComponent(part):'';
    const method=init?.method??'GET';this.calls.push({method,path});
    if(!path)return Response.json({private:true,has_pages:false});
    if(method==='PUT'){
      expect(path).toBe('fnt-data.json');
      const body=JSON.parse(String(init?.body)) as {sha?:string;content:string;branch:string};
      expect(body).not.toHaveProperty('sha');expect(body.branch).toBe(config.branch);
      if(this.race){this.canonical();return Response.json({}, {status:this.race});}
      expect(this.files.has(path)).toBe(false);
      const value=syncCodec({kind:'unpack',value:body.content}) as Omit<File,'sha'>;
      this.files.set(path,{...value,sha:'created-canonical'});
      if(this.moveLegacyAfterPut)this.files.get(config.path)!.sha='new-legacy-after-create';
      if(this.ack==='lost')throw Error('Invented lost acknowledgement');
      return Response.json(this.ack==='missing'?{}:{content:{sha:'created-canonical'}},{status:201});
    }
    let file=this.files.get(path);
    if(!file)return Response.json({}, {status:path==='fnt-data.json'?this.canonicalStatus:404});
    if(path==='fnt-data.json'&&this.calls.some(call=>call.method==='PUT')){
      file=clone(file);
      if(this.readback==='moved')file.sha='newer-unseen-canonical';
      if(this.readback==='wrong-receipt')file.receipts={};
    }
    return Response.json({sha:file.sha,content:encode64(JSON.stringify({format:'fnt-sync-v1',...file}))});
  };
}
const all=(db:IDBDatabase)=>request(db.transaction('state').objectStore('state').getAll());
async function setup(endpoint=new Endpoint()){
  const name=uid(),store=await Store.open(name),db=await request(indexedDB.open(name,2));
  const book=fixture(),history={undo:[{book:clone(book)}],redo:[]};
  let state=await store.save(book,0,'Unsent local edit',false,undefined,{undoHistory:history});
  state=await store.metadata(state.version,current=>({...current,sync:clone(config),remoteSha:'old-legacy-base',syncReview:true}));
  const review={choices:Array.from({length:603},(_,i)=>({key:`invented-${i}`,side:i%2?'left':'right'}))};
  await request(db.transaction('state','readwrite').objectStore('state').put(review,'comparison:view:retained'));
  await store.rememberSyncToken(config,'invented-remembered-token');
  await store.rememberSyncAttempt(config,{id:'old-legacy-attempt',book:clone(book)});
  return{store,db,state,endpoint,review,history,close:()=>{db.close();store.close();}};
}
const guards=(store:Store,state:LocalState)=>({
  assertCurrent:()=>store.assertVersion(state.version),canUpload:()=>true,
  beforeUpload:async(attempt:Parameters<Store['rememberSyncAttempt']>[1])=>{await store.rememberSyncAttempt(canonicalSyncConfig(config),attempt);},
});
const send=(ctx:Awaited<ReturnType<typeof setup>>,prepared:{state:LocalState;migration:CanonicalMigration},options=guards(ctx.store,prepared.state))=>
  createCanonicalWorkbook(prepared.state,prepared.migration,'invented-session-only-token',ctx.endpoint.fetch,[],options);

describe('canonical destination inspection',()=>{
  it('distinguishes a true missing canonical file from a different existing copy without writing or falling back to legacy',async()=>{
    const endpoint=new Endpoint();
    expect(await readCanonicalWorkbook(config,'invented',endpoint.fetch)).toBeUndefined();
    expect(endpoint.calls.filter(call=>call.path).map(call=>call.path)).toEqual(['fnt-data.json']);
    endpoint.canonical();
    const result=await readCanonicalWorkbook(config,'invented',endpoint.fetch);
    expect(result).toMatchObject({config:{...config,path:'fnt-data.json'},sha:'existing-canonical',book:{title:'Invented existing canonical'}});
    expect(endpoint.calls.every(call=>call.method==='GET')).toBe(true);
  });
  it.each([401,403,429,500])('does not interpret HTTP%s as an absent canonical file',async status=>{
    const endpoint=new Endpoint();endpoint.canonicalStatus=status;
    await expect(readCanonicalWorkbook(config,'invented',endpoint.fetch)).rejects.toThrow('absence was not established');
    expect(endpoint.calls.every(call=>call.method==='GET')).toBe(true);
  });
});

describe('preserved and versioned canonical migration preparation',()=>{
  it('atomically preserves distinct local and legacy copies without repointing the saved destination or touching review, credentials, bases or pending edits',async()=>{
    const ctx=await setup();
    try{
      const {state,migration}=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      expect(state.sync).toEqual(config);expect(state.remoteSha).toBe('old-legacy-base');
      expect(state.book).toEqual(ctx.state.book);expect(state.pending.slice(0,-1)).toEqual(ctx.state.pending);
      expect(state).toMatchObject({syncPaused:true,syncReview:true,version:ctx.state.version+1});
      expect(migration).toMatchObject({version:state.version,book:state.book.id,source:{config,sha:'legacy-revision'},target:{...config,path:'fnt-data.json'}});
      expect(await ctx.store.undoHistory(state.version,state.book.id)).toEqual(ctx.history);
      expect(await ctx.store.syncAttempt(config)).toMatchObject({id:'old-legacy-attempt'});
      expect(await ctx.store.syncBase(migration.target)).toBeUndefined();
      expect(await ctx.store.syncToken(config)).toBe('invented-remembered-token');
      expect(await request(ctx.db.transaction('state').objectStore('state').get('comparison:view:retained'))).toEqual(ctx.review);
      const backups=await Promise.all((await ctx.store.history()).map(async entry=>await readArchive(entry.backup!) as Backup));
      expect(backups.map(backup=>backup.state.book.title).sort()).toEqual(['Invented legacy phone','Invented local selection']);
      expect(backups.find(backup=>backup.state.book.title==='Invented legacy phone')!.originals).toEqual([original]);
      expect(JSON.stringify(backups)).not.toContain('invented-remembered-token');
    }finally{ctx.close();}
  });
  it('keeps referenced local photo bytes in recovery and marks remote photo originals missing truthfully',async()=>{
    const ctx=await setup();
    try{
      const photo=await inspectPhoto('invented-photo',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],{type:'image/png'}));
      const book=clone(ctx.state.book);captureData(book).photos.push({id:photo.id,date:20000,name:'Invented.png',digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      const state=await ctx.store.save(book,ctx.state.version,'Unsent photo',false,undefined,{photos:[photo]});
      const source=ctx.endpoint.source();captureData(source.book).photos.push({id:'invented-remote-only',date:20000,name:'Remote.png',digest:'a'.repeat(64),mime:'image/png',bytes:100});
      await ctx.store.prepareCanonicalMigration(source,state.version);
      const snapshots=await Promise.all((await ctx.store.history()).map(async entry=>await readArchive(entry.backup!) as Backup));
      expect(snapshots.find(backup=>backup.state.book.id===book.id)!.photos).toHaveLength(1);
      expect(snapshots.find(backup=>backup.state.book.id===source.book.id)!.missingPhotos).toEqual(['invented-remote-only']);
      expect(await ctx.store.photo(photo.id,photo)).toEqual(photo);
    }finally{ctx.close();}
  });
  it('rolls back both recovery archives, intent and metadata if carrying Undo fails',async()=>{
    const ctx=await setup();
    try{
      const before=await all(ctx.db),put=IDBObjectStore.prototype.put;
      const intercept=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
        if(this.name==='state'&&key==='undo')throw new DOMException('Invented full storage','QuotaExceededError');
        return put.call(this,value,key);
      });
      try{await expect(ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version)).rejects.toMatchObject({name:'QuotaExceededError'});}
      finally{intercept.mockRestore();}
      expect(await ctx.store.load()).toEqual(ctx.state);expect(await all(ctx.db)).toEqual(before);expect(await ctx.store.history()).toEqual([]);
    }finally{ctx.close();}
  });
  it('rejects another-tab edit during backup and never creates an upload intent or partial recovery',async()=>{
    const ctx=await setup(),backup=ctx.store.backupBlob.bind(ctx.store);
    const intercept=vi.spyOn(ctx.store,'backupBlob').mockImplementation(async(...args)=>{
      await ctx.store.save(fixture('Invented concurrent edit'),ctx.state.version,'Newer unsent operation');
      return backup(...args);
    });
    try{
      await expect(ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version)).rejects.toThrow('while recovery');
      expect((await ctx.store.load())!.book.title).toBe('Invented concurrent edit');
      expect(await ctx.store.history()).toEqual([]);expect(ctx.endpoint.calls).toEqual([]);
    }finally{intercept.mockRestore();ctx.close();}
  });
  it('does not prepare a canonical source as though it were a legacy file',async()=>{
    const ctx=await setup();
    try{
      const source=ctx.endpoint.source();source.config.path='fnt-data.json';
      await expect(ctx.store.prepareCanonicalMigration(source,ctx.state.version)).rejects.toThrow('already uses');
      expect(await ctx.store.load()).toEqual(ctx.state);expect(await ctx.store.history()).toEqual([]);
    }finally{ctx.close();}
  });
  it('does not turn a filename migration into a silent repository or branch switch',async()=>{
    const ctx=await setup();
    try{
      for(const change of [{repo:'another-private'},{branch:'another-branch'}]){
        const source=ctx.endpoint.source();Object.assign(source.config,change);
        await expect(ctx.store.prepareCanonicalMigration(source,ctx.state.version)).rejects.toThrow('only changes the filename');
      }
      expect(await ctx.store.load()).toEqual(ctx.state);expect(await ctx.store.history()).toEqual([]);
    }finally{ctx.close();}
  });
  it('leaves every record unchanged when local recovery generation fails',async()=>{
    const ctx=await setup(),intercept=vi.spyOn(ctx.store,'backupBlob').mockRejectedValue(Error('Invented archive failure'));
    try{
      const before=await all(ctx.db);
      await expect(ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version)).rejects.toThrow('archive failure');
      expect(await all(ctx.db)).toEqual(before);expect(await ctx.store.history()).toEqual([]);
    }finally{intercept.mockRestore();ctx.close();}
  });
});

describe('conditional canonical creation and finalization',()=>{
  it('creates only the absent canonical file from the explicitly chosen local copy, revalidates/readbacks, and atomically finishes with real ancestry and preserved review/Undo',async()=>{
    const ctx=await setup();
    try{
      const legacy=clone(ctx.endpoint.files.get(config.path)),prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      const result=await send(ctx,prepared);
      expect((await ctx.store.load())!.sync).toEqual(config);
      expect(ctx.endpoint.files.get(config.path)).toEqual(legacy);
      expect(ctx.endpoint.files.get('fnt-data.json')!.book).toEqual(ctx.state.book);
      expect(ctx.endpoint.calls.filter(call=>call.method==='PUT')).toEqual([{method:'PUT',path:'fnt-data.json'}]);
      const final=await ctx.store.finishCanonicalMigration(prepared.migration,result,prepared.state.version);
      expect(final).toMatchObject({sync:{...config,path:'fnt-data.json'},remoteSha:'created-canonical',syncPaused:true,syncReview:true,pending:[],book:ctx.state.book});
      expect(await ctx.store.syncBase(final.sync!,result.sha)).toEqual(result.confirmed);
      expect(await ctx.store.syncToken(final.sync!)).toBe('invented-remembered-token');
      expect(await ctx.store.undoHistory(final.version,final.book.id)).toEqual(ctx.history);
      expect(await request(ctx.db.transaction('state').objectStore('state').get('comparison:view:retained'))).toEqual(ctx.review);
      expect(await ctx.store.syncAttempt(config)).toMatchObject({id:'old-legacy-attempt'});
      expect(await ctx.store.history()).toHaveLength(2);
    }finally{ctx.close();}
  });
  it('refuses a different existing canonical file, without merging, acknowledgement or any write',async()=>{
    const ctx=await setup();ctx.endpoint.canonical();
    try{
      const before=clone([...ctx.endpoint.files]),prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      await expect(send(ctx,prepared)).rejects.toBeInstanceOf(CanonicalWorkbookExists);
      expect([...ctx.endpoint.files]).toEqual(before);expect(ctx.endpoint.calls.every(call=>call.method==='GET')).toBe(true);
      expect(await ctx.store.load()).toEqual(prepared.state);
    }finally{ctx.close();}
  });
  it.each([409,422] as const)('refuses a canonical create race HTTP%s without overwriting it or retrying',async race=>{
    const ctx=await setup();ctx.endpoint.race=race;
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      await expect(send(ctx,prepared)).rejects.toBeInstanceOf(CanonicalMigrationUncertain);
      expect(ctx.endpoint.files.get('fnt-data.json')!.book.title).toBe('Invented existing canonical');
      expect(ctx.endpoint.calls.filter(call=>call.method==='PUT')).toHaveLength(1);
      expect(await ctx.store.load()).toEqual(prepared.state);
    }finally{ctx.close();}
  });
  it('refuses a moved legacy source at the final pre-PUT check and keeps both actual destinations unchanged',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version),options=guards(ctx.store,prepared.state);
      options.beforeUpload=async()=>{ctx.endpoint.files.get(config.path)!.sha='newer-legacy';};
      await expect(send(ctx,prepared,options)).rejects.toThrow('legacy GitHub copy changed');
      expect(ctx.endpoint.calls.every(call=>call.method==='GET')).toBe(true);expect(ctx.endpoint.files.has('fnt-data.json')).toBe(false);
    }finally{ctx.close();}
  });
  it('does not fall back or recreate anything if the confirmed legacy source was removed',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      ctx.endpoint.files.delete(config.path);
      await expect(send(ctx,prepared)).rejects.toThrow('legacy workbook (404)');
      expect(ctx.endpoint.files.has('fnt-data.json')).toBe(false);
      expect(ctx.endpoint.calls.filter(call=>call.path).map(call=>call.path)).toEqual([config.path]);
      expect(await ctx.store.history()).toHaveLength(2);
    }finally{ctx.close();}
  });
  it.each(['missing','lost'] as const)('retains the old config and pending/review after %s acknowledgement, without retry or claiming no change',async ack=>{
    const ctx=await setup();ctx.endpoint.ack=ack;
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      await expect(send(ctx,prepared)).rejects.toThrow('may already contain');
      expect(ctx.endpoint.files.has('fnt-data.json')).toBe(true);expect(await ctx.store.load()).toEqual(prepared.state);
      expect(ctx.endpoint.calls.filter(call=>call.method==='PUT')).toHaveLength(1);
    }finally{ctx.close();}
  });
  it('reports an overall private-client timeout during PUT as uncertain rather than an unchanged remote',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
      const signals:(()=>void)[]=[],started=Array.from({length:4},()=>new Promise<void>(resolve=>{signals.push(resolve);}));
      let delayed=0;
      const fetcher:typeof fetch=async(input,init)=>{
        if(delayed<3){signals[delayed++]();await new Promise(resolve=>setTimeout(resolve,25000));}
        if(init?.method==='PUT'){
          signals[3]();
          return await new Promise<Response>((_,reject)=>init.signal?.addEventListener('abort',()=>reject(Error('Invented aborted unacknowledged PUT')),{once:true}));
        }
        return ctx.endpoint.fetch(input,init);
      };
      const outcome=createCanonicalWorkbook(prepared.state,prepared.migration,'invented',fetcher,[],guards(ctx.store,prepared.state)).then(()=>undefined,error=>error as unknown);
      for(let i=0;i<3;i++){await started[i];await vi.advanceTimersByTimeAsync(25000);}
      await started[3];await vi.advanceTimersByTimeAsync(15001);
      expect(await outcome).toBeInstanceOf(CanonicalMigrationUncertain);
      expect((await ctx.store.load())!.sync).toEqual(config);
    }finally{vi.useRealTimers();ctx.close();}
  });
  it.each(['moved','wrong-receipt'] as const)('requires review rather than finalizing an unproven %s readback',async readback=>{
    const ctx=await setup();ctx.endpoint.readback=readback;
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      await expect(send(ctx,prepared)).rejects.toBeInstanceOf(CanonicalMigrationUncertain);
      expect(await ctx.store.load()).toEqual(prepared.state);
    }finally{ctx.close();}
  });
  it('does not claim the migration complete if the legacy file changes after creation',async()=>{
    const ctx=await setup();ctx.endpoint.moveLegacyAfterPut=true;
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      await expect(send(ctx,prepared)).rejects.toThrow('may already contain');
      expect(await ctx.store.load()).toEqual(prepared.state);
      expect(ctx.endpoint.files.get(config.path)!.sha).toBe('new-legacy-after-create');
    }finally{ctx.close();}
  });
  it('checks current version again immediately before PUT and preserves an in-flight local edit',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version),options=guards(ctx.store,prepared.state);
      options.beforeUpload=async()=>{await ctx.store.save(fixture('Invented newer local'),prepared.state.version,'Newer unsent local');};
      await expect(send(ctx,prepared,options)).rejects.toThrow('Another tab changed');
      expect(ctx.endpoint.calls.every(call=>call.method==='GET')).toBe(true);
      expect((await ctx.store.load())!.book.title).toBe('Invented newer local');
    }finally{ctx.close();}
  });
  it('never sends PUT after cancellation during the before-upload hook',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version),options=guards(ctx.store,prepared.state);
      let active=true;options.canUpload=()=>active;options.beforeUpload=async()=>{active=false;};
      await expect(send(ctx,prepared,options)).rejects.toThrow('No further request');
      expect(ctx.endpoint.calls.every(call=>call.method==='GET')).toBe(true);
    }finally{ctx.close();}
  });
  it('does not switch config or acknowledge an unsent local edit made after successful creation',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version),result=await send(ctx,prepared);
      const newer=await ctx.store.save(fixture('Invented after remote success'),prepared.state.version,'Newer unsent operation');
      await expect(ctx.store.finishCanonicalMigration(prepared.migration,result,prepared.state.version)).rejects.toThrow('may already contain');
      expect(await ctx.store.load()).toEqual(newer);expect(ctx.endpoint.files.has('fnt-data.json')).toBe(true);
    }finally{ctx.close();}
  });
  it('rolls finalization back completely if Undo storage fails after remote creation',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version),result=await send(ctx,prepared),before=await all(ctx.db),put=IDBObjectStore.prototype.put;
      const intercept=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
        if(this.name==='state'&&key==='undo')throw new DOMException('Invented full storage','QuotaExceededError');
        return put.call(this,value,key);
      });
      try{await expect(ctx.store.finishCanonicalMigration(prepared.migration,result,prepared.state.version)).rejects.toMatchObject({name:'QuotaExceededError'});}
      finally{intercept.mockRestore();}
      expect(await all(ctx.db)).toEqual(before);expect(await ctx.store.load()).toEqual(prepared.state);
      expect(ctx.endpoint.files.has('fnt-data.json')).toBe(true);
    }finally{ctx.close();}
  });
  it('rejects an acknowledgement for a different destination or an unsent operation',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version),result=await send(ctx,prepared);
      for(const changed of [{...result,config:{...result.config,path:'different.json'}},{...result,acknowledged:[...result.acknowledged,'unsent-id']}]){
        await expect(ctx.store.finishCanonicalMigration(prepared.migration,changed,prepared.state.version)).rejects.toThrow('acknowledgement does not match');
      }
      expect(await ctx.store.load()).toEqual(prepared.state);
    }finally{ctx.close();}
  });
  it('materializes navigation without resurrecting acknowledged IDs or dropping visits made during creation',async()=>{
    const ctx=await setup();
    try{
      await ctx.store.visit(ctx.state.book.id,'invented-table',0);
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      const result=await send(ctx,prepared);
      await ctx.store.visit(ctx.state.book.id,'invented-table',1);
      const final=await ctx.store.finishCanonicalMigration(prepared.migration,result,prepared.state.version);
      expect(final.pending).toHaveLength(1);expect(final.pending[0].label).toBe('Visit table');
      expect(prepared.migration.pending).not.toContain(final.pending[0].id);
      expect(final.book.tableActivity!['invented-table'].visits).toBe(2);
      expect((await ctx.store.load())!.pending).toEqual(final.pending);
    }finally{ctx.close();}
  });
  it('supports a local-only selected copy without reusing a credential for another repository',async()=>{
    const ctx=await setup();
    try{
      const state=await ctx.store.metadata(ctx.state.version,current=>({...current,sync:undefined,remoteSha:undefined}));
      const unrelated={...config,repo:'different-private'};
      await ctx.store.rememberSyncToken(unrelated,'invented-other-repository-token');
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),state.version),result=await send(ctx,prepared);
      expect(prepared.state.sync).toBeUndefined();
      const final=await ctx.store.finishCanonicalMigration(prepared.migration,result,prepared.state.version);
      expect(final.sync).toEqual(canonicalSyncConfig(config));
      expect(await ctx.store.syncToken(final.sync!)).toBeUndefined();
      expect(await ctx.store.syncToken(unrelated)).toBe('invented-other-repository-token');
    }finally{ctx.close();}
  });
  it('retains the saved configuration and originals if an attachment identity collides during finalization',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version);
      const result=await createCanonicalWorkbook(prepared.state,prepared.migration,'invented',ctx.endpoint.fetch,[original],guards(ctx.store,prepared.state));
      const different={...original,data:'AQ=='};
      await request(ctx.db.transaction('originals','readwrite').objectStore('originals').put(different));
      await expect(ctx.store.finishCanonicalMigration(prepared.migration,result,prepared.state.version)).rejects.toThrow('different saved contents');
      expect(await ctx.store.load()).toEqual(prepared.state);expect(await ctx.store.originals()).toEqual([different]);
    }finally{ctx.close();}
  });
  it('refuses a stale or superseded saved migration even when an older transfer completed remotely',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version),result=await send(ctx,prepared);
      const second=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),prepared.state.version);
      await expect(ctx.store.finishCanonicalMigration(prepared.migration,result,second.state.version)).rejects.toThrow('may already contain');
      expect(await ctx.store.load()).toEqual(second.state);
    }finally{ctx.close();}
  });
  it('persists the canonical destination and ancestry across reload, and subsequent ordinary reads use only that file',async()=>{
    const ctx=await setup();
    try{
      const prepared=await ctx.store.prepareCanonicalMigration(ctx.endpoint.source(),ctx.state.version),result=await send(ctx,prepared);
      const final=await ctx.store.finishCanonicalMigration(prepared.migration,result,prepared.state.version);
      ctx.store.close();
      const reopened=await Store.open(ctx.db.name);
      try{
        const loaded=(await reopened.load())!;
        expect(loaded).toEqual(final);expect(await reopened.undoHistory(loaded.version,loaded.book.id)).toEqual(ctx.history);
        const offset=ctx.endpoint.calls.length;
        const pulled=await syncGitHub(loaded,'invented',ctx.endpoint.fetch,[],{readOnly:true});
        expect(pulled.readPath).toBe('fnt-data.json');expect(pulled.remote).toEqual(result.confirmed);
        expect(ctx.endpoint.calls.slice(offset).filter(call=>call.path).map(call=>call.path)).toEqual(['fnt-data.json']);
        expect(await reopened.syncBase(loaded.sync!,result.sha)).toEqual(result.confirmed);
      }finally{reopened.close();}
    }finally{ctx.close();}
  });
});
