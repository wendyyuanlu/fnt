import {compile,displayFormula,type Ast} from './formula';
import {allSheets,allTables,clone,getCell,key,mapAst,uid,uniqueName,type ReferenceSource,type Workbook} from './model';
import {referenceChoices,referenceFormula} from './references';
import {validateBook} from './storage';

export function mergeMeals(current:Workbook,source:Workbook){
  validateBook(current);validateBook(source);
  const roots=source.tables.filter(table=>table.name.toLowerCase()==='meals');
  if(roots.length!==1)throw Error('The Excel source must contain exactly one Meals table.');
  const root=roots[0],origin=source.sheets.find(sheet=>sheet.id===root.sheet)!;
  const ingredients=allTables(current).filter(table=>table.name.toLowerCase()==='ingredients');
  if(ingredients.length!==1)throw Error('Import or resolve the Ingredients table before importing Meals.');
  const ingredientField=ingredients[0].columns.find(field=>['ingredient','ingredients'].includes(field.name.toLowerCase()));
  const mealField=root.columns.find(field=>field.name.toLowerCase()==='ingredient');
  if(!ingredientField||!mealField)throw Error('Meals and Ingredients must both have an ingredient-name field.');
  if(allSheets(current).some(sheet=>sheet.id===origin.id))throw Error('These Meals identities already exist. Use recovery instead of importing them twice.');
  const book=clone(current),sheet=clone(origin),table=clone(root);
  sheet.name=uniqueName(allSheets(book).map(sheet=>sheet.name),origin.name);
  const previous=allTables(book).find(table=>table.name.toLowerCase()==='meals');
  if(previous)previous.name=uniqueName(allTables(book).map(table=>table.name),'Meals_PreImport');
  book.sheets.push(sheet);book.tables.push(table);
  const destinations=new Map([[root.id,table]]);
  const destination=(id:string)=>{
    let target=destinations.get(id);if(target)return target;
    const original=allTables(source).find(table=>table.id===id);
    if(!original)throw Error('A Meals formula refers to a missing source table.');
    const matches=allTables(book).filter(table=>table.name.toLowerCase()===original.name.toLowerCase());
    if(matches.length!==1)throw Error(`Meals requires exactly one existing "${original.name}" table. Import that supporting source first.`);
    target=matches[0];destinations.set(id,target);return target;
  };
  const field=(tableId:string,id:string)=>{
    const original=allTables(source).find(table=>table.id===tableId)!.columns.find(field=>field.id===id);
    const target=destination(tableId),matches=target.columns.filter(field=>field.name.toLowerCase()===original?.name.toLowerCase());
    if(matches.length!==1)throw Error('A Meals dependency field is missing or ambiguous. Existing data was not changed.');
    return matches[0].id;
  };
  const names=new Map<string,string>(),resolving=new Set<string>(),cache=new WeakMap<Ast,Ast>();
  const remap=(ast:Ast):Ast=>{
    const cached=cache.get(ast);if(cached)return cached;
    const result=mapAst(ast,node=>{
      if(node.kind==='structured')return {...node,table:destination(node.table).id,columns:node.columns.map(id=>field(node.table,id))};
      if(node.kind==='ref'&&node.sheet!==origin.id)throw Error('Meals has an external cell-address reference. Convert it to an explicit table reference before importing; existing data was not changed.');
      if(node.kind==='name'){
        const existing=names.get(node.id);if(existing)return {...node,id:existing};
        const original=source.names.find(name=>name.id===node.id);
        if(!original)throw Error('A named Meals dependency is missing.');
        if(resolving.has(original.id))throw Error('A named Meals dependency is circular.');
        if(original.sheet&&original.sheet!==origin.id)throw Error('A Meals dependency has an external sheet-scoped name.');
        resolving.add(original.id);
        const formula=remap(original.formula),matching=book.names.find(name=>name.sheet===original.sheet&&name.name.toLowerCase()===original.name.toLowerCase()&&JSON.stringify(name.formula)===JSON.stringify(formula));
        const named=matching??{...clone(original),id:uid(),name:uniqueName(book.names.map(name=>name.name),original.name),context:sheet.id,formula};
        if(!matching)book.names.push(named);
        names.set(original.id,named.id);resolving.delete(original.id);return {...node,id:named.id};
      }
      if(node.kind==='call'&&node.name==='INDIRECT'&&node.args[0]?.kind==='literal'&&typeof node.args[0].value==='string')
        return remap(compile(node.args[0].value,source,origin.id,origin.rows[0].id,origin.columns[0].id));
      return node;
    });
    cache.set(ast,result);return result;
  };
  let formulas=0;
  for(const cell of Object.values(sheet.cells)){
    if(cell.formula){cell.formula=remap(cell.formula);formulas++;}
    if(cell.calculation)cell.calculation=remap(cell.calculation);
    if(cell.binding&&cell.binding.table!==root.id)throw Error('A linked Meals snapshot must be restored, not reimported as independent Excel data.');
  }
  sheet.validations=sheet.validations.flatMap(validation=>{
    const columns=validation.columns.filter(column=>column!==mealField.column);
    if(!columns.length)return[];
    const copied={...validation,columns};
    if(!copied.values){
      const ast=copied.source.startsWith('{')?JSON.parse(copied.source) as Ast:compile(copied.source,source,origin.id,copied.rows[0],columns[0]);
      copied.originalSource=displayFormula(ast,source);copied.source=JSON.stringify(remap(ast));
    }
    return[copied];
  });
  const providers=(book.references??[]).filter(source=>!source.archived&&source.kind==='list'&&source.table===ingredients[0].id&&source.column===ingredientField.id);
  if(providers.length>1)throw Error('Several active Ingredients dropdowns use this field. Resolve that ambiguity before importing.');
  const provider:ReferenceSource=providers[0]??{id:uid(),name:uniqueName(book.references?.map(source=>source.name)??[],'Ingredients'),kind:'list',table:ingredients[0].id,column:ingredientField.id,archivedRows:[]};
  if(!providers.length)(book.references??=[]).push(provider);
  sheet.validations.push({id:uid(),sheet:sheet.id,rows:[...table.rows],columns:[mealField.column],source:JSON.stringify(referenceFormula(provider))});
  const positions=new Map(allSheets(book).find(sheet=>sheet.id===ingredients[0].sheet)!.rows.map((row,i)=>[row.id,i]));
  const choices=referenceChoices(book,provider).sort((a,b)=>positions.get(a.row)!-positions.get(b.row)!);
  const byName=new Map<string,typeof choices[number]>();
  for(const choice of choices){const name=choice.value.toLowerCase();if(!byName.has(name))byName.set(name,choice);}
  let linked=0,unmatched=0,preservedFormulaInputs=0;
  for(const row of table.rows){
    const cell=getCell(sheet,row,mealField.column);
    if(cell.formula||cell.binding){if(cell.formula)preservedFormulaInputs++;continue;}
    if(cell.value==null||cell.value==='')continue;
    const choice=byName.get(String(cell.value).toLowerCase());
    if(!choice){unmatched++;continue;}
    const bound={...cell,binding:{...choice.binding}};delete bound.value;
    sheet.cells[key(row,mealField.column)]=bound;linked++;
  }
  if(book.importReport)book.importReport.entries.push(`Imported ${table.rows.length} Meals records without replacing existing sheets; ${linked} ingredient inputs linked case-insensitively to the first matching active Ingredients record in sheet order; ${unmatched} unmatched labels and all manual nutrition retained.`);
  book.revision++;validateBook(book);
  return{book,sheet:sheet.id,table:table.id,rows:table.rows.length,formulas,linked,unmatched,preservedFormulaInputs,previousTable:previous?.name};
}
