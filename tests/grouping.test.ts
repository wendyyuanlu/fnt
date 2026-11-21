import {expect,it} from 'vitest';
import {addRow,blankSheet,clone,getCell,groupMoveTarget,insertColumn,moveColumns,moveRows,moveIntoGroup,moveTargetGroups,outlineMembers,setInput,type Group} from '../src/model';
import {Engine} from '../src/formula';
import {outlineGroups,outlineGutter,precedingGroupMember,summaryRowLayout} from '../src/grouping';
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
  expect(outlineGutter(entries,['a','f'],true)).toBe(72);
  expect(outlineGutter(entries,['a','b','c','d','e','f'],false)).toBe(72);
  expect(outlineGutter(entries,['a','b'],false,10000)).toBe(84);
  expect(outlineGutter([],['a','b'],false)).toBe(48);
  expect(outlineGutter(entries.filter(e=>e.group.axis==='column'),['a','b'],false)).toBe(48);
  expect(outlineGutter(entries.filter(e=>e.group.id==='plain'),['a','b'],false,2,false)).toBe(48);
});

it('connects nested summary controls and always caps the last grouped row, including blank cells',()=>{
  const rows=['a','b','c','d','e','f','g','h'],groups:Group[]=[
    {id:'root',axis:'row',kind:'summary',members:rows,collapsed:false,label:'Root'},
    {id:'inner',axis:'row',kind:'summary',members:rows.slice(1,5),collapsed:false,label:'Inner'},
    {id:'leaf',axis:'row',kind:'summary',members:rows.slice(2,4),collapsed:false,label:'Leaf'}
  ],filled=new Set(['b','c','d','f']),layout=summaryRowLayout(groups,rows,true,id=>filled.has(id));
  expect(layout.get('b')!.buttons[0].left+6).toBe(30);
  expect(layout.get('b')!.rails.find(r=>r.group.id==='root'&&r.branch)!.left+12).toBe(30);
  expect(layout.get('c')!.buttons[0].left+6).toBe(54);
  expect(layout.get('c')!.rails.find(r=>r.group.id==='inner'&&r.branch)!.left+12).toBe(54);
  expect(layout.get('d')!.inset).toBe(72);
  expect(layout.get('d')!.rails.filter(r=>r.branch).map(r=>r.group.id)).toEqual(['leaf']);
  expect(layout.get('h')!.rails.find(r=>r.group.id==='root')).toMatchObject({end:true,branch:true});
  expect(layout.get('g')!.rails.find(r=>r.group.id==='root')).toMatchObject({end:false,branch:false});
  const blank=summaryRowLayout(groups,rows,true,()=>false);
  expect([...blank.values()].flatMap(row=>row.rails).filter(r=>r.branch).map(r=>r.group.id).sort()).toEqual(['inner','leaf','root']);
  expect(blank.get('h')!.rails.find(r=>r.group.id==='root')).toMatchObject({end:true,branch:true});
  expect(blank.get('b')!.buttons).toHaveLength(1);
});

