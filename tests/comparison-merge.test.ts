import {describe,expect,it} from 'vitest';
import {compare} from '../prototypes/comparison/comparison-model';
import {mergeComparison} from '../src/comparison-merge';
import {clone,createDemo,key} from '../src/model';

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
});
