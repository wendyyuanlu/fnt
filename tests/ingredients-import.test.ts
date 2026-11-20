import { describe,it,expect } from 'vitest';
import { blankSheet,createDemo,key,setInput,uid,type Table,type Workbook } from '../src/model';
import { compile,Engine } from '../src/formula';
import { mergeIngredients } from '../src/ingredients-import';
import { dropdownCatalog,seedDropdownCatalog } from '../src/dropdown-catalog';
import { referenceChoices,renameReferenceValue } from '../src/references';

function fixture():Workbook {
  const ingredients=blankSheet('Ingredients',12,10),dropdowns=blankSheet('Dropdowns',8,4),mealList=blankSheet('MealDD',4,2);
  const book:Workbook={schema:1,id:uid(),title:'Invented source',revision:0,sheets:[ingredients,dropdowns,mealList],tables:[],names:[],pickerSources:{}};
  const headers=['Ingredients','Serving (g)','Calories (kcal)','Calories2','Protein (g)','Conversion Unit','Type'];
  const table:Table={id:uid(),sheet:ingredients.id,name:'Ingredients',header:ingredients.rows[0].id,rows:ingredients.rows.slice(1,3).map(r=>r.id),
    columns:headers.map((name,i)=>({id:uid(),name,column:ingredients.columns[i].id}))};
  book.tables.push(table);
  [headers,['Invented food',100,200,'=[@[Calories (kcal)]]/[@[Serving (g)]]',10,'g','Pantry'],['Second invented food',50,125,2.7,4,'piece','Pantry']].forEach((row,i)=>row.forEach((value,j)=>setInput(book,ingredients,ingredients.rows[i].id,ingredients.columns[j].id,String(value))));
  ingredients.cells[key(table.rows[0],table.columns[0].column)].format={bold:true,wrap:false,background:'#abcdef'};
  ingredients.cells[key(table.rows[0],table.columns[0].column)].note='Invented note';
  const list:Table={id:uid(),sheet:dropdowns.id,name:'IngredientType',header:dropdowns.rows[0].id,rows:[dropdowns.rows[1].id],columns:[{id:uid(),column:dropdowns.columns[0].id,name:'Ingredient type'}]};
  book.tables.push(list);
  setInput(book,dropdowns,list.header,list.columns[0].column,'Ingredient type');
  setInput(book,dropdowns,list.rows[0],list.columns[0].column,'Pantry');
  ingredients.validations.push({id:uid(),sheet:ingredients.id,rows:table.rows,columns:[table.columns[6].column],source:JSON.stringify(compile('=INDIRECT("IngredientType[Ingredient type]")',book,ingredients.id,table.rows[0],table.columns[6].column))});
  ingredients.validations.push({id:uid(),sheet:ingredients.id,rows:[table.rows[1]],columns:[table.columns[0].column],source:JSON.stringify(compile('=MealDD!A1#',book,ingredients.id,table.rows[1],table.columns[0].column))});
  return book;
}
describe('targeted Ingredients import',()=>{
  it('connects verified original validation to the bundled catalog without replacing edited options or identities',()=>{
    const source=fixture(),old=source.sheets.find(s=>s.name==='Dropdowns')!,dropdowns=blankSheet('Dropdowns',60,4);
    dropdowns.id=old.id;source.sheets[source.sheets.indexOf(old)]=dropdowns;
    for(const spec of dropdownCatalog.lists){
      const at=Number(spec.range.split(':')[0].slice(1))-1;
      const table=source.tables.find(t=>t.name===spec.name)??{id:uid(),sheet:dropdowns.id,name:spec.name,header:'',rows:[],columns:[{id:uid(),column:dropdowns.columns[0].id,name:spec.field}]};
      if(!source.tables.includes(table))source.tables.push(table);
      table.header=dropdowns.rows[at].id;table.rows=spec.values.map((_,i)=>dropdowns.rows[at+i+1].id);table.columns[0].column=dropdowns.columns[0].id;
      dropdowns.cells[key(table.header,table.columns[0].column)]={value:spec.field};
      spec.values.forEach((value,i)=>dropdowns.cells[key(table.rows[i],table.columns[0].column)]={value});
    }
    const current=seedDropdownCatalog(createDemo()).book,catalog=current.references![0],choice=referenceChoices(current,catalog)[0];
    renameReferenceValue(current,catalog,choice.row,'Edited category');catalog.archivedRows.push(choice.row);
    const merged=mergeIngredients(current,source),ingredients=merged.book.tables.find(t=>t.name==='Ingredients')!,sheet=merged.book.sheets.find(s=>s.id===ingredients.sheet)!;
    expect(merged.book.tables.filter(t=>t.name==='IngredientType')).toHaveLength(1);
    const validation=sheet.validations.find(v=>v.originalSource?.includes('IngredientType'))!;
    expect(validation.source).toContain(catalog.table!);
    expect(merged.book.references![0].archivedRows).toEqual([choice.row]);
    expect(referenceChoices(merged.book,merged.book.references![0],true)[0].value).toBe('Edited category');
  });
  it('preserves current identities, records, freeform edits and other sheets while remapping source formulas and dropdowns',()=>{
    const current=createDemo(),source=fixture(),sourceBefore=JSON.stringify(source);
    const old=current.tables.find(t=>t.name==='Ingredients')!,notebook=current.sheets.find(s=>s.name==='Notebook')!;
    const linked=key(notebook.rows[1].id,notebook.columns[0].id);
    notebook.cells[linked]={binding:{table:old.id,row:old.rows[0],column:old.columns[0].id}};
    const currentBefore=JSON.stringify(current);
    const notesBefore=JSON.stringify(notebook),sourceTable=source.tables[0];
    const merged=mergeIngredients(current,source),table=merged.book.tables.find(t=>t.id===old.id)!,engine=new Engine(merged.book);
    expect(merged.rows).toBe(2);expect(merged.retainedRows).toBe(3);expect(merged.columns).toBe(7);
    expect(table.rows).toEqual([...sourceTable.rows,...old.rows]);
    expect(table.columns.find(c=>c.name==='Ingredients')?.id).toBe(old.columns[0].id);
    expect(table.columns.find(c=>c.name==='Calories2')?.id).toBe(old.columns[5].id);
    expect(engine.cell(table.sheet,sourceTable.rows[0],table.columns.find(c=>c.name==='Calories2')!.column)).toBe(2);
    expect(engine.cell(table.sheet,sourceTable.rows[1],table.columns.find(c=>c.name==='Calories2')!.column)).toBe(2.7);
    expect(engine.cell(notebook.id,notebook.rows[1].id,notebook.columns[0].id)).toBe('Example oats');
    const target=merged.book.sheets.find(s=>s.id===table.sheet)!;
    expect(target.cells[key(table.rows[0],table.columns[0].column)].format).toEqual({bold:true,wrap:false,background:'#abcdef'});
    expect(target.cells[key(table.rows[0],table.columns[0].column)].note).toBe('Invented note');
    expect(JSON.stringify(merged.book.sheets.find(s=>s.id===notebook.id))).toBe(notesBefore);
    expect(JSON.stringify(source)).toBe(sourceBefore);
    expect(JSON.stringify(current)).toBe(currentBefore);
    expect(engine.evaluate(JSON.parse(target.validations[0].source),target.id,table.rows[0],table.columns[6].column)).toEqual([['Pantry']]);
    expect(engine.evaluate(JSON.parse(target.validations[1].source),target.id,table.rows[1],table.columns[0].column)).toMatchObject({error:'#REF!'});
    expect(merged.unresolvedReferences).toBe(1);
  });
  it('refuses dropdown and ambiguous column collisions without changing the current workbook',()=>{
    const current=createDemo(),source=fixture(),note=current.sheets[3];
    current.tables.push({id:uid(),name:'IngredientType',sheet:note.id,header:note.rows[6].id,rows:[],columns:[{id:uid(),name:'Local list',column:note.columns[0].id}]});
    const before=JSON.stringify(current);
    expect(()=>mergeIngredients(current,source)).toThrow('already exists');
    expect(JSON.stringify(current)).toBe(before);
    current.tables.pop();
    const t=current.tables[0];
    t.columns.push({id:uid(),name:'Ingredients',column:current.sheets.find(s=>s.id===t.sheet)!.columns[7].id});
    expect(()=>mergeIngredients(current,source)).toThrow('Ambiguous');
  });
});
