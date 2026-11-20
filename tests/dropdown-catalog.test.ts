import 'fake-indexeddb/auto';
import { expect,it } from 'vitest';
import { dropdownCatalog,seedDropdownCatalog } from '../src/dropdown-catalog';
import { clone,createDemo,getCell,key,uid } from '../src/model';
import { createReference,referenceChoices,referenceTable,renameReferenceValue } from '../src/references';
import { Store,validateBackup } from '../src/storage';
import { parseArchive,stringifyArchive } from '../src/archive';

it('seeds the actual seven catalogs, exact labels and both kinds of blank without replacing logs',()=>{
  const before=createDemo(),copy=clone(before),{book}=seedDropdownCatalog(before);
  const expected=[
    ['Seasoning','Staple','Whole','Premade'],[null,'Spotting','Yes'],
    ['🐔 Chicken','🦃 Turkey','🐮 Beef','🐷 Pork'],['🍦 Snack',' '],
    ['Taiwan','Japan','Canada','USA'],['Savoury','Sweet','Mixed'],
    ['Chocolate','Gummy','Chip/Noodle','Cookie','Pastry','Biscuit','Bread','Pudding/Custard']
  ];
  expect(before).toEqual(copy);expect(book.id).toBe(before.id);
  expect(book.sheets.slice(0,4)).toEqual(before.sheets);
  book.references!.forEach((source,i)=>{
    const{table,sheet}=referenceTable(book,source);
    expect(table.columns[0].name).toBe(dropdownCatalog.lists[i].field);
    expect(table.rows.map(row=>getCell(sheet,row,table.columns[0].column).value)).toEqual(expected[i]);
  });
  expect(referenceChoices(book,book.references![1]).map(c=>c.value)).toEqual(['Spotting','Yes']);
  expect(book.references).toHaveLength(7);
  expect(seedDropdownCatalog(book)).toMatchObject({changed:false});
});
it('keeps custom same-named sources separate, preserves edits, archives, bindings and deliberate removals on repeat startup',()=>{
  const before=createDemo(),custom=createReference(before,'IngredientType'),{table,sheet}=referenceTable(before,custom);
  table.name='IngredientType';const copy=clone(before);
  const seeded=seedDropdownCatalog(before).book;
  expect(seeded.references!.find(r=>r.id===custom.id)).toEqual(custom);
  expect(seeded.sheets.find(s=>s.id===sheet.id)!.cells).toMatchObject(copy.sheets.find(s=>s.id===sheet.id)!.cells);
  expect(seeded.references!.find(r=>r.catalog?.table==='IngredientType')!.name).toBe('IngredientType_2');
  const source=seeded.references!.find(r=>r.catalog?.table==='AnimalType')!,choice=referenceChoices(seeded,source)[1];
  renameReferenceValue(seeded,source,choice.row,'User-edited option');
  source.archivedRows.push(choice.row);
  seeded.sheets[0].cells[key(seeded.sheets[0].rows[2].id,seeded.sheets[0].columns[0].id)]={binding:choice.binding};
  seeded.references=seeded.references!.filter(r=>r.catalog?.table!=='SnackCountry');
  const edited=clone(seeded);
  expect(seedDropdownCatalog(seeded).book).toEqual(edited);
  expect(seedDropdownCatalog(seeded).changed).toBe(false);
});
it('deduplicates explicitly verified original sources without touching edited values or archived identities',()=>{
  const seeded=seedDropdownCatalog(createDemo()).book,source=seeded.references![0],choice=referenceChoices(seeded,source)[0];
  delete seeded.catalogMigrations;
  for(const r of seeded.references!){r.origin={original:'verified-original',table:r.catalog!.table};delete r.catalog;}
  renameReferenceValue(seeded,source,choice.row,'Edited original');source.archivedRows.push(choice.row);
  const before=clone(seeded),result=seedDropdownCatalog(seeded,new Set(['verified-original'])).book;
  expect(result.references).toHaveLength(7);
  expect(result.sheets).toEqual(before.sheets);expect(result.tables).toEqual(before.tables);
  expect(result.references![0].archivedRows).toEqual([choice.row]);
  expect(result.references![0].id).toBe(source.id);
});
it('archives the exact old state and keeps pending IDs and sync settings through migration, reload and native recovery',async()=>{
  const store=await Store.open(uid()),first=await store.save(createDemo(),0,'Existing edits');
  const prior=await store.metadata(first.version,s=>({...s,sync:{owner:'example',repo:'data',branch:'main',path:'book.json'},remoteSha:'old-sha'}));
  const recovery=stringifyArchive(await store.backup(prior)),result=seedDropdownCatalog(prior.book);
  const saved=await store.save(result.book,prior.version,'Add original Dropdowns catalogs',true,undefined,{recoveryArchive:recovery});
  expect(saved.pending.slice(0,-1)).toEqual(prior.pending);expect(saved.sync).toEqual(prior.sync);expect(saved.remoteSha).toBe(prior.remoteSha);
  expect((await store.history())[0].backup).toBe(recovery);
  expect((await store.load())!.book).toEqual(saved.book);
  const archive=parseArchive(stringifyArchive(await store.backup(saved))) as Awaited<ReturnType<Store['backup']>>;
  validateBackup(archive);const restored=await store.restore(archive,saved.version);
  expect(restored.book).toEqual(saved.book);expect(seedDropdownCatalog(restored.book).changed).toBe(false);
  store.close();
});
