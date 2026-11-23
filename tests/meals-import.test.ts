import {describe,it,expect} from 'vitest';
import {createDemo,key,setInput,uid} from '../src/model';
import {Engine,compile} from '../src/formula';
import {mergeMeals} from '../src/meals-import';
import {renameReferenceValue} from '../src/references';

describe('targeted Meals import',()=>{
  it('preserves existing sheets, source layout, manual nutrition and identity-bound formulas',()=>{
    const current=createDemo(),source=createDemo(),root=source.tables.find(table=>table.name==='Meals')!,origin=source.sheets.find(sheet=>sheet.id===root.sheet)!;
    const manual=origin.cells[key(root.rows[1],root.columns[3].column)]={value:777,note:'Invented override',format:{wrap:false}};
    origin.rows[1].height=48;origin.groups.push({id:uid(),axis:'row',members:[...root.rows],collapsed:false,label:'Invented recipe'});
    const before=JSON.stringify(current),original=JSON.stringify(source),result=mergeMeals(current,source),sheet=result.book.sheets.find(sheet=>sheet.id===result.sheet)!;
    expect(result.rows).toBe(2);expect(result.linked).toBe(2);expect(result.previousTable).toBe('Meals_PreImport');
    expect(result.book.sheets.slice(0,-1)).toEqual(current.sheets);
    expect(sheet.rows).toEqual(origin.rows);expect(sheet.groups).toEqual(origin.groups);
    expect(sheet.cells[key(root.rows[1],root.columns[3].column)]).toEqual(manual);
    const engine=new Engine(result.book);
    expect(engine.cell(sheet.id,root.rows[0],root.columns[3].column)).toBe(225);
    expect(result.book.tables.find(table=>table.id===root.id)!.name).toBe('Meals');
    expect(result.book.tables.find(table=>table.name==='Meals_PreImport')!.id).toBe(current.tables.find(table=>table.name==='Meals')!.id);
    expect(JSON.stringify(current)).toBe(before);expect(JSON.stringify(source)).toBe(original);
  });
  it('reuses the Ingredients DD and links the first physical duplicate without fuzzy matching or replacing formulas',()=>{
    const current=createDemo(),ingredients=current.tables.find(table=>table.name==='Ingredients')!,sheet=current.sheets.find(sheet=>sheet.id===ingredients.sheet)!;
    for(const row of ingredients.rows.slice(0,2))setInput(current,sheet,row,ingredients.columns[0].column,'Invented oats');
    const top=ingredients.rows[0];ingredients.rows.reverse();
    const dd={id:uid(),name:'Ingredients',label:'My ingredients',kind:'list' as const,table:ingredients.id,column:ingredients.columns[0].id,archivedRows:[]};
    current.references=[dd];
    const source=createDemo(),root=source.tables.find(table=>table.name==='Meals')!,origin=source.sheets.find(sheet=>sheet.id===root.sheet)!;
    setInput(source,origin,root.rows[0],root.columns[1].column,'INVENTED OATS');
    setInput(source,origin,root.rows[1],root.columns[1].column,'Invented oat');
    root.rows.push(origin.rows[3].id);setInput(source,origin,root.rows[2],root.columns[1].column,'="Invented oats"');
    const result=mergeMeals(current,source),imported=result.book.sheets.find(sheet=>sheet.id===result.sheet)!;
    expect(result.linked).toBe(1);expect(result.unmatched).toBe(1);expect(result.preservedFormulaInputs).toBe(1);
    expect(result.book.references).toEqual([dd]);
    expect(imported.cells[key(root.rows[0],root.columns[1].column)].binding).toEqual({table:ingredients.id,row:top,column:ingredients.columns[0].id});
    expect(imported.cells[key(root.rows[1],root.columns[1].column)].value).toBe('Invented oat');
    expect(imported.cells[key(root.rows[2],root.columns[1].column)].formula).toBeDefined();
    expect(imported.validations.at(-1)!.source).toContain(ingredients.id);
    renameReferenceValue(result.book,result.book.references![0],top,'Renamed invented oats');
    expect(new Engine(result.book).cell(imported.id,root.rows[0],root.columns[1].column)).toBe('Renamed invented oats');
  });
  it('remaps named supporting-table validations and rejects missing dependencies without changing either workbook',()=>{
    const current=createDemo(),source=createDemo(),root=source.tables.find(table=>table.name==='Meals')!,origin=source.sheets.find(sheet=>sheet.id===root.sheet)!;
    const named={id:uid(),name:'ServingOptions',context:origin.id,original:'=Ingredients[Serving (g)]',formula:compile('=Ingredients[Serving (g)]',source,origin.id,root.rows[0],root.columns[2].column)};
    source.names.push(named);origin.validations.push({id:uid(),sheet:origin.id,rows:root.rows,columns:[root.columns[2].column],source:'=INDIRECT("ServingOptions")'});
    const result=mergeMeals(current,source),imported=result.book.sheets.find(sheet=>sheet.id===result.sheet)!;
    expect(imported.validations[0].source).toContain(result.book.names.find(name=>name.name==='ServingOptions')!.id);
    expect(JSON.stringify(result.book.names.at(-1)!.formula)).toContain(current.tables.find(table=>table.name==='Ingredients')!.id);
    current.tables=current.tables.filter(table=>table.name!=='Ingredients');
    const before=JSON.stringify(current);expect(()=>mergeMeals(current,source)).toThrow('Ingredients');expect(JSON.stringify(current)).toBe(before);
  });
});
