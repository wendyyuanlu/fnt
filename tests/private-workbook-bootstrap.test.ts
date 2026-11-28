import 'fake-indexeddb/auto';
import {describe,expect,it,vi} from 'vitest';
import {blankSheet,clone,key,uid,type Workbook} from '../src/model';
import {encode64,readPrivateWorkbook,request,Store,SyncConflict,syncGitHub,type Backup,type PrivateWorkbookSource,type SyncConfig} from '../src/storage';
import {syncCodec} from '../src/sync-codec';
import {inspectPhoto} from '../src/food-photos';
import {captureData} from '../src/food-capture';
import type {StoredComparisonReview} from '../src/comparison-host';

const config:SyncConfig={owner:'example',repo:'private',branch:'main',path:'invented.json'},sha='a'.repeat(40);
const original={id:'invented-package',name:'Invented original.xlsx',data:'AA=='};
const photoBytes=()=>Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
function fixture():Workbook{
  const sheet=blankSheet('Invented bootstrap only',4,2);
  sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:1};
  sheet.cells[key(sheet.rows[1].id,sheet.columns[1].id)]={value:10};
  return{schema:1,id:uid(),title:'Explicitly inspected synthetic workbook',revision:4,sheets:[sheet],tables:[],names:[],pickerSources:{}};
}
const envelope=(book:Workbook,originals:Backup['originals']=[])=>({format:'fnt-sync-v1',book,operations:['remote-operation'],originals,receipts:{'invented-device':'remote-transfer'}});
const source=(book=fixture()):PrivateWorkbookSource=>({config:clone(config),sha,book,originals:[]});
async function openRaw(name:string):Promise<IDBDatabase>{
  return request(indexedDB.open(name,2));
}
async function records(db:IDBDatabase,store:string):Promise<unknown[]>{
  return request(db.transaction(store).objectStore(store).getAll());
}
async function put(db:IDBDatabase,key:IDBValidKey,value:unknown):Promise<void>{
  await request(db.transaction('state','readwrite').objectStore('state').put(value,key));
}
function readonlyFetch(content:unknown,options:{repo?:unknown;status?:number;revision?:unknown}={}):{fetcher:typeof fetch;calls:{url:string;init:RequestInit|undefined}[]}{
  const calls:{url:string;init:RequestInit|undefined}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    calls.push({url:String(input),init});
    expect(init?.method??'GET').toBe('GET');
    expect(init?.cache).toBe('no-store');expect(init?.redirect).toBe('error');
    if(!String(input).includes('/contents/'))return Response.json(options.repo??{private:true,has_pages:false});
    return Response.json({sha:options.revision??sha,content},{status:options.status??200});
  };
  return{fetcher,calls};
}

