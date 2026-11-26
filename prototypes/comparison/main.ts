import {parseArchive,decompressArchive} from '../../src/archive';
import {allSheets,allTables,letters,isFault,type Workbook,type Sheet,type Cell,type Group} from '../../src/model';
import {Engine,scalar,displayFormula} from '../../src/formula';
import {validateBook} from '../../src/storage';
import {displayExcelDate,parseDateInput} from '../../src/dates';
import {displayFraction} from '../../src/quantity';
import {dateFormatContext} from '../../src/display-values';
import {hypotheticalProjection} from '../../src/grouping';
import {comparisonSnapshot,listComparisonSnapshots,readComparisonSnapshot,snapshotDate,type ComparisonSnapshot} from '../../src/github-snapshots';
import {mountSelectDropdown} from '../../src/dropdown-ui';
import {navigationIcon,toolbarIcon} from '../../src/icons';
import {githubFormDefaults} from '../../src/github-client';
import type {SyncConfig} from '../../src/storage';
import type {ComparisonFrame,ComparisonSource} from '../../src/comparison-host';
import {compare,scopes,chunks,axisChoices,hasAxisCellPeers,anchorLabel,anchorMismatchLabel,anchorErrorLabel,isDateAnchorLabel,type Scope,type Difference,type Category,type Chunk,type ChoiceAxis} from './comparison-model';