it('keeps summary layout independent of mounted windows, visible anchors, and member order',()=>{
  const rows=['a','b','c','d','e'],groups:Group[]=[
    {id:'root',axis:'row',kind:'summary',members:['a','e','d','c','b'],collapsed:false,label:'Root'},
    {id:'inner',axis:'row',kind:'summary',members:['b','c','d'],collapsed:false,label:'Inner'},
    {id:'leaf',axis:'row',kind:'summary',members:['c','d'],collapsed:false,label:'Leaf'}
  ];
  const layout=summaryRowLayout(groups,['a','c','d','e'],true,()=>true);
  expect(layout.get('c')!.rails.find(r=>r.group.id==='root')!.width).toBe(36);
  expect(layout.get('e')!.rails.find(r=>r.group.id==='root')!.end).toBe(true);
  const flat=summaryRowLayout(groups,rows,false,()=>{throw Error('Flat mode must not scan cell values.');});
  expect(flat.get('c')!.inset).toBe(24);
  expect([...flat.values()].flatMap(row=>row.rails)).toEqual([]);
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

it.each(['row','column'] as const)('inserting %s members inherits nested summary, plain and legacy groups without rewriting formulas',axis=>{
  const book=createDemo(),sheet=blankSheet('Inserted groups',10,10);book.sheets.push(sheet);
  const ids=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id),otherIds=(axis==='row'?sheet.columns:sheet.rows).map(item=>item.id);
  const groups:Group[]=[
    {id:'outer',axis,kind:'summary',members:ids.slice(1,8),collapsed:true,label:'Outer'},
    {id:'inner',axis,kind:'summary',members:ids.slice(2,6),collapsed:false,label:'Inner'},
    {id:'plain',axis,kind:'range',members:ids.slice(2,6),collapsed:true,label:'Plain'},
    {id:'legacy',axis,members:ids.slice(2,6),collapsed:false,label:'Legacy'},
    {id:'other',axis:axis==='row'?'column':'row',kind:'summary',members:otherIds.slice(2,6),collapsed:true,label:'Other axis'}
  ];
  sheet.groups=groups;const other=clone(groups[4]),collapsed=groups.map(g=>g.collapsed);
  setInput(book,sheet,sheet.rows[4].id,sheet.columns[4].id,'23');
  const formulaRow=sheet.rows[8].id,formulaColumn=sheet.columns[8].id;
  setInput(book,sheet,formulaRow,formulaColumn,'=E5*2');const formula=clone(getCell(sheet,formulaRow,formulaColumn).formula);
  const inserted=axis==='row'?addRow(book,sheet,4):insertColumn(book,sheet,4);
  expect(groups[0].members).toEqual([...ids.slice(1,4),inserted.id,...ids.slice(4,8)]);
  for(const group of groups.slice(1,4))expect(group.members).toEqual([...ids.slice(2,4),inserted.id,...ids.slice(4,6)]);
  expect(groups[4]).toEqual(other);expect(groups.map(g=>g.collapsed)).toEqual(collapsed);
  expect(outlineMembers(groups[0],groups)).toContain(inserted.id);expect(outlineMembers(groups[2],groups)).toContain(inserted.id);
  expect(getCell(sheet,formulaRow,formulaColumn).formula).toEqual(formula);
  expect(new Engine(book).cell(sheet.id,formulaRow,formulaColumn)).toBe(46);
  const second=axis==='row'?addRow(book,sheet,4):insertColumn(book,sheet,4);
  for(const group of groups.slice(0,4))expect(group.members.indexOf(second.id)+1).toBe(group.members.indexOf(inserted.id));
});

it.each(['row','column'] as const)('insertion at %s group boundaries joins only enclosing groups',axis=>{
  const book=createDemo(),sheet=blankSheet('Group boundaries',10,10);book.sheets.push(sheet);
  const ids=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  const outer:Group={id:'outer',axis,kind:'summary',members:ids.slice(1,8),collapsed:false,label:'Outer'};
  const inner:Group={id:'inner',axis,kind:'summary',members:ids.slice(2,6),collapsed:true,label:'Inner'};
  const plain:Group={id:'plain',axis,kind:'range',members:ids.slice(2,6),collapsed:false,label:'Plain'};
  sheet.groups=[outer,inner,plain];const innerBefore=clone(inner.members),plainBefore=clone(plain.members);
  const before=axis==='row'?addRow(book,sheet,2):insertColumn(book,sheet,2);
  const items=axis==='row'?sheet.rows:sheet.columns,afterAt=items.findIndex(item=>item.id===ids[5])+1;
  const after=axis==='row'?addRow(book,sheet,afterAt):insertColumn(book,sheet,afterAt);
  expect(outer.members).toEqual(expect.arrayContaining([before.id,after.id]));
  expect(inner.members).toEqual(innerBefore);expect(plain.members).toEqual(plainBefore);
  const outsideBefore=axis==='row'?addRow(book,sheet,1):insertColumn(book,sheet,1);
  const current=axis==='row'?sheet.rows:sheet.columns,last=current.findIndex(item=>item.id===ids[7])+1;
  const outsideAfter=axis==='row'?addRow(book,sheet,last):insertColumn(book,sheet,last);
  expect(outer.members).not.toContain(outsideBefore.id);expect(outer.members).not.toContain(outsideAfter.id);
});

it.each(['row','column'] as const)('inserting inside moved %s members preserves the explicit summary anchor and derived plain coverage',axis=>{
  const book=createDemo(),sheet=blankSheet('Moved groups',10,10);book.sheets.push(sheet);
  const ids=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  const summary:Group={id:'summary',axis,kind:'summary',members:[ids[4],ids[2],ids[6]],collapsed:true,label:'Moved summary'};
  const plain:Group={id:'plain',axis,kind:'range',members:[ids[4]],collapsed:true,label:'Summary and details'};
  sheet.groups=[summary,plain];
  const inserted=axis==='row'?addRow(book,sheet,4):insertColumn(book,sheet,4);
  expect(summary.members).toEqual([ids[4],ids[2],inserted.id,ids[6]]);
  expect(plain.members).toEqual([ids[4]]);expect(outlineMembers(plain,sheet.groups)).toContain(inserted.id);
  expect(summary.members).not.toContain(ids[3]);
});

it.each(['row','column'] as const)('moving existing %s blocks inside groups adds destination membership and preserves source identities',axis=>{
  const book=createDemo(),sheet=blankSheet('Moved into groups',12,12);book.sheets.push(sheet);
  const ids=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  const outer:Group={id:'outer',axis,kind:'summary',members:ids.slice(1,8),collapsed:true,label:'Outer'};
  const inner:Group={id:'inner',axis,kind:'summary',members:ids.slice(2,6),collapsed:false,label:'Inner'};
  const plain:Group={id:'plain',axis,kind:'range',members:ids.slice(2,6),collapsed:true,label:'Plain'};
  const source:Group={id:'source',axis,kind:'summary',members:ids.slice(8,10),collapsed:false,label:'Source'};
  sheet.groups=[outer,inner,plain,source];const sourceBefore=clone(source);
  const row=sheet.rows[8].id,column=sheet.columns[8].id;
  setInput(book,sheet,row,column,'=E5*2');setInput(book,sheet,sheet.rows[4].id,sheet.columns[4].id,'23');
  const cells=clone(sheet.cells);
  const at=axis==='row'?moveRows(book,sheet,[ids[8]],4):moveColumns(book,sheet,[ids[8]],4);
  expect(at).toBe(4);
  for(const group of [outer,inner,plain])expect(group.members).toEqual([...ids.slice(group===outer?1:2,4),...ids.slice(8,10),...ids.slice(4,group===outer?8:6)]);
  expect(source).toEqual(sourceBefore);expect(new Set(outer.members).size).toBe(outer.members.length);
  expect(outer.collapsed).toBe(true);expect(outer.members[0]).toBe(ids[1]);
  expect(sheet.cells).toEqual(cells);expect(new Engine(book).cell(sheet.id,row,column)).toBe(46);
});

it.each(['row','column'] as const)('moving %s members to group boundaries stays outside, while rearranging members does not duplicate them',axis=>{
  const book=createDemo(),sheet=blankSheet('Move boundaries',10,10);book.sheets.push(sheet);
  const ids=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  const group:Group={id:'group',axis,kind:'summary',members:ids.slice(2,6),collapsed:true,label:'Group'};
  sheet.groups=[group];const original=clone(group.members);
  const moveTo=(id:string,boundary:number)=>axis==='row'?moveRows(book,sheet,[id],boundary):moveColumns(book,sheet,[id],boundary);
  moveTo(ids[8],2);expect(group.members).toEqual(original);
  const items=axis==='row'?sheet.rows:sheet.columns;
  moveTo(ids[9],items.findIndex(item=>item.id===ids[5])+1);expect(group.members).toEqual(original);
  const current=axis==='row'?sheet.rows:sheet.columns;
  moveTo(ids[3],current.findIndex(item=>item.id===ids[5]));expect(group.members).toEqual(original);
});

it('scoped row moves inherit destination groups without moving the table header or outside rows',()=>{
  const book=createDemo(),sheet=blankSheet('Scoped group movement',10,4);book.sheets.push(sheet);
  const ids=sheet.rows.map(row=>row.id),table={id:'scoped',name:'Scoped',sheet:sheet.id,header:ids[0],rows:ids.slice(1,9),columns:[{id:'field',column:sheet.columns[0].id,name:'Value'}]};
  book.tables.push(table);sheet.groups=[{id:'target',axis:'row',kind:'summary',members:ids.slice(2,6),collapsed:false,label:'Target'}];
  setInput(book,sheet,ids[8],sheet.columns[0].id,'Existing record');const cells=clone(sheet.cells);
  moveRows(book,sheet,[ids[8]],4,table);
  expect(sheet.groups[0].members).toEqual([ids[2],ids[3],ids[8],ids[4],ids[5]]);
  expect(sheet.rows[0].id).toBe(ids[0]);expect(sheet.rows[9].id).toBe(ids[9]);
  expect(sheet.cells).toEqual(cells);expect(table.rows).toEqual(sheet.rows.slice(1,9).map(row=>row.id));
});

it.each(['row','column'] as const)('predicts %s destination groups without changing data, including whole summary moves and outer boundaries',axis=>{
  const book=createDemo(),sheet=blankSheet('Move preview',12,12);book.sheets.push(sheet);
  const ids=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  sheet.groups=[
    {id:'outer',axis,kind:'summary',members:ids.slice(1,8),collapsed:false,label:'Outer'},
    {id:'inner',axis,kind:'summary',members:ids.slice(2,6),collapsed:false,label:'Inner'},
    {id:'source',axis,kind:'summary',members:ids.slice(8,10),collapsed:false,label:'Source'}
  ];
  const before=clone(sheet);
  expect(moveTargetGroups(sheet,axis,[ids[8]],4).map(g=>g.id)).toEqual(['outer','inner']);
  expect(moveTargetGroups(sheet,axis,[ids[8]],1)).toEqual([]);
  expect(moveTargetGroups(sheet,axis,[ids[8]],8)).toEqual([]);
  expect(sheet).toEqual(before);
  if(axis==='row')moveRows(book,sheet,[ids[8]],4);else moveColumns(book,sheet,[ids[8]],4);
  for(const group of sheet.groups.filter(g=>g.id!=='source'))expect(group.members).toEqual(expect.arrayContaining(ids.slice(8,10)));
  expect(sheet.groups.find(g=>g.id==='source')!.members).toEqual(ids.slice(8,10));
});

it('predicts destination membership using scoped row slots and rejects header moves',()=>{
  const sheet=blankSheet('Scoped preview',12,4),ids=sheet.rows.map(row=>row.id);
  const table={id:'scope',name:'Options',sheet:sheet.id,header:ids[0],rows:[ids[1],ids[3],ids[5],ids[7],ids[9]],columns:[{id:'field',column:sheet.columns[0].id,name:'Value'}]};
  sheet.groups=[{id:'target',axis:'row',kind:'summary',members:[ids[3],ids[5],ids[7]],collapsed:false,label:'Target'}];
  const before=clone(sheet);
  expect(moveTargetGroups(sheet,'row',[ids[9]],5,table).map(g=>g.id)).toEqual(['target']);
  expect(moveTargetGroups(sheet,'row',[ids[9]],3,table)).toEqual([]);
  expect(()=>moveTargetGroups(sheet,'row',[ids[0]],5,table)).toThrow('list header');
  expect(sheet).toEqual(before);
});

it.each(['row','column'] as const)('dropping a whole %s summary into a collapsed group retains parent containment, formulas and collapsed states',axis=>{
  const book=createDemo(),sheet=blankSheet('Collapsed destination',12,12);book.sheets.push(sheet);
  const ids=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  sheet.groups=[
    {id:'parent',axis,kind:'summary',members:ids.slice(1,6),collapsed:false,label:'Parent'},
    {id:'target',axis,kind:'summary',members:ids.slice(3,6),collapsed:true,label:'Target'},
    {id:'source',axis,kind:'summary',members:ids.slice(8,10),collapsed:false,label:'Source'}
  ];
  setInput(book,sheet,sheet.rows[4].id,sheet.columns[4].id,'23');
  const row=sheet.rows[8].id,column=sheet.columns[8].id;setInput(book,sheet,row,column,'=E5*2');
  const before=clone(sheet),target=groupMoveTarget(sheet,axis,[ids[8]],'target');
  expect(target.boundary).toBe(6);expect(target.members).toEqual(ids.slice(8,10));expect(sheet).toEqual(before);
  expect(moveIntoGroup(book,sheet,axis,[ids[8]],'target')).toBe(6);
  expect(sheet.groups[1]).toMatchObject({collapsed:true,members:[...ids.slice(3,6),...ids.slice(8,10)]});
  expect(sheet.groups[0].members).toEqual([...ids.slice(1,6),...ids.slice(8,10)]);
  expect(sheet.groups[2]).toEqual(before.groups[2]);expect(sheet.cells).toEqual(before.cells);
  expect(new Engine(book).cell(sheet.id,row,column)).toBe(46);
  const moved=clone(sheet);expect(()=>moveIntoGroup(book,sheet,axis,[ids[3]],'target')).toThrow('itself');expect(sheet).toEqual(moved);
});

it.each(['row','column'] as const)('moving a nested %s group out detaches every old parent without destroying the moved group or touching cells',axis=>{
  const book=createDemo(),sheet=blankSheet('Nested move out',14,14);book.sheets.push(sheet);
  const ids=(axis==='row'?sheet.rows:sheet.columns).map(item=>item.id);
  sheet.groups=[
    {id:'parent',axis,kind:'summary',members:ids.slice(1,10),collapsed:false,label:'Parent'},
    {id:'variation',axis,kind:'summary',members:ids.slice(5,9),collapsed:false,label:'Variation'},
    {id:'plain',axis,kind:'range',members:ids.slice(1,10),collapsed:false,label:'Plain'},
    {id:'moved',axis,kind:'summary',members:ids.slice(6,8),collapsed:false,label:'Moved'}
  ];
  const before=clone(sheet),moving=ids.slice(6,8);
  if(axis==='row')moveRows(book,sheet,[moving[0]],14);else moveColumns(book,sheet,[moving[0]],14);
  for(const group of sheet.groups.filter(g=>g.id!=='moved'))for(const id of moving)expect(group.members).not.toContain(id);
  expect(sheet.groups.find(g=>g.id==='moved')).toEqual(before.groups[3]);
  expect(sheet.cells).toEqual(before.cells);
  expect(outlineGroups(sheet.groups).find(g=>g.group.id==='moved')!.depth).toBe(1);
  if(axis==='row'){
    const layout=summaryRowLayout(sheet.groups,sheet.rows.map(r=>r.id),true,()=>true);
    expect(layout.get(moving[0])!.buttons[0].left).toBe(0);
    expect(layout.get(moving[1])!.rails.map(r=>r.group.id)).toEqual(['moved']);
    expect(layout.get(sheet.rows[8].id)?.rails??[]).toEqual([]);
  }
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