describe('explicit existing private workbook bootstrap',()=>{
  it.each(['legacy','packed'] as const)('inspects a %s private snapshot without saving, uploading or remembering credentials, then opens only on explicit initialization',async format=>{
    const name=uid(),store=await Store.open(name),book=fixture();
    book.references=[{id:'supporting-original',name:'Preserved source',kind:'list',archivedRows:[],origin:{original:original.id}}];
    const remote=envelope(book,[original]),content=format==='legacy'?encode64(JSON.stringify(remote)):syncCodec({kind:'pack',value:remote});
    const transport=readonlyFetch(content);
    try{
      const inspected=await readPrivateWorkbook(config,'invented-session-only-token',transport.fetcher);
      expect(inspected).toEqual({config,sha,book,originals:[original]});
      expect(await store.load()).toBeUndefined();expect(await store.originals()).toEqual([]);
      expect(await store.syncBase(config,sha)).toBeUndefined();expect(await store.syncToken(config)).toBeUndefined();
      expect(transport.calls).toHaveLength(2);
      const opened=await store.initializePrivateWorkbook(inspected);
      expect(opened).toMatchObject({book,version:1,pending:[],sync:config,remoteSha:sha,syncPaused:true});
      expect(opened.syncReview).toBeUndefined();
      expect(await store.syncBase(config,sha)).toEqual(book);expect(await store.originals()).toEqual([original]);
      expect(await store.syncToken(config)).toBeUndefined();expect(transport.calls).toHaveLength(2);
      const reopened=await Store.open(name);
      try{expect(await reopened.load()).toEqual(opened);expect(await reopened.syncBase(config,sha)).toEqual(book);}finally{reopened.close();}
    }finally{store.close();}
  });
  it.each([
    {repo:{private:false,has_pages:false},error:'PRIVATE'},
    {repo:{private:true,has_pages:true},error:'Pages disabled'},
    {repo:{private:true},error:'Pages disabled'},
    {status:404,error:'No saved GitHub workbook'},
    {status:403,error:'Cannot read private workbook (403)'},
    {revision:'',error:'file revision'},
  ])('refuses an unsafe or unavailable source without a write: $error',async options=>{
    const transport=readonlyFetch(encode64(JSON.stringify(envelope(fixture()))),options);
    await expect(readPrivateWorkbook(config,'invented',transport.fetcher)).rejects.toThrow(options.error);
    expect(transport.calls).toHaveLength(options.repo?1:2);
  });
  it.each([
    {format:'not-fnt'},
    {format:'fnt-sync-v1',book:{schema:99}},
    envelope({...fixture(),references:[{id:'needs-original',name:'Required source',kind:'list',archivedRows:[],origin:{original:'missing'}}]}),
    {...envelope(fixture()),originals:[original,original]},
    {...envelope(fixture()),receipts:null},
    {...envelope(fixture()),receipts:{device:''}},
  ])('rejects malformed, incomplete or untrustworthy archives before adoption (%#)',async archive=>{
    const transport=readonlyFetch(encode64(JSON.stringify(archive)));
    await expect(readPrivateWorkbook(config,'invented',transport.fetcher)).rejects.toThrow();
    expect(transport.calls).toHaveLength(2);
  });
  it('pins mutable form inputs before the first request and resolves the known legacy path read-only only after a 404',async()=>{
    const requested={owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:'personal-workbook.json'},expected=clone(requested),book=fixture(),calls:string[]=[];
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const fetcher:typeof fetch=async(input,init)=>{
      expect(init?.method??'GET').toBe('GET');calls.push(String(input));
      if(!String(input).includes('/contents/')){await gate;return Response.json({private:true,has_pages:false});}
      return String(input).includes('/fnt-data.json?')?Response.json({sha,content:encode64(JSON.stringify(envelope(book)))}):new Response(null,{status:404});
    };
    const reading=readPrivateWorkbook(requested,'invented',fetcher);
    requested.owner='changed';requested.path='changed.json';release();
    const inspected=await reading;
    expect(inspected.config).toEqual({...expected,path:'fnt-data.json'});
    expect(calls).toHaveLength(3);expect(calls.every(url=>url.includes('/wendyyuanlu/fnt-data'))).toBe(true);
    expect(calls[1]).toContain('/contents/personal-workbook.json?ref=main');expect(calls[2]).toContain('/contents/fnt-data.json?ref=main');
  });
  it.each(['valid','wrong-revision','missing-revision','unavailable'] as const)('reads larger workbooks by the exact inspected blob revision: %s',async mode=>{
    const book=fixture(),calls:string[]=[];
    const fetcher:typeof fetch=async(input,init)=>{
      expect(init?.method??'GET').toBe('GET');calls.push(String(input));
      if(String(input).includes('/contents/'))return Response.json({sha,encoding:'none',size:2000000});
      if(String(input).includes('/git/blobs/'))return Response.json({...(mode==='missing-revision'?{}:{sha:mode==='wrong-revision'?'b'.repeat(40):sha}),encoding:'base64',content:encode64(JSON.stringify(envelope(book)))},{status:mode==='unavailable'?403:200});
      return Response.json({private:true,has_pages:false});
    };
    if(mode==='valid')expect((await readPrivateWorkbook(config,'invented',fetcher)).book).toEqual(book);
    else await expect(readPrivateWorkbook(config,'invented',fetcher)).rejects.toThrow(mode==='unavailable'?'Cannot read larger remote workbook':'requested file revision');
    expect(calls).toHaveLength(3);expect(calls[2]).toContain(`/git/blobs/${sha}`);
  });
  it.each([
    {...config,path:'../book.json'},
    {...config,owner:'wendyyuanlu',repo:'fnt'},
    {...config,branch:''},
  ])('rejects invalid destinations before network or initialization (%#)',async invalid=>{
    let calls=0;
    const fetcher:typeof fetch=async()=>{calls++;throw Error('Unexpected request');};
    await expect(readPrivateWorkbook(invalid,'invented',fetcher)).rejects.toThrow();
    const store=await Store.open(uid());
    try{await expect(store.initializePrivateWorkbook({...source(),config:invalid})).rejects.toThrow();expect(await store.load()).toBeUndefined();}finally{store.close();}
    expect(calls).toBe(0);
  });
  it('preserves a workbook, pending edits and undecided review created while inspection was in flight',async()=>{
    const name=uid(),store=await Store.open(name),other=await Store.open(name),book=fixture(),transport=readonlyFetch(encode64(JSON.stringify(envelope(book))));
    try{
      const inspecting=readPrivateWorkbook(config,'invented',transport.fetcher);
      const saved=await other.save(fixture(),0,'New local data during remote inspection');
      const current=await other.metadata(saved.version,state=>({...state,syncPaused:true,syncReview:true}));
      const review={left:{book:clone(current.book),kind:'Local',label:'Undecided local copy'},baseRevision:current.book.revision};
      await other.saveComparisonReview('retained-undecided',review,true);
      const inspected=await inspecting;
      await expect(store.initializePrivateWorkbook(inspected)).rejects.toThrow('already saved');
      expect(await store.load()).toEqual(current);expect(await store.comparisonReview('retained-undecided')).toEqual({...review,view:undefined});
      expect(await store.syncBase(config,sha)).toBeUndefined();expect(await store.originals()).toEqual([]);
    }finally{store.close();other.close();}
  });
  it('serializes competing explicit initializations so only one snapshot can become current',async()=>{
    const name=uid(),store=await Store.open(name),other=await Store.open(name),first=source(),second=source();
    try{
      const results=await Promise.allSettled([store.initializePrivateWorkbook(first),other.initializePrivateWorkbook(second)]);
      expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
      expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
      expect((await store.load())!.book).toEqual(first.book);
      expect(await store.syncBase(config,sha)).toEqual(first.book);
    }finally{store.close();other.close();}
  });
  it.each(['current-marker','head-marker','orphaned-journal','navigation','undo','base','attempt','conflict'] as const)('does not replace overlapping or damaged saved recovery state: %s',async kind=>{
    const name=uid(),store=await Store.open(name),db=await openRaw(name),inspected=source();
    const entry=kind==='current-marker'?{key:'current',value:null}:kind==='head-marker'?{key:'journal:head',value:null}:kind==='orphaned-journal'?{key:'journal:entry:0000000000000001',value:{version:1}}:kind==='navigation'?{key:`navigation:${inspected.book.id}`,value:{visits:{},pending:[]}}:kind==='undo'?{key:'undo',value:{book:inspected.book.id,version:1,history:{undo:[],redo:[]}}}:{key:`sync-${kind}:${JSON.stringify(config)}`,value:{preserved:true}};
    try{
      await put(db,entry.key,entry.value);
      const before=await records(db,'state');
      await expect(store.initializePrivateWorkbook(inspected)).rejects.toThrow(kind==='orphaned-journal'?'journal':'recovery data');
      expect(await records(db,'state')).toEqual(before);expect(await records(db,'originals')).toEqual([]);
    }finally{db.close();store.close();}
  });
  it('refuses an orphaned saved comparison without deleting its sources, choices or decision history',async()=>{
    const name=uid(),store=await Store.open(name),db=await openRaw(name),inspected=source();
    const view={choices:[{key:'retained-choice',side:'left' as const}],history:[[]],category:'all' as const,specific:'',region:0,context:'1',firstCell:false,linked:true,choiceScope:'filtered',keepScope:'difference',latest:[],uploads:{}};
    const review:StoredComparisonReview={left:{book:clone(inspected.book),kind:'Recovery',label:'Retained comparison source'},baseRevision:inspected.book.revision,view};
    try{
      await store.saveComparisonReview('orphaned-retained',review,true);
      const before=await records(db,'state');
      await expect(store.initializePrivateWorkbook(inspected)).rejects.toThrow('comparison recovery data');
      expect(await records(db,'state')).toEqual(before);expect(await store.comparisonReview('orphaned-retained')).toEqual(review);
      expect(await store.load()).toBeUndefined();expect(await store.syncBase(config,sha)).toBeUndefined();expect(await store.originals()).toEqual([]);
    }finally{db.close();store.close();}
  });
  it('retains unrelated history, photos, originals, credentials and Undo without restoring or changing them',async()=>{
    const name=uid(),store=await Store.open(name),db=await openRaw(name),inspected=source(),old=fixture();
    const previousOriginal={id:'older-package',name:'Older synthetic.xlsx',data:'AQ=='};
    try{
      await store.checkpoint('Independent recovery retained',old,[previousOriginal,original],true);
      await store.putPhoto(await inspectPhoto('older-photo',new Blob([photoBytes()],{type:'image/png'})));
      await store.rememberSyncToken(config,'invented-preexisting-credential');
      await put(db,'undo',{book:old.id,version:1,history:{undo:[{book:old}],redo:[]}});
      const keys=await request(db.transaction('state').objectStore('state').getAllKeys());
      const beforeState=await Promise.all(keys.map(async key=>[key,await request(db.transaction('state').objectStore('state').get(key))] as const));
      const beforeHistory=await records(db,'history'),beforePhotos=await records(db,'photos');
      inspected.originals=[original];const opened=await store.initializePrivateWorkbook(inspected);
      expect(opened.book).toEqual(inspected.book);expect(opened.pending).toEqual([]);expect(opened.syncPaused).toBe(true);
      for(const [key,value]of beforeState)expect(await request(db.transaction('state').objectStore('state').get(key))).toEqual(value);
      expect(await records(db,'history')).toEqual(beforeHistory);expect(await records(db,'photos')).toEqual(beforePhotos);
      expect(await store.originals()).toEqual(expect.arrayContaining([original,previousOriginal]));
      expect(await store.undoHistory(opened.version,opened.book.id)).toBeUndefined();
    }finally{db.close();store.close();}
  });
  it.each(['name','data'] as const)('rejects an original-package %s collision without partial initialization',async field=>{
    const name=uid(),store=await Store.open(name),db=await openRaw(name),inspected={...source(),originals:[original]};
    try{
      const retained={...original,[field]:'different'};
      await store.checkpoint('Preserved independent original',fixture(),[retained],true);
      const before=await records(db,'state');
      await expect(store.initializePrivateWorkbook(inspected)).rejects.toThrow('different saved contents');
      expect(await records(db,'state')).toEqual(before);expect(await store.originals()).toEqual([retained]);
    }finally{db.close();store.close();}
  });
  it.each(['matching','missing','collision'] as const)('preserves photo references without fetching or replacing original bytes: %s',async mode=>{
    const name=uid(),store=await Store.open(name),db=await openRaw(name),inspected=source();
    const photo=await inspectPhoto('invented-bootstrap-photo',new Blob([photoBytes()],{type:'image/png'}));
    captureData(inspected.book).photos.push({id:photo.id,date:20000,name:'Invented photo.png',digest:mode==='collision'?'b'.repeat(64):photo.digest,mime:photo.mime,bytes:photo.bytes});
    try{
      if(mode!=='missing')await store.putPhoto(photo);
      const before=await records(db,'photos');
      if(mode==='collision'){
        await expect(store.initializePrivateWorkbook(inspected)).rejects.toThrow('photo identity');
        expect(await store.load()).toBeUndefined();expect(await store.syncBase(config,sha)).toBeUndefined();
      }else{
        const opened=await store.initializePrivateWorkbook(inspected);
        expect(opened.book.foodCapture!.photos).toEqual(inspected.book.foodCapture!.photos);
        if(mode==='missing')await expect(store.photo(photo.id)).rejects.toThrow('not stored on this device');
        else expect(await store.photo(photo.id,photo)).toEqual(photo);
      }
      expect(await records(db,'photos')).toEqual(before);
    }finally{db.close();store.close();}
  });
  it('rolls back originals, current, journal and ancestry together when browser storage fails',async()=>{
    const name=uid(),store=await Store.open(name),db=await openRaw(name),inspected={...source(),originals:[original]},originalPut=IDBObjectStore.prototype.put;
    const failing=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(this.name==='state'&&key==='current')throw new DOMException('Invented quota failure','QuotaExceededError');
      return originalPut.call(this,value,key);
    });
    try{
      await expect(store.initializePrivateWorkbook(inspected)).rejects.toMatchObject({name:'QuotaExceededError'});
      expect(await records(db,'state')).toEqual([]);expect(await store.originals()).toEqual([]);expect(await store.load()).toBeUndefined();
    }finally{failing.mockRestore();db.close();store.close();}
  });
  it('captures the explicitly confirmed snapshot before asynchronous storage work',async()=>{
    const store=await Store.open(uid()),inspected={...source(),originals:[clone(original)]},expected=clone(inspected);
    try{
      const opening=store.initializePrivateWorkbook(inspected);
      inspected.book.title='Changed after confirmation';inspected.originals[0].data='changed';inspected.config.path='changed.json';
      const opened=await opening;
      expect(opened.book).toEqual(expected.book);expect(opened.sync).toEqual(expected.config);
      expect(await store.originals()).toEqual(expected.originals);expect(await store.syncBase(config,sha)).toEqual(expected.book);
      opened.book.title='Changed returned result';expect((await store.load())!.book).toEqual(expected.book);
    }finally{store.close();}
  });
  it.each(['compatible','same-cell'] as const)('keeps real inspected ancestry after the remote advances, preserving %s edits on explicit connection',async mode=>{
    const store=await Store.open(uid()),book=fixture(),sheet=book.sheets[0],localKey=key(sheet.rows[1].id,sheet.columns[0].id),otherKey=key(sheet.rows[1].id,sheet.columns[1].id),remoteKey=mode==='same-cell'?localKey:otherKey;
    let remote=clone(book),remoteSha=sha,uploads=0;
    const fetcher:typeof fetch=async(input,init)=>{
      if(!String(input).includes('/contents/'))return Response.json({private:true,has_pages:false});
      if(init?.method!=='PUT')return Response.json({sha:remoteSha,content:encode64(JSON.stringify(envelope(remote)))});
      uploads++;const payload=JSON.parse(String(init.body)) as {sha:string;content:string};
      expect(payload.sha).toBe(remoteSha);
      const uploaded=syncCodec({kind:'unpack',value:payload.content}) as {book:Workbook};
      remote=uploaded.book;remoteSha='c'.repeat(40);
      return Response.json({content:{sha:remoteSha}});
    };
    try{
      const inspected=await readPrivateWorkbook(config,'invented',fetcher);
      remote.sheets[0].cells[remoteKey]={value:mode==='same-cell'?3:30};remote.revision++;remoteSha='b'.repeat(40);
      const opened=await store.initializePrivateWorkbook(inspected);expect(uploads).toBe(0);expect(opened.syncPaused).toBe(true);
      const edited=clone(opened.book);edited.sheets[0].cells[localKey]={value:2};edited.revision++;
      const saved=await store.save(edited,opened.version,'Explicit synthetic local edit');
      const connected=await store.metadata(saved.version,state=>({...state,syncPaused:false}));
      const base=await store.syncBase(config,connected.remoteSha),syncing=syncGitHub(connected,'invented',fetcher,[],{base});
      if(mode==='same-cell'){
        await expect(syncing).rejects.toBeInstanceOf(SyncConflict);
        await expect(syncing).rejects.toMatchObject({local:{sheets:[{cells:{[localKey]:{value:2}}}]},remote:{sheets:[{cells:{[localKey]:{value:3}}}]}});
        expect(uploads).toBe(0);expect(await store.load()).toEqual(connected);
      }else{
        const result=await syncing;
        expect(uploads).toBe(1);expect(result.acknowledged).toEqual(connected.pending.map(change=>change.id));
        expect(remote.sheets[0].cells[localKey].value).toBe(2);expect(remote.sheets[0].cells[remoteKey].value).toBe(30);
      }
      expect(inspected.book.sheets[0].cells[localKey].value).toBe(1);expect(inspected.book.sheets[0].cells[otherKey].value).toBe(10);
    }finally{store.close();}
  });
});
