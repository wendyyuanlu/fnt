import {describe,it,expect} from 'vitest';
import {blankSheet,key,type Workbook,type Table} from '../src/model';
import {numericKeyboardFields,numericKeyboardCell} from '../src/touch-keyboard';

function fixture(){
  const sheet=blankSheet('Keyboard',8,20);
  const book:Workbook={schema:1,id:'book',title:'Invented',revision:0,sheets:[sheet],tables:[],names:[],pickerSources:{}};
  const table=(name:string,headers:string[],offset=0)=>{
    const table:Table={id:name, name,sheet:sheet.id,header:sheet.rows[0].id,rows:sheet.rows.slice(1,4).map(r=>r.id),columns:headers.map((name,i)=>({id:`field-${i}`,column:sheet.columns[offset+i].id,name}))};
    book.tables.push(table);return table;
  };
  return{book,sheet,table};
}
describe('touch number-keyboard hints',()=>{
  it('targets exactly the requested fields in each nutrition table',()=>{
    for(const [name,numeric,plain]of [
      ['Master',['Weight','Amount (g)','Amount'],['Date','Food','Unit','Calories']],
      ['Meals',['Amount (g)','Amount'],['Meal','Portions','Unit','Protein (g)']],
      ['Ingredients',['Serving (g)','Conversion Amount','Calories (kcal)','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)'],['Ingredients','Conversion Unit','Type']],
    ] as const){
      const {book,sheet,table}=fixture(),owner=table(name,[...numeric,...plain]),fields=numericKeyboardFields(book);
      for(const field of owner.columns)expect(numericKeyboardCell(book,sheet.id,sheet.rows[1].id,field.column,fields)).toBe((numeric as readonly string[]).includes(field.name));
    }
  });
  it('does not apply hints to headers, outside-table cells, or unrelated tables',()=>{
    const {book,sheet,table}=fixture(),owner=table('Master',['Weight','Amount']),unrelated=table('Notes',['Amount'],5);
    table('constructor',['Amount'],8);
    const fields=numericKeyboardFields(book);
    expect(numericKeyboardCell(book,sheet.id,owner.header,owner.columns[0].column,fields)).toBe(false);
    expect(numericKeyboardCell(book,sheet.id,sheet.rows[7].id,owner.columns[0].column,fields)).toBe(false);
    expect(numericKeyboardCell(book,sheet.id,sheet.rows[1].id,unrelated.columns[0].column,fields)).toBe(false);
  });
  it('retains semantic field identities after moves, renames and reloading remembered identities',()=>{
    const {book,sheet,table}=fixture(),owner=table('Ingredients',['Serving (g)','Ingredients']),field=owner.columns[0],remembered=numericKeyboardFields(book);
    owner.name='Pantry';field.name='Portion mass';sheet.columns.reverse();owner.columns.reverse();
    const loaded=structuredClone(book),fields=numericKeyboardFields(loaded,new Set(JSON.parse(JSON.stringify([...remembered]))));
    expect(numericKeyboardCell(loaded,sheet.id,sheet.rows[1].id,field.column,fields)).toBe(true);
    loaded.tables[0].columns=loaded.tables[0].columns.filter(c=>c.id!==field.id);
    expect(numericKeyboardFields(loaded,fields).size).toBe(0);
    expect(book.sheets[0].cells[key(sheet.rows[1].id,field.column)]).toBeUndefined();
  });
});
