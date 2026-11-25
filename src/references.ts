import { compare,compile,displayFormula,Engine,flatten,scalar,type Ast } from './formula';
import { allTables,allSheets, addRow,blankSheet,clone,deleteRows,duplicateSheet,getCell,isFault,key,mapAst,move,moveRows,setInput,uid,uniqueName,type Cell,type ReferenceSource,type Scalar,type Sheet,type Table,type Validation,type Workbook } from './model';
import {editTableAxis} from './table-operations';

export interface ReferenceChoice {row:string;value:string;binding:{table:string;row:string;column:string}}
export const referenceLabel=(source:ReferenceSource)=>source.label??source.name;
export const referenceCaption=(source:ReferenceSource)=>source.group?`${source.group} / ${referenceLabel(source)}`:referenceLabel(source);
export function referenceGroups(book:Workbook){
  const groups:{key:string;label:string;group?:string;members:ReferenceSource[]}[]=[];
  for(const source of (book.references??[]).filter(s=>s.kind!=='units'&&s.kind!=='conversions')){
    const key=source.group?`group:${source.group.toLowerCase()}`:`source:${source.id}`,existing=groups.find(g=>g.key===key);
    if(existing)existing.members.push(source);else groups.push({key,label:source.group??referenceLabel(source),group:source.group,members:[source]});
  }
  return groups;
}
export interface ReferenceNavigation {label:string;group?:string;members:ReferenceSource[];children:ReferenceNavigation[]}
export function referenceNavigation(book:Workbook):ReferenceNavigation[]{
  const roots:ReferenceNavigation[]=[];
  const stored=new Set(book.dropdownData?.tables.map(table=>table.id));
  for(const source of (book.references??[]).filter(source=>!source.workbookOnly&&(source.kind!=='units'&&source.kind!=='conversions'||!!source.table&&stored.has(source.table)))){
    let children=roots,path='';
    for(const label of source.group?.split('/').map(s=>s.trim()).filter(Boolean)??[]){
      path=path?`${path} / ${label}`:label;
      let node=children.find(n=>n.group?.toLowerCase()===path.toLowerCase());
      if(!node){node={label,group:path,members:[],children:[]};children.push(node);}
      node.members.push(source);children=node.children;
    }
    children.push({label:referenceLabel(source),members:[source],children:[]});
  }
  return roots;
}
export function setReferencePresentation(book:Workbook,source:ReferenceSource,label:string,group=''):void{
  label=label.trim();group=normalizeReferenceGroup(group);
  if(!label)throw Error('Use a nonempty dropdown display name.');
  const others=(book.references??[]).filter(s=>s.id!==source.id);
  group=others.find(s=>s.group?.toLowerCase()===group.toLowerCase())?.group??group;
  if(others.some(s=>(s.group??'').toLowerCase()===group.toLowerCase()&&referenceLabel(s).toLowerCase()===label.toLowerCase()))throw Error('That display name is already used in this group.');
  source.label=label===source.name?undefined:label;source.group=group||undefined;
}
export function normalizeReferenceGroup(group:string):string{
  if(!group.trim())return'';
  const parts=group.split('/').map(s=>s.trim());
  if(parts.some(s=>!s))throw Error('Use a category name between each slash.');
  if(parts.length>3)throw Error('DD categories support up to three nested levels.');
  return parts.join(' / ');
}
export function renameReferenceGroup(book:Workbook,group:string,name:string):void{
  name=name.trim();if(!name)throw Error('Use a nonempty group name.');
  if(name.includes('/'))throw Error('Rename one category at a time, without a slash.');
  const parts=group.split(' / '),renamed=[...parts.slice(0,-1),name].join(' / ');
  const belongs=(path:string|undefined)=>path?.toLowerCase()===group.toLowerCase()||path?.toLowerCase().startsWith(group.toLowerCase()+' / ');
  if((book.references??[]).some(s=>!belongs(s.group)&&(s.group?.toLowerCase()===renamed.toLowerCase()||s.group?.toLowerCase().startsWith(renamed.toLowerCase()+' / '))))throw Error('That group name is already used.');
  const members=(book.references??[]).filter(s=>belongs(s.group));
  if(!members.length)throw Error('The dropdown group no longer exists.');
  for(const source of members)source.group=renamed+source.group!.slice(group.length);
  const prefix='dd-group-collapsed:';
  for(const key of Object.keys(book.pickerSources)){
    const path=key.slice(prefix.length);if(!key.startsWith(prefix)||!belongs(path))continue;
    const replacement=prefix+renamed.toLowerCase()+path.slice(group.length);
    if(key!==replacement){book.pickerSources[replacement]=book.pickerSources[key];delete book.pickerSources[key];}
  }
}
export function moveReferenceGroup(book:Workbook,group:string,delta:number):void{
  let siblings=referenceNavigation(book);
  const parts=group.split(' / ');
  for(let i=1;i<parts.length;i++){const parent=siblings.find(n=>n.group?.toLowerCase()===parts.slice(0,i).join(' / ').toLowerCase());if(!parent)throw Error('The DD category no longer exists.');siblings=parent.children;}
  const at=siblings.findIndex(n=>n.group?.toLowerCase()===group.toLowerCase());
  if(at<0)throw Error('The DD category no longer exists.');
  reorderReferenceNodes(book,siblings,at,at+delta);
}
function reorderReferenceNodes(book:Workbook,nodes:ReferenceNavigation[],from:number,to:number):void{
  const ids=new Set(nodes.flatMap(n=>n.members.map(s=>s.id)));
  move(nodes,from,to);const ordered=nodes.flatMap(n=>n.members);let i=0;
  book.references=book.references?.map(source=>ids.has(source.id)?ordered[i++]:source);
}
export function reorderReferenceTabs(book:Workbook,moving:string,target:string,after:boolean,inside=false):void{
  const token=(node:ReferenceNavigation)=>node.group?`group:${node.group}`:node.members[0].id;
  const find=(nodes:ReferenceNavigation[],wanted:string,parent?:string):{node:ReferenceNavigation;parent?:string}|undefined=>{
    for(const node of nodes){if(token(node)===wanted)return{node,parent};const result=find(node.children,wanted,node.group);if(result)return result;}
  };
  const nodes=referenceNavigation(book),from=find(nodes,moving),to=find(nodes,target);
  if(!from||!to)throw Error('The dragged DD tab or destination no longer exists.');
  if(moving===target){if(inside&&from.node.group)throw Error('A category cannot contain itself.');return;}
  const ids=new Set(from.node.members.map(s=>s.id)),parent=inside&&to.node.group?to.node.group:to.parent;
  if(from.node.group){
    const old=from.node.group,prefix=old.toLowerCase()+' / ';
    if(parent?.toLowerCase()===old.toLowerCase()||parent?.toLowerCase().startsWith(prefix)||to.node.members.every(s=>ids.has(s.id)))throw Error('A category cannot be moved into its own descendants.');
    const next=[parent,from.node.label].filter(Boolean).join(' / ');
    if((book.references??[]).some(s=>!ids.has(s.id)&&(s.group?.toLowerCase()===next.toLowerCase()||s.group?.toLowerCase().startsWith(next.toLowerCase()+' / '))))throw Error('That category name already exists at the destination.');
    const paths=from.node.members.map(s=>next+s.group!.slice(old.length));
    if(paths.some(path=>path.split(' / ').length>3))throw Error('DD categories support up to three nested levels.');
    from.node.members.forEach((s,i)=>s.group=paths[i]);
    const keyPrefix='dd-group-collapsed:';
    for(const key of Object.keys(book.pickerSources)){
      if(!key.startsWith(keyPrefix))continue;
      const path=key.slice(keyPrefix.length);
      if(path!==old.toLowerCase()&&!path.startsWith(prefix))continue;
      const replacement=keyPrefix+next.toLowerCase()+path.slice(old.length);
      if(key!==replacement){book.pickerSources[replacement]=book.pickerSources[key];delete book.pickerSources[key];}
    }
  }else setReferencePresentation(book,from.node.members[0],referenceLabel(from.node.members[0]),parent);
  const remaining=(book.references??[]).filter(s=>!ids.has(s.id)),anchors=to.node.members.filter(s=>!ids.has(s.id)),anchor=after||inside?anchors.at(-1):anchors[0];
  if(!anchor)return;
  const index=remaining.findIndex(s=>s.id===anchor.id)+(after||inside?1:0);
  remaining.splice(index,0,...from.node.members);book.references=remaining;
}
export function reorderReferenceSelection(book:Workbook,tokens:string[],target:string,after:boolean,inside=false):void{
  const nodes:ReferenceNavigation[]=[];
  const collect=(entries:ReferenceNavigation[])=>{for(const node of entries){nodes.push(node);collect(node.children);}};collect(referenceNavigation(book));
  const selected=nodes.filter(n=>tokens.includes(n.group?`group:${n.group}`:n.members[0].id));
  if(!selected.length||selected.length!==new Set(tokens).size)throw Error('A selected DD tab no longer exists.');
  const top=selected.filter(n=>!selected.some(parent=>parent!==n&&parent.group&&(n.group?n.group.toLowerCase().startsWith(parent.group.toLowerCase()+' / '):parent.members.some(s=>s.id===n.members[0].id))));
  const destination=nodes.find(n=>(n.group?`group:${n.group}`:n.members[0].id)===target);
  if(destination&&top.some(n=>destination.members.every(s=>n.members.some(member=>member.id===s.id)))){if(inside)throw Error('A selection cannot contain itself or its descendants.');return;}
  const draft={...book,references:clone(book.references),pickerSources:{...book.pickerSources}};
  for(const node of after&&!inside?[...top].reverse():top)reorderReferenceTabs(draft,node.group?`group:${node.group}`:node.members[0].id,target,after,inside);
  book.references=draft.references;book.pickerSources=draft.pickerSources;
}
export function referenceTable(book:Workbook,source:ReferenceSource):{table:Table;sheet:Sheet}{
  const table=allTables(book).find(t=>t.id===source.table),sheet=allSheets(book).find(s=>s.id===table?.sheet);
  if(!table||!sheet)throw Error('The original reference table is missing. Restore or reconnect it explicitly.');
  return{table,sheet};
}
export function duplicateReference(book:Workbook,source:ReferenceSource):ReferenceSource{
  if(!book.references?.some(s=>s.id===source.id))throw Error('This DD no longer exists.');
  const copy:ReferenceSource={...clone(source),id:uid(),name:uniqueName(book.references.map(s=>s.name),source.name+' copy')};
  delete copy.origin;delete copy.catalog;delete copy.anchor;
  copy.label=uniqueName(book.references.filter(s=>s.group===source.group).map(referenceLabel),referenceLabel(source)+' copy');
  if(source.kind==='derived'){
    const named=book.names.find(n=>n.id===source.nameId);if(!named)throw Error('The original live-list definition is missing.');
    const next={...clone(named),id:uid(),name:uniqueName(book.names.map(n=>n.name),named.name+'_copy')};
    copy.nameId=next.id;book.names.push(next);book.references.push(copy);return copy;
  }
  const {table,sheet}=referenceTable(book,source),rows=new Set([table.header,...table.rows]),columns=new Set(table.columns.map(c=>c.column));
  const scoped:Sheet={...sheet,rows:sheet.rows.filter(r=>rows.has(r.id)),columns:sheet.columns.filter(c=>columns.has(c.id)),
    cells:Object.fromEntries(Object.entries(sheet.cells).filter(([k])=>{const[r,c]=k.split(':');return rows.has(r)&&columns.has(c);})),
    groups:sheet.groups.filter(g=>g.kind!=='summary'||(g.axis==='row'?rows:columns).has(g.members[0])).map(g=>({...g,members:g.members.filter(id=>(g.axis==='row'?rows:columns).has(id))})).filter(g=>g.kind==='summary'?g.members.length>1:g.members.length),
    validations:sheet.validations.map(v=>({...v,rows:v.rows.filter(r=>rows.has(r)),columns:v.columns.filter(c=>columns.has(c))})).filter(v=>v.rows.length&&v.columns.length)};
  const draft={...book,dropdownData:undefined,sheets:[...allSheets(book)],tables:allTables(book).filter(t=>t.sheet!==sheet.id||t.id===table.id),names:book.names.filter(n=>n.sheet!==sheet.id)};
  const copied=duplicateSheet(draft,scoped),newTable=allTables(draft).at(-1)!;
  newTable.name=uniqueName(allTables(book).map(t=>t.name),table.name+'_copy');
  const rowIds=new Map(scoped.rows.map((r,i)=>[r.id,copied.rows[i].id])),columnIds=new Map(scoped.columns.map((c,i)=>[c.id,copied.columns[i].id])),fields=new Map(table.columns.map((c,i)=>[c.id,newTable.columns[i].id]));
  const formula=(ast:Ast):Ast=>{
    mapAst(ast,node=>{if(node.kind==='range'&&node.start.kind==='ref'&&node.end.kind==='ref'&&node.start.sheet===sheet.id&&node.end.sheet===sheet.id){
      const a=node.start,z=node.end,rs=sheet.rows.slice(Math.min(sheet.rows.findIndex(r=>r.id===a.row),sheet.rows.findIndex(r=>r.id===z.row)),Math.max(sheet.rows.findIndex(r=>r.id===a.row),sheet.rows.findIndex(r=>r.id===z.row))+1),cs=sheet.columns.slice(Math.min(sheet.columns.findIndex(c=>c.id===a.column),sheet.columns.findIndex(c=>c.id===z.column)),Math.max(sheet.columns.findIndex(c=>c.id===a.column),sheet.columns.findIndex(c=>c.id===z.column))+1);
      if(rs.some(r=>rows.has(r.id))&&cs.some(c=>columns.has(c.id))&&(rs.some(r=>!rows.has(r.id))||cs.some(c=>!columns.has(c.id))))throw Error('A formula range crosses this DD and outside cells. Duplicate the whole backing sheet instead.');
    }return node;});
    return mapAst(ast,node=>node.kind==='ref'&&node.sheet===sheet.id&&rowIds.has(node.row)&&columnIds.has(node.column)?{...node,sheet:copied.id,row:rowIds.get(node.row)!,column:columnIds.get(node.column)!}:node.kind==='structured'&&node.table===table.id?{...node,table:newTable.id,columns:node.columns.map(c=>fields.get(c)??c)}:node);
  };
  copied.cells=Object.fromEntries(Object.entries(scoped.cells).map(([k,value])=>{
    const[r,c]=k.split(':'),cell=clone(value);if(cell.formula)cell.formula=formula(cell.formula);if(cell.calculation)cell.calculation=formula(cell.calculation);
    if(cell.binding?.table===table.id)cell.binding={table:newTable.id,row:rowIds.get(cell.binding.row)??cell.binding.row,column:fields.get(cell.binding.column)??cell.binding.column};
    return[key(rowIds.get(r)!,columnIds.get(c)!),cell];
  }));
  copied.validations=copied.validations.map((v,i)=>({...v,id:uid(),source:scoped.validations[i].values?v.source:JSON.stringify(formula(scoped.validations[i].source.startsWith('{')?JSON.parse(scoped.validations[i].source) as Ast:compile(scoped.validations[i].source,book,sheet.id,scoped.validations[i].rows[0],scoped.validations[i].columns[0])))}));
  copy.table=newTable.id;copy.column=fields.get(source.column!);
  if(!copy.column)throw Error('The original DD field is missing.');
  copy.archivedRows=source.archivedRows.map(r=>rowIds.get(r)??r);
  if(copy.conversion)copy.conversion={from:fields.get(copy.conversion.from)!,to:fields.get(copy.conversion.to)!,factor:fields.get(copy.conversion.factor)!};
  const storage=book.dropdownData??book;storage.sheets.push(copied);storage.tables.push(newTable);book.references.push(copy);return copy;
}
export function referenceChoices(book:Workbook,source:ReferenceSource,includeArchived=false,includeBlank=false):ReferenceChoice[]{
  if(source.archived&&!includeArchived)return[];
  const derived=source.kind==='derived'?source.derived:undefined;
  const table=allTables(book).find(t=>t.id===(derived?.table??source.table)),column=table?.columns.find(c=>c.id===(derived?.column??source.column));
  if(!table||!column)throw Error(source.kind==='derived'?'Original derived source unavailable. Choose a source explicitly; example Meals are not substituted.':'The original list or field is missing.');
  const filter=derived?.filter,filterColumn=filter?table.columns.find(c=>c.id===filter.column):undefined;
  if(filter&&!filterColumn)throw Error('The original derived filter field is missing.');
  const engine=new Engine(book),result:ReferenceChoice[]=[];
  for(const row of table.rows){
    if(!includeArchived&&source.archivedRows.includes(row))continue;
    if(filter){
      const value=scalar(engine.cell(table.sheet,row,filterColumn!.column));
      if(isFault(value))throw Error(`Derived filter cannot be calculated: ${value.error}`);
      if(compare(value,filter.value)!==0)continue;
    }
    const value=scalar(engine.cell(table.sheet,row,column.column));
    if(isFault(value))throw Error(`List value cannot be calculated: ${value.error}`);
    if(includeBlank||value!==null&&value!=='')result.push({row,value:String(value??''),binding:{table:table.id,row,column:column.id}});
  }
  return result;
}
export function validationReference(book:Workbook,ast:Ast,context:string,visited=new Set<string>()):ReferenceSource|undefined{
  if(ast.kind==='name'){
    if(!book.names.some(n=>n.id===ast.id))throw Error('#REF!: the named dropdown source was deleted. Restore it or choose a source explicitly.');
    const source=book.references?.find(s=>s.nameId===ast.id);if(source)return source;
    if(visited.has(ast.id))throw Error('Circular named dropdown source.');
    visited.add(ast.id);const named=book.names.find(n=>n.id===ast.id);
    return named?validationReference(book,named.formula,named.context,visited):undefined;
  }
  if(ast.kind==='call'&&ast.name==='INDIRECT'&&ast.args[0]?.kind==='literal'&&typeof ast.args[0].value==='string'){
    const s=allSheets(book).find(s=>s.id===context);if(!s)throw Error('Dropdown context is missing.');
    return validationReference(book,compile(ast.args[0].value,book,context,s.rows[0].id,s.columns[0].id),context,visited);
  }
  if(ast.kind==='structured'&&ast.columns.length===1)return book.references?.find(s=>s.table===ast.table&&s.column===ast.columns[0]&&s.kind!=='conversions');
}
export interface DropdownChoice {value:string;binding?:Cell['binding'];raw?:Scalar;source?:string}
export interface DropdownChoiceGroup {id:string;name:string;choices:DropdownChoice[];target?:{table:string;column:string}}
export function validationChoiceGroups(book:Workbook,validation:Validation,row:string,column:string,engine:Engine,visited=new Set<string>()):DropdownChoiceGroup[]{
    if(validation.values)return[{id:`values:${JSON.stringify(validation.values)}`,name:'Dropdown',choices:validation.values.map(value=>({value,raw:value}))}];
    const original=validation.source.startsWith('{')?JSON.parse(validation.source) as Ast:compile(validation.source,book,validation.sheet,row,column);
    const reference=validationReference(book,original,validation.sheet);
    if(reference){
      const table=reference.derived?.table??reference.table,column=reference.derived?.column??reference.column;
      return[{id:reference.kind==='derived'?`ref:${reference.id}`:`${table}:${column}`,name:referenceCaption(reference),choices:referenceChoices(book,reference,false,true),target:table&&column?{table,column}:undefined}];
    }
    let ast=original,context=validation.sheet;
    while(ast.kind==='name'||ast.kind==='call'&&ast.name==='INDIRECT'&&ast.args[0]?.kind==='literal'&&typeof ast.args[0].value==='string'){
      if(ast.kind==='name'){
        if(visited.has(ast.id))throw Error('Circular named dropdown source.');
        const id=ast.id;visited.add(id);const named=book.names.find(n=>n.id===id);if(!named)throw Error('The named dropdown source was deleted.');
        ast=named.formula;context=named.context;
      }else{
        const arg=ast.args[0];if(arg.kind!=='literal'||typeof arg.value!=='string')throw Error('The dropdown reference is not a text formula.');
        ast=compile(arg.value,book,context,row,column);
      }
    }
    if(ast.kind==='call'&&ast.name==='VSTACK'&&!ast.args.every(arg=>arg.kind==='literal')){
      return ast.args.flatMap(arg=>validationChoiceGroups(book,{...validation,source:JSON.stringify(arg),sheet:context},row,column,engine,new Set(visited)));
    }
    if(ast.kind==='structured'&&ast.mode==='data'&&ast.columns.length===1){
      const structured=ast,table=allTables(book).find(t=>t.id===structured.table),field=table?.columns.find(c=>c.id===structured.columns[0]);
      if(!table||!field)throw Error('The dropdown table or field was deleted.');
      const source=book.references?.find(s=>s.table===table.id);
      return[{id:`${table.id}:${field.id}`,name:source?referenceCaption(source):table.name,target:{table:table.id,column:field.id},choices:source?.archived?[]:table.rows.filter(r=>!source?.archivedRows.includes(r)).map(r=>{
        const value=scalar(engine.cell(table.sheet,r,field.column));if(isFault(value))throw Error(`Dropdown source cannot be calculated: ${value.error}`);
        return{value:String(value??''),binding:{table:table.id,row:r,column:field.id}};
      })}];
    }
    return[{id:`custom:${JSON.stringify(original)}`,name:'Dropdown',choices:flatten(engine.evaluate(original,validation.sheet,row,column)).map(value=>{
      if(isFault(value))throw Error(`Dropdown source cannot be calculated: ${value.error}`);
      return{value:String(value??''),raw:value};
    })}];
  }
