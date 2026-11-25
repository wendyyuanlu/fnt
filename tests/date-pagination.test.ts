import {expect,it} from 'vitest';
import {buildDatePages,pageForDate,paginationDefault,validatePagination} from '../src/date-pagination';
import {createDemo,key,moveColumns,renameColumn,uid} from '../src/model';
import {Engine} from '../src/formula';
import {excelDate} from '../src/dates';

function fixture(offsets=[0,89,90,179,180,200]){
  const book=createDemo(),s=book.sheets.find(s=>s.name==='Notebook')!,latest=excelDate(2026,11,25)!;
  while(s.rows.length<offsets.length*2+1)s.rows.push({id:uid()});
  const table={id:uid(),name:'Master',sheet:s.id,header:s.rows[0].id,rows:s.rows.slice(1,offsets.length*2+1).map(r=>r.id),columns:['Date','isDay','Details'].map((name,i)=>({id:uid(),name,column:s.columns[i].id}))};
  book.tables.push(table);
  offsets.forEach((offset,i)=>{
    const header=s.rows[i*2+1].id,detail=s.rows[i*2+2].id;
    s.cells[key(header,s.columns[0].id)]={value:latest-offset,format:{number:'date'}};
    s.cells[key(header,s.columns[1].id)]={value:true};
    s.cells[key(detail,s.columns[1].id)]={value:false};
    s.cells[key(detail,s.columns[2].id)]={value:'Invented detail',note:'Keep note'};
    s.groups.push({id:uid(),axis:'row',kind:'summary',members:[header,detail],collapsed:false,label:'Synthetic day'});
  });
  return{book,s,table,latest,config:paginationDefault(book,s)!};
}
it('uses inclusive 90-calendar-day windows, newest first, keeping day details together',()=>{
  const {book,s,config,latest}=fixture(),before=structuredClone(book),plan=buildDatePages(book,s,config,new Engine(book));
  expect(plan.ranges).toEqual([{start:latest-89,end:latest},{start:latest-179,end:latest-90},{start:latest-200,end:latest-180}]);
  expect(plan.pages).toEqual([[3,4,1,2],[7,8,5,6],[11,12,9,10]]);
  expect([latest,latest-89,latest-90,latest-179,latest-200,latest-201,latest+1].map(date=>pageForDate(plan,date))).toEqual([0,0,1,1,2,-1,-1]);
  expect(plan.unassigned).toEqual([]);expect(book).toEqual(before);
});
it('counts calendar dates rather than logged entries and exposes empty gap windows',()=>{
  const {book,s,config}=fixture([0,270]),plan=buildDatePages(book,s,config,new Engine(book));
  expect(plan.pages).toEqual([[1,2],[],[],[3,4]]);
});
it('renders 90, 90 and 20 day entries for a 200-day log without splitting groups',()=>{
  const {book,s,config}=fixture(Array.from({length:200},(_,i)=>i));
  expect(buildDatePages(book,s,config,new Engine(book)).pages.map(rows=>rows.length/2)).toEqual([90,90,20]);
});
it('keeps undated records and freeform notes accessible without assigning invented dates',()=>{
  const {book,s,table,config}=fixture([0]),header=s.rows[3].id,detail=s.rows[4].id;
  table.rows.push(header,detail);s.cells[key(header,s.columns[1].id)]={value:true};
  s.cells[key(detail,s.columns[2].id)]={value:'Unassigned'};
  s.cells[key(s.rows[20].id,s.columns[4].id)]={note:'Independent worksheet note'};
  expect(buildDatePages(book,s,config,new Engine(book)).unassigned).toEqual([3,4,20]);
});
it('uses stable table and field identities through moves and renames and reports missing references',()=>{
  const {book,s,table,config}=fixture([0]),field=table.columns[0];
  renameColumn(book,table,field.id,'Recorded date');moveColumns(book,s,[field.column],s.columns.length);table.name='Renamed log';
  expect(buildDatePages(book,s,config,new Engine(book)).pages).toEqual([[1,2]]);
  table.columns=table.columns.filter(c=>c.id!==field.id);
  expect(()=>buildDatePages(book,s,config,new Engine(book))).toThrow('field is missing');
});
it('rejects invalid page widths and keeps non-Master sheets continuous by default',()=>{
  const {book,s,config}=fixture();
  for(const days of [0,-1,0.5,NaN,Infinity])expect(()=>validatePagination({...config,days})).toThrow('positive whole number');
  expect(paginationDefault(book,book.sheets[0])).toBeUndefined();expect(paginationDefault(book,s)?.days).toBe(90);
});
