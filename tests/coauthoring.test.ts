import 'fake-indexeddb/auto';
import {describe,expect,it,vi} from 'vitest';
import {blankSheet,clone,uid,key,addRow,deleteRows,type Workbook} from '../src/model';
import {Store,syncGitHub,SyncConflict,mergeForSync,encode64,type LocalState,type SyncAttempt} from '../src/storage';
import {syncCodec} from '../src/sync-codec';
import {sameSharedWorkbook} from '../src/sync-merge';
import {applyUndo,structuralUndo,type UndoHistory} from '../src/undo-history';
import {addDraftFood,captureData,restaurantName,setRestaurant} from '../src/food-capture';
import {nutritionReviewRows,resolveNutritionReview} from '../src/ingredient-edit';
import {prepareSyncRecheck} from '../src/sync-recheck';
import type {StoredComparisonReview,ComparisonReviewView} from '../src/comparison-host';
import {inspectPhoto,decodePhotoArchives} from '../src/food-photos';
import {readArchive} from '../src/archive';
import type {Backup} from '../src/storage';

const config={owner:'example',repo:'private',branch:'main',path:'coauthoring.json'};
function fixture():Workbook{
  const sheet=blankSheet('Invented coauthoring',6,3);
  const book:Workbook={schema:1,id:uid(),title:'Synthetic only',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:1};
  sheet.cells[key(sheet.rows[1].id,sheet.columns[1].id)]={value:10};
  return book;
}
const edit=(book:Workbook,r:number,c:number,value:number)=>{const s=book.sheets[0];s.cells[key(s.rows[r].id,s.columns[c].id)]={value};book.revision++;};
const cell=(book:Workbook,r=1,c=0)=>{const s=book.sheets[0];return s.cells[key(s.rows[r].id,s.columns[c].id)]?.value;};
const state=(book:Workbook):LocalState=>({book,version:1,updated:'',sync:config,remoteSha:'base',pending:[{id:uid(),label:'Edit',time:''}]});
class Endpoint{
  sha='base';book:Workbook;operations:string[]=[];receipts:Record<string,string>={};writes=0;attempts=0;races=0;loseAcknowledgement=false;
  snapshots=new Map<string,Workbook>();blobReads=0;
  constructor(book:Workbook){this.book=clone(book);}
  fetch:typeof fetch=async(input,init)=>{
    if(String(input).includes('/git/blobs/')){
      this.blobReads++;
      const sha=String(input).split('/git/blobs/')[1],book=this.snapshots.get(sha);
      return book?Response.json({sha,encoding:'base64',content:encode64(JSON.stringify({format:'fnt-sync-v1',book,operations:[]}))}):Response.json({message:'Not found'},{status:404});
    }
    if(!String(input).includes('/contents/'))return Response.json({private:true,has_pages:false});
    if(init?.method!=='PUT')return Response.json({sha:this.sha,content:encode64(JSON.stringify({format:'fnt-sync-v1',book:this.book,operations:this.operations,receipts:this.receipts}))});
    this.attempts++;
    const body=JSON.parse(String(init.body)) as {sha:string;content:string};
    if(this.races-->0){this.sha+='-race';edit(this.book,2,2,this.attempts);}
    if(body.sha!==this.sha)return Response.json({message:'Stale SHA'},{status:409});
    const envelope=syncCodec({kind:'unpack',value:body.content}) as {book:Workbook;operations:string[];receipts:Record<string,string>};
    this.book=envelope.book;this.operations=envelope.operations;this.receipts=envelope.receipts;this.sha=`saved-${++this.writes}`;
    if(this.loseAcknowledgement){this.loseAcknowledgement=false;throw Error('Controlled lost acknowledgement');}
    return Response.json({content:{sha:this.sha}});
  };
}
describe('shared-ancestor private sync',()=>{
  describe.each(['draft','logged'] as const)('atomic restaurant links: %s',kind=>{
    const setup=()=>{
      const book=fixture(),data=captureData(book);
      if(kind==='draft'){addDraftFood(book,20000);addDraftFood(book,20000);}
      else data.loggedDetails={'invented-table:invented-row':{},'invented-table:other-row':{}};
      const link=(book:Workbook,index=0)=>kind==='draft'?book.foodCapture!.foods[index]:book.foodCapture!.loggedDetails![index?'invented-table:other-row':'invented-table:invented-row'];
      const path=kind==='draft'?`foodCapture/foods/${data.foods[0].id}/restaurant`:'foodCapture/loggedDetails/invented-table:invented-row/restaurant';
      return{book,link,path};
    };
    it('preserves both coherent alternatives when the same blank food chooses text versus a linked restaurant',async()=>{
      const {book:base,link,path}=setup(),local=clone(base),remote=clone(base);
      link(local).restaurantText='Home cooked';setRestaurant(remote,link(remote),'Invented cafe');
      const merged=await mergeForSync(base,local,remote);
      expect(merged.conflicts).toEqual([path]);
      expect(restaurantName(merged.local,link(merged.local))).toBe('Home cooked');
      expect(restaurantName(merged.remote,link(merged.remote))).toBe('Invented cafe');
      expect(link(merged.local).restaurant).toBeUndefined();expect(link(merged.remote).restaurantText).toBeUndefined();
    });
    it('does not silently replace an explicit unlink with a concurrent text selection',async()=>{
      const {book:base,link,path}=setup();setRestaurant(base,link(base),'Invented original cafe');
      const local=clone(base),remote=clone(base);
      delete link(local).restaurant;link(remote).restaurantText='Home cooked';delete link(remote).restaurant;
      const merged=await mergeForSync(base,local,remote);
      expect(merged.conflicts).toEqual([path]);
      expect(restaurantName(merged.local,link(merged.local))).toBe('');
      expect(restaurantName(merged.remote,link(merged.remote))).toBe('Home cooked');
      expect(link(merged.local).restaurant).toBeUndefined();expect(link(merged.local).restaurantText).toBeUndefined();
    });
    it('merges a restaurant choice with independent cell data without creating a review',async()=>{
      const {book:base,link}=setup(),local=clone(base),remote=clone(base);
      link(local).restaurantText='Home cooked';edit(remote,2,1,77);
      const merged=await mergeForSync(base,local,remote);
      expect(merged.conflicts).toEqual([]);expect(cell(merged.local,2,1)).toBe(77);
      expect(restaurantName(merged.local,link(merged.local))).toBe('Home cooked');
    });
    it('merges different restaurant choices on different foods without creating a review',async()=>{
      const {book:base,link}=setup(),local=clone(base),remote=clone(base);
      link(local).restaurantText='Home cooked';setRestaurant(remote,link(remote,1),'Invented other cafe');
      const merged=await mergeForSync(base,local,remote);
      expect(merged.conflicts).toEqual([]);
      expect(restaurantName(merged.local,link(merged.local))).toBe('Home cooked');
      expect(restaurantName(merged.local,link(merged.local,1))).toBe('Invented other cafe');
    });
    it.each(['','  '])('treats a cleared text input %j and an absent restaurant as the same unlink',async text=>{
      const {book:base,link}=setup();setRestaurant(base,link(base),'Invented original cafe');
      const local=clone(base),remote=clone(base);
      delete link(local).restaurant;delete link(remote).restaurant;link(remote).restaurantText=text;
      const merged=await mergeForSync(base,local,remote);
      expect(merged.conflicts).toEqual([]);expect(restaurantName(merged.local,link(merged.local)).trim()).toBe('');
      expect(link(merged.local).restaurant).toBeUndefined();
    });
    it('automatically accepts identical concurrent restaurant text instead of manufacturing a conflict',async()=>{
      const {book:base,link}=setup(),local=clone(base),remote=clone(base);
      link(local).restaurantText=link(remote).restaurantText='Home cooked';edit(remote,2,1,88);
      const merged=await mergeForSync(base,local,remote);
      expect(merged.conflicts).toEqual([]);expect(cell(merged.local,2,1)).toBe(88);
      expect(restaurantName(merged.local,link(merged.local))).toBe('Home cooked');
    });
  });
  it('atomic restaurant links stop private upload with both coherent same-food choices retained',async()=>{
    const base=fixture(),food=addDraftFood(base,20000),local=clone(base),remote=clone(base);
    local.foodCapture!.foods[0].restaurantText='Home cooked';
    setRestaurant(remote,remote.foodCapture!.foods[0],'Invented remote cafe');
    const endpoint=new Endpoint(remote);endpoint.sha='remote-restaurant-choice';
    const syncing=syncGitHub(state(local),'invented',endpoint.fetch,[],{base});
    await expect(syncing).rejects.toBeInstanceOf(SyncConflict);
    await expect(syncing).rejects.toMatchObject({
      conflicts:[`foodCapture/foods/${food.id}/restaurant`],
      local:{foodCapture:{foods:[{id:food.id,restaurantText:'Home cooked'}]}},
      remote:{foodCapture:{foods:[{id:food.id,restaurant:remote.foodCapture!.foods[0].restaurant}]}},
    });
    expect(endpoint.attempts).toBe(0);expect(endpoint.writes).toBe(0);
    expect(endpoint.book).toEqual(remote);expect(local.foodCapture!.foods[0].restaurant).toBeUndefined();
  });
  it('merges disjoint inputs, formatting and simultaneous insertions by identity without changing device preferences',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base);
    edit(local,1,0,2);edit(remote,1,1,30);
    const l=addRow(local,local.sheets[0],2),r=addRow(remote,remote.sheets[0],2);
    local.toolbarOrder=['action:bold'];remote.toolbarOrder=['action:italic'];
    const address=key(base.sheets[0].rows[1].id,base.sheets[0].columns[0].id);
    remote.sheets[0].cells[address].format={bold:true};
    const merged=await mergeForSync(base,local,remote),reverse=await mergeForSync(base,remote,local);
    expect(merged.conflicts).toEqual([]);expect(sameSharedWorkbook(merged.local,reverse.local)).toBe(true);
    expect(cell(merged.local)).toBe(2);expect(cell(merged.local,1,1)).toBe(30);
    expect(merged.local.sheets[0].cells[address].format).toEqual({bold:true});
    expect(merged.local.sheets[0].rows.map(row=>row.id)).toEqual(expect.arrayContaining([l.id,r.id]));
    expect(merged.local.toolbarOrder).toEqual(local.toolbarOrder);
  });
  it('preserves both conflicting input states atomically and includes nonconflicting edits in both alternatives',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base),s=base.sheets[0],address=key(s.rows[1].id,s.columns[0].id);
    edit(local,1,0,2);edit(local,2,1,44);edit(remote,3,2,55);
    remote.sheets[0].cells[address]={formula:{kind:'literal',value:5},original:'=5'};
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.local.sheets[0].cells[address]).toEqual({value:2});
    expect(merged.remote.sheets[0].cells[address]).toEqual({formula:{kind:'literal',value:5},original:'=5'});
    for(const variant of [merged.local,merged.remote]){expect(cell(variant,2,1)).toBe(44);expect(cell(variant,3,2)).toBe(55);}
  });
  it('rejects newly broken references while allowing existing imported missing references',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base),s=remote.sheets[0],row=s.rows[2].id;
    deleteRows(local,local.sheets[0],[row]);
    s.cells[key(s.rows[3].id,s.columns[2].id)]={formula:{kind:'ref',sheet:s.id,row,column:s.columns[0].id,absCol:false,absRow:false}};
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts.some(path=>path.startsWith('structure/dependencies'))).toBe(true);
    expect(merged.local).toEqual(local);expect(merged.remote).toEqual(remote);
    expect((await mergeForSync(remote,remote,remote)).conflicts).toEqual([]);
  });
  it('rebases Undo and Redo without undoing remotely inserted rows or values',()=>{
    const base=fixture(),local=clone(base);edit(local,1,0,2);
    const after=clone(local),row=addRow(after,after.sheets[0],1),address=key(row.id,after.sheets[0].columns[2].id);
    after.sheets[0].cells[address]={value:77};
    const history=syncCodec({kind:'history',before:local,after,history:{undo:[structuralUndo(base,local)],redo:[]}}) as UndoHistory;
    const undone=applyUndo(after,history.undo[0]),redone=applyUndo(undone.book,undone.inverse).book;
    expect(undone.book.sheets[0].cells[address].value).toBe(77);
    expect(undone.book.sheets[0].cells[key(base.sheets[0].rows[1].id,base.sheets[0].columns[0].id)].value).toBe(1);
    expect(redone).toEqual(after);
  });
  it('does not let an existing orphaned binding hide a newly orphaned binding to the same source',async()=>{
    const base=fixture(),s=base.sheets[0],source=s.rows[2].id,column=s.columns[0].id;
    base.tables=[{id:'source',name:'Source',sheet:s.id,header:s.rows[0].id,rows:[source],columns:[{id:'field',name:'Value',column}]}];
    s.cells[key(s.rows[0].id,column)]={value:'Value'};
    s.cells[key(s.rows[3].id,s.columns[1].id)]={binding:{table:'source',row:source,column:'field'}};
    const local=clone(base),remote=clone(base);local.tables[0].rows=[];
    remote.sheets[0].cells[key(s.rows[4].id,s.columns[1].id)]={binding:{table:'source',row:source,column:'field'}};
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts.some(path=>path.startsWith('structure/dependencies'))).toBe(true);
    expect(merged.local).toEqual(local);expect(merged.remote).toEqual(remote);
  });
  it.each([false,true])('uses durable lost-acknowledgment proof after operation trimming without hiding collisions (%s)',async collision=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);
    let attempt:SyncAttempt|undefined;const beforeUpload=async(transfer:SyncAttempt)=>{attempt=clone(transfer);};
    endpoint.loseAcknowledgement=true;
    await expect(syncGitHub(state(local),'invented',endpoint.fetch,[],{base,beforeUpload})).rejects.toThrow('lost acknowledgement');
    const newer=clone(local);edit(newer,1,0,3);endpoint.operations=[];edit(endpoint.book,1,1,90);endpoint.sha='newer-computer';
    if(collision)edit(endpoint.book,1,0,4);
    const retry=syncGitHub(state(newer),'invented',endpoint.fetch,[],{base,attempt,beforeUpload});
    if(collision){await expect(retry).rejects.toBeInstanceOf(SyncConflict);expect(endpoint.writes).toBe(1);}
    else{await retry;expect(cell(endpoint.book)).toBe(3);expect(cell(endpoint.book,1,1)).toBe(90);}
  });
  it('refetches and remerges CAS races, bounds contention and never uploads before its receipt is durable',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);edit(endpoint.book,1,1,30);endpoint.sha='remote';endpoint.races=1;
    const current=state(local),result=await syncGitHub(current,'invented',endpoint.fetch,[],{base});
    expect(endpoint.attempts).toBe(2);expect(endpoint.writes).toBe(1);
    expect(cell(endpoint.book)).toBe(2);expect(cell(endpoint.book,1,1)).toBe(30);expect(cell(endpoint.book,2,2)).toBe(1);
    expect(result.acknowledged).toEqual(current.pending.map(operation=>operation.id));
    const blocked=new Endpoint(base);
    await expect(syncGitHub(current,'invented',blocked.fetch,[],{base,beforeUpload:async()=>{throw Error('Controlled storage failure');}})).rejects.toThrow('Controlled storage failure');
    expect(blocked.attempts).toBe(0);
    blocked.races=9;
    await expect(syncGitHub(current,'invented',blocked.fetch,[],{base})).rejects.toThrow('kept changing');
    expect(blocked.attempts).toBe(3);expect(blocked.writes).toBe(0);expect(current.pending).toHaveLength(1);
  });
  it.each([false,true])('recovers the exact legacy Git blob ancestor for disjoint edits without hiding a same-cell collision (%s)',async collision=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base),sha='a'.repeat(40);
    endpoint.snapshots.set(sha,clone(base));
    edit(local,2,0,42);
    local.sheets[0].groups.push({id:'local-group',axis:'row',members:[local.sheets[0].rows[2].id],label:'Local',collapsed:false});
    edit(endpoint.book,1,1,30);endpoint.sha='newer-remote';
    if(collision){edit(local,1,0,2);edit(endpoint.book,1,0,3);}
    const current={...state(local),remoteSha:sha},result=syncGitHub(current,'invented',endpoint.fetch);
    if(collision){
      const conflict=await result.catch(error=>error);
      expect(conflict).toBeInstanceOf(SyncConflict);expect(conflict.conflicts).toHaveLength(1);
      expect(cell(conflict.local)).toBe(2);expect(cell(conflict.remote)).toBe(3);
      for(const book of [conflict.local,conflict.remote]){expect(cell(book,2,0)).toBe(42);expect(cell(book,1,1)).toBe(30);expect(book.sheets[0].groups).toHaveLength(1);}
      expect(endpoint.writes).toBe(0);
    }else{
      const merged=await result;
      expect(merged.acknowledged).toEqual(current.pending.map(operation=>operation.id));
      expect(cell(endpoint.book,2,0)).toBe(42);expect(cell(endpoint.book,1,1)).toBe(30);expect(endpoint.book.sheets[0].groups).toHaveLength(1);
      expect(endpoint.writes).toBe(1);
    }
    expect(endpoint.blobReads).toBe(1);
  });
  it.each(['missing','different-workbook'] as const)('keeps legacy divergence paused when its historical ancestor is %s',async reason=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base),sha='b'.repeat(40);
    edit(local,2,0,42);edit(endpoint.book,1,1,30);endpoint.sha='newer-remote';
    if(reason==='different-workbook')endpoint.snapshots.set(sha,fixture());
    await expect(syncGitHub({...state(local),remoteSha:sha},'invented',endpoint.fetch)).rejects.toBeInstanceOf(SyncConflict);
    expect(endpoint.blobReads).toBe(1);expect(endpoint.attempts).toBe(0);
  });
  it('surfaces historical-ancestor permission failures and rejects a mismatched blob response without uploading',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base),sha='c'.repeat(40);
    edit(local,2,0,42);edit(endpoint.book,1,1,30);endpoint.sha='newer-remote';
    for(const status of [403,200]){
      const fetcher:typeof fetch=async(input,init)=>String(input).includes('/git/blobs/')?
        Response.json(status===403?{message:'Forbidden'}:{sha:'d'.repeat(40),encoding:'base64',content:encode64(JSON.stringify({format:'fnt-sync-v1',book:base,operations:[]}))},{status}):endpoint.fetch(input,init);
      await expect(syncGitHub({...state(local),remoteSha:sha},'invented',fetcher)).rejects.toThrow(status===403?'Cannot read saved sync revision (403)':'did not return the saved sync revision');
    }
    expect(endpoint.attempts).toBe(0);
  });
  it('keeps new nutrition-review metadata pending and atomically preserves durable ancestry, history and recovery',async()=>{
    const store=await Store.open(uid()),base=fixture(),after=clone(base);edit(after,2,2,55);
    try{
      let saved=await store.save(base,0,'Initial');
      saved=await store.metadata(saved.version,s=>({...s,sync:config,pending:[]}));
      const history={undo:[],redo:[]},result={sha:'received',confirmed:after,acknowledged:[]};
      const failed=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Quota exceeded','QuotaExceededError');});
      await expect(store.acceptSync(saved.version,config,result,after,history)).rejects.toThrow('Quota exceeded');failed.mockRestore();
      expect(await store.load()).toEqual(saved);expect(await store.syncBase(config,'received')).toBeUndefined();
      const accepted=await store.acceptSync(saved.version,config,result,after,history,{pendingLabel:'Review incoming nutrition changes'});
      expect(accepted.pending.map(operation=>operation.label)).toEqual(['Review incoming nutrition changes']);
      expect(await store.syncBase(config,'received')).toEqual(after);
      expect(await store.syncBase({...config,path:'other.json'},'received')).toBeUndefined();
      expect(await store.undoHistory(accepted.version,base.id)).toEqual(history);
      expect((await store.history()).some(copy=>copy.label==='Before incoming sync changes'&&cell(copy.book,2,2)===undefined)).toBe(true);
      await expect(store.acceptSync(saved.version,config,result,after)).rejects.toThrow('Another tab');
    }finally{store.close();}
  });
});

