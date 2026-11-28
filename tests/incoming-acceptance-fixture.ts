import {blankSheet,clone,key,uid,type Workbook} from '../src/model';
import {compile} from '../src/formula';
import {Store,type SyncConfig} from '../src/storage';

export async function setup():Promise<void>{
  const sheet=blankSheet('Invented acceptance',40,20);
  const book:Workbook={schema:1,id:uid(),title:'Invented incoming acceptance',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  const cell=(r:number,c:number)=>key(sheet.rows[r].id,sheet.columns[c].id);
  sheet.cells[cell(0,0)]={value:1};sheet.cells[cell(0,1)]={value:10};
  sheet.cells[cell(0,2)]={formula:compile('=A1+B1',book,sheet.id,sheet.rows[0].id,sheet.columns[2].id)};
  sheet.cells[cell(3,0)]={value:'Label'};sheet.cells[cell(3,1)]={value:'Value'};
  sheet.cells[cell(4,0)]={value:'Invented row'};sheet.cells[cell(4,1)]={value:9};
  const table={id:uid(),name:'Invented',sheet:sheet.id,header:sheet.rows[3].id,rows:[sheet.rows[4].id],columns:[
    {id:uid(),column:sheet.columns[0].id,name:'Label'},{id:uid(),column:sheet.columns[1].id,name:'Value'},
  ]};book.tables.push(table);
  const config:SyncConfig={owner:'invented-owner',repo:'invented-private',branch:'invented',path:'fnt-data.json'};
  const store=await Store.open();
  let state=await store.save(book,0,'Seed invented acceptance',false,undefined,{localOnly:true,undoHistory:{undo:[],redo:[]}});
  state=await store.metadata(state.version,previous=>({...previous,sync:config,remoteSha:'a'.repeat(40),syncPaused:true,pending:[]}));
  await store.syncMetadata(state.version,{sha:'a'.repeat(40),confirmed:book,acknowledged:[]});
  const base=clone(book),remote=clone(book);remote.sheets[0].cells[cell(0,1)]={value:20};remote.revision++;
  let mode='',acceptCalls=0,mergeCalls=0,metadataCalls=0,visitCalls=0,committed=false;
  let releaseAccept:()=>void=()=>{},releaseVisit:()=>void=()=>{},releaseMetadata:()=>void=()=>{};
  const accept=Store.prototype.acceptSync,visit=Store.prototype.visit,metadata=Store.prototype.syncMetadata;
  Store.prototype.acceptSync=async function(...args:Parameters<Store['acceptSync']>){
    acceptCalls++;
    if(mode==='delay')await new Promise<void>(resolve=>{releaseAccept=resolve;});
    const saved=await accept.apply(this,args);committed=true;return saved;
  };
  Store.prototype.visit=async function(...args:Parameters<Store['visit']>){
    visitCalls++;
    if(mode==='visit')await new Promise<void>(resolve=>{releaseVisit=resolve;});
    return visit.apply(this,args);
  };
  Store.prototype.syncMetadata=async function(...args:Parameters<Store['syncMetadata']>){
    metadataCalls++;
    if(mode==='metadata')await new Promise<void>(resolve=>{releaseMetadata=resolve;});
    return metadata.apply(this,args);
  };
  const put=IDBObjectStore.prototype.put;
  const copy=window.structuredClone;
  window.structuredClone=function<T>(value:T,options?:StructuredSerializeOptions):T{
    if(mode==='clone-fail'&&committed&&value&&typeof value==='object'&&Reflect.get(value,'schema')===1){
      throw new DOMException('Invented accepted publication clone failed','DataCloneError');
    }
    return options===undefined?copy(value):copy(value,options);
  };
  IDBObjectStore.prototype.put=function(value:unknown,at?:IDBValidKey):IDBRequest<IDBValidKey>{
    if(mode==='reject'&&this.name==='history'&&value&&typeof value==='object'&&Reflect.get(value,'label')==='Before incoming sync changes'){
      throw new DOMException('Invented incoming checkpoint write failed','QuotaExceededError');
    }
    return at===undefined?put.call(this,value):put.call(this,value,at);
  };
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message:unknown,options?:unknown):void{
    if(message&&typeof message==='object'&&Reflect.get(message,'kind')==='start'&&Reflect.get(message,'operation')==='merge'){
      mergeCalls++;
      if(mode==='merge-edit'){
        mode='';
        queueMicrotask(()=>Reflect.get(window,'__incomingProbe').edit(7));
      }
    }
    Reflect.apply(post,this,options===undefined?[message]:[message,options]);
  };
  Reflect.set(window,'__incomingFixture',{
    base,remote,config,table:table.id,
    result:()=>({sha:'b'.repeat(40),remote:clone(remote),confirmed:clone(remote),acknowledged:[]}),
    control:(value:string)=>{mode=value;},
    counts:()=>({acceptCalls,mergeCalls,metadataCalls,visitCalls}),
    release:()=>{mode='';releaseAccept();releaseVisit();releaseMetadata();},
    durable:()=>store.load(),
    history:()=>store.history(),
    undo:async()=>{const current=(await store.load())!;return store.undoHistory(current.version,current.book.id);},
    syncBase:(sha='b'.repeat(40))=>store.syncBase(config,sha),
    externalVisit:()=>visit.call(store,book.id,table.id,40),
    externalChange:()=>store.metadata(Reflect.get(window,'__incomingProbe').snapshot().state.version,previous=>({...previous,sync:{...config,path:'other-invented.json'}})),
    close:()=>store.close(),
  });
}
