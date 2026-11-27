import {describe,expect,it} from 'vitest';
import {compare} from '../prototypes/comparison/comparison-model';
import {mergeComparison} from '../src/comparison-merge';
import {blankSheet,clone,createDemo,key} from '../src/model';

describe('selective comparison replacement',()=>{
  it('applies chosen contents independently of formatting and retains unchosen contents',async()=>{
    const left=createDemo(),right=clone(left),s=right.sheets[0],first=key(s.rows[1].id,s.columns[0].id),second=key(s.rows[2].id,s.columns[0].id);
    s.cells[first]={...s.cells[first],value:'Selected donor',format:{...s.cells[first]?.format,bold:true}};
    s.cells[second]={value:'Unchosen donor'};
    const differences=await compare(left,right),content=differences.find(d=>d.target?.kind==='cell'&&d.target.address===first&&d.target.part==='content')!;
    expect(content).toBeDefined();
    const result=await mergeComparison(left,right,[{id:content.id,side:'right'}]);
    expect(result.sheets[0].cells[first].value).toBe('Selected donor');
    expect(result.sheets[0].cells[first].format).toEqual(left.sheets[0].cells[first].format);
    expect(result.sheets[0].cells[second]).toEqual(left.sheets[0].cells[second]);
    expect(left.sheets[0].cells[first].value).not.toBe('Selected donor');
  });
  it('keeps the entire left copy for all-left decisions and reproduces a renamed/reordered right copy for all-right decisions',async()=>{
    const left=createDemo(),right=clone(left),s=right.sheets[0],table=right.tables.find(t=>t.sheet===s.id)!;
    table.name='RenamedIngredients';table.columns[0].name='Renamed field';
    s.cells[key(table.header,table.columns[0].column)]={value:'Renamed field'};
    s.columns[0].label='Renamed label';s.columns.reverse();
    const [row]=s.rows.splice(1,1);s.rows.push(row);table.rows=table.rows.filter(id=>id!==row.id).concat(row.id);
    right.title='Chosen title';
    const differences=await compare(left,right);
    expect(await mergeComparison(left,right,differences.map(d=>({id:d.id,side:'left'})))).toEqual(left);
    expect(await mergeComparison(left,right,differences.map(d=>({id:d.id,side:'right'})))).toEqual(right);
  });
  it('reproduces added and removed sheets with complete right-side choices',async()=>{
    const left=createDemo(),right=clone(left);
    right.sheets.push({id:'added-sheet',name:'Added',color:left.sheets[0].color,rows:[{id:'added-row'}],columns:[{id:'added-column',label:'A'}],cells:{'added-row:added-column':{value:'New'}},groups:[],validations:[]});
    right.sheets.splice(1,1);right.tables=right.tables.filter(t=>right.sheets.some(s=>s.id===t.sheet));
    const differences=await compare(left,right);
    expect(await mergeComparison(left,right,differences.map(d=>({id:d.id,side:'right'})))).toEqual(right);
  });
  it('rejects a selected formula whose unchosen donor row is absent',async()=>{
    const left=createDemo(),right=clone(left),s=right.sheets[0],row='donor-row',address=key(s.rows[1].id,s.columns[0].id);
    s.rows.push({id:row});
    s.cells[address]={formula:{kind:'ref',sheet:s.id,row,column:s.columns[0].id,absRow:false,absCol:false}};
    const differences=await compare(left,right),formula=differences.find(d=>d.target?.kind==='cell'&&d.target.address===address)!;
    await expect(mergeComparison(left,right,[{id:formula.id,side:'right'}])).rejects.toThrow('dependencies');
    expect(await mergeComparison(left,right,differences.map(d=>({id:d.id,side:'right'})))).toEqual(right);
  });
  it('rejects forged, repeated and empty decisions',async()=>{
    const left=createDemo(),right=clone(left);right.title='Other';
    const [difference]=await compare(left,right);
    await expect(mergeComparison(left,right,[])).rejects.toThrow('at least one');
    await expect(mergeComparison(left,right,[{id:-1,side:'right'}])).rejects.toThrow('invalid');
    await expect(mergeComparison(left,right,[{id:difference.id,side:'right'},{id:difference.id,side:'left'}])).rejects.toThrow('invalid');
  });
  it.each(['row','column'] as const)('compares formatting-only and empty cells when their %s is removed',async axis=>{
    const left=createDemo(),sheet=blankSheet('Formatting regression',4,4);
    left.sheets.push(sheet);
    const row=sheet.rows[1].id,column=sheet.columns[1].id;
    const formatted=key(row,column),empty=axis==='row'?key(row,sheet.columns[2].id):key(sheet.rows[2].id,column);
    const retained=axis==='row'?key(row,sheet.columns[3].id):key(sheet.rows[3].id,column);
    sheet.cells[formatted]={format:{bold:true}};
    sheet.cells[empty]={};
    sheet.cells[retained]={calculation:{kind:'literal',value:42},spillHint:true};
    const right=clone(left),donor=right.sheets.at(-1)!;
    if(axis==='row')donor.rows=donor.rows.filter(item=>item.id!==row);
    else donor.columns=donor.columns.filter(item=>item.id!==column);
    delete donor.cells[formatted];delete donor.cells[empty];delete donor.cells[retained];
    const differences=await compare(left,right);
    for(const address of [formatted,empty,retained])expect(differences.find(d=>d.target?.kind==='cell'&&d.target.address===address&&d.target.part==='whole')).toBeDefined();
    expect(await mergeComparison(left,right,differences.map(d=>({id:d.id,side:'left'})))).toEqual(left);
    expect(await mergeComparison(left,right,differences.map(d=>({id:d.id,side:'right'})))).toEqual(right);
    const reverse=await compare(right,left);
    expect(await mergeComparison(right,left,reverse.map(d=>({id:d.id,side:'right'})))).toEqual(left);
    expect(sheet.cells[formatted]).toEqual({format:{bold:true}});
  });
  it('inherits an explicit parent deletion for omitted metadata but protects explicit keep decisions and meaningful contents',async()=>{
    const left=createDemo(),sheet=blankSheet('Formatting conflict',3,3);left.sheets.push(sheet);
    const row=sheet.rows[1].id,address=key(row,sheet.columns[0].id);
    sheet.cells[address]={format:{italic:true}};
    const right=clone(left),donor=right.sheets.at(-1)!;
    donor.rows=donor.rows.filter(item=>item.id!==row);delete donor.cells[address];
    const beforeLeft=clone(left),beforeRight=clone(right),differences=await compare(left,right);
    const removal=differences.find(d=>d.target?.kind==='axis'&&d.target.id===row)!;
    const cell=differences.find(d=>d.target?.kind==='cell'&&d.target.address===address)!;
    expect(await mergeComparison(left,right,[{id:removal.id,side:'right'}])).toEqual(right);
    await expect(mergeComparison(left,right,[{id:removal.id,side:'right'},{id:cell.id,side:'left'}])).rejects.toThrow('row and column');
    expect(left).toEqual(beforeLeft);expect(right).toEqual(beforeRight);
    sheet.cells[address]={value:'Do not drop this value',format:{italic:true}};
    const contentDifferences=await compare(left,right),contentRemoval=contentDifferences.find(d=>d.target?.kind==='axis'&&d.target.id===row)!;
    await expect(mergeComparison(left,right,[{id:contentRemoval.id,side:'right'}])).rejects.toThrow('row and column');
  });
  it.each(['row','column','sheet'] as const)('replays a legacy %s deletion without requiring new metadata-only decisions',async kind=>{
    const left=createDemo(),sheet=blankSheet('Legacy metadata removal',3,3);left.sheets.push(sheet);
    const row=sheet.rows[1].id,column=sheet.columns[1].id,address=key(row,column);
    sheet.cells[address]={calculation:{kind:'literal',value:42},spillHint:true};
    const right=clone(left),donor=right.sheets.at(-1)!;
    if(kind==='sheet')right.sheets.pop();
    else{
      if(kind==='row')donor.rows=donor.rows.filter(item=>item.id!==row);
      else donor.columns=donor.columns.filter(item=>item.id!==column);
      delete donor.cells[address];
    }
    const differences=await compare(left,right),legacy=differences.filter(d=>d.target?.kind!=='cell');
    expect(await mergeComparison(left,right,legacy.map(d=>({id:d.id,side:'right'})))).toEqual(right);
  });
});
