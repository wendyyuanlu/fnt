import {describe,it,expect} from 'vitest';
import {addIngredientTableRow,moveIngredientTableRow,deleteIngredientTableRow} from '../src/ingredient-table';
import {addDraftFood,ingredientList,ingredientRecord,rememberIngredients} from '../src/food-capture';
import {writeIngredientValues} from '../src/ingredient-edit';
import {blankSheet,type Workbook} from '../src/model';
import {compile,Engine} from '../src/formula';

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
