import assert from 'node:assert/strict';
import {it} from 'vitest';
import {blankSheet,key,type Workbook} from '../src/model';
import {align,compare,scopes,chunks,axisChoices,hasAxisCellPeers,anchorLabel,anchorMismatchLabel} from '../prototypes/comparison/comparison-model';

function fixture():Workbook{
  const s=blankSheet('Invented',30,10);
  return{schema:1,id:'same-workbook',title:'Invented fixture',revision:0,sheets:[s],tables:[
    {id:'one',name:'First',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,20).map(r=>r.id),columns:s.columns.slice(0,3).map((c,i)=>({id:`first-${i}`,column:c.id,name:`Field ${i}`}))},
    {id:'two',name:'Second',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,20).map(r=>r.id),columns:s.columns.slice(4,7).map((c,i)=>({id:`second-${i}`,column:c.id,name:`Field ${i}`}))},
  ],names:[],pickerSources:{}};
}
it('aligns stable identities and retains the left ordering for moved rows',()=>{
  assert.deepEqual(align(['a','b','c'],['x','a','y','b','c','z']),['x','a','y','b','c','z']);
  assert.deepEqual(align(['a','b','c'],['c','a','b']),['a','b','c']);
});
it('collects every same-axis cell conflict across tables, excluding broader changes and other sheets',async()=>{
  const a=fixture(),b=structuredClone(a),s=a.sheets[0],other=b.sheets[0];
  const row=s.rows[5].id,column=s.columns[1].id,adjacent=s.columns[5].id,later=s.rows[10].id;
  for(const [r,c]of [[row,column],[row,adjacent],[later,column]]){
    s.cells[key(r,c)]={value:1};other.cells[key(r,c)]={value:2};
  }
  other.cells[key(row,column)].format={bold:true};
  other.groups.push({id:'wide',axis:'row',kind:'range',members:[row,later],collapsed:false,table:'one',label:'Invented wide group'});
  b.tables[0].name='Renamed';
  other.rows.splice(10,0,other.rows.splice(5,1)[0]);
  const differences=await compare(a,b);
  const unrelated={...differences.find(d=>d.address===key(row,column))!,id:1000,sheet:'another-sheet'};
  const all=[...differences,unrelated],rows=axisChoices(all,s.id,'row',row),columns=axisChoices(all,s.id,'column',column);
  assert.equal(rows.targets.filter(d=>d.address===key(row,column)).length,2);
  assert.ok(rows.targets.some(d=>d.table==='two'));
  assert.ok(!rows.targets.some(d=>d.rows.includes(later)||d===unrelated));
  assert.ok(rows.excluded.some(d=>d.label==='Group added or removed'));
  assert.equal(columns.targets.filter(d=>d.address).length,3);
  assert.ok(!columns.targets.some(d=>d.columns.includes(adjacent)||d===unrelated));
  const header=axisChoices(all,s.id,'row',s.rows[0].id);
  assert.ok(!header.targets.some(d=>d.label==='Table renamed'));
  assert.ok(header.excluded.some(d=>d.label==='Table renamed'));
  assert.deepEqual(axisChoices(all,s.id,'row',undefined),{targets:[],excluded:[]});
  assert.ok(hasAxisCellPeers(all,s.id,{row,column}));
  assert.ok(hasAxisCellPeers(all,s.id,{column}));
  const singleCell=all.filter(d=>d.address===key(row,column));
  assert.equal(singleCell.filter(d=>d.sheet===s.id).length,2);
  assert.ok(!hasAxisCellPeers(singleCell,s.id,{row,column}));
  assert.ok(!hasAxisCellPeers(all,s.id,{}));
});
it('retains missing-row conflicts under the same stable row identity in both directions',async()=>{
  const a=fixture(),s=a.sheets[0],row=s.rows[5].id,column=s.columns[1].id;
  s.cells[key(row,column)]={value:'Invented removed row'};
  const b=structuredClone(a);b.sheets[0].rows=b.sheets[0].rows.filter(r=>r.id!==row);delete b.sheets[0].cells[key(row,column)];
  for(const table of b.tables)table.rows=table.rows.filter(id=>id!==row);
  for(const [left,right]of [[a,b],[b,a]]){
    const differences=await compare(left,right),selection=axisChoices(differences,s.id,'row',row);
    assert.ok(selection.targets.some(d=>d.label==='Added or removed cell'));
    assert.ok(selection.targets.some(d=>d.label.startsWith('Row only')));
    assert.ok(selection.excluded.some(d=>d.label==='Table row membership / order changed'));
  }
});
it('separates table changes from adjacent tables and outside-table cells',async()=>{
  const a=fixture(),b=structuredClone(a),s=b.sheets[0];
  s.cells[key(s.rows[5].id,s.columns[1].id)]={value:'Changed'};
  s.cells[key(s.rows[5].id,s.columns[5].id)]={value:'Other table'};
  s.cells[key(s.rows[25].id,s.columns[9].id)]={value:'Outside'};
  const d=await compare(a,b),areas=scopes(a,b,d);
  assert.equal(d.length,3);assert.ok(d.every(d=>d.category==='value'));
  assert.equal(areas.length,3);assert.deepEqual(new Set(areas.map(s=>s.name)),new Set(['First','Second','Outside tables / sheet structure']));
  const first=areas.find(s=>s.name==='First')!,region=chunks(first,first.differences,2)[0];
  assert.equal(region.r2-region.r1,4);assert.equal(region.c1,0);assert.equal(region.c2,2);
});
it('distinguishes moves, hypothetical tags and groups from cell-value changes',async()=>{
  const a=fixture(),b=structuredClone(a),s=b.sheets[0],row=s.rows.splice(2,1)[0];s.rows.splice(9,0,row);
  s.rows[4].hypotheticalTables={one:true};
  s.groups.push({id:'group',axis:'row',kind:'summary',members:s.rows.slice(3,8).map(r=>r.id),label:'Invented group',collapsed:true,table:'one'});
  const d=await compare(a,b);
  assert.equal(d.filter(d=>d.label==='Row order changed').length,1);
  assert.ok(d.some(d=>d.label==='Hypothetical tag'&&d.table==='one'&&d.category==='structure'));
  assert.ok(d.some(d=>d.label==='Group added or removed'&&d.table==='one'));
  assert.ok(!d.some(d=>d.category==='value'));
});
it('does not report a row insertion as reordering or a value change',async()=>{
  const a=fixture(),b=structuredClone(a),s=b.sheets[0],newRow={id:'new-row'};s.rows.splice(3,0,newRow);s.cells[key(newRow.id,s.columns[0].id)]={value:7};
  const d=await compare(a,b);assert.ok(d.some(d=>d.label==='Row only in right copy'));assert.ok(!d.some(d=>d.label==='Row order changed'));assert.ok(!d.some(d=>d.category==='value'));
});
it('keeps removed cells associated with their original table in either direction',async()=>{
  const a=fixture(),b=structuredClone(a),s=a.sheets[0],row=s.rows[5].id,column=s.columns[1].id;
  s.cells[key(row,column)]={value:'Removed row'};
  b.sheets[0].rows=b.sheets[0].rows.filter(r=>r.id!==row);
  b.tables[0].rows=b.tables[0].rows.filter(id=>id!==row);
  b.tables[1].rows=b.tables[1].rows.filter(id=>id!==row);
  for(const [left,right] of [[a,b],[b,a]]){
    const differences=await compare(left,right),removed=differences.find(d=>d.address===key(row,column));
    assert.ok(removed);assert.equal(removed.table,'one');
    assert.ok(scopes(left,right,differences).find(s=>s.name==='First')!.differences.includes(removed));
  }
});
it('ignores empty-cell representations and independent activity counters',async()=>{
  const a=fixture(),b=structuredClone(a),s=b.sheets[0];s.cells[key(s.rows[3].id,s.columns[0].id)]={value:null,format:{}};
  b.revision=50;b.tableActivity={one:{visits:20}};
  assert.deepEqual(await compare(a,b),[]);
});
it('preserves untrusted cell text as a value',async()=>{
  const a=fixture(),b=structuredClone(a),s=b.sheets[0];s.cells[key(s.rows[3].id,s.columns[0].id)]={value:'<img src=x onerror=alert(1)>'};
  const d=await compare(a,b);assert.equal(d.length,1);assert.equal((d[0].right as {value:string}).value,'<img src=x onerror=alert(1)>');
});
it('compares retained day-date formulas without duplicate changes and identifies different dates',async()=>{
  const a=fixture(),s=a.sheets[0],table=a.tables[0],row=table.rows[0],date=table.columns[0].column,marker=table.columns[1].column;
  table.name='Master';table.columns[0].name='Date';table.columns[1].name='isDay';
  s.cells[key(row,marker)]={value:true};
  s.cells[key(row,date)]={formula:{kind:'literal',value:45782},format:{number:'date'}};
  const b=structuredClone(a),formula=b.sheets[0].cells[key(row,date)].formula!;
  b.sheets[0].cells[key(row,date)]={value:45782,calculation:formula,format:{number:'date'}};
  for(const [left,right]of [[a,b],[b,a]]){
    const ds=await compare(left,right);assert.equal(ds.length,1);assert.equal(ds[0].label,anchorLabel);assert.equal(ds[0].category,'structure');
  }
  const wrong=structuredClone(b);wrong.sheets[0].cells[key(row,date)].calculation={kind:'literal',value:40000};
  assert.ok((await compare(a,wrong)).some(d=>d.label==='Formula changed'));
  const changed=structuredClone(b);changed.sheets[0].cells[key(row,date)].format={number:'date',bold:true};
  assert.equal((await compare(a,changed)).length,2);
  const changedDate=structuredClone(b);changedDate.sheets[0].cells[key(row,date)].value=45783;
  assert.equal((await compare(a,changedDate))[0].label,anchorMismatchLabel);
  a.tables[0].name=b.tables[0].name='Not Master';
  assert.ok(!(await compare(a,b)).some(d=>d.label===anchorLabel));
});
it('distinguishes retained-formula activation from new formulas',async()=>{
  const a=fixture(),b=structuredClone(a),s=b.sheets[0],address=key(s.rows[4].id,s.columns[1].id);
  s.cells[address]={formula:{kind:'literal',value:5}};
  assert.equal((await compare(a,b))[0].label,'Formula added / removed');
  a.sheets[0].cells[address]={value:7,calculation:{kind:'literal',value:5}};
  assert.equal((await compare(a,b))[0].label,'Retained formula activated / deactivated');
});
it('keeps day-logging settings in the outside-table scope',async()=>{
  const a=fixture(),b=structuredClone(a),s=b.sheets[0];
  s.dayLogging={table:'one',date:'first-0',marker:'first-1',label:'first-2',totals:[],nextDate:45782,direction:'forward'};
  s.cells[key(s.rows[5].id,s.columns[0].id)]={value:'Changed'};
  const areas=scopes(a,b,await compare(a,b));
  assert.equal(areas[0].name,'First');assert.equal(areas.at(-1)!.name,'Outside tables / sheet structure');
});
