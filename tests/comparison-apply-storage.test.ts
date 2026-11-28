import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {clone,createDemo,uid} from '../src/model';
import {Store} from '../src/storage';
import {compressArchive,readArchive} from '../src/archive';
import {applyUndo,structuralUndo} from '../src/undo-history';

it('atomically preserves pre-apply recovery and undo while pausing the existing private connection across reopen',async()=>{
  const name=uid(),store=await Store.open(name),left=createDemo(),right=clone(left),config={owner:'example',repo:'private',branch:'main',path:'book.json'};
  right.title='Selected workbook';
  try{
    let state=await store.save(left,0,'Initial');
    state=await store.metadata(state.version,s=>({...s,sync:config,remoteSha:'old'}));
    const before=await store.backup(state),inverse=structuralUndo(left,right);
    await store.checkpoint('Left source',left,[],true);await store.checkpoint('Right source',right,[],true);
    const recoveryArchive=JSON.stringify({format:'fnt-compressed-v1',payload:compressArchive(before)});
    state=await store.save(right,state.version,'Apply comparison selections',true,undefined,{pauseSync:true,recoveryArchive,undoHistory:{undo:[inverse],redo:[]}});
    const reopened=await Store.open(name);
    try{
      const loaded=(await reopened.load())!;
      expect(loaded.sync).toEqual(config);expect(loaded.syncPaused).toBe(true);expect(loaded.remoteSha).toBe('old');
      expect(loaded.book.title).toBe('Selected workbook');
      const history=await reopened.history();
      expect(history.some(entry=>entry.book.title===left.title&&!!entry.backup)).toBe(true);
      expect(await readArchive(history.find(entry=>entry.backup)!.backup!)).toEqual(before);
      expect(history.filter(entry=>entry.label.endsWith('source'))).toHaveLength(2);
      const undo=(await reopened.undoHistory(loaded.version,loaded.book.id))!;expect(undo.undo).toHaveLength(1);
      expect(applyUndo(loaded.book,undo.undo[0]).book).toEqual(left);
    }finally{reopened.close();}
    await expect(store.save(left,before.state.version,'Stale apply')).rejects.toThrow('Another tab');
    expect((await store.load())!.book).toEqual(right);
    const synced=await store.save(right,state.version,'Explicit sync selection',false,undefined,{comparisonSync:{config:{...config,path:'renamed.json'},sha:'fresh'}});
    expect(synced.syncPaused).toBe(false);expect(synced.remoteSha).toBe('fresh');expect(synced.sync?.path).toBe('renamed.json');
  }finally{store.close();}
});
