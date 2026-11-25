import { expect,it } from 'vitest';
import { compile,Engine } from '../src/formula';
import { addReferenceValue,createReference,duplicateReference,moveReferenceGroup,moveReferenceValue,referenceChoices,referenceFormula,referenceNavigation,referenceTable,referenceUsages,removeReferenceValue,removeUnitsSource,renameReferenceGroup,renameReferenceValue,reorderReferenceSelection,reorderReferenceTabs,setDerivedSource,setReferencePresentation,unitsSource,upsertConversion,validationChoiceGroups,validationChoices,validationReference } from '../src/references';
import { mergeReferences } from '../src/references-import';
import { addRow,blankSheet,clone,createDemo,key,setInput,uid,type Workbook } from '../src/model';
import { validateBook } from '../src/storage';
import { dropdownCatalog,seedDropdownCatalog } from '../src/dropdown-catalog';

function source(){
  const dropdowns=blankSheet('Dropdowns',90,6),convert=blankSheet('Convert',12,6),meals=blankSheet('Meals',12,6),derived=blankSheet('MealDD',8,3);
  const b:Workbook={schema:1,id:uid(),title:'Invented auxiliary source',revision:0,sheets:[dropdowns,convert,meals,derived],tables:[],names:[],pickerSources:{}};
  function table(sheet:typeof dropdowns,name:string,at:number,headers:string[],rows:string[][]){
    const t={id:uid(),name,sheet:sheet.id,header:sheet.rows[at].id,rows:sheet.rows.slice(at+1,at+1+rows.length).map(r=>r.id),columns:headers.map((name,i)=>({id:uid(),column:sheet.columns[i].id,name}))};
    b.tables.push(t);[headers,...rows].forEach((row,i)=>row.forEach((value,j)=>setInput(b,sheet,sheet.rows[at+i].id,sheet.columns[j].id,value)));return t;
  }
  ['IngredientType','Period','AnimalType','Table14','SnackCountry','SnackFlavour','SnackCategory'].forEach((name,i)=>table(dropdowns,name,i*5,[name+' field'],[['Synthetic A'],['Synthetic B']]));
  table(convert,'Convert',0,['From Unit','To Unit','Conversion Factor'],[['tbsp','tsp','3']]);
  table(meals,'Meals',0,['Meal','isMeal'],[['Original invented meal','TRUE'],['','FALSE']]);
  const original='=FILTER(Meals[Meal],Meals[isMeal]=TRUE)';
  setInput(b,derived,derived.rows[0].id,derived.columns[0].id,original);
  b.names.push({id:uid(),name:'MealDD',context:derived.id,original,formula:compile(original,b,derived.id,derived.rows[0].id,derived.columns[0].id)},{id:uid(),name:'MealDD',sheet:meals.id,context:meals.id,original,formula:compile(original,b,meals.id,meals.rows[0].id,meals.columns[0].id)});
  return b;
}
function legacyUnits(book:Workbook){
  const units=unitsSource(book),rule=book.references!.find(s=>s.kind==='conversions')!,{table,sheet}=referenceTable(book,rule);
  for(const field of table.columns.slice(0,2)){
    const address=key(table.rows[0],field.column),cell=sheet.cells[address],row=addReferenceValue(book,units,String(cell.value));
    sheet.cells[address]={...cell,value:undefined,binding:{table:units.table!,column:units.column!,row}};
  }
  return units;
}
it('imports Convert labels directly and edits conversion rules without creating Units',()=>{
  const b=mergeReferences(createDemo(),source(),'invented-original').book,rule=b.references!.find(s=>s.kind==='conversions')!,{table,sheet}=referenceTable(b,rule);
  expect(b.references!.some(s=>s.kind==='units')).toBe(false);
  expect(table.columns.slice(0,2).map(field=>sheet.cells[key(table.rows[0],field.column)])).toEqual([{value:'tbsp'},{value:'tsp'}]);
  upsertConversion(b,rule,table.rows[0],'tbsp','tsp','6',true);
  expect(new Engine(b).cell(sheet.id,table.rows[0],table.columns[2].column)).toBe(6);
  expect(b.references!.some(s=>s.kind==='units')).toBe(false);
});
it('removes legacy Units while preserving current labels, Convert identities, formulas and formats',()=>{
  const b=mergeReferences(createDemo(),source(),'invented-original').book,units=legacyUnits(b),rule=b.references!.find(s=>s.kind==='conversions')!,{table,sheet}=referenceTable(b,rule);
  const from=referenceChoices(b,units).find(choice=>choice.value==='tbsp')!;
  renameReferenceValue(b,units,from.row,'Spoon');
  const address=key(table.rows[0],table.columns[0].column);sheet.cells[address].format={bold:true,wrap:false};
  const notes=b.sheets[3];setInput(b,notes,notes.rows[1].id,notes.columns[1].id,'=XLOOKUP("Spoon",Convert[From Unit],Convert[Conversion Factor],0)');
  const formula=clone(notes.cells[key(notes.rows[1].id,notes.columns[1].id)]),identity=clone(table);
  expect(removeUnitsSource(b,units)).toBe(2);
  expect(b.references!.some(ref=>ref.kind==='units')).toBe(false);expect(b.tables.some(t=>t.id===units.table)).toBe(false);
  expect(table).toEqual(identity);expect(sheet.cells[address]).toEqual({value:'Spoon',format:{bold:true,wrap:false}});
  expect(notes.cells[key(notes.rows[1].id,notes.columns[1].id)]).toEqual(formula);
  expect(new Engine(b).cell(notes.id,notes.rows[1].id,notes.columns[1].id)).toBe(3);
  expect(()=>validateBook(b)).not.toThrow();
});
it('refuses Units removal atomically when formulas or unresolved bindings still use it',()=>{
  const b=mergeReferences(createDemo(),source(),'invented-original').book,units=legacyUnits(b),notes=b.sheets[3];
  notes.cells[key(notes.rows[1].id,notes.columns[1].id)]={formula:referenceFormula(units)};
  let before=clone(b);expect(()=>removeUnitsSource(b,units)).toThrow('formulas');expect(b).toEqual(before);
  delete notes.cells[key(notes.rows[1].id,notes.columns[1].id)];
  notes.cells[key(notes.rows[2].id,notes.columns[1].id)]={binding:{table:units.table!,column:units.column!,row:uid()}};
  before=clone(b);expect(()=>removeUnitsSource(b,units)).toThrow('safely');expect(b).toEqual(before);
});
it('table-local DD replacement preserves shared rows, exact links and archived option identities',()=>{
  const b=createDemo(),source=createReference(b,'Synthetic local options');
  const first=addReferenceValue(b,source,'Synthetic first option'),replacement=addReferenceValue(b,source,'Synthetic replacement'),archived=addReferenceValue(b,source,'Synthetic archived');
  const {table,sheet}=referenceTable(b,source),neighbor={id:uid(),name:'Neighbor',sheet:sheet.id,header:table.header,rows:[...table.rows],columns:[{id:uid(),name:'Note',column:sheet.columns[2].id}]};
  source.archivedRows=[archived];b.tables.push(neighbor);
  for(const row of [neighbor.header,...neighbor.rows])sheet.cells[key(row,neighbor.columns[0].column)]={value:'Unrelated note '+row};
  const destination=b.sheets[0],choices=referenceChoices(b,source);
  destination.cells[key(destination.rows[1].id,destination.columns[0].id)]={binding:choices.find(choice=>choice.row===first)!.binding};
  destination.cells[key(destination.rows[2].id,destination.columns[0].id)]={binding:choices.find(choice=>choice.row===replacement)!.binding};
  const before=clone(b),notes=Object.entries(sheet.cells).filter(([address])=>address.endsWith(':'+neighbor.columns[0].column));
  expect(()=>removeReferenceValue(b,source,first,undefined,true)).toThrow('linked');expect(b).toEqual(before);
  removeReferenceValue(b,source,first,replacement,true);
  const updated=referenceTable(b,b.references!.find(item=>item.id===source.id)!);
  expect(updated.sheet.rows).toEqual(sheet.rows);
  expect(Object.entries(updated.sheet.cells).filter(([address])=>address.endsWith(':'+neighbor.columns[0].column))).toEqual(notes);
  expect(updated.table.rows).toEqual([first,replacement]);expect(b.tables.find(item=>item.id===neighbor.id)).toEqual(neighbor);
  expect(b.references!.find(item=>item.id===source.id)!.archivedRows).toEqual([replacement]);
  const engine=new Engine(b);for(const index of [1,2])expect(engine.cell(destination.id,destination.rows[index].id,destination.columns[0].id)).toBe('Synthetic replacement');
  expect(()=>validateBook(b)).not.toThrow();
});
it('nests DD categories through three levels and renames a branch without changing records or bindings',()=>{
  const b=createDemo(),a=createReference(b,'Country'),z=createReference(b,'Flavour'),row=addReferenceValue(b,a,'Japan'),s=b.sheets[0];
  setReferencePresentation(b,a,'Country',' Snack / Chocolate / Imported ');setReferencePresentation(b,z,'Flavour','Snack / Chocolate');
  s.cells[key(s.rows[1].id,s.columns[0].id)]={binding:referenceChoices(b,a)[0].binding};
  const tables=clone(b.tables),cells=clone(b.sheets.map(s=>s.cells)),refs=b.references!.map(s=>s.id);
  const root=referenceNavigation(b).find(n=>n.group==='Snack')!;
  expect(root.children[0].group).toBe('Snack / Chocolate');expect(root.children[0].children[0].group).toBe('Snack / Chocolate / Imported');
  expect(root.members.map(s=>s.id)).toEqual([a.id,z.id]);
  expect(()=>setReferencePresentation(b,a,'Other','Snack / Chocolate / Imported / Fourth')).toThrow('three');expect(a.label).toBeUndefined();
  b.pickerSources['dd-group-collapsed:snack / chocolate / imported']='true';
  renameReferenceGroup(b,'Snack / Chocolate','Sweet');
  expect(a.group).toBe('Snack / Sweet / Imported');expect(z.group).toBe('Snack / Sweet');
  expect(b.pickerSources['dd-group-collapsed:snack / sweet / imported']).toBe('true');
  expect(b.tables).toEqual(tables);expect(b.sheets.map(s=>s.cells)).toEqual(cells);expect(b.references!.map(s=>s.id)).toEqual(refs);
  expect(new Engine(b).cell(s.id,s.rows[1].id,s.columns[0].id)).toBe('Japan');expect(referenceChoices(b,a)[0].binding.row).toBe(row);
});
it('moves entire DD branches while retaining hidden unit identities and unrelated source order',()=>{
  const b=createDemo(),a=createReference(b,'Country'),u=unitsSource(b),z=createReference(b,'Flavour'),other=createReference(b,'Animal');
  setReferencePresentation(b,a,'Country','Snack / Chocolate');setReferencePresentation(b,z,'Flavour','Snack / Chocolate / Imported');
  const records=clone(b.tables),ids=new Set(b.references!.map(s=>s.id));
  moveReferenceGroup(b,'Snack',1);
  expect(referenceNavigation(b).map(n=>n.label)).toEqual(['Animal','Snack']);expect(b.references).toContain(u);
  reorderReferenceTabs(b,'group:Snack',other.id,false);
  expect(referenceNavigation(b).map(n=>n.label)).toEqual(['Snack','Animal']);
  expect(new Set(b.references!.map(s=>s.id))).toEqual(ids);expect(b.tables).toEqual(records);
  reorderReferenceTabs(b,a.id,other.id,false);expect(a.group).toBeUndefined();expect(b.tables).toEqual(records);
});
it('drag nesting and extraction preserve category descendants, collapsed state and exact bindings',()=>{
  const b=createDemo(),country=createReference(b,'Country'),flavour=createReference(b,'Flavour'),animal=createReference(b,'Animal');
  setReferencePresentation(b,country,'Country','Snack / Chocolate');setReferencePresentation(b,flavour,'Flavour','Snack / Chocolate / Imported');
  const record=addReferenceValue(b,country,'Japan'),s=b.sheets[0];s.cells[key(s.rows[1].id,s.columns[0].id)]={binding:referenceChoices(b,country)[0].binding};
  const tables=clone(b.tables),cells=clone(b.sheets.map(s=>s.cells)),ids=b.references!.map(s=>s.id);
  b.pickerSources['dd-group-collapsed:snack / chocolate / imported']='true';
  reorderReferenceTabs(b,'group:Snack / Chocolate',animal.id,true);
  expect(country.group).toBe('Chocolate');expect(flavour.group).toBe('Chocolate / Imported');
  expect(b.pickerSources['dd-group-collapsed:chocolate / imported']).toBe('true');
  setReferencePresentation(b,animal,'Animal','Other');
  reorderReferenceTabs(b,'group:Chocolate','group:Other',true,true);
  expect(country.group).toBe('Other / Chocolate');expect(flavour.group).toBe('Other / Chocolate / Imported');
  reorderReferenceTabs(b,country.id,animal.id,true);
  expect(country.group).toBe('Other');
  expect(new Set(b.references!.map(s=>s.id))).toEqual(new Set(ids));expect(b.tables).toEqual(tables);expect(b.sheets.map(s=>s.cells)).toEqual(cells);
  expect(new Engine(b).cell(s.id,s.rows[1].id,s.columns[0].id)).toBe('Japan');expect(referenceChoices(b,country)[0].binding.row).toBe(record);
});
it('rejects nesting cycles and excessive depth before changing any category',()=>{
  const b=createDemo(),a=createReference(b,'A'),z=createReference(b,'Z');
  setReferencePresentation(b,a,'A','One / Two / Three');setReferencePresentation(b,z,'Z','Other');
  const before=clone(b);
  expect(()=>reorderReferenceTabs(b,'group:One','group:One / Two',true,true)).toThrow('descendants');expect(b).toEqual(before);
  expect(()=>reorderReferenceTabs(b,'group:One','group:Other',true,true)).toThrow('three');expect(b).toEqual(before);
});
it('moves multiple selected DDs in order, deduplicates categories and rejects conflicts atomically',()=>{
  const b=createDemo(),a=createReference(b,'A'),z=createReference(b,'Z'),destination=createReference(b,'Destination');
  setReferencePresentation(b,destination,'Destination','Other');
  const records=clone(b.tables),cells=clone(b.sheets.map(s=>s.cells));
  reorderReferenceSelection(b,[a.id,z.id],'group:Other',true,true);
  expect(referenceNavigation(b)[0].members.map(s=>s.id)).toEqual([destination.id,a.id,z.id]);
  reorderReferenceSelection(b,['group:Other',a.id,z.id],destination.id,false);
  expect(b.tables).toEqual(records);expect(b.sheets.map(s=>s.cells)).toEqual(cells);
  const conflict=createReference(b,'Conflict');setReferencePresentation(b,conflict,'Z','Conflict');
  const before=clone(b);
  expect(()=>reorderReferenceSelection(b,[a.id,z.id],'group:Conflict',true,true)).toThrow('already used');
  expect(b).toEqual(before);
});
it('creates conversions as ordinary sheets and excludes them from DD navigation without dropping their source identities',()=>{
  const b=createDemo(),source=createReference(b,'Convert','conversions'),table=referenceTable(b,source).table;
  expect(referenceTable(b,source).sheet.supporting).toBe(false);expect(table.name).toBe('Convert');
  expect(referenceNavigation(b).flatMap(n=>n.members)).not.toContain(source);
  const sheet=referenceTable(b,source).sheet,row=addRow(b,sheet,1,table);['tbsp','tsp','3'].forEach((value,i)=>setInput(b,sheet,row.id,table.columns[i].column,value));
  const s=b.sheets[0];setInput(b,s,s.rows[1].id,s.columns[0].id,'=XLOOKUP("tbsp",Convert[From Unit],Convert[Conversion Factor],"")');
  expect(new Engine(b).cell(s.id,s.rows[1].id,s.columns[0].id)).toBe(3);
});
it('duplicates only the selected DD with fresh identities and preserves internal formulas, external references and literal ID text',()=>{
  const b=createDemo(),source=createReference(b,'Options'),first=addReferenceValue(b,source,'Base'),second=addReferenceValue(b,source,'Formula'),{table,sheet}=referenceTable(b,source);
  setInput(b,sheet,first,table.columns[0].column,"'"+first);setInput(b,sheet,sheet.rows[20].id,sheet.columns[1].id,'External');setInput(b,sheet,second,table.columns[0].column,'=A2&B21');
  sheet.validations.push({id:uid(),sheet:sheet.id,rows:[second],columns:[table.columns[0].column],source:JSON.stringify(referenceFormula(source))});source.archivedRows.push(first);
  const original=clone(b),copy=duplicateReference(b,source),cloned=referenceTable(b,copy);
  expect(cloned.table.id).not.toBe(table.id);expect(cloned.table.rows.some(r=>table.rows.includes(r))).toBe(false);expect(copy.archivedRows).toEqual([cloned.table.rows[0]]);
  expect(referenceChoices(b,copy,true).map(c=>c.value)).toEqual([first,first+'External']);
  expect(JSON.parse(cloned.sheet.validations[0].source).table).toBe(cloned.table.id);expect(cloned.sheet.validations[0].id).not.toBe(sheet.validations[0].id);
  for(const s of original.sheets)expect(b.sheets.find(x=>x.id===s.id)).toEqual(s);for(const t of original.tables)expect(b.tables.find(x=>x.id===t.id)).toEqual(t);
  setInput(b,cloned.sheet,cloned.table.rows[0],cloned.table.columns[0].column,'New');
  expect(referenceChoices(b,copy,true).map(c=>c.value)).toEqual(['New','NewExternal']);expect(referenceChoices(b,source,true).map(c=>c.value)).toEqual([first,first+'External']);
  validateBook(JSON.parse(JSON.stringify(b)));
});
it('duplicates a live DD definition independently without redirecting its original name or anchor',()=>{
  const b=createDemo(),source=createReference(b,'Live','derived'),table=b.tables.find(t=>t.name==='Ingredients')!;setDerivedSource(b,source,table.id,table.columns[0].id);
  const before=clone(b.names.find(n=>n.id===source.nameId)),copy=duplicateReference(b,source);
  expect(copy.nameId).not.toBe(source.nameId);expect(referenceChoices(b,copy)).toEqual(referenceChoices(b,source));
  setDerivedSource(b,copy,table.id,table.columns[1].id);
  expect(b.names.find(n=>n.id===source.nameId)).toEqual(before);expect(copy.derived?.column).toBe(table.columns[1].id);expect(source.derived?.column).toBe(table.columns[0].id);
});
it('resolves dropdown choices with exact identities, retaining blanks and excluding archived options',()=>{
  const b=seedDropdownCatalog(createDemo()).book,s=b.sheets[0],period=b.references!.find(r=>r.name==='Period')!,table=b.tables.find(t=>t.id===period.table)!;
  const validation={id:uid(),rows:[s.rows[1].id],columns:[s.columns[0].id],sheet:s.id,source:JSON.stringify({kind:'structured',table:table.id,columns:[period.column],mode:'data'})};
  const choices=()=>validationChoices(b,validation,s.rows[1].id,s.columns[0].id,new Engine(b)).choices;
  expect(choices().map(c=>c.value)).toEqual(['','Spotting','Yes']);
  expect(choices()[0].binding).toEqual({table:table.id,row:table.rows[0],column:period.column});
  period.archivedRows.push(table.rows[1]);expect(choices().map(c=>c.value)).toEqual(['','Yes']);
  b.tables=b.tables.filter(t=>t.id!==table.id);expect(choices).toThrow('missing');
});
it('resolves named table dropdowns by stable fields and keeps literal strings distinct from numbers',()=>{
  const b=createDemo(),s=b.sheets[0],table=b.tables.find(t=>t.name==='Ingredients')!,name={id:uid(),name:'IngredientChoices',context:s.id,original:'=Ingredients[Ingredient]',formula:compile('=Ingredients[Ingredient]',b,s.id,s.rows[1].id,s.columns[0].id)};
  b.names.push(name);
  const validation={id:uid(),rows:[s.rows[1].id],columns:[s.columns[0].id],sheet:s.id,source:JSON.stringify({kind:'name',id:name.id})};
  const choices=validationChoices(b,validation,s.rows[1].id,s.columns[0].id,new Engine(b)).choices;
  expect(choices[0].binding).toEqual({table:table.id,row:table.rows[0],column:table.columns[0].id});
  table.name='RenamedIngredients';table.columns[0].name='RenamedIngredient';
  expect(validationChoices(b,validation,s.rows[1].id,s.columns[0].id,new Engine(b)).choices).toEqual(choices);
  expect(validationChoices(b,{...validation,values:['01',' ','']},s.rows[1].id,s.columns[0].id,new Engine(b)).choices).toEqual([{value:'01',raw:'01'},{value:' ',raw:' '},{value:'',raw:''}]);
});
it('combines dropdown sources without merging duplicate labels or their identities',()=>{
  const b=createDemo(),a=createReference(b,'First list'),z=createReference(b,'Second list'),one=addReferenceValue(b,a,'Same'),two=addReferenceValue(b,z,'Same'),s=b.sheets[0];
  const ast={kind:'call',name:'VSTACK',args:[a,z].map(ref=>({kind:'structured',table:ref.table,columns:[ref.column],mode:'data'}))};
  const v={id:uid(),rows:[s.rows[1].id],columns:[s.columns[0].id],sheet:s.id,source:JSON.stringify(ast)};
  const choices=validationChoices(b,v,s.rows[1].id,s.columns[0].id,new Engine(b)).choices;
  expect(choices.map(c=>[c.value,c.source,c.binding?.row])).toEqual([['Same','First list',one],['Same','Second list',two]]);
  s.cells[key(s.rows[1].id,s.columns[0].id)]={binding:choices[1].binding};renameReferenceValue(b,z,two,'Renamed');
  expect(new Engine(b).cell(s.id,s.rows[1].id,s.columns[0].id)).toBe('Renamed');
  const table=b.tables.find(t=>t.name==='Ingredients')!,stacked=new Engine(b).evaluate({kind:'call',name:'VSTACK',args:[{kind:'structured',table:table.id,columns:table.columns.slice(0,2).map(c=>c.id),mode:'data'},{kind:'literal',value:5}]},s.id,s.rows[1].id,s.columns[0].id);
  expect(Array.isArray(stacked)).toBe(true);if(Array.isArray(stacked))expect(stacked.at(-1)).toMatchObject([5,{error:'#N/A'}]);
});
it('picker group identities survive source renames and literal stacks remain one list',()=>{
  const b=createDemo(),a=createReference(b,'First'),z=createReference(b,'Second'),s=b.sheets[0];
  addReferenceValue(b,a,'Same');addReferenceValue(b,z,'Same');
  const v={id:uid(),rows:[s.rows[1].id],columns:[s.columns[0].id],sheet:s.id,source:JSON.stringify({kind:'call',name:'VSTACK',args:[a,z].map(ref=>({kind:'structured',table:ref.table,columns:[ref.column],mode:'data'}))})};
  const before=validationChoiceGroups(b,v,s.rows[1].id,s.columns[0].id,new Engine(b));
  a.name='Renamed source';b.tables.find(t=>t.id===a.table)!.name='Renamed table';
  const after=validationChoiceGroups(b,v,s.rows[1].id,s.columns[0].id,new Engine(b));
  expect(after.map(g=>g.id)).toEqual(before.map(g=>g.id));expect(after[0].name).toBe('Renamed source');expect(after[0].id).not.toBe(after[1].id);
  const literals=validationChoiceGroups(b,{...v,source:JSON.stringify({kind:'call',name:'VSTACK',args:[{kind:'literal',value:'01'},{kind:'literal',value:' '}]})},s.rows[1].id,s.columns[0].id,new Engine(b));
  expect(literals).toHaveLength(1);expect(literals[0].choices.map(c=>c.raw)).toEqual(['01',' ']);
});
it('later original supporting import reuses bundled catalogs and keeps edited/archived exact row bindings intact',()=>{
  const incoming=source(),dropdowns=incoming.sheets.find(s=>s.name==='Dropdowns')!;
  dropdowns.cells={};
  for(const list of dropdownCatalog.lists){
    const t=incoming.tables.find(t=>t.name===list.name)!,at=Number(list.range.split(':')[0].slice(1))-1;
    t.header=dropdowns.rows[at].id;t.rows=list.values.map((_,i)=>dropdowns.rows[at+i+1].id);t.columns[0].name=list.field;
    dropdowns.cells[key(t.header,t.columns[0].column)]={value:list.field};
    list.values.forEach((value,i)=>dropdowns.cells[key(t.rows[i],t.columns[0].column)]={value});
  }
  const before=seedDropdownCatalog(createDemo()).book,ref=before.references!.find(r=>r.name==='IngredientType')!,choice=referenceChoices(before,ref)[0];
  renameReferenceValue(before,ref,choice.row,'Edited category');ref.archivedRows.push(choice.row);
  const log=before.sheets[0];log.cells[key(log.rows[2].id,log.columns[0].id)]={binding:choice.binding};
  const copied=clone(before),merged=mergeReferences(before,incoming,'original-package').book;
  expect(merged.references).toHaveLength(9);
  expect(merged.references!.find(r=>r.id===ref.id)?.archivedRows).toEqual([choice.row]);
  expect(new Engine(merged).cell(log.id,log.rows[2].id,log.columns[0].id)).toBe('Edited category');
  for(const t of copied.tables)expect(merged.tables.find(table=>table.id===t.id)).toEqual(t);
  for(const s of copied.sheets)expect(merged.sheets.find(sheet=>sheet.id===s.id)?.cells).toMatchObject(s.cells);
  expect(mergeReferences(merged,incoming,'original-package').changed).toBe(false);
});
it('imports auxiliary records only, hides supporting presentation, preserves missing original Meals rather than relinking demo, and is idempotent',()=>{
  const before=createDemo(),original=clone(before),incoming=source(),merged=mergeReferences(before,incoming,'invented-original'),b=merged.book;
  expect(before).toEqual(original);expect(merged.counts.map(t=>t.rows)).toEqual([2,2,2,2,2,2,2,1]);expect(merged.derivedUnavailable).toBe(true);
  expect(b.sheets.find(s=>s.id===before.sheets[1].id)).toEqual(before.sheets[1]);
  expect(b.sheets.filter(s=>s.supporting).map(s=>s.name)).toEqual(['Dropdowns','Convert','MealDD']);
  const derived=b.references!.find(s=>s.kind==='derived')!;expect(()=>referenceChoices(b,derived)).toThrow('Original derived source unavailable');
  expect(derived.deferredNames).toHaveLength(1);expect(b.tables.filter(t=>t.name==='Meals')).toHaveLength(1);
  expect(mergeReferences(b,source(),'invented-original',true)).toMatchObject({changed:false});
  validateBook(JSON.parse(JSON.stringify(b)));
  const named=compile('=MealDD',b,b.sheets[0].id,b.sheets[0].rows[2].id,b.sheets[0].columns[0].id);
  expect(validationReference(b,named,b.sheets[0].id)?.id).toBe(derived.id);
  const table=b.tables.find(t=>t.name==='Meals')!;
  setDerivedSource(b,derived,table.id,table.columns[0].id);
  expect(referenceChoices(b,derived).map(o=>o.value)).toEqual(['Example breakfast']);
});
it('keeps linked options distinct through duplicate labels, rename, reorder and archive; manual text stays manual',()=>{
  const b=createDemo(),ref=createReference(b,'Types'),a=addReferenceValue(b,ref,'Same label'),c=addReferenceValue(b,ref,'Same label'),log=b.sheets[0],r=log.rows[2].id,col=log.columns[1].id;
  const choice=referenceChoices(b,ref).find(o=>o.row===c)!;log.cells[key(r,col)]={binding:choice.binding};setInput(b,log,log.rows[3].id,col,'Same label');
  renameReferenceValue(b,ref,c,'Renamed');moveReferenceValue(b,ref,c,-1);
  expect(new Engine(b).cell(log.id,r,col)).toBe('Renamed');expect(new Engine(b).cell(log.id,log.rows[3].id,col)).toBe('Same label');expect(referenceChoices(b,ref)[0].row).toBe(c);
  ref.archivedRows.push(c);expect(referenceChoices(b,ref).map(o=>o.row)).toEqual([a]);expect(new Engine(b).cell(log.id,r,col)).toBe('Renamed');
  expect(()=>removeReferenceValue(b,ref,c)).toThrow('linked');
  removeReferenceValue(b,ref,c,a);expect(new Engine(b).cell(log.id,r,col)).toBe('Same label');
});
it('shares unit identities with conversion rules and requires an explicit impact confirmation for factor changes',()=>{
  const b=mergeReferences(createDemo(),source(),'invented-original').book,units=legacyUnits(b),rule=b.references!.find(s=>s.kind==='conversions')!,choices=referenceChoices(b,units),from=choices.find(o=>o.value==='tbsp')!,to=choices.find(o=>o.value==='tsp')!,{table,sheet}=referenceTable(b,rule),row=table.rows[0];
  renameReferenceValue(b,units,from.row,'Spoon');
  expect(new Engine(b).cell(sheet.id,row,table.columns[0].column)).toBe('Spoon');
  const notes=b.sheets[3];setInput(b,notes,notes.rows[1].id,notes.columns[1].id,'=SUM(Convert[Conversion Factor])');
  expect(referenceUsages(b,rule).formulas).toBeGreaterThan(0);const before=clone(b);
  expect(()=>upsertConversion(b,rule,row,from.row,to.row,'6')).toThrow('Confirm conversion change');expect(b).toEqual(before);
  upsertConversion(b,rule,row,from.row,to.row,'6',true);expect(new Engine(b).cell(notes.id,notes.rows[1].id,notes.columns[1].id)).toBe(6);
  units.archivedRows.push(from.row);expect(referenceChoices(b,units).some(o=>o.row===from.row)).toBe(false);expect(new Engine(b).cell(sheet.id,row,table.columns[0].column)).toBe('Spoon');
});
it('refuses colliding sources without changing a workbook or guessing option identities',()=>{
  const b=createDemo(),ref=createReference(b,'IngredientType');addReferenceValue(b,ref,'Synthetic A');
  const{table}=referenceTable(b,ref);table.name='IngredientType';
  const before=clone(b);expect(()=>mergeReferences(b,source(),'another-original')).toThrow('already exists');expect(b).toEqual(before);
});
it('reuses verified legacy Ingredients dependencies without replacing formats, but rejects real value or format edits',()=>{
  const incoming=source(),original=incoming.tables.find(t=>t.name==='IngredientType')!,raw=incoming.sheets.find(s=>s.id===original.sheet)!;
  for(const row of[original.header,...original.rows])raw.cells[key(row,original.columns[0].column)].format={number:'general',excelNumberFormat:'@'};
  const b=createDemo(),legacy=clone(raw),owned=new Set([original.header,...original.rows]);
  legacy.cells=Object.fromEntries(Object.entries(legacy.cells).filter(([k])=>owned.has(k.split(':')[0])));
  for(const cell of Object.values(legacy.cells))delete cell.format!.excelNumberFormat;
  b.sheets.push(legacy);b.tables.push(clone(original));b.importReport={originalId:'legacy-original',entries:[],formulaCount:0,unsupported:{}};
  const result=mergeReferences(b,incoming,'legacy-original',true);
  expect(result.book.tables.find(t=>t.name==='IngredientType')!.id).toBe(original.id);
  expect(result.book.sheets.find(s=>s.id===legacy.id)!.cells).toMatchObject(legacy.cells);
  const changed=clone(b);changed.sheets.at(-1)!.cells[key(original.rows[0],original.columns[0].column)].value='Actual local edit';
  expect(()=>mergeReferences(changed,incoming,'legacy-original',true)).toThrow('not overwritten');
  const formatted=clone(b);formatted.sheets.at(-1)!.cells[key(original.rows[0],original.columns[0].column)].format!.number='percent';
  expect(()=>mergeReferences(formatted,incoming,'legacy-original',true)).toThrow('not overwritten');
});
it('persists authored factor formula changes even when their current result is equal, and refuses nonformula expressions',()=>{
  const b=mergeReferences(createDemo(),source(),'invented-original').book,units=legacyUnits(b),rule=b.references!.find(s=>s.kind==='conversions')!,choices=referenceChoices(b,units),{table,sheet}=referenceTable(b,rule),row=table.rows[0],from=choices.find(o=>o.value==='tbsp')!,to=choices.find(o=>o.value==='tsp')!,factor=table.columns[2].column;
  upsertConversion(b,rule,row,from.row,to.row,'=1+2',true);expect(new Engine(b).cell(sheet.id,row,factor)).toBe(3);
  upsertConversion(b,rule,row,from.row,to.row,'3',true);expect(sheet.cells[key(row,factor)].formula).toBeUndefined();expect(sheet.cells[key(row,factor)].value).toBe(3);
  expect(()=>upsertConversion(b,rule,row,from.row,to.row,'1+2',true)).toThrow('start a formula');
  const derived=createReference(b,'Live test','derived'),nameId=derived.nameId!;
  b.names=b.names.filter(n=>n.id!==nameId);
  expect(()=>validationReference(b,{kind:'name',id:nameId},sheet.id)).toThrow('#REF!');
});
