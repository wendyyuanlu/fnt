import {expect,it} from 'vitest';
import {compile,Engine} from '../src/formula';
import {blankSheet,clone,getCell,key,type Workbook} from '../src/model';
import {editTableAxis} from '../src/table-operations';
import {formulaCellContext,planTableAxisEdit} from '../src/table-edit-plan';

function fixture(){
  const s=blankSheet('Test',16,10),book:Workbook={schema:1,id:'book',title:'Test',revision:0,sheets:[s],tables:[],names:[],pickerSources:{}};
  const rows=s.rows.slice(1,4).map(row=>row.id),columns=[{id:'item',column:s.columns[1].id,name:'Item'},{id:'value',column:s.columns[2].id,name:'Value'}];
  const table={id:'table',name:'Pantry',sheet:s.id,header:s.rows[0].id,rows,columns};book.tables.push(table);
  book.tables.push({id:'side',name:'Side',sheet:s.id,header:s.rows[0].id,rows:[...rows],columns:[{id:'neighbor',column:s.columns[5].id,name:'Neighbor'}]});
  book.tables.push({id:'below',name:'Below',sheet:s.id,header:s.rows[7].id,rows:[s.rows[8].id],columns:[{id:'stacked',column:s.columns[1].id,name:'Stacked'}]});
  const put=(r:number,c:number,value:string|number)=>{s.cells[key(s.rows[r].id,s.columns[c].id)]={value};};
  put(0,1,'Item');put(0,2,'Value');put(0,5,'Neighbor');put(7,1,'Stacked');
  for(let i=1;i<=3;i++){put(i,1,['one','two','three'][i-1]);put(i,2,i*10);put(i,5,100+i);put(i,8,'unrelated');}
  put(8,1,'stacked data');
  const formula=(r:number,c:number,input:string)=>{s.cells[key(s.rows[r].id,s.columns[c].id)]={formula:compile(input,book,s.id,s.rows[r].id,s.columns[c].id)};};
  const value=(r:number,c:number)=>new Engine(book).cell(s.id,book.sheets[0].rows[r].id,book.sheets[0].columns[c].id);
  const neighbors=()=>Object.fromEntries(Object.entries(book.sheets[0].cells).filter(([address])=>address.endsWith(':'+s.columns[5].id)||address.endsWith(':'+s.columns[8].id)||address.startsWith(s.rows[7].id+':')||address.startsWith(s.rows[8].id+':')));
  return{book,s,table,rows,columns,put,formula,value,neighbors};
}
it('reorders only table records, following exact formula targets, DD links, validations and hypo flags',()=>{
  const {book,s,table,rows,columns,formula,value,neighbors}=fixture(),before=neighbors();
  formula(10,9,'=C3');formula(11,9,'=SUM(Pantry[Value])');
  s.cells[key(s.rows[12].id,s.columns[9].id)]={binding:{table:table.id,row:rows[1],column:columns[1].id}};
  s.rows[2].hypotheticalTables={[table.id]:true,side:false};
  s.validations.push({id:'validation',sheet:s.id,rows:[rows[1]],columns:[columns[0].column],source:'',values:['two']});
  book.references=[{id:'source',name:'Items',kind:'list',table:table.id,column:'item',archivedRows:[rows[1]]}];
  editTableAxis(book,table.id,'row',{kind:'move',ids:[rows[1]],boundary:1});
  expect([value(1,1),value(2,1),value(3,1)]).toEqual(['two','one','three']);
  expect([value(10,9),value(11,9),value(12,9)]).toEqual([20,60,20]);
  expect(book.sheets[0].cells[key(s.rows[12].id,s.columns[9].id)].binding?.row).toBe(rows[0]);
  expect(book.sheets[0].rows[1].hypotheticalTables?.[table.id]).toBe(true);
  expect(book.sheets[0].rows[2].hypotheticalTables?.side).toBe(false);
  expect(book.sheets[0].validations[0].rows).toEqual([rows[0]]);
  expect(book.references[0].archivedRows).toEqual([rows[0]]);
  expect(neighbors()).toEqual(before);
});
it('deletion removes only owner cells and makes deleted direct references and linked records explicit errors',()=>{
  const {book,s,table,rows,columns,formula,value,neighbors}=fixture(),before=neighbors();
  formula(10,9,'=C3');formula(11,9,'=SUM(Pantry[Value])');
  s.cells[key(s.rows[12].id,s.columns[9].id)]={binding:{table:table.id,row:rows[1],column:columns[1].id}};
  editTableAxis(book,table.id,'row',{kind:'delete',ids:[rows[1]]});
  expect([value(1,1),value(2,1),value(3,1)]).toEqual(['one','three',null]);
  expect(value(10,9)).toMatchObject({error:'#REF!'});expect(value(12,9)).toMatchObject({error:'#REF!'});expect(value(11,9)).toBe(40);
  expect(book.sheets[0].rows).toHaveLength(16);expect(neighbors()).toEqual(before);
});
it('inserts inherited formulas and duplicates records with translated calculations without widening the sheet edit',()=>{
  const {book,s,table,rows,formula,value,neighbors}=fixture(),before=neighbors();
  formula(1,2,'=LEN([@Item])');formula(2,2,'=LEN([@Item])');formula(3,2,'=LEN([@Item])');
  editTableAxis(book,table.id,'row',{kind:'insert',boundary:2,count:1});
  expect(book.tables[0].rows).toHaveLength(4);expect(value(2,1)).toBe(null);expect(value(2,2)).toBe(0);
  expect([value(1,1),value(3,1),value(4,1)]).toEqual(['one','two','three']);
  editTableAxis(book,table.id,'row',{kind:'duplicate',ids:[rows[0]]});
  expect([value(1,1),value(2,1),value(3,1)]).toEqual(['one','one',null]);expect(value(2,2)).toBe(3);
  expect(neighbors()).toEqual(before);
});
it('moves, duplicates and deletes table fields while keeping stable field identity and structured lookups',()=>{
  const {book,s,table,columns,formula,value,neighbors}=fixture(),before=neighbors();
  formula(10,9,'=SUM(Pantry[Value])');
  editTableAxis(book,table.id,'column',{kind:'move',ids:[columns[1].column],boundary:1});
  expect([value(1,1),value(1,2)]).toEqual([10,'one']);expect(value(10,9)).toBe(60);
  expect(book.tables[0].columns[0].id).toBe('value');
  editTableAxis(book,table.id,'column',{kind:'duplicate',ids:[s.columns[1].id]});
  expect(book.tables[0].columns.map(field=>field.name)).toEqual(['Value','Value copy','Item']);
  expect([value(1,1),value(1,2),value(1,3)]).toEqual([10,10,'one']);expect(value(10,9)).toBe(60);
  editTableAxis(book,table.id,'column',{kind:'delete',ids:[s.columns[1].id]});
  expect(value(10,9)).toMatchObject({error:'#REF!'});expect(book.tables[0].columns.map(field=>field.name)).toEqual(['Value copy','Item']);
  expect(neighbors()).toEqual(before);
});
it('refuses occupied expansion, overlapping tables, partial headers and fragmented formula ranges atomically',()=>{
  const {book,s,table,rows,put,formula}=fixture();put(4,1,'a note');let before=clone(book);
  expect(()=>editTableAxis(book,table.id,'row',{kind:'insert',boundary:2,count:1})).toThrow(/neighboring/);expect(book).toEqual(before);
  delete s.cells[key(s.rows[4].id,s.columns[1].id)];before=clone(book);
  expect(()=>editTableAxis(book,table.id,'row',{kind:'insert',boundary:2,count:4})).toThrow(/neighboring|overlap/);expect(book).toEqual(before);
  expect(()=>editTableAxis(book,table.id,'row',{kind:'delete',ids:[table.header]})).toThrow(/header/);expect(book).toEqual(before);
  formula(10,9,'=SUM(B2:C3)');before=clone(book);
  expect(()=>editTableAxis(book,table.id,'row',{kind:'move',ids:[rows[0]],boundary:4})).toThrow(/fragment/);expect(book).toEqual(before);
});
it('keeps table summary groups and hypo with their records but leaves sheet and neighbor metadata alone',()=>{
  const {book,s,table,rows}=fixture();
  s.groups=[{id:'summary',kind:'summary',axis:'row',members:rows.slice(0,2),label:'Summary',collapsed:false,table:table.id},{id:'sheet',kind:'range',axis:'row',members:[rows[1]],label:'Sheet',collapsed:false}];
  s.rows[0].hypothetical=true;s.rows[1].hypotheticalTables={[table.id]:true};
  editTableAxis(book,table.id,'row',{kind:'move',ids:[rows[0]],boundary:4});
  expect(book.sheets[0].groups[0].members).toEqual([rows[1],rows[2]]);
  expect(book.sheets[0].groups[1].members).toEqual([rows[1]]);
  expect(book.sheets[0].rows[2].hypotheticalTables?.[table.id]).toBe(true);expect(book.sheets[0].rows[0].hypothetical).toBe(true);
});
it('plans an atomic sheet-space shift only when expansion collides, preserving all neighboring identities',()=>{
  const {book,s,table,put}=fixture();put(4,1,'note below');const before=clone(book);
  const plan=planTableAxisEdit(book,table.id,'row',{kind:'insert',boundary:2,count:2});
  expect(book).toEqual(before);expect(plan.shift).toMatchObject({axis:'row',count:2,boundary:4,impacts:[]});
  expect(plan.book.sheets[0].rows[6].id).toBe(s.rows[4].id);
  expect(plan.book.sheets[0].cells[key(s.rows[4].id,s.columns[1].id)].value).toBe('note below');
  expect(plan.book.tables.find(other=>other.id==='below')!.header).toBe(before.tables[2].header);
  expect(plan.book.tables[0].rows).toHaveLength(5);
});
it('grows into empty cells with formatting or validation without shifting the sheet',()=>{
  for(const axis of ['row','column'] as const){
    const {book,s,table}=fixture(),row=s.rows[axis==='row'?4:1].id,column=s.columns[axis==='row'?1:3].id;
    s.cells[key(row,column)]={value:'',format:{wrap:false}};
    s.validations.push({id:'empty-rule',sheet:s.id,rows:[row],columns:[column],values:['one','two'],source:''});
    const before=clone(book),plan=planTableAxisEdit(book,table.id,axis,{kind:'insert',boundary:2,count:1});
    expect(plan.shift).toBeUndefined();expect(book).toEqual(before);
    expect(plan.book.sheets[0].rows.map(row=>row.id)).toEqual(s.rows.map(row=>row.id));
    expect(plan.book.sheets[0].columns.map(column=>column.id)).toEqual(s.columns.map(column=>column.id));
    expect(plan.book.tables.find(table=>table.id==='below')).toEqual(before.tables.find(table=>table.id==='below'));
    expect(plan.book.tables.find(table=>table.id==='side')).toEqual(before.tables.find(table=>table.id==='side'));
  }
});
it('still protects zero, false, blank-result formulas and notes when extending a table',()=>{
  for(const cell of [{value:0},{value:false},{note:'Keep note'},{formula:{kind:'literal' as const,value:''}}]){
    const {book,s,table}=fixture();s.cells[key(s.rows[4].id,s.columns[1].id)]=cell;
    expect(planTableAxisEdit(book,table.id,'row',{kind:'insert',boundary:2,count:1}).shift).toBeDefined();
  }
});
it('audits real broken INDIRECT, changed coordinate formulas and preserved direct references with contextual cells',()=>{
  const {book,s,table,put,formula}=fixture();put(4,1,'note below');put(10,9,7);
  formula(9,9,'=INDIRECT("J11")');formula(11,9,'=J11');formula(12,9,'=ROW()');
  const plan=planTableAxisEdit(book,table.id,'row',{kind:'insert',boundary:2,count:1});
  expect(plan.shift!.impacts.find(impact=>impact.row===s.rows[9].id)).toMatchObject({reason:'broken',beforeValue:7,afterValue:{error:'#CYCLE!'}});
  expect(plan.shift!.impacts.find(impact=>impact.row===s.rows[11].id)).toMatchObject({reason:'updated',beforeValue:7,afterValue:7});
  expect(plan.shift!.impacts.find(impact=>impact.row===s.rows[12].id)).toMatchObject({reason:'changed',beforeValue:13,afterValue:14});
  const context=formulaCellContext(plan.book,s.id,s.rows[9].id,s.columns[9].id);
  expect(context.address).toBe('Test!J11');expect(context.rows).toHaveLength(3);
  expect(context.rows.flatMap(row=>row.cells).filter(cell=>cell.focused)).toEqual([{focused:true,value:'#CYCLE!'}]);
});
it('makes room for fields without overwriting side tables and preserves their formulas and DD field identities',()=>{
  const {book,s,table,put,formula}=fixture();put(1,3,'note beside');formula(10,9,'=F2');
  const plan=planTableAxisEdit(book,table.id,'column',{kind:'insert',boundary:2,count:1});
  expect(plan.shift).toMatchObject({axis:'column',count:1,boundary:3});
  expect(plan.book.tables.find(other=>other.id==='side')!.columns[0].column).toBe(s.columns[5].id);
  expect(new Engine(plan.book).cell(s.id,s.rows[10].id,s.columns[9].id)).toBe(101);
  expect(plan.shift!.impacts[0].reason).toBe('updated');
  expect(plan.book.sheets[0].cells[key(s.rows[1].id,s.columns[3].id)].value).toBe('note beside');
});
