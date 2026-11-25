import {compile,displayFormula,supportedFunctions,type Ast} from './formula';
import {allSheets,allTables,clone,createTranslationContext,getCell,isFault,key,letters,mapAst,translate,uid,uniqueName,type Cell,type ReferenceSource,type Table,type TranslationContext,type Workbook} from './model';
import {referenceChoices,referenceFormula,referenceUsages,setDerivedSource} from './references';
import {validateBook} from './storage';

type Binding=NonNullable<Cell['binding']>;
export interface MasterImportConflict {
  id:string;
  kind:'identity'|'dependency'|'formula'|'validation'|'food'|'collision'|'nutrition';
  message:string;
  locations:string[];
  candidates:{label:string;table?:string;column?:string;row?:string;source?:string}[];
}
export interface MasterFoodMatch {
  text:string;
  rows:{id:string;address:string;nutrition:MasterNutritionStatus;linkPolicy:'auto-link'|'reviewed-link'|'keep-manual'|'needs-review'|'ambiguous'|'source-review'}[];
  status:'unique'|'manual'|'ambiguous'|'source-review';
  choices:{source:string;label:string;binding:Binding;proposed:boolean}[];
}
export interface MasterNutritionStatus {
  status:'none'|'override'|'uncertain';
  overrides:string[];
  uncertain:string[];
}
const nutrientNames=['Calories','Fat','Carbs','Sugar','Protein','Sodium'];
const defaultCache=new WeakMap<Table,Map<string,{raw:string;ast?:Ast}>>();
export function masterNutritionStatus(book:Workbook,table:Table,row:string,context?:TranslationContext):MasterNutritionStatus{
  const sheet=allSheets(book).find(s=>s.id===table.sheet);
  if(!sheet||!table.rows.includes(row))throw Error('The Master nutrition record is unavailable.');
  const overrides:string[]=[],uncertain:string[]=[];
  let defaults=defaultCache.get(table);if(!defaults){defaults=new Map();defaultCache.set(table,defaults);}
  for(const name of nutrientNames){
    const fields=table.columns.filter(c=>c.name.replace(/\s*\([^)]*\)\s*$/,'').toLowerCase()===name.toLowerCase());
    if(fields.length!==1){uncertain.push(name);continue;}
    const field=fields[0],cell=getCell(sheet,row,field.column);
    if(cell.binding||!cell.formula&&(cell.calculation||cell.value!=null&&cell.value!==''&&!isFault(cell.value))){overrides.push(name);continue;}
    if(!cell.formula||!field.formulaDefault){uncertain.push(name);continue;}
    let saved=defaults.get(field.id);
    if(!saved||saved.raw!==field.formulaDefault){
      saved={raw:field.formulaDefault};
      try{saved.ast=compile(field.formulaDefault,book,sheet.id,table.rows[0],field.column);}
      catch{ /* Missing default dependencies leave provenance unresolved. */ }
      defaults.set(field.id,saved);
    }
    let expected:Ast|undefined=saved.ast,unsupported=false;
    if(expected)mapAst(expected,node=>{if(node.kind==='error'||node.kind==='call'&&!supportedFunctions.has(node.name))unsupported=true;return node;});
    if(!expected||unsupported){uncertain.push(name);continue;}
    expected=translate(expected,book,sheet.id,table.rows[0],field.column,row,field.column,sheet.id,context);
    const signature=(ast:Ast)=>JSON.stringify(ast,(key,value)=>key==='implicit'?undefined:value);
    if(signature(cell.formula)!==signature(expected))overrides.push(name);
  }
  return{status:overrides.length?'override':uncertain.length?'uncertain':'none',overrides,uncertain};
}
export interface MasterImportStage {
  destination:{id:string;revision:number};
  source:{sheet:string;table:string;records:number;formulas:number;manualCells:number};
  conflicts:MasterImportConflict[];
  food:MasterFoodMatch[];
  dependencies:{source:string;target?:string;name:string}[];
  summary:{unique:number;reviewed:number;manual:number;ambiguous:number;sourceReview:number;formulaInputs:number};
  prepared?:{book:Workbook;sheet:string;table:string};
}
export interface MasterImportReview {
  destination:{id:string;revision:number};
  mealDD?:{source:string;nameId:string;oldTable:string;table:string;sheet:string;column:string;filterColumn:string;filterValue:true};
  food:Record<string,{text:string;record:Binding&{source:string}}>;
}

