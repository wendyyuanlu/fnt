import {describe,expect,it} from 'vitest';
import {blankSheet,createDemo,clone,key,setInput,type Workbook} from '../src/model';
import {workbookDifferences,type WorkbookDifference} from '../src/sync-diff';
import {comparisonBackup} from '../src/sync-comparison';
import {stringifyArchive} from '../src/archive';
const differences=(a:Workbook,b:Workbook)=>[...workbookDifferences(a,b)].filter((value):value is WorkbookDifference=>!!value);

describe('read-only workbook comparison',()=>{
  it('yields through a large unchanged cell region and still finds a difference at the tail',()=>{
    const local=createDemo(),sheet=blankSheet('Invented large comparison',6000,16);
    local.sheets=[sheet];local.tables=[];local.names=[];
    for(let r=0;r<sheet.rows.length;r++)for(let c=0;c<sheet.columns.length;c++)sheet.cells[key(sheet.rows[r].id,sheet.columns[c].id)]={value:r*16+c};
    const remote=clone(local),address=key(sheet.rows.at(-1)!.id,sheet.columns.at(-1)!.id);
    remote.sheets[0].cells[address].note='Tail difference';
    const iterator=workbookDifferences(local,remote);let steps=0,tail:WorkbookDifference|undefined;
    for(const entry of iterator){steps++;if(entry?.kind==='Cell')tail=entry;}
    expect(steps).toBeGreaterThanOrEqual(96000);expect(tail?.location).toContain('P6000');expect(tail?.remote).toContain('Tail difference');
  });
  it('shows exact cell values, formulas, notes and formatting without modifying either workbook',()=>{
    const local=createDemo(),remote=clone(local),s=remote.sheets[0],address=key(s.rows[1].id,s.columns[2].id);
    setInput(remote,s,s.rows[1].id,s.columns[2].id,'=2+3');
    s.cells[address].note='Invented phone note';s.cells[address].format={bold:true};
    const before=[stringifyArchive(local),stringifyArchive(remote)],result=differences(local,remote);
    const change=result.find(entry=>entry.kind==='Cell'&&entry.remote.includes('Invented phone note'))!;
    expect(change.location).toContain(`${s.name}!C2`);
    expect(change.local).toContain('180');expect(change.remote).toContain('Formula: =(2+3)');expect(change.remote).toContain('"bold": true');
    expect([stringifyArchive(local),stringifyArchive(remote)]).toEqual(before);
  });
  it('matches stable cell identities across row and column moves instead of comparing positional addresses',()=>{
    const local=createDemo(),remote=clone(local);
    remote.sheets[0].rows.reverse();remote.sheets[0].columns.reverse();
    const result=differences(local,remote);
    expect(result.filter(entry=>entry.kind==='Cell')).toEqual([]);
    expect(result.filter(entry=>entry.location.endsWith('relative order'))).toHaveLength(2);
  });
  it('shows additions, removals, table definitions and hidden supporting data',()=>{
    const local=createDemo(),remote=clone(local),s=remote.sheets[0],address=key(s.rows[1].id,s.columns[2].id);
    delete s.cells[address];s.cells[key(s.rows[2].id,s.columns[2].id)]={value:'Invented addition',note:'new'};
    remote.tables[0].columns[0].name='Renamed field';
    const support=clone(remote.sheets.at(-1)!);remote.sheets.pop();remote.dropdownData={sheets:[support],tables:[]};
    support.cells[key(support.rows[1].id,support.columns[0].id)]={value:'Hidden supporting change'};
    const result=differences(local,remote);
    expect(result.some(entry=>entry.kind==='Cell'&&entry.remote==='No saved cell')).toBe(true);
    expect(result.some(entry=>entry.remote.includes('Invented addition'))).toBe(true);
    expect(result.some(entry=>entry.remote.includes('Renamed field'))).toBe(true);
    expect(result.some(entry=>entry.remote.includes('Hidden supporting change'))).toBe(true);
    expect(result.some(entry=>entry.location==='DD sheet order')).toBe(true);
  });
  it('does not confuse object key order, undefined fields, revisions or activity counters with content changes',()=>{
    const local=createDemo(),remote=clone(local),s=remote.sheets[0],address=key(s.rows[1].id,s.columns[2].id),cell=s.cells[address];
    s.cells[address]={note:undefined,...Object.fromEntries(Object.entries(cell).reverse())};
    remote.revision+=10;remote.tableActivity={example:{visits:20,editedAt:42}};
    expect(differences(local,remote)).toEqual([]);
  });
  it('reports separately identified workbooks rather than guessing records match by their names',()=>{
    const a=createDemo(),b=createDemo(),result=differences(a,b);
    expect(result.some(entry=>entry.location==='Workbook / id')).toBe(true);
    expect(result.some(entry=>entry.kind==='Cell'&&entry.local==='No saved cell')).toBe(true);
    expect(result.some(entry=>entry.kind==='Cell'&&entry.remote==='No saved cell')).toBe(true);
  });
  it('reads native full backups for comparison without a restore, and rejects invalid backup files',()=>{
    const book=createDemo(),backup={format:'fnt-backup',version:1,state:{book,version:1,pending:[],updated:''},originals:[]};
    expect(comparisonBackup(stringifyArchive(backup))).toEqual(book);
    expect(()=>comparisonBackup(JSON.stringify({book}))).toThrow('Invalid workbook backup');
    expect(()=>comparisonBackup(JSON.stringify({...backup,state:{...backup.state,book:{...book,sheets:[]}}}))).toThrow();
  });
});
