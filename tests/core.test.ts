import { describe, expect, it } from 'vitest';
import { compile, displayFormula, Engine, flatten } from '../src/formula';
import { addRow, clone, createDemo, deleteColumn, deleteRows, duplicateSheet, fillCells, getCell, insertColumn, key, move, moveColumns, renameColumn, setInput, translate } from '../src/model';

describe('identity-bound calculation',()=>{
  function fixture(){
    const book=createDemo(),ingredients=book.sheets.find(s=>s.name==='Ingredients')!,log=book.sheets[0],table=book.tables.find(t=>t.name==='Ingredients')!;
    const calories=()=>flatten(new Engine(book).cell(log.id,log.rows[1].id,log.columns.find(c=>c.id===book.tables[2].columns[3].column)!.id))[0];
    return{book,ingredients,log,table,calories};
  }
  it('keeps XLOOKUP through source column rename, movement, table rename, sheet rename and serialization',()=>{
    const {book,ingredients,log,table,calories}=fixture();
    expect(calories()).toBeCloseTo(208.8);
    const source=table.columns[5];renameColumn(book,table,source.id,'Energy density');move(ingredients.columns,5,0);
    table.name='Pantry';ingredients.name='My pantry';
    const formula=getCell(log,log.rows[1].id,log.columns[3].id).formula!;
    expect(displayFormula(formula,book)).toContain('Pantry[Energy density]');
    expect(calories()).toBeCloseTo(208.8);
    const restored=JSON.parse(JSON.stringify(book));
    expect(flatten(new Engine(restored).cell(log.id,log.rows[1].id,log.columns[3].id))[0]).toBeCloseTo(208.8);
  });
  it('does not silently rebind a deleted column to a replacement with the same name',()=>{
    const {book,ingredients,table,calories}=fixture(),source=table.columns[5];
    deleteColumn(book,ingredients,source.column);
    expect(calories()).toMatchObject({error:'#REF!'});
    const newCol={id:crypto.randomUUID(),label:'Calories per g'};ingredients.columns.push(newCol);table.columns.push({id:crypto.randomUUID(),column:newCol.id,name:'Calories per g'});
    expect(calories()).toMatchObject({error:'#REF!'});
  });
  it('roundtrips renamed headers containing structured-reference metacharacters',()=>{
    const {book,log,table,calories}=fixture(),column=table.columns[5];
    renameColumn(book,table,column.id,"Energy [g] @ #All's");
    const ast=getCell(log,log.rows[1].id,log.columns[3].id).formula!,source=displayFormula(ast,book);
    const reparsed=compile(source,book,log.id,log.rows[1].id,log.columns[3].id);
    expect(flatten(new Engine(book).evaluate(reparsed,log.id,log.rows[1].id,log.columns[3].id))[0]).toBeCloseTo(208.8);
    expect(calories()).toBeCloseTo(208.8);
  });
  it('source-record links follow renames and do not relink duplicate names or deletion',()=>{
    const {book,ingredients,log,table}=fixture(),r=log.rows[2].id,c=log.columns[1].id,source=table.rows[0];
    log.cells[key(r,c)]={binding:{table:table.id,row:source,column:table.columns[0].id}};
    setInput(book,ingredients,source,table.columns[0].column,'Renamed oats');
    expect(new Engine(book).cell(log.id,r,c)).toBe('Renamed oats');
    deleteRows(book,ingredients,[source]);
    expect(new Engine(book).cell(log.id,r,c)).toMatchObject({error:'#REF!'});
  });
  it('XLOOKUP retains first-match text behavior for duplicates, separate from bound pickers',()=>{
    const {book,ingredients,log,table,calories}=fixture();
    setInput(book,ingredients,table.rows[0],table.columns[0].column,'Example lentils');
    expect(calories()).toBe(675);
    expect(getCell(log,log.rows[1].id,log.columns[3].id).formula).toBeDefined();
  });
  it('adds formula rows with this-row semantics, without sharing source identities',()=>{
    const {book,ingredients,table}=fixture(),row=addRow(book,ingredients,4,table);
    setInput(book,ingredients,row.id,table.columns[1].column,'50');setInput(book,ingredients,row.id,table.columns[2].column,'100');
    expect(new Engine(book).cell(ingredients.id,row.id,table.columns[5].column)).toBe(2);
  });
  it('fills relative formulas in both directions without moving absolute references',()=>{
    const {book}=fixture(),s=book.sheets[3];s.cells={};
    setInput(book,s,s.rows[1].id,s.columns[1].id,'3');setInput(book,s,s.rows[2].id,s.columns[1].id,'5');
    setInput(book,s,s.rows[1].id,s.columns[0].id,'=B2+$B$2');
    fillCells(book,s,{r1:1,r2:1,c1:0,c2:0},{r1:1,r2:2,c1:0,c2:0});
    expect(new Engine(book).cell(s.id,s.rows[2].id,s.columns[0].id)).toBe(8);
    setInput(book,s,s.rows[4].id,s.columns[0].id,'Raisin 1');
    fillCells(book,s,{r1:4,r2:4,c1:0,c2:0},{r1:4,r2:4,c1:0,c2:2});
    expect(getCell(s,s.rows[4].id,s.columns[2].id).value).toBe('Raisin 3');
  });
  it('extends only directly adjacent empty table rows and inherits formulas and neighboring validation',()=>{
    const {book,ingredients:s,table:t}=fixture(),row=s.rows[4].id,columns=t.columns;
    s.validations.push({id:crypto.randomUUID(),sheet:s.id,rows:[t.rows[2]],columns:[columns[4].column],source:'="g,cup"',values:['g','cup']});
    s.validations.push({id:crypto.randomUUID(),sheet:s.id,rows:[t.rows[0]],columns:[columns[4].column],source:'="unrelated"',values:['unrelated']});
    setInput(book,s,s.rows[5].id,columns[0].column,'Freeform after a gap');
    expect(t.rows).not.toContain(s.rows[5].id);
    setInput(book,s,row,columns[0].column,'New item');
    expect(t.rows.at(-1)).toBe(row);
    setInput(book,s,row,columns[1].column,'50');setInput(book,s,row,columns[2].column,'100');
    expect(new Engine(book).cell(s.id,row,columns[5].column)).toBe(2);
    expect(s.validations[0].rows).toContain(row);expect(s.validations[1].rows).not.toContain(row);
    setInput(book,s,s.rows[5].id,columns[1].column,'20');
    expect(t.rows).not.toContain(s.rows[5].id);
    s.cells[key(s.rows[6].id,columns[2].column)]={value:999};
    setInput(book,s,s.rows[6].id,columns[0].column,'Another freeform item');
    expect(t.rows).not.toContain(s.rows[6].id);
  });
  it('moves a column selection atomically, preserves record/formula/format/validation IDs, and inserts at boundaries',()=>{
    const {book,ingredients:s,table:t,calories}=fixture();
    const ids=s.columns.slice(1,3).map(c=>c.id),before=s.columns.map(c=>c.id),row=t.rows[0];
    s.cells[key(row,ids[0])].format={bold:true};
    s.validations.push({id:crypto.randomUUID(),sheet:s.id,rows:[row],columns:[ids[0]],source:'="a,b"',values:['a','b']});
    expect(moveColumns(book,s,ids,6)).toBe(4);
    expect(s.columns.map(c=>c.id)).toEqual([before[0],before[3],before[4],before[5],...ids,...before.slice(6)]);
    expect(s.validations[0].columns).toEqual([ids[0]]);expect(getCell(s,row,ids[0]).format?.bold).toBe(true);
    expect(calories()).toBeCloseTo(208.8);
    const inserted=insertColumn(book,s,1);expect(s.columns[1].id).toBe(inserted.id);
    expect(t.columns.some(c=>c.column===inserted.id)).toBe(true);
    expect(calories()).toBeCloseTo(208.8);
  });
  it('invalidates dependent lookups incrementally without discarding unrelated cached cells',()=>{
    const {book,ingredients,log,table}=fixture(),engine=new Engine(book),s=book.sheets[3];
    setInput(book,s,s.rows[0].id,s.columns[0].id,'42');
    engine.cell(s.id,s.rows[0].id,s.columns[0].id);
    expect(flatten(engine.cell(log.id,log.rows[1].id,log.columns[3].id))[0]).toBeCloseTo(208.8);
    setInput(book,ingredients,table.rows[1],table.columns[2].column,'200');
    engine.invalidate([`${ingredients.id}:${key(table.rows[1],table.columns[2].column)}`]);
    expect(engine.cache.has(`${s.id}:${key(s.rows[0].id,s.columns[0].id)}`)).toBe(true);
    expect(flatten(engine.cell(log.id,log.rows[1].id,log.columns[3].id))[0]).toBe(360);
  });
  it('duplicates sheets and internal tables with remapped formulas',()=>{
    const {book,ingredients,table}=fixture(),copy=duplicateSheet(book,ingredients),copiedTable=book.tables.find(t=>t.sheet===copy.id)!;
    expect(copy.id).not.toBe(ingredients.id);expect(copiedTable.id).not.toBe(table.id);
    setInput(book,copy,copiedTable.rows[0],copiedTable.columns[2].column,'200');
    expect(new Engine(book).cell(copy.id,copiedTable.rows[0],copiedTable.columns[5].column)).toBe(5);
    expect(new Engine(book).cell(ingredients.id,table.rows[0],table.columns[5].column)).toBe(3.75);
  });
});
describe('formula language',()=>{
  function context(){
    const book=createDemo(),s=book.sheets[3],r=s.rows[10].id,c=s.columns[8].id;
    const calc=(source:string)=>new Engine(book).evaluate(compile(source,book,s.id,r,c),s.id,r,c);
    return{book,s,r,c,calc};
  }
  it('evaluates lazy IF, IFERROR, LET, blanks, errors, strings and comparisons',()=>{
    const {calc}=context();
    expect(calc('=IF(FALSE,1/0,LET(x,3,y,4,x*y))')).toBe(12);
    expect(calc('=IFERROR(1/0,"fallback")')).toBe('fallback');
    expect(calc('=ISNUMBER("")')).toBe(false);expect(calc('=1/0')).toMatchObject({error:'#DIV/0!'});
    expect(calc('="a""b"&"c"')).toBe('a"bc');expect(calc('="A"="a"')).toBe(true);
    expect(calc('=1+"not numeric"')).toMatchObject({error:'#VALUE!'});
    expect(calc('=EVIL(1)')).toMatchObject({error:'#UNSUPPORTED!'});
  });
  it('supports array comparisons, FILTER, SUM, INDEX, MATCH, XMATCH, dates and text',()=>{
    const {calc}=context();
    expect(flatten(calc('=FILTER(Ingredients[Ingredient],Ingredients[Protein (g)]>8)'))).toEqual(['Example lentils','Example yogurt']);
    expect(calc('=SUM(Ingredients[Protein (g)])')).toBe(31);
    expect(calc('=INDEX(Ingredients[Ingredient],XMATCH("Example lentils",Ingredients[Ingredient],0))')).toBe('Example lentils');
    expect(calc('=MATCH("Example yogurt",Ingredients[Ingredient],0)')).toBe(3);
    expect(calc('=DATEDIF(DATE(2020,1,1),DATE(2023,1,1),"Y")')).toBe(3);
    expect(calc('=VALUE(LEFT("12 cups",FIND(" ","12 cups")-1))')).toBe(12);
    expect(calc('=ROUND(-1.25,1)')).toBe(-1.3);
  });
  it('resolves INDEX range endpoints without evaluating unrelated cells or circular header totals',()=>{
    const {book,s,calc}=context();
    setInput(book,s,s.rows[0].id,s.columns[0].id,'=SUM(INDEX(A1:A4,2):INDEX(A1:A4,4))');
    for(let i=1;i<4;i++)setInput(book,s,s.rows[i].id,s.columns[0].id,String(i));
    expect(new Engine(book).cell(s.id,s.rows[0].id,s.columns[0].id)).toBe(6);
    expect(calc('=LET(unused,1/0,answer,42,answer)')).toBe(42);
  });
  it('copies unqualified A1 references to the destination sheet but preserves explicit sheet references',()=>{
    const {book,s}=context(),other=book.sheets[0];
    setInput(book,s,s.rows[0].id,s.columns[0].id,'7');setInput(book,other,other.rows[1].id,other.columns[0].id,'11');
    const ast=compile("=A1+'Notebook'!$A$1",book,s.id,s.rows[0].id,s.columns[1].id);
    const copied=translate(ast,book,s.id,s.rows[0].id,s.columns[1].id,other.rows[1].id,other.columns[1].id,other.id);
    expect(new Engine(book).evaluate(copied,other.id,other.rows[1].id,other.columns[1].id)).toBe(18);
  });
  it('keeps both endpoints of explicitly qualified self-sheet ranges on the source when copied',()=>{
    const {book,s}=context(),other=book.sheets[0];
    setInput(book,s,s.rows[1].id,s.columns[0].id,'3');setInput(book,s,s.rows[2].id,s.columns[0].id,'4');
    const ast=compile("=SUM('Notebook'!A1:A2)",book,s.id,s.rows[0].id,s.columns[1].id);
    const copied=translate(ast,book,s.id,s.rows[0].id,s.columns[1].id,other.rows[1].id,other.columns[1].id,other.id);
    expect(new Engine(book).evaluate(copied,other.id,other.rows[1].id,other.columns[1].id)).toBe(7);
  });
  it('binds A1 references to identities, keeps absolute-copy semantics and detects cycles',()=>{
    const {book,s}=context();
    setInput(book,s,s.rows[0].id,s.columns[0].id,'2');setInput(book,s,s.rows[1].id,s.columns[0].id,'3');
    const ast=compile('=A1+$A$1',book,s.id,s.rows[0].id,s.columns[1].id);
    const copied=translate(ast,book,s.id,s.rows[0].id,s.columns[1].id,s.rows[1].id,s.columns[1].id);
    expect(new Engine(book).evaluate(copied,s.id,s.rows[1].id,s.columns[1].id)).toBe(5);
    move(s.columns,0,3);
    expect(new Engine(book).evaluate(ast,s.id,s.rows[0].id,s.columns[0].id)).toBe(4);
    const r=s.rows[4].id,c=s.columns[4].id;setInput(book,s,r,c,'=E5');
    expect(new Engine(book).cell(s.id,r,c)).toMatchObject({error:'#CYCLE!'});
  });
  it('supports scoped names and prevents named cycles',()=>{
    const {book,s,r,c}=context();
    const global={id:crypto.randomUUID(),name:'List',context:s.id,original:'=1',formula:{kind:'literal' as const,value:1}};
    const local={...global,id:crypto.randomUUID(),sheet:s.id,formula:{kind:'literal' as const,value:2}};book.names.push(global,local);
    expect(new Engine(book).evaluate(compile('=List',book,s.id,r,c),s.id,r,c)).toBe(2);
    local.formula=compile('=List',book,s.id,r,c) as typeof local.formula;
    expect(new Engine(book).evaluate(compile('=List',book,s.id,r,c),s.id,r,c)).toMatchObject({error:'#CYCLE!'});
  });
  it('lets LET variables shadow workbook names without altering the workbook binding',()=>{
    const {book,s,r,c}=context();
    book.names.push({id:crypto.randomUUID(),name:'total',context:s.id,original:'=9',formula:{kind:'literal',value:9}});
    const calc=(source:string)=>new Engine(book).evaluate(compile(source,book,s.id,r,c),s.id,r,c);
    expect(calc('=LET(total,4,total+1)')).toBe(5);
    expect(calc('=total')).toBe(9);
    expect(calc('=LET(total,total+1,LET(total,total+1,total))')).toBe(11);
  });
  it('spills FILTER arrays, reports blocked spills and never uses cached values',()=>{
    const {book,s}=context();setInput(book,s,s.rows[0].id,s.columns[0].id,'=FILTER(Ingredients[Ingredient],Ingredients[Protein (g)]>8)');
    let e=new Engine(book);expect(e.cell(s.id,s.rows[1].id,s.columns[0].id)).toBe('Example yogurt');expect(flatten(e.cell(s.id,s.rows[0].id,s.columns[0].id))).toHaveLength(2);
    setInput(book,s,s.rows[1].id,s.columns[0].id,'occupied');e=new Engine(book);expect(e.cell(s.id,s.rows[0].id,s.columns[0].id)).toMatchObject({error:'#SPILL!'});
    setInput(book,s,s.rows[1].id,s.columns[0].id,'');e.invalidate([`${s.id}:${key(s.rows[1].id,s.columns[0].id)}`]);expect(e.cell(s.id,s.rows[1].id,s.columns[0].id)).toBe('Example yogurt');
    const backup=clone(book);expect(getCell(backup.sheets[3],s.rows[0].id,s.columns[0].id).formula).toBeDefined();
  });
});
