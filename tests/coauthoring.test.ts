import 'fake-indexeddb/auto';
import {describe,expect,it,vi} from 'vitest';
import {blankSheet,clone,uid,key,addRow,deleteRows,type Workbook} from '../src/model';
import {Store,syncGitHub,SyncConflict,mergeForSync,encode64,type LocalState,type SyncAttempt} from '../src/storage';
import {syncCodec} from '../src/sync-codec';
import {sameSharedWorkbook} from '../src/sync-merge';
import {applyUndo,structuralUndo,type UndoHistory} from '../src/undo-history';
import {addDraftFood,captureData} from '../src/food-capture';
import {nutritionReviewRows,resolveNutritionReview} from '../src/ingredient-edit';

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
  constructor(book:Workbook){this.book=clone(book);}
  fetch:typeof fetch=async(input,init)=>{
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
