import {expect,it} from 'vitest';
import {applyUndo,capturePatch,editSnapshot,patchDifference,structuralUndo} from '../src/undo-history';
import {clone,createDemo,getCell,insertColumn,key,renameColumn,setInput} from '../src/model';
import {Engine} from '../src/formula';

it('captures shared formula graphs independently and replays independently editable cells',()=>{
  const book=createDemo(),s=book.sheets[0],first=s.rows[1].id,second=s.rows[2].id,column=s.columns[0].id;
  setInput(book,s,first,column,'=2*3');
  s.cells[key(second,column)]={...getCell(s,first,column)};
  const paths=[first,second].map(row=>['sheets',0,'cells',key(row,column)]),history=capturePatch(book,paths);
  const ast=getCell(s,first,column).formula!;
  if(ast.kind!=='binary'||ast.left.kind!=='literal')throw Error('Expected binary formula');
  ast.left.value=9;
  const restored=applyUndo(book,history).book,engine=new Engine(restored);
  expect(engine.cell(s.id,first,column)).toBe(6);expect(engine.cell(s.id,second,column)).toBe(6);
  setInput(restored,restored.sheets[0],first,column,'=7');
  expect(new Engine(restored).cell(s.id,second,column)).toBe(6);
  expect(new Engine(applyUndo(restored,history).book).cell(s.id,first,column)).toBe(6);
  expect(new Engine(book).cell(s.id,first,column)).toBe(27);
});

it('roundtrips structural edits without snapshotting unchanged formula cells',()=>{
  const before=createDemo(),after=clone(before),table=after.tables[0],sheet=after.sheets.find(sheet=>sheet.id===table.sheet)!;
  renameColumn(after,table,table.columns[0].id,'Renamed field');
  insertColumn(after,sheet,1);
  const entry=structuralUndo(before,after);
  expect('patch'in entry&&entry.patch.some(change=>change.path.includes('cells'))).toBe(true);
  expect(JSON.stringify(entry).length).toBeLessThan(JSON.stringify(before).length);
  const undone=applyUndo(after,entry);expect(undone.book).toEqual(before);
  expect(applyUndo(undone.book,undone.inverse).book).toEqual(after);
});

it('stores no unchanged formula arrays and does not mutate live data on a failed replay',()=>{
  const before=createDemo(),after=clone(before);after.title='Another title';
  const entry=structuralUndo(before,after);
  expect('patch'in entry&&entry.patch).toEqual([{path:['title'],exists:true,value:before.title}]);
  expect(()=>applyUndo(after,{patch:[{path:['missing','title'],exists:true,value:'broken'}]})).toThrow(/does not match/);
  expect(after.title).toBe('Another title');
});

it('replays scoped metadata atomically while retaining unrelated cells and immutable history',()=>{
  const book=createDemo(),s=book.sheets[0],cells=s.cells,original=clone(book);
  const before=capturePatch(book,[['title'],['sheets',0,'outlineView']]);
  book.title='Changed';s.outlineView={tree:true};
  const after=clone(book),undone=applyUndo(book,before);
  expect(undone.book).toEqual(original);expect(undone.book.sheets[0].cells).toBe(cells);
  expect(applyUndo(undone.book,undone.inverse).book).toEqual(after);
  expect(book).toEqual(after);
  expect(()=>applyUndo(book,{patch:[{path:['title'],exists:true,value:'Bad'},{path:['sheets',0,'__proto__'],exists:true,value:{}}]})).toThrow(/Invalid undo/);
  expect(book).toEqual(after);
});

it('keeps edit rollback snapshots independent when commands replace cells and references',()=>{
  const book=createDemo(),original=clone(book),before=editSnapshot(book),table=book.tables[0],s=book.sheets.find(s=>s.id===table.sheet)!;
  const row=table.rows[0],column=table.columns[0].column,unchanged=getCell(s,table.rows[1],column);
  setInput(book,s,row,column,'New ingredient');renameColumn(book,table,table.columns[0].id,'Food');
  expect(before).toEqual(original);
  expect(before.sheets.find(old=>old.id===s.id)!.cells[key(table.rows[1],column)]).toBe(unchanged);
  const entry=structuralUndo(before,book),undone=applyUndo(book,entry);
  expect(undone.book).toEqual(before);expect(applyUndo(undone.book,undone.inverse).book).toEqual(book);
});

it('copies only the affected cell dictionary on cell Undo and preserves input on partial failure',()=>{
  const book=createDemo(),s=book.sheets[0],row=s.rows[0].id,column=s.columns[0].id;
  const entry={cells:[{sheet:s.id,key:key(row,column),value:{value:'Restored'}}]};
  const undone=applyUndo(book,entry);
  expect(undone.book.sheets[1]).toBe(book.sheets[1]);expect(undone.book.sheets[0].cells).not.toBe(s.cells);
  expect(getCell(s,row,column).value).not.toBe('Restored');
  const before=clone(book);
  expect(()=>applyUndo(book,{cells:[...entry.cells,{sheet:'missing',key:key(row,column),value:{value:'Bad'}}]})).toThrow(/no longer exists/);
  expect(book).toEqual(before);
});

it('roundtrips appended and removed array entries in both journal directions',()=>{
  const before=createDemo(),after=clone(before),s=after.sheets[0];
  const paths=[['sheets',0,'groups']] as (string|number)[][];
  const first=capturePatch(before,paths);
  s.groups.push({id:'new-group',kind:'range',axis:'row',members:[s.rows[0].id],collapsed:true,label:'New group'});
  const last=capturePatch(after,paths),undo=patchDifference(first,last),forward=patchDifference(last,first);
  expect(applyUndo(after,undo).book).toEqual(before);
  expect(applyUndo(before,forward).book).toEqual(after);
  const restored=applyUndo(after,undo);
  expect(applyUndo(restored.book,restored.inverse).book).toEqual(after);
  const removed=clone(after);removed.sheets[0].groups.pop();
  const removal=structuralUndo(after,removed),back=applyUndo(removed,removal);
  expect(back.book).toEqual(after);expect(applyUndo(back.book,back.inverse).book).toEqual(removed);
});