describe('explicit paused sync recheck',()=>{
  async function paused(){
    const name=uid(),store=await Store.open(name),base=fixture(),local=clone(base),endpoint=new Endpoint(base),sha='a'.repeat(40);
    edit(local,1,0,2);edit(endpoint.book,1,1,30);endpoint.sha='newer-remote';endpoint.snapshots.set(sha,base);
    const saved=await store.save(local,0,'Phone edit');
    let current=await store.metadata(saved.version,s=>({...s,sync:config,remoteSha:sha,syncPaused:true,syncReview:true}));
    const view:ComparisonReviewView={choices:[],history:[[]],category:'all',specific:'',region:0,context:'',firstCell:false,linked:true,choiceScope:'all',keepScope:'all',latest:[],uploads:{}};
    const id=uid(),review:StoredComparisonReview={left:{book:clone(local),kind:'Local',label:'Old local'},right:{book:clone(base),kind:'GitHub',label:'Old remote'},view,baseRevision:local.revision,sync:{config,path:config.path,sha:'old-review-sha'}};
    await store.saveComparisonReview(id,review,true);
    const newer=clone(current.book);edit(newer,2,2,44);const food=addDraftFood(newer,45000);food.values={food:'New phone draft',calories:'123'};
    current=await store.save(newer,current.version,'Later phone panel edit');
    return{name,store,base,endpoint,current,id,review};
  }
  it('previews the current phone edits using exact legacy ancestry, without upload, acknowledgement or changing the old review',async()=>{
    const f=await paused();
    try{
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch);
      expect(preview.plan.conflicts).toEqual([]);expect(preview.reviewId).not.toBe(f.id);
      expect(cell(preview.plan.local)).toBe(2);expect(cell(preview.plan.local,1,1)).toBe(30);expect(cell(preview.plan.local,2,2)).toBe(44);
      expect(preview.plan.local.foodCapture!.foods[0].values).toEqual({food:'New phone draft',calories:'123'});
      expect(f.endpoint.blobReads).toBe(1);expect(f.endpoint.attempts).toBe(0);
      expect(await f.store.load()).toEqual(f.current);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);
      await f.store.stageSyncRecheck(preview);
      expect(await f.store.load()).toEqual(f.current);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);
      expect(await f.store.comparisonReview(preview.reviewId)).toEqual(preview.review);
      expect((await f.store.history()).some(copy=>copy.label==='Before paused sync recheck'&&!!copy.backup)).toBe(true);
      f.store.close();
      const reopened=await Store.open(f.name);
      try{
        expect(await reopened.comparisonReview(f.id)).toEqual(f.review);
        expect(await reopened.syncRecheckHistory(f.current.book.id)).toEqual([{id:f.id,time:expect.any(String)}]);
        expect((await reopened.load())!.syncReview).toBe(true);expect((await reopened.load())!.pending).toEqual(f.current.pending);
      }finally{reopened.close();}
    }finally{f.store.close();}
  });
  it('preflights and stages without stringifying complete states or saved reviews for equality',async()=>{
    const f=await paused(),stringify=JSON.stringify;
    const guarded=vi.spyOn(JSON,'stringify').mockImplementation((value,replacer,space)=>{
      if(!replacer&&value&&typeof value==='object'&&('pending'in value&&'book'in value||'baseRevision'in value&&'left'in value))throw new RangeError('Invalid string length');
      return stringify(value,replacer,space);
    });
    try{
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch);
      await f.store.stageSyncRecheck(preview);
      expect(await f.store.load()).toEqual(f.current);
      expect(await f.store.comparisonReview(f.id)).toEqual(f.review);
      expect(await f.store.comparisonReview(preview.reviewId)).toEqual(preview.review);
      expect(f.endpoint.attempts).toBe(0);
    }finally{guarded.mockRestore();f.store.close();}
  });
  it('keeps only the real same-cell collision in the new alternatives and retains disjoint edits in both',async()=>{
    const f=await paused();edit(f.endpoint.book,1,0,3);
    try{
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch);
      expect(preview.plan.conflicts).toHaveLength(1);
      expect(cell(preview.plan.local)).toBe(2);expect(cell(preview.plan.remote)).toBe(3);
      for(const copy of [preview.plan.local,preview.plan.remote]){expect(cell(copy,1,1)).toBe(30);expect(cell(copy,2,2)).toBe(44);expect(copy.foodCapture!.foods[0].values.calories).toBe('123');}
      expect(preview.review.view).toBeUndefined();expect(await f.store.comparisonReview(f.id)).toEqual(f.review);expect(f.endpoint.attempts).toBe(0);
    }finally{f.store.close();}
  });
  it.each([
    {local:2,remote:3,conflicts:1},
    {local:2,remote:3,conflicts:1,emptyPending:true},
    {local:4,remote:5,conflicts:1},
    {local:2,remote:5,conflicts:1},
    {local:2,remote:2,conflicts:0},
    {local:3,remote:3,conflicts:0},
  ])('does not silently resolve an existing conflict whose remote head is already the saved base ($local/$remote)',async next=>{
    const f=await paused();
    try{
      edit(f.endpoint.book,1,0,3);
      const merged=await mergeForSync(f.base,f.current.book,f.endpoint.book);
      f.current=await f.store.save(merged.local,f.current.version,'Preserve provisional conflict variant');
      f.current={...f.current,...await f.store.syncMetadata(f.current.version,{sha:f.endpoint.sha,confirmed:f.endpoint.book})};
      await f.store.checkpoint('Remote conflict - not applied',merged.remote,[],true,{config,sha:f.endpoint.sha,local:merged.local});
      if(next.local!==2){const current=clone(f.current.book);edit(current,1,0,next.local);f.current=await f.store.save(current,f.current.version,'Later same-cell phone edit');}
      if(next.remote!==3){edit(f.endpoint.book,1,0,next.remote);f.endpoint.sha='even-newer-head';}
      if('emptyPending'in next)f.current=await f.store.metadata(f.current.version,s=>({...s,pending:[]}));
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch);
      expect(preview.plan.conflicts).toHaveLength(next.conflicts);
      expect(cell(preview.plan.local)).toBe(next.local);expect(cell(preview.plan.remote)).toBe(next.remote);
      for(const copy of [preview.plan.local,preview.plan.remote]){expect(cell(copy,1,1)).toBe(30);expect(cell(copy,2,2)).toBe(44);expect(copy.foodCapture!.foods[0].values.calories).toBe('123');}
      expect(await f.store.load()).toEqual(f.current);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);expect(f.endpoint.attempts).toBe(0);
    }finally{f.store.close();}
  });
  it('retains exact local photo bytes, original attachments and Undo through failed and successful staging',async()=>{
    const f=await paused();
    try{
      const photo=await inspectPhoto(uid(),new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0])],{type:'image/png'}));
      const book=clone(f.current.book),history={undo:[structuralUndo(f.base,book)],redo:[]},original={id:'synthetic-xlsx',name:'Invented original.xlsx',data:'AA=='};
      const sheet=book.sheets[0];
      sheet.cells[key(sheet.rows[3].id,sheet.columns[0].id)]={formula:{kind:'ref',sheet:sheet.id,row:sheet.rows[1].id,column:sheet.columns[0].id,absRow:false,absCol:false},format:{bold:true}};
      captureData(book).photos.push({id:photo.id,name:'Invented.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      f.current=await f.store.save(book,f.current.version,'Attach synthetic original',false,original,{photos:[photo],undoHistory:history});
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch);
      const savedBackup=(await f.store.history()).find(copy=>copy.id===preview.backupId)!;
      const archive=await readArchive(savedBackup.backup!) as Backup;
      expect(archive.state.book).toEqual(book);expect(archive.originals).toEqual([original]);
      expect(await decodePhotoArchives(archive.photos!)).toEqual([photo]);
      expect(JSON.stringify(preview)).not.toContain(archive.photos![0].data);
      const failure=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw Error('Synthetic recovery write failure');});
      try{await expect(f.store.stageSyncRecheck(preview)).rejects.toThrow('recovery write failure');}finally{failure.mockRestore();}
      expect(await f.store.photo(photo.id,photo)).toEqual(photo);expect(await f.store.originals()).toEqual([original]);
      expect(await f.store.undoHistory(f.current.version,book.id)).toEqual(history);expect(await f.store.load()).toEqual(f.current);
      await f.store.stageSyncRecheck(preview);
      expect(await f.store.photo(photo.id,photo)).toEqual(photo);expect(await f.store.originals()).toEqual([original]);
      expect(await f.store.undoHistory(f.current.version,book.id)).toEqual(history);
      const recovery=(await f.store.history()).find(copy=>copy.label==='Before paused sync recheck')!;
      expect(await decodePhotoArchives((await readArchive(recovery.backup!) as Backup).photos!)).toEqual([photo]);
      expect((await f.store.history()).find(copy=>copy.label==='GitHub source - paused sync recheck')!.book).toEqual(f.endpoint.book);
    }finally{f.store.close();}
  });
  it('retains a missing-photo review without staging an incomplete recovery copy',async()=>{
    const f=await paused();
    try{
      const photo=await inspectPhoto(uid(),new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1])],{type:'image/png'})),book=clone(f.current.book);
      captureData(book).photos.push({id:photo.id,name:'Unavailable.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      f.current=await f.store.save(book,f.current.version,'Synthetic reference without original');
      await expect(prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch)).rejects.toThrow('photo originals are missing');
      expect(await f.store.load()).toEqual(f.current);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);expect(await f.store.history()).toEqual([]);
      expect(f.endpoint.attempts).toBe(0);
    }finally{f.store.close();}
  });
  it('preserves everything when the ancestor is unavailable or the active editor/photo/connection guard changes',async()=>{
    const f=await paused();
    try{
      f.endpoint.snapshots.clear();
      await expect(prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch)).rejects.toThrow('ancestor could not be verified');
      f.endpoint.snapshots.set(f.current.remoteSha!,f.base);
      let active=true;
      const fetcher:typeof fetch=async(input,init)=>{const response=await f.endpoint.fetch(input,init);if(String(input).includes('/contents/'))active=false;return response;};
      await expect(prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>active,fetcher)).rejects.toThrow('changed during recheck');
      expect(await f.store.load()).toEqual(f.current);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);
      expect(await f.store.history()).toHaveLength(2);expect((await f.store.history()).every(copy=>copy.label==='Before paused sync recheck'&&!!copy.backup)).toBe(true);expect(f.endpoint.attempts).toBe(0);
    }finally{f.store.close();}
  });
  it.each(['choices','history'] as const)('does not recheck or reset existing %s, including undone decisions',async kind=>{
    const f=await paused();
    try{
      if(kind==='choices')f.review.view!.choices=[{key:'old-decision',side:'left'}];
      else f.review.view!.history=[[{key:'old-decision',side:'right'}],[]];
      await f.store.saveComparisonReview(f.id,f.review,true);
      await expect(prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch)).rejects.toThrow('decisions or decision history');
      expect(f.endpoint.blobReads).toBe(0);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);expect(await f.store.load()).toEqual(f.current);
    }finally{f.store.close();}
  });
  it.each(['workbook','review','sources','quota'] as const)('atomically refuses stale %s staging without replacing the old review or committing partial recovery',async reason=>{
    const f=await paused();
    try{
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch);
      let restore=()=>{};
      if(reason==='workbook')f.current=await f.store.metadata(f.current.version,s=>({...s,sync:{...config,path:'new.json'}}));
      if(reason==='review'){f.review.view!.history.push([{key:'late-decision',side:'left'}]);await f.store.saveComparisonReview(f.id,f.review,true);}
      if(reason==='sources'){edit(f.review.right!.book,3,2,88);await f.store.saveComparisonReview(f.id,f.review,true);}
      if(reason==='quota'){const failure=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Synthetic quota failure','QuotaExceededError');});restore=()=>failure.mockRestore();}
      try{await expect(f.store.stageSyncRecheck(preview)).rejects.toThrow(reason==='workbook'?'Another tab':reason==='review'?'decisions or decision history':reason==='sources'?'original comparison changed':'quota failure');}finally{restore();}
      expect(await f.store.comparisonReview(f.id)).toEqual(f.review);expect(await f.store.comparisonReview(preview.reviewId)).toBeUndefined();
      expect(await f.store.history()).toEqual([expect.objectContaining({id:preview.backupId,label:'Before paused sync recheck',backup:expect.any(Blob)})]);expect(await f.store.load()).toEqual(f.current);expect(f.endpoint.attempts).toBe(0);
    }finally{f.store.close();}
  });
  it('refuses to overwrite an original attachment changed after preflight without a workbook version change',async()=>{
    const f=await paused();
    try{
      const original={id:'synthetic-xlsx',name:'Original.xlsx',data:'AA=='};
      await f.store.checkpoint('Independent original fixture',f.current.book,[original],true);
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch);
      const newer={...original,data:'AQ=='};
      await f.store.checkpoint('Later original fixture',f.current.book,[newer],true);
      await expect(f.store.stageSyncRecheck(preview)).rejects.toThrow('original attachment changed');
      expect(await f.store.originals()).toEqual([newer]);expect(await f.store.load()).toEqual(f.current);
      expect(await f.store.comparisonReview(f.id)).toEqual(f.review);expect(await f.store.comparisonReview(preview.reviewId)).toBeUndefined();
      expect((await f.store.history()).some(copy=>copy.id===preview.backupId&&!!copy.backup)).toBe(true);expect(f.endpoint.attempts).toBe(0);
    }finally{f.store.close();}
  });
  it('durably saves the complete recovery archive before the first network read',async()=>{
    const f=await paused(),network=vi.fn(f.endpoint.fetch);
    try{
      const read:typeof fetch=async(input,init)=>{
        const checkpoints=await f.store.history();
        expect(checkpoints).toHaveLength(1);
        const backup=await readArchive(checkpoints[0].backup!) as Backup;
        expect(backup.state).toEqual(f.current);
        return network(input,init);
      };
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,read);
      expect(network).toHaveBeenCalled();expect(preview.backupId).toBe((await f.store.history())[0].id);
      expect(await f.store.load()).toEqual(f.current);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);
    }finally{f.store.close();}
  });
  it('does not read GitHub or change a review when the early recovery write fails',async()=>{
    const f=await paused(),network=vi.fn(f.endpoint.fetch);
    try{
      const failure=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Synthetic early backup quota failure','QuotaExceededError');});
      try{await expect(prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,network)).rejects.toThrow('early backup quota failure');}finally{failure.mockRestore();}
      expect(network).not.toHaveBeenCalled();expect(await f.store.history()).toEqual([]);
      expect(await f.store.load()).toEqual(f.current);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);
    }finally{f.store.close();}
  });
  it('refuses staging without its verified durable full backup and keeps the original backup recoverable',async()=>{
    const f=await paused();
    try{
      const preview=await prepareSyncRecheck(f.store,f.current,'invented',f.id,()=>true,f.endpoint.fetch),id=preview.backupId;
      preview.backupId=uid();
      await expect(f.store.stageSyncRecheck(preview)).rejects.toThrow('full pre-recheck backup is unavailable');
      expect(await f.store.load()).toEqual(f.current);expect(await f.store.comparisonReview(f.id)).toEqual(f.review);
      expect(await f.store.comparisonReview(preview.reviewId)).toBeUndefined();expect(await f.store.syncRecheckHistory(f.current.book.id)).toEqual([]);
      f.store.close();const reopened=await Store.open(f.name);
      try{expect((await readArchive((await reopened.history()).find(copy=>copy.id===id)!.backup!) as Backup).state).toEqual(f.current);}finally{reopened.close();}
    }finally{f.store.close();}
  });
});

