import 'fake-indexeddb/auto';
import {describe,it,expect} from 'vitest';
import {blankSheet,clone,uid,key,addRow,insertColumn,moveRows,deleteRows,deleteColumn,type Workbook} from '../src/model';
import {Store,syncGitHub,SyncConflict,mergeForSync,encode64,type LocalState,type SyncResult,type SyncConfig,type SyncAttempt} from '../src/storage';
import {syncCodec} from '../src/sync-codec';
import {mergeSyncWorkbooks,rebaseSyncHistory,sameSharedWorkbook} from '../src/sync-merge';
import {applyUndo,structuralUndo} from '../src/undo-history';
import {validatedSyncMerge} from '../src/sync-merge-validation';

const config:SyncConfig={owner:'example',repo:'private',branch:'main',path:'coauthoring.json'};
function fixture():Workbook{
  const sheet=blankSheet('Invented coauthoring',6,3);
  const book:Workbook={schema:1,id:uid(),title:'Synthetic only',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:1};
  sheet.cells[key(sheet.rows[1].id,sheet.columns[1].id)]={value:10};
  return book;
}
const edit=(book:Workbook,r:number,c:number,value:number)=>{const s=book.sheets[0];s.cells[key(s.rows[r].id,s.columns[c].id)]={value};book.revision++;};
const cell=(book:Workbook,r=1,c=0)=>{const s=book.sheets[0];return s.cells[key(s.rows[r].id,s.columns[c].id)]?.value;};
const state=(book:Workbook,sha='base',pending=true):LocalState=>({book,version:1,updated:'',sync:config,remoteSha:sha,pending:pending?[{id:uid(),label:'Edit',time:''}]:[]});
class Endpoint{
  sha='base';book:Workbook;operations:string[]=[];receipts:Record<string,string>={};writes=0;attempts=0;races=0;loseAcknowledgement=false;
  beforeWrite?:()=>void;
  constructor(book:Workbook){this.book=clone(book);}
  fetch:typeof fetch=async(input,init)=>{
    if(!String(input).includes('/contents/'))return Response.json({private:true,has_pages:false});
    if(init?.method!=='PUT')return Response.json({sha:this.sha,content:encode64(JSON.stringify({format:'fnt-sync-v1',book:this.book,operations:this.operations,receipts:this.receipts}))});
    this.attempts++;
    this.beforeWrite?.();
    const body=JSON.parse(String(init.body)) as {sha:string;content:string};
    if(this.races-->0){this.sha+='-race';edit(this.book,2,2,this.attempts);}
    if(body.sha!==this.sha)return Response.json({message:'Stale SHA'},{status:409});
    const envelope=syncCodec({kind:'unpack',value:body.content}) as {book:Workbook;operations:string[];receipts:Record<string,string>};
    this.book=envelope.book;this.operations=envelope.operations;this.receipts=envelope.receipts;this.sha=`saved-${++this.writes}`;
    if(this.loseAcknowledgement){this.loseAcknowledgement=false;throw Error('Controlled lost acknowledgement');}
    return Response.json({content:{sha:this.sha}});
  };
}
describe('shared-ancestor coauthoring',()=>{
  it('merges disjoint edits, same-value edits, formatting and simultaneous identity-based insertions in deterministic order',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base);
    edit(local,1,0,2);edit(remote,1,1,30);
    const l=addRow(local,local.sheets[0],2),r=addRow(remote,remote.sheets[0],2);
    local.sheets[0].cells[key(l.id,local.sheets[0].columns[0].id)]={value:'Phone row'};
    remote.sheets[0].cells[key(r.id,remote.sheets[0].columns[0].id)]={value:'Computer row'};
    const merged=await mergeForSync(base,local,remote),reverse=await mergeForSync(base,remote,local);
    expect(merged.conflicts).toEqual([]);expect(sameSharedWorkbook(merged.local,reverse.local)).toBe(true);
    expect(cell(merged.local)).toBe(2);expect(cell(merged.local,1,1)).toBe(30);
    expect(merged.local.sheets[0].rows.map(row=>row.id)).toEqual(expect.arrayContaining([l.id,r.id]));
    expect(merged.local.sheets[0].rows).toHaveLength(8);
    const same=clone(base);edit(same,1,0,2);
    expect((await mergeForSync(base,local,same)).conflicts).toEqual([]);
    const formatted=clone(base),s=formatted.sheets[0],address=key(s.rows[1].id,s.columns[0].id);
    s.cells[address].format={bold:true};
    const result=await mergeForSync(base,local,formatted);
    expect(result.conflicts).toEqual([]);expect(result.local.sheets[0].cells[address]).toEqual({value:2,format:{bold:true}});
  });
  it('merges independent groups and keeps device-specific toolbar, navigation and collapse preferences',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base),s=local.sheets[0];
    local.toolbarOrder=['action:bold','action:italic'];remote.toolbarOrder=['action:italic','action:bold'];
    local.toolbarDividers=['action:italic'];remote.sheetTabCollapsed=['Other'];
    local.tableActivity={local:{visits:2}};remote.tableActivity={remote:{visits:90}};
    local.sheets[0].outlineView={tree:true};
    s.groups.push({id:'local-group',axis:'row',members:s.rows.slice(1,3).map(row=>row.id),label:'Local',collapsed:true});
    remote.sheets[0].groups.push({id:'remote-group',axis:'column',members:s.columns.slice(0,2).map(column=>column.id),label:'Remote',collapsed:false});
    const result=await mergeForSync(base,local,remote);
    expect(result.conflicts).toEqual([]);expect(result.local.sheets[0].groups).toHaveLength(2);
    expect(result.local.toolbarOrder).toEqual(local.toolbarOrder);expect(result.local.toolbarDividers).toEqual(local.toolbarDividers);
    expect(result.local.tableActivity).toEqual(local.tableActivity);expect(result.local.sheetTabCollapsed).toBeUndefined();
    expect(result.local.sheets[0].outlineView).toEqual({tree:true});expect(result.local.sheets[0].groups.find(group=>group.id==='local-group')?.collapsed).toBe(true);
  });
  it.each([false,true])('keeps a simultaneous insertion attached to its preceding row when another device reorders that anchor (%s)',async earlier=>{
    const base=fixture(),local=clone(base),remote=clone(base),rows=base.sheets[0].rows;
    if(earlier)moveRows(local,local.sheets[0],[rows[1].id],0);else moveRows(local,local.sheets[0],[rows[2].id],1);
    const inserted=addRow(remote,remote.sheets[0],2);
    remote.sheets[0].cells[key(inserted.id,remote.sheets[0].columns[0].id)]={value:'Inserted after anchor'};
    const merged=await mergeForSync(base,local,remote),reverse=await mergeForSync(base,remote,local);
    expect(merged.conflicts).toEqual([]);expect(sameSharedWorkbook(merged.local,reverse.local)).toBe(true);
    expect(merged.local.sheets[0].rows.map(row=>row.id)).toEqual([...(earlier?[rows[1].id,inserted.id,rows[0].id,rows[2].id]:[rows[0].id,rows[2].id,rows[1].id,inserted.id]),...rows.slice(3).map(row=>row.id)]);
  });
  it('merges simultaneous table-column insertions, group membership additions and reordered row edits by identity',async()=>{
    const base=fixture(),s=base.sheets[0];
    base.tables.push({id:'table',name:'Invented',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,5).map(row=>row.id),columns:s.columns.map((column,i)=>({id:`field-${i}`,name:`Field ${i}`,column:column.id}))});
    for(const field of base.tables[0].columns)s.cells[key(base.tables[0].header,field.column)]={value:field.name};
    s.groups.push({id:'group',axis:'row',members:[s.rows[1].id],label:'Shared',collapsed:false});
    const local=clone(base),remote=clone(base),ls=local.sheets[0],rs=remote.sheets[0];
    const l=insertColumn(local,ls,1,local.tables[0]),r=insertColumn(remote,rs,1,remote.tables[0]);
    local.tables[0].columns.find(column=>column.column===l.id)!.name='Phone field';
    remote.tables[0].columns.find(column=>column.column===r.id)!.name='Computer field';
    ls.cells[key(s.rows[0].id,l.id)]={value:'Phone field'};rs.cells[key(s.rows[0].id,r.id)]={value:'Computer field'};
    ls.cells[key(s.rows[1].id,l.id)]={value:22};rs.cells[key(s.rows[1].id,r.id)]={value:33};
    ls.groups[0].members.push(s.rows[2].id);rs.groups[0].members.push(s.rows[3].id);
    const merged=await mergeForSync(base,local,remote),reverse=await mergeForSync(base,remote,local);
    expect(merged.conflicts).toEqual([]);expect(sameSharedWorkbook(merged.local,reverse.local)).toBe(true);
    expect(merged.local.tables[0].columns).toHaveLength(5);expect(merged.local.sheets[0].groups[0].members).toHaveLength(3);
    expect(merged.local.sheets[0].cells[key(s.rows[1].id,l.id)]?.value).toBe(22);expect(merged.local.sheets[0].cells[key(s.rows[1].id,r.id)]?.value).toBe(33);
    const moved=clone(base),edited=clone(base);moveRows(moved,moved.sheets[0],[s.rows[3].id],1);edit(edited,2,1,77);
    const reordered=await mergeForSync(base,moved,edited);
    expect(reordered.conflicts).toEqual([]);expect(reordered.local.sheets[0].rows[1].id).toBe(s.rows[3].id);
    expect(reordered.local.sheets[0].cells[key(s.rows[2].id,s.columns[1].id)]?.value).toBe(77);
  });
  it('retains independently created sheets and tables with their original identities',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base);
    for(const [book,label]of [[local,'Phone'],[remote,'Computer']] as const){
      const sheet=blankSheet(label,4,2);book.sheets.push(sheet);
      book.tables.push({id:uid(),name:label,sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1).map(row=>row.id),columns:sheet.columns.map((column,i)=>({id:uid(),column:column.id,name:`Field ${i}`}))});
      sheet.cells[key(sheet.rows[1].id,sheet.columns[0].id)]={value:label};
    }
    const result=await mergeForSync(base,local,remote),reverse=await mergeForSync(base,remote,local);
    expect(result.conflicts).toEqual([]);expect(result.local.tables.map(table=>table.id).sort()).toEqual([local.tables[0].id,remote.tables[0].id].sort());
    expect(result.local.sheets).toHaveLength(3);expect(sameSharedWorkbook(result.local,reverse.local)).toBe(true);
  });
  it('produces two focused conflict variants with every disjoint edit already present, without splitting formula/input state',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base);
    edit(local,1,0,2);edit(local,2,1,44);edit(remote,1,0,3);edit(remote,3,2,55);
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts).toHaveLength(1);
    expect(cell(merged.local)).toBe(2);expect(cell(merged.remote)).toBe(3);
    for(const variant of [merged.local,merged.remote]){expect(cell(variant,2,1)).toBe(44);expect(cell(variant,3,2)).toBe(55);}
    const formula=clone(base),s=formula.sheets[0];
    s.cells[key(s.rows[1].id,s.columns[0].id)]={formula:{kind:'literal',value:5},original:'=5'};
    const collision=await mergeForSync(base,local,formula);
    expect(collision.conflicts).toHaveLength(1);
    expect(collision.local.sheets[0].cells[key(s.rows[1].id,s.columns[0].id)]).toEqual({value:2});
    expect(collision.remote.sheets[0].cells[key(s.rows[1].id,s.columns[0].id)]).toEqual({formula:{kind:'literal',value:5},original:'=5'});
  });
  it('merges clearing input with concurrent formatting, and treats missing/null input as the same blank without dropping meaningful values',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base),s=base.sheets[0],address=key(s.rows[1].id,s.columns[0].id);
    delete local.sheets[0].cells[address];remote.sheets[0].cells[address].format={bold:true};
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts).toEqual([]);expect(merged.local.sheets[0].cells[address]).toEqual({format:{bold:true}});
    remote.sheets[0].cells[address]={value:null};
    expect((await mergeForSync(base,local,remote)).conflicts).toEqual([]);
    for(const value of [0,false,'']){
      remote.sheets[0].cells[address]={value};
      const collision=await mergeForSync(base,local,remote);
      expect(collision.conflicts).toHaveLength(1);expect(collision.remote.sheets[0].cells[address].value).toBe(value);
    }
  });
  it.each(['row','column'] as const)('protects %s deletion against concurrent cell edits and retains both valid originals',async axis=>{
    const base=fixture(),local=clone(base),remote=clone(base);edit(remote,1,0,3);
    if(axis==='row')deleteRows(local,local.sheets[0],[local.sheets[0].rows[1].id]);
    else deleteColumn(local,local.sheets[0],local.sheets[0].columns[0].id);
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts.length).toBeGreaterThan(0);
    expect(merged.local).toEqual(local);expect(merged.remote).toEqual(remote);
  });
  it('refuses newly broken formula/table dependencies instead of uploading an invalid automatic merge',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base),s=remote.sheets[0],removed=s.rows[2].id;
    deleteRows(local,local.sheets[0],[removed]);
    s.cells[key(s.rows[3].id,s.columns[2].id)]={formula:{kind:'ref',sheet:s.id,row:removed,column:s.columns[0].id,absCol:false,absRow:false}};
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts.some(path=>path.startsWith('structure/dependencies'))).toBe(true);
  });
  it('merges compatible row deletion and independent edits without resurrecting deleted content',async()=>{
    const base=fixture(),local=clone(base),remote=clone(base);deleteRows(local,local.sheets[0],[local.sheets[0].rows[3].id]);edit(remote,1,1,30);
    const merged=await mergeForSync(base,local,remote);
    expect(merged.conflicts).toEqual([]);expect(merged.local.sheets[0].rows).toHaveLength(5);expect(cell(merged.local,1,1)).toBe(30);
  });
  it('rebases Undo/Redo by identity across remote row insertions without undoing remote data',()=>{
    const base=fixture(),local=clone(base);edit(local,1,0,2);
    const remote=clone(local),row=addRow(remote,remote.sheets[0],1);remote.sheets[0].cells[key(row.id,remote.sheets[0].columns[2].id)]={value:77};
    const history=rebaseSyncHistory(local,remote,{undo:[structuralUndo(base,local)],redo:[]},validatedSyncMerge);
    const undone=applyUndo(remote,history.undo[0]).book;
    expect(undone.sheets[0].rows.map(row=>row.id)).toContain(row.id);
    expect(undone.sheets[0].cells[key(row.id,remote.sheets[0].columns[2].id)].value).toBe(77);
    expect(undone.sheets[0].cells[key(base.sheets[0].rows[1].id,base.sheets[0].columns[0].id)].value).toBe(1);
  });
  it('does not rebase structural Undo into an orphaned cell when another device edited the newly created row',async()=>{
    const base=fixture(),local=clone(base),row=addRow(local,local.sheets[0],2),column=local.sheets[0].columns[0].id;
    local.sheets[0].cells[key(row.id,column)]={value:2};
    const remote=clone(local);remote.sheets[0].cells[key(row.id,column)]={value:3};
    const history=syncCodec({kind:'history',before:local,after:remote,history:{undo:[structuralUndo(base,local)],redo:[]}}) as ReturnType<typeof rebaseSyncHistory>;
    const undone=applyUndo(remote,history.undo[0]).book;
    expect(undone.sheets[0].rows.some(candidate=>candidate.id===row.id)).toBe(true);
    expect(undone.sheets[0].cells[key(row.id,column)]?.value).toBe(3);
    expect((await mergeForSync(undone,undone,undone)).conflicts).toEqual([]);
  });
});
describe('GitHub CAS convergence and durable ancestry',()=>{
  it('acknowledges preference-only journals and identical concurrent inputs without replacing the local model or writing a commit',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);local.toolbarOrder=['action:italic','action:bold'];
    const current=state(local),preferences=await syncGitHub(current,'invented',endpoint.fetch,[],{base});
    expect(preferences.remote).toBeUndefined();expect(preferences.acknowledged).toEqual(current.pending.map(operation=>operation.id));expect(endpoint.writes).toBe(0);
    edit(local,1,0,2);edit(endpoint.book,1,0,2);endpoint.sha='concurrent';
    const identical=await syncGitHub(state(local),'invented',endpoint.fetch,[],{base});
    expect(identical.remote).toBeUndefined();expect(endpoint.writes).toBe(0);
  });
  it.each([false,true])('uses durable transfer proof after a lost acknowledgement and journal trimming, without hiding a real collision (%s)',async collision=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);
    let attempt:SyncAttempt|undefined;const beforeUpload=async(transfer:SyncAttempt)=>{attempt=clone(transfer);};
    endpoint.loseAcknowledgement=true;
    await expect(syncGitHub(state(local),'invented',endpoint.fetch,[],{base,beforeUpload})).rejects.toThrow('lost acknowledgement');
    expect(attempt?.book).toEqual(local);expect(cell(endpoint.book)).toBe(2);
    const newer=clone(local);edit(newer,1,0,3);
    endpoint.operations=[];edit(endpoint.book,1,1,90);endpoint.sha='newer-computer';
    if(collision)edit(endpoint.book,1,0,4);
    const retry=syncGitHub(state(newer),'invented',endpoint.fetch,[],{base,attempt,beforeUpload});
    if(collision){
      const conflict=await retry.catch(error=>error);
      expect(conflict).toBeInstanceOf(SyncConflict);expect(cell(conflict.local)).toBe(3);expect(cell(conflict.remote)).toBe(4);
      expect(cell(conflict.local,1,1)).toBe(90);expect(endpoint.writes).toBe(1);
    }else{
      await retry;expect(cell(endpoint.book)).toBe(3);expect(cell(endpoint.book,1,1)).toBe(90);
    }
  });
  it('retains the proven attempted ancestor when later uncommitted attempts exhaust the CAS limit',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);
    let attempt:SyncAttempt|undefined;const beforeUpload=async(transfer:SyncAttempt)=>{attempt=clone(transfer);};
    endpoint.loseAcknowledgement=true;
    await expect(syncGitHub(state(local),'invented',endpoint.fetch,[],{base,beforeUpload})).rejects.toThrow('lost acknowledgement');
    const provenId=attempt!.id,newer=clone(local);edit(newer,1,0,3);endpoint.races=3;
    await expect(syncGitHub(state(newer),'invented',endpoint.fetch,[],{base,attempt,beforeUpload})).rejects.toThrow('kept changing');
    expect(attempt!.ancestor?.id).toBe(provenId);
    endpoint.operations=[];
    await syncGitHub(state(newer),'invented',endpoint.fetch,[],{base,attempt,beforeUpload});
    expect(cell(endpoint.book)).toBe(3);expect(cell(endpoint.book,2,2)).toBe(4);expect(endpoint.writes).toBe(2);
  });
  it('never sends a PUT when durable transfer-receipt persistence fails',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);
    const current=state(local);
    await expect(syncGitHub(current,'invented',endpoint.fetch,[],{base,beforeUpload:async()=>{throw Error('Controlled storage failure');}})).rejects.toThrow('Controlled storage failure');
    expect(endpoint.attempts).toBe(0);expect(endpoint.book).toEqual(base);expect(current.pending).toHaveLength(1);
  });
  it('retries refetch/remerge races, unions remote operations and acknowledges only captured IDs',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);edit(endpoint.book,1,1,30);endpoint.sha='remote';endpoint.operations=['other-device'];
    endpoint.races=1;
    const current=state(local),result=await syncGitHub(current,'invented',endpoint.fetch,[],{base});
    expect(endpoint.attempts).toBe(2);expect(endpoint.writes).toBe(1);
    expect(result.acknowledged).toEqual(current.pending.map(operation=>operation.id));
    expect(endpoint.operations).toEqual(expect.arrayContaining(['other-device',...result.acknowledged!]));
    expect(cell(endpoint.book)).toBe(2);expect(cell(endpoint.book,1,1)).toBe(30);expect(cell(endpoint.book,2,2)).toBe(1);
    expect(result.remote).toEqual(endpoint.book);
  });
  it('bounds contention without pretending an upload succeeded or clearing pending changes',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);endpoint.races=9;
    const current=state(local);
    await expect(syncGitHub(current,'invented',endpoint.fetch,[],{base})).rejects.toThrow('kept changing');
    expect(endpoint.attempts).toBe(3);expect(endpoint.writes).toBe(0);expect(current.pending).toHaveLength(1);
  });
  it('keeps divergent same-cell changes and remote versions recoverable without a PUT',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);edit(endpoint.book,1,0,3);endpoint.sha='remote';
    const error=await syncGitHub(state(local),'invented',endpoint.fetch,[],{base}).catch(error=>error);
    expect(error).toBeInstanceOf(SyncConflict);expect(error.conflicts).toHaveLength(1);
    expect(cell(error.local)).toBe(2);expect(cell(error.remote)).toBe(3);expect(endpoint.attempts).toBe(0);
  });
  it('does not fabricate ancestry for old divergent clients; bootstraps known revisions and identical lost acknowledgements',async()=>{
    const base=fixture(),local=clone(base),endpoint=new Endpoint(base);edit(local,1,0,2);edit(endpoint.book,1,1,30);endpoint.sha='remote';
    await expect(syncGitHub(state(local),'invented',endpoint.fetch)).rejects.toBeInstanceOf(SyncConflict);
    endpoint.sha='base';endpoint.book=clone(base);
    const result=await syncGitHub(state(local),'invented',endpoint.fetch);
    expect(result.sha).toBe('saved-1');expect(cell(endpoint.book)).toBe(2);
    const retry=await syncGitHub(state(clone(endpoint.book),'base'),'invented',endpoint.fetch);
    expect(retry.sha).toBe('saved-1');expect(endpoint.writes).toBe(1);
  });
  it('persists destination-scoped ancestry and incoming changes atomically, retaining newer edits, attachments and recovery',async()=>{
    const name=uid(),store=await Store.open(name),base=fixture(),endpoint=new Endpoint(base);
    try{
      let saved=await store.save(base,0,'Initial');
      saved=await store.metadata(saved.version,s=>({...s,sync:config,remoteSha:'base',pending:[]}));
      const current=clone(base);edit(current,1,0,2);saved=await store.save(current,saved.version,'Phone');
      const captured=saved.pending.map(operation=>operation.id);
      const result=await syncGitHub(saved,'invented',endpoint.fetch,[],{base});
      const newer=clone(current);edit(newer,1,1,70);saved=await store.save(newer,saved.version,'Newer in flight');
      const metadata=await store.syncMetadata(saved.version,{sha:result.sha,acknowledged:result.acknowledged,confirmed:result.confirmed});
      saved={...saved,...metadata};
      expect(saved.pending.some(operation=>captured.includes(operation.id))).toBe(false);expect(saved.pending.map(operation=>operation.label)).toEqual(['Newer in flight']);
      store.close();const reopened=await Store.open(name);
      try{
        expect(await reopened.syncBase(config,result.sha)).toEqual(result.confirmed);
        expect(await reopened.syncBase({...config,path:'other.json'},result.sha)).toBeUndefined();
        expect(await reopened.syncBase(config,'wrong')).toBeUndefined();
        const remote=clone(endpoint.book);edit(remote,3,2,55);
        const merged=mergeSyncWorkbooks(result.confirmed!,saved.book,remote);
        const receipt:SyncResult={sha:'received',confirmed:remote,remote:merged.local,originals:[{id:'attachment',name:'Invented.xlsx',data:'aW52ZW50ZWQ='}],acknowledged:[]};
        await reopened.visit(saved.book.id,'table',0);
        const accepted=await reopened.acceptSync(saved.version,config,receipt,merged.local,{undo:[],redo:[]});
        expect(cell(accepted.book,1,1)).toBe(70);expect(cell(accepted.book,3,2)).toBe(55);
        expect(accepted.pending.filter(operation=>operation.label!=='Visit table')).toEqual(saved.pending);expect(accepted.book.tableActivity?.table.visits).toBe(1);
        expect(await reopened.syncBase(config,'received')).toEqual(remote);
        expect((await reopened.originals()).map(original=>original.id)).toContain('attachment');
        expect((await reopened.history()).some(copy=>copy.label==='Before incoming sync changes'&&cell(copy.book,1,1)===70)).toBe(true);
        await expect(reopened.acceptSync(saved.version,config,receipt,merged.local)).rejects.toThrow('Another tab');
      }finally{reopened.close();}
    }finally{store.close();}
  });
});
