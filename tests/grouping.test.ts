import {expect,it} from 'vitest';
import {blankSheet,clone,outlineMembers,type Group} from '../src/model';
import {outlineGroups,outlineGutter,precedingGroupMember} from '../src/grouping';
import {validateBook} from '../src/storage';
import {createDemo} from '../src/model';
import {exportXlsx} from '../src/xlsx-export';
import {strFromU8,unzipSync} from 'fflate';

it('derives summary depth from identity containment without treating overlapping or plain ranges as parents',()=>{
  const groups:Group[]=[
    {id:'child',axis:'row',members:['b','c','d'],kind:'summary',collapsed:false,label:'Child'},
    {id:'root',axis:'row',members:['a','b','c','d','e'],kind:'summary',collapsed:false,label:'Root'},
    {id:'leaf',axis:'row',members:['c','d'],kind:'summary',collapsed:false,label:'Leaf'},
    {id:'overlap',axis:'row',members:['d','e','f'],kind:'summary',collapsed:false,label:'Overlap'},
    {id:'plain',axis:'row',members:['a','b','c','d','e','f'],collapsed:false,label:'Plain'},
    {id:'column',axis:'column',members:['a','b','c','d'],kind:'summary',collapsed:false,label:'Column'}
  ];
  const entries=outlineGroups(groups);
  expect(entries.map(e=>[e.group.id,e.depth])).toEqual([['child',2],['root',1],['leaf',3],['overlap',1],['plain',1],['column',1]]);
  expect(outlineGutter(entries,['a','b','c','d','e','f'],true)).toBe(72);
  expect(outlineGutter(entries,['a','f'],true)).toBe(48);
  expect(outlineGutter(entries,['a','b','c','d','e','f'],false)).toBe(48);
  expect(outlineGutter(entries,['a','b'],false,10000)).toBe(60);
});

it('anchors plain hints before their current identity range, skipping hidden parents and following moves',()=>{
  const sheet=blankSheet('Invented',10,4),ids=sheet.rows.map(r=>r.id);
  const group:Group={id:'range',axis:'row',members:[ids[5],ids[6]],collapsed:true,label:'Notes'};
  expect(precedingGroupMember(sheet,group,ids)).toBe(ids[4]);
  expect(precedingGroupMember(sheet,group,[ids[0],ids[1],ids[8]])).toBe(ids[1]);
  sheet.rows=[...sheet.rows.slice(5,7),...sheet.rows.slice(0,5),...sheet.rows.slice(7)];
  expect(precedingGroupMember(sheet,group,[ids[0],ids[1],ids[8]])).toBe(ids[0]);
  expect(precedingGroupMember(sheet,group,[])).toBeUndefined();
});

it('validates per-sheet outline preferences while retaining compatibility with old books',()=>{
  const book=createDemo();expect(()=>validateBook(book)).not.toThrow();
  book.sheets[0].outlineView={tree:true,plainGroupHints:false};
  expect(()=>validateBook(JSON.parse(JSON.stringify(book)))).not.toThrow();
  const invalid=JSON.parse(JSON.stringify(book));invalid.sheets[0].outlineView.plainGroupHints='false';
  expect(()=>validateBook(invalid)).toThrow('outline preferences');
});

it.each(['row','column'] as const)('plain %s groups expand selected summary identities dynamically without changing either group',axis=>{
  const summary:Group={id:'summary',axis,kind:'summary',members:['a','b'],collapsed:false,label:'Summary'};
  const nested:Group={id:'nested',axis,kind:'summary',members:['b','c'],collapsed:true,label:'Nested'};
  const plain:Group={id:'plain',axis,kind:'range',members:['a'],collapsed:true,label:'Plain'};
  const other:Group={...nested,id:'other',axis:axis==='row'?'column':'row',members:['a','z']};
  const groups=[nested,summary,plain,other],before=clone(groups);
  expect(outlineMembers(plain,groups)).toEqual(['a','b','c']);
  expect(outlineMembers(summary,groups)).toEqual(['b']);
  expect(groups).toEqual(before);
  nested.members.push('d');expect(outlineMembers(plain,groups)).toEqual(['a','b','c','d']);
  expect(outlineMembers(plain,[plain,other])).toEqual(['a']);
});

it('projects dual summary/plain row and column hiding into Excel without replacing formulas',async()=>{
  const book=createDemo(),sheet=book.sheets[3],before=clone(sheet.cells);
  for(const axis of ['row','column'] as const){
    const ids=(axis==='row'?sheet.rows:sheet.columns).slice(1,4).map(item=>item.id);
    sheet.groups.push({id:'summary-'+axis,axis,kind:'summary',members:ids,collapsed:false,label:'Summary'},
      {id:'plain-'+axis,axis,kind:'range',members:[ids[0]],collapsed:true,label:'Plain'});
  }
  const parts=unzipSync(await exportXlsx({format:'fnt-backup',version:1,state:{book,version:1,pending:[],updated:'now'},originals:[]}));
  const xml=strFromU8(parts['xl/worksheets/sheet4.xml']);
  for(const row of [2,3,4])expect(xml).toMatch(new RegExp(`<row r="${row}"[^>]*hidden="1"`));
  for(const column of [2,3,4])expect(xml).toMatch(new RegExp(`<col min="${column}"[^>]*hidden="1"`));
  expect(sheet.cells).toEqual(before);
});
