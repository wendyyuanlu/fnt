import {expect,it} from 'vitest';
import {blankSheet,clone,key,type Workbook} from '../src/model';
import {hypotheticalMembers,hypotheticalProjection,joinPrecedingGroups} from '../src/grouping';

function fixture(){
  const sheet=blankSheet('Synthetic groups',8,8),book:Workbook={schema:1,id:'book',title:'Invented groups',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  sheet.cells[key(sheet.rows[4].id,sheet.columns[4].id)]={value:'Keep this invented note',note:'Unchanged'};
  return{book,sheet};
}
it.each(['row','column'] as const)('joins selected %s identities to both group types and nested parents without adding intervening axes or moving data',axis=>{
  const {book,sheet}=fixture(),items=axis==='row'?sheet.rows:sheet.columns,ids=items.map(item=>item.id);
  sheet.groups=[{id:'outer',axis,kind:'summary',members:ids.slice(0,4),label:'Outer',collapsed:false},{id:'summary',axis,kind:'summary',members:ids.slice(1,4),label:'Summary',collapsed:true},{id:'plain',axis,kind:'range',members:ids.slice(1,4),label:'Plain',collapsed:true}];
  items[1].hypothetical=true;items[4].hypothetical=false;const before=clone(book);
  expect(joinPrecedingGroups(book,sheet,axis,[ids[4],ids[6]])).toBe(3);
  for(const group of sheet.groups){expect(group.members).toContain(ids[4]);expect(group.members).toContain(ids[6]);expect(group.members).not.toContain(ids[5]);}
  expect(sheet.groups[1].members[0]).toBe(ids[1]);expect(sheet.groups[1].collapsed).toBe(true);
  expect(hypotheticalMembers(sheet,axis).has(ids[4])).toBe(true);expect(hypotheticalMembers(sheet,axis).has(ids[6])).toBe(true);expect(items[4].hypothetical).toBeUndefined();
  expect(sheet.cells).toEqual(before.sheets[0].cells);expect(items.map(item=>item.id)).toEqual((axis==='row'?before.sheets[0].rows:before.sheets[0].columns).map(item=>item.id));
});
it('inherits a plain-only group tag and rejects missing adjacent groups without changing anything',()=>{
  const {book,sheet}=fixture(),ids=sheet.columns.map(column=>column.id);
  sheet.groups=[{id:'plain',axis:'column',members:ids.slice(1,4),kind:'range',collapsed:false,label:'Plain'}];
  sheet.columns.slice(1,4).forEach(column=>column.hypothetical=true);sheet.columns[4].hypothetical=false;
  expect(joinPrecedingGroups(book,sheet,'column',[ids[4]])).toBe(1);expect(sheet.columns[4].hypothetical).toBe(true);
  const before=clone(book);expect(()=>joinPrecedingGroups(book,sheet,'column',[ids[7]])).toThrow('no plain or summary group');expect(book).toEqual(before);
});
it('joins only the selected table scope and preserves neighboring table tag overrides',()=>{
  const {book,sheet}=fixture(),rows=sheet.rows.slice(1).map(row=>row.id);
  const table=(id:string,c:number)=>({id,name:id,sheet:sheet.id,header:sheet.rows[0].id,rows:[...rows],columns:[{id:id+'-field',name:'Value',column:sheet.columns[c].id}]});
  book.tables=[table('left',0),table('right',1)];
  sheet.groups=['left','right'].map(id=>({id,axis:'row',table:id,kind:'summary',members:rows.slice(0,3),collapsed:false,label:id}));
  sheet.rows[1].hypotheticalTables={left:true};sheet.rows[4].hypotheticalTables={left:false,right:false};
  const before=clone(book);expect(joinPrecedingGroups(book,sheet,'row',[sheet.rows[4].id],'left')).toBe(1);
  expect(sheet.groups[0].members).toContain(sheet.rows[4].id);expect(sheet.groups[1]).toEqual(before.sheets[0].groups[1]);expect(book.tables).toEqual(before.tables);
  const projected=hypotheticalProjection(book,sheet,'row');expect(projected(sheet.rows[4].id,sheet.columns[0].id)).toBe(true);expect(projected(sheet.rows[4].id,sheet.columns[1].id)).toBe(false);
});
it('expands nested summary membership while preserving manually tagged children',()=>{
  const {book,sheet}=fixture(),ids=sheet.rows.map(row=>row.id);
  sheet.groups=[{id:'outer',axis:'row',kind:'summary',members:ids.slice(0,2),label:'Outer',collapsed:false},{id:'child',axis:'row',kind:'summary',members:ids.slice(1,4),label:'Child',collapsed:false},{id:'selected',axis:'row',kind:'summary',members:ids.slice(4,6),label:'Selected',collapsed:false}];
  sheet.rows[1].hypothetical=true;sheet.rows[4].hypothetical=false;sheet.rows[5].hypothetical=false;
  expect(joinPrecedingGroups(book,sheet,'row',[ids[4]])).toBe(2);
  expect(sheet.groups[0].members).toContain(ids[5]);expect(sheet.groups[1].members).toContain(ids[5]);
  expect(hypotheticalMembers(sheet,'row').has(ids[4])).toBe(true);expect(sheet.rows[5].hypothetical).toBe(false);
  const before=clone(book);expect(()=>joinPrecedingGroups(book,sheet,'row',[ids[0]],undefined,ids[5])).toThrow('descendants');expect(book).toEqual(before);
});