export function validationChoices(book:Workbook,validation:Validation,row:string,column:string,engine:Engine):{name:string;choices:DropdownChoice[]}{
  const groups=validationChoiceGroups(book,validation,row,column,engine);
  return{name:groups.map(group=>group.name).join(' + '),choices:groups.flatMap(group=>group.choices.map(choice=>groups.length>1?{...choice,source:group.name}:choice))};
}
export function createReference(book:Workbook,name:string,kind:ReferenceSource['kind']='list'):ReferenceSource{
  if(!name.trim()||(book.references??[]).some(s=>s.name.toLowerCase()===name.trim().toLowerCase()))throw Error('Choose a nonempty, unique reference name.');
  const source:ReferenceSource={id:uid(),name:name.trim(),kind,archivedRows:[]};
  book.references??=[];book.references.push(source);
  if(kind==='derived'){
    source.nameId=uid();book.names.push({id:source.nameId,name:'Source_'+source.id.replace(/-/g,'_'),context:allSheets(book)[0].id,original:'=#REF!',formula:{kind:'error',value:{error:'#REF!',detail:'Choose the derived list source explicitly.'}}});return source;
  }
  const storage=book.dropdownData??book;
  let sheet=kind==='conversions'?undefined:storage.sheets.find(s=>s.supporting&&s.name==='Lists');
  if(!sheet){sheet=blankSheet(uniqueName(allSheets(book).map(s=>s.name),kind==='conversions'?name:'Lists'),100,kind==='conversions'?3:6);sheet.supporting=!!book.dropdownData||kind!=='conversions';storage.sheets.push(sheet);}
  const end=Math.max(-3,...allTables(book).filter(t=>t.sheet===sheet.id).flatMap(t=>[t.header,...t.rows].map(id=>sheet!.rows.findIndex(r=>r.id===id))),...Object.keys(sheet.cells).map(k=>sheet!.rows.findIndex(r=>r.id===k.split(':')[0])));
  const at=kind==='conversions'?0:end+3;while(sheet.rows.length<=at+2)sheet.rows.push({id:uid()});
  const fields=kind==='conversions'?['From Unit','To Unit','Conversion Factor']:['Value'];
  const table:Table={id:uid(),name:kind==='conversions'?uniqueName(allTables(book).map(t=>t.name),name):'List_'+uid().replace(/-/g,'_'),sheet:sheet.id,header:sheet.rows[at].id,rows:[],columns:fields.map((name,i)=>({id:uid(),column:sheet!.columns[i].id,name}))};
  source.table=table.id;source.column=table.columns[0].id;
  if(kind==='conversions')source.conversion={from:table.columns[0].id,to:table.columns[1].id,factor:table.columns[2].id};
  storage.tables.push(table);for(const c of table.columns)setInput(book,sheet,table.header,c.column,c.name);
  return source;
}
export function addReferenceValue(book:Workbook,source:ReferenceSource,label:string):string{
  if(!label.trim()||source.kind==='derived'||source.kind==='conversions')throw Error('Enter a nonempty value in an editable list.');
  const {table,sheet}=referenceTable(book,source),column=table.columns.find(c=>c.id===source.column)!;
  if(source.kind==='units'&&referenceChoices(book,source,true).some(o=>o.value===label.trim()))throw Error('This unit label already exists. Select its existing identity.');
  const at=Math.max(sheet.rows.findIndex(r=>r.id===table.header),...table.rows.map(id=>sheet.rows.findIndex(r=>r.id===id)))+1;
  const row=addRow(book,sheet,at,table);setInput(book,sheet,row.id,column.column,"'"+label.trim());return row.id;
}
export function renameReferenceValue(book:Workbook,source:ReferenceSource,row:string,label:string):void{
  if(!label.trim())throw Error('List labels cannot be blank. Archive or delete the option explicitly.');
  const{table,sheet}=referenceTable(book,source),column=table.columns.find(c=>c.id===source.column);
  if(!column||!table.rows.includes(row)||source.kind==='derived'||source.kind==='conversions')throw Error('Choose an editable list option.');
  if(source.kind==='units'&&referenceChoices(book,source,true).some(o=>o.row!==row&&o.value===label.trim()))throw Error('That unit label already has an identity. Replace links explicitly instead.');
  setInput(book,sheet,row,column.column,"'"+label.trim());
}
export function referenceUsages(book:Workbook,source:ReferenceSource,row?:string):{linked:number;formulas:number;manual:number;dropdowns:number}{
  const target=source.derived?.table??source.table,labels=row?referenceChoices(book,source,true).filter(o=>o.row===row).map(o=>o.value):[];
  let linked=0,formulas=0,manual=0,dropdowns=0;
  const sourceSheet=referenceSheet(book,source),table=allTables(book).find(t=>t.id===target),records=new Set(table?[table.header,...table.rows]:[]),columns=new Set(table?.columns.map(c=>c.column));
  const references=(ast:Ast,visited=new Set<string>()):boolean=>{
    let found=false;mapAst(ast,n=>{
      if(n.kind==='structured'&&n.table===target||n.kind==='ref'&&n.sheet===sourceSheet&&records.has(n.row)&&columns.has(n.column))found=true;
      if(n.kind==='name'&&!visited.has(n.id)){visited.add(n.id);const named=book.names.find(name=>name.id===n.id);if(named&&references(named.formula,visited))found=true;}
      return n;
    });return found;
  };
  for(const s of allSheets(book)){
    for(const c of Object.values(s.cells)){
      if(c.binding&&c.binding.table===target&&(!row||c.binding.row===row))linked++;
      if(c.formula&&references(c.formula)||c.calculation&&references(c.calculation))formulas++;
      if(s.id!==sourceSheet&&!c.binding&&typeof c.value==='string'&&labels.includes(c.value))manual++;
    }
    for(const v of s.validations)if(!v.values){
      const ast=v.source.startsWith('{')?JSON.parse(v.source) as Ast:compile(v.source,book,v.sheet,v.rows[0],v.columns[0]);
      if(references(ast)){
        if(validationReference(book,ast,v.sheet)?.id===source.id)dropdowns++;
        else formulas++;
      }
    }
  }
  for(const n of book.names)if(references(n.formula))formulas++;
  return{linked,formulas,manual,dropdowns};
}
function referenceSheet(book:Workbook,source:ReferenceSource):string|undefined{return allTables(book).find(t=>t.id===(source.derived?.table??source.table))?.sheet;}
function exclusiveRow(book:Workbook,sheet:Sheet,table:Table,row:string):void{
  if(allTables(book).some(t=>t.id!==table.id&&t.sheet===sheet.id&&(t.header===row||t.rows.includes(row))))throw Error('Another table shares this row. Archive the option instead.');
  const columns=new Set(table.columns.map(c=>c.column));
  if(Object.entries(sheet.cells).some(([address,c])=>address.startsWith(row+':')&&!columns.has(address.split(':')[1])&&(c.value!=null||c.formula||c.binding||c.note||c.link)))throw Error('This row contains unrelated freeform data. Archive the option instead.');
}
export function moveReferenceValue(book:Workbook,source:ReferenceSource,row:string,direction:-1|1):void{
  const{table,sheet}=referenceTable(book,source),from=table.rows.indexOf(row),to=from+direction;
  if(from<0||to<0||to>=table.rows.length)throw Error('This option is already at the list boundary.');
  const other=table.rows[to];exclusiveRow(book,sheet,table,row);exclusiveRow(book,sheet,table,other);
  if(Math.abs(sheet.rows.findIndex(r=>r.id===row)-sheet.rows.findIndex(r=>r.id===other))!==1)throw Error('Non-list rows separate these options. Rearrange the backing sheet explicitly instead.');
  moveRows(book,sheet,[row],sheet.rows.findIndex(r=>r.id===other)+(direction===1?1:0),table);
}
export function removeReferenceValue(book:Workbook,source:ReferenceSource,row:string,replacement?:string,tableLocal=false):void{
  if(source.kind==='derived')throw Error('Edit the derived source, not a generated option.');
  const usage=referenceUsages(book,source,row),{table,sheet}=referenceTable(book,source);
  if(usage.formulas||usage.manual)throw Error('Formula/text lookups may use this value. Archive it, or update those references explicitly before deleting.');
  if(usage.linked&&!replacement)throw Error('This option is linked. Replace its links, archive it, or cancel.');
  if(replacement&&(!table.rows.includes(replacement)||replacement===row||source.archivedRows.includes(replacement)))throw Error('Choose a different active replacement from this list.');
  if(!tableLocal)exclusiveRow(book,sheet,table,row);
  for(const s of allSheets(book))for(const[k,c]of Object.entries(s.cells))if(c.binding?.table===table.id&&c.binding.row===row)s.cells[k]={...c,binding:{...c.binding,row:replacement!}};
  if(tableLocal)editTableAxis(book,table.id,'row',{kind:'delete',ids:[row]});
  else{deleteRows(book,sheet,[row]);source.archivedRows=source.archivedRows.filter(id=>id!==row);}
}
export function setDerivedSource(book:Workbook,source:ReferenceSource,tableId:string,columnId:string,filterColumn?:string,value:Scalar=true):void{
  const table=allTables(book).find(t=>t.id===tableId),column=table?.columns.find(c=>c.id===columnId),filter=table?.columns.find(c=>c.id===filterColumn);
  if(source.kind!=='derived'||!table||!column||filterColumn&&!filter)throw Error('Choose an existing source and fields explicitly.');
  source.derived={table:tableId,column:columnId,...(filter?{filter:{column:filter.id,value}}:{})};
  const data:Ast={kind:'structured',table:table.id,columns:[column.id],mode:'data'};
  const formula:Ast=filter?{kind:'call',name:'FILTER',args:[data,{kind:'binary',op:'=',left:{kind:'structured',table:table.id,columns:[filter.id],mode:'data'},right:{kind:'literal',value}}]}:data;
  const named=book.names.find(n=>n.id===source.nameId);if(named){named.formula=clone(formula);named.original=displayFormula(formula,book);}
  if(source.anchor){const s=allSheets(book).find(s=>s.id===source.anchor!.sheet);if(s)s.cells[key(source.anchor.row,source.anchor.column)]={...getCell(s,source.anchor.row,source.anchor.column),formula:clone(formula),value:undefined,spillHint:true};}
}
export function referenceFormula(source:ReferenceSource):Ast{
  if(source.nameId)return{kind:'name',id:source.nameId};
  if(source.table&&source.column)return{kind:'structured',table:source.table,columns:[source.column],mode:'data'};
  throw Error('Configure this source before using it as a dropdown.');
}
export function unitsSource(book:Workbook):ReferenceSource{
  return book.references?.find(s=>s.kind==='units'&&!s.archived)??createReference(book,uniqueName((book.references??[]).map(s=>s.name),'Units'),'units');
}
export function upsertConversion(book:Workbook,source:ReferenceSource,row:string|undefined,from:string,to:string,factorText:string,confirmed=false):string{
  const units=unitsSource(book),choices=referenceChoices(book,units,true),a=choices.find(o=>o.row===from),b=choices.find(o=>o.row===to);
  if(!a||!b)throw Error('Choose explicit named unit identities.');
  const {table,sheet}=referenceTable(book,source),roles=source.conversion;
  if(source.kind!=='conversions'||!roles||row&&!table.rows.includes(row))throw Error('Choose an existing conversion source and rule.');
  const fields={from:table.columns.find(c=>c.id===roles.from),to:table.columns.find(c=>c.id===roles.to),factor:table.columns.find(c=>c.id===roles.factor)};
  if(!fields.from||!fields.to||!fields.factor)throw Error('A conversion field was deleted. Restore its original identity.');
  factorText=factorText.trim();
  if(!factorText.startsWith('=')&&!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(factorText))throw Error('Enter a numeric conversion factor, or start a formula with =.');
  const engine=new Engine(book),at=row??table.header,input=compile(factorText.startsWith('=')?factorText:'='+factorText,book,sheet.id,at,fields.factor.column),factor=scalar(engine.evaluate(input,sheet.id,at,fields.factor.column));
  if(typeof factor!=='number'||!Number.isFinite(factor)||factor<=0)throw Error('Conversion factors must calculate to a positive finite number.');
  const value=(r:string,c:string)=>scalar(engine.cell(sheet.id,r,c));
  if(table.rows.some(r=>r!==row&&value(r,fields.from!.column)===a.value&&value(r,fields.to!.column)===b.value))throw Error('This unit pair already has a rule. Edit that exact rule instead of adding an ambiguous duplicate.');
  if(row&&!confirmed){
    const previous=getCell(sheet,row,fields.factor.column),changed=(previous.formula?previous.original!==factorText:value(row,fields.factor.column)!==factor)||value(row,fields.from.column)!==a.value||value(row,fields.to.column)!==b.value;
    const usages=referenceUsages(book,source);
    if(changed&&(usages.formulas||usages.linked))throw Error(`Confirm conversion change: ${usages.formulas} formula/source and ${usages.linked} linked cell usages may recalculate, including historical records. No values are frozen automatically.`);
  }
  if(!row){const at=Math.max(sheet.rows.findIndex(r=>r.id===table.header),...table.rows.map(id=>sheet.rows.findIndex(r=>r.id===id)))+1;row=addRow(book,sheet,at,table).id;}
  for(const [field,choice]of [[fields.from,a],[fields.to,b]] as const)sheet.cells[key(row,field.column)]={...getCell(sheet,row,field.column),value:undefined,formula:undefined,binding:choice.binding};
  setInput(book,sheet,row,fields.factor.column,factorText);
  return row;
}
