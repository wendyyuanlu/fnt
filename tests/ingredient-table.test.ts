import {describe,it,expect} from 'vitest';
import {addIngredientTableRow,addIngredientTableRows,moveIngredientTableRow,deleteIngredientTableRow} from '../src/ingredient-table';
import {addDraftFood,ingredientList,ingredientRecord,rememberIngredients} from '../src/food-capture';
import {writeIngredientValues} from '../src/ingredient-edit';
import {addRow,blankSheet,clone,insertTableRows,setInput,type Scalar,type Workbook} from '../src/model';
import {compile,Engine,scalar} from '../src/formula';

function fixture():Workbook{
  const sheet=blankSheet('Ingredients',8,6),names=['Ingredients','Serving (g)','Calories','Type','Calculated','Notes'];
  const table={id:'ingredients',name:'Ingredients',sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1,4).map(row=>row.id),columns:sheet.columns.map((column,i)=>({id:'f'+i,column:column.id,name:names[i]}))};
  const book:Workbook={schema:1,id:'book',revision:0,title:'Synthetic TABLE',sheets:[sheet],tables:[table],names:[],pickerSources:{}};
  for(const field of table.columns)sheet.cells[table.header+':'+field.column]={value:field.name};
  table.rows.forEach((row,i)=>{
    sheet.cells[row+':'+table.columns[0].column]={value:'Invented '+i};
    sheet.cells[row+':'+table.columns[1].column]={value:100};
    sheet.cells[row+':'+table.columns[2].column]={value:200+i};
    sheet.cells[row+':'+table.columns[4].column]={formula:compile('=[@Calories]/[@[Serving (g)]]',book,sheet.id,row,table.columns[4].column)};
  });
  rememberIngredients(book);return book;
}
describe('real Ingredients TABLE rows',()=>{
  it('prefers the nearest following calculated donor until an initialized preceding donor exists',()=>{
    const book=fixture(),table=book.tables[0],sheet=book.sheets[0],column=table.columns[4].column;
    sheet.cells[table.rows[0]+':'+column]={value:1};
    setInput(book,sheet,table.rows[1],column,'=22');setInput(book,sheet,table.rows[2],column,'=33');
    const snapshots:Scalar[][]=[];
    const run=(target:Workbook,batch:boolean)=>{
      const owner=target.tables[0],page=target.sheets[0],at=page.rows.findIndex(row=>row.id===owner.rows[1]),seen:Scalar[]=[];
      const write=(row:string,index:number)=>{
        seen.push(scalar(new Engine(target).cell(page.id,row,column)));
        if(index===0)setInput(target,page,row,column,'=44');
      };
      if(batch)insertTableRows(target,page,at,2,owner,(row,index)=>write(row.id,index));
      else for(let index=0;index<2;index++)write(addRow(target,page,at+index,owner).id,index);
      snapshots.push(seen);
      let json=JSON.stringify(target);page.rows.forEach((row,index)=>{json=json.replaceAll(row.id,'row-'+index);});
      return JSON.parse(json);
    };
    expect(run(clone(book),true)).toEqual(run(clone(book),false));
    expect(snapshots).toEqual([[22,44],[22,44]]);
  });
  it('updates sparse donor presence and absence after each initialized row, including retained calculations',()=>{
    const book=fixture(),column=book.tables[0].columns[4].column;
    for(const row of book.tables[0].rows)book.sheets[0].cells[row+':'+column]={value:7};
    const snapshots:Scalar[][]=[];
    const run=(target:Workbook,batch:boolean)=>{
      const seen:Scalar[]=[];
      const write=(row:string,index:number)=>{
        seen.push(scalar(new Engine(target).cell(target.sheets[0].id,row,column)));
        setInput(target,target.sheets[0],row,target.tables[0].columns[0].column,"'Sparse donor "+index);
        if(index===0)setInput(target,target.sheets[0],row,column,'=42');
        if(index===1){setInput(target,target.sheets[0],row,column,'7');delete target.sheets[0].cells[row+':'+column].calculation;}
        if(index===2){setInput(target,target.sheets[0],row,column,'=99');setInput(target,target.sheets[0],row,column,'9');}
      };
      if(batch)addIngredientTableRows(target,4,(identity,index)=>write(identity.row,index));
      else for(let index=0;index<4;index++)write(addIngredientTableRow(target).row,index);
      snapshots.push(seen);
      let json=JSON.stringify(target);
      target.sheets[0].rows.forEach((row,index)=>{json=json.replaceAll(row.id,'row-'+index);});
      return JSON.parse(json);
    };
    expect(run(clone(book),true)).toEqual(run(clone(book),false));
    expect(snapshots).toEqual([[null,42,42,99],[null,42,42,99]]);
  });
  it('preserves prefix-dependent marker/template parity and demonstrates the unsafe final-membership counterexample',()=>{
    const book=fixture(),table=book.tables[0],sheet=book.sheets[0],marker=table.columns[5],calculated=table.columns[4];
    marker.name='isDay';
    setInput(book,sheet,table.rows[0],marker.column,'FALSE');
    setInput(book,sheet,table.rows[1],marker.column,'TRUE');
    setInput(book,sheet,table.rows[2],marker.column,'=IF(ROWS(Ingredients[Ingredients])>=5,TRUE,FALSE)');
    setInput(book,sheet,table.rows[0],calculated.column,'=11');
    setInput(book,sheet,table.rows[1],calculated.column,'=33');
    setInput(book,sheet,table.rows[2],calculated.column,'=22');
    const before=clone(book),sequential=clone(book),unsafe=clone(book),fixed=clone(book);
    const write=(target:Workbook,row:string,index:number)=>setInput(target,target.sheets[0],row,target.tables[0].columns[0].column,"'Marker parity "+index);
    const expected=Array.from({length:3},(_,index)=>{const identity=addIngredientTableRow(sequential);write(sequential,identity.row,index);return identity;});
    const unsafeAt=unsafe.sheets[0].rows.findIndex(row=>row.id===unsafe.tables[0].rows.at(-1))+1;
    const unsafeRows=insertTableRows(unsafe,unsafe.sheets[0],unsafeAt,3,unsafe.tables[0],(row,index)=>write(unsafe,row.id,index));
    const actual=addIngredientTableRows(fixed,3,(identity,index)=>write(fixed,identity.row,index));
    const values=(target:Workbook,rows:readonly {row:string}[])=>{
      const engine=new Engine(target);return rows.map(({row})=>engine.cell(target.sheets[0].id,row,calculated.column));
    };
    expect(values(unsafe,unsafeRows.map(row=>({row:row.id})))).toEqual([11,11,11]);
    expect(values(sequential,expected)).toEqual([22,11,11]);
    expect(values(fixed,actual)).toEqual([22,11,11]);
    const cells=(target:Workbook,rows:typeof actual)=>rows.map(({row})=>target.tables[0].columns.map(column=>target.sheets[0].cells[row+':'+column.column]));
    expect(cells(fixed,actual)).toEqual(cells(sequential,expected));
    expect(book).toEqual(before);
  });
  it('does not use future empty batch rows as templates when the Ingredients table starts empty',()=>{
    const book=fixture();book.tables[0].rows=[];
    const sequential=clone(book),batch=clone(book);
    const write=(target:Workbook,row:string,index:number)=>setInput(target,target.sheets[0],row,target.tables[0].columns[0].column,"'Empty batch "+index);
    const expected=Array.from({length:3},(_,index)=>{const identity=addIngredientTableRow(sequential);write(sequential,identity.row,index);return identity;});
    const actual=addIngredientTableRows(batch,3,(identity,index)=>write(batch,identity.row,index));
    const cells=(target:Workbook,rows:typeof actual)=>rows.map(({row})=>target.tables[0].columns.map(column=>target.sheets[0].cells[row+':'+column.column]));
    expect(cells(batch,actual)).toEqual(cells(sequential,expected));
    expect(batch.sheets[0].cells[actual[0].row+':'+batch.tables[0].columns[4].column]).toBeUndefined();
  });
  it.each([false,true])('batch append matches repeated additions for formulas, dropdowns and neighbors (size-dependent marker: %s)',withMarker=>{
    const book=fixture(),table=book.tables[0],sheet=book.sheets[0],last=table.rows.at(-1)!;
    if(withMarker){
      table.columns[5].name='isDay';
      for(const row of table.rows)setInput(book,sheet,row,table.columns[5].column,'=ROWS(Ingredients[Ingredients])>4');
    }
    sheet.columns[4].wrap=true;
    setInput(book,sheet,last,table.columns[4].column,'=C4+$B$2+B5');
    setInput(book,sheet,last,table.columns[4].column,'9');
    const foreign={id:'foreign',label:'Foreign'};sheet.columns.push(foreign);
    sheet.cells[last+':'+foreign.id]={value:'Do not copy'};
    sheet.validations.push({id:'type-validation',sheet:sheet.id,source:'',values:['Packaged','Homemade'],rows:[last],columns:[table.columns[3].column,foreign.id]});
    sheet.groups.push({id:'existing-range',axis:'row',members:table.rows.slice(1),kind:'range',collapsed:true,label:'Keep'});
    const sequential=clone(book),batch=clone(book);
    const write=(target:Workbook,row:string,index:number)=>{
      const owner=target.tables[0],page=target.sheets[0];
      setInput(target,page,row,owner.columns[0].column,"'Batch "+index);
      setInput(target,page,row,owner.columns[1].column,'50');
      setInput(target,page,row,owner.columns[2].column,String(80+index));
      setInput(target,page,row,owner.columns[3].column,"'Homemade");
    };
    for(let index=0;index<4;index++)write(sequential,addIngredientTableRow(sequential).row,index);
    const identities=addIngredientTableRows(batch,4,(identity,index)=>write(batch,identity.row,index));
    const normalize=(target:Workbook)=>{
      let json=JSON.stringify(target);
      target.sheets.forEach((page,s)=>{page.rows.forEach((row,r)=>{json=json.replaceAll(row.id,`row-${s}-${r}`);});page.validations.forEach((validation,v)=>{json=json.replaceAll(validation.id,`validation-${s}-${v}`);});});
      return JSON.parse(json);
    };
    expect(normalize(batch)).toEqual(normalize(sequential));
    expect(identities.map(identity=>identity.row)).toEqual(batch.tables[0].rows.slice(-4));
    expect(batch.sheets[0].cells[last+':'+foreign.id]).toEqual(sheet.cells[last+':'+foreign.id]);
  });
  it('creates a blank real row with inherited formulas and makes its entered name available without a Draft',()=>{
    const book=fixture(),table=book.tables[0],identity=addIngredientTableRow(book);
    expect(table.rows.at(-1)).toBe(identity.row);
    expect(ingredientList(book)).toHaveLength(3);
    expect(ingredientList(book,undefined,{includeBlank:true})).toHaveLength(4);
    writeIngredientValues(book,identity,{food:'New invented ingredient',weight:'50',calories:'80'});
    expect(ingredientList(book).at(-1)?.values.food).toBe('New invented ingredient');
    expect(new Engine(book).cell(table.sheet,identity.row,table.columns[4].column)).toBe(1.6);
    expect(book.foodCapture?.foods).toEqual([]);
  });
  it('inserts and moves stable identities after table, sheet and column renames',()=>{
    const book=fixture(),table=book.tables[0],identity={table:table.id,row:table.rows[0]},last=table.rows[2];
    table.name='Sources renamed';book.sheets[0].name='Pantry';table.columns[0].name='Name renamed';table.columns.reverse();book.sheets[0].columns.reverse();
    const linked=addDraftFood(book,45000);linked.ingredient=identity;
    const inserted=addIngredientTableRow(book,identity);
    expect(table.rows.slice(0,2)).toEqual([identity.row,inserted.row]);
    moveIngredientTableRow(book,identity,1);
    expect(table.rows.slice(0,2)).toEqual([inserted.row,identity.row]);
    expect(table.rows.at(-1)).toBe(last);
    expect(ingredientRecord(book,linked.ingredient).values.food).toBe('Invented 0');
  });
  it.each(['draft','binding','formula','lookup','dynamic','shared'] as const)('rejects unsafe %s deletion without removing data',kind=>{
    const book=fixture(),table=book.tables[0],sheet=book.sheets[0],row=table.rows[0],outside=sheet.rows[6].id,column=sheet.columns[0].id;
    if(kind==='draft')addDraftFood(book,45000).ingredient={table:table.id,row};
    if(kind==='binding')sheet.cells[outside+':'+column]={binding:{table:table.id,row,column:table.columns[0].id}};
    if(kind==='formula')sheet.cells[outside+':'+column]={formula:compile('=A2',book,sheet.id,outside,column)};
    if(kind==='lookup')sheet.cells[outside+':'+column]={value:'Invented 0'};
    if(kind==='dynamic')sheet.cells[outside+':'+column]={formula:compile('=INDIRECT("B2")',book,sheet.id,outside,column)};
    if(kind==='shared'){
      const extra={id:'outside',label:'Extra'};sheet.columns.push(extra);sheet.cells[row+':'+extra.id]={value:'Keep'};
    }
    const before=structuredClone(book);
    expect(()=>deleteIngredientTableRow(book,{table:table.id,row})).toThrow();
    expect(book).toEqual(before);
  });
  it('deletes an unused row and can recreate a row in an empty table',()=>{
    const book=fixture(),table=book.tables[0];
    for(const row of [...table.rows])deleteIngredientTableRow(book,{table:table.id,row});
    expect(table.rows).toHaveLength(0);
    const added=addIngredientTableRow(book);
    expect(ingredientRecord(book,added).values.food).toBe('');
  });
});
