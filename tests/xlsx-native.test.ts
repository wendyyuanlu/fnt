import { describe,expect,it } from 'vitest';
import { strToU8,unzipSync,zipSync } from 'fflate';
import { createDemo,key } from '../src/model';
import { exportXlsx } from '../src/xlsx-export';
import { inspectNative,manifestPart,nativePart,readNativeBackup } from '../src/xlsx-native';
import { recoverXlsxBackup } from '../src/xlsx';
import type { Backup } from '../src/storage';

const fixture=():Backup=>({format:'fnt-backup',version:1,state:{book:createDemo(),version:1,pending:[{id:'pending-edit',label:'Invented edit',time:'now'}],updated:'now'},originals:[]});
describe('native Excel recovery archive',()=>{
  it('detects changed projection parts and additions without applying the stale snapshot',async()=>{
    const backup=fixture(),parts=unzipSync(await exportXlsx(backup));
    expect((await inspectNative(parts,10*1048576)).backup).toEqual(backup);
    parts['xl/worksheets/sheet1.xml']=strToU8('<worksheet>Edited externally</worksheet>');
    expect(await inspectNative(parts,10*1048576)).toEqual({status:'changed'});
    expect(await readNativeBackup(parts)).toEqual(backup);
    const extra=unzipSync(await exportXlsx(backup));extra['external-part.xml']=strToU8('<external/>');
    expect(await inspectNative(extra,10*1048576)).toEqual({status:'changed'});
  });
  it('refuses corrupt, missing and over-budget embedded archives instead of returning partial data',async()=>{
    const parts=unzipSync(await exportXlsx(fixture()));
    await expect(readNativeBackup(parts,100)).rejects.toThrow('safe import limit');
    parts[nativePart]=Uint8Array.of(1,2,3);
    await expect(inspectNative(parts,10*1048576)).rejects.toThrow('integrity');
    await expect(recoverXlsxBackup(zipSync(parts).buffer as ArrayBuffer)).rejects.toThrow('integrity');
    delete parts[nativePart];delete parts[manifestPart];
    expect(await inspectNative(parts,100)).toEqual({status:'missing'});
    await expect(readNativeBackup(parts)).rejects.toThrow('manifest');
  });
  it('refuses invalid native journals and missing originals before generating an export',async()=>{
    const backup=fixture();backup.state.pending.push(backup.state.pending[0]);
    await expect(exportXlsx(backup)).rejects.toThrow('journal');
    backup.state.pending.pop();backup.state.book.importReport={entries:[],formulaCount:0,unsupported:{},originalId:'missing'};
    await expect(exportXlsx(backup)).rejects.toThrow('original');
    delete backup.state.book.importReport;
    backup.state.book.references=[{id:crypto.randomUUID(),name:'Imported supporting source',kind:'derived',archivedRows:[],origin:{original:'missing-source'}}];
    await expect(exportXlsx(backup)).rejects.toThrow('supporting source original');
  });
  it('refuses text truncation, invalid sheet names and table headers without changing the source',async()=>{
    for(const kind of ['text','sheet','header'] as const){
      const backup=fixture(),book=backup.state.book,sheet=book.sheets[0],table=book.tables.find(t=>t.sheet===sheet.id)!;
      if(kind==='text')sheet.cells[key(sheet.rows[20].id,sheet.columns[0].id)]={value:'x'.repeat(32768)};
      else if(kind==='sheet')sheet.name='Invalid/Excel';
      else sheet.cells[key(table.header,table.columns[0].column)]={value:'Inconsistent table header'};
      const before=structuredClone(backup);
      await expect(exportXlsx(backup)).rejects.toThrow(kind==='text'?'32,767':kind==='sheet'?'sheet names':'headers');
      expect(backup).toEqual(before);
    }
  });
});