const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const host=(window.frameElement as ComparisonFrame|null)?.comparisonHost;
let left:Workbook,right:Workbook,engines:Engine[],areas:Scope[]=[],differences:Difference[]=[],scope:Scope;
let category:Category|'all'='all',regions:Chunk[]=[],region=0,selected:number|undefined,request=0;
let specific='';
let focus:{difference:number;row?:string;column?:string}|undefined;
let sourcesBusy=true;
const sharedDropdowns=new Map<string,ReturnType<typeof mountSelectDropdown>>();
type Pick='left'|'right';
const choices=new Map<number,Pick>(),choiceHistory:Map<number,Pick>[]=[];
let lastChoiceMessage='';
function sourceName(side:Pick):string{
  const name=el(side+'-kind').textContent,other=el((side==='left'?'right':'left')+'-kind').textContent;
  return name&&name!==other?name:side==='left'?'left copy':'right copy';
}
function filteredChanges():Difference[]{return scope?.differences.filter(d=>(category==='all'||d.category===category)&&(!specific||d.label===specific))??[];}
function axisIdentity(axis:ChoiceAxis):string|undefined{return focus?.difference===selected?focus?.[axis]:undefined;}
function axisTargets(axis:ChoiceAxis){return axisChoices(differences,scope?.sheetId??'@workbook',axis,axisIdentity(axis));}
function axisLocation(axis:ChoiceAxis):string{
  const id=axisIdentity(axis);if(!id)return 'select a cell first';
  const location=(sheet:Sheet|undefined)=>{
    const index=sheet?positions(sheet)[axis==='row'?'rows':'columns'].get(id):undefined;
    return index===undefined?'not present':axis==='row'?String(index+1):letters(index);
  };
  const a=location(scope.left),b=location(scope.right);
  return a===b?a:`L: ${a} / R: ${b}`;
}
function axisDescription(axis:ChoiceAxis):string{
  if(!axisIdentity(axis))return `Select a specific cell or cell-level change to identify a ${axis}.`;
  const {targets,excluded}=axisTargets(axis);
  return `All ${targets.length} ${axis}-specific differences on ${scope.sheetName}, across all tables and outside-table cells. Ignores change-type filters; excludes other ${axis==='row'?'rows':'columns'} and sheets. ${excluded.length} broader structural changes excluded. Whole-table/sheet settings require separate choices.`;
}
function inspectorTargets():Difference[]{
  const target=el<HTMLSelectElement>('keep-scope').value;
  return target==='row'||target==='column'?axisTargets(target).targets:differences.filter(d=>d.id===selected);
}
function choiceTargets():Difference[]{
  const target=el<HTMLSelectElement>('choice-scope').value;
  if(target==='row'||target==='column')return axisTargets(target).targets;
  return target==='workbook'?differences:target==='settings'?differences.filter(d=>d.sheet==='@workbook'):
    target==='sheet'?differences.filter(d=>d.sheet===scope?.sheetId):target==='scope'?scope?.differences??[]:
    target==='area'?regions[region]?.differences??[]:filteredChanges();
}
function pickButtons(container:HTMLElement,targets:Difference[],sides:readonly (Pick|undefined)[]=['left','right',undefined]){
  container.replaceChildren();
  for(const side of sides){
    const button=document.createElement('button');
    button.textContent=side?(container.id.startsWith('keep-')?'Keep':`Keep ${sourceName(side)}`):'Decide later';
    if(side)button.setAttribute('aria-label',`Keep ${side} copy: ${sourceName(side)}`);
    if(container.id==='bulk-buttons')button.setAttribute('aria-describedby','choice-target-description');
    else button.setAttribute('aria-description',el<HTMLSelectElement>('keep-scope').title);
    button.dataset.pick=side??'later';button.disabled=!targets.length;
    button.setAttribute('aria-pressed',String(!!targets.length&&targets.every(d=>choices.get(d.id)===side)));
    button.onclick=()=>applyChoices(targets,side);container.append(button);
  }
}
function applyChoices(targets:Difference[],pick:Pick|undefined){
  if(!targets.some(d=>choices.get(d.id)!==pick))return;
  choiceHistory.push(new Map(choices));
  for(const d of targets)if(pick)choices.set(d.id,pick);else choices.delete(d.id);
  lastChoiceMessage=`${targets.length} ${targets.length===1?'change':'changes'} ${pick?`set to ${sourceName(pick)}`:'returned to undecided'}.`;
  updateChoices();
}
function updateChoices(){
  const leftCount=[...choices.values()].filter(p=>p==='left').length,rightCount=choices.size-leftCount;
  el('selection-progress').textContent=`${choices.size} of ${differences.length} chosen · ${differences.length-choices.size} undecided`;
  el('selection-progress').title=`${sourceName('left')}: ${leftCount}; ${sourceName('right')}: ${rightCount}. ${lastChoiceMessage}`;
  el<HTMLButtonElement>('undo-choice').disabled=!choiceHistory.length;
  el<HTMLButtonElement>('reset-choices').disabled=!choices.size;
  const targets=choiceTargets(),count=targets.filter(d=>choices.has(d.id)).length;
  el('choice-target-count').textContent=`${targets.length} changes · ${count} chosen`;
  const place=scope?.leftTable||scope?.rightTable?`${scope.name} table`:scope?.sheetId==='@workbook'?'workbook settings':`${scope?.sheetName??'current sheet'} outside tables`;
  const sheetName=scope?.sheetName??'current sheet',selector=el<HTMLSelectElement>('choice-scope');
  const targetDescriptions:Record<string,{label:string;description:string}>={
    filtered:{label:`Selected change types in ${place}`,description:`Only the categories and change types selected below, across ${place}. Includes matching changes in other preview areas; excludes other tables and sheets.`},
    area:{label:`Changes listed beside this preview (area ${regions.length?region+1:0}/${regions.length})`,description:'Only the changes in the "Changes in this area" list beside the spreadsheet. Excludes changes in other preview areas.'},
    scope:{label:`Every difference in ${place}`,description:`All differences in ${place}, including change types hidden by the filters below. Excludes other tables and sheets.`},
    sheet:{label:`Every difference on ${sheetName} sheet`,description:`All tables and outside-table changes on the ${sheetName} sheet. Ignores change-type filters; excludes other sheets.`},
    row:{label:`Row ${axisLocation('row')} on ${sheetName} (all change types)`,description:axisDescription('row')},
    column:{label:`Column ${axisLocation('column')} on ${sheetName} (all change types)`,description:axisDescription('column')},
    settings:{label:'Toolbar and other workbook-wide settings',description:'Toolbar order/dividers, named formulas, reference settings, hypothetical appearance and sheet-tab groups. Does not select spreadsheet cells.'},
    workbook:{label:'Every difference in both copies',description:'All sheets, all tables, outside-table changes and workbook-wide settings. Ignores every change-type filter.'},
  };
  for(const option of selector.options){
    const target=targetDescriptions[option.value];
    if(target)option.textContent=target.label;
    if(option.value==='row'||option.value==='column')option.disabled=!axisIdentity(option.value);
  }
  const target=targetDescriptions[selector.value];
  el('choice-target-description').textContent=target?.description??'';
  el('bulk-summary-target').textContent=`${target?.label??''} · ${targets.length} differences`;
  pickButtons(el('bulk-buttons'),targets);
  el('bulk-choice-note').textContent=el<HTMLSelectElement>('choice-scope').value==='settings'&&!targets.length?
    'No workbook-setting differences in this pair. Toolbar order and dividers are compared separately from sheet data.':
    'Replaces earlier choices only in this scope. Individual choices can override a bulk choice. Undo reverses the whole batch.';
  const keepSelector=el<HTMLSelectElement>('keep-scope');
  const showScope=hasAxisCellPeers(regions[region]?.differences??[],scope?.sheetId??'@workbook',{row:axisIdentity('row'),column:axisIdentity('column')});
  keepSelector.closest<HTMLElement>('.keep-scope')!.hidden=!showScope;
  if(!showScope)keepSelector.value='difference';
  for(const option of keepSelector.options)if(option.value==='row'||option.value==='column'){
    option.textContent=`${option.value==='row'?'Row':'Column'} ${axisLocation(option.value)}`;
    option.disabled=!axisIdentity(option.value);
  }
  const keepTargets=inspectorTargets(),mode=keepSelector.value;
  const pick=keepTargets.length&&keepTargets.every(d=>choices.get(d.id)==='left')?'left':
    keepTargets.length&&keepTargets.every(d=>choices.get(d.id)==='right')?'right':undefined;
  el('individual-status').textContent=pick?`Keeping ${sourceName(pick)}`:keepTargets.some(d=>choices.has(d.id))?'Mixed choices':'Undecided';
  keepSelector.title=mode==='row'||mode==='column'?
    `${mode==='row'?'Row':'Column'} ${axisLocation(mode)}. ${axisDescription(mode)} Keep and Decide later apply to this scope; Undo reverses the batch.`:
    'Keep and Decide later apply only to the selected conflict. A cell can have multiple separate conflicts.';
  keepSelector.setAttribute('aria-description',keepSelector.title);
  pickButtons(el('individual-buttons'),keepTargets,[undefined]);
  pickButtons(el('keep-left'),keepTargets,['left']);
  pickButtons(el('keep-right'),keepTargets,['right']);
  document.querySelectorAll<HTMLElement>('.change-item[data-id]').forEach(button=>{
    const pick=choices.get(Number(button.dataset.id));button.dataset.choice=pick??'';
    const badge=button.querySelector('.choice-badge');
    if(badge)badge.textContent=pick?`Keep ${pick==='left'?'left':'right'}`:'Undecided';
  });
  document.querySelectorAll<HTMLElement>('td[data-changes]').forEach(cell=>{
    const ids=cell.dataset.changes!.split(',').map(Number),picks=ids.map(id=>choices.get(id));
    cell.dataset.choice=picks.every(p=>p==='left')?'left':picks.every(p=>p==='right')?'right':picks.some(Boolean)?'mixed':'';
  });
  document.querySelectorAll<HTMLElement>('.scope-button[data-scope]').forEach(button=>{
    const area=areas.find(a=>a.id===button.dataset.scope);if(!area)return;
    const count=area.differences.filter(d=>choices.has(d.id)).length;
    const badge=button.querySelector('.count');if(badge)badge.textContent=count?`${count}/${area.differences.length}`:String(area.differences.length);
  });
  for(const control of sharedDropdowns.values())control.refresh();
}
function jumpToDifference(difference:Difference){
  scope=areas.find(a=>a.differences.includes(difference))!;category='all';specific='';selected=difference.id;region=0;
  document.querySelectorAll<HTMLElement>('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category==='all')));
  drawNavigation();drawScope();
  region=Math.max(0,regions.findIndex(chunk=>chunk.differences.includes(difference)));drawRegion();
  el('inspector').scrollIntoView({block:'nearest'});
}
function showChoiceReview(){
  const dialog=el<HTMLDialogElement>('choice-review'),groups=el('review-groups');groups.replaceChildren();
  const structural=differences.filter(d=>d.category==='structure'&&choices.has(d.id)).length;
  el('review-summary').textContent=`${choices.size} chosen · ${differences.length-choices.size} undecided · ${structural} structural choices need dependency review.`;
  for(const area of areas){
    const section=document.createElement('details'),summary=document.createElement('summary');
    const decided=area.differences.filter(d=>choices.has(d.id));
    summary.textContent=`${area.sheetName} / ${area.name} — ${decided.length}/${area.differences.length} chosen`;section.append(summary);
    for(const d of area.differences){
      const row=document.createElement('button'),pick=choices.get(d.id);
      row.className='review-row';row.dataset.choice=pick??'';
      const label=document.createElement('span');label.textContent=`${d.label} · ${address(area.left??area.right,d.rows,d.columns)}`;
      const badge=document.createElement('b');badge.textContent=pick?`Keep ${sourceName(pick)}`:'Undecided';
      row.append(label,badge);row.onclick=()=>{dialog.close();jumpToDifference(d);};section.append(row);
    }
    groups.append(section);
  }
  el<HTMLButtonElement>('next-unresolved').disabled=choices.size===differences.length;
  dialog.showModal();
}
const grids=[el('left-grid'),el('right-grid')];
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const positionCache=new WeakMap<Sheet,{rows:Map<string,number>;columns:Map<string,number>}>();
function positions(sheet:Sheet){
  let maps=positionCache.get(sheet);
  if(!maps){maps={rows:new Map(sheet.rows.map((r,i)=>[r.id,i])),columns:new Map(sheet.columns.map((c,i)=>[c.id,i]))};positionCache.set(sheet,maps);}
  return maps;
}
function address(sheet:Sheet|undefined,rows:string[],columns:string[]):string{
  if(!sheet)return 'Not present';
  const indexes=positions(sheet),r=rows.map(id=>indexes.rows.get(id)).filter((v):v is number=>v!==undefined),c=columns.map(id=>indexes.columns.get(id)).filter((v):v is number=>v!==undefined);
  if(rows.length&&!r.length)return 'Row not present';
  if(columns.length&&!c.length)return 'Column not present';
  const row=r.length?(r.length===1?`${r[0]+1}`:`${Math.min(...r)+1}-${Math.max(...r)+1}`):'';
  const col=c.length?(c.length===1?letters(c[0]):`${letters(Math.min(...c))}-${letters(Math.max(...c))}`):'';
  return col&&row?`${col}${r.length>1?' / rows ':''}${row}`:row?`Rows ${row}`:col?`Columns ${col}`:sheet.name;
}
function visibleText(book:Workbook,sheet:Sheet,row:string,column:string,engine:Engine):string{
  const cell=sheet.cells[`${row}:${column}`]??{},value=scalar(engine.cell(sheet.id,row,column));
  if(isFault(value))return value.error;
  const date=['date','date-compact'].includes(cell.format?.number??'')?dateFormatContext(engine,book,sheet.id,row,cell):undefined;
  if(date?.error)return date.error;
  if(value===null)return '';
  if(typeof value==='boolean')return value?'TRUE':'FALSE';
  if(typeof value==='number'){
    if(!Number.isFinite(value))return '#NUM!';
    if(date?.enabled)return displayExcelDate(value,date.year,cell.format?.number==='date-compact')??'#NUM!';
    if(cell.format?.number==='fraction')return displayFraction(value,cell.fractionInput);
    if(cell.format?.number==='percent')return `${+(value*100).toFixed(2)}%`;
    return cell.format?.number==='decimal'?value.toFixed(2):String(+value.toPrecision(11));
  }
  if(date?.enabled&&!cell.dateLiteral&&cell.format?.number==='date-compact'){
    const serial=parseDateInput(value,date.year,true);if(serial!==undefined)return displayExcelDate(serial,date.year,true)!;
  }
  return String(value);
}
function groupText(group:Group|undefined,sheet:Sheet|undefined):string{
  if(!group)return 'No group in this copy';
  return [`${group.kind==='summary'?'Summary':'Range'} group${group.label?`: ${group.label}`:''}`,
    group.axis==='row'?address(sheet,group.members,[]):address(sheet,[],group.members),
    `${group.members.length} members; ${group.collapsed?'collapsed':'expanded'}`,
    group.table?'Table-scoped':'Sheet-scoped'].join('\n');
}
function describe(difference:Difference,side:number):string{
  const value=side?difference.right:difference.left,book=side?right:left,sheet=side?scope.right:scope.left;
  if(value===undefined)return 'Not present in this copy';
  if((difference.address&&difference.category==='value')||difference.label==='Added or removed cell'||isDateAnchorLabel(difference.label)){
    const cell=value as Cell,parts:string[]=[];
    const displayed=sheet?visibleText(book,sheet,difference.rows[0],difference.columns[0],engines[side]):undefined;
    const saved=Object.hasOwn(cell,'value')?(typeof cell.value==='string'?cell.value:typeof cell.value==='boolean'?(cell.value?'TRUE':'FALSE'):JSON.stringify(cell.value)):undefined;
    const duplicate=!cell.formula&&!cell.binding&&saved!==undefined&&displayed===saved;
    if(displayed!==undefined)parts.push(duplicate?(displayed||'(blank)'):`Displayed: ${displayed||'(blank)'}`);
    if(cell.formula)parts.push(`Formula: ${displayFormula(cell.formula,book)}`);
    else if(cell.binding){
      const owner=allTables(book).find(t=>t.id===cell.binding!.table),field=owner?.columns.find(c=>c.id===cell.binding!.column);
      parts.push(`Linked source: ${owner?.name??'Missing table'}[${field?.name??'Missing field'}]`);
    }else if(Object.hasOwn(cell,'value')&&!duplicate)parts.push(`Saved value: ${saved}`);
    if(cell.calculation)parts.push(`Retained original formula (not active): ${displayFormula(cell.calculation,book)}`);
    if(isDateAnchorLabel(difference.label)&&!cell.formula)parts.push('Fixed day-header date: row moves no longer change this historical date.');
    if(cell.note)parts.push(`Note: ${cell.note}`);
    if(cell.link)parts.push(`Link: ${cell.link}`);
    return parts.join('\n');
  }
  if(/Group|Grouping/.test(difference.label))return groupText(value as Group,sheet);
  if(difference.label==='Hypothetical tag')return value===true?'Hypothetical: on':value===false?'Hypothetical: off (explicit override)':'Inherit from parent';
  if(difference.label==='Table row membership / order changed'){
    const ids=value as string[];return `${ids.length} table rows\n${address(sheet,ids,[])}\nMembership / ordering differs; matching row identities stay aligned in the preview.`;
  }
  if(difference.label==='Table columns / calculations changed'){
    const columns=value as {name:string;formulaDefault?:string}[];return columns.map(c=>`${c.name}${c.formulaDefault?`\n  ${c.formulaDefault}`:''}`).join('\n');
  }
  if(difference.label==='Dropdown rule changed'){
    const v=value as {rows:string[];columns:string[];source:string};return `${address(sheet,v.rows,v.columns)}\n${v.rows.length} rows, ${v.columns.length} columns\nSource: ${v.source}`;
  }
  if(typeof value==='object'){
    if(difference.label.startsWith('Row only')||difference.label.startsWith('Column only')){
      const v=value as Record<string,unknown>;return Object.entries(v).filter(([key])=>key!=='id').map(([key,v])=>`${key}: ${JSON.stringify(v)}`).join('\n')||'Present in this copy';
    }
    return JSON.stringify(value,null,2);
  }
  return String(value);
}
function revealSelectedCells(){
  for(const grid of grids){
    const cells=[...grid.querySelectorAll<HTMLElement>('.selected-cell')];if(!cells.length)continue;
    const bounds=grid.getBoundingClientRect(),header=grid.querySelector('thead')?.getBoundingClientRect(),rowHeader=grid.querySelector('.row-number')?.getBoundingClientRect();
    const identityWidth=[...grid.querySelectorAll<HTMLElement>('thead .row-identity')].reduce((sum,cell)=>sum+cell.getBoundingClientRect().width,0);
    const visible={left:bounds.left+(rowHeader?.width??0)+identityWidth,right:bounds.left+grid.clientWidth,top:bounds.top+(header?.height??0),bottom:bounds.top+grid.clientHeight};
    const rectangles=cells.map(cell=>cell.getBoundingClientRect()),first=rectangles[0];
    const union={left:Math.min(...rectangles.map(r=>r.left)),right:Math.max(...rectangles.map(r=>r.right)),top:Math.min(...rectangles.map(r=>r.top)),bottom:Math.max(...rectangles.map(r=>r.bottom))};
    const focusedCell=cells.find(cell=>cell.dataset.row===focus?.row&&cell.dataset.column===focus?.column);
    const focused=focusedCell?.getBoundingClientRect();
    const target=focused??(union.right-union.left<=visible.right-visible.left&&union.bottom-union.top<=visible.bottom-visible.top?union:first);
    const scrolling=rectangles.filter((_,index)=>!cells[index].classList.contains('row-identity'));
    if(!focusedCell?.classList.contains('row-identity')&&scrolling.length){
      const span={left:Math.min(...scrolling.map(r=>r.left)),right:Math.max(...scrolling.map(r=>r.right))};
      const horizontal=focused??(span.right-span.left<=visible.right-visible.left?span:scrolling[0]);
      if(horizontal.left<visible.left||horizontal.right-horizontal.left>visible.right-visible.left)grid.scrollLeft+=horizontal.left-visible.left;
      else if(horizontal.right>visible.right)grid.scrollLeft+=horizontal.right-visible.right;
    }
    if(target.top<visible.top)grid.scrollTop+=target.top-visible.top;
    else if(target.bottom>visible.bottom)grid.scrollTop+=target.bottom-visible.bottom;
  }
}
function choose(difference:Difference,forceReveal=false,point?:{row:string;column:string}){
  const changed=selected!==difference.id||!!point&&(focus?.row!==point.row||focus?.column!==point.column);
  if(point)focus={difference:difference.id,...point};
  else if(focus?.difference!==difference.id)focus={difference:difference.id,row:difference.rows.length===1?difference.rows[0]:undefined,column:difference.columns.length===1?difference.columns[0]:undefined};
  selected=difference.id;
  el('detail-title').textContent=difference.label;
  el('change-explanation').hidden=!isDateAnchorLabel(difference.label);
  el('change-explanation').textContent=difference.label===anchorMismatchLabel?'The original formula is preserved, but the displayed calendar dates genuinely differ. Review these dates explicitly; do not treat this as a formatting-only change.':
    difference.label===anchorErrorLabel?'The original formula is preserved, but a date could not be calculated. Review the displayed error; no cached value is used as proof of equality.':
    'This is the stable-date update, not a lost formula. One copy stores a fixed day-header date and retains the other copy\'s original formula. Compare the displayed dates below; a later save does not prove that copy contains newer behavior.';
  const a=address(scope.left,difference.rows,difference.columns),b=address(scope.right,difference.rows,difference.columns);
  el('detail-location').textContent=a===b?a:`Left: ${a} | Right: ${b}`;
  el('detail-left').textContent=describe(difference,0);el('detail-right').textContent=describe(difference,1);
  document.querySelectorAll<HTMLButtonElement>('.change-item').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.id)===selected)));
  document.querySelectorAll<HTMLElement>('td[data-changes]').forEach(cell=>cell.classList.toggle('selected-cell',cell.dataset.changes!.split(',').includes(String(selected))));
  updateChoices();
  if(changed||forceReveal)revealSelectedCells();
}
function drawNavigation(){
  const nav=el('navigation');nav.replaceChildren();
  for(const sheetId of new Set(areas.map(s=>s.sheetId))){
    const block=document.createElement('div'),heading=document.createElement('p'),sheetAreas=areas.filter(s=>s.sheetId===sheetId);
    heading.className='sheet-heading';heading.textContent=sheetAreas[0].sheetName;
    const count=document.createElement('span');count.textContent=String(sheetAreas.reduce((n,s)=>n+s.differences.length,0));heading.append(count);block.append(heading);
    for(const area of sheetAreas){
      const button=document.createElement('button');button.className='scope-button navigation-choice';button.title=area.name;button.dataset.scope=area.id;button.setAttribute('aria-current',String(scope?.id===area.id));
      const label=document.createElement('span');label.textContent=area.name;const total=document.createElement('span');total.className='count';total.textContent=String(area.differences.length);button.append(label,total);
      button.onclick=()=>{scope=area;region=0;selected=undefined;drawNavigation();drawScope();};block.append(button);
    }
    nav.append(block);
  }
}
function cellDifferences(diffs:Difference[],row:string,column:string):Difference[]{
  return diffs.filter(d=>(!d.rows.length||d.rows.includes(row))&&(!d.columns.length||d.columns.includes(column)));
}
function drawGrid(side:number,chunk:Chunk){
  const sheet=side?scope.right:scope.left,table=side?scope.rightTable:scope.leftTable,book=side?right:left,engine=engines[side];
  const firstColumns=new Set([scope.left?.columns[0]?.id,scope.right?.columns[0]?.id].filter((id):id is string=>!!id)),showFirst=el<HTMLInputElement>('first-cell').checked;
  const identities=showFirst?firstColumns:new Set<string>();
  const rowIds=scope.rows.slice(chunk.r1,chunk.r2+1),colIds=[...new Set([...identities,...scope.columns.slice(chunk.c1,chunk.c2+1).filter(id=>showFirst||!firstColumns.has(id))])],grid=grids[side];
  const numbers=sheet?positions(sheet):undefined;
  const hypoRow=sheet?hypotheticalProjection(book,sheet,'row'):()=>false,hypoColumn=sheet?hypotheticalProjection(book,sheet,'column'):()=>false;
  const rows=new Map(sheet?.rows.map(r=>[r.id,r])),columns=new Map(sheet?.columns.map(c=>[c.id,c]));
  const memberRows=table?new Set([table.header,...table.rows]):undefined,memberColumns=table?new Set(table.columns.map(c=>c.column)):undefined;
  const header=colIds.map(id=>{
    const index=numbers?.columns.get(id),field=table?.columns.find(c=>c.column===id);
    return `<th scope="col"${identities.has(id)?' class="row-identity"':''}>${escape(field?.name??columns.get(id)?.label??'Not present')}<small>${index===undefined?'--':letters(index)}</small></th>`;
  }).join('');
  engine.beginPass();
  const body=rowIds.map(row=>{
    const index=numbers?.rows.get(row),rowDiffs=chunk.differences.filter(d=>d.rows.includes(row)&&!d.columns.length),present=rows.has(row);
    let flags=rowDiffs.length?'<span class="row-marker">S</span>':'';
    const cells=colIds.map(column=>{
      const identity=identities.has(column),exists=present&&columns.has(column)&&(identity||(!memberRows||memberRows.has(row))&&(!memberColumns||memberColumns.has(column))),changed=cellDifferences(chunk.differences,row,column),hasValue=changed.some(d=>d.category==='value'),hasStructure=changed.some(d=>d.category==='structure');
      const cell=sheet?.cells[`${row}:${column}`],hypo=exists&&(hypoRow(row,column)||hypoColumn(row,column));
      if(hypo&&!flags)flags='<span class="row-marker">H</span>';
      const classes=[identity?'row-identity':'',exists?'':'missing',hasValue?'changed-value':'',hasStructure?'changed-structure':'',changed.length?'':'context-cell',hypo?'hypo':'',row===table?.header?'table-header':''].filter(Boolean).join(' ');
      const text=exists&&sheet?visibleText(book,sheet,row,column,engine):'';
      const styles:string[]=[];
      if(cell?.format?.bold)styles.push('font-weight:600');if(cell?.format?.italic)styles.push('font-style:italic');
      if(cell?.format?.background)styles.push(`background-color:${CSS.supports('color',cell.format.background)?cell.format.background:'transparent'}`);
      if(cell?.format?.color)styles.push(`color:${CSS.supports('color',cell.format.color)?cell.format.color:'inherit'}`);
      return `<td class="${classes}" data-row="${escape(row)}" data-column="${escape(column)}" ${changed.length?`data-changes="${changed.map(d=>d.id).join(',')}" tabindex="0"`:''} style="${escape(styles.join(';'))}" title="${escape(exists?text:'Row or column not present in this copy / table')}">${escape(text)||'&nbsp;'}</td>`;
    }).join('');
    return `<tr><th scope="row" class="row-number">${index===undefined?'--':index+1}${flags}</th>${cells}</tr>`;
  }).join('');
  grid.innerHTML=`<table aria-label="${escape(el(side?'right-kind':'left-kind').textContent)} changed area"><thead><tr><th class="row-number" scope="col">#</th>${header}</tr></thead><tbody>${body}</tbody></table>`;
  grid.querySelectorAll<HTMLElement>('td[data-changes]').forEach(cell=>{
    const select=()=>{
      const options=cell.dataset.changes!.split(',').map(Number),difference=chunk.differences.find(d=>options.includes(d.id)&&d.category==='value')??chunk.differences.find(d=>options.includes(d.id));
      if(difference)choose(difference,false,{row:cell.dataset.row!,column:cell.dataset.column!});
    };
    cell.onclick=select;cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}};
  });
  el(side?'right-range':'left-range').textContent=address(sheet,rowIds,colIds);
  grid.scrollTop=0;grid.scrollLeft=0;
}
function fitPreviewColumns(){
  const tables=grids.map(grid=>grid.querySelector('table'));if(!tables[0]||!tables[1])return;
  const widths:number[]=[],identities=[...tables[0].querySelectorAll<HTMLTableCellElement>('thead .row-identity')];
  for(const table of tables){
    const rowHeader=table!.querySelector<HTMLElement>('thead .row-number')!;
    rowHeader.style.width=rowHeader.style.minWidth=rowHeader.style.maxWidth='';
    widths[0]=Math.max(widths[0]??0,parseFloat(getComputedStyle(rowHeader).minWidth));
  }
  const identityLimit=Math.max(1,Math.floor((Math.min(...grids.map(grid=>grid.clientWidth))-widths[0])*.45/Math.max(1,identities.length)));
  for(const table of tables){
    for(const row of table!.rows)for(const [index,cell]of [...row.cells].entries()){
      if(!index)continue;
      const range=document.createRange(),text=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
      let content=0;while(text.nextNode()){range.selectNodeContents(text.currentNode);content=Math.max(content,range.getBoundingClientRect().width);}
      const style=getComputedStyle(cell),padding=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth);
      widths[index]=Math.max(widths[index]??0,Math.min(cell.classList.contains('row-identity')?identityLimit:160,Math.ceil(content+padding)));
    }
  }
  for(const table of tables){
    table!.style.width=widths.reduce((sum,width)=>sum+width,0)+'px';
    table!.style.minWidth='0';
    for(const row of table!.rows)for(const [index,cell]of [...row.cells].entries()){
      cell.style.width=cell.style.minWidth=cell.style.maxWidth=widths[index]+'px';
      if(cell.classList.contains('row-identity'))cell.style.left=widths.slice(0,index).reduce((sum,width)=>sum+width,0)+'px';
    }
  }
}
window.addEventListener('resize',fitPreviewColumns);
function drawRegion(){
  document.querySelector<HTMLElement>('.region-toolbar')!.hidden=regions.length<=1;
  if(regions.length<=1)sharedDropdowns.get('region-picker')?.close();
  const chunk=regions[region],list=el('change-list');list.replaceChildren();
  el<HTMLSelectElement>('region-picker').value=String(region);
  el<HTMLButtonElement>('previous').disabled=region<=0;el<HTMLButtonElement>('next').disabled=region>=regions.length-1;
  if(!chunk||scope.sheetId==='@workbook'){
    grids.forEach(grid=>grid.innerHTML=`<div class="empty">${chunk?'Workbook-level structure has no spreadsheet cell location.':'No affected cells to display.'}</div>`);
    if(!chunk){selected=undefined;el('detail-title').textContent='No change selected';el('detail-left').textContent='';el('detail-right').textContent='';el('detail-location').textContent='';updateChoices();return;}
  }else{
    drawGrid(0,chunk);drawGrid(1,chunk);
    fitPreviewColumns();
  }
  for(const d of chunk!.differences){
    const button=document.createElement('button');button.className='change-item';button.dataset.id=String(d.id);button.setAttribute('aria-pressed','false');
    const dot=document.createElement('i');dot.className=`swatch ${d.category==='value'?'amber':'violet'}`;
    const label=document.createElement('strong');label.textContent=d.label;const location=document.createElement('small');location.textContent=address(scope.left??scope.right,d.rows,d.columns);
    const badge=document.createElement('span');badge.className='choice-badge';button.append(dot,label,location,badge);
    button.onclick=()=>choose(d);list.append(button);
  }
  choose(chunk!.differences.find(d=>d.id===selected)??chunk!.differences.find(d=>d.category==='value')??chunk!.differences[0],true);
}
function updateMergedFilter(ds:Difference[]){
  const select=el<HTMLSelectElement>('change-filter');
  const option=(label:string,count:number,group:Category|'all',kind='')=>{
    const entry=new Option(`${label} (${count})`,JSON.stringify([group,kind]));
    Object.assign(entry.dataset,{label,count:String(count),filterCategory:group,kind});
    return entry;
  };
  select.replaceChildren(option('All changes',ds.length,'all'));
  if(category==='all'&&specific)select.append(option(`All categories · ${specific}`,ds.filter(d=>d.label===specific).length,'all',specific));
  for(const group of ['value','structure'] as const){
    const label=group==='value'?'Values & formulas':'Structure',items=ds.filter(d=>d.category===group),kinds=new Map<string,number>();
    const section=document.createElement('optgroup');section.label=label;
    section.append(option(label,items.length,group));
    for(const d of items)kinds.set(d.label,(kinds.get(d.label)??0)+1);
    for(const [kind,count]of kinds)section.append(option(kind,count,group,kind));
    select.append(section);
  }
  select.value=JSON.stringify([category,specific]);
  select.disabled=false;
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-category]'))button.setAttribute('aria-pressed',String(button.dataset.category===category));
}
function renderFilterOption(button:HTMLButtonElement,option:HTMLOptionElement){
  if(button.getAttribute('role')==='option')button.setAttribute('aria-label',option.text);
  else button.setAttribute('aria-description',option.text);
  button.classList.add('change-filter-option');
  button.classList.toggle('filter-subtype',!!option.dataset.kind);
  button.replaceChildren();
  if(option.dataset.filterCategory!=='all'){
    const marker=document.createElement('i');marker.className=`swatch ${option.dataset.filterCategory==='value'?'amber':'violet'}`;marker.setAttribute('aria-hidden','true');button.append(marker);
  }
  const label=document.createElement('span');label.className='filter-option-label';label.textContent=option.dataset.label??option.text;
  const count=document.createElement('span');count.className='count';count.textContent=option.dataset.count??'0';
  button.append(label,count);
  if(button.getAttribute('role')!=='option'){
    const content=document.createElement('span');content.className='filter-option-content';content.append(...button.childNodes);button.append(content);
  }
}
function updateFilterDesign(){
  const merged=document.body.dataset.filterDesign==='dropdown';
  document.querySelector<HTMLElement>('.categories')!.hidden=merged;
  el('type-label').hidden=merged;el('combined-type-label').hidden=!merged;
  sharedDropdowns.get(merged?'change-kind':'change-filter')?.close();
}
window.addEventListener('comparison-filter-design',updateFilterDesign);
function drawScope(){
  el('sheet-name').textContent=scope.sheetName;el('scope-name').textContent=scope.name;
  const ds=scope.differences;el('all-count').textContent=String(ds.length);el('value-count').textContent=String(ds.filter(d=>d.category==='value').length);el('structure-count').textContent=String(ds.filter(d=>d.category==='structure').length);
  const available=ds.filter(d=>category==='all'||d.category===category),kinds=new Map<string,number>();
  for(const d of available)kinds.set(d.label,(kinds.get(d.label)??0)+1);
  if(specific&&!kinds.has(specific))specific='';
  const type=el<HTMLSelectElement>('change-kind');type.replaceChildren(new Option(`All change types (${available.length})`,''));
  for(const [label,count]of kinds)type.append(new Option(`${label} (${count})`,label));
  if(category!=='value'&&!kinds.has('Hypothetical tag')){const option=new Option('Hypothetical tags (0)','Hypothetical tag');option.disabled=true;type.append(option);}
  type.value=specific;
  updateMergedFilter(ds);
  const included=available.filter(d=>!specific||d.label===specific);
  regions=scope.sheetId==='@workbook'?(included.length?[{r1:0,r2:0,c1:0,c2:0,differences:included}]:[]):chunks(scope,included,Number(el<HTMLSelectElement>('context').value));
  const picker=el<HTMLSelectElement>('region-picker');picker.replaceChildren();
  for(const [i,chunk]of regions.entries())picker.append(new Option(`Area ${i+1}: ${address(scope.left??scope.right,scope.rows.slice(chunk.r1,chunk.r2+1),scope.columns.slice(chunk.c1,chunk.c2+1))} (${chunk.differences.length} changes)`,String(i)));
  region=Math.min(region,Math.max(0,regions.length-1));drawRegion();
}
async function loadComparison(candidateLeft=left,candidateRight=right,onCommit:()=>void=()=>{}):Promise<boolean>{
  const generation=++request;
  document.body.dataset.loading='true';el('workspace').setAttribute('aria-busy','true');
  try{
    const nextEngines:[Engine,Engine]=[new Engine(candidateLeft),new Engine(candidateRight)];
    const values=await compare(candidateLeft,candidateRight,checked=>{if(generation===request)el('totals').textContent=`Comparing ${checked.toLocaleString()} saved cells...`;},nextEngines);
    if(generation!==request)return false;
    const nextAreas=scopes(candidateLeft,candidateRight,values);
    left=candidateLeft;right=candidateRight;differences=values;areas=nextAreas;engines=nextEngines;onCommit();
    el<HTMLButtonElement>('review-choices').disabled=false;
    choices.clear();choiceHistory.length=0;lastChoiceMessage='';selected=undefined;focus=undefined;updateChoices();
    scope=areas.find(s=>s.id===scope?.id)??areas.find(s=>s.leftTable&&s.differences.some(d=>d.category==='value'))??areas[0];
    const anchors=differences.filter(d=>isDateAnchorLabel(d.label)).length,mismatches=differences.filter(d=>d.label===anchorMismatchLabel).length,errors=differences.filter(d=>d.label===anchorErrorLabel).length;
    el('totals').textContent=`${differences.length.toLocaleString()} differences \u00b7 ${differences.filter(d=>d.category==='value').length.toLocaleString()} value / formula \u00b7 ${differences.filter(d=>d.category==='structure'&&!isDateAnchorLabel(d.label)).length.toLocaleString()} structural${anchors?` \u00b7 ${anchors.toLocaleString()} date anchors (${mismatches} differing dates${errors?`, ${errors} calculation errors`:''})`:''}`;
    if(!scope){
      regions=[];region=0;selected=undefined;specific='';
      document.querySelector<HTMLElement>('.region-toolbar')!.hidden=true;
      el('navigation').replaceChildren();el('sheet-name').textContent='';el('scope-name').textContent='These copies match';
      grids.forEach(grid=>grid.innerHTML='<div class="empty">No stored differences.</div>');
      el('region-picker').replaceChildren();
      el('change-kind').replaceChildren(new Option('All change types (0)',''));
      for(const id of ['all-count','value-count','structure-count'])el(id).textContent='0';
      specific='';updateMergedFilter([]);
      for(const id of ['previous','next'])el<HTMLButtonElement>(id).disabled=true;
      el('change-list').replaceChildren();el('detail-title').textContent='No differences';
      for(const id of ['detail-left','detail-right','detail-location','left-range','right-range'])el(id).textContent='';
      for(const id of ['all-count','value-count','structure-count'])el(id).textContent='0';
      el('change-explanation').hidden=true;
      updateChoices();
      return true;
    }
    region=0;drawNavigation();drawScope();
    return true;
  }catch(error){if(generation===request)showError(error);return false;}
  finally{if(generation===request){document.body.dataset.loading='false';el('workspace').setAttribute('aria-busy','false');}}
}
function showError(error:unknown){el('error').hidden=false;el('error').textContent=`Comparison could not be completed. Neither workbook was changed. ${error instanceof Error?error.message:String(error)}`;}
async function readWorkbook(contents:string):Promise<Workbook>{
  let root=parseArchive(contents) as Record<string,unknown>;
  if(root.format==='fnt-comparison-snapshot')return comparisonSnapshot(contents);
  if(root.format==='fnt-sync-v2')root=decompressArchive(String(root.payload)) as Record<string,unknown>;
  const book=(root.state as {book?:Workbook}|undefined)?.book??root.book??root;
  validateBook(book as Workbook);return book as Workbook;
}
function sourceTime(time:string,timeZone?:string):string{
  const date=new Date(time);
  if(!Number.isFinite(date.getTime()))throw Error('Comparison source has an invalid timestamp.');
  return date.toLocaleString('en-US',{timeZone,timeZoneName:'short'}).replace(', ',' @ ');
}
function setSource(side:'left'|'right',label:string,kind:string,commit?:string){
  el(`${side}-source`).textContent=label;
  document.querySelector<HTMLElement>(`.${side}-pane > header b`)!.textContent=kind;
  el(`${side}-grid`).setAttribute('aria-label',kind+' spreadsheet preview');
  el(`${side}-kind`).textContent=kind;
  el(`${side}-detail-kind`).textContent=`${side==='left'?'Left':'Right'}: ${kind.replace(/ upload$/,'')}`;
  if(side==='right'){
    el('right-source-commit').textContent=commit?`Main: ${commit}`:'';
    el('right-source-commit').hidden=!commit;
    el('right-source-fetched').textContent='';el('right-source-fetched').hidden=true;
  }
  el(`${side}-source-freshness`).textContent=kind.endsWith(' upload')?`Uploaded: ${label}.`:label;
}
function setHostSource(side:'left'|'right',source:ComparisonSource){
  setSource(side,source.label,source.kind);
  if(source.freshness)el(`${side}-source-freshness`).textContent=source.freshness;
  if(side==='right'){
    el('right-source-commit').textContent=source.revision?`File revision: ${source.revision}`:'';
    el('right-source-commit').hidden=!source.revision;
  }
}
function waitForCopy(){
  el('scope-name').textContent='Choose a comparison copy';el('sheet-name').textContent='';
  el('totals').textContent='Choose a right copy to begin.';
  el('detail-title').textContent='No compared copy loaded';
  grids.forEach(grid=>grid.innerHTML='<div class="empty">Attach a local JSON copy or read a GitHub copy.</div>');
  el<HTMLButtonElement>('review-choices').disabled=true;
  updateChoices();
  document.body.dataset.loading='false';el('workspace').setAttribute('aria-busy','false');
}
for(const side of ['left','right'] as const)el<HTMLInputElement>(`${side}-file`).onchange=async()=>{
  if(sourcesBusy)return;
  const input=el<HTMLInputElement>(`${side}-file`),file=input.files?.[0];if(!file)return;
  input.value='';
  setSourcesBusy(true);
  try{
    const copy=await readWorkbook(await file.text());
    const other=side==='left'?right:left;
    if(other&&copy.id!==other.id)throw Error('These copies have different workbook identities. Row matches are not guessed.');
    el('error').hidden=true;
    if(side==='left'&&!right){left=copy;setSource(side,file.name,'Local JSON');waitForCopy();return;}
    await loadComparison(side==='left'?copy:left,side==='right'?copy:right,()=>setSource(side,file.name,'Local JSON'));
  }catch(error){showError(error);}
  finally{setSourcesBusy(false);}
};
const picker=el<HTMLDialogElement>('snapshot-picker');
const syncDefaults=githubFormDefaults();
for(const field of ['owner','repo','branch','path'] as const)el<HTMLInputElement>('snapshot-'+field).value=syncDefaults[field];
let snapshotSide:'left'|'right'='left';
for(const side of ['left','right'] as const)el(side+'-github').onclick=()=>{
  if(sourcesBusy)return;
  snapshotSide=side;
  const title=`${side==='left'?'Left':'Right'} copy · GitHub`;
  el('snapshot-title').textContent=title;picker.setAttribute('aria-label',title);
  el('snapshot-target-note').textContent=`Changes only the ${side} comparison source. Attach opens a JSON file from this device; it does not upload it.`;
  for(const item of snapshotControls){
    item.select.closest<HTMLElement>('.snapshot-target')!.hidden=item.side!==side;
    item.select.disabled=item.side!==side||!uploadedFiles.length;item.control.refresh();
  }
  el('snapshot-status').textContent=uploadedFiles.length?`${uploadedFiles.length} uploaded copies, newest first. Choose one for the ${side} side.`:'Connect above to read uploaded snapshots from GitHub. Nothing is uploaded.';
  picker.showModal();
  if(host?.uploads)el<HTMLFormElement>('snapshot-connect').requestSubmit();
};
el('snapshot-close').onclick=()=>picker.close();
let snapshotConfig:SyncConfig|undefined,snapshotToken='',uploadedFiles:ComparisonSnapshot[]=[];
const snapshotControls=(['left','right'] as const).map(side=>{
  const select=el<HTMLSelectElement>(`uploaded-${side}`);
  const control=mountSelectDropdown(select,{renderOption:(button,option)=>{
    if(!option.value)return;
    const date=document.createElement('span'),device=document.createElement('span');
    date.textContent=option.dataset.date!;device.textContent=`[${option.dataset.device}]`;date.className='snapshot-date';device.className='snapshot-device';button.classList.add('snapshot-option');button.replaceChildren(date,device);
  }});
  select.onchange=async()=>{
    if(sourcesBusy||side!==snapshotSide)return;
    const entry=uploadedFiles.find(file=>file.path===select.value);if(!entry)return;
    setSourcesBusy(true);
    try{
      const source=host?.uploads?await host.uploads.read(entry):undefined;
      const copy=source?.book??await readComparisonSnapshot(snapshotConfig,snapshotToken,entry);
      const other=side==='left'?right:left;
      if(other&&copy.id!==other.id)throw Error('Uploaded copy belongs to another workbook. Neither source was replaced.');
      el('error').hidden=true;
      const commit=()=>source?setHostSource(side,source):setSource(side,sourceTime(entry.time),`${entry.device} upload`);
      if(side==='left'&&!right){left=copy;commit();waitForCopy();el('snapshot-status').textContent='Left source loaded. Choose a right copy to begin.';return;}
      const loaded=await loadComparison(side==='left'?copy:left,side==='right'?copy:right,commit);
      if(!loaded){el('snapshot-status').textContent='Source selection did not complete. Check the comparison error; no workbook was saved or uploaded.';return;}
      el('snapshot-status').textContent=`Loaded ${snapshotDate(entry.time)} [${entry.device}] on the ${side}. No workbook was saved or uploaded.`;
    }catch(error){el('snapshot-status').textContent=`Previous comparison retained. ${error instanceof Error?error.message:String(error)}`;}
    finally{setSourcesBusy(false);}
  };
  return {side,select,control};
});
function setSourcesBusy(busy:boolean){
  sourcesBusy=busy;
  const unavailable=busy||!left||(!host&&!right);
  for(const side of ['left','right']){
    el<HTMLButtonElement>(side+'-github').disabled=unavailable||!!host&&!host.uploads;
    el<HTMLInputElement>(side+'-file').disabled=unavailable;
  }
  el<HTMLButtonElement>('snapshot-list').disabled=unavailable||!!host&&!host.uploads;
  const remote=el<HTMLButtonElement>('comparison-github');if(remote)remote.disabled=unavailable||!host?.readRemote;
  document.querySelectorAll<HTMLInputElement>('#snapshot-connect input').forEach(input=>input.disabled=unavailable);
  for(const {side,select,control}of snapshotControls){
    select.disabled=unavailable||side!==snapshotSide||!uploadedFiles.length;control.refresh();
  }
}
el<HTMLFormElement>('snapshot-connect').onsubmit=async event=>{
  event.preventDefault();
  if(sourcesBusy)return;
  const read=(name:string)=>el<HTMLInputElement>('snapshot-'+name).value.trim();
  const config={owner:read('owner'),repo:read('repo'),branch:read('branch'),path:read('path')},token=read('token');
  setSourcesBusy(true);el('snapshot-status').textContent='Reading private uploaded copies...';
  try{
    const files=host?.uploads?await host.uploads.list(left.id):await listComparisonSnapshots(config,token,left.id);
    snapshotConfig=config;snapshotToken=token;uploadedFiles=files;
    for(const {side,select,control}of snapshotControls){
      select.replaceChildren(new Option('Choose uploaded copy',''));
      for(const file of files){const option=new Option(`${snapshotDate(file.time)} [${file.device}]`,file.path);option.dataset.date=snapshotDate(file.time);option.dataset.device=file.device;select.append(option);}
      control.refresh();
    }
    el('snapshot-status').textContent=`${files.length} uploaded copies, newest first. Dates use this device's time zone.`;
  }catch(error){el('snapshot-status').textContent=`Uploaded copies could not be listed. Previous comparison retained. ${error instanceof Error?error.message:String(error)}`;}
  finally{setSourcesBusy(false);}
};
document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(button=>button.onclick=()=>{
  category=button.dataset.category as Category|'all';region=0;selected=undefined;
  document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(scope)drawScope();
});
el('previous').onclick=()=>{if(region>0){region--;drawRegion();}};
el('next').onclick=()=>{if(region+1<regions.length){region++;drawRegion();}};
el('context').onchange=()=>{region=0;if(scope)drawScope();};
el('first-cell').onchange=()=>{if(scope)drawRegion();};
el('change-kind').onchange=()=>{specific=el<HTMLSelectElement>('change-kind').value;region=0;if(scope)drawScope();};
el('change-filter').onchange=()=>{
  const option=el<HTMLSelectElement>('change-filter').selectedOptions[0];
  category=option.dataset.filterCategory as Category|'all';specific=option.dataset.kind??'';region=0;selected=undefined;
  if(scope)drawScope();
};
el('region-picker').onchange=()=>{region=Number(el<HTMLSelectElement>('region-picker').value);drawRegion();};
el('choice-scope').onchange=updateChoices;
el('keep-scope').onchange=updateChoices;
const selectionActions=document.querySelector('.selection-actions')!;
for(const event of ['click','keydown'])selectionActions.addEventListener(event,e=>e.stopPropagation());
el('undo-choice').onclick=()=>{
  const previous=choiceHistory.pop();if(!previous)return;
  choices.clear();for(const [id,pick]of previous)choices.set(id,pick);
  lastChoiceMessage='Last selection batch undone.';updateChoices();
};
el('reset-choices').onclick=()=>{
  if(!choices.size)return;choiceHistory.push(new Map(choices));choices.clear();lastChoiceMessage='All choices reset. Undo can restore them.';updateChoices();
};
el('review-choices').onclick=showChoiceReview;
el('review-close').onclick=()=>el<HTMLDialogElement>('choice-review').close();
el('next-unresolved').onclick=()=>{
  const difference=differences.find(d=>!choices.has(d.id));if(!difference)return;
  el<HTMLDialogElement>('choice-review').close();jumpToDifference(difference);
};
for(const id of ['context','change-kind','region-picker','choice-scope','keep-scope'])sharedDropdowns.set(id,mountSelectDropdown(el<HTMLSelectElement>(id),id==='keep-scope'||id==='change-kind'?{fitOptions:true}:undefined));
sharedDropdowns.set('change-filter',mountSelectDropdown(el<HTMLSelectElement>('change-filter'),{renderOption:renderFilterOption,fitOptions:true}));
updateFilterDesign();
document.querySelectorAll('.source-details>summary,.bulk-disclosure>summary').forEach(summary=>summary.insertAdjacentHTML('afterbegin',navigationIcon('next')));
el('previous').innerHTML=toolbarIcon('previous');el('next').innerHTML=toolbarIcon('next');
document.querySelectorAll('.file-action').forEach(label=>label.insertAdjacentHTML('afterbegin',toolbarIcon('attach')));
let expected:[number,number][]=[[-1,-1],[-1,-1]];
grids.forEach((grid,side)=>grid.addEventListener('scroll',()=>{
  const scroll:[number,number]=[grid.scrollLeft,grid.scrollTop];
  if(expected[side][0]===scroll[0]&&expected[side][1]===scroll[1]){expected[side]=[-1,-1];return;}
  if(!el<HTMLInputElement>('linked').checked)return;
  const other=1-side;grids[other].scrollLeft=scroll[0];grids[other].scrollTop=scroll[1];expected[other]=[grids[other].scrollLeft,grids[other].scrollTop];
},{passive:true}));
async function start(){
  setSourcesBusy(true);
  try{
    if(document.body.dataset.production==='true'&&!host)throw Error('Open Compare versions from Recovery in your workbook. No private sources are loaded by this standalone page.');
    if(host){
      left=host.local.book;setHostSource('left',host.local);
      setSource('right','Attach a local JSON copy or read the saved GitHub version.','Compared copy');
      waitForCopy();
      const source=host.remote??(host.readRemote?await host.readRemote():undefined);
      if(source){right=source.book;setHostSource('right',source);await loadComparison();}
      return;
    }
    const responses=await Promise.all(['left.json','right.json','source-meta.json'].map(async path=>{const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error(`${path} returned ${response.status}`);return response.text();}));
    [left,right]=await Promise.all([readWorkbook(responses[0]),readWorkbook(responses[1])]);
    const meta=JSON.parse(responses[2]);
    const localTime=(time:string)=>sourceTime(time,meta.displayTimeZone);
    setSource('left',meta.leftUploadedAt?localTime(meta.leftUploadedAt):meta.left,meta.leftDevice?`${meta.leftDevice} upload`:'Your backup',meta.leftCommit);
    setSource('right',meta.rightCommittedAt?`Committed ${localTime(meta.rightCommittedAt)}`:meta.right,meta.rightCommit||meta.rightCommittedAt?'GitHub':'Right copy',meta.rightCommit);
    el('left-source-freshness').textContent=meta.leftUploadedAt?`Uploaded: ${localTime(meta.leftUploadedAt)}.`:meta.leftSavedAt?`Saved: ${localTime(meta.leftSavedAt)}.`:meta.left;
    el('right-source-freshness').textContent=meta.rightCommittedAt?`Committed ${localTime(meta.rightCommittedAt)}.`:meta.right;
    el('right-source-fetched').textContent=meta.retrievedAt?`Fetched: ${localTime(meta.retrievedAt)}.`:'';
    el('right-source-fetched').hidden=!meta.retrievedAt;
    await loadComparison();
  }catch(error){showError(error);el('totals').textContent='Comparison unavailable';document.body.dataset.loading='false';el('workspace').setAttribute('aria-busy','false');}
  finally{setSourcesBusy(false);}
}
if(host){
  const back=document.createElement('button');back.type='button';back.className='icon-button';
  back.setAttribute('aria-label','Back to workbook');back.title='Back to workbook';back.innerHTML=toolbarIcon('previous');
  back.onclick=host.close;document.querySelector('.top')!.append(back);
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]')){event.preventDefault();host.close();}});
  el('snapshot-auth-note').textContent=host.uploads?'Uses this website\'s existing private GitHub sign-in. Reads only; nothing is uploaded, restored, or synced.':'Configure Private GitHub sync from Recovery first. Local JSON comparisons work offline.';
  el('snapshot-connect').querySelector<HTMLElement>('.snapshot-config')!.hidden=true;
  el('snapshot-token').closest<HTMLElement>('label')!.hidden=true;
  el('snapshot-connect').querySelectorAll<HTMLInputElement>('input').forEach(input=>input.required=false);
  const remote=document.createElement('button');remote.type='button';remote.id='comparison-github';remote.textContent='Read GitHub';
  remote.setAttribute('aria-label','Compare with remote version (GitHub)');
  remote.onclick=async()=>{
    if(sourcesBusy||!host.readRemote)return;
    setSourcesBusy(true);
    try{
      const source=await host.readRemote();
      if(source.book.id!==left.id)throw Error('The GitHub copy belongs to a different workbook. Neither comparison source was replaced.');
      el('error').hidden=true;await loadComparison(left,source.book,()=>setHostSource('right',source));
    }catch(error){showError(error);}
    finally{setSourcesBusy(false);}
  };
  document.querySelector('#right-source-card .source-actions')!.prepend(remote);
}
void start();
