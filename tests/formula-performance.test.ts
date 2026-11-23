import {expect,it,vi} from 'vitest';
import {compile,Engine} from '../src/formula';
import {blankSheet,fault,key,setInput,type Workbook} from '../src/model';

function fixture(){
  const sheet=blankSheet('Data',390,8),book:Workbook={schema:1,id:'performance',title:'Performance',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  book.tables.push({id:'data',name:'Data',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1).map(r=>r.id),columns:[{id:'field',name:'Value',column:sheet.columns[0].id}]});
  return{book,sheet,put:(r:number,value:string)=>setInput(book,sheet,sheet.rows[r].id,sheet.columns[0].id,value)};
}
it('shares overlapping exact reference searches without skipping errors or changing duplicate, blank, type or reverse ordering',()=>{
  const {book,sheet,put}=fixture();
  for(let i=1;i<390;i++)put(i,i%19===0?'target':String(i%7));
  put(3,'');put(5,'TARGET');put(129,'TRUE');
  for(const special of [undefined,fault('#N/A'),fault('#UNSUPPORTED!'),fault('#LIMIT!')]){
    if(special)sheet.cells[key(sheet.rows[300].id,sheet.columns[0].id)]={value:special};
    else put(300,'1');
    const engine=new Engine(book),evaluate=(formula:string)=>engine.evaluate(compile(formula,book,sheet.id,sheet.rows[0].id,sheet.columns[7].id),sheet.id,sheet.rows[0].id,sheet.columns[7].id);
    for(const start of [2,127,128,129,250])for(const needle of ['"target"','TRUE','0','"missing"'])for(const direction of [1,-1]){
      engine.beginPass();
      expect(evaluate(`=XMATCH(${needle},A${start}:A390,0,${direction})`)).toEqual(evaluate(`=XMATCH(${needle},IF(TRUE,A${start}:A390,0),0,${direction})`));
      expect(evaluate(`=MATCH(${needle},A${start}:A390,0,${direction})`)).toEqual(evaluate(`=MATCH(${needle},IF(TRUE,A${start}:A390,0),0,${direction})`));
    }
  }
});
it('invalidates overlapping match segments and cached lookups after edits and formula overrides',()=>{
  const {book,sheet,put}=fixture();put(150,'target');put(270,'target');
  const result=sheet.columns[2].id,row=sheet.rows[0].id;
  setInput(book,sheet,row,result,'=XMATCH("target",A2:A390,0)');
  const engine=new Engine(book);expect(engine.cell(sheet.id,row,result)).toBe(150);
  put(150,'other');engine.invalidate([`${sheet.id}:${key(sheet.rows[150].id,sheet.columns[0].id)}`]);
  expect(engine.cell(sheet.id,row,result)).toBe(270);
  put(200,'="TARGET"');engine.invalidate([`${sheet.id}:${key(sheet.rows[200].id,sheet.columns[0].id)}`]);
  expect(engine.cell(sheet.id,row,result)).toBe(200);
  put(300,'=1/0');engine.invalidate([`${sheet.id}:${key(sheet.rows[300].id,sheet.columns[0].id)}`]);
  expect(engine.cell(sheet.id,row,result)).toBe(200);
  put(200,'gone');put(270,'gone');engine.invalidate([200,270].map(r=>`${sheet.id}:${key(sheet.rows[r].id,sheet.columns[0].id)}`));
  expect(engine.cell(sheet.id,row,result)).toMatchObject({error:'#DIV/0!'});
});
it('answers proven scalar reference dimensions without evaluating values but retains error dependencies',()=>{
  const {book,sheet,put}=fixture(),row=sheet.rows[0].id,column=sheet.columns[2].id;
  for(let i=1;i<390;i++)put(i,String(i));
  setInput(book,sheet,row,column,'=ROWS(Data[Value])');
  const engine=new Engine(book),spy=vi.spyOn(engine,'cell');
  expect(engine.cell(sheet.id,row,column)).toBe(389);expect(spy).toHaveBeenCalledTimes(1);
  put(180,'=1/0');engine.invalidate([`${sheet.id}:${key(sheet.rows[180].id,sheet.columns[0].id)}`]);
  expect(engine.cell(sheet.id,row,column)).toMatchObject({error:'#DIV/0!'});
  put(180,'4');engine.invalidate([`${sheet.id}:${key(sheet.rows[180].id,sheet.columns[0].id)}`]);
  expect(engine.cell(sheet.id,row,column)).toBe(389);
});
it('invalidates cached reference matches when a new external spill reaches their blank cells',()=>{
  const {book,sheet,put}=fixture(),row=sheet.rows[0].id,column=sheet.columns[2].id;
  setInput(book,sheet,row,column,'=XMATCH("target",A3:A390,0)');
  const engine=new Engine(book);expect(engine.cell(sheet.id,row,column)).toMatchObject({error:'#N/A'});
  put(1,'=VSTACK("other","target")');engine.invalidate([`${sheet.id}:${key(sheet.rows[1].id,sheet.columns[0].id)}`]);
  expect(engine.cell(sheet.id,row,column)).toBe(1);
});