function nutritionFixture(){
  const book=fixture(),s=blankSheet('Ingredients',3,5),fields=['Ingredients','Serving (g)','Conversion Amount','Conversion Unit','Calories'];
  book.sheets.push(s);
  const columns=fields.map((name,i)=>({id:`i${i}`,name,column:s.columns[i].id}));
  const table={id:'ingredients',name:'Ingredients',sheet:s.id,header:s.rows[0].id,rows:[s.rows[1].id],columns};
  book.tables.push(table);
  columns.forEach((column,i)=>{s.cells[key(table.header,column.column)]={value:column.name};s.cells[key(table.rows[0],column.column)]={value:['Sample',100,1,'each',200][i]};});
  const food=addDraftFood(book,45000);food.values={food:'Sample',weight:'25',calories:'91'};food.ingredient={table:table.id,row:table.rows[0]};
  const log=book.sheets[0],logColumns=['Food','Amount (g)','Calories'].map((name,i)=>({id:`m${i}`,name,column:log.columns[i].id}));
  const master={id:'master',name:'Master',sheet:log.id,header:log.rows[0].id,rows:[log.rows[1].id],columns:logColumns};book.tables.push(master);
  logColumns.forEach(column=>{log.cells[key(master.header,column.column)]={value:column.name};});
  log.cells[key(master.rows[0],logColumns[0].column)]={value:'Sample',binding:{table:table.id,row:table.rows[0],column:columns[0].id}};
  log.cells[key(master.rows[0],logColumns[1].column)]={value:50};log.cells[key(master.rows[0],logColumns[2].column)]={value:99};
  log.mealLog={table:master.id,fields:{food:'m0',weight:'m1',calories:'m2'},ingredients:{table:table.id,fields:{food:'i0',weight:'i1',amount:'i2',unit:'i3',calories:'i4'}}};
  return{book,s,table,food,log,master,columns,logColumns};
}
describe('incoming capture nutrition safety',()=>{
  it('preserves Draft and plain-linked Logged manual values and consumption, queues recalculated choices, and persists mixed decisions',async()=>{
    const f=nutritionFixture(),before=clone(f.book),after=clone(before),source=after.sheets.find(s=>s.id===f.s.id)!;
    source.cells[key(f.table.rows[0],f.columns[4].column)]={value:400};
    const untouched=clone(before),reviewed=syncCodec({kind:'nutrition',before,after}) as {book:Workbook;changed:boolean};
    expect(before).toEqual(untouched);expect(after.foodCapture?.nutritionConflicts).toBeUndefined();expect(reviewed.changed).toBe(true);
    const rows=nutritionReviewRows(reviewed.book);
    expect(rows.map(row=>({kind:row.kind,manual:row.manual,calculated:row.calculated}))).toEqual(expect.arrayContaining([{kind:'draft',manual:'91',calculated:'100'},{kind:'logged',manual:'99',calculated:'200'}]));
    resolveNutritionReview(reviewed.book,rows.map(row=>({row,calculated:row.kind==='logged'})));
    expect(reviewed.book.foodCapture!.foods[0].values.calories).toBe('91');
    expect(reviewed.book.sheets[0].cells[key(f.master.rows[0],f.logColumns[1].column)].value).toBe(50);
    const store=await Store.open(uid());
    try{await store.save(reviewed.book,0,'Incoming mixed choices');expect((await store.load())!.book).toEqual(reviewed.book);}finally{store.close();}
  });
  it.each(['ingredient','loggingTarget'] as const)('rejects a merge that introduces a newly dangling Draft %s',async kind=>{
    const f=nutritionFixture(),base=clone(f.book);delete base.foodCapture;
    const local=clone(base),remote=clone(base),food=addDraftFood(remote,45000);food.values.food='New draft';
    if(kind==='ingredient'){
      food.ingredient={table:f.table.id,row:f.table.rows[0]};
      local.tables.find(table=>table.id===f.table.id)!.rows=[];
    }else{
      food.loggingTarget={sheet:f.log.id,table:f.master.id};
      local.tables=local.tables.filter(table=>table.id!==f.master.id);delete local.sheets[0].mealLog;
    }
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts.some(path=>path.startsWith('structure/dependencies'))).toBe(true);
    expect(merged.local).toEqual(local);expect(merged.remote).toEqual(remote);
    expect(captureData(remote).foods[0].id).toBe(food.id);
  });
});
