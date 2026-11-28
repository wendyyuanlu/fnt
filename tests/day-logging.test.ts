import {expect,it} from 'vitest';
import {Engine,scalar} from '../src/formula';
import {blankSheet,clone,getCell,key,moveRows,renameColumn,setInput,type Workbook} from '../src/model';
import {addMasterFood,addMasterFoods,anchorMasterDates,createMasterDay,editMasterDayInput,editMasterDayInputs,localToday,masterDayBlocks,masterLogging,refreshMasterFoodDates,validateDayLogging} from '../src/day-logging';
import {defaultHeaderFormula} from '../src/meal-block';
import {excelDate} from '../src/dates';
import {writeGridCell} from '../src/reference-grid';
import {hypotheticalProjection} from '../src/grouping';
import {validateBook} from '../src/storage';
import {renameTable} from '../src/table-management';

function fixture(){
  const sheet=blankSheet('Master',5,3),book:Workbook={schema:1,id:'book',title:'Synthetic days',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  const table={id:'master',name:'Master',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1).map(row=>row.id),columns:['Date','isDay','Food'].map((name,i)=>({id:'field-'+i,name,column:sheet.columns[i].id}))};
  book.tables.push(table);table.columns.forEach(field=>sheet.cells[key(table.header,field.column)]={value:field.name});
  const input=(r:number,c:number,text:string)=>setInput(book,sheet,sheet.rows[r].id,sheet.columns[c].id,text);
  input(1,1,'TRUE');input(3,1,'TRUE');input(1,0,'=DATE(2026,11,20)');input(2,0,'=A2');
  input(3,0,'=INDEX(Master[Date],ROW()-ROW(Master[#Headers])-1)+1');input(4,0,'=A4');
  input(2,2,'Invented food A');input(4,2,'Invented food B');
  sheet.pagination={mode:'calendar',days:90,table:table.id,column:table.columns[0].id,marker:table.columns[1].id};
  return{book,sheet,table,input};
}
it('anchors header dates before a whole-block move, retaining original calculations, food formulas and identities',()=>{
  const {book,sheet,table}=fixture(),before=clone(book),engine=new Engine(book),dates=table.rows.map(row=>scalar(engine.cell(sheet.id,row,table.columns[0].column)));
  expect(anchorMasterDates(book,sheet,engine)).toBe(2);
  for(const i of [1,3]){
    const address=key(before.sheets[0].rows[i].id,table.columns[0].column);
    expect(sheet.cells[address].calculation).toEqual(before.sheets[0].cells[address].formula);expect(sheet.cells[address].formula).toBeUndefined();
  }
  for(const i of [2,4])expect(getCell(sheet,before.sheets[0].rows[i].id,table.columns[0].column)).toEqual(getCell(before.sheets[0],before.sheets[0].rows[i].id,table.columns[0].column));
  moveRows(book,sheet,before.sheets[0].rows.slice(3,5).map(row=>row.id),1);
  const after=new Engine(book);expect(before.tables[0].rows.map(row=>scalar(after.cell(sheet.id,row,table.columns[0].column)))).toEqual(dates);
  expect(new Set(sheet.rows.map(row=>row.id))).toEqual(new Set(before.sheets[0].rows.map(row=>row.id)));expect(anchorMasterDates(book,sheet,after)).toBe(0);
});
it('uses configured identities after field renames and does not partially anchor invalid dates',()=>{
  const {book,sheet,table,input}=fixture();table.name='Renamed days';table.columns[0].name='When';table.columns[1].name='Header';
  input(3,0,'=1/0');const before=clone(book);expect(()=>anchorMasterDates(book,sheet)).toThrow('no valid calculated date');expect(book).toEqual(before);
  input(3,0,'=DATE(2026,11,21)');expect(anchorMasterDates(book,sheet)).toBe(2);
});
function loggingFixture(){
  const sheet=blankSheet('Master',9,6),book:Workbook={schema:1,id:'book',title:'Invented logging',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  const table={id:'master',name:'Master',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1,7).map(row=>row.id),columns:['Date','isDay','Weight','Food','Calories','Notes'].map((name,i)=>({id:'field-'+i,name,column:sheet.columns[i].id,formulaDefault:i===4?'=IF([@Food]="",0,5)':undefined}))};
  book.tables.push(table);table.columns.forEach(field=>setInput(book,sheet,table.header,field.column,field.name));
  const input=(r:number,c:number,value:string)=>setInput(book,sheet,sheet.rows[r].id,sheet.columns[c].id,value);
  for(let r=1;r<=6;r++)input(r,1,'=[@Weight]<>""');
  input(1,2,'x');input(4,2,'(Tues)');
  input(1,0,'=DATE(2026,11,20)');input(2,0,'=A2');input(3,0,'=A3');input(4,0,'=A4+1');input(5,0,'=A5');input(6,0,'=A6');
  for(const r of [1,4]){input(r,4,defaultHeaderFormula(book,table,table.columns[4].id));sheet.groups.push({id:'group-'+r,axis:'row',kind:'summary',members:sheet.rows.slice(r,r+3).map(row=>row.id),collapsed:false,label:'Invented day'});}
  for(const [r,value]of [[2,10],[3,20],[5,30],[6,40]]){input(r,4,String(value));input(r,3,'Invented item '+r);}
  input(2,5,'Preserve this invented note');
  sheet.dayLogging={...masterLogging(book,sheet).config,nextDate:excelDate(2026,11,22)!};
  const value=(row:string,c:number)=>scalar(new Engine(book).cell(sheet.id,row,table.columns[c].column));
  return{book,sheet,table,input,value};
}
it.each(['tail','middle','marker','binding','default'] as const)('preserves sequential food dates, formulas, groups, dropdowns and neighbors when appending to a %s day',kind=>{
  const {book,sheet,table,input}=loggingFixture();
  for(const column of table.columns)delete column.formulaDefault;
  for(const row of table.rows)sheet.cells[key(row,table.columns[1].column)]={value:[sheet.rows[1].id,sheet.rows[4].id].includes(row)};
  if(kind==='marker')input(6,1,'=IF(ROWS(Master[Food])>=8,TRUE,FALSE)');
  if(kind==='default')table.columns[5].formulaDefault='=A7';
  input(6,5,'=E7+$E$3');input(6,5,'25');
  if(kind==='binding'){
    input(5,5,'=IF(ROWS(Master[Food])>=8,TRUE,FALSE)');
    sheet.cells[key(sheet.rows[6].id,table.columns[1].column)]={binding:{table:table.id,row:sheet.rows[5].id,column:table.columns[5].id}};
  }
  sheet.columns[5].wrap=true;
  sheet.validations.push({id:'food-choice',sheet:sheet.id,source:'',values:['Invented 0','Invented 1'],rows:[sheet.rows[6].id],columns:[table.columns[3].column]});
  sheet.groups.push({id:'nested',axis:'row',kind:'range',members:sheet.rows.slice(4,7).map(row=>row.id),collapsed:true,label:'Keep this group'});
  input(8,3,'Preserve outside-table neighbor');
  const before=clone(book),sequential=clone(book),batch=clone(book),header=sheet.rows[kind==='middle'?1:4].id;
  const write=(target:Workbook,row:string,index:number)=>{
    setInput(target,target.sheets[0],row,target.tables[0].columns[3].column,"'Invented "+index);
    setInput(target,target.sheets[0],row,target.tables[0].columns[4].column,String(12+index));
  };
  for(let index=0;index<3;index++)write(sequential,addMasterFood(sequential,sequential.sheets[0],header),index);
  const rows=addMasterFoods(batch,batch.sheets[0],3,header,(row,index)=>write(batch,row,index));
  const normalize=(target:Workbook)=>{
    let json=JSON.stringify(target);
    target.sheets.forEach((page,s)=>{
      page.rows.forEach((row,r)=>{json=json.replaceAll(row.id,`row-${s}-${r}`);});
      page.validations.forEach((validation,v)=>{json=json.replaceAll(validation.id,`validation-${s}-${v}`);});
      page.groups.forEach((group,g)=>{json=json.replaceAll(group.id,`group-${s}-${g}`);});
    });
    return JSON.parse(json);
  };
  expect(normalize(batch)).toEqual(normalize(sequential));
  const evaluated=(target:Workbook)=>{
    const page=target.sheets[0],owner=target.tables[0],engine=new Engine(target);
    return owner.rows.map(row=>[scalar(engine.cell(page.id,row,owner.columns[0].column)),scalar(engine.cell(page.id,row,owner.columns[4].column))]);
  };
  expect(evaluated(batch)).toEqual(evaluated(sequential));
  expect(rows).toHaveLength(3);expect(book).toEqual(before);validateBook(batch);
});
it('creates explicit real days with bounded totals, keeps old formulas and advances only on successful creation',()=>{
  const {book,sheet,table,value}=loggingFixture(),before=clone(book),result=createMasterDay(book,sheet);
  expect(result.created).toBe(true);expect(value(result.row,0)).toBe(excelDate(2026,11,22));expect(value(result.row,4)).toBe(0);
  expect(sheet.dayLogging!.nextDate).toBe(excelDate(2026,11,23));
  const food=masterDayBlocks(book,sheet).find(block=>block.header===result.row)!.rows[1];setInput(book,sheet,food,table.columns[3].column,'Invented new food');
  expect(value(result.row,4)).toBe(5);
  for(const r of [1,4]){const row=before.sheets[0].rows[r].id;expect(getCell(sheet,row,table.columns[4].column)).toEqual(getCell(before.sheets[0],row,table.columns[4].column));}
  sheet.dayLogging!.nextDate=excelDate(2026,11,22)!;const snapshot=clone(book);
  expect(createMasterDay(book,sheet)).toEqual({row:result.row,created:false});expect(book).toEqual(snapshot);
  validateBook(book);
});
it('creates undated hypothetical groups below real days with their own totals and inherited food dates without consuming the cursor',()=>{
  const {book,sheet,table,value}=loggingFixture(),cursor=sheet.dayLogging!.nextDate,hypo=createMasterDay(book,sheet,true);
  const food=addMasterFood(book,sheet,hypo.row);setInput(book,sheet,food,table.columns[4].column,'9');
  expect(value(hypo.row,0)).toBe(null);expect(value(food,0)).toBe(null);expect(value(hypo.row,4)).toBe(9);expect(sheet.dayLogging!.nextDate).toBe(cursor);
  expect(hypotheticalProjection(book,sheet,'row')(food,table.columns[3].column)).toBe(true);
  const real=createMasterDay(book,sheet);expect(masterDayBlocks(book,sheet).at(-1)!.header).toBe(hypo.row);expect(value(real.row,0)).toBe(cursor);
  const more=addMasterFood(book,sheet,real.row);expect(value(more,0)).toBe(cursor);expect(sheet.dayLogging!.nextDate).toBe(cursor!+1);
  validateBook(book);
});
it('corrects a day date chronologically with all record identities, notes, nested groups and overrides preserved',()=>{
  const {book,sheet,table,value}=loggingFixture(),header=sheet.rows[4].id,oldRows=sheet.rows.map(row=>row.id),oldGroups=clone(sheet.groups),note=getCell(sheet,sheet.rows[2].id,table.columns[5].column),cursor=sheet.dayLogging!.nextDate;
  editMasterDayInput(book,sheet,header,table.columns[0].column,()=>writeGridCell(book,sheet,header,table.columns[0].column,String(excelDate(2026,11,19))));
  expect(table.rows[0]).toBe(header);expect(value(header,0)).toBe(excelDate(2026,11,19));
  expect(value(oldRows[5],0)).toBe(excelDate(2026,11,19));expect(value(oldRows[6],4)).toBe(40);
  expect(getCell(sheet,oldRows[2],table.columns[5].column)).toEqual(note);expect(sheet.groups).toEqual(oldGroups);expect(new Set(sheet.rows.map(row=>row.id))).toEqual(new Set(oldRows));expect(sheet.dayLogging!.nextDate).toBe(cursor);
});
it('supports direct-grid day creation in a plain row and keeps explicit pasted dates stable',()=>{
  const {book,sheet,table,value}=loggingFixture(),row=sheet.rows[7].id,cursor=sheet.dayLogging!.nextDate!;
  editMasterDayInput(book,sheet,row,table.columns[2].column,()=>writeGridCell(book,sheet,row,table.columns[2].column,'x'));
  expect(value(row,0)).toBe(cursor);expect(sheet.dayLogging!.nextDate).toBe(cursor+1);
  const next=sheet.rows.find(item=>!table.rows.includes(item.id)&&item.id!==table.header)!.id;
  editMasterDayInputs(book,sheet,[{row:next,column:table.columns[0].column},{row:next,column:table.columns[2].column}],()=>{
    writeGridCell(book,sheet,next,table.columns[0].column,String(excelDate(2026,11,18)));
    writeGridCell(book,sheet,next,table.columns[2].column,'(Example)');
  });
  expect(value(next,0)).toBe(excelDate(2026,11,18));expect(table.rows[0]).toBe(next);expect(sheet.dayLogging!.nextDate).toBe(cursor+2);
});
it('uses saved field identities after renames and updates managed food dates after a whole-row move',()=>{
  const {book,sheet,table,value}=loggingFixture(),oldHeader=sheet.rows[1].id,newHeader=sheet.rows[4].id,food=addMasterFood(book,sheet,oldHeader);
  table.columns[4].formulaDefault='=IF(COUNTIF(master[Food],[@Food])>0,5,0)';
  renameTable(book,table.id,'RenamedLog');for(const field of table.columns)renameColumn(book,table,field.id,'Renamed '+field.id);
  expect(masterLogging(book,sheet).table.id).toBe(table.id);
  moveRows(book,sheet,[food],sheet.rows.findIndex(row=>row.id===table.rows.at(-1))+1);refreshMasterFoodDates(book);
  expect(getCell(sheet,food,table.columns[0].column).formula).toMatchObject({kind:'ref',row:newHeader});
  expect(value(food,0)).toBe(value(newHeader,0));
  const created=createMasterDay(book,sheet),newFood=masterDayBlocks(book,sheet).find(block=>block.header===created.row)!.rows[1];
  setInput(book,sheet,newFood,table.columns[3].column,'Invented renamed food');
  expect(value(created.row,4)).toBe(5);
});
it('uses the local calendar and validates cursor settings rather than silently accepting bad dates',()=>{
  expect(localToday(new Date(2026,0,2,0,1))).toBe(excelDate(2026,1,2));
  const {sheet}=loggingFixture();expect(()=>validateDayLogging({...sheet.dayLogging!,nextDate:NaN})).toThrow('calendar date');
  expect(()=>validateDayLogging({...sheet.dayLogging!,nextDate:0})).toThrow('calendar date');
});
it('promotes a grid-entered header to bounded totals without discarding explicit nutrient overrides',()=>{
  const {book,sheet,table,value}=loggingFixture(),row=sheet.rows[2].id,following=sheet.rows[3].id;
  setInput(book,sheet,row,table.columns[4].column,'=IF([@Food]="",0,5)');
  editMasterDayInput(book,sheet,row,table.columns[2].column,()=>writeGridCell(book,sheet,row,table.columns[2].column,'x'));
  expect(value(row,4)).toBe(value(following,4));
  const overridden=sheet.rows.find(item=>table.rows.includes(item.id)&&value(item.id,1)===false&&value(item.id,4)===40)!.id;
  editMasterDayInput(book,sheet,overridden,table.columns[2].column,()=>writeGridCell(book,sheet,overridden,table.columns[2].column,'x'));
  expect(value(overridden,4)).toBe(40);
});
it('honors explicit legacy dates and planned cursor rules while hypothetical tags match the selected scope',()=>{
  const {book,sheet,table,value}=loggingFixture(),cursor=sheet.dayLogging!.nextDate!;
  const planned=createMasterDay(book,sheet,false,false,{date:excelDate(2026,11,18),advance:false});
  expect(value(planned.row,0)).toBe(excelDate(2026,11,18));expect(sheet.dayLogging!.nextDate).toBe(cursor);
  const real=createMasterDay(book,sheet,false,false,{date:excelDate(2026,11,19),advance:true});
  expect(value(real.row,0)).toBe(excelDate(2026,11,19));expect(sheet.dayLogging!.nextDate).toBe(cursor+1);
  const hypothetical=createMasterDay(book,sheet,true,true);
  const row=sheet.rows.find(row=>row.id===hypothetical.row)!;
  expect(row.hypothetical).toBeUndefined();expect(row.hypotheticalTables).toEqual({[table.id]:true});
  expect(value(row.id,0)).toBe(null);expect(sheet.dayLogging!.nextDate).toBe(cursor+1);
  validateBook(book);
});
it('anchors actual day markers rather than interpreting a numeric Weight as the header predicate',()=>{
  const {book,sheet,table,input}=loggingFixture();delete sheet.dayLogging;
  sheet.pagination={mode:'calendar',days:90,table:table.id,column:table.columns[0].id,marker:table.columns[2].id};
  input(1,2,'0');expect(anchorMasterDates(book,sheet)).toBe(2);
  expect(getCell(sheet,sheet.rows[1].id,table.columns[0].column).formula).toBeUndefined();
});
