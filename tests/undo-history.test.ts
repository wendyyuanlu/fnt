import {expect,it} from 'vitest';
import {applyUndo,structuralUndo} from '../src/undo-history';
import {clone,createDemo,insertColumn,renameColumn} from '../src/model';

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