/** A read-only stage. No candidate workbook is returned while any decision is unresolved. */
export function stageMasterImport(current:Workbook,source:Workbook,review?:MasterImportReview):MasterImportStage{
  validateBook(current);validateBook(source);
  const roots=source.tables.filter(table=>table.name.toLowerCase()==='master');
  if(roots.length!==1)throw Error('The Excel source must contain exactly one Master table.');
  const root=roots[0],origin=source.sheets.find(sheet=>sheet.id===root.sheet)!;
  const foodField=root.columns.find(column=>column.name.toLowerCase()==='food');
  if(!foodField)throw Error('The original Master Food field is missing.');
  const conflicts:MasterImportConflict[]=[],issues=new Map<string,MasterImportConflict>();
  const issue=(id:string,kind:MasterImportConflict['kind'],message:string,location?:string,candidates:MasterImportConflict['candidates']=[])=>{
    let conflict=issues.get(id);
    if(!conflict){conflict={id,kind,message,locations:[],candidates};issues.set(id,conflict);conflicts.push(conflict);}
    if(location&&!conflict.locations.includes(location))conflict.locations.push(location);
  };
  const book=clone(current);
  if(review){
    if(review.destination.id!==current.id||review.destination.revision!==current.revision)
      issue('review-stale','identity','The workbook changed after review. Stage the latest data and review it again.');
    if(review.mealDD){
      const chosen=review.mealDD,reference=book.references?.find(r=>r.id===chosen.source),named=book.names.find(n=>n.id===chosen.nameId),target=allTables(book).find(t=>t.id===chosen.table);
      const previous=reference?.derived;
      const expected:Ast|undefined=previous?.filter?{kind:'call',name:'FILTER',args:[
        {kind:'structured',table:previous.table,columns:[previous.column],mode:'data'},
        {kind:'binary',op:'=',left:{kind:'structured',table:previous.table,columns:[previous.filter.column],mode:'data'},right:{kind:'literal',value:previous.filter.value}}
      ]}:undefined;
      const signature=(ast:Ast)=>JSON.stringify(ast,(key,value)=>key==='implicit'?undefined:value);
      if(reference?.kind!=='derived'||reference.archived||reference.nameId!==chosen.nameId||previous?.table!==chosen.oldTable||
        allTables(book).some(t=>t.id===chosen.oldTable)||!named||!expected||signature(named.formula)!==signature(expected)||
        target?.sheet!==chosen.sheet||target.name.toLowerCase()!=='meals'||
        target.columns.find(c=>c.id===chosen.column)?.name.toLowerCase()!=='meal'||
        target.columns.find(c=>c.id===chosen.filterColumn)?.name.toLowerCase()!=='ismeal'||chosen.filterValue!==true){
        issue('review-meal-dd-stale','identity','The reviewed Meal DD reconnection no longer matches its existing source, name or target.');
      }else{
        const usage=referenceUsages(book,reference),anchor=reference.anchor,owner=anchor&&allSheets(book).find(s=>s.id===anchor.sheet);
        if(usage.linked||usage.dropdowns||usage.formulas!==1||anchor&&owner?.cells[key(anchor.row,anchor.column)])
          issue('review-meal-dd-impact','identity','The missing Meal DD now has additional usages or an existing anchor. Review that changed impact before reconnecting.');
        else{
          delete reference.anchor;
          setDerivedSource(book,reference,chosen.table,chosen.column,chosen.filterColumn,chosen.filterValue);
          named.context=target.sheet;
        }
      }
    }
  }
  const tables=allTables(book),sheets=allSheets(book),sourceTables=allTables(source),sourceSheets=allSheets(source);
  if(tables.some(table=>table.name.toLowerCase()==='master')||sheets.some(sheet=>sheet.name.toLowerCase()===origin.name.toLowerCase()||sheet.id===origin.id))
    issue('master-collision','collision','A Master table or its destination sheet already exists. Review it explicitly; no replacement or duplicate import is allowed.');
  const existingIds=new Set(sheets.flatMap(sheet=>[sheet.id,...sheet.rows.map(row=>row.id),...sheet.columns.map(column=>column.id)]));
  if([origin.id,...origin.rows.map(row=>row.id),...origin.columns.map(column=>column.id),root.id,...root.columns.map(column=>column.id)].some(id=>existingIds.has(id)||tables.some(table=>table.id===id||table.columns.some(column=>column.id===id))))
    issue('identity-collision','collision','Incoming identities overlap the existing workbook. Use recovery or resolve their provenance before importing.');
  const sheet=clone(origin),table=clone(root);
  const providers=(book.references??[]).filter(reference=>!reference.archived);
  const choices:{source:string;label:string;binding:Binding;proposed:boolean;value:string}[]=[];
  const resolved:Partial<Record<'ingredients'|'meals',ReferenceSource>>={};
  const provider=(role:'ingredients'|'meals')=>{
    const broken=providers.filter(reference=>role==='meals'&&reference.kind==='derived'&&(reference.name.toLowerCase()==='mealdd'||reference.origin?.definition?.toLowerCase().includes('meals['))&&!tables.some(table=>table.id===reference.derived?.table));
    const matches=providers.filter(reference=>{
      const target=tables.find(table=>table.id===(reference.derived?.table??reference.table));
      const field=target?.columns.find(column=>column.id===(reference.derived?.column??reference.column));
      return role==='ingredients'?reference.kind==='list'&&target?.name.toLowerCase()==='ingredients'&&!!field&&['ingredient','ingredients'].includes(field.name.toLowerCase()):
        reference.kind==='derived'&&target?.name.toLowerCase()==='meals'&&field?.name.toLowerCase()==='meal'&&!!reference.derived?.filter&&target.columns.some(column=>column.id===reference.derived!.filter!.column&&column.name.toLowerCase()==='ismeal')&&reference.derived.filter.value===true;
    });
    const add=(reference:ReferenceSource,proposed:boolean)=>{
      try{
        const values=referenceChoices(book,reference);
        for(const value of values){
          const target=tables.find(table=>table.id===value.binding.table)!,owner=sheets.find(sheet=>sheet.id===target.sheet)!;
          const label=`${reference.label??reference.name} - ${owner.name}!${letters(owner.columns.findIndex(column=>column.id===target.columns.find(field=>field.id===value.binding.column)!.column))}${owner.rows.findIndex(row=>row.id===value.row)+1}`;
          choices.push({source:reference.id,label,binding:value.binding,value:value.value,proposed});
        }
        if(!proposed){
          const formula=referenceFormula(reference);
          if(formula.kind==='name'){
            const named=book.names.find(named=>named.id===formula.id),derived=reference.derived;
            const expected:Ast=derived?{kind:'call',name:'FILTER',args:[
              {kind:'structured',table:derived.table,columns:[derived.column],mode:'data'},
              derived.filter?{kind:'binary',op:'=',left:{kind:'structured',table:derived.table,columns:[derived.filter.column],mode:'data'},right:{kind:'literal',value:derived.filter.value}}:{kind:'literal',value:true}
            ]}:{kind:'structured',table:reference.table!,columns:[reference.column!],mode:'data'};
            const signature=(ast:Ast)=>JSON.stringify(ast,(key,value)=>key==='implicit'?undefined:value);
            if(!named||signature(named.formula)!==signature(expected))throw Error('The named DD formula is missing or differs from its declared record source. Review that identity instead of substituting it.');
          }
          resolved[role]=reference;
        }
      }catch(error){
        issue(`source:${role}:${reference.id}`,'identity',`${role} DD cannot be used: ${error instanceof Error?error.message:String(error)}`);
      }
    };
    if(matches.length===1&&!broken.length){add(matches[0],false);return;}
    const candidates:MasterImportConflict['candidates']=matches.map(reference=>({source:reference.id,label:reference.label??reference.name,table:reference.derived?.table??reference.table,column:reference.derived?.column??reference.column}));
    if(role==='meals'&&!matches.length){
      for(const target of tables.filter(table=>table.name.toLowerCase()==='meals')){
        const column=target.columns.find(column=>column.name.toLowerCase()==='meal'),filter=target.columns.find(column=>column.name.toLowerCase()==='ismeal');
        if(!column||!filter)continue;
        const proposed:ReferenceSource={id:`proposed-${target.id}`,name:'Proposed live Meals (not connected)',kind:'derived',archivedRows:[],derived:{table:target.id,column:column.id,filter:{column:filter.id,value:true}}};
        candidates.push({label:`Review live ${target.name}[${column.name}] filtered by ${filter.name}=TRUE; this is not proven to be the original MealDD target`,table:target.id,column:column.id});
        add(proposed,true);
      }
    }
    for(const reference of matches)add(reference,true);
    issue(`source:${role}`,'identity',matches.length>1?`Several ${role} DD sources qualify. Choose the intended source identity.`:
      broken.length?'MealDD points to a missing source identity. Prove its original target, or explicitly review the proposed live Meals target; no relinking by label was performed.':`No usable ${role} DD is configured. Choose its actual source before importing.`,undefined,candidates);
  };
  provider('ingredients');provider('meals');
  const byValue=new Map<string,typeof choices>();
  for(const choice of choices){
    const text=choice.value.toLowerCase(),list=byValue.get(text)??[];
    const same=list.find(existing=>existing.binding.table===choice.binding.table&&existing.binding.row===choice.binding.row&&existing.binding.column===choice.binding.column);
    if(!same)list.push(choice);else if(same.proposed&&!choice.proposed)Object.assign(same,choice);
    byValue.set(text,list);
  }
  const positions=new Map(origin.rows.map((row,index)=>[row.id,index+1]));
  const address=(row:string,column:string)=>`${letters(origin.columns.findIndex(field=>field.id===column))}${positions.get(row)}`;
  const food:MasterFoodMatch[]=[],foodByText=new Map<string,MasterFoodMatch>();
  let formulaInputs=0;const nutritionContext=createTranslationContext(source),reviewedRows=new Set<string>();
  for(const row of table.rows){
    const cell=getCell(origin,row,foodField.column);
    if(cell.formula||cell.binding){if(cell.formula)formulaInputs++;continue;}
    if(cell.value==null||cell.value==='')continue;
    const text=String(cell.value),normalized=text.toLowerCase();
    let match=foodByText.get(normalized);
    if(!match){
      const matching=byValue.get(normalized)??[],complete=!!resolved.ingredients&&!!resolved.meals;
      const status:MasterFoodMatch['status']=matching.length>1?'ambiguous':!complete?'source-review':matching.length===1?'unique':'manual';
      match={text,rows:[],status,choices:matching.map(({source,label,binding,proposed})=>({source,label,binding:{...binding},proposed}))};
      foodByText.set(normalized,match);food.push(match);
    }
    const nutrition=masterNutritionStatus(source,root,row,nutritionContext);
    const location=address(row,foodField.column),submitted=review?.food[location];
    let selected:MasterFoodMatch['choices'][number]|undefined;
    if(submitted){
      reviewedRows.add(location);
      selected=match.choices.find(choice=>!choice.proposed&&choice.source===submitted.record.source&&
        choice.binding.table===submitted.record.table&&choice.binding.row===submitted.record.row&&choice.binding.column===submitted.record.column);
      if(submitted.text.toLowerCase()!==normalized||!selected||cell.calculation){
        selected=undefined;
        issue(`review-food:${location}`,'food','The reviewed Food text, selected DD record or explicit Custom state no longer matches this row.',location);
      }
    }
    const linkPolicy:MasterFoodMatch['rows'][number]['linkPolicy']=selected?'reviewed-link':cell.calculation?'keep-manual':match.choices.length>1?'ambiguous':!match.choices.length||nutrition.status==='override'?'keep-manual':nutrition.status==='uncertain'?'needs-review':match.status==='unique'?'auto-link':'source-review';
    match.rows.push({id:row,address:location,nutrition,linkPolicy});
    if(linkPolicy==='needs-review')issue(`nutrition:${row}`,'nutrition',`The original nutrition formula/default provenance needs review for ${nutrition.uncertain.join(', ')}. Food has not been automatically linked.`,address(row,foodField.column));
    if(linkPolicy==='auto-link'||linkPolicy==='reviewed-link'){
      const bound={...getCell(sheet,row,foodField.column),binding:{...(selected??match.choices[0]).binding}};delete bound.value;
      sheet.cells[key(row,foodField.column)]=bound;
    }
  }
  for(const location of Object.keys(review?.food??{}))if(!reviewedRows.has(location))
    issue(`review-food:${location}`,'food','A submitted Food decision does not identify an original literal Food row.',location);
  for(const match of food.filter(match=>match.rows.some(row=>row.linkPolicy==='ambiguous')))
    issue(`food:${match.rows[0].id}`,'food',`Choose the matching record for "${match.text}". No source precedence or first-match rule is used.`,undefined,match.choices.map(choice=>({label:`${choice.label}${choice.proposed?' (proposed source; identity review required)':''}`,source:choice.source,...choice.binding})));
  for(const match of food.filter(match=>match.rows.some(row=>row.linkPolicy==='ambiguous')))issues.get(`food:${match.rows[0].id}`)!.locations=match.rows.filter(row=>row.linkPolicy==='ambiguous').map(row=>row.address);
  const dependencies:MasterImportStage['dependencies']=[],destinations=new Map<string,Table>([[root.id,table]]);
  const target=(id:string,location:string)=>{
    if(destinations.has(id))return destinations.get(id);
    const original=sourceTables.find(table=>table.id===id),matches=original?tables.filter(table=>table.name.toLowerCase()===original.name.toLowerCase()):[];
    if(!dependencies.some(dependency=>dependency.source===id))dependencies.push({source:id,target:matches.length===1?matches[0].id:undefined,name:original?.name??id});
    if(matches.length!==1){issue(`table:${id}`,'dependency',`Master requires one unambiguous existing "${original?.name??id}" table.`,location,matches.map(table=>({label:table.name,table:table.id})));return;}
    destinations.set(id,matches[0]);return matches[0];
  };
  const cache=new WeakMap<Ast,Ast>(),namedIds=new Map<string,string>(),resolving=new Set<string>();
  const remap=(ast:Ast,location:string):Ast=>{
    const previous=cache.get(ast);if(previous)return previous;
    const result=mapAst(ast,node=>{
      if(node.kind==='structured'){
        const destination=target(node.table,location),original=sourceTables.find(table=>table.id===node.table);
        if(!destination)return node;
        const columns=node.columns.map(id=>{
          const field=original?.columns.find(column=>column.id===id),matches=destination.columns.filter(column=>column.name.toLowerCase()===field?.name.toLowerCase());
          if(matches.length!==1){issue(`field:${node.table}:${id}`,'dependency',`The "${original?.name}" dependency field "${field?.name??id}" is missing or ambiguous.`,location);return id;}
          return matches[0].id;
        });
        return {...node,table:destination.id,columns};
      }
      if(node.kind==='ref'&&node.sheet!==origin.id){
        const original=sourceSheets.find(sheet=>sheet.id===node.sheet);
        if(original?.name.toLowerCase()==='mealdd'&&node.row===original.rows[0].id&&node.column===original.columns[0].id&&resolved.meals)return referenceFormula(resolved.meals);
        issue(`cell:${node.sheet}:${node.row}:${node.column}`,'dependency',`Master refers to an external cell on "${original?.name??node.sheet}". Its destination identity needs proof; positional or label-based substitution is not allowed.`,location);
      }
      if(node.kind==='name'){
        const original=source.names.find(named=>named.id===node.id),existing=namedIds.get(node.id);
        if(existing)return {...node,id:existing};
        const role=original?.name.toLowerCase()==='mealdd'?'meals':original?.name.toLowerCase()==='ingredientdd'?'ingredients':undefined;
        if(role&&resolved[role]){
          const definition=original!.formula;
          const ingredient=definition.kind==='structured'&&sourceTables.find(table=>table.id===definition.table)?.name.toLowerCase()==='ingredients';
          if(knownFoodSource(definition)&&(role==='ingredients'?ingredient:!ingredient))return referenceFormula(resolved[role]!);
          issue(`named-source:${node.id}`,'identity',`The original "${original!.name}" definition differs from its expected DD source. Review it rather than replacing it by name.`,location);
          return node;
        }
        if(!original||resolving.has(node.id)){issue(`name:${node.id}`,'dependency','A named Master dependency is missing or circular.',location);return node;}
        if(original.sheet&&original.sheet!==origin.id){issue(`name-scope:${node.id}`,'dependency',`Named dependency "${original.name}" belongs to an external sheet. Its scope must be reviewed.`,location);return node;}
        resolving.add(node.id);
        const formula=remap(original.formula,location),id=uid();
        book.names.push({...clone(original),id,name:uniqueName(book.names.filter(named=>named.sheet===original.sheet).map(named=>named.name),original.name),context:sheet.id,formula});
        namedIds.set(node.id,id);resolving.delete(node.id);return {...node,id};
      }
      if(node.kind==='call'){
        if(node.name==='INDIRECT'){
          const input=node.args[0];
          const a1=node.args.length===1||node.args.length===2&&node.args[1].kind==='literal'&&node.args[1].value===true;
          if(input?.kind==='literal'&&typeof input.value==='string'&&a1){
            try{return remap(compile(input.value,source,origin.id,origin.rows[0].id,origin.columns[0].id),location);}
            catch(error){issue(`indirect:${input.value}`,'dependency',`An INDIRECT target cannot be safely remapped: ${error instanceof Error?error.message:String(error)}`,location);}
          }else issue('dynamic-indirect','dependency','A dynamic INDIRECT expression needs explicit review before importing into a workbook with different identities.',location);
        }else if(!supportedFunctions.has(node.name))issue(`function:${node.name}`,'formula',`The original formula uses unsupported ${node.name}. Preserve its original expression and review compatibility before import.`,location);
      }
      if(node.kind==='error')issue(`error:${node.value.error}:${node.value.detail??''}`,'formula',`Original formula error ${node.value.error} is retained, not repaired or frozen. Review it before import.`,location);
      return node;
    });
    cache.set(ast,result);return result;
  };
  let formulas=0,manualCells=0;
  for(const [cellKey,cell]of Object.entries(sheet.cells)){
    const [row,column]=cellKey.split(':'),location=address(row,column);
    if(cell.formula){cell.formula=remap(cell.formula,location);formulas++;}
    else if(origin.cells[cellKey].value!==null&&origin.cells[cellKey].value!==undefined&&origin.cells[cellKey].value!=='')manualCells++;
    if(cell.calculation)cell.calculation=remap(cell.calculation,location);
    if(origin.cells[cellKey]?.binding)issue(`incoming-binding:${cellKey}`,'identity','The source already contains record bindings. Restore its native backup rather than reimporting unknown identities.',location);
  }
  const foodValidations=sheet.validations.filter(validation=>validation.columns.includes(foodField.column));
  const parseValidation=(validation:typeof sheet.validations[number])=>validation.source.startsWith('{')?JSON.parse(validation.source) as Ast:compile(validation.source,source,origin.id,validation.rows[0],validation.columns[0]);
  sheet.validations=sheet.validations.flatMap(validation=>{
    const columns=validation.columns.filter(column=>column!==foodField.column);
    if(!columns.length)return[];
    const copy={...validation,columns};
    if(!copy.values){
      try{const ast=parseValidation(copy);copy.originalSource=copy.originalSource??displayFormula(ast,source);copy.source=JSON.stringify(remap(ast,`Validation ${address(copy.rows[0],columns[0])}`));}
      catch(error){issue(`validation:${copy.id}`,'validation',`Validation source could not be preserved: ${error instanceof Error?error.message:String(error)}`);}
    }
    return[copy];
  });
  function knownFoodSource(ast:Ast,visited=new Set<string>()):boolean{
    if(ast.kind==='structured'){
      const target=sourceTables.find(table=>table.id===ast.table),field=target?.columns.find(column=>column.id===ast.columns[0]);
      return ast.columns.length===1&&!!field&&(target?.name.toLowerCase()==='ingredients'&&['ingredient','ingredients'].includes(field.name.toLowerCase())||target?.name.toLowerCase()==='meals'&&field.name.toLowerCase()==='meal');
    }
    if(ast.kind==='name'){
      const named=source.names.find(named=>named.id===ast.id);
      if(!named||visited.has(ast.id))return false;
      visited.add(ast.id);
      return ['ingredientdd','mealdd'].includes(named.name.toLowerCase())&&knownFoodSource(named.formula,visited);
    }
    if(ast.kind==='ref'){
      const target=sourceSheets.find(sheet=>sheet.id===ast.sheet);
      return target?.name.toLowerCase()==='mealdd'&&ast.row===target.rows[0].id&&ast.column===target.columns[0].id;
    }
    if(ast.kind==='spill')return knownFoodSource(ast.child,visited);
    if(ast.kind==='call'){
      if(ast.name==='INDIRECT'&&ast.args.length===1&&ast.args[0]?.kind==='literal'&&typeof ast.args[0].value==='string')return knownFoodSource(compile(ast.args[0].value,source,origin.id,origin.rows[0].id,foodField!.column),visited);
      if(ast.name==='VSTACK')return !!ast.args.length&&ast.args.every(arg=>knownFoodSource(arg,new Set(visited)));
      if(ast.name==='ANCHORARRAY')return ast.args.length===1&&knownFoodSource(ast.args[0],visited);
      if(ast.name==='FILTER'){
        const [values,predicate]=ast.args,left=predicate?.kind==='binary'&&predicate.op==='='?predicate.left:undefined,right=predicate?.kind==='binary'?predicate.right:undefined;
        const target=values?.kind==='structured'?sourceTables.find(table=>table.id===values.table):undefined;
        return ast.args.length===2&&target?.name.toLowerCase()==='meals'&&knownFoodSource(values,visited)&&left?.kind==='structured'&&left.table===target.id&&left.columns.length===1&&target.columns.find(column=>column.id===left.columns[0])?.name.toLowerCase()==='ismeal'&&right?.kind==='literal'&&right.value===true;
      }
    }
    return false;
  }
  for(const validation of foodValidations){
    try{
      const ast=parseValidation(validation);
      if(validation.values)throw Error('A manual Food validation list needs explicit review alongside the combined DD.');
      if(!knownFoodSource(ast))issue(`food-validation:${validation.id}`,'validation','An additional Food validation source needs review; it has not been silently discarded.',address(validation.rows[0],foodField.column));
    }catch(error){issue(`food-validation:${validation.id}`,'validation',error instanceof Error?error.message:String(error));}
  }
  if(resolved.ingredients&&resolved.meals){
    sheet.validations.push({id:uid(),sheet:sheet.id,rows:[...table.rows],columns:[foodField.column],source:JSON.stringify({kind:'call',name:'VSTACK',args:[referenceFormula(resolved.ingredients),referenceFormula(resolved.meals)]} satisfies Ast),originalSource:JSON.stringify(foodValidations)});
  }
  book.sheets.push(sheet);book.tables.push(table);book.revision++;
  const summary={unique:0,reviewed:0,manual:0,ambiguous:0,sourceReview:0,formulaInputs};
  for(const match of food)for(const row of match.rows)summary[row.linkPolicy==='auto-link'?'unique':row.linkPolicy==='reviewed-link'?'reviewed':row.linkPolicy==='keep-manual'?'manual':row.linkPolicy==='ambiguous'?'ambiguous':'sourceReview']++;
  const stage:MasterImportStage={destination:{id:current.id,revision:current.revision},source:{sheet:origin.name,table:root.name,records:root.rows.length,formulas,manualCells},conflicts,food,dependencies,summary};
  if(!conflicts.length){validateBook(book);stage.prepared={book,sheet:sheet.id,table:table.id};}
  return stage;
}
