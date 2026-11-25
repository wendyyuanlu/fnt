import './style.css';
import { allSheets,allTables,addRow,addTableRows, addTableColumns, adjacentTableForCell, tableMembershipGaps, blankSheet, clone, columnIndex,createTranslationContext, createDemo, deleteColumn, deleteRows, duplicateSheet, expandAdjacentTable, fillCells, getCell, groupMoveTarget, hypotheticalTagDescendants, insertColumn, insertSheetRows, isFault, key, letters, move, moveColumns, moveRows, moveIntoGroup, moveTargetGroups, outlineMembers, renameColumn, replaceTables, setInput, setHypotheticalTag, summaryMoveMembers, tableAt, translate, uid, uniqueName, type Cell, type Group, type ReferenceSource, type Sheet, type Workbook } from './model';
import { compile, displayFormula, Engine, scalar, type Ast } from './formula';
import { Store, SyncConflict, syncGitHub, validateBook,validateBookMetadata,validateCellChanges, type Backup, type LocalState } from './storage';
import {applyUndo,capturePatch,editSnapshot,patchDifference,structuralUndo,undoLimit,type History,type Patch} from './undo-history';
import {cachedCellText,dateFormatContext} from './display-values';
import { parseArchive, stringifyArchive } from './archive';
import { parseTsv,serializeTsv } from './clipboard';
import { cutCells, shiftCells } from './cell-operations';
import { displayExcelDate,excelDate,excelDateText,parseDateInput } from './dates';
import { RowViewport } from './row-viewport';
import {captureSelection,headerSelectionTables,nearestHeaderTables,tableHeaderBounds,selectionCount,selectionRanges,type SelectionArea,type SelectionBounds} from './selection';
import { defaultHeaderFormula,groupBlockToTop,positionalBlock } from './meal-block';
import { applyTableColumnFormula,columnCalculations,quantityDiagnostic,restoreCalculation,tableColumnFormulas } from './calculation';
import { groupReference,mountGroupPicker,newReference,referenceSettings,type ReferenceHost } from './reference-ui';
import { dropdownArrowHtml,dropdownManualActionHtml,dropdownOptionsKey,mountDropdownOptions,mountSelectDropdown,mountSourcePicker,sourcePickerControlsHtml,sourcePickerBodyHtml,type SourcePage } from './dropdown-ui';
import { duplicateReference,moveReferenceGroup,referenceCaption,referenceChoices,referenceFormula,referenceGroups,referenceLabel,referenceNavigation,referenceUsages,removeReferenceValue,renameReferenceGroup,reorderReferenceSelection,setReferencePresentation,validationChoiceGroups,validationChoices,validationReference,type DropdownChoice,type ReferenceNavigation } from './references';
import { appendReferenceOption,conversionEditImpact,deleteReferenceColumns,referenceView,writeGridCell } from './reference-grid';
import { hexToHsv,hsvToHex,normalizeHex } from './colors';
import { dropdownCatalog,dropdownFormatMigration,dropdownGroupMigration,seedDropdownCatalog,verifiedCatalogOrigins } from './dropdown-catalog';
import { constantSummaryRowLayout,groupContainsCell,hypotheticalProjection,hypotheticalMembers,outlineGroups,outlineGutter,precedingGroupMember,tableGroupMembership,tableGroupProjection,ungroupPlainGroups } from './grouping';
import {getHypotheticalStyle,hypotheticalBadgeCss,hypotheticalCss,hypotheticalTextCss} from './hypothetical';
import {openHypotheticalSettings} from './hypothetical-ui';
import {toolbarIcon} from './icons';
import {mountToolbar} from './toolbar';
import {mountTableSelection} from './table-selection-ui';
import type {TableAxisEdit} from './table-operations';
import {planTableAxisEdit} from './table-edit-plan';
import {confirmTableExpansion} from './table-expansion-ui';
import {mountStickyTableHeaders} from './sticky-table-headers';
import {ensureTableSheetSpace} from './sheet-space';
import {createTable,recordTableEdits,recordTableVisit,renameTable,sortedTables} from './table-management';
import { mountGroupControls } from './grouping-ui';
import {createTextSearch} from './find';
import {loadPublishedTesting,publishedTestingId,untouchedStarter} from './published';
import {migrateDropdownData} from './dd-storage';

const root = document.querySelector<HTMLDivElement>('#app')!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const grip=(horizontal:boolean)=>`<svg aria-hidden="true" width="${horizontal?12:8}" height="${horizontal?8:12}" viewBox="0 0 ${horizontal?12:8} ${horizontal?8:12}">${Array.from({length:6},(_,i)=>`<circle cx="${i%(horizontal?3:2)*4+2}" cy="${Math.floor(i/(horizontal?3:2))*4+2}" r="1" fill="currentColor"/>`).join('')}</svg>`;
const formattingShortcuts=[
  {key:'b',alt:false,action:'bold',label:'Bold'},
  {key:'i',alt:false,action:'italic',label:'Italic'},
  {key:'u',alt:false,action:'underline',label:'Underline'},
  {key:'5',alt:false,action:'strikethrough',label:'Strikethrough'},
  {key:'w',alt:true,action:'wrap',label:'Wrap text'},
  {key:'c',alt:true,action:'text-color',label:'Text color'},
  {key:'b',alt:true,action:'background-color',label:'Cell background color'},
  {key:'n',alt:true,action:'format',label:'Number format'}
];
let shortcutHint:HTMLElement|undefined,hintButton:HTMLButtonElement|undefined,hintTimer:ReturnType<typeof setTimeout>|undefined;
function hideShortcutHint():void{
  clearTimeout(hintTimer);hintTimer=undefined;
  if(hintButton){
    const ids=(hintButton.getAttribute('aria-describedby')??'').split(' ').filter(id=>id&&id!=='shortcut-hint');
    if(ids.length)hintButton.setAttribute('aria-describedby',ids.join(' '));else hintButton.removeAttribute('aria-describedby');
  }
  shortcutHint?.remove();shortcutHint=undefined;hintButton=undefined;
}
function setShortcutHint(button:HTMLButtonElement|undefined|null,label:string,keys:string[],aria:string):void{
  if(!button)return;
  button.dataset.shortcutLabel=label;button.dataset.shortcutKeys=keys.join('|');button.setAttribute('aria-keyshortcuts',aria);button.removeAttribute('title');
}
function showShortcutHint(button:HTMLButtonElement,delay=0):void{
  hideShortcutHint();hintButton=button;
  const show=()=>{
    if(!button.isConnected||!button.dataset.shortcutKeys){hideShortcutHint();return;}
    const buttonRect=button.getBoundingClientRect();if(buttonRect.right<=0||buttonRect.left>=innerWidth||buttonRect.bottom<=0||buttonRect.top>=innerHeight){hideShortcutHint();return;}
    const tip=document.createElement('div');tip.id='shortcut-hint';tip.className='shortcut-hint';tip.setAttribute('role','tooltip');
    const label=document.createElement('span');label.textContent=button.dataset.shortcutLabel??button.textContent;tip.append(label);
    const keys=document.createElement('span');keys.className='shortcut-hint-keys';
    for(const key of button.dataset.shortcutKeys.split('|')){const badge=document.createElement('kbd');badge.textContent=key;keys.append(badge);}tip.append(keys);
    (button.closest('dialog[open]')??document.body).append(tip);shortcutHint=tip;
    const rect=button.getBoundingClientRect(),bounds=tip.getBoundingClientRect(),left=Math.max(6,Math.min(rect.left,innerWidth-bounds.width-6)),above=rect.bottom+bounds.height+10>innerHeight;
    tip.style.left=left+'px';tip.style.top=Math.max(6,above?rect.top-bounds.height-8:rect.bottom+8)+'px';tip.classList.toggle('above',above);
    tip.style.setProperty('--hint-arrow-left',Math.max(12,Math.min(rect.left+rect.width/2-left,bounds.width-12))+'px');
    button.setAttribute('aria-describedby',[button.getAttribute('aria-describedby'),'shortcut-hint'].filter(Boolean).join(' '));
  };
  if(delay)hintTimer=setTimeout(show,delay);else show();
}
document.addEventListener('pointerover',e=>{
  if(e.pointerType==='touch')return;
  const button=e.target instanceof Element?e.target.closest<HTMLButtonElement>('button[data-shortcut-keys]'):null;
  if(button&&!(e.relatedTarget instanceof Node&&button.contains(e.relatedTarget)))showShortcutHint(button,350);
});
document.addEventListener('pointerout',e=>{
  if(hintButton&&e.target instanceof Node&&hintButton.contains(e.target)&&!(e.relatedTarget instanceof Node&&hintButton.contains(e.relatedTarget))&&document.activeElement!==hintButton)hideShortcutHint();
});
document.addEventListener('focusin',e=>{const button=e.target instanceof HTMLButtonElement?e.target:null;if(button?.dataset.shortcutKeys)showShortcutHint(button,100);});
document.addEventListener('focusout',e=>{if(e.target===hintButton)hideShortcutHint();});
document.addEventListener('pointerdown',hideShortcutHint,{capture:true});
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideShortcutHint();},{capture:true});
document.addEventListener('scroll',()=>{const focused=document.activeElement;if(focused instanceof HTMLButtonElement&&focused.dataset.shortcutKeys)showShortcutHint(focused,100);else hideShortcutHint();},{capture:true});
window.addEventListener('resize',hideShortcutHint);
let book: Workbook, state: LocalState, store: Store, engine: Engine;
let sheetId = '', selected = {r:1,c:0}, anchor = {...selected}, page = 0, showHypothetical=true;
let selectionKind:'cells'|'rows'|'columns'='cells';
let extraSelections:SelectionArea[]=[];
let renderedSheet='',renderedTarget='',scrollTarget:number|{row:number;contextRows:number;align?:'bottom'}|undefined,drawRowWindow:((force?:boolean)=>void)|undefined;
let navigationRows:number[]=[],navigationColumns:number[]=[];
const measuredRowHeights=new Map<string,number>();
const pinnedColumns=new Map<string,string[]>();
let touchSelection=false,touchPointer:number|undefined;
let fillSource:ReturnType<typeof bounds>|undefined,fillPointer:number|undefined;
let status = 'Opening local workbook...', error = '', busy = false, token = '';
let savedGeneration = 0, generation = 0, saving: Promise<void> = Promise.resolve();
const undo: History[] = [], redo: History[] = [];
let copied: {sheet:string; r:number;c:number;rows:string[];columns:string[];cells:Cell[][];origins?:{row:string;column:string}[][];outlineOrigins?:{row:string;column:string}[][];cut?:boolean;table?:string;kind?:'rows'|'columns'|'cells'} | undefined;
const clipboardHistory=new WeakMap<History,{current:NonNullable<typeof copied>;restore:NonNullable<typeof copied>}>();
let saveTimer: ReturnType<typeof setTimeout>;
let scopedChanges:History[]=[],fullSaveRequired=false,compactionWrites=0;
let compactionTimer:ReturnType<typeof setTimeout>|undefined;
let displayedVersion=0;
let movePaintFrame=0,resizePaintFrame=0,selectionPaintFrame=0,previewGeneration=-1;
let boundaryPreview:{axis:'row'|'column';boundary:number;index:number;after:boolean;generation:number;ids:string[]}|undefined;
let draft:string|undefined;
let draftLiteral=false;
let movingColumns:string[]|undefined;
let movingRows:string[]|undefined,referenceId:string|undefined,selectionTable:string|undefined;
let closeMoveAutoScroll:(()=>void)|undefined;
let edgeMoveGroups:string[]|undefined;
let groupEdgeTargets:Map<Group['axis'],Map<number,Group[]>>|undefined;
let tableSelectionMode=false,tableSelectionTarget:string|undefined,selectionScope:string|undefined;
let lastVisitedTable:string|undefined;
let extendHeaderSelection=false;
let viewportSelectionTables=(tables:typeof book.tables,_axis:'row'|'column'):typeof book.tables=>tables;
let movePreview:{axis:'row'|'column';boundary:number;index:number;after:boolean;groupId?:string}|undefined;
let appendDraft:{source:string;column:string;value:string}|undefined;
let colorPicker:{pending:boolean;commit:()=>boolean;close:(apply?:boolean)=>boolean}|undefined;
let referenceNotice='';
let awaitingMutationConfirmation=false;
let hypotheticalOverridePreview:{sheet:string;axis:Group['axis'];ids:Set<string>;table?:string}|undefined;
let maskedCell:(row:string,column:string)=>boolean=()=>false;
let groupProjection:ReturnType<typeof tableGroupProjection>|undefined;
let hypotheticalOverrideSkips=0;
let arrangingToolbar=false,closeToolbar:(()=>void)|undefined;
let tableSelectionControl:ReturnType<typeof mountTableSelection>|undefined;
let stickyTableHeaders:ReturnType<typeof mountStickyTableHeaders>|undefined;
const toolbarSelection:{ids:Set<string>;anchor?:string}={ids:new Set()};
let closeCellDropdown:(()=>void)|undefined;
let groupControls:ReturnType<typeof mountGroupControls>|undefined,groupMenuOpen=false,groupMenuSheet='';
let groupManager:{refresh:()=>void;paint:()=>void;close:()=>void}|undefined;
let expandedEditor:{input:HTMLTextAreaElement;controller:AbortController;position:()=>void}|undefined;
function closeExpandedEditor():void{
  expandedEditor?.controller.abort();expandedEditor?.input.remove();expandedEditor=undefined;
}
let dropdownAssignmentGrid=true;
let resizing:{axis:'column'|'row';id:string;sheet:string;start:number;size:number;position:number;pointer:number;capture:HTMLElement}|undefined;
let workbookView:{sheet:string;selected:typeof selected;anchor:typeof anchor;kind:'cells'|'rows'|'columns';scroll:number;left:number;scope?:string;tableMode?:boolean;target?:string}|undefined;
const activeReference=()=>book.references?.find(s=>s.id===referenceId);
const gridReference=()=>{const source=activeReference();return source?referenceView(book,source):undefined;};
const editableReference=()=>!activeReference()||activeReference()!.kind!=='derived';
const inGrid=(r:number,c:number)=>{const view=gridReference(),s=sheet();return!!s.rows[r]&&!!s.columns[c]&&!maskedCell(s.rows[r].id,s.columns[c].id)&&(!view||view.rows.includes(s.rows[r].id)&&view.columns.includes(s.columns[c].id));};
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fnt-edits') : undefined;
const clipboardId=uid();
const sheet = () => allSheets(book).find(s => s.id === sheetId)!;
const current = () => getCell(sheet(),sheet().rows[selected.r].id,sheet().columns[selected.c].id);
const bounds = () => ({r1:Math.min(anchor.r,selected.r),r2:Math.max(anchor.r,selected.r),c1:Math.min(anchor.c,selected.c),c2:Math.max(anchor.c,selected.c)});
const scopedSelectionTable=()=>allTables(book).find(table=>table.id===selectionScope&&table.sheet===sheetId);
const currentSelections=()=>selectionRanges(sheet(),bounds(),extraSelections,scopedSelectionTable(),allTables(book));
const selectionMode=()=>extraSelections.every(area=>area.kind===selectionKind&&area.table===selectionScope)?selectionKind:'cells';
function selectionPaintPosition(row:number,column:number,displayRow:number,displayColumn:number):{r:number;c:number}{
  const mode=selectionScope?'cells':selectionMode();
  return{r:mode==='rows'?displayRow:row,c:mode==='columns'?displayColumn:column};
}
const selectedAxisIndices=(axis:'row'|'column')=>{
  const ranges=currentSelections(),items=axis==='row'?sheet().rows:sheet().columns;
  return items.map((_,i)=>i).filter(i=>ranges.some(r=>axis==='row'?i>=r.r1&&i<=r.r2:i>=r.c1&&i<=r.c2));
};
function moveToTopTarget(){
  if(referenceId||selectionMode()==='columns'||extraSelections.some(area=>area.table!==selectionScope))return;
  const s=sheet(),roots=selectedAxisIndices('row').map(i=>s.rows[i].id);
  const active=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??tableAt(book,s.id,s.rows[anchor.r].id,s.columns[anchor.c].id);
  const candidates=allTables(book).filter(table=>table.sheet===s.id&&roots.every(id=>table.rows.includes(id)));
  const table=scopedSelectionTable()??(tableSelectionTarget?candidates.find(table=>table.id===tableSelectionTarget):active??(candidates.length===1?candidates[0]:undefined));
  if(!table)return;
  const local=tableSelectionMode||!!selectionScope;
  const groups=s.groups.filter(group=>local?group.table===table.id:!group.table),rows=summaryMoveMembers({...s,groups},'row',roots,local?table.id:undefined);
  if(!rows.length||rows.some(id=>!table.rows.includes(id)))return;
  return{table,rows,local};
}
function moveSelectionToTop():void{
  const target=moveToTopTarget();
  if(!target){flash('Select data rows or a summary group within one table, not its header or neighboring cells.');return;}
  const {table,rows,local}=target,s=sheet(),boundary=s.rows.findIndex(row=>row.id===table.header)+1,members=new Set(rows);
  const prefix=local?table.rows.slice(0,rows.length):s.rows.slice(boundary,boundary+rows.length).map(row=>row.id);
  if(prefix.length===rows.length&&prefix.every(id=>members.has(id)))return;
  if(local){runTableEdit(table.id,'row',{kind:'move',ids:rows,boundary},'Move to top',{reveal:true});return;}
  mutate('Move to top',()=>{
    const at=moveRows(book,s,rows,boundary);
    movingRows=movingColumns=undefined;clearMovePreview();extraSelections=[];selectionScope=undefined;
    anchor={r:at,c:0};selected={r:at+rows.length-1,c:s.columns.length-1};selectionKind='rows';page=Math.floor(at/60);scrollTarget=at;
  });
}
let hypotheticalView:{generation:number;sheet:Sheet;row:{members:Set<string>;projection:ReturnType<typeof hypotheticalProjection>};column:{members:Set<string>;projection:ReturnType<typeof hypotheticalProjection>}}|undefined;
function hypotheticalSelection(){
  const mode=selectionMode();if(mode!=='rows'&&mode!=='columns')return;
  const axis:Group['axis']=mode==='rows'?'row':'column',items=axis==='row'?sheet().rows:sheet().columns;
  const ids=selectedAxisIndices(axis).map(i=>items[i].id),table=scopedSelectionTable();
  const cached=hypotheticalView?.generation===generation&&hypotheticalView.sheet===sheet()?hypotheticalView[axis]:undefined;
  const members=cached?.members??hypotheticalMembers(sheet(),axis);
  const projection=table?(cached?.projection??hypotheticalProjection(book,sheet(),axis)):undefined;
  return{axis,ids,table:table?.id,tagged:ids.filter(id=>table&&projection?(axis==='row'?projection(id,table.columns[0].column):projection(table.header,id)):members.has(id)).length};
}
function beginSelection(e:MouseEvent|PointerEvent,kind:typeof selectionKind):void{
  if(e.ctrlKey||e.metaKey){if(!e.shiftKey||selectionKind!==kind)extraSelections.push(captureSelection(sheet(),bounds(),selectionKind,scopedSelectionTable()));}
  else extraSelections=[];
  if(kind==='cells'){selectionScope=undefined;extendHeaderSelection=false;}
}
function headerSelection(e:MouseEvent,axis:'row'|'column',index:number):void{
  const s=sheet(),kind=axis==='row'?'rows':'columns',tables=gridReference()?.table?[gridReference()!.table!]:allTables(book);
  const requestedExtension=e.shiftKey||extendHeaderSelection;extendHeaderSelection=false;
  const apply=(table?:typeof book.tables[number])=>{
    const items=axis==='row'?s.rows:s.columns,source=table?groupProjection?.axis(table.id,axis,items[index].id):items[index].id;
    if(table&&!source){flash('This part of the table is collapsed. Expand its group to select those records.');return;}
    const logical=source?items.findIndex(item=>item.id===source):index;
    const extend=requestedExtension&&selectionKind===kind&&selectionScope===table?.id;
    const range=table?tableHeaderBounds(s,table,axis,logical,extend?(axis==='row'?anchor.r:anchor.c):undefined):
      axis==='row'?{r1:extend?Math.min(anchor.r,index):index,r2:extend?Math.max(anchor.r,index):index,c1:0,c2:s.columns.length-1}:
      {r1:0,r2:s.rows.length-1,c1:extend?Math.min(anchor.c,index):index,c2:extend?Math.max(anchor.c,index):index};
    beginSelection(e,kind);selectionScope=table?.id;
    if(axis==='row'){anchor={r:extend?anchor.r:logical,c:range.c1};selected={r:logical,c:range.c2};}
    else{anchor={r:range.r1,c:extend?anchor.c:logical};selected={r:range.r2,c:logical};}
    selectionKind=kind;refreshSelection();root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});
  };
  if(!tableSelectionMode){apply();return;}
  let candidates=headerSelectionTables(s,tables,axis,index);
  if(tableSelectionTarget){
    const locked=candidates.find(table=>table.id===tableSelectionTarget);
    if(locked)apply(locked);
    else flash('This header is outside the chosen table. Choose another table in the toolbar, or turn off Table selection for sheet-wide selection.');
    return;
  }
  if(!candidates.length){apply();return;}
  candidates=viewportSelectionTables(candidates,axis);
  const active=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id);
  const preferred=candidates.find(table=>table.id===active?.id);
  if(preferred||candidates.length===1){apply(preferred??candidates[0]);return;}
  dialog('Choose selection table',`<p>Several tables use this ${axis==='row'?'row':'column'}. Choose which one to select; adjacent tables will stay untouched.</p><div class="menu">${candidates.map(table=>`<button data-selection-owner="${esc(table.id)}">${esc(table.name)}</button>`).join('')}</div>`,d=>{
    d.querySelectorAll<HTMLButtonElement>('[data-selection-owner]').forEach(button=>button.onclick=()=>{const table=candidates.find(table=>table.id===button.dataset.selectionOwner)!;d.close();apply(table);});
  });
}
function refreshTableSelectionControl():void{
  const button=root.querySelector<HTMLButtonElement>('[data-action="table-selection"]');
  button?.setAttribute('aria-pressed',String(tableSelectionMode));
  const grid=root.querySelector<HTMLElement>('.grid');if(grid)grid.dataset.tableSelection=String(tableSelectionMode);
  tableSelectionControl?.refresh();
  const label=root.querySelector<HTMLElement>('#selection-scope-label');
  if(label)label.textContent=selectionScope?`Table: ${scopedSelectionTable()?.name??'missing table'}`:'Sheet selection';
}
function requireRectangle(operation:string):SelectionBounds|undefined{
  const ranges=currentSelections();if(ranges.length===1)return ranges[0];
  flash(`${operation} requires one rectangular range. The unselected cells between your selections will not be changed.`);return;
}
function confineRange(range:SelectionBounds):SelectionBounds{
  const owner=scopedSelectionTable();if(!owner)return range;
  const s=sheet(),rows=s.rows.map((row,i)=>row.id===owner.header||owner.rows.includes(row.id)?i:-1).filter(i=>i>=0),columns=s.columns.map((column,i)=>owner.columns.some(field=>field.column===column.id)?i:-1).filter(i=>i>=0);
  const clipped={r1:Math.max(range.r1,rows[0]),r2:Math.min(range.r2,rows.at(-1)!),c1:Math.max(range.c1,columns[0]),c2:Math.min(range.c2,columns.at(-1)!)};
  if(clipped.r1>clipped.r2||clipped.c1>clipped.c2||s.rows.slice(clipped.r1,clipped.r2+1).some(row=>!rows.includes(s.rows.indexOf(row)))||s.columns.slice(clipped.c1,clipped.c2+1).some(column=>!columns.includes(s.columns.indexOf(column))))throw Error('This operation requires contiguous cells within the selected table.');
  return clipped;
}
function sheetAxisSelectionAllowed(operation:string):boolean{
  if(referenceId||!extraSelections.some(area=>area.table!==selectionScope))return true;
  flash(`${operation} requires one table or sheet scope at a time. Adjacent tables have not been changed.`);return false;
}
function prepareAxisOperation(axis:'row'|'column',index:number):number{
  if(!tableSelectionMode)return index;
  const s=sheet(),view=gridReference(),candidates=headerSelectionTables(s,view?.table?[view.table]:allTables(book),axis,index);
  let owner=candidates.find(table=>table.id===tableSelectionTarget);
  if(tableSelectionTarget&&!owner)throw Error('This header is outside the chosen table.');
  if(!tableSelectionTarget){
    const nearest=viewportSelectionTables(candidates,axis);
    const active=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id);
    owner=nearest.find(table=>table.id===(selectionScope??active?.id))??(nearest.length===1?nearest[0]:undefined);
    if(nearest.length>1&&!owner)throw Error('Choose a table using the selection dropdown first.');
  }
  if(owner){
    const items=axis==='row'?s.rows:s.columns,source=groupProjection?.axis(owner.id,axis,items[index].id);
    if(!source)throw Error('This part of the table is collapsed. Expand its group before inserting or moving here.');
    index=items.findIndex(item=>item.id===source);
  }
  const kind=axis==='row'?'rows':'columns';
  if(selectionScope===owner?.id&&selectionMode()===kind&&selectedAxisIndices(axis).includes(index))return index;
  const range=owner?tableHeaderBounds(s,owner,axis,index):axis==='row'?{r1:index,r2:index,c1:0,c2:s.columns.length-1}:{r1:0,r2:s.rows.length-1,c1:index,c2:index};
  selectionScope=owner?.id;extraSelections=[];selectionKind=kind;anchor={r:range.r1,c:range.c1};selected={r:range.r2,c:range.c2};
  return index;
}
function projectedBoundary(table:string,axis:'row'|'column',boundary:number):number{
  const items=axis==='row'?sheet().rows:sheet().columns,slot=items[boundary];
  if(!slot)return boundary;
  const source=groupProjection?.axis(table,axis,slot.id);
  if(source)return items.findIndex(item=>item.id===source);
  for(let i=boundary-1;i>=0;i--){
    const previous=groupProjection?.axis(table,axis,items[i].id);
    if(previous)return items.findIndex(item=>item.id===previous)+1;
  }
  throw Error('Expand the table group before moving its hidden records.');
}
function runTableEdit(tableId:string,axis:'row'|'column',edit:TableAxisEdit,label:string,options:{finish?:(ids:string[])=>void;reveal?:boolean}={}):void{
  try{
    if(!editableReference()||gridReference()?.error)throw Error('This source is read-only or unavailable. Edit its original table instead.');
    const before=book,expected=generation,table=allTables(book).find(t=>t.id===tableId)!;
    const sourceCopy=copied?.sheet===table.sheet?copied:undefined,copyMoves=new Map<string,{row:string;column:string}>();
    const copiedKeys=sourceCopy?new Set(sourceCopy.cells.flatMap((row,i)=>row.map((_,j)=>{const origin=sourceCopy.outlineOrigins?.[i][j]??sourceCopy.origins?.[i][j]??{row:sourceCopy.rows[i],column:sourceCopy.columns[j]};return`${sourceCopy.sheet}:${key(origin.row,origin.column)}`;}))):undefined;
    const plan=planTableAxisEdit(book,tableId,axis,edit,{candidate:editSnapshot(book),trace:copiedKeys?(source,target)=>{if(copiedKeys.has(source)&&(!target||`${target.sheet}:${key(target.row,target.column)}`!==source))copyMoves.set(source,target??{row:'deleted',column:'deleted'});}:undefined}),at=axis==='row'?bounds().r1:bounds().c1;
    confirmTableExpansion(before,plan,table.name,dialog,()=>{
      if(book!==before||generation!==expected){flash('The workbook changed while this edit was open. Select the records or fields and try again.');return false;}
      return mutate(label,()=>{
        book=plan.book;selectionScope=tableId;extraSelections=[];movingRows=movingColumns=undefined;clearMovePreview();
        if(label==='Cut and move table members')copied=undefined;
        if(sourceCopy&&copied===sourceCopy&&copyMoves.size){
          const outlineOrigins=sourceCopy.cells.map((row,i)=>row.map((_,j)=>{const origin=sourceCopy.outlineOrigins?.[i][j]??sourceCopy.origins?.[i][j]??{row:sourceCopy.rows[i],column:sourceCopy.columns[j]};return copyMoves.get(`${sourceCopy.sheet}:${key(origin.row,origin.column)}`)??origin;}));
          copied={...sourceCopy,outlineOrigins};
        }
        const owner=scopedSelectionTable()!,s=sheet(),items=axis==='row'?s.rows:s.columns;
        const owned=axis==='row'?owner.rows:owner.columns.map(field=>field.column);
        options.finish?.(plan.ids);
        const ids=plan.ids.length?plan.ids:owned.filter(id=>items.findIndex(item=>item.id===id)>=at).slice(0,1);
        const chosen=ids.length?ids:owned.slice(-1),positions=chosen.map(id=>items.findIndex(item=>item.id===id));
        if(!positions.length){selected={r:s.rows.findIndex(row=>row.id===owner.header),c:s.columns.findIndex(column=>column.id===owner.columns[0].column)};anchor={...selected};selectionKind='cells';}
        else{
          const first=Math.min(...positions),last=Math.max(...positions),range=tableHeaderBounds(s,owner,axis,last,first);
          anchor={r:range.r1,c:range.c1};selected={r:range.r2,c:range.c2};selectionKind=axis==='row'?'rows':'columns';
        }
        renderedTarget=`${sheetId}:${selected.r}`;scrollTarget=options.reveal?anchor.r:edit.kind==='insert'||edit.kind==='move'?undefined:selected.r;
      },false,edit.kind==='move'&&!options.reveal?{preserveViewport:true}:undefined);
    });
  }catch(error){flash(error);}
}
function requestInsert(axis:'row'|'column',boundary:number,index?:number):void{
  try{
    const previousOwner=selectionScope,previousCount=selectionMode()===(axis==='row'?'rows':'columns')?selectedAxisIndices(axis).length:1;
    if(index!==undefined)boundary+=prepareAxisOperation(axis,index)-index;
    const owner=scopedSelectionTable();
    if(owner){
      const count=previousOwner===owner.id?previousCount:selectionMode()===(axis==='row'?'rows':'columns')?selectedAxisIndices(axis).length:1;
      const at=axis==='row'?Math.max(boundary,sheet().rows.findIndex(row=>row.id===owner.header)+1):boundary;
      runTableEdit(owner.id,axis,{kind:'insert',boundary:at,count},`Insert table ${axis==='row'?'rows':'columns'}`);
    }else mutate(`Insert ${axis==='row'?'rows':'columns'}`,()=>insertDimensions(axis,boundary,!referenceId&&previousOwner===undefined?previousCount:undefined));
  }catch(error){flash(error);}
}
function rememberView():void{
  const s=allSheets(book).find(s=>s.id===sheetId);if(!s?.rows[selected.r]||!s.columns[selected.c])return;
  const grid=root.querySelector<HTMLElement>('#grid-scroll');
  try{
    const value=JSON.stringify({reference:referenceId??null,sheet:sheetId,row:s.rows[selected.r].id,column:s.columns[selected.c].id,anchorRow:s.rows[anchor.r]?.id,anchorColumn:s.columns[anchor.c]?.id,kind:selectionKind,scope:selectionScope,tableMode:tableSelectionMode,target:tableSelectionTarget,scroll:grid?.scrollTop??0,left:grid?.scrollLeft??0,workbookView});
    sessionStorage.setItem(`fnt-view:${book.id}`,value);
    if(!referenceId)sessionStorage.setItem(`fnt-sheet-view:${book.id}:${sheetId}`,value);
    sessionStorage.setItem('fnt-current-reference',referenceId??'');
  }catch(e){flash(`View preference could not be saved: ${String(e)}`);}
}
function referenceOnSheet(id:string,row?:string,column?:string):string|undefined{
  const sources=book.references?.filter(source=>source.anchor?.sheet===id||allTables(book).some(table=>table.id===source.table&&table.sheet===id))??[];
  return(sources.find(source=>{
    const table=allTables(book).find(table=>table.id===source.table);
    return table&&(!row||table.header===row||table.rows.includes(row))&&(!column||table.columns.some(field=>field.column===column&&(!source.column||field.id===source.column)));
  })??sources[0])?.id;
}
function normalizedBackup(backup:Backup):Backup{
  return{...backup,state:{...backup.state,book:migrateDropdownData(backup.state.book).book}};
}
function adoptSavedWorkbook(target?:string):void{
  book=clone(state.book);engine=new Engine(book);generation++;savedGeneration=generation;
  sheetId=book.sheets.some(sheet=>sheet.id===target)?target!:book.sheets[0].id;
  referenceId=undefined;referenceNotice='';workbookView=undefined;selectionScope=undefined;tableSelectionTarget=undefined;selectionTable=undefined;lastVisitedTable=undefined;
  selected={r:0,c:0};anchor={...selected};selectionKind='cells';extraSelections=[];selectedTabs.clear();tabSelectionAnchor=undefined;
  movingRows=movingColumns=undefined;copied=undefined;renderedSheet='';page=0;undo.length=redo.length=0;
}
function restoreView(remembered?:string|null,saved?:string|null):{scroll:number;left:number}|undefined{
  try{
    const raw=saved??sessionStorage.getItem(`fnt-view:${book.id}`),legacy=sessionStorage.getItem('fnt-current-reference');
    if(!raw){const source=legacy&&book.references?.some(s=>s.id===legacy)?legacy:remembered&&book.dropdownData?.sheets.some(s=>s.id===remembered)?referenceOnSheet(remembered):undefined;if(source){referenceId=source;const view=gridReference();if(view?.sheet){sheetId=view.sheet.id;selected={r:Math.max(0,view.sheet.rows.findIndex(r=>r.id===(view.rows[1]??view.rows[0]))),c:Math.max(0,view.sheet.columns.findIndex(c=>c.id===view.columns[0]))};anchor={...selected};}}return;}
    const view=JSON.parse(raw);
    if(!view||typeof view.sheet!=='string'||typeof view.row!=='string'||typeof view.column!=='string'||!Number.isFinite(view.scroll)||!Number.isFinite(view.left))throw Error('Invalid saved view preference.');
    const s=allSheets(book).find(s=>s.id===view.sheet);if(!s)return;
    referenceId=typeof view.reference==='string'&&book.references?.some(s=>s.id===view.reference)?view.reference:book.dropdownData?.sheets.some(sheet=>sheet.id===s.id)?referenceOnSheet(s.id,view.row,view.column):undefined;
    if(!referenceId&&!book.sheets.some(sheet=>sheet.id===s.id))return;
    sheetId=s.id;
    selected={r:Math.max(0,s.rows.findIndex(r=>r.id===view.row)),c:Math.max(0,s.columns.findIndex(c=>c.id===view.column))};anchor={r:Math.max(0,s.rows.findIndex(r=>r.id===view.anchorRow)),c:Math.max(0,s.columns.findIndex(c=>c.id===view.anchorColumn))};
    selectionKind=['cells','rows','columns'].includes(view.kind)?view.kind:'cells';
    if(view.tableMode!==undefined&&typeof view.tableMode!=='boolean')throw Error('Invalid saved table-selection mode.');
    tableSelectionMode=view.tableMode===true;selectionScope=typeof view.scope==='string'?view.scope:undefined;tableSelectionTarget=typeof view.target==='string'?view.target:undefined;
    if(view.workbookView&&book.sheets.some(s=>s.id===view.workbookView.sheet))workbookView=view.workbookView;
    return{scroll:Math.max(0,view.scroll),left:Math.max(0,view.left)};
  }catch(e){error=`View preference could not be restored: ${String(e)}`;}
}
const inputText = (cell: Cell): string => cell.formula ? displayFormula(cell.formula,book) : cell.binding ? String(scalar(engine.cell(sheetId,sheet().rows[selected.r].id,sheet().columns[selected.c].id)) ?? '') : String(cell.value ?? '');
const cellText = (cell: Cell, s: Sheet, r: number,c: number): string => {
  const date=cell.format?.number==='date'||cell.format?.number==='date-compact'?dateFormatContext(engine,book,s.id,s.rows[r].id,cell):undefined;
  return cachedCellText(engine,s.id,s.rows[r].id,s.columns[c].id,cell,raw=>{
  const value = scalar(raw);
  if (isFault(value)) return value.error;
  if(date?.error)return date.error;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if(!Number.isFinite(value))return '#NUM!';
    if(date?.enabled)return displayExcelDate(value,date.year,cell.format?.number==='date-compact')??'#NUM!';
    if (cell.format?.number === 'percent') return `${+(value*100).toFixed(2)}%`;
    return cell.format?.number === 'decimal' ? value.toFixed(2) : String(+value.toPrecision(11));
  }
  if(date?.enabled&&!cell.dateLiteral&&cell.format?.number==='date-compact'){
    const serial=parseDateInput(value,date.year,true);
    if(serial!==undefined)return displayExcelDate(serial,date.year,true)!;
  }
  return value;
  },date?.key);
};
let searchPriming:{engine:Engine;generation:number;timer?:ReturnType<typeof setTimeout>}|undefined;
function primeSearchValues():void{
  if(searchPriming?.engine===engine&&searchPriming.generation===generation)return;
  clearTimeout(searchPriming?.timer);
  const target=engine,snapshot=book,version=generation,task={engine:target,generation:version,timer:undefined as ReturnType<typeof setTimeout>|undefined};
  searchPriming=task;
  const values=(function*(){
    for(const s of allSheets(snapshot)){
      const rows=new Map(s.rows.map((r,i)=>[r.id,i])),columns=new Map(s.columns.map((c,i)=>[c.id,i]));
      for(const [address,cell]of Object.entries(s.cells)){
        const [row,column]=address.split(':'),r=rows.get(row),c=columns.get(column);
        if(r!==undefined&&c!==undefined)yield{s,r,c,cell};
      }
    }
  })();
  const step=()=>{
    if(target!==engine||version!==generation||busy||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,[contenteditable="true"]'))return;
    target.beginPass();const started=performance.now();
    try{
      do{const next=values.next();if(next.done)return;const {s,r,c,cell}=next.value;cellText(cell,s,r,c);}while(performance.now()-started<6);
      task.timer=setTimeout(step,20);
    }catch(e){flash(e);}
  };
  task.timer=setTimeout(step,1000);
}
function flash(e: unknown): void { error = e instanceof Error ? e.message : String(e); renderStatus(); }
function mutate(label: string, fn: () => void,confirmed=false,renderOptions?:{preserveViewport:boolean}): boolean {
  if (busy) { flash('Wait for the current save or sync to finish.'); return false; }
  const before = editSnapshot(book);
  const priorBook=book,priorCopy=copied,shape=structureKey(book),metadata=metadataKey(book),cells=new Map(allSheets(before).map(s=>[s.id,s.cells]));
  try {
    fn();
    const impact=confirmed?'':conversionEditImpact(before,book);
    if(impact){
      const proposed=clone(book),proposedCopy=copied;book=before;copied=priorCopy;engine=new Engine(book);
      draft=undefined;awaitingMutationConfirmation=true;render(renderOptions);
      confirmAction('Change conversion factor?',impact,()=>{draft=undefined;mutate(label,()=>{book=proposed;if(copied===priorCopy)copied=proposedCopy;},true,renderOptions);});
      document.querySelector('dialog')?.addEventListener('close',()=>{awaitingMutationConfirmation=false;draft=undefined;renderStatus();});
      return false;
    }
  }
  catch(e) { book = before; copied=priorCopy;engine = new Engine(book); flash(e); render(renderOptions); return false; }
  const changes:{sheet:string;key:string;value?:Cell}[]=[];
  const incremental=priorBook===book&&metadata===metadataKey(book);
  const compared=new WeakMap<object,WeakSet<object>>();
  const same=(a:unknown,b:unknown):boolean=>{
    if(Object.is(a,b))return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b)||Array.isArray(a)&&Array.isArray(b)&&a.length!==b.length)return false;
    if(compared.get(a)?.has(b))return true;
    const first=a as Record<string,unknown>,second=b as Record<string,unknown>,keys=Object.keys(first);
    if(keys.length!==Object.keys(second).length||!keys.every(k=>Object.prototype.hasOwnProperty.call(second,k)&&same(first[k],second[k])))return false;
    let matches=compared.get(a);if(!matches)compared.set(a,matches=new WeakSet());matches.add(b);return true;
  };
  {
    for(const s of allSheets(book)){
      const previous=cells.get(s.id);if(!previous)continue;
      const old=allSheets(before).find(old=>old.id===s.id)!;
      for(const k of Object.keys(s.cells))if(previous[k]!==s.cells[k]&&(incremental||!same(previous[k],s.cells[k])))changes.push({sheet:s.id,key:k,value:old.cells[k]});
      for(const k of Object.keys(previous))if(!(k in s.cells))changes.push({sheet:s.id,key:k,value:old.cells[k]});
    }
  }
  if(incremental){
    if(!changes.length){copied=priorCopy;render(renderOptions);return true;}undo.push({cells:changes});
  }else{
    const entry=structuralUndo(before,book,true);
    if('patch'in entry){
      const parents=new Set(entry.patch.map(p=>JSON.stringify(p.path))),paths=new Map(allSheets(before).map(s=>[s.id,before.sheets.includes(s)?['sheets',before.sheets.indexOf(s)]:['dropdownData','sheets',before.dropdownData!.sheets.indexOf(s)]]));
      const additions:Patch[]=[];
      for(const change of changes){
        const path:Patch['path']=[...paths.get(change.sheet)!,'cells',change.key];
        let covered=false;
        for(let length=1;length<path.length&&!covered;length++)covered=parents.has(JSON.stringify(path.slice(0,length)));
        if(!covered)additions.push({path,exists:change.value!==undefined,value:change.value});
      }
      for(const patch of clone(additions))entry.patch.push(patch);
    }
    if('patch'in entry&&!entry.patch.length){copied=priorCopy;render(renderOptions);return true;}undo.push(entry);
  }
  while(undo.length>undoLimit)undo.shift();
  redo.length = 0;
  recordTableEdits(before,book,changes);
  const reset=priorBook!==book||shape!==structureKey(book);
  if(!reset){
    engine.invalidate(changes.map(change=>`${change.sheet}:${change.key}`));
  }
  displayedVersion++;
  const entry=undo.at(-1)!;
  if(priorCopy&&copied&&copied!==priorCopy)clipboardHistory.set(entry,{current:copied,restore:priorCopy});
  const forward:History='cells'in entry?{cells:entry.cells.map(change=>({sheet:change.sheet,key:change.key,value:clone(allSheets(book).find(s=>s.id===change.sheet)!.cells[change.key])}))}:'patch'in entry?capturePatch(book,entry.patch.map(p=>p.path)):{book:clone(book)};
  const activity=capturePatch(book,[['tableActivity']]);if('patch'in forward)forward.patch.push(...activity.patch);
  else scopedChanges.push(activity);
  changed(label,reset,false,forward);
  if(incremental&&!reset&&drawRowWindow){drawRowWindow(true);groupManager?.refresh();renderStatus();}else render(renderOptions);
  return true;
}
function sheetPath(s:Sheet=sheet()):Patch['path']{
  const at=book.sheets.findIndex(item=>item.id===s.id),dropdown=book.dropdownData?.sheets.findIndex(item=>item.id===s.id)??-1;
  if(at<0&&dropdown<0)throw Error('This sheet no longer exists.');
  return at>=0?['sheets',at]:['dropdownData','sheets',dropdown];
}
function mutateCell(s:Sheet,row:string,column:string,fn:()=>void):boolean{
  if(busy){flash('Wait for the current save or sync to finish.');return false;}
  const address=key(row,column),previous=s.cells[address],inverse:History={cells:[{sheet:s.id,key:address,value:clone(previous)}]};
  try{fn();validateCellChanges(book,inverse.cells);}catch(e){
    if(previous)s.cells[address]=previous;else delete s.cells[address];
    flash(e);render();return false;
  }
  const oldSheet={...s,cells:previous?{[address]:previous}:{}},before={...book,sheets:book.sheets.map(sheet=>sheet===s?oldSheet:sheet),...(book.dropdownData?{dropdownData:{...book.dropdownData,sheets:book.dropdownData.sheets.map(sheet=>sheet===s?oldSheet:sheet)}}:{})};
  recordTableEdits(before,book,inverse.cells);
  undo.push(inverse);while(undo.length>undoLimit)undo.shift();redo.length=0;
  const forward:History={cells:[{sheet:s.id,key:address,value:clone(s.cells[address])}]};
  scopedChanges.push(capturePatch(book,[['tableActivity']]));
  engine.invalidate([`${s.id}:${address}`]);displayedVersion++;
  changed('Edit cell',false,false,forward);
  drawRowWindow?.(true);groupManager?.refresh();renderStatus();return true;
}
function tablePath(t:ReturnType<typeof allTables>[number]):Patch['path']{
  const at=book.tables.findIndex(item=>item.id===t.id),dropdown=book.dropdownData?.tables.findIndex(item=>item.id===t.id)??-1;
  if(at<0&&dropdown<0)throw Error('This table no longer exists.');
  return at>=0?['tables',at]:['dropdownData','tables',dropdown];
}
function layoutHistory(entry:History):boolean{
  if(!('patch'in entry))return false;
  return entry.patch.every(({path})=>{
    if(['title','hypotheticalStyle','toolbarOrder','toolbarDividers','tableManagerSort','sheetTabGroups','sheetTabCollapsed'].includes(String(path[0])))return true;
    const offset=path[0]==='sheets'?2:path[0]==='dropdownData'&&path[1]==='sheets'?3:-1;
    if(offset<0||typeof path[offset-1]!=='number')return false;
    if(path[offset]==='groups'||path[offset]==='outlineView')return true;
    return ['rows','columns'].includes(String(path[offset]))&&typeof path[offset+1]==='number'&&['hidden','height','width','hypothetical','hypotheticalTables'].includes(String(path[offset+2]));
  });
}
function mutateMetadata(label:string,fn:()=>void,paths:Patch['path'][],reset=false,repaint=true):boolean{
  if(busy){flash('Wait for the current save or sync to finish.');return false;}
  const before=capturePatch(book,paths);
  try{fn();}catch(e){if(patchDifference(before,capturePatch(book,paths)).patch.length){book=applyUndo(book,before).book;engine=new Engine(book);}flash(e);render();return false;}
  const inverse=patchDifference(before,capturePatch(book,paths));
  if(!inverse.patch.length)return true;
  const forward=capturePatch(book,inverse.patch.map(p=>p.path));
  undo.push(inverse);while(undo.length>undoLimit)undo.shift();redo.length=0;
  if(reset)displayedVersion++;
  changed(label,reset,false,forward);
  if(repaint)render();else{renderStatus();refreshSelection(false);groupManager?.refresh();}
  return true;
}
function structureKey(b:Workbook):string {
  return JSON.stringify([allSheets(b).map(s=>[s.id,s.name,s.rows.map(r=>r.id),s.columns.map(c=>c.id)]),allTables(b),b.names]);
}
function metadataKey(b:Workbook):string{return JSON.stringify(b,(k,v)=>k==='cells'?undefined:v);}
function changed(label: string,reset=true,quiet=false,forward?:History): void {
  const preservedStatus=quiet?status:undefined;
  book.revision++; generation++; if(reset)engine = new Engine(book);
  if(forward)scopedChanges.push(forward);else fullSaveRequired=true;
  if(!quiet){error='';status = 'Unsaved changes - saving locally...';}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flush(label,preservedStatus); },350);
  primeSearchValues();
}
async function flush(label = 'Edit workbook',preservedStatus?:string): Promise<void> {
  clearTimeout(saveTimer);
  saving = saving.then(async () => {
    if (savedGeneration === generation && state) return;
    await navigationSaving;
    const snapshot = book, revision=book.revision,g = generation,undoHistory=clone({undo,redo}),records=scopedChanges.splice(0),full=fullSaveRequired||!state;
    fullSaveRequired=false;
    if(preservedStatus===undefined)status = 'Saving locally...'; renderStatus();
    try {
      if(full){
        state=await store.save(snapshot,state?.version??0,label,false,undefined,{undoHistory});compactionWrites=0;
      }else{
        const receipt=await store.saveChanges(snapshot.id,revision,state.version,label,records,undoHistory);
        let saved=state.book;for(const record of records)saved=applyUndo(saved,record).book;
        saved={...saved,revision};state={...state,...receipt,book:saved};
        compactionWrites++;
        if(!compactionTimer)compactionTimer=setTimeout(()=>{compactionTimer=undefined;void compactSavedChanges();},10000);
        if(compactionWrites>=32)void compactSavedChanges();
      }
      navigationError=undefined;
      savedGeneration = g;
      status = g!==generation?'Unsaved changes - saving locally...':state.sync ? `Saved locally - ${state.pending.length} pending changes` : preservedStatus??'Saved in this browser';
      channel?.postMessage({version:state.version});
    } catch(e) { scopedChanges.unshift(...records);fullSaveRequired||=full;status = 'NOT SAVED - download a backup'; flash(e); throw e; }
    finally { renderStatus(); }
  }).catch(e => { flash(e); });
  await saving;
}
async function compactSavedChanges():Promise<void>{
  saving=saving.then(async()=>{
    if(!state||!compactionWrites)return;
    try{await store.compact(state.version);compactionWrites=0;}
    catch(e){status='Changes saved; recovery compaction needs retry';flash(e);}
  });
  await saving;
}
async function manualSave(): Promise<void> {
  if(busy){flash('Wait for the current save or sync to finish.');return;}
  if(!commitDraft())return;
  busy=true;renderStatus();
  try {
    await navigationSaving;
    if(navigationError)generation++;
    await flush('Manual save');
    if(savedGeneration!==generation)return;
    const captured=await store.compact(state.version,state.sync?undefined:'Manual save');compactionWrites=0;
    if(!captured)throw Error('Saved workbook is missing. Restore from recovery before continuing.');
    state=captured;navigationDirty=false;
    await navigationSaving;
    if(navigationDirty){state=await store.metadata(state.version,s=>s);navigationDirty=false;}
    if(!state.sync){status='Saved locally + recovery checkpoint';return;}
    if(!token){openSync();return;}
    status='Syncing private repository...';renderStatus();
    const originals=(await store.backup(state)).originals;
    const result = await syncGitHub(state,token,fetch,originals),received=result.remote?migrateDropdownData(result.remote):undefined;
    if (result.remote) await store.checkpoint('Before remote download',book,result.originals??[]);
    if(result.remote&&received?.changed)await store.checkpoint('Remote before DD storage migration',result.remote,result.originals??[]);
    state = await store.metadata(state.version,s => ({...s,book:clone(received?.book??book),remoteSha:result.sha,pending:received?.changed?[{id:uid(),label:'Move dropdown records into DD storage',time:new Date().toISOString()}]:[]}));
    if(result.remote)adoptSavedWorkbook();
    status = received?.changed?'Remote downloaded; DD storage update saved locally - use Save to sync':'Synced with private repository'; render();
  } catch(e) {
    if (e instanceof SyncConflict) {
      await store.checkpoint('Remote conflict - not applied',e.remote,e.originals);
      await store.checkpoint('Local conflict - not uploaded',book);
      status = 'CONFLICT - both versions in recovery';
      openConflict(e);
    } else status = state.sync?'Sync failed - local copy retained':'Recovery checkpoint failed - local save retained';
    flash(e);
  } finally { busy = false; renderStatus(); }
}
function openConflict(conflict:SyncConflict):void {
  dialog('Sync conflict - choose deliberately',`<p>Both versions were saved as recovery checkpoints. No automatic merge or upload occurred. Structural edits are conservatively treated as conflicts.</p><div class="menu"><button id="use-remote">Use remote version on this device</button><button id="keep-local">Keep local version and explicitly replace remote</button></div><p class="muted">Closing this dialog leaves both versions unchanged. A remote change after this decision will cause another conflict, never an unconditional overwrite.</p>`,d=>{
    d.querySelector<HTMLButtonElement>('#use-remote')!.onclick=async()=>{
      if(busy)return;
      try{
        const received=migrateDropdownData(conflict.remote);
        state=await store.metadata(state.version,s=>({...s,book:clone(received.book),remoteSha:conflict.sha,pending:received.changed?[{id:uid(),label:'Move dropdown records into DD storage',time:new Date().toISOString()}]:[]}));
        adoptSavedWorkbook();
        error='';status='Remote version saved locally - previous local version in recovery';render();d.close();
      }catch(e){flash(e);}
    };
    d.querySelector<HTMLButtonElement>('#keep-local')!.onclick=()=>{
      d.close();confirmAction('Replace remote with local version?', 'The preserved remote version remains in recovery. This explicitly chooses your local workbook; the upload still checks the remote revision.',()=>{
        void(async()=>{try{state=await store.metadata(state.version,s=>({...s,remoteSha:conflict.sha}));await manualSave();}catch(e){flash(e);}})();
      });
    };
  });
}
function renderStatus(): void {
  const title=root.querySelector('#title');if(title)title.textContent=book.title;
  updateCalculationState();
  for(const [action,entries]of [['undo',undo],['redo',redo]] as const){
    const button=root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);if(!button)continue;
    button.dataset.historyCount=String(entries.length);
    button.disabled=busy||!entries.length;
    button.dataset.shortcutLabel=`${action==='undo'?'Undo':'Redo'} (${entries.length} available)`;
  }
  root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('#formula,.cell-inline-editor').forEach(el=>el.disabled=busy||!editableReference()||!!gridReference()?.error);
  if(expandedEditor)expandedEditor.input.disabled=busy||!editableReference()||!!gridReference()?.error;
  const el = document.querySelector('#save-state');
  if (el) { el.textContent = draft!==undefined?'Editing cell - not saved yet':appendDraft?'Editing new option - not saved yet':colorPicker?.pending?'Previewing color - release to apply':busy&&status.startsWith('Saved')?'Finishing complete save...':status; el.className = `save-state ${error ? 'bad' : ''}`; }
  const alert = document.querySelector<HTMLElement>('#error');
  if (alert) {
    alert.querySelector<HTMLElement>('.error-message')!.textContent=error;alert.hidden=!error;
    alert.querySelector<HTMLButtonElement>('.error-dismiss')!.onclick=()=>{error='';renderStatus();};
  }
  if(root.querySelector('[data-action="bold"]')){
    const format=inGrid(selected.r,selected.c)?current().format:undefined;
    for(const flag of ['bold','italic','underline','strikethrough','wrap'] as const)root.querySelector(`[data-action="${flag}"]`)?.setAttribute('aria-pressed',String(!!format?.[flag]));
  }
  const groupAxis=selectionMode()==='rows'?'row':selectionMode()==='columns'?'column':undefined;
  const groupAxes:('row'|'column')[]=groupAxis?[groupAxis]:['row','column'];
  for(const [action,kind,label]of [['summary-group','summary','summary'],['plain-group','range','plain']] as const){
    const button=root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);if(!button)continue;
    const grouped=kind==='summary'
      ?groupAxes.some(axis=>groupingSelection(kind,axis).targets.length>0)
      :!!groupAxis&&groupingSelection(kind,groupAxis).targets.length>0;
    button.setAttribute('aria-pressed',String(grouped));button.title=`${grouped?'Remove':'Create'} ${label} group`;
    if(kind==='summary'){button.setAttribute('aria-label',button.title);button.parentElement?.setAttribute('data-active',String(grouped));}
    button.disabled=!arrangingToolbar&&(busy||!editableReference()||!!gridReference()?.error);
  }
  const addSummary=root.querySelector<HTMLButtonElement>('[data-action="add-summary-group"]');
  if(addSummary)addSummary.disabled=!arrangingToolbar&&(root.querySelector('[data-action="summary-group"]')?.getAttribute('aria-pressed')!=='true'||busy||!editableReference()||!!gridReference()?.error);
  const moveTop=root.querySelector<HTMLButtonElement>('[data-action="move-to-top"]');
  if(moveTop)moveTop.disabled=!arrangingToolbar&&(busy||!moveToTopTarget());
  const assignment=root.querySelector<HTMLButtonElement>('[data-action="dropdown-source"]');
  if(assignment){
    const s=sheet(),row=s.rows[selected.r].id,column=s.columns[selected.c].id;
    const assigned=inGrid(selected.r,selected.c)&&s.validations.some(rule=>rule.rows.includes(row)&&rule.columns.includes(column));
    assignment.setAttribute('aria-pressed',String(assigned));
  }
  const tag=root.querySelector<HTMLButtonElement>('[data-action="hypothetical"]');
  if(tag){
    const selection=hypotheticalSelection(),all=!!selection?.ids.length&&selection.tagged===selection.ids.length,mixed=!!selection?.tagged&&!all;
    const label=getHypotheticalStyle(book).label;
    tag.setAttribute('aria-pressed',mixed?'mixed':String(all));
    tag.dataset.shortcutLabel=`${all?'Remove':'Add'} ${label} tag`;
    tag.title=mixed?`Add ${label} to the selection (mixed tags)`:`${all?'Remove':'Add'} ${label} tag`;
  }
}
function categoryTabHtml(kind:'sheet'|'reference',group:string,label:string,expanded:boolean,source?:ReferenceSource):string{
  return`<button type="button" class="sheet-tab tab-category${source?.archived?' archived':''}" data-${kind}-group="${esc(group)}"${source?` data-reference="${source.id}"`:''} aria-expanded="${expanded}">${esc(label)}<span class="category-chevron">${dropdownArrowHtml}</span></button>`;
}
function addTabHtml(reference:boolean):string{
  const label=reference?'Add dropdown source':'Add sheet';
  return`<button type="button" class="tab-add-action" data-action="${reference?'new-reference':'new-sheet'}" title="${label}" aria-label="${label}">${toolbarIcon('add')}</button>`;
}
function referenceTabsHtml():string{
  const button=(source:ReferenceSource,label=referenceLabel(source),category?:string)=>category?categoryTabHtml('reference',category,label,book.pickerSources[`dd-group-collapsed:${category.toLowerCase()}`]!=='true',source):`<button class="sheet-tab ${source.id===referenceId?'current ':''}${source.archived?'archived':''}" data-reference="${source.id}">${esc(label)}</button>`;
  const node=(g:ReferenceNavigation,depth=1):string=>g.group?`<span class="reference-tab-group reference-group-depth-${depth}" role="group" aria-label="${esc(g.group)}">${button(g.members.find(s=>s.id===referenceId)??g.members[0],g.label,g.group)}<span class="reference-group-members" ${book.pickerSources[`dd-group-collapsed:${g.group.toLowerCase()}`]==='true'?'hidden':''}>${g.children.map(child=>node(child,depth+1)).join('')}</span></span>`:button(g.members[0]);
  return`<div class="tabs">${referenceNavigation(book).map(g=>node(g)).join('')}${addTabHtml(true)}<span class="tab-drop-marker" hidden></span></div>`;
}
function workbookTabsHtml():string{
  const button=(tab:Sheet)=>`<button class="sheet-tab ${tab.id===sheetId?'current':''}" data-sheet="${tab.id}" style="--tab-color:${esc(tab.color)}">${esc(tab.name)}</button>`,seen=new Set<string>();
  const tabs=book.sheets.map(tab=>{
    const group=book.sheetTabGroups?.[tab.id];if(!group)return button(tab);
    if(seen.has(group))return'';seen.add(group);
    const collapsed=book.sheetTabCollapsed?.includes(group);
    return`<span class="reference-tab-group reference-group-depth-1 sheet-tab-group" role="group" aria-label="${esc(group)}">${categoryTabHtml('sheet',group,group,!collapsed)}<span class="reference-group-members"${collapsed?' hidden':''}>${book.sheets.filter(sheet=>book.sheetTabGroups?.[sheet.id]===group).map(button).join('')}</span></span>`;
  }).join('');
  return`<div class="tabs">${tabs}${addTabHtml(false)}<span class="tab-drop-marker" hidden></span></div>`;
}
let captureViewport:(()=>{row:string;index:number;offset:number}|undefined)|undefined;
function render(options?:{preserveViewport:boolean}): void {
  closeMoveAutoScroll?.();closeMoveAutoScroll=undefined;
  groupEdgeTargets=undefined;edgeMoveGroups=undefined;
  cancelAnimationFrame(selectionPaintFrame);selectionPaintFrame=0;
  const toolbarScroll=root.querySelector<HTMLElement>('.toolbar')?.scrollLeft??0;
  closeToolbar?.();closeToolbar=undefined;
  tableSelectionControl?.close();tableSelectionControl=undefined;
  stickyTableHeaders?.close();stickyTableHeaders=undefined;
  hideShortcutHint();
  groupControls?.close();groupControls=undefined;
  closeCellDropdown?.();
  if(draft===undefined)closeExpandedEditor();
  if(ensureTableSheetSpace(book)){const warning=error;changed('Add blank sheet space');error=warning;}
  engine.beginPass();
  if(referenceId&&!activeReference())referenceId=book.references?.find(source=>!source.workbookOnly)?.id;
  if(activeReference()?.workbookOnly){
    const table=book.tables.find(table=>table.id===activeReference()!.table);
    referenceId=undefined;workbookView=undefined;
    if(table)sheetId=table.sheet;else flash(Error('The workbook-only dropdown backing table is missing.'));
  }
  document.body.classList.toggle('dd-mode',!!referenceId);
  const view=gridReference();
  if(view?.sheet)sheetId=view.sheet.id;
  const s = sheet();
  if (!s.rows.length || !s.columns.length) return;
  try{sessionStorage.setItem('fnt-current-sheet',s.id);}catch(e){error=`Could not remember the selected tab: ${String(e)}`;}
  selected.r=Math.min(selected.r,s.rows.length-1); selected.c=Math.min(selected.c,s.columns.length-1);
  anchor.r=Math.min(anchor.r,s.rows.length-1); anchor.c=Math.min(anchor.c,s.columns.length-1);
  if(view?.rows.length&&view.columns.length&&selectionKind==='cells'&&!inGrid(selected.r,selected.c)){selected={r:s.rows.findIndex(r=>r.id===(view.rows[1]??view.rows[0])),c:s.columns.findIndex(c=>c.id===view.columns[0])};anchor={...selected};selectionKind='cells';}
  const previousGrid=root.querySelector<HTMLElement>('#grid-scroll'),viewKey=s.id+(referenceId??''),sameSheet=renderedSheet===viewKey;
  const previousViewport=sameSheet&&options?.preserveViewport?captureViewport?.():undefined;
  if(!sameSheet)extraSelections=[];
  if(tableSelectionTarget&&!(view?.table?[view.table]:allTables(book)).some(t=>t.id===tableSelectionTarget&&t.sheet===s.id))tableSelectionTarget=undefined;
  if(selectionKind==='cells')selectionScope=tableSelectionMode?tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)?.id:undefined;
  if(selectionScope&&!scopedSelectionTable()){selectionScope=undefined;selectionKind='cells';anchor={...selected};}
  const selectedRanges=currentSelections();
  const tabScroll=root.querySelector<HTMLElement>('.tabs')?.scrollLeft??0;
  const collapsedRows=new Set(s.groups.filter(g=>!g.table&&g.axis==='row'&&g.collapsed).flatMap(g=>outlineMembers(g,s.groups)));
  const collapsedColumns=new Set(s.groups.filter(g=>!g.table&&g.axis==='column'&&g.collapsed).flatMap(g=>outlineMembers(g,s.groups)));
  const pins=pinnedColumns.get(s.id)??[];
  const memberships=tableGroupMembership(book,s);
  const hypotheticalRows=hypotheticalMembers(s,'row'),hypotheticalColumns=hypotheticalMembers(s,'column');
  const rowHypo=hypotheticalProjection(book,s,'row'),columnHypo=hypotheticalProjection(book,s,'column');
  hypotheticalView={generation,sheet:s,row:{members:hypotheticalRows,projection:rowHypo},column:{members:hypotheticalColumns,projection:columnHypo}};
  const hiddenTables=showHypothetical?undefined:new Map(memberships.map(({owner,rows,columns})=>[owner.id,{
    rows:new Set([...rows].filter(row=>owner.columns[0]&&rowHypo(row,owner.columns[0].column))),
    columns:new Set([...columns].filter(column=>columnHypo(owner.header,column)))
  }]));
  const sheetTables=memberships.map(table=>{
    const hidden=hiddenTables?.get(table.owner.id);
    return hidden?{...table,hiddenRows:new Set([...table.hiddenRows,...hidden.rows]),hiddenColumns:new Set([...table.hiddenColumns,...hidden.columns])}:table;
  });
  const cellTable=(row:string,column:string)=>sheetTables.find(table=>table.rows.has(row)&&table.columns.has(column))?.owner;
  maskedCell=(row,column)=>sheetTables.some(table=>table.rows.has(row)&&table.columns.has(column)&&(table.hiddenRows.has(row)||table.hiddenColumns.has(column)))||!showHypothetical&&(rowHypo(row,column)||columnHypo(row,column));
  const columns = s.columns.map((c,i) => ({...c,i})).filter(c => !c.hidden && !collapsedColumns.has(c.id)&&(showHypothetical||!hypotheticalColumns.has(c.id)||s.rows.some(row=>!columnHypo(row.id,c.id)))&&(!view||view.columns.includes(c.id)));
  const rows = s.rows.map((r,i) => ({...r,i})).filter(r => !r.hidden && !collapsedRows.has(r.id)&&(showHypothetical||!hypotheticalRows.has(r.id)||columns.some(column=>!rowHypo(r.id,column.id)))&&(!view||view.rows.includes(r.id)));
  const firstOwned=new Map(sheetTables.map(({owner,rows:ownedRows,columns:ownedColumns})=>[owner.id,{
    row:rows.find(row=>ownedRows.has(row.id))?.id,column:columns.find(column=>ownedColumns.has(column.id))?.id
  }]));
  groupProjection=tableGroupProjection(book,s,rows.map(row=>row.id),columns.map(column=>column.id),hiddenTables);
  if(maskedCell(s.rows[selected.r].id,s.columns[selected.c].id)){
    const owner=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id);
    const availableRows=options?.preserveViewport?[...rows].sort((a,b)=>Math.abs(a.i-selected.r)-Math.abs(b.i-selected.r)):rows;
    const availableColumns=options?.preserveViewport?[...columns].sort((a,b)=>Math.abs(a.i-selected.c)-Math.abs(b.i-selected.c)):columns;
    const available=(owned:boolean)=>{
      for(const row of availableRows)for(const column of availableColumns)if((!owned||!owner||(row.id===owner.header||owner.rows.includes(row.id))&&owner.columns.some(field=>field.column===column.id))&&!maskedCell(row.id,column.id))return{r:row.i,c:column.i};
    };
    const replacement=available(true)??available(false);
    if(replacement){selected=replacement;anchor={...selected};selectionKind='cells';extraSelections=[];}
  }
  const b=bounds();
  navigationRows=rows.map(r=>r.i);navigationColumns=columns.map(c=>c.i);
  const groups=s.groups.filter(g=>(!g.table||allTables(book).some(table=>table.id===g.table&&table.sheet===s.id))&&(!view||g.members.some(id=>(g.axis==='row'?view.rows:view.columns).includes(id))));
  const sheetGroups=groups.filter(g=>!g.table);
  const tree=s.outlineView?.tree??true,hints=s.outlineView?.plainGroupHints!==false,outlines=outlineGroups(sheetGroups),gutter=outlineGutter(outlines,rows.map(r=>r.id),tree,s.rows.length,hints);
  const hasMasterChevron=groups.some(group=>group.kind==='summary');
  const firstColumn=columns[0],rowLayouts=constantSummaryRowLayout(sheetGroups,rows.map(r=>r.id),tree);
  const tableRowLayouts=new Map(sheetTables.filter(({owner})=>groups.some(group=>group.table===owner.id&&group.kind==='summary'&&group.axis==='row')).flatMap(({owner,rows:ownedRows,columns:ownedColumns})=>{
    const column=columns.find(column=>ownedColumns.has(column.id)&&groupProjection!.display(owner.header,column.id));
    if(!column)return[];
    const shownRows=rows.filter(row=>ownedRows.has(row.id)&&groupProjection!.display(row.id,column.id)).map(row=>row.id);
    return[[owner.id,{column:column.id,rows:constantSummaryRowLayout(groups.filter(group=>group.table===owner.id),shownRows,tree)}] as const];
  }));
  const tableInsets=new Map<string,number>();
  for(const layout of tableRowLayouts.values())tableInsets.set(layout.column,Math.max(tableInsets.get(layout.column)??0,...[...layout.rows.values()].map(row=>row.inset)));
  const rowById=new Map(rows.map(row=>[row.id,row])),columnById=new Map(columns.map(column=>[column.id,column]));
  const sourceRowIndices=new Map(s.rows.map((row,i)=>[row.id,i])),sourceColumnIndices=new Map(s.columns.map((column,i)=>[column.id,i]));
  const hypotheticalStyle=getHypotheticalStyle(book);
  const tableRightEdges=new Set<string>(),tableBottomEdges=new Set<string>();
  for(const {rows:rowIds,columns:columnIds,hiddenRows,hiddenColumns}of sheetTables){
    const tableRows=rows.filter(row=>rowIds.has(row.id)&&!hiddenRows.has(row.id)),tableColumns=columns.filter(column=>columnIds.has(column.id)&&!hiddenColumns.has(column.id));
    const lastRow=tableRows.at(-1),lastColumn=tableColumns.at(-1);
    if(!lastRow||!lastColumn)continue;
    for(const row of tableRows)tableRightEdges.add(key(row.id,lastColumn.id));
    for(const column of tableColumns)tableBottomEdges.add(key(lastRow.id,column.id));
  }
  const columnSummaries=new Map<string,number>();
  for(const entry of outlines.filter(e=>e.group.axis==='column'&&e.group.kind==='summary')){
    const id=entry.group.members[0];columnSummaries.set(id,(columnSummaries.get(id)??0)+1);
  }
  const columnHints=new Map<string,number>(),visibleColumns=columns.map(c=>c.id);
  if(hints)for(const group of sheetGroups.filter(g=>g.axis==='column'&&g.kind!=='summary')){
    const id=precedingGroupMember(s,group,visibleColumns);
    if(id)columnHints.set(id,(columnHints.get(id)??0)+1);
  }
  let hasColumnControls=false;
  for(const column of columns){
    const controls=columnHints.get(column.id)??0;
    if(controls){hasColumnControls=true;column.width=Math.max(column.width??145,20+controls*52);}
    const rowInset=(column.id===firstColumn?.id?Math.max(0,...[...rowLayouts.values()].map(row=>row.inset)):0)+(tableInsets.get(column.id)??0);
    const summaryInset=(columnSummaries.get(column.id)??0)*24,masterInset=hasMasterChevron&&column.id===firstColumn?.id?24:0;
    const firstRowInset=(column.id===firstColumn?.id?rowLayouts.get(rows[0]?.id)?.inset??0:0)+Math.max(0,...[...tableRowLayouts.values()].filter(layout=>layout.column===column.id).map(layout=>layout.rows.get(rows[0]?.id)?.inset??0));
    if(rowInset||summaryInset||masterInset)column.width=Math.max(column.width??145,Math.max(rowInset+summaryInset,firstRowInset+summaryInset+masterInset)+32);
  }
  const hasPlainColumnControls=hints&&groups.some(group=>group.axis==='column'&&group.kind!=='summary');
  const columnHeaderHeight=(hasColumnControls?40:35)+(hasPlainColumnControls?28:0);
  const estimatedHeaderHeight=columnHeaderHeight;
  if(groupMenuSheet!==viewKey){groupMenuOpen=false;groupMenuSheet=viewKey;}
  const pinOffsets=new Map<string,number>(),pinRightOffsets=new Map<string,number>();let pinLeft=gutter,pinRight=0;
  for(const c of columns)if(pins.includes(c.id)){pinOffsets.set(c.id,pinLeft);pinLeft+=c.width??145;}
  for(const c of [...columns].reverse())if(pins.includes(c.id)){pinRightOffsets.set(c.id,pinRight);pinRight+=c.width??145;}
  const pinnedStyle=(id:string,header=false)=>pinOffsets.has(id)?`position:sticky;left:${pinOffsets.get(id)}px;right:${pinRightOffsets.get(id)}px;z-index:${header?6:3};`:'';
  const layout=new RowViewport(rows.map(r=>measuredRowHeights.get(r.id)??(r.height?r.height*4/3:33)));
  let vertical=sameSheet?previousGrid?.scrollTop??0:0;
  if(previousViewport&&rows.length){
    const exact=rows.findIndex(row=>row.id===previousViewport.row),next=rows.findIndex(row=>row.i>=previousViewport.index),at=exact>=0?exact:next>=0?next:rows.length-1;
    vertical=layout.offsets[at]+Math.min(previousViewport.offset,layout.heights[at]-1);
  }
  let bottomRow:number|undefined;
  const target=typeof scrollTarget==='object'?scrollTarget.row:scrollTarget??(!options?.preserveViewport&&renderedTarget!==`${s.id}:${selected.r}`?selected.r:undefined);
  if(target!==undefined){
    const display=groupProjection.display(s.rows[target]?.id,s.columns[selected.c].id),displayIndex=display?s.rows.findIndex(row=>row.id===display.row):target;
    const position=rows.findIndex(r=>r.i>=displayIndex),at=position<0?rows.length-1:position,top=layout.offsets[Math.max(0,at)],height=previousGrid?.clientHeight??innerHeight-180;
    if(typeof scrollTarget==='object'&&scrollTarget.align==='bottom'){
      bottomRow=rows[at]?.i;vertical=Math.max(0,top+(layout.heights[at]??33)+estimatedHeaderHeight-height);
    }else if(!sameSheet||scrollTarget!==undefined||top<vertical||top+(layout.heights[at]??33)>vertical+height-estimatedHeaderHeight)vertical=layout.offsets[Math.max(0,at-(typeof scrollTarget==='object'?scrollTarget.contextRows:0))];
  }
  scrollTarget=undefined;renderedSheet=viewKey;renderedTarget=`${s.id}:${selected.r}`;
  const t = view?.table??tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id);
  if(selectionKind==='cells')selectionTable=t?.id;
  const scroll = document.querySelector('#grid-scroll')?.scrollLeft ?? 0;
  root.innerHTML = `
    <header class="app-header">
      <div class="workbook-heading"><button id="title" title="Rename workbook">${esc(book.title)}</button></div>
      <div class="save-area"><span id="save-state" class="save-state">${esc(status)}</span><button class="primary" data-action="save">Save <span class="desktop">workbook</span></button><button data-action="file" aria-label="Workbook and backups" title="Import Excel, export and browser-local recovery">File</button></div>
    </header>
    <div id="error" role="alert" class="error" ${error?'':'hidden'}><span class="error-message">${esc(error)}</span><button type="button" class="error-dismiss" aria-label="Dismiss error" title="Dismiss error">${toolbarIcon('close')}</button></div>
    <nav class="toolbar" aria-label="Spreadsheet tools">
      <div class="tool-set">${(['undo','redo'] as const).map(name=>`<button class="icon-button" data-action="${name}" aria-label="${name==='undo'?'Undo':'Redo'}" title="${name==='undo'?'Undo (Ctrl+Z)':'Redo (Ctrl+Y)'}" ${(name==='undo'?undo:redo).length?'':'disabled'}>${toolbarIcon(name)}</button>`).join('')}</div>
      <div class="tool-set">${(['bold','italic','underline','strikethrough','wrap'] as const).map(name=>{const label={bold:'Bold',italic:'Italic',underline:'Underline',strikethrough:'Strikethrough',wrap:'Wrap text'}[name];return`<button class="icon-button" data-action="${name}" title="${label}" aria-label="${label}">${toolbarIcon(name)}</button>`;}).join('')}<button class="icon-button palette-button" data-action="text-color" title="Text color" aria-label="Text color">${toolbarIcon('text-color',current().format?.color??'#cc1122')}<span class="format-caret">${dropdownArrowHtml}</span></button><button class="icon-button palette-button" data-action="background-color" title="Cell background color" aria-label="Cell background color">${toolbarIcon('background-color',current().format?.background??'#ffdf00')}<span class="format-caret">${dropdownArrowHtml}</span></button><button data-action="format">123</button></div>
      <div class="tool-set">${referenceId?'<button data-action="reference-settings">DD settings</button>':''}<button class="icon-button" data-action="dropdown-source" aria-label="Assign DD" aria-pressed="false" title="Assign a dropdown without changing cell contents">${toolbarIcon('dropdown-source')}</button></div>
      <div class="tool-set"><button type="button" class="icon-button group-menu-button" data-toolbar-id="action:table-selection" aria-label="Group controls" title="Group controls"></button>      <div class="toolbar-split summary-group-control" data-toolbar-id="action:summary-group" role="group" aria-label="Summary group controls" tabindex="-1"><button type="button" class="icon-button group-toggle" data-action="summary-group" aria-label="Remove summary group" aria-pressed="false" title="Remove summary group">${toolbarIcon('summary-group')}</button><button type="button" class="icon-button summary-group-add" data-action="add-summary-group" aria-label="Add summary group" title="Add summary group, including within an existing group">${toolbarIcon('add')}</button></div><button type="button" class="icon-button group-toggle" data-action="plain-group" aria-label="Create/remove plain group" aria-pressed="false" title="Create plain group">${toolbarIcon('plain-group')}</button><button class="icon-button" data-action="structure" title="Rows & columns" aria-label="Rows & columns">${toolbarIcon('structure')}</button>${referenceId?'<button data-action="archive-options">Hide / show selected options</button>':''}</div>
      <div class="tool-set">${(['find','copy','cut','paste','fill'] as const).map(name=>{const label={find:'Find / replace',copy:'Copy',cut:'Cut',paste:'Paste',fill:'Fill down'}[name];return`<button class="icon-button" data-action="${name}" title="${label}" aria-label="${label}">${toolbarIcon(name)}</button>`;}).join('')}</div>
      <div class="tool-set"><button class="icon-button" data-action="pin" aria-pressed="${pins.length>0}" title="${pins.length?'Unpin columns':'Pin selected columns'}" aria-label="${pins.length?'Unpin columns':'Pin selected columns'}">${toolbarIcon('pin')}</button><button class="icon-button" data-action="browse" title="Browse values" aria-label="Browse values">${toolbarIcon('browse')}</button><button class="icon-button" data-action="hypothetical" aria-label="Add/remove ${esc(hypotheticalStyle.label)} tag" aria-pressed="false" data-shortcut-label="Add/remove ${esc(hypotheticalStyle.label)} tag" data-shortcut-keys="Ctrl|H" aria-keyshortcuts="Control+H">${toolbarIcon('hypothetical')}</button><button class="icon-button" data-action="hypothetical-settings" aria-label="Hypo tag styling" title="Customize ${esc(hypotheticalStyle.label)} row and column treatments">${toolbarIcon('hypothetical-settings')}</button><button id="status-filter" class="icon-button" data-action="hypothetical-visibility" data-toolbar-control="status-filter" aria-label="View/hide hypo rows/columns" aria-pressed="${!showHypothetical}" title="${showHypothetical?'Hide':'Show'} ${esc(hypotheticalStyle.label)} rows and columns">${toolbarIcon('hypothetical-visibility')}</button></div>
      ${referenceId?'':'<div class="tool-set"><button data-action="quick-add">+ Add entry</button></div>'}
      ${referenceId?'':`<div class="tool-set"><button class="icon-button" data-action="convert-table" aria-label="Convert to table" title="Create a table, or join selected rows/columns to their surrounding table">${toolbarIcon('convert-table')}</button><button class="icon-button" data-action="move-to-top" data-toolbar-before="action:tables" aria-label="Move to top" title="Move selected rows or a summary group below the table header">${toolbarIcon('move-to-top')}</button><button class="icon-button" data-action="tables" aria-label="Table manager" title="Table manager; rename the table containing the selected cell">${toolbarIcon('tables')}</button><button data-action="block">Meal / day</button></div>`}
      <div class="tool-set toolbar-layout-controls"><button class="icon-button" data-action="toolbar-layout" aria-label="${arrangingToolbar?'Finish arranging toolbar':'Arrange toolbar'}" aria-pressed="${arrangingToolbar}" title="${arrangingToolbar?'Finish arranging toolbar':'Arrange toolbar: drag tools or use Alt+Left/Right'}">${toolbarIcon('toolbar-layout')}</button></div>
    </nav>
    <form class="formula-bar" id="formula-form"><span class="address">${letters(selected.c)}${selected.r+1}</span><span class="fx">fx</span><input id="formula" aria-label="Cell value or formula" autocomplete="off" spellcheck="false" value="${esc(draft??inputText(current()))}"><span id="calculation-state"></span></form>
    ${view&&(view.error||referenceNotice)?`<div class="reference-notice" id="reference-notice" role="${view.error?'alert':'status'}">${esc(view.error||referenceNotice)}</div>`:''}
    <div class="grid-shell"><div id="grid-scroll" class="grid-scroll" tabindex="0" aria-label="Spreadsheet, use arrow keys to navigate">
    <table class="grid spreadsheet-grid option-a-outline ${tree?'tree-outline ':''}${hasPlainColumnControls?'plain-column-controls ':''}selection-${selectionKind} ${touchSelection?'touch-select':''}" role="grid" aria-label="${esc(activeReference()?.name??s.name)}" aria-rowcount="${s.rows.length}" aria-colcount="${s.columns.length}" style="--outline-gutter:${gutter}px;--column-header-height:${columnHeaderHeight}px;--grid-insert-width:${columns.reduce((w,c)=>w+(c.width??145),gutter)}px;--grid-insert-height:${layout.offsets.at(-1)!+estimatedHeaderHeight}px"><colgroup><col style="width:${gutter}px">${columns.map(c=>`<col style="width:${c.width??145}px">`).join('')}</colgroup>
    <thead><tr><th class="corner"><div class="table-selection-control" role="group" aria-label="Table selection"><button type="button" data-action="table-selection" aria-label="Table-constrained header selection" aria-pressed="${tableSelectionMode}"></button><button type="button" id="table-selection-target" aria-label="Table selection target"></button></div><button class="boundary-control first-column" data-insert-column="0" aria-label="Insert column before A">+</button></th>${columns.map(c=>`<th data-col="${c.i}" style="${pinnedStyle(c.id,true)}" class="${c.i>=b.c1&&c.i<=b.c2?'column-selected ':''}${movingColumns?'move-target':''}" title="Double-click to rename column"><span class="column-index">${letters(c.i)}</span><span>${esc(t?.columns.find(x=>x.column===c.id)?.name??c.label)}</span><button class="move-control" data-move-column="${c.i}" draggable="true" aria-label="Move selected columns" title="Drag, or tap then tap a destination boundary">${grip(true)}</button><button class="boundary-control" data-insert-column="${c.i+1}" aria-label="${movingColumns?'Move columns':'Insert column'} after ${letters(c.i)}">+</button><button class="resize-edge resize-column" data-resize-column="${c.i}" aria-label="Resize column ${letters(c.i)}" title="Drag to resize; double-click to fit"></button></th>`).join('')}</tr></thead>
    <tbody></tbody></table></div></div>
    <div class="grid-footer"><div><button class="selection-count" data-action="range" title="Select a cell range, including on mobile">${selectionCount(selectedRanges)} cells</button><span id="selection-scope-label"></span></div><div class="navigator"><button data-action="top" aria-label="Jump to top">Top</button><button data-action="prev" aria-label="Previous rows">&larr;</button><input id="row-jump" type="number" min="1" max="${s.rows.length}" aria-label="Jump to row"><span>/ ${s.rows.length}</span><button data-action="next" aria-label="Next rows">&rarr;</button><button data-action="bottom">Bottom</button></div></div>
    <footer class="sheet-bar" aria-label="${referenceId?'Dropdown sources':'Workbook sheets'}">${referenceId?referenceTabsHtml():workbookTabsHtml()}<div class="tab-actions"><button type="button" data-action="${referenceId?'reference-settings':'sheet-settings'}" title="${referenceId?'Dropdown settings':'Sheet settings'}" aria-label="${referenceId?'Dropdown settings':'Sheet settings'}">${toolbarIcon('settings')}</button></div><button class="reference-manager" data-action="references" title="Dropdown sources" aria-label="DD">${toolbarIcon('references')}</button></footer>`;
  const grid=root.querySelector<HTMLElement>('#grid-scroll')!,body=grid.querySelector('tbody')!;
  captureViewport=()=>{const at=layout.at(grid.scrollTop),row=rows[at];return row?{row:row.id,index:row.i,offset:grid.scrollTop-layout.offsets[at]}:undefined;};
  grid.dataset.firstRow=String(rows[0]?.i??0);grid.dataset.firstColumn=String(columns[0]?.i??0);
  groupControls=mountGroupControls({sheet:s,groups,tables:allTables(book),grid,rows:rows.map(r=>r.id),columns:columns.map(c=>c.id),projection:groupProjection,rowLayouts,tableRowLayouts,tree,hints,menuOpen:groupMenuOpen,setMenuOpen:open=>{groupMenuOpen=open;},
    change:(label,fn,scope)=>commitDraft()&&mutateMetadata(label,fn,scope.view?[[...sheetPath(s),'outlineView']]:scope.groups!.map(group=>[...sheetPath(s),'groups',s.groups.indexOf(group),'collapsed'])),refuse:flash,value:(row,column)=>cellText(getCell(s,row,column),s,sourceRowIndices.get(row)!,sourceColumnIndices.get(column)!),selectAll:()=>{void action('select-all');},manage:openGroups,scope:()=>({enabled:tableSelectionMode,table:selectionScope??tableSelectionTarget}),menuButton:root.querySelector<HTMLButtonElement>('.toolbar .group-menu-button')!});
  const headerHeight=grid.querySelector('thead')!.getBoundingClientRect().height;
  stickyTableHeaders=mountStickyTableHeaders({grid,sheet:s,tables:view?.table?[view.table]:allTables(book),rows:rows.map((row,i)=>({id:row.id,get start(){return layout.offsets[i];},get end(){return layout.offsets[i+1];}})),display:groupProjection.display,masked:maskedCell,masterControl:groupControls.masterControl,select:(row,column,edit)=>{
    if(!commitDraft())return;extraSelections=[];selected={r:s.rows.findIndex(item=>item.id===row),c:s.columns.findIndex(item=>item.id===column)};anchor={...selected};selectionKind='cells';refreshSelection();if(edit)renameSelectedColumn();
  }});
  viewportSelectionTables=(tables,axis)=>{
    const positions=axis==='column'?new Map(rows.map((row,i)=>[row.id,{start:layout.offsets[i],end:layout.offsets[i+1]}])):
      new Map(columns.flatMap(column=>{
        const header=grid.querySelector<HTMLElement>(`thead [data-col="${column.i}"]`);
        if(!header)return[];
        const rect=header.getBoundingClientRect();return[[column.id,{start:rect.left,end:rect.right}] as const];
      }));
    const viewport=axis==='column'?{start:grid.scrollTop,end:grid.scrollTop+grid.clientHeight-headerHeight}:
      {start:grid.querySelector('.corner')!.getBoundingClientRect().right,end:grid.getBoundingClientRect().left+grid.clientWidth};
    const nearest=nearestHeaderTables(tables,axis,positions,viewport);
    return nearest.length?nearest:tables;
  };
  let lastStart=-1,lastEnd=-1;
  const spacer=(height:number,position:string)=>`<tr class="virtual-spacer" aria-hidden="true" data-spacer="${position}"><td colspan="${columns.length+1}" style="height:${height}px;padding:0;border:0;line-height:0;font-size:0"></td></tr>`;
  const draw=(initialTop?:number,force=false)=>{
    const top=initialTop??grid.scrollTop,window=layout.window(top,Math.max(100,grid.clientHeight-headerHeight));
    page=Math.floor((rows[layout.at(top)]?.i??0)/60);
    const jump=root.querySelector<HTMLInputElement>('#row-jump')!;
    if(document.activeElement!==jump)jump.value=String(view?layout.at(top)+1:(rows[layout.at(top)]?.i??0)+1);
    root.querySelector<HTMLButtonElement>('[data-action="prev"]')!.disabled=top<=0;
    root.querySelector<HTMLButtonElement>('[data-action="next"]')!.disabled=top+grid.clientHeight>=layout.offsets.at(-1)!+headerHeight;
    if(window.start===lastStart&&window.end===lastEnd&&initialTop===undefined&&!force)return;
    lastStart=window.start;lastEnd=window.end;engine.beginPass();
    const active=document.activeElement,wasInline=active instanceof HTMLTextAreaElement&&active.classList.contains('cell-inline-editor'),caret=wasInline?[active.selectionStart,active.selectionEnd]:undefined,b=bounds(),ranges=currentSelections();
    const copiedRows=new Set(copied?.sheet===s.id?copied.rows:[]),copiedColumns=new Set(copied?.sheet===s.id?copied.columns:[]);
    const copyOrigins=copied?.outlineOrigins??copied?.origins;
    const copiedOrigins=copied?.sheet===s.id&&copyOrigins?new Set(copyOrigins.flatMap(row=>row.map(origin=>key(origin.row,origin.column)))):undefined;
    body.innerHTML=spacer(window.before,'before')+rows.slice(window.start,window.end).map((slotRow,index)=>{const r=slotRow,rowNumber=view?window.start+index+1:r.i+1;return`<tr data-row="${r.i}"${r.height?` style="--row-height:${r.height*4/3}px"`:''} class="${activeReference()?.archivedRows.includes(r.id)?'archived ':''}${r.status&&r.status!=='real'?r.status:''}"><th data-row-select="${r.i}" class="${r.i>=b.r1&&r.i<=b.r2?'row-selected':''}"><span class="row-index">${rowNumber}</span>${editableReference()&&(!view||r.id!==view.table?.header)?`<button class="row-move-control" data-move-row="${r.i}" draggable="true" aria-label="Move row ${rowNumber}" title="Drag row, or tap then tap destination">${grip(false)}</button>`:''}<button class="boundary-control row-boundary" data-insert-row="${r.i+1}" aria-label="${movingRows?'Move rows':'Insert row'} after ${rowNumber}">+</button>${index===0||view&&r.id===view.table?.rows[0]?`<button class="boundary-control row-start" data-insert-row="${r.i}" aria-label="Insert row before ${rowNumber}">+</button>`:''}<button class="resize-edge resize-row" data-resize-row="${r.i}" aria-label="Resize row ${rowNumber}" title="Drag to resize; double-click to fit"></button></th>${columns.map(slotColumn=>{
      const source=groupProjection!.source(slotRow.id,slotColumn.id),display=`data-display-r="${slotRow.i}" data-display-c="${slotColumn.i}"`;
      if(!source)return`<td ${display} class="compacted-empty" aria-hidden="true"></td>`;
      const r=rowById.get(source.row)!,c=columnById.get(source.column)!,owner=cellTable(r.id,c.id),tableLayout=owner?tableRowLayouts.get(owner.id):undefined;
      const paint=selectionPaintPosition(r.i,c.i,slotRow.i,slotColumn.i);
      const cell=getCell(s,r.id,c.id),val=cellText(cell,s,r.i,c.i),header=owner?.header===r.id,inSelection=ranges.some(b=>paint.r>=b.r1&&paint.r<=b.r2&&paint.c>=b.c1&&paint.c<=b.c2),copying=copiedOrigins?copiedOrigins.has(key(r.id,c.id)):copiedRows.has(r.id)&&copiedColumns.has(c.id);
      const inset=(c.id===firstColumn?.id?rowLayouts.get(r.id)?.inset??0:0)+(tableLayout?.column===c.id?tableLayout.rows.get(r.id)?.inset??0:0)+(r.id===rows[0]?.id?(columnSummaries.get(c.id)??0)*24:0)+(hasMasterChevron&&slotRow.id===rows[0]?.id&&slotColumn.id===firstColumn?.id?24:0);
      const rowTagged=rowHypo(r.id,c.id),columnTagged=columnHypo(r.id,c.id);
      const firstOwnedColumn=owner?firstOwned.get(owner.id)?.column:firstColumn?.id;
      const firstOwnedRow=owner?firstOwned.get(owner.id)?.row:rows[0]?.id;
      const tagged=rowTagged&&c.id===(hypotheticalRows.has(r.id)?firstColumn?.id:firstOwnedColumn)||columnTagged&&r.id===(hypotheticalColumns.has(c.id)?rows[0]?.id:firstOwnedRow);
      const treatment=rowTagged?hypotheticalStyle.rows:columnTagged?hypotheticalStyle.columns:undefined;
      const badge=tagged&&treatment?.badge?`<span class="hypothetical-badge" style="${hypotheticalBadgeCss(treatment)}" role="img" aria-label="${esc(hypotheticalStyle.label)}" title="${esc(hypotheticalStyle.label)}">${toolbarIcon('hypothetical-badge')}</span>`:'';
      return `<td tabindex="-1" data-r="${r.i}" data-c="${c.i}" ${display} class="${maskedCell(r.id,c.id)?'scoped-hidden ':''}${tableRightEdges.has(key(r.id,c.id))?'table-right-edge ':''}${tableBottomEdges.has(key(r.id,c.id))?'table-bottom-edge ':''}${treatment?`hypothetical-cell ${treatment.fillOpacity>0?'has-hyp-fill ':''}${treatment.textColor?'custom-hyp-text ':''}`:''}      ${cell.format?.wrap?'wrapped ':''}${inset?'summary-cell ':''}${header?'table-header ':''}${inSelection?'selected ':''}${selected.r===r.i&&selected.c===c.i?'active ':''}${copying?'copying ':''}${cell.formula?'calculated ':''}${val.startsWith('#')?'cell-error ':''}${cell.binding?'linked ':''}" style="${treatment?hypotheticalCss(treatment):''}${inset?`--summary-text-inset:${inset}px;`:''}${pinnedStyle(slotColumn.id)}${cell.format?.bold?'font-weight:700;':''}${cell.format?.italic?'font-style:italic;':''}${cell.format?.underline||cell.format?.strikethrough?`text-decoration:${[cell.format?.underline?'underline':'',cell.format?.strikethrough?'line-through':''].filter(Boolean).join(' ')};`:''}${cell.format?.wrap?'white-space:pre-wrap;overflow-wrap:anywhere;':''}${cell.format?.background?`background-color:${esc(cell.format.background)};`:''}${cell.format?.color?`color:${esc(cell.format.color)};`:''}" title="${esc(cell.formula?displayFormula(cell.formula,book):val)}"><span class="cell-display">${badge}<span class="cell-value"${treatment?` style="${hypotheticalTextCss(treatment)}"`:''}>${safeLink(cell.link??val)?`<a href="${esc(cell.link??val)}" target="_blank" rel="noopener noreferrer">${esc(val)}</a>`:esc(val)}</span></span>${cell.note?'<span class="note-dot" title="Cell has a note"></span>':''}${r.i===b.r2&&c.i===b.c2?'<button type="button" class="fill-handle" data-fill-handle aria-label="Drag to fill"></button>':''}</td>`;
    }).join('')}</tr>`;}).join('')+spacer(window.after,'after');
    const source=activeReference();
    if(view?.table&&!view.error&&source&&!source.archived&&source.kind!=='derived'&&window.end===rows.length){
      body.insertAdjacentHTML('beforeend',`<tr class="reference-append-row"><th aria-label="New option">+</th>${columns.map(c=>`<td><input data-append-column="${c.id}" aria-label="New ${esc(view.table!.columns.find(field=>field.column===c.id)!.name)} option" value="${esc(appendDraft?.source===source.id&&appendDraft.column===c.id?appendDraft.value:'')}" autocomplete="off"></td>`).join('')}</tr>`);
      body.querySelectorAll<HTMLInputElement>('[data-append-column]').forEach(input=>{
        input.onpointerdown=e=>{if(draft!==undefined&&!commitDraft()){e.preventDefault();e.stopPropagation();}};
        input.oninput=()=>{appendDraft=input.value?{source:source.id,column:input.dataset.appendColumn!,value:input.value}:undefined;renderStatus();};
        input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();appendDraft=undefined;input.value='';renderStatus();}else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();e.stopPropagation();const column=input.dataset.appendColumn!;if(!commitDraft())return;if(e.key==='Enter')root.querySelector<HTMLInputElement>(`[data-append-column="${column}"]`)?.focus({preventScroll:true});else{selected.c=Math.max(0,Math.min(s.columns.length-1,selected.c+(e.shiftKey?-1:1)));anchor={...selected};refreshSelection();root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});}}};
      });
    }
    groupControls?.drawRows();
    const anchorIndex=layout.at(top),anchorOffset=top-layout.offsets[anchorIndex];let resized=false;
    body.querySelectorAll<HTMLElement>('tr[data-row]').forEach((el,i)=>{
      const height=el.getBoundingClientRect().height,position=window.start+i;
      if(height>0&&Math.abs(layout.heights[position]-height)>.1){layout.heights[position]=height;measuredRowHeights.set(rows[position].id,height);resized=true;}
    });
    if(resized){layout.rebuild();(body.querySelector('[data-spacer="before"] td') as HTMLElement).style.height=layout.offsets[window.start]+'px';(body.querySelector('[data-spacer="after"] td') as HTMLElement).style.height=layout.offsets.at(-1)!-layout.offsets[window.end]+'px';}
    grid.querySelector<HTMLElement>('.grid')!.style.setProperty('--grid-insert-height',layout.offsets.at(-1)!+headerHeight+'px');
    grid.scrollTop=layout.offsets[anchorIndex]+anchorOffset;bindRowControls();refreshSelection(false);groupManager?.paint();paintMoving();paintHypotheticalOverrides();rememberView();
    if(draft!==undefined&&!busy){
      syncDraft(draft,false,draftLiteral);
      if(wasInline){const editor=root.querySelector<HTMLTextAreaElement>('.cell-inline-editor')??root.querySelector<HTMLInputElement>('#formula')!;editor.focus({preventScroll:true});editor.setSelectionRange(caret![0],caret![1]);}
    }
  };
  drawRowWindow=force=>draw(undefined,force);draw(vertical);
  if(bottomRow!==undefined){
    const row=body.querySelector<HTMLElement>(`tr[data-row="${bottomRow}"]`);
    if(row)grid.scrollTop+=row.getBoundingClientRect().bottom-grid.getBoundingClientRect().top-grid.clientTop-grid.clientHeight;
  }
  grid.scrollLeft=scroll;
  bind();
  groupManager?.refresh();
  root.querySelector<HTMLElement>('.tabs')!.scrollLeft=tabScroll;
  if(draft!==undefined)syncDraft(draft,false,draftLiteral);
  expandedEditor?.position();
  renderStatus();
  const toolbar=root.querySelector<HTMLElement>('.toolbar')!;
  closeToolbar=mountToolbar(toolbar,{order:book.toolbarOrder,dividers:book.toolbarDividers,editing:arrangingToolbar,selection:toolbarSelection,change:(order,dividers)=>commitDraft()&&mutateMetadata('Arrange toolbar',()=>{book.toolbarOrder=order;book.toolbarDividers=dividers;},[['toolbarOrder'],['toolbarDividers']])});
  toolbar.scrollLeft=toolbarScroll;
  groupControls?.positionMenu();
  rememberView();
  primeSearchValues();
}
function safeLink(value: string): boolean {
  try { return ['https:','http:','mailto:'].includes(new URL(value).protocol); } catch { return false; }
}
function cellValidation(s:Sheet,row:string,column:string){
  if(allTables(book).some(t=>t.sheet===s.id&&t.header===row&&t.columns.some(c=>c.column===column)))return;
  let assigned=s.validations.find(v=>v.rows.includes(row)&&v.columns.includes(column));
  if(!assigned&&book.pickerSources[`${s.id}:${column}`]!=='manual'){
    const previous=adjacentTableForCell(book,s,row,column)?.rows.at(-1);
    if(previous)assigned=s.validations.find(v=>v.rows.includes(previous)&&v.columns.includes(column));
  }
  if(!assigned)return;
  const units=book.references?.filter(r=>r.kind==='units')??[];
  if(!units.some(u=>u.table&&assigned.source.includes(u.table)||u.nameId&&assigned.source.includes(u.nameId)))return assigned;
  const strip=(ast:Ast):Ast|undefined=>{if(validationReference(book,ast,s.id)?.kind==='units')return;if(ast.kind==='call'&&ast.name==='VSTACK'){const args=ast.args.map(strip).filter((arg):arg is Ast=>!!arg);return args.length>1?{...ast,args}:args[0];}return ast;};
  const ast=strip(assigned.source.startsWith('{')?JSON.parse(assigned.source) as Ast:compile(assigned.source,book,s.id,row,column));return ast?{...assigned,source:JSON.stringify(ast)}:undefined;
}
function refreshDropdownControl():void{
  root.querySelectorAll('[data-cell-dropdown]').forEach(el=>el.remove());
  const s=sheet(),b=bounds(),cell=root.querySelector<HTMLElement>(`td[data-r="${selected.r}"][data-c="${selected.c}"]`);
  if(!cell||b.r1!==b.r2||b.c1!==b.c2||!editableReference()||!inGrid(selected.r,selected.c)||!cellValidation(s,s.rows[selected.r].id,s.columns[selected.c].id)||cell.querySelector('textarea'))return;
  const button=document.createElement('button');button.type='button';button.className='cell-dropdown-trigger';button.dataset.cellDropdown='';button.setAttribute('aria-label','Open cell dropdown');button.setAttribute('aria-haspopup','listbox');
  button.innerHTML=dropdownArrowHtml;
  button.onclick=e=>{e.stopPropagation();openCellDropdown(cell);};cell.append(button);
}
function writeLinkedCell(s:Sheet,row:string,column:string,binding:NonNullable<Cell['binding']>):void{
  expandAdjacentTable(book,s,row,column);
  const previous=getCell(s,row,column);
  s.cells[key(row,column)]={...previous,value:undefined,formula:undefined,original:undefined,calculation:previous.formula??previous.calculation,binding};
}
function openCellDropdown(cell?:HTMLElement,force=true,query?:string):void{
  closeCellDropdown?.();
  if(busy||!editableReference()||!inGrid(selected.r,selected.c))return;
  const s=sheet(),row=s.rows[selected.r].id,column=s.columns[selected.c].id,validation=cellValidation(s,row,column);
  cell??=root.querySelector<HTMLElement>(`td[data-r="${selected.r}"][data-c="${selected.c}"]`)??undefined;
  if(!validation||!cell||!commitDraft())return;
  const preferenceKey=`default:${s.id}:${column}`,listKey=`list:${s.id}:${column}`,previous=getCell(s,row,column);
  if(!force&&book.pickerSources[preferenceKey]==='manual'&&!previous.binding&&!previous.formula&&(previous.value===undefined||previous.value===null||previous.value==='')){
    syncDraft('',true,true);return;
  }
  const popup=document.createElement('div'),controller=new AbortController();
  popup.className='cell-dropdown';popup.setAttribute('aria-label','Cell dropdown');
  const close=()=>{controller.abort();popup.remove();if(closeCellDropdown===close)closeCellDropdown=undefined;};closeCellDropdown=close;
  try{
    engine.beginPass();const resolved=validationChoiceGroups(book,validation,row,column,engine),groups=resolved.filter((group,i)=>resolved.findIndex(g=>g.id===group.id)===i);
    if(!groups.length)throw Error('No dropdown sources are configured.');
    const remembered=book.pickerSources[preferenceKey]??book.pickerSources[`${s.id}:${column}`];
    const linked=groups.filter(group=>group.choices.some(choice=>choice.binding?.table===previous.binding?.table&&choice.binding?.row===previous.binding?.row&&choice.binding?.column===previous.binding?.column&&previous.binding));
    let active=previous.binding?(linked.find(g=>g.id===remembered)??linked[0]??groups.find(g=>g.target?.table===previous.binding!.table&&g.target?.column===previous.binding!.column))?.id:previous.value!==undefined&&previous.value!==null&&previous.value!==''&&!previous.formula?'manual':undefined;
    active??=remembered==='manual'||groups.some(g=>g.id===remembered)?remembered:groups[0].id;
    let browsing=active!=='manual'?active:groups.some(g=>g.id===book.pickerSources[listKey])?book.pickerSources[listKey]:groups[0].id;
    const remember=(source:string)=>{
      if(book.pickerSources[preferenceKey]===source&&book.pickerSources[listKey]===browsing)return;
      book.pickerSources[preferenceKey]=source;book.pickerSources[listKey]=browsing;changed('Remember dropdown source',false,false,capturePatch(book,[['pickerSources']]));renderStatus();
    };
    const sourceCheck='<svg class="dropdown-source-check" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path vector-effect="non-scaling-stroke" d="m5 12 4 4L19 6"/></svg>';
    popup.innerHTML=`<div class="dropdown-source-tabs"><div role="tablist" aria-label="Dropdown sources"></div>${dropdownManualActionHtml}<button type="button" class="dropdown-add-source" aria-label="Choose another source" title="Choose another source…">+</button></div><div class="dropdown-panel" role="tabpanel"></div>`;
    const tabs=popup.querySelector<HTMLElement>('[role="tablist"]')!,panel=popup.querySelector<HTMLElement>('[role="tabpanel"]')!;
    const manual=popup.querySelector<HTMLButtonElement>('.dropdown-manual-action')!,options=groups.map(g=>({id:g.id,name:g.name==='Dropdown'?'Options':g.name}));
    const position=()=>{
      if(!popup.isConnected)return;
      cell=root.querySelector<HTMLElement>(`td[data-r="${selected.r}"][data-c="${selected.c}"]`)??undefined;
      const grid=root.querySelector<HTMLElement>('#grid-scroll')!.getBoundingClientRect(),anchor=cell?.getBoundingClientRect();
      if(!anchor||anchor.bottom<=grid.top||anchor.top>=grid.bottom||anchor.right<=grid.left||anchor.left>=grid.right){close();return;}
      const rect=cell!.getBoundingClientRect(),available=Math.max(rect.top,innerHeight-rect.bottom)-12;
      popup.style.width=Math.min(Math.max(320,rect.width),innerWidth-12)+'px';popup.style.maxHeight=Math.max(120,Math.min(360,available))+'px';
      const bounds=popup.getBoundingClientRect();popup.style.left=Math.max(6,Math.min(rect.left,innerWidth-bounds.width-6))+'px';popup.style.top=(innerHeight-rect.bottom>=bounds.height+6?rect.bottom+3:Math.max(6,rect.top-bounds.height-3))+'px';
    };
    const choose=(choice:DropdownChoice)=>{
      remember(browsing);
      close();
      mutate('Choose dropdown option',()=>{
        if(!s.rows.some(r=>r.id===row)||!s.columns.some(c=>c.id===column)||cellValidation(s,row,column)?.id!==validation.id)throw Error('The dropdown target changed. Open it again.');
        if(choice.binding)writeLinkedCell(s,row,column,choice.binding);
        else writeGridCell(book,s,row,column,String(choice.raw??''),typeof choice.raw==='string');
      });
      root.querySelector<HTMLElement>('#grid-scroll')?.focus({preventScroll:true});
    };
    const draw=()=>{
      tabs.replaceChildren();
      for(const [i,option] of options.entries()){
        const button=document.createElement('button');button.type='button';button.id=`dropdown-source-tab-${i}`;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(active===option.id));button.setAttribute('aria-controls','dropdown-source-panel');button.tabIndex=browsing===option.id?0:-1;button.innerHTML=`<span>${esc(option.name)}</span>${sourceCheck}`;
        button.onclick=()=>{
          active=browsing=option.id;remember(active);
          draw();const selectedTab=tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]');selectedTab?.focus({preventScroll:true});selectedTab?.scrollIntoView({block:'nearest',inline:'nearest'});
        };
        tabs.append(button);
      }
      manual.setAttribute('aria-pressed',String(active==='manual'));
      panel.id='dropdown-source-panel';panel.setAttribute('aria-labelledby',`dropdown-source-tab-${options.findIndex(o=>o.id===browsing)}`);
      {
        const group=groups.find(g=>g.id===browsing)!;
        mountDropdownOptions(panel,{choices:group.choices,value:choice=>choice.value,name:group.name,choose,position,empty:'No available options. Edit the source DD.',
          selected:choice=>{const previous=getCell(s,row,column);return!!choice.binding&&previous.binding?.table===choice.binding.table&&previous.binding?.row===choice.binding.row&&previous.binding?.column===choice.binding.column;}});
        manual.onclick=()=>{remember('manual');close();syncDraft(cellText(current(),s,selected.r,selected.c),true,true);};
      }
      position();
    };
    popup.querySelector<HTMLButtonElement>('.dropdown-add-source')!.onclick=()=>{close();openDropdownAssignment();};
    popup.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();root.querySelector<HTMLElement>('#grid-scroll')?.focus({preventScroll:true});return;}
      const focused=document.activeElement as HTMLElement|null;
      if(focused?.getAttribute('role')==='tab'&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
        e.preventDefault();const at=options.findIndex(o=>o.id===browsing),next=e.key==='Home'?0:e.key==='End'?options.length-1:(at+(e.key==='ArrowRight'?1:-1)+options.length)%options.length;
        tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].click();
      }else{
        const search=panel.querySelector<HTMLInputElement>('input')!,list=panel.querySelector<HTMLElement>('[role="listbox"]')!;
        dropdownOptionsKey(e,search,list);
      }
      e.stopPropagation();
    };
    draw();document.body.append(popup);position();
    document.addEventListener('pointerdown',e=>{if(!popup.contains(e.target as Node)&&!cell!.contains(e.target as Node))close();},{capture:true,signal:controller.signal});
    document.addEventListener('scroll',e=>{if(!popup.contains(e.target as Node))position();},{capture:true,signal:controller.signal});
    window.addEventListener('resize',position,{signal:controller.signal});
    if(query!==undefined){
      const search=panel.querySelector<HTMLInputElement>('input')!;search.value=query;search.dispatchEvent(new Event('input',{bubbles:true}));search.focus({preventScroll:true});
    }else if(matchMedia('(pointer:fine)').matches)panel.querySelector<HTMLElement>('input,textarea')?.focus({preventScroll:true});
  }catch(e){close();flash(`Dropdown could not open: ${e instanceof Error?e.message:String(e)}`);}
}
function openCellDatePicker(cell:HTMLElement):boolean{
  const s=sheet(),row=s.rows[Number(cell.dataset.r)].id,column=s.columns[Number(cell.dataset.c)].id,previous=getCell(s,row,column);
  if(!['date','date-compact'].includes(previous.format?.number??'')||allTables(book).some(t=>t.sheet===s.id&&t.header===row&&t.columns.some(c=>c.column===column)))return false;
  const context=dateFormatContext(engine,book,s.id,row,previous);
  if(!context.enabled)return false;
  if(busy||!editableReference()||!commitDraft())return true;
  closeCellDropdown?.();
  const value=scalar(engine.cell(s.id,row,column)),iso=typeof value==='number'?excelDateText(value):typeof value==='string'?parseDateInput(value,context.year,previous.format?.number==='date-compact'):undefined;
  const initial=typeof iso==='string'?iso:typeof iso==='number'?excelDateText(iso):'';
  const popup=document.createElement('div'),controller=new AbortController();
  popup.className='cell-dropdown cell-date-picker';popup.setAttribute('role','group');popup.setAttribute('aria-label','Date picker');
  popup.innerHTML=`<div class="dropdown-panel"><form id="cell-date-form"><div class="button-row"><input id="cell-date" aria-label="Date" type="date" min="1900-01-01" max="9999-12-31" value="${esc(initial??'')}" required><button id="clear-cell-date" type="button" aria-label="Clear date">Clear</button><button id="close-cell-date" class="icon-button" type="button" aria-label="Close date picker">${toolbarIcon('close')}</button></div><p id="cell-date-error" role="alert" hidden></p></form></div>`;
  const input=popup.querySelector<HTMLInputElement>('#cell-date')!,message=popup.querySelector<HTMLElement>('#cell-date-error')!;
  const close=()=>{controller.abort();popup.remove();if(closeCellDropdown===close)closeCellDropdown=undefined;};
  closeCellDropdown=close;
  const position=()=>{
    const r=s.rows.findIndex(r=>r.id===row),c=s.columns.findIndex(c=>c.id===column),anchor=root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);
    if(!anchor){close();return;}
    const rect=anchor.getBoundingClientRect(),viewport=visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
    popup.style.width=Math.min(336,width-12)+'px';const box=popup.getBoundingClientRect();
    popup.style.left=Math.max(left+6,Math.min(rect.left,left+width-box.width-6))+'px';
    popup.style.top=Math.max(top+6,Math.min(rect.bottom+4,top+height-box.height-6))+'px';
  };
    const apply=(clear=false)=>{
      if(!clear&&(!input.value||!input.reportValidity()))return;
      const serial=clear?undefined:parseDateInput(input.value);
      if(!clear&&serial===undefined){message.hidden=false;message.textContent='Choose a valid date.';position();return;}
      if(mutate(clear?'Clear date':'Choose date',()=>{
        if(!s.rows.some(r=>r.id===row)||!s.columns.some(c=>c.id===column)||!dateFormatContext(engine,book,s.id,row,getCell(s,row,column)).enabled)throw Error('The date target changed. Open it again.');
        writeGridCell(book,s,row,column,clear?'':String(serial));
      }))close();
    };
    popup.querySelector<HTMLFormElement>('form')!.onsubmit=e=>{e.preventDefault();apply();};
    input.onchange=()=>{if(input.value)apply();};
    popup.querySelector<HTMLButtonElement>('#clear-cell-date')!.onclick=()=>apply(true);
    popup.querySelector<HTMLButtonElement>('#close-cell-date')!.onclick=close;
    popup.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();cell.focus({preventScroll:true});}e.stopPropagation();};
    popup.addEventListener('focusout',e=>{if(e.relatedTarget instanceof Node&&!popup.contains(e.relatedTarget)&&!cell.contains(e.relatedTarget))close();});
    document.addEventListener('pointerdown',e=>{if(!popup.contains(e.target as Node)&&!cell.contains(e.target as Node))close();},{capture:true,signal:controller.signal});
    document.addEventListener('scroll',position,{capture:true,signal:controller.signal});
    window.addEventListener('resize',position,{signal:controller.signal});visualViewport?.addEventListener('resize',position,{signal:controller.signal});
    document.body.append(popup);position();
    input.focus({preventScroll:true});
    if(input.showPicker)try{input.showPicker();}catch(error){message.hidden=false;message.textContent=`Calendar could not open automatically. Use the date field. ${error instanceof Error?error.message:String(error)}`;position();}
  return true;
}
function bindRowControls():void {
  root.querySelectorAll<HTMLElement>('td[data-r]').forEach(el=>{
    el.onpointerdown=e=>{
      if((e.target as HTMLElement).closest('a,textarea,input,button'))return;
      if(!inGrid(Number(el.dataset.r),Number(el.dataset.c)))return;
      closeCellDropdown?.();
      if(!commitDraft())return;
      beginSelection(e,'cells');
      selected={r:Number(el.dataset.r),c:Number(el.dataset.c)};if(!e.shiftKey||selectionKind!=='cells')anchor={...selected};selectionKind='cells';
      if(touchSelection){e.preventDefault();touchPointer=e.pointerId;(root.querySelector('#grid-scroll') as HTMLElement).setPointerCapture(e.pointerId);}
      refreshSelection();(root.querySelector('#grid-scroll') as HTMLElement).focus({preventScroll:true});
    };
    el.onclick=e=>{if(!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!extraSelections.length&&e.detail<2&&!(e.target as HTMLElement).closest('a,textarea,input,button')&&anchor.r===selected.r&&anchor.c===selected.c&&!openCellDatePicker(el))openCellDropdown(el,false);};
    el.ondblclick=()=>{closeCellDropdown?.();openEditor();};
  });
  root.querySelector<HTMLButtonElement>('[data-fill-handle]')?.addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();if(!commitDraft())return;const range=requireRectangle('Fill');if(!range)return;extraSelections=[];anchor={r:range.r1,c:range.c1};selected={r:range.r2,c:range.c2};fillSource={...range};fillPointer=e.pointerId;(root.querySelector('#grid-scroll') as HTMLElement).setPointerCapture(e.pointerId);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-row]').forEach(el=>el.onclick=e=>{
    e.stopPropagation();if(!commitDraft())return;const at=Number(el.dataset.insertRow),s=sheet();
    if(!editableReference()){flash('This is a read-only live list. Edit its source table.');return;}
    if(movingRows){dropRows(movingRows,at);return;}
    requestInsert('row',at,Number(el.closest<HTMLElement>('[data-row-select]')!.dataset.rowSelect));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-row]').forEach(el=>{
    const index=Number(el.closest<HTMLElement>('[data-row-select]')!.dataset.rowSelect),boundary=Number(el.dataset.insertRow);
    bindMoveBoundaryPreview(el,'row',boundary,index,boundary>index);
  });
  root.querySelectorAll<HTMLElement>('[data-row-select]').forEach(el=>{
    const select=(e:MouseEvent)=>{
      if((e.target as HTMLElement).closest('button')||!commitDraft())return;
      headerSelection(e,'row',Number(el.dataset.rowSelect));
    };
    el.onclick=select;
    el.querySelector<HTMLElement>('.row-index')!.onclick=e=>{e.stopPropagation();select(e);};
  });
  root.querySelectorAll<HTMLButtonElement>('[data-move-row]').forEach(el=>{
    const ids=()=>{const at=prepareAxisOperation('row',Number(el.dataset.moveRow));const indices=selectedAxisIndices('row'),block=selectionMode()==='rows'&&indices.includes(at),s=sheet();return summaryMoveMembers(selectionScope?{...s,groups:s.groups.filter(g=>g.table===selectionScope)}:s,'row',s.rows.filter((r,i)=>(block?indices.includes(i):i===at)&&(!gridReference()||gridReference()!.rows.includes(r.id))).map(r=>r.id),selectionScope);};
    el.onclick=e=>{e.stopPropagation();if(!commitDraft()||!sheetAxisSelectionAllowed('Moving rows'))return;try{clearMovePreview();movingRows=movingRows?undefined:ids();movingColumns=undefined;render();}catch(error){flash(error);}};
    el.ondragstart=e=>{e.stopPropagation();if(!commitDraft()||!sheetAxisSelectionAllowed('Moving rows')){e.preventDefault();return;}try{clearMovePreview();movingRows=ids();movingColumns=undefined;paintMoving();e.dataTransfer?.setData('application/x-fnt-rows',JSON.stringify(movingRows));if(e.dataTransfer)e.dataTransfer.effectAllowed='move';}catch(error){e.preventDefault();flash(error);}};
    el.ondragend=()=>{movingRows=undefined;paintMoving();root.querySelectorAll('.row-drop-before,.row-drop-after').forEach(n=>n.classList.remove('row-drop-before','row-drop-after'));};
  });
  root.querySelectorAll<HTMLElement>('[data-row-select]').forEach(el=>{
    el.ondragover=e=>{if(!e.dataTransfer?.types.includes('application/x-fnt-rows'))return;e.preventDefault();root.querySelectorAll('.row-drop-before,.row-drop-after').forEach(n=>n.classList.remove('row-drop-before','row-drop-after'));const after=e.clientY>=el.getBoundingClientRect().top+el.getBoundingClientRect().height/2;el.classList.add(after?'row-drop-after':'row-drop-before');const index=Number(el.dataset.rowSelect);showMovePreview('row',index+Number(after),index,after);};
    el.ondrop=e=>{const value=e.dataTransfer?.getData('application/x-fnt-rows');if(!value)return;e.preventDefault();try{const ids:unknown=JSON.parse(value);if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Invalid row drag.');dropRows(ids,Number(el.dataset.rowSelect)+(el.classList.contains('row-drop-after')?1:0));}catch(error){flash(error);}};
  });
  refreshDropdownControl();
}
function bind(): void {
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(el => el.onclick = () => { void action(el.dataset.action!); });
  tableSelectionControl=mountTableSelection(root.querySelector('.table-selection-control')!,{enabled:()=>tableSelectionMode,target:()=>tableSelectionTarget,choices:[{id:'',name:'Auto'},...allTables(book).filter(table=>table.sheet===sheetId&&(!gridReference()||table.id===gridReference()?.table?.id)).map(table=>({id:table.id,name:table.name}))],choose:id=>{
    tableSelectionTarget=id||undefined;tableSelectionMode=true;refreshTableSelectionControl();rememberView();
  }});
  refreshTableSelectionControl();
  bindTabs();
  const dd=root.querySelector<HTMLButtonElement>('.reference-manager')!;
  dd.setAttribute('aria-pressed',String(!!referenceId));dd.title=referenceId?'Close DD':'Open DD';dd.setAttribute('aria-label',referenceId?'Close DD':'Open DD');
  for(const shortcut of formattingShortcuts){
    const button=root.querySelector<HTMLButtonElement>(`[data-action="${shortcut.action}"]`)!;
    const mac=/Mac|iPhone|iPad/.test(navigator.platform);
    setShortcutHint(button,shortcut.label,[mac?'Cmd':'Ctrl',...(shortcut.alt?[mac?'Option':'Alt']:[]),shortcut.key.toUpperCase()],`Control+${shortcut.alt?'Alt+':''}${shortcut.key} Meta+${shortcut.alt?'Alt+':''}${shortcut.key}`);
  }
  const modifier=/Mac|iPhone|iPad/.test(navigator.platform)?'Cmd':'Ctrl';
  for(const [action,label,key] of [['save','Save','s'],['undo','Undo','z'],['redo','Redo','y'],['find','Find / replace','f'],['copy','Copy','c'],['cut','Cut','x'],['paste','Paste','v'],['select-all','Select all cells','a']]){
    setShortcutHint(root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`),label,[modifier,key.toUpperCase()],`Control+${key} Meta+${key}`);
  }
  const scrolling=root.querySelector<HTMLElement>('#grid-scroll')!;let frame=0;
  closeMoveAutoScroll=mountMoveAutoScroll(scrolling);
  scrolling.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;drawRowWindow?.();stickyTableHeaders?.draw();paintMovePreview();});},{passive:true});
  scrolling.addEventListener('pointerleave',clearMovePreview);
  scrolling.addEventListener('dragover',e=>{
    const axis=e.dataTransfer?.types.includes('application/x-fnt-rows')?'row':e.dataTransfer?.types.includes('application/x-fnt-columns')?'column':undefined;
    if(!axis)return;
    const group=moveGroupAt(e.target as Element,axis,e.clientX,e.clientY);
    if(group){e.preventDefault();e.stopPropagation();showGroupMovePreview(axis,group);return;}
    const cell=(e.target as Element).closest<HTMLElement>('td[data-r][data-c]');if(!cell)return;e.preventDefault();
    const rect=cell.getBoundingClientRect(),index=Number(axis==='row'?cell.dataset.r:cell.dataset.c),after=axis==='row'?e.clientY>=rect.top+rect.height/2:e.clientX>=rect.left+rect.width/2;
    showMovePreview(axis,index+Number(after),index,after);
  },{capture:true});
  scrolling.addEventListener('drop',e=>{
    const axis=e.dataTransfer?.types.includes('application/x-fnt-rows')?'row':e.dataTransfer?.types.includes('application/x-fnt-columns')?'column':undefined;
    const group=axis?moveGroupAt(e.target as Element,axis,e.clientX,e.clientY):undefined;
    const target:typeof movePreview=group?{axis:axis!,groupId:group,boundary:0,index:0,after:false}:movePreview;if(!target)return;
    const cell=(e.target as Element).closest<HTMLElement>('td[data-r][data-c]');if(!cell&&!target.groupId)return;
    const value=e.dataTransfer?.getData(target.axis==='row'?'application/x-fnt-rows':'application/x-fnt-columns');if(!value)return;
    e.preventDefault();e.stopPropagation();
    try{const ids:unknown=JSON.parse(value);if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Invalid move drag.');if(target.groupId)dropIntoGroup(target.axis,ids,target.groupId);else if(target.axis==='row')dropRows(ids,target.boundary);else dropColumns(ids,target.boundary);}catch(error){clearMovePreview();flash(error);}
  },{capture:true});
  scrolling.addEventListener('pointerover',e=>{
    const axis=movingRows?'row':movingColumns?'column':undefined;if(!axis)return;
    const group=moveGroupAt(e.target as Element,axis,e.clientX,e.clientY);if(group)showGroupMovePreview(axis,group);
  });
  scrolling.addEventListener('click',e=>{
    const axis=movingRows?'row':movingColumns?'column':undefined;if(!axis)return;
    const group=moveGroupAt(e.target as Element,axis,e.clientX,e.clientY);if(!group)return;
    e.preventDefault();e.stopPropagation();dropIntoGroup(axis,axis==='row'?movingRows!:movingColumns!,group);
  },{capture:true});
  root.querySelector('#grid-scroll')!.addEventListener('pointermove',e=>{
    const event=e as PointerEvent;if(fillSource&&event.pointerId===fillPointer){
      event.preventDefault();const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('td[data-r]');
      if(cell){anchor={r:Math.min(fillSource.r1,Number(cell.dataset.r)),c:Math.min(fillSource.c1,Number(cell.dataset.c))};selected={r:Math.max(fillSource.r2,Number(cell.dataset.r)),c:Math.max(fillSource.c2,Number(cell.dataset.c))};scheduleSelectionPaint();}return;
    }
    if(!touchSelection||event.pointerId!==touchPointer)return;
    event.preventDefault();const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('td[data-r]');
    if(cell){const r=Number(cell.dataset.r),c=Number(cell.dataset.c);if(selected.r!==r||selected.c!==c){selected={r,c};scheduleSelectionPaint();}}
  });
  const endTouch=()=>{touchPointer=undefined;touchSelection=false;root.querySelector('.grid')?.classList.remove('touch-select');};
  root.querySelector('#grid-scroll')!.addEventListener('pointerup',()=>{
    if(selectionPaintFrame){cancelAnimationFrame(selectionPaintFrame);selectionPaintFrame=0;refreshSelection();}
    endTouch();if(fillSource){const source=fillSource,target=bounds();fillSource=undefined;fillPointer=undefined;if(JSON.stringify(source)!==JSON.stringify(target))mutate('Drag fill',()=>fillCells(book,sheet(),source,confineRange(target)));}
  });
  root.querySelector('#grid-scroll')!.addEventListener('pointercancel',()=>{endTouch();fillSource=undefined;fillPointer=undefined;});
  root.querySelectorAll<HTMLElement>('[data-col]').forEach(el=>{
    const select=(e:MouseEvent)=>{
      if((e.target as HTMLElement).closest('button')||!commitDraft())return;
      headerSelection(e,'column',Number(el.dataset.col));
    };
    el.onclick=select;
    el.querySelector<HTMLElement>('.column-index')!.onclick=e=>{e.stopPropagation();select(e);};
    el.ondblclick=e=>{if((e.target as HTMLElement).closest('button')||tableSelectionMode&&(e.target as HTMLElement).closest('.column-index'))return;selected={r:Math.min(sheet().rows.length-1,Math.max(1,Number(root.querySelector<HTMLInputElement>('#row-jump')!.value)-1)),c:Number(el.dataset.col)};anchor={...selected};selectionKind='cells';renameSelectedColumn();};
    el.ondragover=e=>{if(!e.dataTransfer?.types.includes('application/x-fnt-columns'))return;e.preventDefault();root.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));const after=e.clientX>=el.getBoundingClientRect().left+el.getBoundingClientRect().width/2;el.classList.add(after?'drop-after':'drop-before');const index=Number(el.dataset.col);showMovePreview('column',index+Number(after),index,after);};
    el.ondrop=e=>{
      e.preventDefault();const data=e.dataTransfer?.getData('application/x-fnt-columns');if(!data)return;
      try{const ids:unknown=JSON.parse(data);if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Invalid column drag.');dropColumns(ids,Number(el.dataset.col)+(el.classList.contains('drop-after')?1:0));}catch(error){flash(error);}
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-move-column]').forEach(el=>{
    el.onpointerdown=()=>el.focus({preventScroll:true});
    const ids=()=>{const c=prepareAxisOperation('column',Number(el.dataset.moveColumn));const indices=selectedAxisIndices('column'),block=selectionMode()==='columns'&&indices.includes(c),s=sheet();return summaryMoveMembers(selectionScope?{...s,groups:s.groups.filter(g=>g.table===selectionScope)}:s,'column',s.columns.filter((column,i)=>(block?indices.includes(i):i===c)&&(!gridReference()||gridReference()!.columns.includes(column.id))).map(column=>column.id),selectionScope);};
    el.onclick=e=>{e.stopPropagation();if(!commitDraft()||!editableReference()||!sheetAxisSelectionAllowed('Moving columns'))return;try{clearMovePreview();movingRows=undefined;movingColumns=movingColumns?undefined:ids();if(movingColumns){if(selectionMode()!=='columns'){extraSelections=[];const at=sheet().columns.findIndex(c=>c.id===movingColumns![0]);anchor={r:0,c:at};selected={r:sheet().rows.length-1,c:at};selectionKind='columns';}renderedTarget=`${sheetId}:${selected.r}`;}render();}catch(error){flash(error);}};
    el.ondragstart=e=>{e.stopPropagation();if(!commitDraft()||!editableReference()||!sheetAxisSelectionAllowed('Moving columns')){e.preventDefault();return;}try{clearMovePreview();movingColumns=ids();movingRows=undefined;paintMoving();e.dataTransfer?.setData('application/x-fnt-columns',JSON.stringify(movingColumns));if(e.dataTransfer)e.dataTransfer.effectAllowed='move';}catch(error){e.preventDefault();flash(error);}};
    el.ondragend=()=>{movingColumns=undefined;paintMoving();root.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));};
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-column]').forEach(el=>el.onclick=e=>{
    e.stopPropagation();if(!commitDraft())return;const at=Number(el.dataset.insertColumn);
    if(movingColumns){dropColumns(movingColumns,at);return;}
    if(!editableReference()){flash('Edit the live list source instead.');return;}
    const host=el.closest<HTMLElement>('[data-col]');requestInsert('column',at,host?Number(host.dataset.col):0);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-column]').forEach(el=>{
    const host=el.closest<HTMLElement>('[data-col]'),index=host?Number(host.dataset.col):-1,boundary=Number(el.dataset.insertColumn);
    bindMoveBoundaryPreview(el,'column',boundary,index,index<0||boundary>index);
  });
  bindResizeControls();
  document.querySelector('#formula-form')!.addEventListener('submit',e=>{
    e.preventDefault(); const text=(document.querySelector('#formula') as HTMLInputElement).value;
    applyInput(text);
  });
  document.querySelector<HTMLInputElement>('#formula')!.oninput=e=>syncDraft((e.target as HTMLInputElement).value);
  document.querySelector<HTMLInputElement>('#formula')!.onkeydown=editKey;
  document.querySelector<HTMLInputElement>('#row-jump')!.onchange=e=>{
    if(!commitDraft())return;const s=sheet(),view=gridReference(),number=Number((e.target as HTMLInputElement).value),count=view?.rows.length??s.rows.length;if(!Number.isInteger(number)||number<1||number>count){flash(`Enter a row between 1 and ${count}.`);return;}selected.r=view?s.rows.findIndex(r=>r.id===view.rows[number-1]):number-1;anchor={...selected};selectionKind='cells';scrollTarget=selected.r;page=Math.floor(selected.r/60);render();
  };
  document.querySelector('#title')!.addEventListener('click',()=>askText('Rename workbook',book.title,name=>mutateMetadata('Rename workbook',()=>{book.title=name;},[['title']],false,false)));
}
function scheduleSelectionPaint():void{
  if(!selectionPaintFrame)selectionPaintFrame=requestAnimationFrame(()=>{selectionPaintFrame=0;refreshSelection();});
}
function inlineSheetName(el:HTMLElement):void {
  const s=allSheets(book).find(s=>s.id===el.dataset.sheet)!;el.draggable=false;
  const input=document.createElement('input');input.value=s.name;input.setAttribute('aria-label','Rename sheet');input.style.width='130px';el.replaceChildren(input);input.focus();input.select();
  let committed=false;
  const commit=()=>{if(committed)return;committed=true;const name=input.value.trim();if(name&&name!==s.name)mutateMetadata('Rename sheet',()=>{if(allSheets(book).some(x=>x.id!==s.id&&x.name.toLowerCase()===name.toLowerCase()))throw Error('Sheet name is already in use.');s.name=name;},[[...sheetPath(s),'name']],true);render();};
  input.onclick=e=>e.stopPropagation();input.onblur=commit;input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape'){committed=true;render();}};
}
let navigationSaving:Promise<void>=Promise.resolve(),navigationDirty=false,navigationError:unknown;
function refreshSelection(closeDropdown=true):void {
  if(closeDropdown)closeCellDropdown?.();
  if(selectionKind==='cells')selectionScope=tableSelectionMode?tableAt(book,sheetId,sheet().rows[selected.r].id,sheet().columns[selected.c].id)?.id:undefined;
  const grid=root.querySelector('.grid');grid?.classList.remove('selection-cells','selection-rows','selection-columns');grid?.classList.add(`selection-${selectionKind}`);
  renderedTarget=`${sheetId}:${selected.r}`;
  const b=bounds(),ranges=currentSelections();
  root.querySelectorAll<HTMLElement>('td[data-r]').forEach(el=>{
    const r=Number(el.dataset.r),c=Number(el.dataset.c),paint=selectionPaintPosition(r,c,Number(el.dataset.displayR??el.dataset.r),Number(el.dataset.displayC??el.dataset.c));
    el.classList.toggle('selected',ranges.some(b=>paint.r>=b.r1&&paint.r<=b.r2&&paint.c>=b.c1&&paint.c<=b.c2));
    el.classList.toggle('active',r===selected.r&&c===selected.c);
  });
  root.querySelectorAll<HTMLElement>('[data-col]').forEach(el=>{const c=Number(el.dataset.col);el.classList.toggle('column-selected',ranges.some(b=>c>=b.c1&&c<=b.c2));});
  root.querySelectorAll<HTMLElement>('[data-row-select]').forEach(el=>{const r=Number(el.dataset.rowSelect);el.classList.toggle('row-selected',ranges.some(b=>r>=b.r1&&r<=b.r2));});
  const fill=root.querySelector('[data-fill-handle]'),last=root.querySelector(`td[data-r="${b.r2}"][data-c="${b.c2}"]`);if(fill&&last&&!last.querySelector('textarea'))last.append(fill);
  refreshDropdownControl();
  const formula=root.querySelector<HTMLInputElement>('#formula');if(formula)formula.value=inGrid(selected.r,selected.c)?inputText(current()):'';
  const address=root.querySelector('.address');if(address)address.textContent=`${letters(selected.c)}${selected.r+1}`;
  const count=root.querySelector('.selection-count');if(count)count.textContent=`${selectionCount(ranges)} cells`;
  refreshTableSelectionControl();
  const visited=tableAt(book,sheetId,sheet().rows[selected.r].id,sheet().columns[selected.c].id)?.id;
  if(visited!==lastVisitedTable){
    lastVisitedTable=visited;
    if(visited){
      const previous=book.tableActivity?.[visited]?.visits??0,id=book.id;
      recordTableVisit(book,visited);navigationDirty=true;
      navigationSaving=navigationSaving.then(async()=>{
        const visits=await store.visit(id,visited,previous);
        if(book.id===id)book.tableActivity={...book.tableActivity,[visited]:{...book.tableActivity?.[visited],visits:Math.max(book.tableActivity?.[visited]?.visits??0,visits)}};
      }).catch(e=>{navigationError=e;status='Navigation preferences NOT SAVED';flash(e);});
    }
  }
  renderStatus();
  rememberView();
}
function updateCalculationState():void{
  const slot=root.querySelector<HTMLElement>('#calculation-state');if(!slot||!book)return;
  const s=sheet(),row=s.rows[selected.r].id,column=s.columns[selected.c].id,cell=getCell(s,row,column),table=tableAt(book,s.id,row,column);
  const possible=!!cell.calculation||!!table&&table.header!==row&&table.rows.some(id=>!!(getCell(s,id,column).formula??getCell(s,id,column).calculation));
  const diagnosis=quantityDiagnostic(book,s,row,column,engine);
  slot.innerHTML=cell.formula||possible?`<span class="${diagnosis?'bad':''}" title="${esc(diagnosis??(cell.formula?'Calculated from the editable formula':'Manual value; a calculation can be restored'))}">${draft!==undefined?'Editing':diagnosis?'Check units':cell.formula?'Calculated':'Manual'}</span>${!cell.formula&&possible&&draft===undefined?'<button type="button" aria-label="Restore calculation" title="Restore calculation" id="restore-calculation">Restore</button>':''}`:'';
  if(diagnosis&&draft===undefined){
    slot.querySelector('span')!.outerHTML='<button type="button" class="bad" id="quantity-diagnostic">Check units</button>';
    slot.querySelector<HTMLButtonElement>('#quantity-diagnostic')!.onclick=()=>dialog('Quantity calculation',`<p>${esc(diagnosis)}</p><p>The formula and its result are unchanged. Edit the inputs, add a conversion, or enter grams manually. Restore recovers the prior calculation.</p><button id="quantity-sources">Lists & conversions</button>`,d=>{d.querySelector<HTMLButtonElement>('button#quantity-sources')!.onclick=()=>openReferences();});
  }
  const restore=slot.querySelector<HTMLButtonElement>('#restore-calculation');
  if(restore)restore.onclick=()=>{
    if(busy||!commitDraft())return;
    try{
      const options=columnCalculations(book,s,row,column,engine);
      if(!options.length)throw Error('No matching calculation remains. Enter a formula, or restore a recovery checkpoint.');
      const apply=(at:number)=>mutate('Restore calculation',()=>restoreCalculation(book,s,row,column,options[at].formula));
      if(options.length===1){apply(0);return;}
      dialog('Choose column calculation',`<p>This column has different formulas. Choose explicitly; existing values are not changed until Restore.</p><select id="calculation-source">${options.map((o,i)=>`<option value="${i}">From row ${s.rows.findIndex(r=>r.id===o.row)+1}</option>`).join('')}</select><pre id="calculation-preview"></pre><button id="apply-calculation" class="primary">Restore</button>`,d=>{
        const source=d.querySelector<HTMLSelectElement>('#calculation-source')!,preview=()=>{d.querySelector('#calculation-preview')!.textContent=displayFormula(options[Number(source.value)].formula,book);};
        source.onchange=preview;preview();d.querySelector<HTMLButtonElement>('#apply-calculation')!.onclick=()=>{apply(Number(source.value));d.close();};
      });
    }catch(e){flash(e);}
  };
}
function dropColumns(ids:string[],boundary:number):void {
  if(!sheetAxisSelectionAllowed('Moving columns'))return;
  if(!editableReference()){flash('Edit the live list source instead.');return;}
  const owner=scopedSelectionTable();if(owner){runTableEdit(owner.id,'column',{kind:'move',ids,boundary:projectedBoundary(owner.id,'column',boundary)},'Move table columns');return;}
  movingColumns=undefined;
  extraSelections=[];
  mutate('Move columns',()=>{
    const group=moveTargetGroups(sheet(),'column',ids,boundary).filter(g=>g.collapsed).sort((a,b)=>a.members.length-b.members.length)[0];
    const at=group?moveIntoGroup(book,sheet(),'column',ids,group.id):moveColumns(book,sheet(),ids,boundary);anchor={r:0,c:at};selected={r:sheet().rows.length-1,c:at+ids.length-1};selectionKind='columns';
    renderedTarget=`${sheetId}:${selected.r}`;scrollTarget=undefined;
  });
  bindResizeControls();
}
function syncDraft(value:string,focus=false,literal=false):void {
  if(busy){flash('Wait for the current save or sync to finish.');return;}
  if(!editableReference()||gridReference()?.error){flash('This source is read-only or unavailable. Change its connection or edit the original table.');return;}
  selectionKind='cells';
  draft=value;
  draftLiteral=literal;
  const formula=root.querySelector<HTMLInputElement>('#formula');if(formula&&formula.value!==value)formula.value=value;
  const cell=root.querySelector<HTMLElement>(`td[data-r="${selected.r}"][data-c="${selected.c}"]`);
  if(expandedEditor){
    if(expandedEditor.input.value!==value)expandedEditor.input.value=value;
    if(focus)expandedEditor.input.focus({preventScroll:true});
  }else if(cell){
    let editor=cell.querySelector<HTMLTextAreaElement>('.cell-inline-editor');
    if(!editor){
      editor=document.createElement('textarea');editor.className='cell-inline-editor';editor.setAttribute('aria-label','Edit selected cell');editor.spellcheck=false;editor.rows=1;
      editor.oninput=()=>syncDraft(editor!.value,false,draftLiteral);editor.onkeydown=editKey;cell.replaceChildren(editor);
    }
    if(editor.value!==value)editor.value=value;
    if(focus){editor.focus();editor.setSelectionRange(value.length,value.length);}
  }
  renderStatus();
}
function editKey(e:KeyboardEvent):void {
  if(e.isComposing||e.keyCode===229)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();draft=undefined;draftLiteral=false;render();(root.querySelector('#grid-scroll') as HTMLElement).focus();return;}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey){
    e.preventDefault();e.stopPropagation();if(!commitDraft())return;extraSelections=[];navigateSelection(e.key);root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});return;
  }
  if(e.key==='Enter'&&!e.shiftKey||e.key==='Tab'){
    e.preventDefault();e.stopPropagation();
    if(!commitDraft())return;
    if(e.key==='Tab')navigateSelection(e.shiftKey?'ArrowLeft':'ArrowRight');
    (root.querySelector('#grid-scroll') as HTMLElement).focus();
  }
}
function navigateSelection(key:string,extend=false):void{
  if(!navigationRows.length||!navigationColumns.length)return;
  const s=sheet(),display=groupProjection?.display(s.rows[selected.r].id,s.columns[selected.c].id),displayRow=display?s.rows.findIndex(row=>row.id===display.row):selected.r,displayColumn=display?s.columns.findIndex(column=>column.id===display.column):selected.c;
  const row=Math.max(0,navigationRows.indexOf(displayRow)),column=Math.max(0,navigationColumns.indexOf(displayColumn));
  const vertical=key==='ArrowDown'||key==='ArrowUp',items=vertical?navigationRows:navigationColumns;
  const step=key==='ArrowUp'||key==='ArrowLeft'?-1:1,start=vertical?row:column;
  let next:typeof selected|undefined;
  for(let at=start+step;at>=0&&at<items.length;at+=step){
    const slot=vertical?{r:items[at],c:displayColumn}:{r:displayRow,c:items[at]},source=groupProjection?.source(s.rows[slot.r].id,s.columns[slot.c].id);
    if(!source)continue;
    const candidate={r:s.rows.findIndex(row=>row.id===source.row),c:s.columns.findIndex(column=>column.id===source.column)};
    if(inGrid(candidate.r,candidate.c)){next=candidate;break;}
  }
  if(!next)return;
  selected=next;selectionScope=undefined;
  if(!extend||selectionKind!=='cells')anchor={...selected};selectionKind='cells';page=Math.floor(selected.r/60);render();
}
function applyInput(text:string): boolean {
  if(busy){flash('Wait for the current save or sync to finish.');return false;}
  if(!editableReference()||gridReference()?.error){flash('This list is read-only or unavailable. Edit its original source instead.');return false;}
  const previousDraft=draft,literal=draft!==undefined&&draftLiteral,formulaFocused=document.activeElement?.id==='formula';
  if(!literal&&text===inputText(current())){draft=undefined;draftLiteral=false;render();return true;}
  const s=sheet(),row=s.rows[selected.r].id,column=s.columns[selected.c].id,owner=tableAt(book,s.id,row,column);
  const write=()=>{
    const t=allTables(book).find(t=>t.sheet===s.id&&t.header===row&&t.columns.some(c=>c.column===column));
    if(t) renameColumn(book,t,t.columns.find(c=>c.column===s.columns[selected.c].id)!.id,text);
    else writeGridCell(book,s,row,column,text,literal);
    draft=undefined;draftLiteral=false;
  };
  const scoped=owner&&owner.header!==row&&!book.references?.some(source=>source.kind==='conversions'&&source.table===owner.id);
  const ok=scoped?mutateCell(s,row,column,write):mutate('Edit cell',write);
  if(!ok&&!awaitingMutationConfirmation){
    syncDraft(previousDraft??text,!formulaFocused,literal);
    if(formulaFocused)root.querySelector<HTMLInputElement>('#formula')?.focus({preventScroll:true});
  }
  return ok;
}
function commitDraft():boolean{
  if(colorPicker?.pending&&!colorPicker.commit())return false;
  if(appendDraft){
    const pending=appendDraft;appendDraft=undefined;
    if(tableSelectionMode){
      const source=book.references?.find(source=>source.id===pending.source),table=allTables(book).find(table=>table.id===source?.table),s=sheet();
      if(!table){appendDraft=pending;flash('The dropdown table is unavailable.');return false;}
      let completed=false;
      runTableEdit(table.id,'row',{kind:'insert',boundary:Math.max(s.rows.findIndex(row=>row.id===table.header)+1,...table.rows.map(id=>s.rows.findIndex(row=>row.id===id)+1)),count:1},'Add dropdown option',{finish:ids=>{
        writeGridCell(book,sheet(),ids[0],pending.column,pending.value);appendDraft=undefined;completed=true;
      }});
      if(!completed){appendDraft=pending;renderStatus();return false;}
    }else
    if(!mutate('Add dropdown option',()=>{const source=book.references?.find(s=>s.id===pending.source);if(!source)throw Error('This list no longer exists.');const row=appendReferenceOption(book,source,pending.column,pending.value),s=allSheets(book).find(s=>s.id===allTables(book).find(t=>t.id===source.table)!.sheet)!;selected={r:s.rows.findIndex(r=>r.id===row),c:s.columns.findIndex(c=>c.id===pending.column)};anchor={...selected};selectionKind='cells';})){appendDraft=pending;renderStatus();return false;}
  }
  const ok=draft===undefined||applyInput(draft);
  if(ok)closeExpandedEditor();else expandedEditor?.input.focus({preventScroll:true});
  renderStatus();return ok;
}
function dialog(title:string,html:string,onMount?:(d:HTMLDialogElement)=>void): HTMLDialogElement {
  hideShortcutHint();
  groupManager?.close();
  document.querySelector('dialog')?.remove();
  const d=document.createElement('dialog');d.className='dialog-surface';d.setAttribute('aria-label',title);d.innerHTML=`<div class="dialog-heading"><h1 class="dialog-title">${esc(title)}</h1><button type="button" class="close" aria-label="Close dialog">${toolbarIcon('close')}</button></div>${html}`;
  document.body.append(d);const close=d.querySelector<HTMLButtonElement>('.close')!;setShortcutHint(close,'Close dialog',['Esc'],'Escape');close.onclick=()=>d.close();d.onclose=()=>{if(hintButton?.closest('dialog')===d)hideShortcutHint();d.remove();};d.showModal();onMount?.(d);return d;
}
function askText(title:string,value:string,fn:(value:string)=>void):void {
  dialog(title,`<form id="ask-form"><label>Name<input id="answer" required value="${esc(value)}"></label><button class="primary">Apply</button></form>`,d=>{
    const input=d.querySelector<HTMLInputElement>('#answer')!;input.select();
    d.querySelector('form')!.onsubmit=e=>{e.preventDefault();if(!input.value.trim())return;fn(input.value.trim());d.close();};
  });
}
function confirmAction(title:string,detail:string,fn:()=>void):void {
  dialog(title,`<p>${esc(detail)}</p><p>Undo remains available. A downloadable backup is recommended for important data.</p><button class="danger" id="confirm">Confirm</button>`,d=>d.querySelector<HTMLButtonElement>('#confirm')!.onclick=()=>{fn();d.close();});
}
function openEditor():void {
  if(busy||!editableReference()||gridReference()?.error||!inGrid(selected.r,selected.c)){flash('This cell is read-only, busy or unavailable.');return;}
  if(!commitDraft())return;
  closeCellDropdown?.();
  const s=sheet(),row=s.rows[selected.r].id,column=s.columns[selected.c].id,input=document.createElement('textarea'),controller=new AbortController();
  input.id='cell-editor';input.rows=9;input.spellcheck=false;input.setAttribute('aria-label','Expanded cell editor');
  const editorCell=()=>{const r=s.rows.findIndex(r=>r.id===row),c=s.columns.findIndex(c=>c.id===column);return root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);};
  const position=()=>{
    if(expandedEditor?.input!==input)return;
    const cell=editorCell(),rect=cell?.getBoundingClientRect(),grid=root.querySelector<HTMLElement>('#grid-scroll')!.getBoundingClientRect();
    if(!rect||rect.bottom<=grid.top||rect.top>=grid.bottom){commitDraft();return;}
    const viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
    const w=Math.min(Math.max(rect.width,520),width-16),h=Math.min(Math.max(rect.height,220),height-16);
    input.style.width=w+'px';input.style.height=h+'px';input.style.left=Math.max(left+8,Math.min(rect.left,left+width-w-8))+'px';input.style.top=Math.max(top+8,Math.min(rect.top,top+height-h-8))+'px';
  };
  expandedEditor={input,controller,position};document.body.append(input);syncDraft(inputText(current()),true);position();
  input.oninput=()=>syncDraft(input.value);
  input.onkeydown=e=>{
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();draft=undefined;draftLiteral=false;closeExpandedEditor();render();root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});}
    else if(e.key==='Tab'||e.key==='Enter'&&(e.ctrlKey||e.metaKey)){
      e.preventDefault();e.stopPropagation();if(!commitDraft())return;
      if(e.key==='Tab')navigateSelection(e.shiftKey?'ArrowLeft':'ArrowRight');
      root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});
    }
  };
  document.addEventListener('click',e=>{
    const target=e.target as Node;if(target===input||editorCell()?.contains(target))return;
    if(!commitDraft()){e.preventDefault();e.stopImmediatePropagation();}
  },{capture:true,signal:controller.signal});
  document.addEventListener('scroll',e=>{if(e.target!==input)position();},{capture:true,signal:controller.signal});
  window.addEventListener('resize',position,{signal:controller.signal});
  window.visualViewport?.addEventListener('resize',position,{signal:controller.signal});
  window.visualViewport?.addEventListener('scroll',position,{signal:controller.signal});
}
function eachSelected(fn:(s:Sheet,r:number,c:number)=>void):void {
  const s=sheet();for(const b of currentSelections())for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++)if(inGrid(r,c))fn(s,r,c);
}
function copyCells(cut=false):boolean {
  if(referenceId&&cut){flash('Move complete option rows with their grab handle. Copy is available for cell contents.');return false;}
  const s=sheet(),b=requireRectangle(cut?'Cut':'Copy');if(!b){copied=undefined;return false;}
  const rows=s.rows.filter((r,i)=>i>=b.r1&&i<=b.r2&&(!gridReference()||gridReference()!.rows.includes(r.id))),columns=s.columns.filter((c,i)=>i>=b.c1&&i<=b.c2&&(!gridReference()||gridReference()!.columns.includes(c.id)));
  const kind=selectionMode(),projected=!selectionScope&&(kind==='rows'||kind==='columns');
  const positions=projected?rows.map(row=>columns.map(column=>groupProjection?.source(row.id,column.id))):undefined;
  const shifted=positions?.some((row,i)=>row.some((position,j)=>!position||position.row!==rows[i].id||position.column!==columns[j].id));
  if(cut&&shifted){copied=undefined;flash('Sheet axes and displayed table members differ because a table is compacted. Use Table selection to cut its visible records or fields.');return false;}
  const origins=shifted?positions!.map((row,i)=>row.map((position,j)=>position??{row:rows[i].id,column:columns[j].id})):undefined;
  copied={sheet:s.id,r:b.r1,c:b.c1,rows:rows.map(r=>r.id),columns:columns.map(c=>c.id),origins,cells:shifted?positions!.map(row=>row.map(position=>position?clone(getCell(s,position.row,position.column)):{})):rows.map(row=>columns.map(column=>clone(getCell(s,row.id,column.id)))),cut,table:selectionScope,kind};
  render();return true;
}
function pasteCells():void {
  if(!requireRectangle('Paste'))return;
  if(!copied){flash('Copy a cell range first, or paste tab-separated text with Ctrl+V.');return;}
  const source=copied, s=sheet(),from=allSheets(book).find(s=>s.id===source.sheet);
  if(!from){flash('The copied sheet was deleted.');return;}
  if(source.cut){
    if(source.table){
      const owner=scopedSelectionTable();
      if(owner?.id!==source.table||source.kind==='cells'){flash('Move complete table records or fields within the same table. Partial cell cuts cannot split linked records.');return;}
      const axis=source.kind==='rows'?'row':'column';
      runTableEdit(owner.id,axis,{kind:'move',ids:axis==='row'?source.rows:source.columns,boundary:axis==='row'?bounds().r1:bounds().c1},'Cut and move table members');return;
    }
    const rows=source.rows.map(id=>from.rows.findIndex(r=>r.id===id)),columns=source.columns.map(id=>from.columns.findIndex(c=>c.id===id));
    if(rows.some((r,i)=>r<0||r!==rows[0]+i)||columns.some((c,i)=>c<0||c!==columns[0]+i)){flash('The cut selection changed shape. Select and cut it again.');return;}
    if(mutate('Cut and move cells',()=>cutCells(book,from,{r1:rows[0],r2:rows.at(-1)!,c1:columns[0],c2:columns.at(-1)!},s,selected.r,selected.c))){copied=undefined;render();}
    return;
  }
  mutate('Paste cells',()=>{
    let positionAt=pastePositions(source),translations=createTranslationContext(book);
    const originAt=(i:number,j:number)=>source.origins?.[i][j]??{row:source.rows[i],column:source.columns[j]};
    const sourceIndex=translations.sheets.get(from.id)!;
    for(const [i,row]of source.cells.entries())for(const [j]of row.entries()){
      const origin=originAt(i,j);
      if(!sourceIndex.rows.has(origin.row)||!sourceIndex.columns.has(origin.column))throw Error('Copied source was deleted. Copy again before pasting.');
    }
    if(source.kind==='rows'&&!source.table){
      const gaps=new Map<string,string[]>();
      for(const gap of tableMembershipGaps(book))if(gap.sheet===s.id&&gap.axis==='row')gaps.set(gap.member,[...gaps.get(gap.member)??[],gap.table]);
      const joining=new Map<string,Set<string>>();
      source.cells.forEach((row,i)=>row.forEach((_,j)=>{
        const position=positionAt(i,j);if(!position)return;
        const origin=originAt(i,j),owner=translations.tableAt(from.id,origin.row,origin.column);
        if(owner&&owner.header!==origin.row&&gaps.get(s.rows[position.r].id)?.includes(owner.id)&&owner.columns.some(field=>field.column===s.columns[position.c].id)){
          let rows=joining.get(owner.id);if(!rows)joining.set(owner.id,rows=new Set());rows.add(s.rows[position.r].id);
        }
      }));
      for(const [id,rows]of joining)addTableRows(book,s,translations.tables.get(id)!,[...rows]);
      if(joining.size){translations=createTranslationContext(book);positionAt=pastePositions(source);}
    }
    source.cells.forEach((row,i)=>row.forEach((cell,j)=>{
      const position=positionAt(i,j);
      if(!position)throw Error('Paste exceeds this sheet or list. Add rows or columns first.');
      const row=position.r,column=position.c;
      const target=clone(cell);
      const origin=originAt(i,j);
      if(!translations.tableAt(s.id,s.rows[row].id,s.columns[column].id)&&(target.formula||target.binding||target.value!=null&&target.value!=='')&&expandAdjacentTable(book,s,s.rows[row].id,s.columns[column].id)){
        translations=createTranslationContext(book);positionAt=pastePositions(source);
      }
      if(target.formula)target.formula=translate(target.formula,book,from.id,origin.row,origin.column,s.rows[row].id,s.columns[column].id,s.id,translations);
      if(target.calculation)target.calculation=translate(target.calculation,book,from.id,origin.row,origin.column,s.rows[row].id,s.columns[column].id,s.id,translations);
      if(translations.tableAt(s.id,s.rows[row].id,s.columns[column].id)?.header===s.rows[row].id)throw Error('Paste into table headers is disabled. Rename headers explicitly to protect table integrity.');
      s.cells[key(s.rows[row].id,s.columns[column].id)]=target;
    }));
  });
}
function copiedText(source:NonNullable<typeof copied>):string{
  const s=allSheets(book).find(s=>s.id===source.sheet)!;
  return serializeTsv(source.cells.map((row,i)=>row.map((cell,j)=>{
    const origin=source.origins?.[i][j]??{row:source.rows[i],column:source.columns[j]};
    return cellText(cell,s,s.rows.findIndex(r=>r.id===origin.row),s.columns.findIndex(c=>c.id===origin.column));
  })));
}
function pastePositions(source?:NonNullable<typeof copied>):(i:number,j:number)=>typeof selected|undefined{
  const s=sheet(),view=gridReference(),owner=scopedSelectionTable(),mode=selectionMode(),start=mode==='cells'?{...selected}:{r:bounds().r1,c:bounds().c1};
  const sheetAxis=!owner&&(mode==='rows'||mode==='columns'||!source?.table&&(source?.kind==='rows'||source?.kind==='columns'));
  if(source?.kind==='rows'){
    if(!source.table){const display=mode==='cells'?groupProjection?.display(s.rows[start.r].id,s.columns[start.c].id):undefined;if(display)start.r=s.rows.findIndex(row=>row.id===display.row);start.c=0;}
    else if(owner)start.c=Math.min(...owner.columns.map(field=>s.columns.findIndex(column=>column.id===field.column)));
  }
  if(source?.kind==='columns'){
    if(!source.table){const display=mode==='cells'?groupProjection?.display(s.rows[start.r].id,s.columns[start.c].id):undefined;if(display)start.c=s.columns.findIndex(column=>column.id===display.column);start.r=0;}
    else if(owner)start.r=s.rows.findIndex(row=>row.id===owner.header);
  }
  const rowIndices=new Map(s.rows.map((row,index)=>[row.id,index])),columnIndices=new Map(s.columns.map((column,index)=>[column.id,index]));
  const viewRows=view?new Set(view.rows):undefined,viewColumns=view?new Set(view.columns):undefined,ownerRows=owner?new Set([owner.header,...owner.rows]):undefined,ownerColumns=owner?new Set(owner.columns.map(field=>field.column)):undefined;
  const rows=s.rows.map((_,r)=>r).filter(r=>r>=start.r&&(!viewRows||viewRows.has(s.rows[r].id))&&(!ownerRows||ownerRows.has(s.rows[r].id))),cols=s.columns.map((_,c)=>c).filter(c=>c>=start.c&&(!viewColumns||viewColumns.has(s.columns[c].id))&&(!ownerColumns||ownerColumns.has(s.columns[c].id)));
  return(i,j)=>{
    if(rows[i]===undefined||cols[j]===undefined)return;
    if(sheetAxis){
      const position=groupProjection?.source(s.rows[rows[i]].id,s.columns[cols[j]].id);
      if(!position)throw Error('This displayed table slot is empty because members are hidden. Show or expand them before pasting here.');
      return{r:rowIndices.get(position.row)!,c:columnIndices.get(position.column)!};
    }
    return{r:rows[i],c:cols[j]};
  };
}
async function action(name:string):Promise<void> {
  if(busy){flash('Wait for the current save or sync to finish.');return;}
  if(!commitDraft())return;
  if(['fill','tables','dropdown-source','block'].includes(name)){
    if(name==='dropdown-source'&&extraSelections.some(area=>area.table!==selectionScope)){flash('Assign DDs in one table or sheet scope at a time. Mixed-scope selections remain separate.');return;}
    const b=requireRectangle(name==='dropdown-source'?'Assign dropdown':name);if(!b)return;
    if(extraSelections.length){extraSelections=[];anchor={r:b.r1,c:b.c1};selected={r:b.r2,c:b.c2};}
  }
  if(['select-all','range','top','bottom','next','prev','undo','redo'].includes(name)){extraSelections=[];if(!['range','undo','redo'].includes(name))selectionScope=undefined;}
  if(referenceId&&!editableReference()&&!['back-workbook','reference-settings','references','new-reference','copy','save','file','find','hypothetical-settings','undo','redo','range','top','bottom','next','prev','dropdown-source','table-selection'].includes(name)){flash('This is a read-only live list. Edit its source table or change its connection.');return;}
  switch(name) {
    case 'table-selection':
      tableSelectionMode=!tableSelectionMode;
      selectionScope=undefined;extendHeaderSelection=false;extraSelections=[];selectionKind='cells';anchor={...selected};movingRows=movingColumns=undefined;clearMovePreview();
      render();break;
    case 'save': await manualSave();break;
    case 'undo':case 'redo': {
      const from=name==='undo'?undo:redo,to=name==='undo'?redo:undo,previous=from.at(-1);
      if(previous){
        const revision=book.revision,before=book,layoutOnly=layoutHistory(previous);let forward:History;
        try{const applied=applyUndo(book,previous);if('cells'in previous)validateCellChanges(applied.book,previous.cells);else if(layoutOnly)validateBookMetadata(applied.book);else validateBook(applied.book);book=applied.book;forward=clone(previous);from.pop();to.push(applied.inverse);
          const clipboard=clipboardHistory.get(previous);if(clipboard&&copied===clipboard.current){copied=clipboard.restore;clipboardHistory.set(applied.inverse,{current:clipboard.restore,restore:clipboard.current});}
        }catch(error){flash(error);return;}
        const cellChanges=layoutOnly?[]:'cells'in previous?previous.cells:'patch'in previous&&previous.patch.every(p=>p.path.length>1&&!(p.path.includes('cells')&&p.path.at(-1)==='cells'))?previous.patch.flatMap(p=>{
          const at=p.path.indexOf('cells');if(at<0)return[];
          const index=Number(p.path[at-1]),s=p.path[0]==='sheets'?before.sheets[index]:before.dropdownData?.sheets[index];
          return s?[{sheet:s.id,key:String(p.path[at+1])}]:[];
        }):undefined;
        recordTableEdits(before,book,cellChanges);
        scopedChanges.push(capturePatch(book,[['tableActivity']]));
        const reset='cells'in previous?!engine.rebindCells(book,previous.cells.map(c=>`${c.sheet}:${c.key}`)):!layoutOnly||!engine.rebindLayout(book);
        if(reset)displayedVersion++;book.revision=revision;if(!allSheets(book).some(s=>s.id===sheetId))sheetId=allSheets(book)[0].id;changed(name,reset,false,'book'in forward?undefined:forward);render();
      }break;
    }
    case 'bold':case 'italic':case 'underline':case 'strikethrough':case 'wrap':{
      let enabled=true;eachSelected((s,r,c)=>{if(!getCell(s,s.rows[r].id,s.columns[c].id).format?.[name])enabled=false;});
      mutate(`Toggle ${name}`,()=>{
      eachSelected((s,r,c)=>{
        const cell=clone(getCell(s,s.rows[r].id,s.columns[c].id));cell.format={...cell.format,[name]:!enabled};s.cells[key(s.rows[r].id,s.columns[c].id)]=cell;
      });
      if(name==='wrap'&&selectionMode()==='columns'){
        const s=sheet(),table=scopedSelectionTable(),columns=new Set(selectedAxisIndices('column').map(c=>s.columns[c].id));
        if(table){for(const field of table.columns)if(columns.has(field.column))field.wrap=!enabled;}
        else{
          for(const column of s.columns)if(columns.has(column.id))column.wrap=!enabled;
          for(const owner of allTables(book).filter(t=>t.sheet===s.id))for(const field of owner.columns)if(columns.has(field.column))field.wrap=!enabled;
        }
      }
      });break;
    }
    case 'text-color':openColorPalette('color');break;
    case 'background-color':openColorPalette('background');break;
    case 'format':openFormat();break;
    case 'editor':openEditor();break;
    case 'copy':copyCells();break;
    case 'cut':copyCells(true);break;
    case 'paste':pasteCells();break;
    case 'fill':mutate('Fill down',()=>{
      const s=sheet(),b=currentSelections()[0];if(!b)throw Error('Select cells inside this table first.');
      const translations=createTranslationContext(book);
      const rows=s.rows.map((_,i)=>i).filter(r=>r>=b.r1&&r<=b.r2&&inGrid(r,selected.c)),columns=s.columns.map((_,i)=>i).filter(c=>c>=b.c1&&c<=b.c2&&(!gridReference()||gridReference()!.columns.includes(s.columns[c].id)));
      for(const c of columns)for(const r of rows.slice(1)){
        if(allTables(book).some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(x=>x.column===s.columns[c].id)))throw Error('Fill cannot overwrite table headers. Rename headers explicitly.');
        const cell=clone(getCell(s,s.rows[rows[0]].id,s.columns[c].id));
        if(cell.formula)cell.formula=translate(cell.formula,book,s.id,s.rows[rows[0]].id,s.columns[c].id,s.rows[r].id,s.columns[c].id,s.id,translations);
        else if(typeof cell.value==='string'&&/\d+$/.test(cell.value))cell.value=cell.value.replace(/\d+$/,n=>String(Number(n)+rows.indexOf(r)));
        if(cell.calculation)cell.calculation=translate(cell.calculation,book,s.id,s.rows[rows[0]].id,s.columns[c].id,s.rows[r].id,s.columns[c].id,s.id,translations);
        s.cells[key(s.rows[r].id,s.columns[c].id)]=cell;
      }
    });break;
    case 'pin':{const indices=selectedAxisIndices('column');pinnedColumns.set(sheetId,(pinnedColumns.get(sheetId)?.length??0)>0?[]:indices.map(i=>sheet().columns[i].id));render();break;}
    case 'browse':openBrowse();break;
    case 'toolbar-layout':arrangingToolbar=!arrangingToolbar;if(!arrangingToolbar){toolbarSelection.ids.clear();toolbarSelection.anchor=undefined;}render();root.querySelector<HTMLElement>('[data-action="toolbar-layout"]')?.focus({preventScroll:true});break;
    case 'select-all':{
      const owner=tableSelectionMode?tableAt(book,sheetId,sheet().rows[selected.r].id,sheet().columns[selected.c].id):undefined;
      const range=owner?tableHeaderBounds(sheet(),owner,'column',sheet().columns.findIndex(c=>c.id===owner.columns.at(-1)!.column),sheet().columns.findIndex(c=>c.id===owner.columns[0].column)):{r1:0,c1:0,r2:sheet().rows.length-1,c2:sheet().columns.length-1};
      anchor={r:range.r1,c:range.c1};selected={r:range.r2,c:range.c2};selectionKind='cells';scrollTarget=range.r1;render();break;
    }
    case 'range':{const b=bounds();askText('Select a range (for example A2:C6)',`${letters(b.c1)}${b.r1+1}:${letters(b.c2)}${b.r2+1}`,text=>{
      const m=text.toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);if(!m){flash('Use a range such as A2:C6.');return;}
      const a={r:Number(m[2])-1,c:columnIndex(m[1])},z={r:Number(m[4]??m[2])-1,c:columnIndex(m[3]??m[1])};
      if([a,z].some(p=>p.r<0||p.r>=sheet().rows.length||p.c<0||p.c>=sheet().columns.length)){flash('Range is outside this sheet.');return;}
      anchor=a;selected=z;selectionKind='cells';scrollTarget=Math.min(a.r,z.r);page=Math.floor(Math.min(a.r,z.r)/60);render();
    });const d=document.querySelector<HTMLDialogElement>('dialog')!,button=document.createElement('button');button.textContent='Drag to select cells';button.type='button';button.onclick=()=>{d.close();selectionScope=undefined;touchSelection=true;render();};d.append(button);
    if(selectionKind==='rows'||selectionKind==='columns'){const extend=document.createElement('button');extend.type='button';extend.textContent=`Extend ${selectionKind==='rows'?'row':'column'} selection on next header tap`;extend.onclick=()=>{extendHeaderSelection=true;d.close();};d.append(extend);}
    break;}
    case 'top':page=0;selected.r=0;scrollTarget=0;anchor={...selected};selectionKind='cells';render();break;
    case 'bottom':{
      const s=sheet(),used=new Set(Object.entries(s.cells).filter(([,c])=>(c.value!=null&&(typeof c.value!=='string'||!!c.value.trim()))||c.binding||c.note).map(([k])=>k.split(':')[0]));
      selected.r=0;for(let i=s.rows.length-1;i>=0;i--)if(used.has(s.rows[i].id)){selected.r=i;break;}page=Math.floor(selected.r/60);scrollTarget={row:selected.r,contextRows:0,align:'bottom'};anchor={...selected};selectionKind='cells';render();break;
    }
    case 'prev':scrollTarget=Math.max(0,page*60-60);render();break;
    case 'next':scrollTarget=Math.min(sheet().rows.length-1,(page+1)*60);render();break;
    case 'new-sheet':askText('New sheet','Untitled',name=>mutate('Add sheet',()=>{const s=blankSheet(uniqueName(allSheets(book).map(s=>s.name),name));book.sheets.push(s);sheetId=s.id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';page=0;}));break;
    case 'structure':openStructure();break;
    case 'tables':openTables();break;
    case 'move-to-top':moveSelectionToTop();break;
    case 'convert-table':convertSelectionToTable();break;
    case 'references':if(referenceId)backToWorkbook();else openReferences();break;
    case 'back-workbook':backToWorkbook();break;
    case 'new-reference':newReference(referenceHost());break;
    case 'reference-settings':if(activeReference()){const targets=selectedReferenceTabs();referenceSettings(referenceHost(),activeReference()!,targets.length?targets:undefined);}break;
    case 'sheet-settings':openSheetTabSettings();break;
    case 'dropdown-source':openDropdownAssignment();break;
    case 'archive-options':{
      const source=activeReference();if(!source)break;
      mutate('Archive options',()=>{const ids=selectedReferenceRows(),show=ids.every(id=>source.archivedRows.includes(id));source.archivedRows=show?source.archivedRows.filter(id=>!ids.includes(id)):[...new Set([...source.archivedRows,...ids])];});break;
    }
    case 'groups':openGroups();break;
    case 'summary-group':toggleSelectedGroup('summary');break;
    case 'add-summary-group':groupSelected(false);break;
    case 'plain-group':toggleSelectedGroup('range');break;
    case 'hypothetical-settings':{
      openHypotheticalSettings({style:getHypotheticalStyle(book),dialog,save:async style=>{
        if(!mutateMetadata('Save hypothetical treatments',()=>{book.hypotheticalStyle=style;},[['hypotheticalStyle']]))throw Error(error||'Treatment settings could not be applied.');
        const g=generation;await flush('Save hypothetical treatments');
        if(savedGeneration<g)throw Error(error||'Treatment settings are not saved. Retry or download a backup.');
      }});break;
    }
    case 'hypothetical':case 'clear-hypothetical':{
      const selection=hypotheticalSelection();
      if(!selection){flash('Select rows or columns in one sheet or table scope to change their hypo tag.');break;}
      changeHypotheticalTags(selection.axis,selection.ids,name==='hypothetical'&&selection.tagged!==selection.ids.length,selection.table);
      break;
    }
    case 'hypothetical-visibility':showHypothetical=!showHypothetical;render({preserveViewport:true});break;
    case 'ungroup-plain':{
      const owner=scopedSelectionTable(),local=tableSelectionMode||!!owner;
      if(!(local?sheet().groups.some(g=>g.table===owner?.id&&g.kind!=='summary'):allSheets(book).some(s=>s.groups.some(g=>g.kind!=='summary')))){flash('There are no plain groups in this scope.');break;}
      try{
        busy=true;status='Creating recovery checkpoint...';renderStatus();
        await flush();await store.checkpoint('Before ungrouping all plain groups',book);
        busy=false;
        if(mutateMetadata('Ungroup all plain groups',()=>{if(local)sheet().groups=sheet().groups.filter(g=>g.table!==owner?.id||g.kind==='summary');else ungroupPlainGroups(book);},(local?[sheet()]:allSheets(book)).map(s=>[...sheetPath(s),'groups'])))await flush('Ungroup all plain groups');
      }catch(e){status='Group changes not applied; recovery checkpoint failed';flash(e);}
      finally{busy=false;renderStatus();}
      break;
    }
    case 'block':openBlock();break;
    case 'find':openFind();break;
    case 'quick-add':{
      const s=sheet(),t=gridReference()?.table??tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??allTables(book).find(t=>t.sheet===s.id);
      if(tableSelectionMode&&t){runTableEdit(t.id,'row',{kind:'insert',boundary:Math.max(s.rows.findIndex(row=>row.id===t.header)+1,...t.rows.map(id=>s.rows.findIndex(row=>row.id===id)+1)),count:1},'Add table entry');break;}
      mutate('Add entry',()=>{const at=t?Math.max(s.rows.findIndex(r=>r.id===t.header)+1,...t.rows.map(id=>s.rows.findIndex(r=>r.id===id)+1)):selected.r+1;addRow(book,s,at,t);selected={r:at,c:t?s.columns.findIndex(c=>c.id===t.columns[0].column):0};anchor={...selected};selectionKind='cells';page=Math.floor(at/60);});document.querySelector<HTMLInputElement>('#formula')?.focus();break;
    }
    case 'file':openFile();break;
    case 'safety':openSafety();break;
    case 'report':dialog('Import compatibility',`<p>Original Excel remains authoritative. Recalculated results have not been comprehensively compared with Excel.</p><pre>${esc(JSON.stringify(book.importReport,null,2))}</pre>`);break;
  }
}
function paintHypotheticalOverrides():void{
  const preview=hypotheticalOverridePreview,s=sheet();
  root.querySelectorAll<HTMLElement>('td[data-r],th[data-row-select],th[data-col]').forEach(el=>{
    const index=preview?.axis==='row'?el.dataset.r??el.dataset.rowSelect:el.dataset.c??el.dataset.col;
    const item=index===undefined?undefined:(preview?.axis==='row'?s.rows:s.columns)[Number(index)];
    const row=s.rows[Number(el.dataset.r)],column=s.columns[Number(el.dataset.c)];
    el.classList.toggle('hypothetical-override-preview',!!preview&&preview.sheet===s.id&&!!item&&preview.ids.has(item.id)&&(!preview.table||!!row&&!!column&&groupContainsCell(book,s,preview,row.id,column.id)));
  });
}
function changeHypotheticalTags(axis:Group['axis'],ids:string[],enabled:boolean,tableId?:string):void{
  const s=sheet(),table=allTables(book).find(t=>t.id===tableId&&t.sheet===s.id),items=axis==='row'?s.rows:s.columns,descendants=hypotheticalTagDescendants(s,axis,ids,tableId);
  const flag=(item:typeof items[number])=>tableId?item.hypotheticalTables?.[tableId]:item.hypothetical;
  const overrides=items.filter(item=>descendants.has(item.id)&&flag(item)!==undefined);
  const expectedGeneration=generation,label=enabled?'Mark hypo':'Remove hypo tag';
  const apply=(overwrite:boolean)=>mutateMetadata(label,()=>{
    if(sheet().id!==s.id||generation!==expectedGeneration)throw Error('The workbook changed. Select the summary again before changing its tags.');
    if(tableId&&!table)throw Error('The selected table no longer exists.');
    setHypotheticalTag(sheet(),axis,ids,enabled,overwrite,tableId);
  },items.flatMap((item,i)=>ids.includes(item.id)||descendants.has(item.id)?[[...sheetPath(s),axis==='row'?'rows':'columns',i,tableId?'hypotheticalTables':'hypothetical']]:[]));
  if(!overrides.length){apply(false);return;}
  if(hypotheticalOverrideSkips>0){if(apply(true))hypotheticalOverrideSkips--;return;}
  const preview={sheet:s.id,axis,ids:new Set(overrides.map(item=>item.id)),table:tableId},style=getHypotheticalStyle(book);
  const overrideIndexes=items.flatMap((item,index)=>preview.ids.has(item.id)?[index]:[]);
  const rows=(axis==='row'?overrideIndexes:s.rows.map((_,index)=>index)).filter(r=>!table||s.rows[r].id===table.header||table.rows.includes(s.rows[r].id));
  const columns=(axis==='column'?overrideIndexes:s.columns.map((_,index)=>index)).filter(c=>!table||table.columns.some(field=>field.column===s.columns[c].id));
  const headers=columns.map(c=>{
    const column=s.columns[c],table=tableAt(book,s.id,s.rows[rows[0]].id,column.id);
    const label=table?.columns.find(field=>field.column===column.id)?.name??column.label;
    const heading=label===letters(c)?label:`${letters(c)} - ${label}`;
    return `<th scope="col">${esc(heading)}</th>`;
  }).join('');
  const contents=rows.map(r=>`<tr><th scope="row">${r+1}</th>${columns.map(c=>{
    const cell=getCell(s,s.rows[r].id,s.columns[c].id),value=cellText(cell,s,r,c);
    const treatment=flag(axis==='row'?s.rows[r]:s.columns[c])?style[axis==='row'?'rows':'columns']:undefined;
    const tagged=treatment&&(axis==='row'?c===columns[0]:r===rows[0]);
    const badge=tagged&&treatment.badge?`<span class="hypothetical-badge" style="${hypotheticalBadgeCss(treatment)}" role="img" aria-label="${esc(style.label)}">${toolbarIcon('hypothetical-badge')}</span>`:'';
    const header=allTables(book).some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(field=>field.column===s.columns[c].id));
    const classes=`${treatment?`hypothetical-cell ${treatment.fillOpacity>0?'has-hyp-fill ':''}${treatment.textColor?'custom-hyp-text ':''}`:''}${header?'table-header ':''}${cell.formula?'calculated ':''}${value.startsWith('#')?'cell-error ':''}`;
    const format=`${cell.format?.background?`background-color:${esc(cell.format.background)};`:''}${cell.format?.color?`color:${esc(cell.format.color)};`:''}${cell.format?.bold?'font-weight:700;':''}${cell.format?.italic?'font-style:italic;':''}${cell.format?.underline||cell.format?.strikethrough?`text-decoration:${[cell.format?.underline?'underline':'',cell.format?.strikethrough?'line-through':''].filter(Boolean).join(' ')};`:''}`;
    return `<td class="${classes}" style="${treatment?hypotheticalCss(treatment):''}${format}">${badge}<span class="cell-value"${treatment?` style="${hypotheticalTextCss(treatment)}"`:''}>${esc(value)}</span></td>`;
  }).join('')}</tr>`).join('');
  const details=`<div class="hypothetical-override-contents"><table class="grid spreadsheet-grid hypothetical-override-grid" aria-label="Manual tag overrides"><colgroup><col style="width:48px">${columns.map(c=>`<col style="width:${s.columns[c].width??145}px">`).join('')}</colgroup><thead><tr><th scope="col">Row</th>${headers}</tr></thead><tbody>${contents}</tbody></table></div>`;
  const d=dialog('Overwrite manual tagging?',`${details}<div class="hypothetical-override-skip"><label class="inline" title="Overwrite without asking for the next selected number of confirmations in this session."><input type="checkbox" id="skip-hypothetical">Don't show again for</label><input type="number" id="skip-hypothetical-count" aria-label="Number of times to skip" min="1" step="1" max="${Number.MAX_SAFE_INTEGER}" value="1" inputmode="numeric" disabled><span>times</span></div><div class="button-row"><button class="primary" id="inherit-hypothetical">Overwrite</button><button id="cancel-hypothetical">Cancel</button></div>`);
  d.classList.add('hypothetical-override-dialog');
  const clear=()=>{if(hypotheticalOverridePreview===preview){hypotheticalOverridePreview=undefined;paintHypotheticalOverrides();}};
  hypotheticalOverridePreview=preview;paintHypotheticalOverrides();d.addEventListener('close',clear,{once:true});
  const skip=d.querySelector<HTMLInputElement>('#skip-hypothetical')!,count=d.querySelector<HTMLInputElement>('#skip-hypothetical-count')!;
  skip.onchange=()=>{count.disabled=!skip.checked;if(skip.checked)count.focus({preventScroll:true});};
  count.oninput=()=>count.setCustomValidity('');
  d.querySelector<HTMLButtonElement>('#inherit-hypothetical')!.onclick=()=>{
    const next=skip.checked?count.valueAsNumber:0;
    if(skip.checked){
      if(!Number.isSafeInteger(next)||next<1)count.setCustomValidity('Enter a positive whole number of times.');
      if(!count.reportValidity())return;
    }
    clear();d.close();if(apply(true))hypotheticalOverrideSkips=next;
  };
  d.querySelector<HTMLButtonElement>('#cancel-hypothetical')!.onclick=()=>d.close();
}
function openFormat():void {
  const s=sheet(),owner=scopedSelectionTable()??tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??tableAt(book,s.id,s.rows[anchor.r].id,s.columns[anchor.c].id);
  const initial=current().format,color=initial?.color??'#193c34',background=initial?.background??'#ffffff';
  dialog('Cell formatting',`<form><label>Number display<select id="number-format"><option value="">General</option><option value="decimal">Two decimals</option><option value="percent">Percent</option><option value="date">Date</option><option value="date-compact">Date: M/DD; past years YY/M/DD</option></select></label>${owner?`<label id="date-condition-label" hidden>Date rows<select id="date-format-condition"><option value="">Every selected row</option>${owner.columns.map(field=>`<option value="${field.id}">Only when ${esc(field.name)} is filled</option>`).join('')}</select></label>`:''}<label>Text color<input type="color" id="text-color" value="${color}"></label><label>Background<input type="color" id="bg-color" value="${background}"></label><button class="primary">Apply to selection</button></form>`,d=>{
    const number=d.querySelector<HTMLSelectElement>('#number-format')!,condition=d.querySelector<HTMLSelectElement>('#date-format-condition');
    number.value=initial?.number??'';
    const when=initial?.dateWhen;
    if(condition&&when&&when.table===owner?.id)condition.value=when.column;
    const refresh=()=>{const label=d.querySelector<HTMLElement>('#date-condition-label');if(label)label.hidden=!['date','date-compact'].includes(number.value);};
    number.onchange=refresh;refresh();
    d.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();
      const field=['date','date-compact'].includes(number.value)?condition?.value:undefined;
      if(field&&!owner?.columns.some(column=>column.id===field)){flash('The date condition field is no longer available.');return;}
      if(mutate('Format cells',()=>eachSelected((s,r,c)=>{
        const row=s.rows[r].id,column=s.columns[c].id;
        if(field&&(!owner!.rows.includes(row)||!owner!.columns.some(f=>f.column===column)))return;
        const cell=clone(getCell(s,row,column)),chosenColor=d.querySelector<HTMLInputElement>('#text-color')!.value,chosenBackground=d.querySelector<HTMLInputElement>('#bg-color')!.value;
        cell.format={...cell.format,excelNumberFormat:undefined,number:number.value,dateWhen:field?{table:owner!.id,column:field}:undefined};
        if(chosenColor.toLowerCase()!==color.toLowerCase())cell.format.color=chosenColor;
        if(chosenBackground.toLowerCase()!==background.toLowerCase())cell.format.background=chosenBackground;
        s.cells[key(row,column)]=cell;
      })))d.close();
    };
  });
}
function openColorPalette(property:'color'|'background'):void{
  if(busy||!editableReference()){flash('Wait for saving to finish or select an editable cell.');return;}
  if(!commitDraft()||colorPicker&&!colorPicker.close())return;
  const colors=['#ffffff','#000000','#e7e6e6','#44546a','#4472c4','#ed7d31','#a5a5a5','#ffc000','#5b9bd5','#70ad47','#f2f2f2','#7f7f7f','#d0cece','#d6dce4','#d9e2f3','#fbe5d6','#ededed','#fff2cc','#ddebf7','#e2efda','#c00000','#ff0000','#ffc000','#ffff00','#92d050','#00b050','#00b0f0','#0070c0','#002060','#7030a0'];
  const targets:{sheet:string;row:string;column:string}[]=[];eachSelected((s,r,c)=>targets.push({sheet:s.id,row:s.rows[r].id,column:s.columns[c].id}));
  const d=document.createElement('dialog'),controller=new AbortController();d.className='dialog-surface popover color-picker';
  d.innerHTML=`<div class="dialog-heading"><h2></h2><button type="button" class="close" aria-label="Close color picker" data-shortcut-label="Close color picker" data-shortcut-keys="Esc" aria-keyshortcuts="Escape">${toolbarIcon('close')}</button></div><div class="color-mode"><button data-color-mode="background">Fill</button><button data-color-mode="color">Text</button></div><div class="color-palette" role="group" aria-label="Color palette">${colors.map((color,i)=>`<button class="color-swatch" data-color="${color}" style="background:${color}" aria-label="Color ${color}, swatch ${i+1}" title="${color}"></button>`).join('')}</div><div class="color-shade" tabindex="0" role="slider" aria-label="Custom saturation and brightness" aria-valuemin="0" aria-valuemax="100"><span class="color-shade-marker"></span></div><input class="color-hue" type="range" min="0" max="360" aria-label="Hue"><button id="clear-color"></button><label class="custom-color-row">Custom<span class="custom-color-chip" aria-hidden="true"></span><input id="custom-color" aria-label="Custom hex color" maxlength="7" autocomplete="off" spellcheck="false"></label><div class="color-picker-error" role="alert"></div>`;
  const hex=d.querySelector<HTMLInputElement>('#custom-color')!,hue=d.querySelector<HTMLInputElement>('.color-hue')!,shade=d.querySelector<HTMLElement>('.color-shade')!,marker=d.querySelector<HTMLElement>('.color-shade-marker')!,message=d.querySelector<HTMLElement>('.color-picker-error')!;
  let chosen:string|undefined,currentHex='#233c34',hsv=hexToHsv(currentHex);
  const cells=()=>targets.map(target=>{const s=allSheets(book).find(s=>s.id===target.sheet);if(!s||!s.rows.some(r=>r.id===target.row)||!s.columns.some(c=>c.id===target.column))throw Error('The selected cells changed. Reopen the color picker.');return{s,...target};});
  const restore=()=>{for(const target of cells()){const r=target.s.rows.findIndex(r=>r.id===target.row),c=target.s.columns.findIndex(c=>c.id===target.column),td=root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);if(td)td.style[property]=getCell(target.s,target.row,target.column).format?.[property]??'';}};
  const position=()=>{const viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight,edge=parseFloat(getComputedStyle(d).getPropertyValue('--dialog-edge'));d.style.setProperty('--dialog-available-height',Math.max(0,height-edge*2)+'px');d.style.setProperty('--dialog-available-width',Math.max(0,width-edge*2)+'px');const button=root.querySelector<HTMLElement>(`[data-action="${property==='color'?'text-color':'background-color'}"]`),rect=button?.getBoundingClientRect(),size=d.getBoundingClientRect();d.style.left=Math.max(left+edge,Math.min(rect?.left??left+edge,left+width-size.width-edge))+'px';d.style.top=Math.max(top+edge,Math.min((rect?.bottom??top)+6,top+height-size.height-edge))+'px';};
  const controls=()=>{hex.value=currentHex.toUpperCase();hue.value=String(hsv.h);shade.style.setProperty('--color-hue',String(hsv.h));marker.style.left=hsv.s*100+'%';marker.style.top=(1-hsv.v)*100+'%';shade.setAttribute('aria-valuenow',String(Math.round(hsv.s*100)));shade.setAttribute('aria-valuetext',`Saturation ${Math.round(hsv.s*100)}%, brightness ${Math.round(hsv.v*100)}%`);d.querySelector<HTMLElement>('.custom-color-chip')!.style.background=currentHex;d.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(chosen===b.dataset.color)));d.querySelector('#clear-color')!.setAttribute('aria-pressed',String(chosen===undefined));message.textContent='';};
  const preview=(value:string|undefined)=>{chosen=value;if(value)currentHex=normalizeHex(value);for(const target of cells()){const r=target.s.rows.findIndex(r=>r.id===target.row),c=target.s.columns.findIndex(c=>c.id===target.column),td=root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);if(td)td.style[property]=value??'';}owner.pending=true;controls();renderStatus();};
  const commit=()=>{try{if(hex.value.toLowerCase()!==currentHex)preview(normalizeHex(hex.value));}catch(e){message.textContent=e instanceof Error?e.message:String(e);hex.focus();return false;}if(!owner.pending)return true;owner.pending=false;const ok=mutate('Set '+property,()=>{for(const target of cells()){const cell=clone(getCell(target.s,target.row,target.column));cell.format={...cell.format,[property]:chosen};target.s.cells[key(target.row,target.column)]=cell;}});if(!ok)owner.pending=true;renderStatus();position();return ok;};
  const close=(apply=true)=>{if(apply&&!commit())return false;if(!apply&&owner.pending)restore();owner.pending=false;controller.abort();if(colorPicker===owner)colorPicker=undefined;d.close();d.remove();renderStatus();return true;};
  const owner={pending:false,commit,close};colorPicker=owner;
  const mode=(value:'color'|'background')=>{property=value;chosen=current().format?.[property]?.toLowerCase();currentHex=normalizeHex(chosen??(property==='color'?'#233c34':'#ffffff'));hsv=hexToHsv(currentHex);d.querySelector('h2')!.textContent=property==='color'?'Text color':'Cell background color';d.querySelector('#clear-color')!.textContent=property==='color'?'Automatic text color':'No fill';d.querySelectorAll<HTMLButtonElement>('[data-color-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.colorMode===property)));controls();position();};
  d.querySelectorAll<HTMLButtonElement>('[data-color-mode]').forEach(b=>b.onclick=()=>{if(commit())mode(b.dataset.colorMode as 'color'|'background');});
  d.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(b=>b.onclick=()=>{const value=b.dataset.color!;hsv=hexToHsv(value);preview(value);commit();});
  d.querySelector<HTMLButtonElement>('#clear-color')!.onclick=()=>{preview(undefined);commit();};
  hex.oninput=()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value)){const value=normalizeHex(hex.value);hsv=hexToHsv(value);preview(value);commit();}};hex.onchange=()=>{commit();};
  const shadePreview=()=>{preview(hsvToHex(hsv.h,hsv.s,hsv.v));};
  shade.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();shade.focus({preventScroll:true});shade.setPointerCapture(e.pointerId);const update=(event:PointerEvent)=>{const r=shade.getBoundingClientRect();hsv.s=Math.max(0,Math.min(1,(event.clientX-r.left)/r.width));hsv.v=1-Math.max(0,Math.min(1,(event.clientY-r.top)/r.height));shadePreview();};update(e);shade.onpointermove=e=>{if(shade.hasPointerCapture(e.pointerId))update(e);};};
  shade.onpointerup=e=>{if(shade.hasPointerCapture(e.pointerId))shade.releasePointerCapture(e.pointerId);commit();};shade.onpointercancel=()=>{restore();owner.pending=false;mode(property);renderStatus();};
  shade.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='ArrowLeft')hsv.s=Math.max(0,hsv.s-.02);if(e.key==='ArrowRight')hsv.s=Math.min(1,hsv.s+.02);if(e.key==='ArrowUp')hsv.v=Math.min(1,hsv.v+.02);if(e.key==='ArrowDown')hsv.v=Math.max(0,hsv.v-.02);shadePreview();commit();};
  hue.oninput=()=>{hsv.h=Number(hue.value);shadePreview();};hue.onchange=()=>{commit();};
  d.querySelector<HTMLButtonElement>('.close')!.onclick=()=>{close();};d.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(false);}else if(e.key==='Enter'&&e.target===hex){e.preventDefault();e.stopPropagation();commit();}};
  d.onclose=()=>{controller.abort();if(owner.pending)restore();if(colorPicker===owner)colorPicker=undefined;if(hintButton?.closest('dialog')===d)hideShortcutHint();d.remove();renderStatus();};
  document.addEventListener('click',e=>{if(d.contains(e.target as Node))return;const sameButton=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')?.dataset.action===(property==='color'?'text-color':'background-color');if(!close()||sameButton){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,signal:controller.signal});
  window.addEventListener('resize',position,{signal:controller.signal});window.visualViewport?.addEventListener('resize',position,{signal:controller.signal});
  document.body.append(d);d.show();mode(property);
}
function renameSelectedColumn():void {
  const s=sheet(),t=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??allTables(book).find(t=>t.sheet===s.id&&t.columns.some(c=>c.column===s.columns[selected.c].id));
  const col=t?.columns.find(c=>c.column===s.columns[selected.c].id);
  if(!t||!col){askText('Rename column',s.columns[selected.c].label,name=>mutate('Rename column',()=>{s.columns[selected.c].label=name;}));return;}
  const rules=s.validations.filter(v=>v.columns.includes(col.column)&&v.rows.some(row=>t.rows.includes(row))).length;
  dialog('Table column',`<form id="column-name-form"><label>Name<input id="answer" required value="${esc(col.name)}"></label><button class="primary">Rename</button></form><hr><div class="menu"><button id="column-dropdowns">Add / manage dropdowns<small>${rules} applied rules</small></button><button id="column-remove-dropdowns" ${rules?'':'disabled'}>Remove applied dropdowns</button><button id="column-formulas">Add / edit formulas</button></div>`,d=>{
    d.querySelector('form')!.onsubmit=e=>{e.preventDefault();const name=d.querySelector<HTMLInputElement>('#answer')!.value.trim();if(mutate('Rename column',()=>renameColumn(book,t,col.id,name)))d.close();};
    d.querySelector<HTMLButtonElement>('#column-dropdowns')!.onclick=()=>{
      d.close();const c=s.columns.findIndex(c=>c.id===col.column);anchor={r:0,c};selected={r:s.rows.length-1,c};selectionKind='columns';selectionTable=t.id;refreshSelection();openDropdownAssignment();
    };
    d.querySelector<HTMLButtonElement>('#column-remove-dropdowns')!.onclick=()=>{if(mutate('Remove column dropdowns',()=>clearValidations(new Set(t.rows),new Set([col.column]))))d.close();};
    d.querySelector<HTMLButtonElement>('#column-formulas')!.onclick=()=>{d.close();openTableColumnFormula(t.id,col.column);};
  });
}
function openTableColumnFormula(tableId:string,column:string):void{
  const t=allTables(book).find(t=>t.id===tableId),s=t&&allSheets(book).find(s=>s.id===t.sheet);
  if(!t||!s||!t.rows.length){flash('Add a data row before editing this table column.');return;}
  const patterns=tableColumnFormulas(book,t,column);
  dialog('Column formulas',`<form id="column-formula-form"><label>Formula pattern<select id="column-formula-pattern">${patterns.map((p,i)=>`<option value="${i}">Pattern ${i+1} · row ${s.rows.findIndex(r=>r.id===p.row)+1}</option>`).join('')}<option value="-1" ${patterns.length?'':'selected'}>New formula</option></select></label><label>Formula<textarea id="column-formula" rows="4" required spellcheck="false">${esc(patterns.length?displayFormula(patterns[0].formula,book):'=')}</textarea></label><label>Apply to<select id="column-formula-scope"><option value="matching" ${patterns.length?'':'disabled'}>Matching formula pattern; preserve manual overrides</option><option value="calculated" ${patterns.length?'':'selected'}>Calculated and empty cells; preserve manual values</option><option value="all">All data rows; replace manual values</option></select></label><p>Table headers are never changed. Other formula patterns stay intact when editing a matching pattern. Rows with saved manual overrides keep their values and receive the updated restore formula.</p><button class="primary">Apply formula</button></form>`,d=>{
    const picker=d.querySelector<HTMLSelectElement>('#column-formula-pattern')!,input=d.querySelector<HTMLTextAreaElement>('#column-formula')!,scope=d.querySelector<HTMLSelectElement>('#column-formula-scope')!;
    picker.onchange=()=>{const pattern=patterns[Number(picker.value)];input.value=pattern?displayFormula(pattern.formula,book):'=';scope.options[0].disabled=!pattern;scope.value=pattern?'matching':'calculated';};
    d.querySelector('form')!.onsubmit=e=>{e.preventDefault();if(mutate('Edit table column formulas',()=>{
      const current=allTables(book).find(t=>t.id===tableId);if(!current)throw Error('This table was removed.');
      if(!input.value.trim().startsWith('='))throw Error('Enter a formula beginning with =.');
      const formula=compile(input.value,book,s.id,current.rows[0],column);
      applyTableColumnFormula(book,current,column,formula,scope.value as 'matching'|'calculated'|'all',patterns[Number(picker.value)]?.formula);
    }))d.close();};
  });
}
function openBrowse():void {
  const s=sheet();
  dialog('Browse dates or values',`<label>Column<select id="browse-column">${s.columns.map((c,i)=>`<option value="${i}" ${i===selected.c?'selected':''}>${letters(i)} / ${esc(allTables(book).find(t=>t.sheet===s.id&&t.columns.some(x=>x.column===c.id))?.columns.find(x=>x.column===c.id)?.name??c.label)}</option>`).join('')}</select></label><label>Search<input id="browse-search" type="search"></label><input id="browse-position" type="range" min="0" max="0" value="0" aria-label="Value position"><p id="browse-preview" aria-live="polite"></p><button id="browse-go" class="primary">Go to row</button>`,d=>{
    const column=d.querySelector<HTMLSelectElement>('#browse-column')!,search=d.querySelector<HTMLInputElement>('#browse-search')!,slider=d.querySelector<HTMLInputElement>('#browse-position')!,preview=d.querySelector<HTMLElement>('#browse-preview')!,go=d.querySelector<HTMLButtonElement>('#browse-go')!;
    let entries:{row:string;text:string;index:number}[]=[],matches:typeof entries=[],browseError='';
    const update=()=>{const entry=matches[Number(slider.value)];preview.textContent=entry?`${entry.text} / row ${entry.index+1} / ${Number(slider.value)+1} of ${matches.length}`:browseError||'No matching values';go.disabled=!entry;slider.disabled=!matches.length;};
    const filterEntries=()=>{matches=entries.filter(e=>e.text.toLowerCase().includes(search.value.toLowerCase()));slider.max=String(Math.max(0,matches.length-1));slider.value='0';update();};
    const load=()=>{
      engine.beginPass();entries=[];browseError='';
      try{
        const c=Number(column.value),hypothetical=hypotheticalMembers(s,'row');
        for(let r=0;r<s.rows.length;r++){
          const row=s.rows[r];
          if(row.hidden||!showHypothetical&&hypothetical.has(row.id)||allTables(book).some(t=>t.sheet===s.id&&t.header===row.id))continue;
          const value=scalar(engine.cell(s.id,row.id,s.columns[c].id));
          if(isFault(value)&&['#LIMIT!','#UNSUPPORTED!'].includes(value.error))throw Error('This column cannot be browsed safely until its calculation/compatibility error is resolved.');
          if(value!==null&&value!=='')entries.push({row:row.id,text:cellText(getCell(s,row.id,s.columns[c].id),s,r,c),index:r});
        }
        filterEntries();
      }catch(e){entries=[];matches=[];browseError=e instanceof Error?e.message:String(e);update();}
    };
    column.onchange=load;search.oninput=filterEntries;slider.oninput=update;
    go.onclick=()=>{const entry=matches[Number(slider.value)];if(!entry)return;selected={r:s.rows.findIndex(r=>r.id===entry.row),c:Number(column.value)};anchor={...selected};selectionKind='cells';scrollTarget=selected.r;page=Math.floor(selected.r/60);d.close();if(s.groups.some(g=>g.axis==='row'&&g.collapsed&&g.members.includes(entry.row)))mutate('Reveal navigation target',()=>s.groups.filter(g=>g.axis==='row'&&g.members.includes(entry.row)).forEach(g=>g.collapsed=false));else render();root.querySelector(`td[data-r="${selected.r}"][data-c="${selected.c}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});};
    load();
  });
}
function openStructure():void {
  const items=['Insert row above','Insert column left','Rename column','Move column left','Move column right','Move rows up','Move rows down','Move rows to top','Hide selected rows','Hide selected columns','Unhide all','Set column width','Delete selected rows','Delete selected columns','Clear selected cells','Insert cells, shift right','Insert cells, shift down','Delete cells, shift left','Delete cells, shift up','Duplicate selected rows','Duplicate selected columns'];
  const allowed=(i:number)=>(!referenceId||[0,1,2,5,6,7,11,12,13,14].includes(i)||tableSelectionMode&&[3,4,19,20].includes(i))&&(i<19||!!scopedSelectionTable()),b=bounds();
  const sections=[{name:'Rows',ops:[0,19,5,6,7,8,12]},{name:'Columns',ops:[1,20,2,3,4,9,11,13]},{name:'Cells',ops:[14,15,16,17,18]}];
  dialog('Rows & columns',`<p class="structure-selection">Selected: rows ${b.r1+1}${b.r2>b.r1?'–'+(b.r2+1):''} · columns ${letters(b.c1)}${b.c2>b.c1?'–'+letters(b.c2):''}</p><div class="structure-sections">${sections.map(section=>`<section><h3>${section.name}</h3>${section.ops.filter(allowed).map(i=>`<button data-op="${i}" ${[12,13,17,18].includes(i)?'class="structure-delete"':''}>${items[i]}</button>`).join('')}</section>`).join('')}</div>${allowed(10)?'<div class="structure-footer"><button data-op="10">Unhide all</button></div>':''}`,d=>{
    d.classList.add('structure-dialog');
    d.querySelectorAll<HTMLButtonElement>('[data-op]').forEach(el=>el.onclick=()=>{
      d.close();const op=Number(el.dataset.op),s=sheet();let b=bounds();
      if(![2,10,11,14].includes(op)&&!sheetAxisSelectionAllowed(items[op]))return;
      const owner=scopedSelectionTable();
      if(referenceId&&(op===12||op===13)){selectionKind=op===12?'rows':'columns';deleteSelection(true);return;}
      if(owner){
        if(op===0||op===1){requestInsert(op===0?'row':'column',op===0?b.r1:b.c1);return;}
        if(op===11){flash('Column width is shared sheet geometry. Turn off Table selection to resize sheet columns.');return;}
        if([3,4,5,6,7,12,13,19,20].includes(op)){
          const axis:'row'|'column'=[3,4,13,20].includes(op)?'column':'row';
          const axes=axis==='row'?s.rows:s.columns,ids=selectedAxisIndices(axis).map(i=>axes[i].id),owned=axis==='row'?owner.rows:owner.columns.map(field=>field.column);
          const indices=owned.map((id,i)=>ids.includes(id)?i:-1).filter(i=>i>=0),first=Math.min(...indices),last=Math.max(...indices);
          if(!indices.length){flash('Select records or fields inside this table.');return;}
          let edit:TableAxisEdit;
          if(op===12||op===13)edit={kind:'delete',ids};else if(op===19||op===20)edit={kind:'duplicate',ids};
          else{const before=op===7?0:op===3||op===5?Math.max(0,first-1):Math.min(owned.length,last+2);edit={kind:'move',ids,boundary:before===owned.length?axes.findIndex(item=>item.id===owned.at(-1))+1:axes.findIndex(item=>item.id===owned[before])};}
          const run=()=>runTableEdit(owner.id,axis,edit,items[op]);
          if(op===12||op===13)confirmAction(items[op]+'?','Only this table is changed. Deleted references become explicit errors.',run);else run();return;
        }
        if(op===8||op===9){const axis=op===8?'row':'column',items=axis==='row'?s.rows:s.columns;mutateMetadata('Hide table members',()=>{s.groups.push({id:uid(),kind:'range',axis,table:owner.id,members:selectedAxisIndices(axis).map(i=>items[i].id),collapsed:true,label:'Hidden members'});},[[...sheetPath(s),'groups']]);return;}
        if(op===10){const groups=s.groups.filter(group=>group.table===owner.id);mutateMetadata('Unhide table members',()=>groups.forEach(group=>group.collapsed=false),groups.map(g=>[...sheetPath(s),'groups',s.groups.indexOf(g),'collapsed']));return;}
      }
      if(op===2){renameSelectedColumn();return;}
      if(op===11){const columns=selectedAxisIndices('column').map(c=>s.columns[c]);askText('Column width (pixels)',String(s.columns[selected.c].width??145),v=>mutateMetadata('Resize columns',()=>{const width=Number(v);if(!Number.isFinite(width)||width<60||width>800)throw Error('Width must be between 60 and 800 pixels.');columns.forEach(c=>c.width=width);},columns.map(c=>[...sheetPath(s),'columns',s.columns.indexOf(c),'width'])));return;}
      if(op===8||op===9){
        const axis=op===8?'row':'column',indices=selectedAxisIndices(axis),axes=axis==='row'?s.rows:s.columns;
        mutateMetadata(items[op],()=>indices.forEach(i=>axes[i].hidden=true),indices.map(i=>[...sheetPath(s),axis==='row'?'rows':'columns',i,'hidden']));return;
      }
      if(op===10){
        mutateMetadata(items[op],()=>{s.rows.forEach(r=>r.hidden=false);s.columns.forEach(c=>c.hidden=false);s.groups.forEach(g=>g.collapsed=false);},[...s.rows.map((_,i)=>[...sheetPath(s),'rows',i,'hidden']),...s.columns.map((_,i)=>[...sheetPath(s),'columns',i,'hidden']),...s.groups.map((_,i)=>[...sheetPath(s),'groups',i,'collapsed'])]);return;
      }
      if(op>=15){const range=requireRectangle('Shifting cells');if(!range)return;b=range;}
      const run=()=>mutate(items[op],()=>{
        switch(op){
          case 0:insertDimensions('row',b.r1);break;
          case 1:insertDimensions('column',b.c1);break;
          case 3:case 4:{
            const columns=selectedAxisIndices('column'),first=columns[0],last=columns.at(-1)!;
            selected.c=moveColumns(book,s,columns.map(c=>s.columns[c].id),op===3?Math.max(0,first-1):Math.min(s.columns.length,last+2));
            extraSelections=[];anchor={...selected};break;
          }
          case 5:case 6:case 7:{
            const ids=referenceId?selectedReferenceRows():selectedAxisIndices('row').map(r=>s.rows[r].id),view=gridReference(),first=s.rows.findIndex(r=>r.id===ids[0]),last=s.rows.findIndex(r=>r.id===ids.at(-1));
            const slots=view?s.rows.map((r,i)=>view.table?.rows.includes(r.id)?i:-1).filter(i=>i>=0):s.rows.map((_,i)=>i);
            const boundary=op===7?0:op===5?(slots.filter(i=>i<first).at(-1)??first):(slots.find(i=>i>last)??last)+1;
            const at=moveRows(book,s,ids,boundary,view?.table);
            selected.r=at;extraSelections=[];anchor={...selected};page=Math.floor(at/60);break;
          }
          case 8:selectedAxisIndices('row').forEach(r=>s.rows[r].hidden=true);break;
          case 9:selectedAxisIndices('column').forEach(c=>s.columns[c].hidden=true);break;
          case 10:s.rows.forEach(r=>r.hidden=false);s.columns.forEach(c=>c.hidden=false);s.groups.forEach(g=>g.collapsed=false);break;
          case 12:{const rows=selectedAxisIndices('row');if(rows.length===s.rows.length)throw Error('Keep at least one row.');deleteRows(book,s,rows.map(r=>s.rows[r].id));extraSelections=[];break;}
          case 13:{const columns=selectedAxisIndices('column').map(c=>s.columns[c]);if(columns.length===s.columns.length)throw Error('Keep at least one column.');for(const c of columns)deleteColumn(book,s,c.id);extraSelections=[];break;}
          case 14:eachSelected((s,r,c)=>{if(allTables(book).some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(x=>x.column===s.columns[c].id)))throw Error('Rename table headers explicitly.');setInput(book,s,s.rows[r].id,s.columns[c].id,'');});break;
          case 15:case 16:case 17:case 18:shiftCells(book,s,b,(['right','down','left','up'] as const)[op-15]);break;
        }
      });
      if(op>=12)confirmAction(items[op]+'?', 'This changes the selected range. Deleted references become explicit errors.',run);else run();
    });
  });
}
function convertSelectionToTable():void{
  const s=sheet(),axis:Group['axis']=selectionMode()==='columns'?'column':'row',items=axis==='row'?s.rows:s.columns;
  const roots=selectedAxisIndices(axis).map(index=>items[index].id),ids=summaryMoveMembers(s,axis,roots);
  const gaps=tableMembershipGaps(book).filter(gap=>gap.sheet===s.id&&gap.axis===axis),expectedGeneration=generation;
  const candidates=allTables(book).filter(table=>{
    if(table.sheet!==s.id)return false;
    const members=new Set(axis==='row'?[table.header,...table.rows]:table.columns.map(c=>c.column)),inside=new Set(gaps.filter(gap=>gap.table===table.id).map(gap=>gap.member));
    const ownedRoots=s.groups.filter(group=>group.axis===axis&&group.kind==='summary'&&roots.includes(group.members[0])&&(members.has(group.members[0])||inside.has(group.members[0]))).map(group=>group.members[0]);
    const descendants=new Set(summaryMoveMembers(s,axis,ownedRoots));
    return ids.some(id=>!members.has(id))&&ids.every(id=>members.has(id)||inside.has(id)||descendants.has(id));
  });
  if(!candidates.length){openCreateTable();return;}
  const join=(tableId:string)=>mutate('Join selected rows/columns to table',()=>{
    if(generation!==expectedGeneration)throw Error('The workbook changed. Select the rows/columns again.');
    const table=allTables(book).find(t=>t.id===tableId)!;
    if(axis==='row')addTableRows(book,s,table,ids.filter(id=>id!==table.header&&!table.rows.includes(id)));
    else addTableColumns(book,s,table,ids.filter(id=>!table.columns.some(c=>c.column===id)));
  });
  if(candidates.length===1){join(candidates[0].id);return;}
  dialog('Join selected rows/columns',`<form id="join-table-form"><label>Table<select id="join-table" required><option value="">Choose a surrounding table</option>${candidates.map(table=>`<option value="${table.id}">${esc(table.name)}</option>`).join('')}</select></label><button class="primary">Convert to table</button><p id="join-table-error" role="alert"></p></form>`,d=>{
    d.querySelector<HTMLFormElement>('#join-table-form')!.onsubmit=e=>{e.preventDefault();if(join(d.querySelector<HTMLSelectElement>('#join-table')!.value))d.close();else d.querySelector('#join-table-error')!.textContent=error;};
  });
}
function openCreateTable():void{
  if(!commitDraft())return;
  if(referenceId){flash('Open the worksheet to create a table. Existing DD sources are already connected to their tables.');return;}
  const range=requireRectangle('Create table');if(!range)return;
  const sourceSheet=sheetId,expectedGeneration=generation;
  const name=uniqueName(allTables(book).map(table=>table.name),'Table');
  dialog('Create table',`<form id="create-table-form"><label>Table name<input id="table-name" required value="${esc(name)}"></label><p>Selection: ${letters(range.c1)}${range.r1+1}:${letters(range.c2)}${range.r2+1}</p><label class="inline table-headers-option"><input id="table-has-headers" type="checkbox" checked>My table has headers</label><button class="primary">Create table</button><p class="error" id="table-create-error" role="alert" hidden></p></form>`,d=>{
    const headers=d.querySelector<HTMLInputElement>('#table-has-headers')!,input=d.querySelector<HTMLInputElement>('#table-name')!;
    d.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();
      if(mutate('Create table',()=>{
        if(generation!==expectedGeneration)throw Error('The workbook changed. Close this dialog and select the range again.');
        const table=createTable(book,sourceSheet,range,input.value,headers.checked);
        const s=sheet();anchor={r:s.rows.findIndex(row=>row.id===table.header),c:range.c1};
        selected={r:anchor.r+table.rows.length,c:range.c2};selectionKind='cells';extraSelections=[];
      }))d.close();
      else{const message=d.querySelector<HTMLElement>('#table-create-error')!;message.textContent=error;message.hidden=false;}
    };
    input.focus();input.select();
  });
}
function openTableRename(id:string):void{
  const table=allTables(book).find(table=>table.id===id);if(!table){flash('This table no longer exists.');return;}
  dialog('Rename table',`<form><label>Name<input id="answer" required value="${esc(table.name)}"></label><div class="button-row table-rename-actions"><button class="primary">Apply</button><button type="button" class="danger" id="delete-table">Delete table</button><button type="button" id="see-all-tables">See all tables</button></div><p id="table-rename-error" class="error" role="alert" hidden></p></form>`,d=>{
    d.classList.add('table-rename-dialog');
    const input=d.querySelector<HTMLInputElement>('#answer')!;input.focus();input.select();
    d.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();const table=allTables(book).find(t=>t.id===id)!;if(mutateMetadata('Rename table',()=>renameTable(book,id,input.value),[[...tablePath(table),'name']],true))d.close();
      else{const message=d.querySelector<HTMLElement>('#table-rename-error')!;message.textContent=error;message.hidden=false;}
    };
    d.querySelector<HTMLButtonElement>('#delete-table')!.onclick=()=>confirmTableDeletion(id);
    d.querySelector<HTMLButtonElement>('#see-all-tables')!.onclick=()=>{d.close();openTables(true);};
  });
}
function confirmTableDeletion(id:string):void{
  const table=allTables(book).find(table=>table.id===id);if(!table){flash('This table no longer exists.');return;}
  dialog('Delete table?',`<p>Delete <strong>${esc(table.name)}</strong>?</p><p>Cell contents remain on the sheet. Formulas, dropdown sources and links referring to this table will show reference errors. Undo can restore the table.</p><div class="button-row"><button type="button" id="cancel-table-delete">Cancel</button><button type="button" class="danger" id="confirm-table-delete">Delete table</button></div>`,d=>{
    d.querySelector<HTMLButtonElement>('#cancel-table-delete')!.onclick=()=>{d.close();openTables();};
    d.querySelector<HTMLButtonElement>('#confirm-table-delete')!.onclick=()=>{if(mutate('Delete table',()=>{if(!allTables(book).some(table=>table.id===id))throw Error('This table no longer exists.');replaceTables(book,allTables(book).filter(table=>table.id!==id));}))d.close();};
  });
}
function openTables(showAll=false):void {
  const s=sheet(),active=selectionKind==='cells'&&!extraSelections.length&&anchor.r===selected.r&&anchor.c===selected.c?tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id):undefined;
  if(active&&!showAll){openTableRename(active.id);return;}
  dialog('Table manager',`<label class="table-manager-sort">Sort<select id="table-manager-sort" aria-label="Sort tables"><option value="activity">Last activity</option><option value="frequent">Frequently used</option><option value="az">A-Z</option><option value="za">Z-A</option></select></label><form>${sourcePickerBodyHtml}<div class="button-row"><button type="button" id="create-table" class="primary" aria-keyshortcuts="Control+t Meta+t">Create table from selection</button></div><p id="table-manager-error" class="error" role="alert" hidden></p></form>`,d=>{
    d.classList.add('dropdown-assignment','table-manager');d.querySelector('form')!.onsubmit=e=>e.preventDefault();
    const cards=d.querySelector<HTMLElement>('#dropdown-source-cards')!,message=d.querySelector<HTMLElement>('#table-manager-error')!;
    const sort=d.querySelector<HTMLSelectElement>('#table-manager-sort')!;sort.value=book.tableManagerSort??'activity';mountSelectDropdown(sort);
    const picker=mountSourcePicker(d,{grid:true,viewControls:false,searchLabel:'Search tables',placeholder:'Search tables or sheets…',render:(grid,query,sourcePage)=>{
      cards.replaceChildren();
      const matching=sortedTables(book,book.tableManagerSort??'activity').filter(table=>`${table.name} ${allSheets(book).find(sheet=>sheet.id===table.sheet)!.name}`.toLowerCase().includes(query));
      for(const table of sourcePage(matching)){
        const owner=allSheets(book).find(sheet=>sheet.id===table.sheet)!;
        if(!`${table.name} ${owner.name}`.toLowerCase().includes(query))continue;
        const card=document.createElement('div');card.className=`${grid?'dropdown-source-card':'dropdown-source-row'} table-manager-card`;card.dataset.tableId=table.id;
        const title=document.createElement('button');title.type='button';title.className='table-manager-name';title.textContent=table.name;title.setAttribute('aria-label',`Table name: ${table.name}`);title.title='Double-click to rename; press Enter when focused';
        const edit=()=>{
          const current=allTables(book).find(candidate=>candidate.id===table.id)!;
          const editor=document.createElement('div'),input=document.createElement('input'),save=document.createElement('button');
          editor.className='table-manager-name-editor';input.value=current.name;input.setAttribute('aria-label','Table name');save.type='button';save.textContent='Save';
          const commit=()=>{if(mutateMetadata('Rename table',()=>renameTable(book,current.id,input.value),[[...tablePath(current),'name']],true)){message.hidden=true;picker.refresh();}else{message.textContent=error;message.hidden=false;}};
          save.onclick=commit;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();picker.refresh();}};
          editor.append(input,save);title.replaceWith(editor);input.focus();input.select();
        };
        title.ondblclick=edit;title.onkeydown=e=>{if(e.key==='Enter'||e.key==='F2'||e.key===' '){e.preventDefault();edit();}};
        const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='Delete table';remove.setAttribute('aria-label',`Delete ${table.name} table`);
        remove.onclick=()=>confirmTableDeletion(table.id);
        const detail=document.createElement('small'),sheetLink=document.createElement('button');detail.className='table-manager-sheet';
        sheetLink.type='button';sheetLink.className='table-manager-sheet-link';sheetLink.textContent=owner.name;sheetLink.setAttribute('aria-label',`Go to ${table.name} on ${owner.name}`);
        sheetLink.onclick=()=>{
          const r=owner.rows.findIndex(row=>row.id===table.header),c=owner.columns.findIndex(column=>column.id===table.columns[0].column);
          const hiddenGroups=owner.groups.filter(group=>group.collapsed&&(!group.table||group.table===table.id)&&outlineMembers(group,owner.groups).includes(group.axis==='row'?table.header:table.columns[0].column));
          referenceId=undefined;workbookView=undefined;sheetId=owner.id;selected={r,c};anchor={...selected};selectionKind='cells';extraSelections=[];extendHeaderSelection=false;movingRows=movingColumns=undefined;
          selectionScope=tableSelectionMode?table.id:undefined;tableSelectionTarget=tableSelectionMode?table.id:undefined;
          selectedTabs.clear();selectedTabs.add(owner.id);tabSelectionAnchor=owner.id;scrollTarget=r;page=Math.floor(r/60);d.close();
          if(owner.rows[r].hidden||owner.columns[c].hidden||hiddenGroups.length)mutate('Reveal table',()=>{owner.rows[r].hidden=false;owner.columns[c].hidden=false;hiddenGroups.forEach(group=>group.collapsed=false);});
          else render();
          root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
          root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});rememberView();
        };
        detail.append(sheetLink,document.createTextNode(` · ${table.rows.length} rows / ${table.columns.length} columns`));
        const preview=document.createElement('div');preview.className='table-manager-preview';const fields=table.columns.slice(0,4);
        preview.innerHTML=`<table aria-label="${esc(table.name)} preview"><thead><tr>${fields.map(field=>`<th>${esc(field.name)}</th>`).join('')}</tr></thead><tbody>${table.rows.slice(0,4).map(row=>`<tr>${fields.map(field=>`<td>${esc(cellText(getCell(owner,row,field.column),owner,owner.rows.findIndex(item=>item.id===row),owner.columns.findIndex(column=>column.id===field.column)))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        card.append(title,remove,detail,preview);cards.append(card);
      }
      if(!cards.children.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No matching tables';cards.append(empty);}
    }});
    sort.onchange=()=>{
      const value=sort.value;if(value!=='activity'&&value!=='frequent'&&value!=='az'&&value!=='za'){flash('Unknown table sort.');return;}
      book.tableManagerSort=value;changed('Sort tables',false,false,capturePatch(book,[['tableManagerSort']]));renderStatus();picker.refresh();
    };
    d.querySelector<HTMLButtonElement>('#create-table')!.onclick=()=>{d.close();openCreateTable();};
  });
}
function clearValidations(selectedRows?:Set<string>,selectedColumns?:Set<string>):void {
  const s=sheet(),b=bounds(),rows=selectedRows??new Set(s.rows.filter((r,i)=>i>=b.r1&&i<=b.r2&&(!gridReference()||gridReference()!.rows.includes(r.id))).map(r=>r.id)),cols=selectedColumns??new Set(s.columns.filter((c,i)=>i>=b.c1&&i<=b.c2&&(!gridReference()||gridReference()!.columns.includes(c.id))).map(c=>c.id));
  s.validations=s.validations.flatMap(v=>{
    if(!v.rows.some(r=>rows.has(r))||!v.columns.some(c=>cols.has(c)))return[v];
    const remainingRows=v.rows.filter(r=>!rows.has(r)),remainingCols=v.columns.filter(c=>!cols.has(c)),result:typeof s.validations=[];
    if(remainingRows.length)result.push({...v,rows:remainingRows});
    if(remainingCols.length)result.push({...v,id:uid(),rows:v.rows.filter(r=>rows.has(r)),columns:remainingCols});
    return result;
  });
}
function openGroups():void {
  if(!commitDraft())return;
  groupManager?.close();document.querySelector('dialog')?.remove();
  const id=sheetId,panel=document.createElement('aside'),controller=new AbortController();let located:string|undefined;
  const cards=new Map<string,HTMLElement>(),cached=new Map<string,{signature:string;html:string}>();
  let structureSignature='',structureVersion=0,refreshNumber=0;
  let observer:IntersectionObserver|undefined;
  let hydrateFocus:((el:HTMLElement)=>void)|undefined;
  panel.addEventListener('focusin',e=>{const el=(e.target as HTMLElement).closest<HTMLElement>('[data-group-card]');if(el)hydrateFocus?.(el);},{signal:controller.signal});
  panel.className='dialog-surface group-manager';panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','group-manager-title');
  const affected=(g:Sheet['groups'][number],s:Sheet)=>new Set(g.kind==='summary'?g.members:outlineMembers(g,s.groups));
  const coordinates=(g:Sheet['groups'][number],s:Sheet,effective=true)=>{
    const ids=effective?affected(g,s):new Set(g.members),positions=(g.axis==='row'?s.rows:s.columns).map((item,i)=>ids.has(item.id)?i:-1).filter(i=>i>=0),chunks:string[]=[];
    for(let at=0;at<positions.length;){const start=positions[at];let end=start;while(at+1<positions.length&&positions[at+1]===end+1)end=positions[++at];const name=(n:number)=>g.axis==='row'?String(n+1):letters(n);chunks.push(start===end?name(start):name(start)+'-'+name(end));at++;}
    return `${g.axis==='row'?'Rows':'Columns'} ${chunks.join(', ')||'(removed)'}`;
  };
  const paint=()=>{
    const s=allSheets(book).find(s=>s.id===id),g=s?.groups.find(g=>g.id===located),members=g&&s?affected(g,s):new Set<string>();
    root.querySelectorAll<HTMLElement>('td[data-r],th[data-row-select],th[data-col]').forEach(el=>{
      const r=Number(el.dataset.r??el.dataset.rowSelect),c=Number(el.dataset.c??el.dataset.col);
      el.classList.toggle('group-located',!!g&&sheetId===id&&(g.axis==='row'?!!s?.rows[r]&&members.has(s.rows[r].id):!!s?.columns[c]&&members.has(s.columns[c].id))&&(!g.table||!!s?.rows[r]&&!!s?.columns[c]&&groupContainsCell(book,s,g,s.rows[r].id,s.columns[c].id)));
    });
    root.querySelectorAll<HTMLElement>('.grid [data-group-id]').forEach(el=>el.classList.toggle('group-located',el.dataset.groupId===located));
  };
  const close=()=>{refreshNumber++;controller.abort();observer?.disconnect();panel.remove();located=undefined;paint();groupManager=undefined;};
  const refresh=()=>{
    const s=allSheets(book).find(s=>s.id===id);if(!s||sheetId!==id){close();return;}
    const refreshVersion=++refreshNumber;
    const owner=scopedSelectionTable(),local=tableSelectionMode||!!owner,visibleGroups=s.groups.filter(group=>!local||group.table===owner?.id);
    const focus=panel.contains(document.activeElement)?(document.activeElement as HTMLElement).dataset:undefined;
    const scroll=panel.querySelector('.group-card-list')?.scrollTop??0;
    const allRows=s.rows.map((r,i)=>({...r,i})),allColumns=s.columns.map((c,i)=>({...c,i}));
    const tables=new Map(allTables(book).filter(t=>t.sheet===s.id).map(t=>[t.id,t]));
    const layouts=new Map([...tables.values()].map(t=>{
      const rows=new Set([t.header,...t.rows]),columns=new Set(t.columns.map(c=>c.column));
      return[t.id,{rows:allRows.filter(r=>rows.has(r.id)),columns:allColumns.filter(c=>columns.has(c.id))}] as const;
    }));
    const shape=JSON.stringify([s.name,s.groups.map(g=>[g.id,g.axis,g.table,g.kind,g.members]),s.rows.map(r=>r.id),s.columns.map(c=>c.id),[...tables.values()]]);
    if(shape!==structureSignature){structureSignature=shape;structureVersion++;}
    const preview=(g:Sheet['groups'][number])=>{
      const members=affected(g,s),layout=g.table?layouts.get(g.table):{rows:allRows,columns:allColumns};
      const sample=<T,>(items:T[]):T[]=>items.length>4?[...items.slice(0,3),items.at(-1)!]:items;
      const rows=g.axis==='row'?sample((layout?.rows??[]).filter(r=>members.has(r.id))):(layout?.rows??[]).slice(0,3),columns=g.axis==='column'?sample((layout?.columns??[]).filter(c=>members.has(c.id))):(layout?.columns??[]).slice(0,3);
      return `<div class="group-cell-preview"><table class="spreadsheet-grid" aria-label="${esc(coordinates(g,s))} cell preview"><thead><tr><th>Row</th>${columns.map(c=>`<th class="${g.kind==='summary'&&g.axis==='column'&&c.id===g.members[0]?'preview-summary':''}">${letters(c.i)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr class="${g.kind==='summary'&&g.axis==='row'&&r.id===g.members[0]?'preview-summary':''}"><th>${r.i+1}</th>${columns.map(c=>{const value=cellText(getCell(s,r.id,c.id),s,r.i,c.i);return`<td class="${g.kind==='summary'&&g.axis==='column'&&c.id===g.members[0]?'preview-summary':''}" title="${esc(value)}">${esc(value)||'<span class="muted">(blank)</span>'}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;
    };
    if(!panel.firstChild)panel.innerHTML=`<div class="dialog-heading"><h1 class="dialog-title" id="group-manager-title"></h1><button type="button" class="close" aria-label="Close group manager">${toolbarIcon('close')}</button></div>
      <div class="group-type-guide"><p><strong>Summary group</strong> keeps its summary row/column visible and hides the details.</p><p><strong>Plain group</strong> hides all its members. A selected summary also hides its entire group.</p></div>
      <div class="group-create-controls">${(['summary','range'] as const).map(kind=>`<div><strong>${kind==='summary'?'Summary':'Plain'}</strong>${(['row','column'] as const).map(axis=>`<button data-create-kind="${kind}" data-create-axis="${axis}">${axis==='row'?'Group selected rows':'Group selected columns'}</button>`).join('')}</div>`).join('')}</div>
      <button id="ungroup-all-plain"></button><div class="group-card-list"></div>`;
    panel.querySelector('#group-manager-title')!.textContent=`Groups on ${s.name}`;
    const ungroup=panel.querySelector<HTMLButtonElement>('#ungroup-all-plain')!;
    ungroup.disabled=!(local?visibleGroups.some(group=>group.kind!=='summary'):allSheets(book).some(s=>s.groups.some(g=>g.kind!=='summary')));
    ungroup.textContent=`Ungroup all plain groups (${local?owner?.name??'this sheet':'workbook'})`;
    const list=panel.querySelector<HTMLElement>('.group-card-list')!;
    const cardHtml=(g:Group)=>{
        const summary=g.kind==='summary',rootAt=(g.axis==='row'?s.rows:s.columns).findIndex(item=>item.id===g.members[0]),count=affected(g,s).size;
        const owner=g.table?tables.get(g.table):undefined;
        return `<div class="group-card-heading"><strong>${summary?'Summary group':'Plain group'} · ${g.table?`Table: ${esc(owner?.name??'(removed)')}`:'Sheet'}</strong><span>${esc(coordinates(g,s))}</span></div>
          <p>${summary?`Summary ${g.axis} ${g.axis==='row'?rootAt+1:letters(rootAt)} stays visible; ${Math.max(0,count-1)} detail${count===2?'':'s'} ${g.collapsed?'hidden':'shown'}.`:`All ${count} ${g.axis}${count===1?'':'s'} ${g.collapsed?'hidden':'shown'}.${count>g.members.length?` Selected ${esc(coordinates(g,s,false).toLowerCase())} includes a summary and its details.`:''}`}</p>
          ${preview(g)}<div class="group-card-actions"><button data-locate="${g.id}">Locate on sheet</button><button data-toggle="${g.id}">${g.collapsed?'Show':'Hide'} ${summary?'details':'group'}</button><button data-ungroup="${g.id}">Ungroup</button></div>`;
    };
    const show=(el:HTMLElement,g:Group)=>{
      const signature=JSON.stringify([displayedVersion,structureVersion,g]);
      let prior=cached.get(g.id);
      const changed=prior?.signature!==signature;
      if(changed){prior={signature,html:cardHtml(g)};cached.set(g.id,prior);}
      if(changed||el.dataset.lazy!=='false')el.innerHTML=prior!.html;
      el.dataset.lazy='false';el.classList.toggle('located',located===g.id);
    };
    hydrateFocus=el=>{const g=s.groups.find(g=>g.id===el.dataset.groupCard);if(g)show(el,g);};
    observer?.disconnect();
    observer=new IntersectionObserver(entries=>{
      if(refreshVersion!==refreshNumber)return;
      for(const entry of entries){
        const el=entry.target as HTMLElement,g=s.groups.find(g=>g.id===el.dataset.groupCard);if(!g)continue;
        if(entry.isIntersecting)show(el,g);
        else if(!el.contains(document.activeElement)&&visibleGroups.length>20){
          el.style.minHeight=`${entry.boundingClientRect.height}px`;el.replaceChildren();el.dataset.lazy='true';
        }
      }
    },{root:list,rootMargin:'200px'});
    const ids=new Set(visibleGroups.map(g=>g.id));
    for(const [id,el]of cards)if(!ids.has(id)){el.remove();cards.delete(id);cached.delete(id);}
    if(!visibleGroups.length){list.textContent='No groups on this sheet. Select rows or columns on the sheet, then choose Summary or Plain above.';}
    else{
      if(!cards.size)list.replaceChildren();
      visibleGroups.forEach((g,i)=>{
        let el=cards.get(g.id);
        if(!el){el=document.createElement('section');el.className='group-card';el.tabIndex=0;el.dataset.groupCard=g.id;el.dataset.lazy='true';el.setAttribute('aria-label',g.label);cards.set(g.id,el);}
        if(list.children[i]!==el)list.insertBefore(el,list.children[i]??null);
        if(visibleGroups.length<=20||i<4&&scroll===0||el.dataset.lazy==='false')show(el,g);
        observer!.observe(el);
      });
    }
    panel.querySelector<HTMLButtonElement>('.close')!.onclick=close;
    panel.querySelector<HTMLButtonElement>('#ungroup-all-plain')!.onclick=()=>{void action('ungroup-plain');};
    panel.querySelectorAll<HTMLButtonElement>('[data-create-kind]').forEach(el=>el.onclick=()=>groupSelected(false,el.dataset.createAxis as 'row'|'column',el.dataset.createKind as 'summary'|'range'));
    list.onclick=e=>{
      const el=(e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if(!el||!commitDraft())return;
      if(el.dataset.toggle){const g=sheet().groups.find(g=>g.id===el.dataset.toggle)!;mutateMetadata('Toggle group',()=>{g.collapsed=!g.collapsed;},[[...sheetPath(),'groups',sheet().groups.indexOf(g),'collapsed']]);return;}
      if(el.dataset.ungroup){mutateMetadata('Ungroup',()=>{sheet().groups=sheet().groups.filter(g=>g.id!==el.dataset.ungroup);},[[...sheetPath(),'groups']]);return;}
      if(!el.dataset.locate)return;located=el.dataset.locate;
      const g=sheet().groups.find(g=>g.id===located)!,members=affected(g,sheet());
      if(g.axis==='row'){scrollTarget=Math.min(...sheet().rows.map((r,i)=>members.has(r.id)?i:Infinity));render();}
      else{refresh();const positions=sheet().columns.map((c,i)=>members.has(c.id)?i:-1).filter(i=>i>=0),th=root.querySelector<HTMLElement>(`th[data-col="${Math.min(...positions)}"]`)??root.querySelector<HTMLElement>(`.grid [data-group-id="${g.id}"]`);th?.scrollIntoView({block:'nearest',inline:'start'});}
      paint();
    };
    panel.querySelector('.group-card-list')!.scrollTop=scroll;
    if(focus){const attr=focus.toggle?'data-toggle':focus.ungroup?'data-ungroup':focus.locate?'data-locate':undefined;if(attr)panel.querySelector<HTMLButtonElement>(`[${attr}="${focus.toggle??focus.ungroup??focus.locate}"]`)?.focus({preventScroll:true});}
    paint();
  };
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}e.stopPropagation();},{signal:controller.signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&draft===undefined){e.preventDefault();e.stopPropagation();close();}},{capture:true,signal:controller.signal});
  groupManager={refresh,paint,close};document.body.append(panel);refresh();
}
function groupingSelection(kind:'summary'|'range',axis:'row'|'column'):{members:string[];targets:Group[]}{
  const s=sheet(),view=gridReference(),members=axis==='row'
    ?selectedAxisIndices('row').map(i=>s.rows[i]).filter(r=>!view||view.rows.includes(r.id)).map(r=>r.id)
    :selectedAxisIndices('column').map(i=>s.columns[i]).filter(c=>!view||view.columns.includes(c.id)).map(c=>c.id);
  const chosen=new Set(members),groups=s.groups.filter(g=>g.table===selectionScope&&g.axis===axis&&(g.kind??'range')===kind);
  const exact=groups.find(g=>g.members.length===chosen.size&&g.members.every(id=>chosen.has(id)));
  const containing=groups.filter(g=>members.length&&members.every(id=>g.members.includes(id))).sort((a,z)=>a.members.length-z.members.length);
  const inside=groups.filter(g=>g.members.every(id=>chosen.has(id)));
  return{members,targets:exact?[exact]:containing.length?[containing[0]]:inside.filter(g=>!inside.some(parent=>parent.id!==g.id&&parent.members.length>g.members.length&&g.members.every(id=>parent.members.includes(id))))};
}
function toggleSelectedGroup(kind:'summary'|'range',axis?:'row'|'column'):void{
  if(!commitDraft()||!editableReference())return;
  axis??=selectionMode()==='rows'?'row':selectionMode()==='columns'?'column':undefined;
  if(!axis){
    dialog(kind==='summary'?'Summary group':'Plain group','<div class="button-row"><button data-toggle-group-axis="row">Rows</button><button data-toggle-group-axis="column">Columns</button></div>',d=>{
      d.querySelectorAll<HTMLButtonElement>('[data-toggle-group-axis]').forEach(button=>button.onclick=()=>{d.close();toggleSelectedGroup(kind,button.dataset.toggleGroupAxis as 'row'|'column');});
    });return;
  }
  groupSelected(groupingSelection(kind,axis).targets.length>0,axis,kind);
}
function groupSelected(remove=false,axis?:'row'|'column',kind:'summary'|'range'='summary'):void {
  if(!commitDraft()||!editableReference())return;
  if(extraSelections.some(area=>area.table!==selectionScope)){flash('Group one table or sheet scope at a time. Mixed-scope selections remain separate.');return;}
  axis??=selectionMode()==='rows'?'row':selectionMode()==='columns'?'column':undefined;
  if(!axis){
    dialog(remove?'Ungroup selection':'Group selection','<div class="button-row"><button data-group-axis="row">Rows</button><button data-group-axis="column">Columns</button></div>',d=>{
      d.querySelectorAll<HTMLButtonElement>('[data-group-axis]').forEach(button=>button.onclick=()=>{d.close();groupSelected(remove,button.dataset.groupAxis as 'row'|'column',kind);});
    });return;
  }
  const s=sheet(),b=bounds(),{members,targets}=groupingSelection(kind,axis);
  const chosen=new Set(members),groups=s.groups.filter(g=>g.table===selectionScope&&g.axis===axis&&(g.kind??'range')===kind),exact=groups.find(g=>g.members.length===chosen.size&&g.members.every(id=>chosen.has(id)));
  mutateMetadata(remove?'Ungroup selection':'Group selection',()=>{
    if(!members.length)throw Error('Select rows or columns to group.');
    if(!remove){
      if(exact)throw Error('That selection is already grouped.');
      if(kind==='summary'&&members.length<2)throw Error('Select the summary row or column together with at least one detail.');
      s.groups.push({id:uid(),axis,members,kind,collapsed:false,...(selectionScope?{table:selectionScope}:{}),label:axis==='row'?`Rows ${b.r1+1}-${b.r2+1}`:`Columns ${letters(b.c1)}-${letters(b.c2)}`});return;
    }
    if(!targets.length)throw Error('No complete or containing group matches this selection.');
    const ids=new Set(targets.map(g=>g.id));s.groups=s.groups.filter(g=>!ids.has(g.id));
  },[[...sheetPath(s),'groups']]);
}
function openBlock():void {
  const s=sheet(),t=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??allTables(book).find(t=>t.sheet===s.id);
  if(!t){flash('Choose a table with Meal, Date, isMeal, or isDay columns. Other tables still support ordinary row groups.');return;}
  const find=(name:string)=>t.columns.find(c=>c.name.toLowerCase()===name.toLowerCase());
  const flag=find('isDay')??find('isMeal'),label=find('Meal')??find('Weight'),date=find('Date');
  if(!label&&!flag){flash('This table has no meal/day header marker. Use ordinary row groups.');return;}
  let members:string[]=[],blockIssue='';
  try{members=positionalBlock(book,s,t,s.rows[selected.r].id,engine);}catch(e){blockIssue=e instanceof Error?e.message:String(e);}
  const positions=members.map(id=>s.rows.findIndex(r=>r.id===id));
  const isDay=!!find('isDay')||(!find('Meal')&&!!date),title=isDay?'Day':'Meal',local=tableSelectionMode;
  const groupDetails=(ids:string[])=>{if(ids.length<2)throw Error('Add detail rows to this block first.');sheet().groups.push({id:uid(),axis:'row',members:ids,kind:'summary',collapsed:true,label:`${title} details`,...(local?{table:t.id}:{})});};
  dialog(`${title} blocks`, `<p>A block runs from one header record to the next. Moving ingredients across a header still changes membership. Existing formulas are never silently repaired.</p>${blockIssue?`<p>${esc(blockIssue)}</p>`:''}<div class="menu"><button id="group-top" ${members.length?'':'disabled'}>Group & move to top</button><button id="select-block" ${members.length?'':'disabled'}>Select current block (${members.length} records)</button><button id="move-block" ${members.length?'':'disabled'}>Move current block below table header</button><button id="collapse-block" ${members.length?'':'disabled'}>Group block details for collapse</button></div><hr><h3>New ${title.toLowerCase()} header</h3><form id="new-block"><label>${isDay?'Date':'Meal name'}<input id="block-label" ${isDay?'type="date"':''} required></label><label>Status<select id="block-status"><option>real</option>${local?'':'<option>planned</option>'}<option>hypothetical</option></select></label><button class="primary">Create explicit ${title.toLowerCase()}</button></form><p class="muted">Only newly created headers get default totals, including an explicit end-of-table bound. Imported header formulas remain unchanged.${local?' Planned status is sheet-wide; turn off Table selection to use it.':''}</p>`,d=>{
    d.querySelector<HTMLButtonElement>('#group-top')!.onclick=()=>{
      if(local){d.close();runTableEdit(t.id,'row',{kind:'move',ids:members,boundary:s.rows.findIndex(row=>row.id===t.header)+1},'Group & move block to top',{finish:ids=>{if(ids.length>1&&!sheet().groups.some(group=>group.table===t.id&&group.kind==='summary'&&group.members[0]===ids[0]))groupDetails(ids);}});return;}
      mutate('Group & move block to top',()=>{
      const at=groupBlockToTop(book,s,t,s.rows[selected.r].id);selected={r:at,c:0};anchor={...selected};selectionKind='cells';scrollTarget=at;
    });d.close();};
    d.querySelector<HTMLButtonElement>('#select-block')!.onclick=()=>{const fields=t.columns.map(field=>s.columns.findIndex(column=>column.id===field.column));anchor={r:Math.min(...positions),c:local?Math.min(...fields):0};selected={r:Math.max(...positions),c:local?Math.max(...fields):s.columns.length-1};selectionKind=local?'rows':'cells';selectionScope=local?t.id:undefined;scrollTarget=anchor.r;page=Math.floor(anchor.r/60);render();d.close();};
    d.querySelector<HTMLButtonElement>('#move-block')!.onclick=()=>{
      if(local){d.close();runTableEdit(t.id,'row',{kind:'move',ids:members,boundary:s.rows.findIndex(row=>row.id===t.header)+1},'Move whole block');return;}
      mutate('Move whole block',()=>{
      if(!label&&!flag)throw Error('This table has no recognized meal/day header marker. Use explicit row selection instead.');
      const at=moveRows(book,s,members,s.rows.findIndex(r=>r.id===t.header)+1);
      selected={r:at,c:0};anchor={...selected};selectionKind='cells';page=Math.floor(at/60);
    });d.close();};
    d.querySelector<HTMLButtonElement>('#collapse-block')!.onclick=()=>{mutate('Group block details',()=>groupDetails(members));d.close();};
    d.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();const text=d.querySelector<HTMLInputElement>('#block-label')!.value,status=d.querySelector<HTMLSelectElement>('#block-status')!.value as 'real'|'planned'|'hypothetical';
      const createHeader=(row:string)=>{
        const s=sheet(),updated=allTables(book).find(table=>table.id===t.id)!,r=s.rows.find(item=>item.id===row)!;
        if(isDay&&!date)throw Error('This table needs a Date column to create an explicit day.');
        if(!isDay&&!find('Meal'))throw Error('This table needs a Meal column to create a meal header.');
        if(local){if(status==='planned')throw Error('Planned status is sheet-wide. Turn off Table selection first.');r.hypotheticalTables??={};r.hypotheticalTables[t.id]=status==='hypothetical';}
        else r.status=status;
        if(isDay){
          const [year,month,day]=text.split('-').map(Number),serial=excelDate(year,month,day);
          if(year<1900||serial===undefined||excelDateText(serial)!==text)throw Error('Choose a valid date from 1900-01-01 through 9999-12-31.');
          setInput(book,s,r.id,date!.column,String(serial));const cell=s.cells[key(r.id,date!.column)];cell.format={...cell.format,number:'date',excelNumberFormat:undefined};if(flag)setInput(book,s,r.id,flag.column,'TRUE');
        }
        else{setInput(book,s,r.id,find('Meal')!.column,text);if(flag)setInput(book,s,r.id,flag.column,'TRUE');}
        const portions=find('Portions');if(portions)setInput(book,s,r.id,portions.column,'1');
        for(const c of updated.columns)if(/^(Calories(?: \(kcal\))?|(?:Fat|Carbs|Sugar|Protein) \(g\)|Sodium \(mg\))$/i.test(c.name))setInput(book,s,r.id,c.column,defaultHeaderFormula(book,updated,c.id));
      };
      const at=Math.max(s.rows.findIndex(r=>r.id===t.header)+1,...t.rows.map(id=>s.rows.findIndex(r=>r.id===id)+1));
      if(local){d.close();runTableEdit(t.id,'row',{kind:'insert',boundary:at,count:1},`Create ${title.toLowerCase()}`,{finish:ids=>createHeader(ids[0])});return;}
      mutate(`Create ${title.toLowerCase()}`,()=>{
        const r=addRow(book,s,at,t);createHeader(r.id);
        selected={r:at,c:0};anchor={...selected};selectionKind='cells';page=Math.floor(at/60);
      });d.close();
    };
  });
}
function openReferences(id?:string,notice=''):void{
  if(!commitDraft())return;
  if(!referenceId){const grid=root.querySelector<HTMLElement>('#grid-scroll');workbookView={sheet:sheetId,selected:{...selected},anchor:{...anchor},kind:selectionKind,scope:selectionScope,tableMode:tableSelectionMode,target:tableSelectionTarget,scroll:grid?.scrollTop??0,left:grid?.scrollLeft??0};}
  referenceId=id??referenceId??book.references?.find(s=>!s.workbookOnly&&s.kind!=='units'&&s.kind!=='conversions')?.id;
  if(!referenceId){newReference(referenceHost());return;}
  document.querySelector<HTMLDialogElement>('dialog')?.close();
  const view=gridReference();if(view?.sheet){sheetId=view.sheet.id;const row=view.rows[1]??view.rows[0];selected={r:Math.max(0,view.sheet.rows.findIndex(r=>r.id===row)),c:Math.max(0,view.sheet.columns.findIndex(c=>c.id===view.columns[0]))};anchor={...selected};}
  referenceNotice=notice;selectionKind='cells';movingRows=movingColumns=undefined;renderedSheet='';render();
}
function backToWorkbook():void{
  if(!commitDraft())return;
  referenceId=undefined;movingRows=movingColumns=undefined;
  const view=workbookView;workbookView=undefined;
  if(view&&book.sheets.some(s=>s.id===view.sheet)){sheetId=view.sheet;selected=view.selected;anchor=view.anchor;selectionKind=view.kind;selectionScope=view.scope;tableSelectionMode=view.tableMode??tableSelectionMode;tableSelectionTarget=view.target;}
  else{sheetId=book.sheets[0].id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';selectionScope=undefined;tableSelectionTarget=undefined;extraSelections=[];}
  renderedSheet='';render();const grid=root.querySelector<HTMLElement>('#grid-scroll')!;if(view){grid.scrollTop=view.scroll;grid.scrollLeft=view.left;drawRowWindow?.();}
}
function referenceHost():ReferenceHost{return{
  book:()=>book,esc,mutate,dialog,askText,importSource:importReferenceSources,  open:(id,selection=[id])=>{selectedTabs.clear();for(const token of selection)selectedTabs.add(token);tabSelectionAnchor=id;openReferences(id);},
  bind:(source,selection=[source])=>{
    const target=workbookView;if(!target){flash('Select workbook cells before opening DD.');return;}
    const previous={referenceId,sheetId,selected:{...selected},anchor:{...anchor},selectionKind,scope:selectionScope,tableMode:tableSelectionMode,target:tableSelectionTarget},grid=root.querySelector<HTMLElement>('#grid-scroll'),scroll=grid?.scrollTop??0,left=grid?.scrollLeft??0;
    try{const formulas=selection.map(referenceFormula),ast:Ast=formulas.length===1?formulas[0]:{kind:'call',name:'VSTACK',args:formulas},keys=selection.map(s=>s.kind==='derived'?`ref:${s.id}`:`${s.table}:${s.column}`);referenceId=undefined;sheetId=target.sheet;selected={...target.selected};anchor={...target.anchor};selectionKind=target.kind;selectionScope=target.scope;tableSelectionMode=target.tableMode??tableSelectionMode;tableSelectionTarget=target.target;assignDropdown(ast,keys.length===1?keys[0]:JSON.stringify(keys));}
    catch(e){flash(e);}
    finally{referenceId=previous.referenceId;sheetId=previous.sheetId;selected=previous.selected;anchor=previous.anchor;selectionKind=previous.selectionKind;selectionScope=previous.scope;tableSelectionMode=previous.tableMode;tableSelectionTarget=previous.target;render();const grid=root.querySelector<HTMLElement>('#grid-scroll')!;grid.scrollTop=scroll;grid.scrollLeft=left;drawRowWindow?.();rememberView();}
  }
};}
function dropdownScope():{rows:string[];columns:string[]}{
  const s=sheet(),b=bounds(),owner=scopedSelectionTable(),cols=s.columns.filter((c,i)=>i>=b.c1&&i<=b.c2&&(!gridReference()||gridReference()!.columns.includes(c.id))&&(!owner||owner.columns.some(field=>field.column===c.id))).map(c=>c.id);
  let rows=s.rows.filter((r,i)=>i>=b.r1&&i<=b.r2&&(!gridReference()||gridReference()!.rows.includes(r.id))&&(!owner||r.id===owner.header||owner.rows.includes(r.id))).map(r=>r.id);
  if(selectionKind==='columns'){
    const candidates=allTables(book).filter(t=>t.sheet===s.id&&t.columns.some(c=>cols.includes(c.column))),t=owner??gridReference()?.table??candidates.find(t=>t.id===selectionTable)??(candidates.length===1?candidates[0]:undefined);
    if(candidates.length>1&&!t)throw Error('This column crosses multiple tables. Select a data cell in your intended table before selecting its column.');
    if(t)rows=t.rows;
  }
  rows=rows.filter(r=>!allTables(book).some(t=>t.sheet===s.id&&t.header===r&&t.columns.some(c=>cols.includes(c.column))));
  if(!rows.length||!cols.length)throw Error('Select a data cell or a column, not a table header.');
  return{rows,columns:cols};
}
function assignDropdown(ast:ReturnType<typeof compile>|undefined,remembered:string):boolean{
  try{const scope=dropdownScope();return mutate('Set dropdown source',()=>{
    clearValidations(new Set(scope.rows),new Set(scope.columns));
    if(ast)sheet().validations.push({id:uid(),sheet:sheetId,...scope,source:JSON.stringify(ast)});
    for(const c of scope.columns)book.pickerSources[`${sheetId}:${c}`]=remembered;
  });}catch(e){flash(e);return false;}
}
function openDropdownAssignment():void{
  if(referenceId&&!editableReference()){flash('Assign dropdowns to workbook cells, not a read-only generated list.');return;}
  try{
    const scope=dropdownScope(),s=sheet();
    const sources=(book.references??[]).filter(r=>!r.archived&&r.kind!=='conversions'&&r.kind!=='units');
    const rememberedFields=new Set(Object.values(book.pickerSources));
    const fields=allTables(book).filter(t=>!book.references?.some(r=>r.table===t.id)).flatMap(t=>t.columns.filter(c=>t.name.toLowerCase()==='ingredients'&&/^ingredients?$/i.test(c.name)||rememberedFields.has(`${t.id}:${c.id}`)).map(c=>({table:t,column:c})));
    const options:{value:string;label:string;displayLabel?:string;group?:string;ast?:Ast;error?:string}[]=[
      ...sources.map(r=>{const value=r.kind==='derived'?`ref:${r.id}`:`${r.table}:${r.column}`,displayLabel=referenceLabel(r),group=r.group;try{return{value,label:referenceCaption(r),displayLabel,group,ast:referenceFormula(r)};}catch(e){return{value,label:referenceCaption(r),displayLabel,group,error:String(e)};}}),
      ...fields.map(({table:t,column:c})=>({value:`${t.id}:${c.id}`,label:fields.filter(f=>f.table.id===t.id).length>1?`${t.name} / ${c.name}`:t.name,ast:{kind:'structured' as const,table:t.id,columns:[c.id],mode:'data' as const}}))
    ];
    const flattenSources=(ast:Ast,context:string,visited=new Set<string>()):Ast[]=>{
      if(ast.kind==='name'){
        if(visited.has(ast.id))throw Error('Circular dropdown source.');const next=new Set(visited);next.add(ast.id);const id=ast.id,named=book.names.find(n=>n.id===id);
        return named?flattenSources(named.formula,named.context,next):[ast];
      }
      if(ast.kind==='call'&&ast.name==='VSTACK'&&!ast.args.every(arg=>arg.kind==='literal'))return ast.args.flatMap(arg=>flattenSources(arg,context,new Set(visited)));
      if(ast.kind==='call'&&ast.name==='INDIRECT'&&ast.args[0]?.kind==='literal'&&typeof ast.args[0].value==='string')return flattenSources(compile(ast.args[0].value,book,context,scope.rows[0],scope.columns[0]),context,visited);
      return[ast];
    };
    const signature=(ast:Ast)=>JSON.stringify(ast,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().filter(key=>key!=='implicit').map(key=>[key,value[key]])):value);
    const selectedSources=new Set<string>(),assigned=s.validations.filter(v=>v.rows.some(r=>scope.rows.includes(r))&&v.columns.some(c=>scope.columns.includes(c)));
    for(const v of assigned){
      if(v.values){const value=`current:${v.id}`;options.push({value,label:'Current custom source',ast:{kind:'call',name:'VSTACK',args:v.values.map(value=>({kind:'literal',value}))}});selectedSources.add(value);continue;}
      const ast=v.source.startsWith('{')?JSON.parse(v.source) as Ast:compile(v.source,book,v.sheet,scope.rows[0],scope.columns[0]);
      for(const part of flattenSources(ast,v.sheet)){
        if(validationReference(book,part,s.id)?.kind==='units')continue;
        const match=signature(part),option=options.find(o=>o.ast&&flattenSources(o.ast,s.id).some(part=>signature(part)===match));
        if(option)selectedSources.add(option.value);
        else{const value=`current:${v.id}:${options.length}`;options.push({value,label:'Current custom source',ast:part});selectedSources.add(value);}
      }
    }
    dialog('Dropdowns for selection',`${sourcePickerControlsHtml}<form>${sourcePickerBodyHtml}<div class="dropdown-assignment-footer"><button type="button" id="no-dropdown">No dropdown</button><span id="dropdown-selected-count" role="status"></span><button class="primary">Apply dropdown</button></div><p id="dropdown-assignment-error" class="dropdown-source-error" role="alert" hidden></p></form>`,d=>{
      d.classList.add('dropdown-assignment');
      const cards=d.querySelector<HTMLElement>('#dropdown-source-cards')!,previews=new Map<string,{choices:string[];error?:string}>();
      let observer:IntersectionObserver|undefined;
      d.addEventListener('close',()=>observer?.disconnect(),{once:true});
      const sync=()=>{cards.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.checked=selectedSources.has(input.value));d.querySelector('#dropdown-selected-count')!.textContent=`${selectedSources.size} selected`;d.querySelector('#no-dropdown')!.setAttribute('aria-pressed',String(!selectedSources.size));};
      const setView=(grid:boolean,query:string,page:SourcePage)=>{
        observer?.disconnect();
        cards.replaceChildren();
        const visible=options.filter(o=>o.label.toLowerCase().includes(query)),ordered:typeof options=[],groups=new Map<string,typeof options>(),seen=new Set<string>();
        for(const option of visible)if(option.group){const key=option.group.toLowerCase();let entries=groups.get(key);if(!entries)groups.set(key,entries=[]);entries.push(option);}
        for(const option of visible)if(!option.group)ordered.push(option);else if(!seen.has(option.group.toLowerCase())){seen.add(option.group.toLowerCase());ordered.push(...groups.get(option.group.toLowerCase())!);}
        const hydrate=(card:HTMLElement,check:HTMLInputElement,option:typeof options[number])=>{
          if(!previews.has(option.value))try{
            if(option.error||!option.ast)throw Error(option.error??'This source is unavailable.');
            const preview=validationChoices(book,{id:'preview',rows:scope.rows,columns:scope.columns,sheet:s.id,source:JSON.stringify(option.ast)},scope.rows[0],scope.columns[0],engine).choices.slice(0,4);
            previews.set(option.value,{choices:preview.map(c=>c.value===''?'(Blank)':c.value===' '?'(Space)':c.value)});
          }catch(e){previews.set(option.value,{choices:[],error:String(e)});}
          const preview=previews.get(option.value)!;card.querySelector('[data-source-preview]')?.remove();
          if(preview.error){check.disabled=!selectedSources.has(option.value);check.dataset.unavailable='true';const error=document.createElement('span');error.className='dropdown-source-error';error.textContent=preview.error;error.dataset.sourcePreview='';card.append(error);}
          else if(grid){const list=document.createElement('ul');list.dataset.sourcePreview='';for(const value of preview.choices.length?preview.choices:['No available options']){const item=document.createElement('li');item.textContent=value;list.append(item);}card.append(list);}
          else{const values=document.createElement('span');values.className='dropdown-source-row-preview';values.dataset.sourcePreview='';values.textContent=preview.choices.join(' · ')||'No available options';card.append(values);}
          card.removeAttribute('aria-busy');
        };
        const waiting=new Map<Element,()=>void>();
        observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){waiting.get(entry.target)?.();waiting.delete(entry.target);observer!.unobserve(entry.target);}},{root:cards,rootMargin:'100px'});
        let group='';
        for(const option of page(ordered)){
          if(!grid&&option.group&&option.group!==group){const heading=document.createElement('div');heading.className='dropdown-source-group';heading.textContent=option.group;cards.append(heading);}group=option.group??'';
          const card=document.createElement('label');card.className=grid?'dropdown-source-card':'dropdown-source-row';const check=document.createElement('input');check.type='checkbox';check.value=option.value;check.checked=selectedSources.has(option.value);check.setAttribute('aria-label',option.label);
          const title=document.createElement('strong');title.textContent=grid?option.label:option.displayLabel??option.label;card.append(check,title);
          check.onchange=()=>{if(check.checked)selectedSources.add(option.value);else selectedSources.delete(option.value);if(check.dataset.unavailable)check.disabled=!check.checked;sync();};cards.append(card);
          if(visible.length<=10||previews.has(option.value))hydrate(card,check,option);
          else{card.setAttribute('aria-busy','true');const pending=document.createElement('span');pending.dataset.sourcePreview='';pending.className='dropdown-source-row-preview';pending.textContent='Loading preview…';card.append(pending);waiting.set(card,()=>hydrate(card,check,option));observer.observe(card);}
        }
        if(!visible.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No matching sources';cards.append(empty);}sync();
      };
      d.querySelector<HTMLButtonElement>('#no-dropdown')!.onclick=()=>{selectedSources.clear();sync();};
      mountSourcePicker(d,{grid:dropdownAssignmentGrid,changeView:grid=>{dropdownAssignmentGrid=grid;},render:setView});
      d.querySelector('form')!.onsubmit=e=>{
        e.preventDefault();
        try{
          const chosen=options.filter(o=>selectedSources.has(o.value)),args=chosen.map(o=>{if(!o.ast)throw Error(o.error??'Choose an available source.');validationChoices(book,{id:'assignment',rows:scope.rows,columns:scope.columns,sheet:s.id,source:JSON.stringify(o.ast)},scope.rows[0],scope.columns[0],engine);return o.ast;});
          const ast:Ast|undefined=args.length>1?{kind:'call',name:'VSTACK',args}:args[0];if(assignDropdown(ast,chosen[0]?.value??'manual'))d.close();
        }catch(error){const message=d.querySelector<HTMLElement>('#dropdown-assignment-error')!;message.textContent=String(error);message.hidden=false;flash(error);}
      };
    });
  }catch(e){flash(e);}
}
function selectedReferenceRows():string[]{
  const view=gridReference(),b=bounds();if(!view?.table)throw Error('No editable source is available.');
  const ids=selectedAxisIndices('row').map(i=>sheet().rows[i]).filter(r=>view.rows.includes(r.id)).map(r=>r.id);
  if(ids.includes(view.table.header)||!ids.length)throw Error('Select option rows, not the list header.');
  return ids;
}
function dropRows(ids:string[],boundary:number):void{
  if(!sheetAxisSelectionAllowed('Moving rows'))return;
  if(!editableReference()){flash('Edit the live list source instead.');return;}
  const owner=scopedSelectionTable();if(owner){runTableEdit(owner.id,'row',{kind:'move',ids,boundary:projectedBoundary(owner.id,'row',boundary)},'Move table rows');return;}
  movingRows=undefined;extraSelections=[];mutate('Move rows',()=>{
    const scope=gridReference()?.table,group=moveTargetGroups(sheet(),'row',ids,boundary,scope).filter(g=>g.collapsed).sort((a,b)=>a.members.length-b.members.length)[0];
    const at=group?moveIntoGroup(book,sheet(),'row',ids,group.id,scope):moveRows(book,sheet(),ids,boundary,scope);
    selected={r:at+ids.length-1,c:sheet().columns.length-1};anchor={r:at,c:0};selectionKind='rows';renderedTarget=`${sheetId}:${selected.r}`;scrollTarget=undefined;
  });
}
function paintMoving():void{
  const s=sheet();
  root.querySelectorAll<HTMLElement>('td[data-r]').forEach(el=>el.classList.toggle('moving',!!movingRows?.includes(s.rows[Number(el.dataset.r)]?.id)||!!movingColumns?.includes(s.columns[Number(el.dataset.c)]?.id)));
  root.querySelectorAll<HTMLElement>('[data-col]').forEach(el=>el.classList.toggle('moving',!!movingColumns?.includes(s.columns[Number(el.dataset.col)]?.id)));
  root.querySelectorAll<HTMLElement>('[data-row-select]').forEach(el=>el.classList.toggle('moving',!!movingRows?.includes(s.rows[Number(el.dataset.rowSelect)]?.id)));
  root.querySelector('.grid')?.classList.toggle('rearranging',!!movingRows||!!movingColumns);
  if(!movingRows&&!movingColumns)clearMovePreview();else paintMovePreview();
}
function clearMovePreview():void{
  cancelAnimationFrame(movePaintFrame);movePaintFrame=0;
  movePreview=undefined;boundaryPreview=undefined;root.querySelector('.move-drop-guide')?.remove();
  edgeMoveGroups=undefined;
  root.querySelectorAll<HTMLElement>('.group-drop-target').forEach(el=>{el.classList.remove('group-drop-target');delete el.dataset.dropGroup;});
  root.querySelectorAll('.group-context-outline,.group-summary-drop-outline').forEach(el=>el.remove());
}
function mountMoveAutoScroll(grid:HTMLElement):()=>void{
  const controller=new AbortController(),options={capture:true,signal:controller.signal};
  let frame=0,axis:Group['axis']|undefined,x=0,y=0,previous=0;
  const stop=()=>{cancelAnimationFrame(frame);frame=0;axis=undefined;previous=0;};
  const velocity=()=>{
    const bounds=grid.getBoundingClientRect();
    if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)return 0;
    const position=axis==='row'?y:x,min=axis==='row'?bounds.top:bounds.left,max=axis==='row'?bounds.bottom:bounds.right;
    const band=Math.min(48,(max-min)/3);
    return position<min+band?-24*Math.min(1,(min+band-position)/band):position>max-band?24*Math.min(1,(position-max+band)/band):0;
  };
  const preview=()=>{
    if(!axis)return;
    const target=document.elementFromPoint(x,y);if(!target||!grid.contains(target))return;
    const group=moveGroupAt(target,axis,x,y);if(group){showGroupMovePreview(axis,group);return;}
    const header=target.closest<HTMLElement>(axis==='row'?'[data-row-select]':'th[data-col]');
    const cell=target.closest<HTMLElement>('td[data-r][data-c]'),element=header??cell;if(!element)return;
    const rect=element.getBoundingClientRect(),index=Number(axis==='row'?header?.dataset.rowSelect??cell!.dataset.r:header?.dataset.col??cell!.dataset.c);
    const after=axis==='row'?y>=rect.top+rect.height/2:x>=rect.left+rect.width/2;
    showMovePreview(axis,index+Number(after),index,after);
  };
  const tick=(now:number)=>{
    frame=0;
    if(!grid.isConnected||!axis||!(axis==='row'?movingRows:movingColumns)){stop();return;}
    const speed=velocity();if(!speed){previous=0;return;}
    const elapsed=previous?Math.min(50,now-previous):1000/60;previous=now;
    const before=axis==='row'?grid.scrollTop:grid.scrollLeft;
    if(axis==='row')grid.scrollTop+=speed*elapsed/(1000/60);else grid.scrollLeft+=speed*elapsed/(1000/60);
    const after=axis==='row'?grid.scrollTop:grid.scrollLeft;
    preview();
    if(after!==before)frame=requestAnimationFrame(tick);else previous=0;
  };
  document.addEventListener('dragover',event=>{
    const next=event.dataTransfer?.types.includes('application/x-fnt-rows')?'row':event.dataTransfer?.types.includes('application/x-fnt-columns')?'column':undefined;
    if(!next){stop();return;}axis=next;x=event.clientX;y=event.clientY;
    if(!velocity()){cancelAnimationFrame(frame);frame=0;previous=0;return;}
    event.preventDefault();if(!frame)frame=requestAnimationFrame(tick);
  },options);
  for(const event of ['drop','dragend'])document.addEventListener(event,stop,options);
  for(const type of ['keydown','keyup'] as const)document.addEventListener(type,event=>{if(event.key==='Escape')stop();},options);
  document.addEventListener('pointercancel',stop,options);
  window.addEventListener('blur',stop,{signal:controller.signal});
  return()=>{stop();controller.abort();};
}
function bindMoveBoundaryPreview(el:HTMLElement,axis:'row'|'column',boundary:number,index:number,after:boolean):void{
  const show=()=>showMovePreview(axis,boundary,index,after);
  el.addEventListener('pointerenter',show);el.addEventListener('focus',show);
}
function showMovePreview(axis:'row'|'column',boundary:number,index:number,after:boolean):void{
  edgeMoveGroups=undefined;
  const ids=axis==='row'?movingRows:movingColumns;if(!ids)return;
  if(boundaryPreview?.axis===axis&&boundaryPreview.ids===ids&&boundaryPreview.generation===generation&&boundaryPreview.boundary===boundary&&boundaryPreview.index===index&&boundaryPreview.after===after){scheduleMovePaint();return;}
  boundaryPreview={axis,boundary,index,after,generation,ids};
  try{
    const group=moveTargetGroups(sheet(),axis,ids,boundary,axis==='row'?gridReference()?.table:undefined).filter(g=>g.collapsed).sort((a,b)=>a.members.length-b.members.length)[0];
    if(group){showGroupMovePreview(axis,group.id);return;}
  }catch(error){clearMovePreview();flash(error);return;}
  movePreview={axis,boundary,index,after};scheduleMovePaint();
}
function scheduleMovePaint():void{
  if(!movePaintFrame)movePaintFrame=requestAnimationFrame(()=>{movePaintFrame=0;paintMovePreview();});
}
function moveGroupAt(element:Element,axis:'row'|'column',x:number,y:number):string|undefined{
  edgeMoveGroups=undefined;
  if(element.closest('[data-move-row],[data-move-column],[data-insert-row],[data-insert-column]'))return;
  const s=sheet(),button=element.closest<HTMLElement>('.group-control[data-group-id]');
  if(button&&s.groups.some(g=>g.id===button.dataset.groupId&&g.axis===axis&&(g.kind==='summary'||g.collapsed)))return button.dataset.groupId;
  const grid=root.querySelector<HTMLElement>('#grid-scroll');if(!grid)return;
  const header=element.closest<HTMLElement>(axis==='row'?'[data-row-select]':'thead [data-col]');
  const cell=element.closest<HTMLElement>('td[data-r][data-c]')??(header?grid.querySelector<HTMLElement>(axis==='row'?`td[data-r="${header.dataset.rowSelect}"][data-c="${grid.dataset.firstColumn}"]`:`tbody td[data-c="${header.dataset.col}"]`):null);if(!cell)return;
  const rect=(header??cell).getBoundingClientRect(),fraction=axis==='row'?(y-rect.top)/rect.height:(x-rect.left)/rect.width;
  const items=axis==='row'?s.rows:s.columns,index=Number(axis==='row'?cell.dataset.r:cell.dataset.c);
  if(fraction>.75){
    const moving=new Set(axis==='row'?movingRows:movingColumns),scope=scopedSelectionTable()?.id;
    const groups=moveEdgeTargets(axis,index).filter(group=>
      (!scope||group.table===scope)&&groupContainsCell(book,s,group,s.rows[Number(cell.dataset.r)].id,s.columns[Number(cell.dataset.c)].id)&&
      !(group.kind==='summary'&&moving.has(group.members[0]))&&
      ![...(group.kind==='summary'?[group.members[0]]:[]),...outlineMembers(group,s.groups)].every(id=>moving.has(id))
    ).sort((a,b)=>a.members.length-b.members.length);
    if(groups.length){edgeMoveGroups=groups.map(group=>group.id);return groups[0].id;}
  }
  if(fraction<.25||fraction>.75)return;
  return s.groups.filter(g=>{
    if(g.axis!==axis||g.kind!=='summary'&&!g.collapsed||(g.kind==='summary'?g.members[0]:items.find(item=>g.members.includes(item.id))?.id)!==items[index]?.id)return false;
    if(g.table){
      const owner=allTables(book).find(table=>table.id===g.table&&table.sheet===s.id);if(!owner)return false;
      return axis==='row'?owner.columns.some(field=>field.column===s.columns[Number(cell.dataset.c)].id):owner.header===s.rows[Number(cell.dataset.r)].id;
    }
    return axis==='row'?cell.dataset.c===grid.dataset.firstColumn:cell.dataset.r===grid.dataset.firstRow;
  }).sort((a,b)=>a.members.length-b.members.length)[0]?.id;
}
function moveEdgeTargets(axis:Group['axis'],index:number):Group[]{
  if(!groupEdgeTargets){
    groupEdgeTargets=new Map();const s=sheet();
    for(const axis of ['row','column'] as const){
      const items=axis==='row'?s.rows:s.columns,visible=axis==='row'?navigationRows:navigationColumns,positions=new Map(visible.map(index=>[items[index].id,index])),indices=new Map(items.map((item,index)=>[item.id,index])),tables=new Map<string,Map<string,number>>(),targets=new Map<number,Group[]>();
      for(const group of s.groups.filter(group=>group.axis===axis)){
        let lookup=positions;
        if(group.table){
          let mapped=tables.get(group.table);
          if(!mapped){mapped=new Map();for(const index of visible){const source=groupProjection?.axis(group.table,axis,items[index].id);if(source)mapped.set(source,indices.get(source)!);}tables.set(group.table,mapped);}
          lookup=mapped;
        }
        let last=-1;for(const id of [...(group.kind==='summary'?[group.members[0]]:[]),...outlineMembers(group,s.groups)])last=Math.max(last,lookup.get(id)??-1);
        if(last>=0){const groups=targets.get(last)??[];groups.push(group);targets.set(last,groups);}
      }
      groupEdgeTargets.set(axis,targets);
    }
  }
  return groupEdgeTargets.get(axis)?.get(index)??[];
}
function showGroupMovePreview(axis:'row'|'column',groupId:string):void{
  const ids=axis==='row'?movingRows:movingColumns;if(!ids)return;
  if(movePreview?.axis===axis&&movePreview.groupId===groupId&&previewGeneration===generation){scheduleMovePaint();return;}
  previewGeneration=generation;
  try{
    const scope=groupMoveOwner(axis,ids,groupId);
    const target=groupMoveTarget(scope?{...sheet(),groups:sheet().groups.filter(group=>group.table===scope.id)}:sheet(),axis,ids,groupId,scope??(axis==='row'?gridReference()?.table:undefined));movePreview={axis,groupId,boundary:target.boundary,index:0,after:false};scheduleMovePaint();
  }
  catch(error){clearMovePreview();flash(error);}
}
function groupMoveOwner(axis:'row'|'column',ids:string[],groupId:string){
  const destination=sheet().groups.find(group=>group.id===groupId&&group.axis===axis),selectedOwner=scopedSelectionTable();
  if(!destination)throw Error('The destination group is no longer available.');
  if(selectedOwner&&destination.table!==selectedOwner.id)throw Error('Move members within the selected table. Other table and sheet groups remain separate.');
  const owner=selectedOwner??allTables(book).find(table=>table.id===destination.table);
  if(owner&&ids.some(id=>!(axis==='row'?owner.rows:owner.columns.map(field=>field.column)).includes(id)))throw Error('Select only members of the destination table.');
  if(owner&&!selectedOwner&&ids.some(id=>groupProjection?.axis(owner.id,axis,id)!==id))throw Error('Sheet axes and displayed table members differ because this table is compacted. Turn on Table selection to move its visible records or fields.');
  return owner;
}
function dropIntoGroup(axis:'row'|'column',ids:string[],groupId:string):void{
  if(edgeMoveGroups&&edgeMoveGroups.length>1&&edgeMoveGroups.includes(groupId)){
    const groups=edgeMoveGroups.map(id=>sheet().groups.find(group=>group.id===id)!).filter(Boolean);edgeMoveGroups=undefined;
    const d=dialog('Append inside which group?',`<div class="menu">${groups.map(group=>{
      const s=sheet(),owner=group.table?allTables(book).find(t=>t.id===group.table):undefined;
      const r=axis==='row'?s.rows.findIndex(row=>row.id===group.members[0]):s.rows.findIndex(row=>row.id===(owner?.header??s.rows[0].id));
      const c=axis==='column'?s.columns.findIndex(column=>column.id===group.members[0]):s.columns.findIndex(column=>column.id===(owner?.columns[0]?.column??s.columns[0].id));
      return`<button type="button" data-append-group="${esc(group.id)}">${esc(cellText(getCell(s,s.rows[r].id,s.columns[c].id),s,r,c)||'(blank)')}<small>${esc(owner?.name??'Sheet group')}</small></button>`;
    }).join('')}</div>`);
    d.classList.add('popover');const heading=d.querySelector('.dialog-title')!;heading.outerHTML=`<h2 class="dialog-title">Append inside which group?</h2>`;
    let committed=false;d.addEventListener('close',()=>{if(!committed){movingRows=movingColumns=undefined;clearMovePreview();paintMoving();}});
    d.querySelectorAll<HTMLElement>('[data-append-group]').forEach(button=>{
      const preview=()=>{if(axis==='row'){movingRows=ids;movingColumns=undefined;}else{movingColumns=ids;movingRows=undefined;}showGroupMovePreview(axis,button.dataset.appendGroup!);};
      button.onpointerenter=preview;button.onfocus=preview;
      button.onclick=()=>{committed=true;d.close();edgeMoveGroups=undefined;dropIntoGroup(axis,ids,button.dataset.appendGroup!);};
    });return;
  }
  if(!sheetAxisSelectionAllowed('Moving sheet axes'))return;
  if(!editableReference()){flash('Edit the live list source instead.');return;}
  let owner:ReturnType<typeof scopedSelectionTable>;
  try{owner=groupMoveOwner(axis,ids,groupId);}catch(error){movingRows=movingColumns=undefined;clearMovePreview();paintMoving();flash(error);return;}
  if(owner){
    try{
      const target=groupMoveTarget({...sheet(),groups:sheet().groups.filter(group=>group.table===owner.id)},axis,ids,groupId,owner);
      runTableEdit(owner.id,axis,{kind:'move',ids,boundary:target.boundary,group:groupId},'Move table members into group');
    }catch(error){flash(error);}return;
  }
  movingRows=movingColumns=undefined;extraSelections=[];clearMovePreview();
  mutate(`Move ${axis==='row'?'rows':'columns'} into group`,()=>{
    const at=moveIntoGroup(book,sheet(),axis,ids,groupId,axis==='row'?gridReference()?.table:undefined);
    if(axis==='row')selected.r=at;else selected.c=at;
    anchor={...selected};selectionKind=axis==='row'?'rows':'columns';renderedTarget=`${sheetId}:${selected.r}`;scrollTarget=undefined;
  });
}
function paintMovePreview():void{
  const target=movePreview,grid=root.querySelector<HTMLElement>('#grid-scroll'),table=grid?.querySelector<HTMLElement>('.grid');
  if(!target||!grid||!table)return;
  const ids=target.axis==='row'?movingRows:movingColumns;if(!ids)return;
  if(target.groupId){
    grid.querySelector('.move-drop-guide')?.remove();
    grid.querySelectorAll('.group-context-outline,.group-summary-drop-outline').forEach(el=>el.remove());
    grid.querySelectorAll<HTMLElement>('.group-drop-target').forEach(el=>{el.classList.remove('group-drop-target');delete el.dataset.dropGroup;});
    const s=sheet(),group=s.groups.find(g=>g.id===target.groupId&&g.axis===target.axis);if(!group)return;
    highlightMoveGroup(grid,table,target.axis,group);return;
  }
  const host=target.axis==='row'?table.querySelector<HTMLElement>(`[data-row-select="${target.index}"]`):target.index<0?table.querySelector<HTMLElement>('.corner'):table.querySelector<HTMLElement>(`thead [data-col="${target.index}"]`);
  grid.querySelector('.move-drop-guide')?.remove();
  grid.querySelectorAll('.group-context-outline,.group-summary-drop-outline').forEach(el=>el.remove());
  grid.querySelectorAll<HTMLElement>('.group-drop-target').forEach(el=>{el.classList.remove('group-drop-target');delete el.dataset.dropGroup;});
  if(!host)return;
  const rect=host.getBoundingClientRect(),view=grid.getBoundingClientRect(),box=table.getBoundingClientRect(),guide=document.createElement('div');
  guide.className='move-drop-guide';guide.dataset.axis=target.axis;guide.setAttribute('aria-hidden','true');
  const x=(target.axis==='column'?(target.after?rect.right:rect.left):box.left)-view.left+grid.scrollLeft-grid.clientLeft;
  const y=(target.axis==='row'?(target.after?rect.bottom:rect.top):box.top)-view.top+grid.scrollTop-grid.clientTop;
  Object.assign(guide.style,{left:x+'px',top:y+'px',width:(target.axis==='row'?box.width:2)+'px',height:(target.axis==='column'?box.height:2)+'px'});
  grid.append(guide);
  try{
    const group=moveTargetGroups(sheet(),target.axis,ids,target.boundary,target.axis==='row'?gridReference()?.table:undefined).sort((a,b)=>a.members.length-b.members.length)[0];
    if(group){highlightMoveGroup(grid,table,target.axis,group);if(group.collapsed)guide.remove();}
  }catch(error){clearMovePreview();flash(error);}
}
function highlightMoveGroup(grid:HTMLElement,table:HTMLElement,axis:'row'|'column',group:Group):void{
  const s=sheet(),items=axis==='row'?s.rows:s.columns,id=group.kind==='summary'?group.members[0]:items.find(item=>group.members.includes(item.id))?.id,at=items.findIndex(item=>item.id===id);
  let row=axis==='row'?at:Number(grid.dataset.firstRow),column=axis==='column'?at:Number(grid.dataset.firstColumn);
  if(group.table){
    const owner=allTables(book).find(table=>table.id===group.table&&table.sheet===s.id);if(!owner)return;
    const host=table.querySelector<HTMLElement>(`.group-control[data-group-id="${group.id}"]`)?.closest<HTMLElement>('td[data-r][data-c]');
    if(host){row=Number(host.dataset.r);column=Number(host.dataset.c);}
    else if(axis==='row')column=s.columns.findIndex(column=>owner.columns.some(field=>field.column===column.id));
    else row=s.rows.findIndex(row=>row.id===owner.header);
  }
  if(group.kind!=='summary'){
    const hint=table.querySelector<HTMLElement>(`.group-control[data-group-id="${group.id}"]`);
    if(axis==='row'&&!table.querySelector(`[data-row-select="${row}"]`)){const host=hint?.closest<HTMLElement>('tr[data-row]');if(host)row=Number(host.dataset.row);}
    if(axis==='column'&&!table.querySelector(`thead [data-col="${column}"]`)){const host=hint?.closest<HTMLElement>('thead [data-col]');column=host?Number(host.dataset.col):Number(grid.dataset.firstColumn);}
  }
  const cell=grid.querySelector<HTMLElement>(`td[data-r="${row}"][data-c="${column}"]`);
  if(cell){cell.classList.add('group-drop-target');cell.dataset.dropGroup=group.id;}
  const owner=group.table?allTables(book).find(t=>t.id===group.table&&t.sheet===s.id):undefined;
  const members=new Set([...(group.kind==='summary'?[group.members[0]]:[]),...outlineMembers(group,s.groups)]),ownerRows=owner?new Set([owner.header,...owner.rows]):undefined,ownerColumns=owner?new Set(owner.columns.map(field=>field.column)):undefined;
  const context:HTMLElement[]=[],summary:HTMLElement[]=[];
  for(const el of table.querySelectorAll<HTMLElement>('td[data-r][data-c]')){
    const displayRow=s.rows[Number(el.dataset.r)]?.id,displayColumn=s.columns[Number(el.dataset.c)]?.id;if(!displayRow||!displayColumn)continue;
    const source={row:displayRow,column:displayColumn};
    if(ownerRows&&!ownerRows.has(source.row)||ownerColumns&&!ownerColumns.has(source.column))continue;
    if(members.has(axis==='row'?source.row:source.column))context.push(el);
    if(group.kind==='summary'&&(axis==='row'?Number(el.dataset.r)===row:Number(el.dataset.c)===column))summary.push(el);
  }
  const outline=(cells:HTMLElement[],className:string)=>{
    if(!cells.length)return;
    const rects=cells.map(el=>el.getBoundingClientRect()),view=grid.getBoundingClientRect(),left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top)),right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom)),el=document.createElement('div');
    el.className=className;el.dataset.groupId=group.id;el.dataset.axis=axis;el.setAttribute('aria-hidden','true');
    Object.assign(el.style,{left:left-view.left+grid.scrollLeft-grid.clientLeft+'px',top:top-view.top+grid.scrollTop-grid.clientTop+'px',width:right-left+'px',height:bottom-top+'px'});
    grid.append(el);
  };
  outline(context,'group-context-outline');
  if(movePreview?.groupId&&group.kind==='summary')outline(summary,'group-summary-drop-outline');
}
function insertDimensions(axis:'row'|'column',boundary:number,requestedCount?:number):void{
  if(!referenceId&&(selectionScope||extraSelections.some(area=>area.table)))throw Error('Insertion changes whole sheet axes. Turn off Table selection and select sheet headers first.');
  const s=sheet(),b=bounds(),view=gridReference();
  const count=requestedCount??(axis==='row'&&selectionMode()==='rows'?selectedAxisIndices('row').filter(i=>!view||view.rows.includes(s.rows[i].id)).length:axis==='column'&&selectionMode()==='columns'?selectedAxisIndices('column').filter(i=>!view||view.columns.includes(s.columns[i].id)).length:1);
  extraSelections=[];
  if(axis==='column'){
    for(let i=0;i<count;i++)insertColumn(book,s,boundary+i,view?.table);
    if(count>1){anchor={r:0,c:boundary};selected={r:s.rows.length-1,c:boundary+count-1};selectionKind='columns';}
    else{selected.c=boundary;anchor={...selected};selectionKind='cells';}
  }else{
    const at=view?.table?Math.max(boundary,s.rows.findIndex(r=>r.id===view.table!.header)+1):boundary;
    let table=view?.table??tableAt(book,s.id,s.rows[Math.max(0,at-1)]?.id,s.columns[selected.c].id)??tableAt(book,s.id,s.rows[at]?.id,s.columns[selected.c].id);
    if(!view&&table?.header===s.rows[at]?.id)table=undefined;
    if(view)for(let i=0;i<count;i++)addRow(book,s,at+i,table);
    else insertSheetRows(book,s,at,count,table);
    selected.r=at+count-1;anchor={...selected};
    if(count>1){anchor={r:at,c:0};selected.c=s.columns.length-1;selectionKind='rows';}else selectionKind='cells';
    page=Math.floor(at/60);
  }
  renderedTarget=`${sheetId}:${selected.r}`;
}
  function resizeAxisAllowed(axis:'row'|'column',index:number):boolean{
    if(!tableSelectionMode||!headerSelectionTables(sheet(),allTables(book),axis,index).length)return true;
    flash(`A ${axis==='row'?'row height':'column width'} is shared across the sheet. Turn off Table selection to resize it.`);return false;
  }
  function bindResizeControls():void{
    root.querySelectorAll<HTMLElement>('[data-resize-column],[data-resize-row]').forEach(el=>{
      const axis=el.dataset.resizeColumn!==undefined?'column':'row',index=Number(el.dataset.resizeColumn??el.dataset.resizeRow);
      el.onpointerdown=e=>{
        e.stopPropagation();if(e.button!==0||busy||!editableReference()||!commitDraft()||!resizeAxisAllowed(axis,index))return;
        const s=sheet(),id=axis==='column'?s.columns[index].id:s.rows[index].id;
        const size=axis==='column'?s.columns[index].width??145:el.closest('tr')!.getBoundingClientRect().height;
        resizing={axis,id,sheet:s.id,start:size,size,position:axis==='column'?e.clientX:e.clientY,pointer:e.pointerId,capture:el};el.setPointerCapture(e.pointerId);
      };
      el.ondblclick=e=>{e.preventDefault();e.stopPropagation();if(!busy&&editableReference()&&commitDraft())autoFit(axis,index);};
      el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(!busy&&editableReference()&&commitDraft())autoFit(axis,index);}};
    });
  }
  function finishResize(commit:boolean):void{
    cancelAnimationFrame(resizePaintFrame);resizePaintFrame=0;
    const resize=resizing;if(!resize)return;resizing=undefined;
    if(resize.capture.hasPointerCapture(resize.pointer))resize.capture.releasePointerCapture(resize.pointer);
    if(resize.start===resize.size)return;
    if(!commit){render();return;}
    const s=allSheets(book).find(s=>s.id===resize.sheet)!;
    mutateMetadata(`Resize ${resize.axis}`,()=>{
      if(resize.axis==='column'){s.columns.find(c=>c.id===resize.id)!.width=resize.size;measuredRowHeights.clear();}
      else{s.rows.find(r=>r.id===resize.id)!.height=resize.size*3/4;measuredRowHeights.delete(resize.id);}
      renderedTarget=`${sheetId}:${selected.r}`;
    },[[...sheetPath(s),resize.axis==='column'?'columns':'rows',(resize.axis==='column'?s.columns:s.rows).findIndex(item=>item.id===resize.id),resize.axis==='column'?'width':'height']]);
  }
  root.addEventListener('pointermove',e=>{
    const resize=resizing;if(!resize||resize.pointer!==e.pointerId)return;e.preventDefault();
    resize.size=Math.max(resize.axis==='column'?24:20,Math.round(resize.start+(resize.axis==='column'?e.clientX:e.clientY)-resize.position));
    if(!resizePaintFrame)resizePaintFrame=requestAnimationFrame(()=>{resizePaintFrame=0;paintResize();});
  });
  function paintResize():void{
    const resize=resizing;if(!resize)return;
    const s=sheet(),at=resize.axis==='column'?s.columns.findIndex(c=>c.id===resize.id):s.rows.findIndex(r=>r.id===resize.id);
    if(resize.axis==='row'){
      const row=root.querySelector<HTMLElement>(`tr[data-row="${at}"]`);row?.style.setProperty('--row-height',resize.size+'px');
    }else{
      const headers=[...root.querySelectorAll<HTMLElement>('th[data-col]')],display=headers.findIndex(h=>Number(h.dataset.col)===at),col=root.querySelector('colgroup')?.children[display+1] as HTMLElement|undefined;
      if(col)col.style.width=resize.size+'px';
      let left=56;
      for(const header of headers)if((pinnedColumns.get(s.id)??[]).includes(s.columns[Number(header.dataset.col)].id)){
        header.style.left=left+'px';root.querySelectorAll<HTMLElement>(`td[data-c="${header.dataset.col}"]`).forEach(td=>td.style.left=left+'px');left+=Number(header.dataset.col)===at?resize.size:s.columns[Number(header.dataset.col)].width??145;
      }
    }
  }
  root.addEventListener('pointerup',e=>{if(resizing?.pointer===e.pointerId)finishResize(true);});
  root.addEventListener('pointercancel',e=>{if(resizing?.pointer===e.pointerId)finishResize(false);});
  function autoFit(axis:'column'|'row',index:number):void{
    if(!resizeAxisAllowed(axis,index))return;
    const s=sheet(),view=gridReference(),sample=root.querySelector<HTMLElement>('td[data-r]:not(.table-header)')??root.querySelector<HTMLElement>('td[data-r]'),style=sample?getComputedStyle(sample):getComputedStyle(root),canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    if(!context){flash('This browser cannot measure text for auto-fit.');return;}
    engine.beginPass();
    const font=(cell:Cell,header:boolean)=>`${cell.format?.italic?'italic ':''}${cell.format?.bold?'700':header?'600':'400'} ${style.fontSize} ${style.fontFamily}`;
    const memberships=tableGroupMembership(book,s),tables=memberships.map(entry=>entry.owner),tree=s.outlineView?.tree??true;
    const sheetLayouts=constantSummaryRowLayout(s.groups.filter(group=>!group.table),s.rows.map(row=>row.id),tree);
    const tableLayouts=new Map(tables.map(table=>[table.id,{
      column:navigationColumns.map(index=>s.columns[index].id).find(column=>table.columns.some(field=>field.column===column)&&groupProjection?.display(table.header,column)),
      rows:constantSummaryRowLayout(s.groups.filter(group=>group.table===table.id),[table.header,...table.rows],tree)
    }]));
    const contentInset=(row:string,column:string)=>{
      const owner=memberships.find(entry=>entry.rows.has(row)&&entry.columns.has(column))?.owner,layout=owner&&tableLayouts.get(owner.id);
      return(column===s.columns[navigationColumns[0]]?.id?sheetLayouts.get(row)?.inset??0:0)
        +(layout?.column===column?layout.rows.get(row)?.inset??0:0)
        +(row===s.rows[navigationRows[0]]?.id?s.groups.filter(group=>!group.table&&group.axis==='column'&&group.kind==='summary'&&group.members[0]===column).length*24:0)
        +(row===s.rows[navigationRows[0]]?.id&&column===s.columns[navigationColumns[0]]?.id&&s.groups.some(group=>group.kind==='summary')?24:0);
    };
    let size=axis==='column'?24:33;
    const widths=new Map<string,number>(),probes:HTMLElement[]=[];
    const measure=document.createElement('div');measure.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;box-sizing:border-box;padding:6px 10px;border:1px solid transparent;overflow-wrap:anywhere;';
    document.body.append(measure);
    try{
      const visibleRows=view&&new Set(view.rows),visibleColumns=view&&new Set(view.columns);
      const rows=axis==='row'?[index]:s.rows.map((r,i)=>!visibleRows||visibleRows.has(r.id)?i:-1).filter(i=>i>=0);
      const columns=axis==='column'?[index]:s.columns.map((c,i)=>!visibleColumns||visibleColumns.has(c.id)?i:-1).filter(i=>i>=0);
      const headers=new Set(allTables(book).filter(t=>t.sheet===s.id).flatMap(t=>t.columns.map(col=>key(t.header,col.column))));
      for(const r of rows)for(const c of columns){
        const cell=getCell(s,s.rows[r].id,s.columns[c].id),text=cellText(cell,s,r,c),header=headers.has(key(s.rows[r].id,s.columns[c].id));
        if(axis==='column'){
          context.font=font(cell,header);
          const lines=cell.format?.wrap?text.split(/\r?\n/):[text.replace(/[ \t\r\n\f]+/g,' ')];
          const inset=contentInset(s.rows[r].id,s.columns[c].id);
          for(const line of lines){const k=JSON.stringify([context.font,line]);let width=widths.get(k);if(width===undefined){width=context.measureText(line).width;widths.set(k,width);}size=Math.max(size,Math.ceil(width+22+inset));}
        }else{
          const probe=measure.cloneNode() as HTMLElement;probe.style.font=font(cell,header);probe.style.whiteSpace=cell.format?.wrap?'pre-wrap':'nowrap';probe.style.width=(s.columns[c].width??145)+'px';probe.style.paddingLeft=10+contentInset(s.rows[r].id,s.columns[c].id)+'px';probe.textContent=text;probes.push(probe);
        }
        if(probes.length){measure.append(...probes);for(const probe of probes)size=Math.max(size,Math.ceil(probe.getBoundingClientRect().height));}
      }
      if(!Number.isFinite(size))throw Error('The measured size is invalid.');
      mutateMetadata(`Auto-fit ${axis}`,()=>{if(axis==='column'){s.columns[index].width=size;measuredRowHeights.clear();}else{s.rows[index].height=size*3/4;measuredRowHeights.delete(s.rows[index].id);}renderedTarget=`${sheetId}:${selected.r}`;},[[...sheetPath(s),axis==='column'?'columns':'rows',index,axis==='column'?'width':'height']]);
    }catch(e){flash(e);}finally{measure.remove();}
  }
const selectedTabs=new Set<string>();let tabSelectionAnchor:string|undefined;
function openSheetTabSettings(ids?:string[]):void{
  const targets=book.sheets.filter(sheet=>ids?ids.includes(sheet.id):selectedTabs.has(sheet.id));
  if(!targets.length){const current=book.sheets.find(sheet=>sheet.id===sheetId);if(current)targets.push(current);}
  if(!targets.length){flash('Select a workbook sheet first.');return;}
  const initialGroup=book.sheetTabGroups?.[targets[0].id]??'',mixed=targets.some(sheet=>(book.sheetTabGroups?.[sheet.id]??'')!==initialGroup);
  dialog('Sheet settings',`<form id="sheet-tab-settings"><fieldset class="reference-selected-tabs"><legend>${targets.length>1?`Selected tabs (${targets.length})`:'Sheet'}</legend>${targets.map(sheet=>`<label><span>${esc(sheet.name)}</span><input data-sheet-name="${sheet.id}" aria-label="${esc(sheet.name)} sheet name" value="${esc(sheet.name)}" required></label>`).join('')}</fieldset><label>Visual group${targets.length>1?' (all selected tabs)':''}<input id="reference-group" value="${esc(mixed?'':initialGroup)}"${mixed?' data-empty-label="Mixed groups"':''} maxlength="120"></label><p class="muted">Visual organization only. Sheets, tables and formulas stay where they are. Shift-click tabs to organize several together.</p><div id="sheet-tab-settings-error" class="error" role="alert" hidden></div></form>`,d=>{
    d.classList.add('sheet-settings','reference-settings');
    mountGroupPicker(referenceHost(),d,[...new Set(Object.values(book.sheetTabGroups??{}))].sort((a,b)=>a.localeCompare(b)));
    const group=d.querySelector<HTMLInputElement>('#reference-group')!,names=[...d.querySelectorAll<HTMLInputElement>('[data-sheet-name]')],problem=d.querySelector<HTMLElement>('#sheet-tab-settings-error')!;
    const apply=()=>{
      const updates=new Map(names.map(input=>[input.dataset.sheetName!,input.value.trim()])),groupChanged=group.dataset.changed==='true',value=group.value.trim();
      const fail=(message:string)=>{problem.textContent=message;problem.hidden=false;return false;};
      if([...updates].some(([id,name])=>!name||!book.sheets.some(sheet=>sheet.id===id)))return fail('Use a nonempty name for each existing sheet.');
      const allNames=allSheets(book).map(sheet=>(updates.get(sheet.id)??sheet.name).toLowerCase());
      if(new Set(allNames).size!==allNames.length)return fail('Each sheet must have a unique name.');
      if(value.length>120)return fail('Use at most 120 characters for the visual group.');
      if(!groupChanged&&targets.every(sheet=>updates.get(sheet.id)===book.sheets.find(current=>current.id===sheet.id)?.name))return true;
      return mutate('Update sheet tab settings',()=>{
        for(const [id,name]of updates){
          book.sheets.find(sheet=>sheet.id===id)!.name=name;
          if(groupChanged){
            book.sheetTabGroups??={};
            const canonical=Object.values(book.sheetTabGroups).find(group=>group.toLowerCase()===value.toLowerCase())??value;
            if(canonical)book.sheetTabGroups[id]=canonical;else delete book.sheetTabGroups[id];
          }
        }
      });
    };
    const close=()=>{if(apply())d.close();};
    d.querySelector<HTMLButtonElement>('.close')!.onclick=close;
    d.addEventListener('cancel',e=>{e.preventDefault();close();});
    d.addEventListener('click',e=>{if(e.target===d){const rect=d.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)close();}});
    d.querySelector('form')!.onsubmit=e=>{e.preventDefault();close();};
  });
}
function selectedReferenceTabs():ReferenceSource[]{
  const selected=new Map<string,ReferenceSource>();
  const collect=(nodes:ReferenceNavigation[])=>{for(const node of nodes){if(selectedTabs.has(node.group?`group:${node.group}`:node.members[0].id))for(const source of node.members)selected.set(source.id,source);collect(node.children);}};collect(referenceNavigation(book));return[...selected.values()];
}
function bindTabs():void{
  root.querySelectorAll<HTMLButtonElement>('[data-sheet-group]').forEach(button=>{
    button.onclick=()=>{
      if(!commitDraft())return;const group=button.dataset.sheetGroup!;
      selectedTabs.clear();
      book.sheetTabCollapsed=book.sheetTabCollapsed?.includes(group)?book.sheetTabCollapsed.filter(name=>name!==group):[...book.sheetTabCollapsed??[],group];
      changed('Toggle visual sheet group',false,false,capturePatch(book,[['sheetTabCollapsed']]));render();
    };
    button.ondblclick=()=>openSheetTabSettings(book.sheets.filter(sheet=>book.sheetTabGroups?.[sheet.id]===button.dataset.sheetGroup).map(sheet=>sheet.id));
    button.oncontextmenu=e=>{e.preventDefault();openSheetTabSettings(book.sheets.filter(sheet=>book.sheetTabGroups?.[sheet.id]===button.dataset.sheetGroup).map(sheet=>sheet.id));};
  });
  const entries=[...root.querySelectorAll<HTMLElement>('[data-sheet],[data-reference]')],token=(el:HTMLElement)=>el.dataset.referenceGroup?`group:${el.dataset.referenceGroup}`:el.dataset.reference??el.dataset.sheet!;
  for(const id of selectedTabs)if(!entries.some(el=>token(el)===id))selectedTabs.delete(id);
  const highlight=()=>entries.forEach(el=>{const selected=selectedTabs.size>1&&selectedTabs.has(token(el));el.classList.toggle('tab-multi-selected',selected);el.setAttribute('aria-pressed',String(selected));});
  entries.forEach(el=>{
    const reference=!!el.dataset.reference,mime=reference?'application/x-fnt-reference':'application/x-fnt-sheet',id=el.dataset.reference??el.dataset.sheet!;
    const group=el.dataset.referenceGroup;
    if(group)el.setAttribute('aria-expanded',String(book.pickerSources[`dd-group-collapsed:${group.toLowerCase()}`]!=='true'));
    el.onclick=e=>{if((e.target as HTMLElement).closest('input')||!commitDraft())return;
      if(e.shiftKey){e.preventDefault();const visible=entries.filter(entry=>entry.getClientRects().length>0),at=visible.findIndex(entry=>token(entry)===(tabSelectionAnchor??referenceId??sheetId)),end=visible.indexOf(el);selectedTabs.clear();for(const entry of visible.slice(Math.min(at<0?end:at,end),Math.max(at<0?end:at,end)+1))selectedTabs.add(token(entry));highlight();return;}
      selectedTabs.clear();selectedTabs.add(token(el));tabSelectionAnchor=token(el);highlight();
      if(group){const key=`dd-group-collapsed:${group.toLowerCase()}`;book.pickerSources[key]=book.pickerSources[key]==='true'?'false':'true';changed('Toggle dropdown group',false,false,capturePatch(book,[['pickerSources']]));render();}else if(reference){if(referenceId!==id)openReferences(id);}else if(sheetId!==id){
        rememberView();sheetId=id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';
        let view:{scroll:number;left:number}|undefined;
        try{const saved=sessionStorage.getItem(`fnt-sheet-view:${book.id}:${id}`);if(saved)view=restoreView(undefined,saved);}catch(e){flash(e);}
        render();if(view){const grid=root.querySelector<HTMLElement>('#grid-scroll')!;grid.scrollTop=view.scroll;grid.scrollLeft=view.left;drawRowWindow?.();rememberView();}
      }};
    el.ondblclick=()=>inlineTabName(el);
    el.oncontextmenu=e=>{e.preventDefault();if(commitDraft())tabMenu(el,e.clientX,e.clientY);};
    el.onkeydown=e=>{if(e.key==='F2'){e.preventDefault();inlineTabName(el);}else if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();const rect=el.getBoundingClientRect();tabMenu(el,rect.left,rect.top);}};
    el.draggable=true;
    el.ondragstart=e=>{if(!commitDraft()){e.preventDefault();return;}if(!selectedTabs.has(token(el))){selectedTabs.clear();selectedTabs.add(token(el));highlight();}e.dataTransfer?.setData(mime,group?`group:${group}`:id);e.dataTransfer?.setData(mime+'-selection',JSON.stringify(entries.filter(entry=>selectedTabs.has(token(entry))).map(token)));if(e.dataTransfer)e.dataTransfer.effectAllowed='move';};
    const hide=()=>{const marker=root.querySelector<HTMLElement>('.tab-drop-marker');if(marker)marker.hidden=true;root.querySelectorAll('.tab-nest-target').forEach(node=>node.classList.remove('tab-nest-target'));};
    el.ondragend=hide;el.ondragleave=hide;
    el.ondragover=e=>{if(!e.dataTransfer?.types.includes(mime))return;e.preventDefault();hide();const marker=root.querySelector<HTMLElement>('.tab-drop-marker')!,rect=el.getBoundingClientRect(),tabs=el.closest<HTMLElement>('.tabs')!,fraction=(e.clientX-rect.left)/rect.width;if(group&&fraction>.25&&fraction<.75){el.classList.add('tab-nest-target');return;}marker.style.left=rect.left-tabs.getBoundingClientRect().left+tabs.scrollLeft+(e.clientX>=rect.left+rect.width/2?rect.width:0)-2+'px';marker.hidden=false;};
    el.ondrop=e=>{const moving=e.dataTransfer?.getData(mime);if(!moving)return;e.preventDefault();hide();mutate('Reorder tabs',()=>{
      const encoded=e.dataTransfer?.getData(mime+'-selection'),multiple=encoded?JSON.parse(encoded):[moving];if(!Array.isArray(multiple)||!multiple.every(id=>typeof id==='string'))throw Error('Invalid dragged tab selection.');
      if(reference){const rect=el.getBoundingClientRect(),fraction=(e.clientX-rect.left)/rect.width;reorderReferenceSelection(book,multiple,group?`group:${group}`:id,fraction>=.5,!!group&&fraction>.25&&fraction<.75);return;}
      if(multiple.length>1){const ids=new Set(multiple),movingSheets=book.sheets.filter(s=>ids.has(s.id)),remaining=book.sheets.filter(s=>!ids.has(s.id));if(movingSheets.length!==ids.size)throw Error('A selected sheet no longer exists.');if(ids.has(id))return;const index=remaining.findIndex(s=>s.id===id)+(e.clientX>=el.getBoundingClientRect().left+el.getBoundingClientRect().width/2?1:0);remaining.splice(index,0,...movingSheets);book.sheets=remaining;return;}
      const items=reference?book.references!:book.sheets,from=items.findIndex(s=>s.id===moving),to=items.findIndex(s=>s.id===id);if(from<0||to<0)throw Error('The dragged tab no longer exists.');
      const boundary=to+(e.clientX>=el.getBoundingClientRect().left+el.getBoundingClientRect().width/2?1:0);
      move<Sheet|ReferenceSource>(items,from,boundary-(from<boundary?1:0));
    });};
  });
  highlight();
}
function inlineTabName(el:HTMLElement):void{
  if(!commitDraft())return;
  const reference=!!el.dataset.reference,id=el.dataset.reference??el.dataset.sheet!,entry=reference?book.references?.find(s=>s.id===id):allSheets(book).find(s=>s.id===id);if(!entry)return;
  const group=el.dataset.referenceGroup,style=getComputedStyle(el),pseudo=getComputedStyle(el,'::before'),width=el.getBoundingClientRect().width,contentWidth=Math.max(1,width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth)-(pseudo.content==='none'?0:parseFloat(pseudo.width)+parseFloat(pseudo.marginRight)));
  el.draggable=false;el.style.minWidth=width+'px';const input=document.createElement('input');input.value=group?group.split(' / ').at(-1)!:(reference?referenceLabel(entry as ReferenceSource):entry.name);input.style.width=contentWidth+'px';input.setAttribute('aria-label',group?'Rename group':reference?'Rename list':'Rename sheet');el.replaceChildren(input);input.onclick=e=>e.stopPropagation();
  const measure=document.createElement('canvas').getContext('2d')!;measure.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;input.oninput=()=>{input.style.width=Math.max(contentWidth,Math.ceil(measure.measureText(input.value).width)+1)+'px';};input.focus();input.select();
  let done=false;
  const commit=()=>{if(done)return;done=true;const name=input.value.trim();if(!name){flash('Use a nonempty tab name.');render();return;}
    if(!mutate('Rename tab',()=>{if(group){renameReferenceGroup(book,group,name);return;}if(reference){const source=book.references?.find(s=>s.id===id);if(!source)throw Error('This list was removed.');setReferencePresentation(book,source,name,source.group);return;}const target=allSheets(book).find(s=>s.id===id);if(!target)throw Error('This tab was removed.');if(allSheets(book).some(s=>s.id!==id&&s.name.toLowerCase()===name.toLowerCase()))throw Error('That tab name is already in use.');target.name=name;})){done=false;input.focus();input.select();}
  };
  input.onblur=commit;input.onkeydown=e=>{e.stopPropagation();if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape'){done=true;render();}};
}
function tabMenu(el:HTMLElement,x:number,y:number):void{
  document.querySelector('.tab-context-menu')?.remove();const reference=!!el.dataset.reference,id=el.dataset.reference??el.dataset.sheet!,controller=new AbortController(),menu=document.createElement('div');
  menu.className='tab-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Tab commands');document.body.append(menu);
  const close=()=>{controller.abort();menu.remove();};
  const button=(text:string,fn:()=>void)=>{const b=document.createElement('button');b.textContent=text;b.setAttribute('role','menuitem');b.onclick=()=>{close();fn();};menu.append(b);};
  const items=()=>reference?book.references!:book.sheets;
  button('Rename',()=>inlineTabName(el));
  const group=el.dataset.referenceGroup;
  for(const [label,delta] of [['Move left',-1],['Move right',1]] as const)button(label,()=>mutate('Move tab',()=>{if(group){moveReferenceGroup(book,group,delta);return;}const list=items(),at=list.findIndex(s=>s.id===id);move<Sheet|ReferenceSource>(list,at,at+delta);}));
  if(group)button('Ungroup dropdowns',()=>mutate('Ungroup dropdowns',()=>{for(const source of book.references??[])if(source.group?.toLowerCase()===group.toLowerCase()||source.group?.toLowerCase().startsWith(group.toLowerCase()+' / '))source.group=[...group.split(' / ').slice(0,-1),...source.group!.slice(group.length).split(' / ').filter(Boolean)].join(' / ')||undefined;}));
  else if(reference){button('Group',()=>{const source=book.references?.find(s=>s.id===id);if(source)groupReference(referenceHost(),source);});button('Dropdown settings',()=>{const source=book.references?.find(s=>s.id===id),targets=selectedReferenceTabs();if(source)referenceSettings(referenceHost(),source,targets.some(s=>s.id===id)?targets:undefined);});button('Duplicate',()=>{const targets=selectedReferenceTabs(),source=book.references?.find(s=>s.id===id),copies:string[]=[];if(!source){flash('This DD no longer exists.');return;}if(mutate('Duplicate DD tabs',()=>{for(const target of targets.some(s=>s.id===id)?targets:[source])copies.push(duplicateReference(book,target).id);})){referenceHost().open(copies[0],copies);}});}
  else{
    button('Sheet settings',()=>openSheetTabSettings(selectedTabs.has(id)?undefined:[id]));
    button('Duplicate',()=>mutate('Duplicate sheet',()=>{const source=allSheets(book).find(s=>s.id===id);if(!source)throw Error('Sheet was removed.');sheetId=duplicateSheet(book,source).id;}));
    button('Tab color',()=>{const s=allSheets(book).find(s=>s.id===id)!;dialog('Tab color',`<form><label>Color<input type="color" id="sheet-color" value="${esc(s.color)}"></label><button class="primary">Apply color</button></form>`,d=>{d.querySelector('form')!.onsubmit=e=>{e.preventDefault();mutate('Tab color',()=>{s.color=d.querySelector<HTMLInputElement>('#sheet-color')!.value;});d.close();};});});
    button('Delete',()=>confirmAction('Delete sheet?', 'Deleted references become #REF!. Undo restores the complete sheet.',()=>mutate('Delete sheet',()=>{if(book.sheets.length===1)throw Error('Keep at least one sheet.');book.sheets=book.sheets.filter(s=>s.id!==id);replaceTables(book,allTables(book).filter(t=>t.sheet!==id));book.names=book.names.filter(n=>n.sheet!==id);if(sheetId===id){sheetId=book.sheets[0].id;selected={r:0,c:0};anchor={...selected};}})));
  }
  const rect=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(x,innerWidth-rect.width-4))+'px';menu.style.top=Math.max(4,Math.min(y,innerHeight-rect.height-4))+'px';
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target as Node))close();},{signal:controller.signal});
  menu.onkeydown=e=>{if(e.key==='Escape'||e.key==='Tab'){close();el.focus({preventScroll:true});e.stopPropagation();}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();const buttons=[...menu.querySelectorAll('button')],i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}};
  menu.querySelector('button')!.focus();
}
async function importReferenceSources(file?:File):Promise<void>{
  if(busy||!commitDraft())return;
  busy=true;status='Importing supporting sources locally - logs retained';renderStatus();
  let notice='';
  try{
    await flush();if(savedGeneration!==generation)throw Error('Save failed. Import cancelled.');
    const before=await store.backup({...state,book:clone(book)}),attached=before.originals.find(o=>o.id===book.importReport?.originalId);
    if(!file&&!attached)throw Error('Select the original local Excel file in this browser. Another browser profile’s attachment is not available here.');
    const bytes=file?await file.arrayBuffer():Uint8Array.from(atob(attached!.data),c=>c.charCodeAt(0)).buffer;
    const[{importXlsx},{mergeReferences}]=await Promise.all([import('./xlsx'),import('./references-import')]);
    const source=await importXlsx(bytes,file?.name??attached!.name,{sheets:['Ingredients','Dropdowns','Convert','MealDD']});
    if(source.nativeBackup)throw Error('Restore a Fnt native snapshot through File; supporting-source import requires the original Excel workbook.');
    const existing=before.originals.find(o=>o.data===source.original.data),original=existing?.id??source.original.id;
    const result=mergeReferences(book,source.book,original,!!existing);
    if(!result.changed){notice='These original sources are already imported. Current edits, labels and ordering were kept.';status='Saved in this browser - supporting sources already imported';return;}
    if(!result.book.importReport)result.book.importReport={originalId:original,entries:['Supporting sources imported locally; real logs and Ingredients were not imported.'],formulaCount:0,unsupported:{}};
    state=await store.save(result.book,state.version,'Supporting data import',true,existing?undefined:source.original,{localOnly:true,recoveryArchive:stringifyArchive(before)});
    token='';book=clone(state.book);engine=new Engine(book);generation++;savedGeneration=generation;undo.length=redo.length=0;selectionKind='cells';
    const lists=result.counts.filter(t=>t.name!=='Convert'),rules=result.counts.find(t=>t.name==='Convert')!;
    notice=`Imported ${lists.length} lists (${lists.map(t=>`${t.name}: ${t.rows}`).join(', ')}), ${rules.rows} conversion rules / ${rules.columns} fields. ${result.derivedUnavailable?'MealDD keeps its original definition but is unavailable until its actual source Meals is connected; example Meals were not linked.':'MealDD is connected to its original source.'} Full pre-import archive saved; sync disconnected.`;
    status='Saved in this browser - supporting sources imported; sync disconnected';channel?.postMessage({version:state.version});render();
  }catch(e){notice=e instanceof Error?e.message:String(e);status='Supporting import cancelled - previous data retained';flash(e);}
  finally{busy=false;renderStatus();openReferences(undefined,notice);}
}
function openFind():void {
  dialog('Find and Replace',`<div class="find-tabs" role="tablist" aria-label="Search mode"><button id="text-tab" role="tab" aria-controls="find-controls">Text</button><button id="membership-tab" role="tab" aria-controls="membership-panel">Rows/Columns</button></div>
    <div id="find-controls" class="find-controls" role="tabpanel"><label>Find<input id="find-text" type="search" autocomplete="off"></label><div id="replace-fields"></div>
    <details class="find-options" open><summary>Search options</summary><div class="find-selectors"><label>Within<select id="find-within"><option value="selected">Selected sheets</option><option value="workbook">Workbook</option></select></label><label>Direction<select id="find-direction"><option value="down">Down</option><option value="up">Up</option></select></label></div>
    <div class="find-flags"><label class="inline"><input id="find-case" type="checkbox">Match case</label><label class="inline"><input id="find-entire" type="checkbox">Match entire cell contents</label></div>
    <fieldset class="find-scope"><legend>Search sheets</legend><label class="inline"><input id="find-all-sheets" type="checkbox">All</label>${allSheets(book).map(s=>`<label class="inline"><input type="checkbox" name="scope" value="${s.id}" ${s.id===sheetId?'checked':''}>${esc(s.name)}</label>`).join('')}</fieldset></details></div>
    <div class="find-results-panel"><p id="find-count" role="status">Results found (0)</p><div id="find-results" class="find-results-scroll"></div><div class="find-pagination" hidden><button id="find-previous-page" aria-label="Previous results page">Previous</button><span id="find-page-count"></span><button id="find-next-page" aria-label="Next results page">Next</button></div></div>
    <p id="find-feedback" class="find-feedback" role="status"></p><div class="button-row find-actions"><button id="find-next" class="primary">Find next</button><button id="find-all">Find all</button><span id="replace-actions" class="button-row"></span></div>
    <div id="membership-panel" class="membership-panel" role="tabpanel" aria-labelledby="membership-tab" hidden>
      <div class="membership-tools"><button id="membership-scan">Scan workbook</button><span id="membership-count" role="status"></span></div>
      <div class="find-results-scroll membership-results"><table class="spreadsheet-grid find-results-table"><colgroup><col style="width:34px"><col style="width:60px"><col></colgroup><thead><tr><th><input type="checkbox" id="membership-all" aria-label="Select all membership results"></th><th scope="col">Position</th><th scope="col">Contents</th></tr></thead><tbody></tbody></table></div>
      <div class="find-pagination" id="membership-pagination" hidden><button id="membership-previous">Previous</button><span id="membership-page"></span><button id="membership-next">Next</button></div>
      <p class="find-feedback" id="membership-feedback" role="status"></p><div class="button-row"><button id="membership-convert" class="primary" disabled>Convert to table</button></div></div>`,d=>{
    d.classList.add('find-dialog');
    const field=<T extends HTMLElement>(id:string)=>d.querySelector<T>('#'+id)!;
    const input=field<HTMLInputElement>('find-text'),scopes=[...d.querySelectorAll<HTMLInputElement>('input[name=scope]')],all=field<HTMLInputElement>('find-all-sheets');
    const within=mountSelectDropdown(field<HTMLSelectElement>('find-within'));
    mountSelectDropdown(field<HTMLSelectElement>('find-direction'));
    type Match={sid:string;row:string;column:string;r:number;c:number;value:string};
    let matches:Match[]=[],active:string|undefined,resultPage=0,replacement='',searchVersion=0,searching=false;
    let previewObserver:IntersectionObserver|undefined,painted='';
    const searchTasks=new MessageChannel(),searchYields:(()=>void)[]=[];
    searchTasks.port1.onmessage=()=>searchYields.shift()?.();
    const yieldSearch=()=>new Promise<void>(resolve=>{searchYields.push(resolve);searchTasks.port2.postMessage(null);});
    d.addEventListener('close',()=>{searchVersion++;previewObserver?.disconnect();searchYields.splice(0).forEach(resolve=>resolve());searchTasks.port1.close();searchTasks.port2.close();},{once:true});
    const identity=(m:Match)=>`${m.sid}:${m.row}:${m.column}`;
    const source=(m:Match)=>allSheets(book).find(s=>s.id===m.sid)!;
    const literal=(m:Match)=>{const cell=getCell(source(m),m.row,m.column);return !cell.formula&&!cell.binding&&typeof cell.value==='string';};
    const matcher=()=>createTextSearch(input.value,{matchCase:field<HTMLInputElement>('find-case').checked,entire:field<HTMLInputElement>('find-entire').checked});
    const feedback=(text:string,bad=false)=>{const el=field('find-feedback');el.textContent=text;el.classList.toggle('bad',bad);el.setAttribute('role',bad?'alert':'status');};
    const buttons=()=>{
      field<HTMLButtonElement>('find-next').disabled=searching||!matches.length;
      field<HTMLButtonElement>('find-all').disabled=!input.value||!scopes.some(s=>s.checked);
      const current=matches.find(m=>identity(m)===active);
      const single=d.querySelector<HTMLButtonElement>('#replace-one'),multiple=d.querySelector<HTMLButtonElement>('#replace-all');
      if(single){single.disabled=searching||(current?!literal(current):!matches.some(literal));single.title='Replaces literal text only';}
      if(multiple)multiple.disabled=searching||!matches.some(literal);
    };
    const paint=()=>{
      const signature=`${searchVersion}:${resultPage}:${displayedVersion}`;
      if(painted===signature){
        field('find-results').querySelectorAll<HTMLElement>('[data-find-match]').forEach(row=>row.setAttribute('aria-selected',String(identity(matches[Number(row.dataset.findMatch)])===active)));buttons();return;
      }
      painted=signature;previewObserver?.disconnect();
      const search=matcher(),highlight=(value:string)=>{
        let end=0,html='';
        for(const range of search.ranges(value)){html+=esc(value.slice(end,range.start))+`<span class="find-match-text">${esc(value.slice(range.start,range.end))}</span>`;end=range.end;}
        return html+esc(value.slice(end));
      };
      type Preview={sheet:ReturnType<typeof source>;table:ReturnType<typeof tableAt>;start:number;items:{match:Match;index:number}[]};
      const previews=new Map<string,Preview>();
      const owners=allTables(book).map(table=>({table,rows:new Set([table.header,...table.rows]),columns:new Set(table.columns.map(c=>c.column))}));
      matches.slice(resultPage*200,resultPage*200+200).forEach((m,j)=>{
        const s=source(m),table=owners.find(owner=>owner.table.sheet===m.sid&&owner.rows.has(m.row)&&owner.columns.has(m.column))?.table,start=Math.max(0,Math.min(m.c-3,s.columns.length-8)),id=`${s.id}:${table?.id??'sheet'}:${start}`;
        if(!previews.has(id))previews.set(id,{sheet:s,table,start,items:[]});
        previews.get(id)!.items.push({match:m,index:resultPage*200+j});
      });
      let previous='';
      const results=[...previews.values()].map(({sheet:s,table,start,items})=>{
        const sheetHeading=previous===s.id?'':`<div class="find-sheet-header">${esc(s.name)}</div>`;previous=s.id;
        const columns=s.columns.slice(start,start+8),headers=table?columns.map(column=>`<th scope="col">${esc(table.columns.find(field=>field.column===column.id)?.name??'')}</th>`).join(''):`<th scope="colgroup" colspan="${columns.length}">Row preview (up to 8 cells)</th>`;
        const matchedColumns=new Set(items.map(({match})=>match.column)),widths=columns.map(column=>matchedColumns.has(column.id)?160:110),width=50+widths.reduce((sum,width)=>sum+width,0);
        const rows=items.map(({match:m,index})=>{
          const preview=columns.map((column,offset)=>{
            const c=start+offset,address=`${letters(c)}${m.r+1}`,matched=column.id===m.column;
            return`<td data-find-context="${address}" data-find-column="${c}" class="${matched?'find-context-match':''}" aria-label="${address}${matched?', matched cell':''}">${matched?highlight(m.value):''}</td>`;
          }).join('');
          return`<tr data-find-match="${index}" tabindex="0" aria-label="Match ${letters(m.c)}${m.r+1}" aria-selected="${identity(m)===active}"><th scope="row">${letters(m.c)}${m.r+1}</th>${preview}</tr>`;
        }).join('');
        return`${sheetHeading}${table?`<div class="find-table-header">Table: ${esc(table.name)}</div>`:''}<table class="spreadsheet-grid find-results-table find-row-results" style="--find-preview-width:${width}px" ${table?`data-find-table="${esc(table.id)}"`:''} aria-label="${esc(table?.name??s.name)} result previews"><colgroup><col style="width:50px">${widths.map(width=>`<col style="width:${width}px">`).join('')}</colgroup><thead><tr><th scope="col">Cell</th>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
      }).join('');
      field('find-results').innerHTML=results;
      const paintedVersion=searchVersion;
      previewObserver=new IntersectionObserver(entries=>{
        if(paintedVersion!==searchVersion)return;
        for(const entry of entries)if(entry.isIntersecting){
          const row=entry.target as HTMLElement,m=matches[Number(row.dataset.findMatch)],s=source(m);
          row.querySelectorAll<HTMLElement>('[data-find-column]').forEach(cell=>{
            const c=Number(cell.dataset.findColumn),value=cellText(getCell(s,m.row,s.columns[c].id),s,m.r,c);
            cell.title=value;cell.innerHTML=s.columns[c].id===m.column?highlight(value):esc(value);
          });previewObserver!.unobserve(row);
        }
      },{root:field('find-results'),rootMargin:'150px'});
      field('find-results').querySelectorAll('[data-find-match]').forEach(row=>previewObserver!.observe(row));
      field('find-count').textContent=searching?'Searching…':`Results found (${matches.length})`;
      d.querySelector<HTMLElement>('.find-pagination')!.hidden=matches.length<=200;
      field('find-page-count').textContent=`${resultPage*200+1}-${Math.min(matches.length,resultPage*200+200)} of ${matches.length}`;
      field<HTMLButtonElement>('find-previous-page').disabled=resultPage===0;
      field<HTMLButtonElement>('find-next-page').disabled=(resultPage+1)*200>=matches.length;
      buttons();
    };
    const draw=async(reset=true):Promise<boolean>=>{
      const version=++searchVersion,startedGeneration=generation;
      if(reset){active=undefined;resultPage=0;feedback('');}
      const chosen=new Set(scopes.filter(s=>s.checked).map(s=>s.value)),search=matcher(),found:Match[]=[];
      matches=[];searching=!!input.value;engine.beginPass();paint();
      let slice=performance.now();
      if(input.value)for(const s of allSheets(book).filter(s=>chosen.has(s.id))){
        const rows=new Map(s.rows.map((r,i)=>[r.id,i])),columns=new Map(s.columns.map((c,i)=>[c.id,i]));
        for(const k of Object.keys(s.cells)){
          const cell=s.cells[k];
          const [row,column]=k.split(':'),r=rows.get(row),c=columns.get(column);if(r===undefined||c===undefined)continue;
          const value=cellText(cell,s,r,c);if(value&&search.matches(value))found.push({sid:s.id,row,column,r,c,value});
          if(performance.now()-slice>=6){
            field('find-count').textContent=`Searching… ${found.length} matches so far`;
            await yieldSearch();
            if(version!==searchVersion||!d.open)return false;
            if(startedGeneration!==generation)return draw(reset);
            engine.beginPass();slice=performance.now();
          }
        }
      }
      if(version!==searchVersion)return false;
      if(input.value)for(const [address]of engine.spills){
        const [sid,row,column]=address.split(':');if(!chosen.has(sid))continue;
        const s=allSheets(book).find(s=>s.id===sid);if(!s||key(row,column) in s.cells)continue;
        const r=s.rows.findIndex(r=>r.id===row),c=s.columns.findIndex(c=>c.id===column);if(r<0||c<0)continue;
        const value=cellText(getCell(s,row,column),s,r,c);
        if(value&&search.matches(value))found.push({sid,row,column,r,c,value});
      }
      const order=new Map(allSheets(book).map((s,i)=>[s.id,i]));
      matches=found.sort((a,b)=>order.get(a.sid)!-order.get(b.sid)!||a.r-b.r||a.c-b.c);
      searching=false;painted='';
      if(active&&!matches.some(m=>identity(m)===active))active=undefined;
      resultPage=Math.min(resultPage,Math.max(0,Math.ceil(matches.length/200)-1));paint();
      if(input.value&&!chosen.size)feedback('Select at least one sheet to search.',true);
      return true;
    };
    const reveal=(s:ReturnType<typeof source>,rowId:string,columnId:string)=>{
      const row=s.rows.find(r=>r.id===rowId)!,column=s.columns.find(c=>c.id===columnId)!;
      const hidden=s.groups.filter(g=>g.collapsed&&outlineMembers(g,s.groups).includes(g.axis==='row'?rowId:columnId)&&(!g.table||groupContainsCell(book,s,g,rowId,columnId)));
      return !row.hidden&&!column.hidden&&!hidden.length||mutateMetadata('Reveal search result',()=>{if(row.hidden)row.hidden=false;if(column.hidden)column.hidden=false;hidden.forEach(g=>g.collapsed=false);},[[...sheetPath(s),'rows',s.rows.indexOf(row),'hidden'],[...sheetPath(s),'columns',s.columns.indexOf(column),'hidden'],...hidden.map(g=>[...sheetPath(s),'groups',s.groups.indexOf(g),'collapsed'])]);
    };
    const go=(index:number)=>{
      const m=matches[index];if(!m)return;
      const s=source(m);if(!reveal(s,m.row,m.column)){feedback(error,true);return;}
      sheetId=s.id;referenceId=undefined;workbookView=undefined;extraSelections=[];selected={r:m.r,c:m.c};anchor={...selected};selectionKind='cells';scrollTarget={row:m.r,contextRows:1};page=Math.floor(m.r/60);active=identity(m);resultPage=Math.floor(index/200);render();paint();
      d.querySelector<HTMLElement>(`[data-find-match="${index}"]`)?.scrollIntoView({block:'nearest'});
    };
    const next=()=>{
      if(searching){feedback('Searching… wait for the complete results.');return;}
      if(!matches.length)return;
      const up=field<HTMLSelectElement>('find-direction').value==='up',current=matches.findIndex(m=>identity(m)===active);
      if(current>=0){go((current+(up?-1:1)+matches.length)%matches.length);return;}
      const order=allSheets(book).findIndex(s=>s.id===sheetId),after=(m:Match)=>allSheets(book).findIndex(s=>s.id===m.sid)-order||m.r-selected.r||m.c-selected.c;
      const index=up?matches.reduce((last,m,i)=>after(m)<0?i:last,-1):matches.findIndex(m=>after(m)>0);go(index<0?(up?matches.length-1:0):index);
    };
    const replace=async(every:boolean)=>{
      if(!await draw(false))return;if(!every&&!active)next();
      const targets=every?matches:matches.filter(m=>identity(m)===active),editable=targets.filter(literal),search=matcher();let changed=0;
      if(!editable.length){feedback('Only literal text can be replaced. Formula and linked cells are unchanged.',true);return;}
      if(!mutate('Replace literal text',()=>{for(const m of editable){
        const s=source(m),cell=getCell(s,m.row,m.column);if(typeof cell.value!=='string'||cell.formula||cell.binding)throw Error('This result changed. Search again before replacing it.');
        const value=search.replace(cell.value,replacement);if(value===cell.value)continue;
        const table=allTables(book).find(t=>t.sheet===m.sid&&t.header===m.row&&t.columns.some(c=>c.column===m.column));
        if(table)renameColumn(book,table,table.columns.find(c=>c.column===m.column)!.id,value);
        else s.cells[key(m.row,m.column)]={...cell,value};changed++;
      }})){feedback(error,true);return;}
      if(await draw(false))feedback(`${changed} literal cell${changed===1?'':'s'} replaced.${targets.length>editable.length?` ${targets.length-editable.length} other results left unchanged.`:''}`);
    };
    field('replace-fields').innerHTML=`<label id="replace-label">Replace with<input id="replace-text"></label>`;
    field('replace-actions').innerHTML='<button id="replace-one">Replace</button><button id="replace-all">Replace all</button>';
    field<HTMLInputElement>('replace-text').oninput=e=>replacement=(e.target as HTMLInputElement).value;
    field<HTMLButtonElement>('replace-one').onclick=()=>replace(false);field<HTMLButtonElement>('replace-all').onclick=()=>replace(true);
    let gaps:ReturnType<typeof tableMembershipGaps>=[],gapPage=0,gapGeneration=generation;
    const selectedGaps=new Set<string>(),gapId=(gap:typeof gaps[number])=>`${gap.table}:${gap.axis}:${gap.member}`;
    const gapButtons=()=>{
      field<HTMLButtonElement>('membership-convert').disabled=!selectedGaps.size;
      const all=field<HTMLInputElement>('membership-all');all.disabled=!gaps.length;all.checked=!!gaps.length&&selectedGaps.size===gaps.length;all.indeterminate=!!selectedGaps.size&&selectedGaps.size<gaps.length;
    };
    const paintGaps=()=>{
      let previous='',previousTable='';engine.beginPass();
      const entries=gaps.slice(gapPage*200,gapPage*200+200).map((gap,j)=>{
        const index=gapPage*200+j,s=allSheets(book).find(s=>s.id===gap.sheet)!,table=allTables(book).find(t=>t.id===gap.table)!;
        const position=gap.axis==='row'?`Row ${gap.index+1}`:`Column ${letters(gap.index)}`;
        const ids=new Set(gap.axis==='row'?table.columns.map(field=>field.column):[table.header,...table.rows]),items=gap.axis==='row'?s.columns:s.rows,indices=items.flatMap((item,i)=>ids.has(item.id)?[i]:[]);
        const start=indices[0],end=Math.min(start+8,indices.at(-1)!+1);
        const cells=Array.from({length:end-start},(_,i)=>{
          const r=gap.axis==='row'?gap.index:start+i,c=gap.axis==='column'?gap.index:start+i;
          return{address:`${letters(c)}${r+1}`,value:cellText(getCell(s,s.rows[r].id,s.columns[c].id),s,r,c)};
        });
        return{gap,index,s,table,position,cells};
      });
      const count=Math.max(1,...entries.map(entry=>entry.cells.length)),preview=field('membership-panel').querySelector('table')!;
      preview.style.width=`${94+count*110}px`;
      preview.querySelector('colgroup')!.innerHTML=`<col style="width:34px"><col style="width:60px"><col span="${count}" style="width:110px">`;
      preview.querySelector<HTMLTableCellElement>('thead th:last-child')!.colSpan=count;
      preview.querySelector('tbody')!.innerHTML=entries.map(({gap,index,s,table,position,cells})=>{
        const header=previous===s.id?'':`<tr class="find-sheet-header"><th colspan="${count+2}">${esc(s.name)}</th></tr>`;
        const subheader=previous===s.id&&previousTable===table.id?'':`<tr class="find-table-header"><th colspan="${count+2}">Table: ${esc(table.name)}</th></tr>`;previous=s.id;previousTable=table.id;
        const contents=Array.from({length:count},(_,i)=>{const cell=cells[i];return cell?`<td data-membership-context="${cell.address}" aria-label="${cell.address}" title="${esc(cell.value)}">${esc(cell.value)}</td>`:'<td></td>';}).join('');
        return`${header}${subheader}<tr data-membership-result="${index}" tabindex="0" aria-label="${esc(table.name)} ${position}"><td><input type="checkbox" aria-label="${esc(table.name)} ${position}" ${selectedGaps.has(gapId(gap))?'checked':''}></td><th scope="row">${position}</th>${contents}</tr>`;
      }).join('');
      field('membership-count').textContent=`${gaps.length} sheet-only rows/columns`;
      field('membership-pagination').hidden=gaps.length<=200;
      field('membership-page').textContent=`${gapPage*200+1}-${Math.min(gaps.length,gapPage*200+200)} of ${gaps.length}`;
      field<HTMLButtonElement>('membership-previous').disabled=gapPage===0;field<HTMLButtonElement>('membership-next').disabled=(gapPage+1)*200>=gaps.length;
      gapButtons();
    };
    const scanGaps=()=>{
      gaps=tableMembershipGaps(book);selectedGaps.clear();gapPage=0;gapGeneration=generation;paintGaps();
      const feedback=field('membership-feedback');feedback.textContent=gaps.length?'These are rows / columns that are currently sitting between table rows / columns but are not part of the table.':'No sheet-only rows or columns found between table members.';feedback.classList.remove('bad');feedback.setAttribute('role','status');
    };
    field('membership-panel').querySelector('tbody')!.onchange=e=>{
      const row=(e.target as HTMLElement).closest<HTMLElement>('[data-membership-result]');
      if(!row)return;const id=gapId(gaps[Number(row.dataset.membershipResult)]);
      if((e.target as HTMLInputElement).checked)selectedGaps.add(id);else selectedGaps.delete(id);gapButtons();
    };
    const visitGap=(e:Event)=>{
      if((e.target as HTMLElement).closest('input,button'))return;
      const row=(e.target as HTMLElement).closest<HTMLElement>('[data-membership-result]');if(!row)return;
      if(generation!==gapGeneration){const message=field('membership-feedback');message.textContent='The workbook changed. Scan again before navigating.';message.classList.add('bad');message.setAttribute('role','alert');return;}
      const gap=gaps[Number(row.dataset.membershipResult)],s=allSheets(book).find(sheet=>sheet.id===gap.sheet)!,table=allTables(book).find(table=>table.id===gap.table)!;
      const r=gap.axis==='row'?s.rows.findIndex(row=>row.id===gap.member):s.rows.findIndex(row=>row.id===table.header),c=gap.axis==='column'?s.columns.findIndex(column=>column.id===gap.member):s.columns.findIndex(column=>column.id===table.columns[0].column);
      if(!reveal(s,s.rows[r].id,s.columns[c].id)){const message=field('membership-feedback');message.textContent=error;message.classList.add('bad');message.setAttribute('role','alert');return;}
      sheetId=s.id;referenceId=undefined;workbookView=undefined;extraSelections=[];selectionScope=undefined;tableSelectionMode=false;tableSelectionTarget=undefined;
      anchor=gap.axis==='row'?{r,c:0}:{r:0,c};selected=gap.axis==='row'?{r,c:s.columns.length-1}:{r:s.rows.length-1,c};selectionKind=gap.axis==='row'?'rows':'columns';scrollTarget={row:r,contextRows:1};page=Math.floor(r/60);
      d.close();render();root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});
    };
    field('membership-panel').querySelector('tbody')!.onclick=visitGap;
    field('membership-panel').querySelector('tbody')!.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!(e.target as HTMLElement).closest('input,button')){e.preventDefault();visitGap(e);}};
    field<HTMLInputElement>('membership-all').onchange=e=>{selectedGaps.clear();if((e.target as HTMLInputElement).checked)gaps.forEach(gap=>selectedGaps.add(gapId(gap)));paintGaps();};
    field<HTMLButtonElement>('membership-scan').onclick=scanGaps;
    field<HTMLButtonElement>('membership-previous').onclick=()=>{gapPage--;paintGaps();};
    field<HTMLButtonElement>('membership-next').onclick=()=>{gapPage++;paintGaps();};
    field<HTMLButtonElement>('membership-convert').onclick=()=>{
      const chosen=gaps.filter(gap=>selectedGaps.has(gapId(gap)));
      const ok=mutate('Convert sheet rows/columns to table',()=>{
        if(generation!==gapGeneration)throw Error('The workbook changed. Scan again before converting.');
        for(const tableId of new Set(chosen.map(gap=>gap.table))){
          const table=allTables(book).find(t=>t.id===tableId)!,s=allSheets(book).find(s=>s.id===table.sheet)!;
          const columns=chosen.filter(gap=>gap.table===tableId&&gap.axis==='column').map(gap=>gap.member),rows=chosen.filter(gap=>gap.table===tableId&&gap.axis==='row').map(gap=>gap.member);
          if(columns.length)addTableColumns(book,s,table,columns);if(rows.length)addTableRows(book,s,table,rows);
        }
      });
      if(ok){scanGaps();field('membership-feedback').textContent=`Converted ${chosen.length} row/column memberships.`;}
      else{field('membership-feedback').textContent=error;field('membership-feedback').classList.add('bad');field('membership-feedback').setAttribute('role','alert');}
    };
    const mode=(membership:boolean)=>{
      for(const id of ['text-tab','membership-tab']){const tab=field<HTMLButtonElement>(id),selected=id===(membership?'membership-tab':'text-tab');tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
      field('find-controls').setAttribute('aria-labelledby','text-tab');
      for(const el of d.querySelectorAll<HTMLElement>('.find-controls,.find-results-panel,#find-feedback,.find-actions'))el.hidden=membership;
      field('membership-panel').hidden=!membership;
      if(membership)scanGaps();else draw(false);
    };
    const syncScope=()=>{const count=scopes.filter(s=>s.checked).length;all.checked=count===scopes.length;all.indeterminate=count>0&&count<scopes.length;field<HTMLSelectElement>('find-within').value=all.checked?'workbook':'selected';within.refresh();};
    all.onchange=()=>{scopes.forEach(s=>s.checked=all.checked);syncScope();draw();};
    scopes.forEach(s=>s.onchange=()=>{syncScope();draw();});
    field<HTMLSelectElement>('find-within').onchange=e=>{const workbook=(e.target as HTMLSelectElement).value==='workbook';scopes.forEach(s=>s.checked=workbook||s.value===sheetId);syncScope();draw();};
    for(const id of ['find-case','find-entire'])field<HTMLInputElement>(id).onchange=()=>draw();
    input.oninput=()=>draw();input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();next();}};
    field<HTMLButtonElement>('find-next').onclick=next;field<HTMLButtonElement>('find-all').onclick=()=>draw();
    field<HTMLButtonElement>('find-previous-page').onclick=()=>{resultPage--;paint();field('find-results').scrollTop=0;};
    field<HTMLButtonElement>('find-next-page').onclick=()=>{resultPage++;paint();field('find-results').scrollTop=0;};
    const result=(e:Event)=>{const row=(e.target as HTMLElement).closest<HTMLElement>('[data-find-match]');if(row)go(Number(row.dataset.findMatch));};
    field('find-results').onclick=result;field('find-results').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();result(e);}};
    field<HTMLButtonElement>('text-tab').onclick=()=>mode(false);field<HTMLButtonElement>('membership-tab').onclick=()=>mode(true);
    d.querySelector<HTMLElement>('.find-tabs')!.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const membership=e.key==='ArrowRight'||e.key==='End';mode(membership);field(membership?'membership-tab':'text-tab').focus();}};
    mode(false);syncScope();draw();input.focus();
  });
}
function download(name:string,data:string,type='application/json'):void {
  const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function exportBackup():Promise<void> {
  try {
    await flush();const backup=await store.backup({...state,book:clone(book)});
    if(savedGeneration!==generation)backup.state.pending.push({id:uid(),label:'Unsaved edits included in emergency backup',time:new Date().toISOString()});
    download(`fnt-${new Date().toISOString().slice(0,10)}.fnt.json`,stringifyArchive(backup));
  }catch(e){flash(e);}
}
function openFile():void {
  dialog('Workbook & recovery',`<div class="menu"><button id="backup" class="primary">Download independent full backup</button>${book.importReport?'<button id="original">Download unchanged original XLSX</button><button id="report">Compatibility report</button>':''}<label>Import Ingredients into this workbook<input type="file" id="import-ingredients" accept=".xlsx"></label><label>Restore Fnt backup<input type="file" id="restore" accept=".json"></label><label>Replace workbook from Excel (pre-import recovery)<input type="file" id="import" accept=".xlsx"></label><button id="history">Recovery checkpoints</button><button id="sync">Private GitHub sync</button><button id="privacy">Storage & privacy</button></div><p class="muted">Ingredients import keeps existing records and other sheets, saves a full pre-import recovery archive, and disconnects sync. Backups contain your data; keep them private. XLSX compatibility is not certified.</p>`,d=>{
    const masterLabel=document.createElement('label'),masterInput=document.createElement('input');
    masterLabel.textContent='Review Master import (no changes until approved)';masterInput.type='file';masterInput.id='import-master';masterInput.accept='.xlsx';masterLabel.append(masterInput);
    d.querySelector('#import-ingredients')!.closest('label')!.after(masterLabel);
    masterInput.onchange=async()=>{
      const file=masterInput.files?.[0];if(!file)return;
      if(busy||draft!==undefined||appendDraft||colorPicker?.pending){flash('Finish the current edit or save before reviewing Master import.');return;}
      busy=true;status='Reviewing Master locally - no workbook changes are being applied';renderStatus();
      let expected=state.version,revision=book.revision;
      try{
        await flush();if(savedGeneration!==generation)throw Error('Save failed. Master review cancelled.');
        expected=state.version;revision=book.revision;
        const [{importXlsx},{stageMasterImport}]=await Promise.all([import('./xlsx'),import('./master-import')]);
        const source=await importXlsx(await file.arrayBuffer(),file.name,{sheets:['Master']});
        if(source.nativeBackup)throw Error('Restore a native Fnt snapshot instead of reimporting its Master identities.');
        const stage=stageMasterImport(book,source.book);
        if(state.version!==expected||book.revision!==revision)throw Error('The workbook changed during review. Select the file again to create a fresh preflight.');
        status=stage.conflicts.length?'Master staged - review required; no changes applied':'Master preflight ready - no changes applied';
        let page=0;
        const show=()=>{
          const count=stage.conflicts.length,entries=stage.conflicts.slice(page*25,(page+1)*25);
          dialog('Master import review',`<p>${stage.source.records} records; ${stage.source.formulas} formulas retained. ${stage.summary.unique} unique Food matches eligible for linking, ${stage.summary.manual} manual inputs kept as typed, ${stage.summary.ambiguous} ambiguous inputs, ${stage.summary.sourceReview} inputs awaiting source or nutrition review.</p><p><strong>No workbook changes have been applied.</strong> ${count?`${count} unresolved decisions block the entire import. Resolve source identity and record conflicts before importing; no first-match or static-list fallback is used.`:'The preflight is conflict-free. Applying adds Master without replacing existing sheets and creates a full pre-import recovery archive.'}</p><div id="master-conflicts">${entries.map(entry=>`<details><summary>${esc(entry.kind)}: ${esc(entry.message)}</summary><p>${esc(entry.locations.join(', ')||'Source-level decision')}</p>${entry.candidates.map(candidate=>`<p>${esc(candidate.label)}<br><small>${esc([candidate.table,candidate.row,candidate.column].filter(Boolean).join(' / '))}</small></p>`).join('')}</details>`).join('')}</div><div class="menu"><button id="master-previous" ${page===0?'disabled':''}>Previous decisions</button><span>Page ${page+1} of ${Math.max(1,Math.ceil(count/25))}</span><button id="master-next" ${(page+1)*25>=count?'disabled':''}>Next decisions</button><button id="master-download">Download private review report</button>${stage.prepared?'<button id="master-apply" class="primary">Apply reviewed Master import</button>':''}</div>`,review=>{
            review.querySelector<HTMLButtonElement>('#master-previous')!.onclick=()=>{page--;show();};
            review.querySelector<HTMLButtonElement>('#master-next')!.onclick=()=>{page++;show();};
            review.querySelector<HTMLButtonElement>('#master-download')!.onclick=()=>download('master-import-private-review.json',JSON.stringify({format:'fnt-master-import-preflight',version:1,importApplied:false,stateVersion:expected,sourceFile:file.name,...stage,prepared:undefined},null,2));
            const apply=review.querySelector<HTMLButtonElement>('#master-apply');
            if(apply)apply.onclick=async()=>{
              if(busy||!stage.prepared)return;
              busy=true;renderStatus();let committed=false;
              try{
                if(state.version!==expected||book.revision!==revision||draft!==undefined||appendDraft)throw Error('The workbook changed since preflight. Review the file again; nothing was imported.');
                const durable=await store.load();
                if(!durable||durable.version!==expected)throw Error('Another tab changed this workbook. Review the latest saved data before importing.');
                const before=await store.backup(durable),previousHistory=await store.undoHistory(expected,book.id)??{undo:[],redo:[]},original=before.originals.find(original=>original.data===source.original.data)??source.original;
                const incoming=stage.prepared.book;
                incoming.importReport??={...source.book.importReport!,originalId:original.id};
                const history={undo:[...previousHistory.undo,structuralUndo(book,incoming)].slice(-undoLimit),redo:[]};
                state=await store.save(incoming,expected,'Master import',true,original,{localOnly:true,recoveryArchive:stringifyArchive({...before,undoHistory:previousHistory}),undoHistory:history});
                committed=true;
                token='';adoptSavedWorkbook(stage.prepared.sheet);undo.push(...history.undo);
                status=`Imported ${stage.source.records} Master records - recovery saved; sync disconnected`;
                channel?.postMessage({version:state.version});render();review.close();
              }catch(error){status=committed?'Master saved, but its view could not refresh - inspect recovery before retrying':'Master import not applied';flash(error);}
              finally{busy=false;renderStatus();}
            };
          });
        };
        show();
      }catch(error){status='Master review failed - workbook unchanged';flash(error);}
      finally{busy=false;renderStatus();}
    };
    const mealsLabel=document.createElement('label'),mealsInput=document.createElement('input');
    mealsLabel.textContent='Import Meals and link matching Ingredients';mealsInput.type='file';mealsInput.id='import-meals';mealsInput.accept='.xlsx';mealsLabel.append(mealsInput);d.querySelector('#import-ingredients')!.closest('label')!.after(mealsLabel);
    const mealsNote=document.createElement('p');mealsNote.className='muted';mealsNote.textContent='Meals import adds a separate sheet, retains the previous Meals table as Meals_PreImport, preserves formulas and manual nutrition, and links ingredient labels to the first case-insensitive match from the top of Ingredients. Unmatched text stays manual. A full recovery copy is saved and sync is disconnected.';mealsLabel.after(mealsNote);
    const importMeals=async(file?:File)=>{
      if(busy){flash('Wait for the current save or import.');return;}if(!commitDraft())return;
      busy=true;status='Importing Meals locally - existing sheets and manual nutrition will be retained';renderStatus();
      try{
        await flush();if(savedGeneration!==generation)throw Error('Save failed. Meals import cancelled.');
        const before=await store.backup({...state,book:clone(book)}),attached=before.originals.find(original=>original.id===book.importReport?.originalId);
        if(!file&&!attached)throw Error('The original Excel source is missing. Select a local XLSX file.');
        const bytes=file?await file.arrayBuffer():Uint8Array.from(atob(attached!.data),c=>c.charCodeAt(0)).buffer;
        const [{importXlsx},{mergeMeals}]=await Promise.all([import('./xlsx'),import('./meals-import')]);
        const source=await importXlsx(bytes,file?.name??attached!.name,{sheets:['Meals']});
        if(source.nativeBackup)throw Error('Restore a Fnt snapshot as a workbook rather than importing its Meals identities again.');
        const original=before.originals.find(original=>original.data===source.original.data)??source.original;
        if(source.book.importReport)source.book.importReport.originalId=original.id;
        const result=mergeMeals(book,source.book);
        result.book.importReport??=source.book.importReport;
        state=await store.save(result.book,state.version,'Meals import',true,original,{localOnly:true,recoveryArchive:stringifyArchive(before)});
        token='';adoptSavedWorkbook(result.sheet);selected={r:sheet().rows.findIndex(row=>row.id===allTables(book).find(table=>table.id===result.table)!.header)+1,c:0};anchor={...selected};scrollTarget=selected.r;
        status=`Imported ${result.rows} Meals records; ${result.linked} ingredients linked; ${result.unmatched} unmatched labels retained - sync disconnected`;
        channel?.postMessage({version:state.version});render();d.close();
      }catch(e){status='Meals import failed - previous workbook retained';flash(e);}
      finally{busy=false;renderStatus();}
    };
    mealsInput.onchange=()=>{if(mealsInput.files?.[0])void importMeals(mealsInput.files[0]);};
    if(book.importReport){const attachedMeals=document.createElement('button');attachedMeals.id='import-attached-meals';attachedMeals.textContent='Import Meals from attached original XLSX';attachedMeals.onclick=()=>void importMeals();mealsLabel.before(attachedMeals);}
    const ingredients=allTables(book).find(t=>t.name.toLowerCase()==='ingredients'),localContext=document.createElement('p');
    localContext.id='browser-workbook';localContext.className='muted';
    localContext.textContent=`This browser profile at ${location.origin}. Other browser profiles and preview ports have separate local workbooks. ${ingredients?`Ingredients: ${ingredients.rows.length} records, ${ingredients.columns.length} columns.`:'No Ingredients table in this workbook.'} ${book.importReport?'An Excel source is attached locally.':'No Excel source has been imported into this workbook. Choose Import Ingredients below to load your Excel data here.'}`;
    d.querySelector('.menu')!.before(localContext);
    if(import.meta.env.PROD){
      const published=document.createElement('button');published.textContent='Load published testing workbook';
      d.querySelector('.menu')!.prepend(published);
      published.onclick=()=>{d.close();confirmAction('Load published testing workbook','Your current workbook and original attachments will be preserved in a full recovery checkpoint before loading the published testing snapshot.',()=>{
        void(async()=>{busy=true;renderStatus();try{
          await flush();if(savedGeneration!==generation)throw Error('Save failed. Published workbook was not loaded.');
          const snapshot=await loadPublishedTesting(),before=await store.backup({...state,book:clone(book)});
          state=await store.save(migrateDropdownData(snapshot.book).book,state.version,'Load published testing workbook',true,undefined,{localOnly:true,recoveryArchive:stringifyArchive(before),publishedSnapshot:snapshot.id});
          adoptSavedWorkbook();status='Published testing workbook saved in this browser';channel?.postMessage({version:state.version});render();
        }catch(e){flash(e);}finally{busy=false;renderStatus();}})();
      });};
    }
    const exportButton=document.createElement('button');exportButton.textContent='Export Excel projection + embedded Fnt archive';d.querySelector('#backup')!.after(exportButton);
    const recoveryLabel=document.createElement('label');recoveryLabel.textContent='Recover embedded Fnt snapshot (ignores external Excel edits)';
    const recoveryInput=document.createElement('input');recoveryInput.type='file';recoveryInput.id='recover-xlsx';recoveryInput.accept='.xlsx';recoveryLabel.append(recoveryInput);d.querySelector('#restore')!.closest('label')!.after(recoveryLabel);
    exportButton.onclick=()=>{
      d.close();dialog('Export XLSX locally',`<p>The Excel view contains supported cells, formulas, tables, formatting, dropdowns, links, notes and outlines. It is <strong>not a full recreation of original Excel presentation</strong>: charts, merged layouts, rich text, themes, print settings, conditional formatting and totals metadata remain in the archived originals.</p><p>The embedded native archive retains all Fnt identities, exact record bindings, manual overrides, groups, pending operations and complete original file bytes. Unchanged exports roundtrip exactly in Fnt. External Excel edits/metadata removal are detected, not silently overwritten by the snapshot.</p><p><strong>Native backups remain authoritative.</strong> Keep a separate .fnt.json backup; other apps can discard embedded metadata. The export includes private data and archived originals, even sheets not imported into the grid. Nothing is uploaded. Excel must recalculate formula results.</p><button id="export-xlsx" class="primary">Download private XLSX</button>`,modal=>{
        modal.querySelector<HTMLButtonElement>('#export-xlsx')!.onclick=async()=>{
          if(busy||!commitDraft())return;busy=true;renderStatus();
          try{
            await flush();if(savedGeneration!==generation)throw Error('Save failed. Export cancelled.');
            const {exportXlsx}=await import('./xlsx-export'),bytes=await exportXlsx(await store.backup({...state,book:clone(book)}));
            const url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');
            link.href=url;link.download=book.title.replace(/[\\/:*?"<>|]/g,'-')+'-fnt-export.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);modal.close();
          }catch(e){flash(e);const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=e instanceof Error?e.message:String(e);modal.append(p);}
          finally{busy=false;renderStatus();}
        };
      });
    };
    d.querySelector<HTMLButtonElement>('#backup')!.onclick=()=>{void exportBackup();};
    const reportButton=d.querySelector<HTMLButtonElement>('#report');if(reportButton)reportButton.onclick=()=>{d.close();void action('report');};
    const originalButton=d.querySelector<HTMLButtonElement>('#original');if(originalButton)originalButton.onclick=async()=>{
      try{
        const original=(await store.backup(state)).originals.find(o=>o.id===book.importReport!.originalId);if(!original)throw Error('Original package is missing. Restore a complete backup before relying on this copy.');
        const bytes=Uint8Array.from(atob(original.data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');
        a.href=url;a.download=original.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
      }catch(e){flash(e);}
    };
    d.querySelectorAll<HTMLInputElement>('#restore,#recover-xlsx').forEach(input=>input.onchange=async e=>{
      const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;
      if(busy||!commitDraft())return;busy=true;status='Restoring locally - sync will be disconnected';renderStatus();
      try{
        await flush();if(savedGeneration!==generation)throw Error('Save failed. Restore cancelled.');
        const backup=input.id==='recover-xlsx'?await (await import('./xlsx')).recoverXlsxBackup(await file.arrayBuffer()):parseArchive(await file.text()) as Backup;
        state=await store.restore(normalizedBackup(backup),state.version);token='';adoptSavedWorkbook();status='Restored locally - sync disconnected; full pre-restore archive in recovery';channel?.postMessage({version:state.version});render();d.close();
      }catch(e){status='Restore failed - previous workbook retained';flash(e);}
      finally{busy=false;renderStatus();}
    });
    d.querySelector<HTMLInputElement>('#import')!.onchange=async e=>{
      const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;
      if(busy||!commitDraft())return;busy=true;status='Importing locally - do not close this tab';renderStatus();
      try{
        await flush();if(savedGeneration!==generation)throw Error('Save failed. Import cancelled.');
        const recovery=stringifyArchive(await store.backup({...state,book:clone(book)}));
        const {importXlsx}=await import('./xlsx');const result=await importXlsx(await file.arrayBuffer(),file.name);
        if(result.nativeBackup)state=await store.restore(normalizedBackup(result.nativeBackup),state.version);
        else state=await store.save(migrateDropdownData(result.book).book,state.version,'Excel import',true,result.original,{localOnly:true,recoveryArchive:recovery});
        token='';adoptSavedWorkbook();status='Imported locally - sync disconnected; compatibility review required';channel?.postMessage({version:state.version});render();d.close();
      }catch(e){status='Import failed - previous workbook retained';flash(e);}finally{busy=false;renderStatus();}
    };
    d.querySelector<HTMLInputElement>('#import-ingredients')!.onchange=async e=>{
      const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;
      if(busy){flash('Wait for the current save or import.');return;}
      if(!commitDraft())return;
      busy=true;status='Importing Ingredients locally - other sheets will be retained';renderStatus();
      try{
        await flush();if(savedGeneration!==generation)throw Error('Save failed. Import cancelled.');
        const beforeImport=await store.backup({...state,book:clone(book)}),recovery=stringifyArchive(beforeImport);
        const [{importXlsx},{mergeIngredients}]=await Promise.all([import('./xlsx'),import('./ingredients-import')]);
        const source=await importXlsx(await file.arrayBuffer(),file.name);
        if(source.nativeBackup)throw Error('This is a Fnt snapshot with existing identities. Restore/replace it as a workbook instead of appending it as an independent Ingredients source.');
        const attached=beforeImport.originals.find(original=>original.data===source.original.data);
        if(attached&&allTables(book).some(t=>t.name.toLowerCase()==='ingredients'))throw Error('This unchanged source file is already attached locally. Import cancelled to avoid duplicate records; delete Ingredients to recreate it, use recovery, or select an updated source file deliberately.');
        if(attached){
          source.original=attached;
          if(source.book.importReport)source.book.importReport.originalId=attached.id;
        }
        const result=mergeIngredients(book,source.book);
        state=await store.save(result.book,state.version,'Ingredients import',true,source.original,{localOnly:true,recoveryArchive:recovery});
        token='';adoptSavedWorkbook(result.sheet);selected={r:1,c:0};anchor={...selected};
        status=`Imported ${result.rows} Ingredients records locally; ${result.retainedRows} existing records retained; ${result.linkedDropdownCells} DD cells linked - sync disconnected`;
        channel?.postMessage({version:state.version});
        render();d.close();
      }catch(e){status='Ingredients import failed - previous workbook retained';flash(e);}
      finally{busy=false;renderStatus();}
    };
    d.querySelector<HTMLButtonElement>('#history')!.onclick=()=>{d.close();void openHistory();};
    d.querySelector<HTMLButtonElement>('#sync')!.onclick=()=>{d.close();openSync();};
    d.querySelector<HTMLButtonElement>('#privacy')!.onclick=()=>{d.close();openSafety();};
  });
}
async function openHistory():Promise<void> {
  try{
    const history=await store.history();
    dialog('Recovery checkpoints',`<p>Restoring first saves a full pre-restore archive, retains pending edits and disconnects sync. Checkpoints share browser storage; they are not independent backups until downloaded.</p><div class="menu">${history.map((h,i)=>`<div><button data-checkpoint="${i}">${esc(h.label)}<small>${esc(h.time)}</small></button>${h.backup?`<button data-recovery-backup="${i}">Download full recovery archive</button>`:''}</div>`).join('')||'<p>No checkpoints yet. Use Save workbook to create one.</p>'}</div>`,d=>{
      d.querySelectorAll<HTMLButtonElement>('[data-recovery-backup]').forEach(el=>el.onclick=()=>download('fnt-recovery.fnt.json',history[Number(el.dataset.recoveryBackup)].backup!));
      d.querySelectorAll<HTMLButtonElement>('[data-checkpoint]').forEach(el=>el.onclick=async()=>{
        if(busy||!commitDraft())return;busy=true;status='Restoring checkpoint locally';renderStatus();
        try{
          await flush();if(savedGeneration!==generation)throw Error('Save failed. Restore cancelled.');
          const checkpoint=history[Number(el.dataset.checkpoint)],backup=checkpoint.backup?parseArchive(checkpoint.backup) as Backup:await store.backup({...state,book:clone(checkpoint.book)});
          state=await store.restore(normalizedBackup(backup),state.version);token='';adoptSavedWorkbook();status='Checkpoint restored locally - sync disconnected; full pre-restore archive in recovery';channel?.postMessage({version:state.version});render();d.close();
        }catch(e){status='Checkpoint restore failed - previous workbook retained';flash(e);}
        finally{busy=false;renderStatus();}
      });
    });
  }catch(e){flash(e);}
}
function openSync():void {
  const cfg=state.sync;
  dialog('Optional private GitHub sync',`<p>Opt-in only. This uploads workbook data to the private repository you choose. Never use your website source or a public repository. Existing remote files are not overwritten on conflict.</p><form id="sync-form"><label>Personal repository owner<input id="sync-owner" value="${esc(cfg?.owner)}" required autocomplete="off"></label><label>Private data repository<input id="sync-repo" value="${esc(cfg?.repo)}" required></label><label>Existing branch<input id="sync-branch" value="${esc(cfg?.branch??'main')}" required></label><label>JSON path<input id="sync-path" value="${esc(cfg?.path??'workbook.json')}" required></label><label>Fine-grained token: Contents read/write, only this data repository<input id="sync-token" type="password" autocomplete="off" required></label><p class="muted">Token stays in memory for this tab, never in backups or local storage. GitHub must already contain the branch. Sync is manual/batched with Save, not each keystroke. Large files may exceed the Contents API limit.</p><button class="primary">Connect & sync now</button><button id="disconnect" type="button">Disconnect</button></form>`,d=>{
    d.querySelector('form')!.onsubmit=async e=>{
      e.preventDefault();await flush();if(savedGeneration!==generation)return;
      const read=(id:string)=>d.querySelector<HTMLInputElement>(id)!.value.trim();
      const next={owner:read('#sync-owner'),repo:read('#sync-repo'),branch:read('#sync-branch'),path:read('#sync-path')};
      try{state=await store.metadata(state.version,s=>({...s,sync:next,remoteSha:JSON.stringify(next)===JSON.stringify(s.sync)?s.remoteSha:undefined}));token=read('#sync-token');d.close();await manualSave();}catch(e){flash(e);}
    };
    d.querySelector<HTMLButtonElement>('#disconnect')!.onclick=async()=>{
      try{await flush();state=await store.metadata(state.version,s=>({...s,sync:undefined,remoteSha:undefined}));token='';status='Disconnected - local only';renderStatus();d.close();}catch(e){flash(e);}
    };
  });
}
function openSafety():void {
  dialog('Your data, deliberately local',`<p><b>Local autosave:</b> edits and their pending-operation IDs are committed together in IndexedDB. "Saved" appears only after the transaction completes. Save also creates a local checkpoint, or syncs if connected.</p><p><b>Independent backups matter:</b> browser data can be evicted, cleared, or lost with your device. Download full backups regularly. Recovery history on the same device is not a separate backup.</p><p><b>Nothing uploaded by default:</b> no analytics, hosted spreadsheet engine, account requirement, or bundled personal workbook. Optional GitHub sync verifies the repository is private before uploading. Conflicts preserve both versions instead of last-write-wins.</p><p><b>Review build:</b> not yet a certified replacement for Excel. Unsupported calculations display errors, not stale cached results. The original workbook remains authoritative. Text-based INDIRECT cannot follow source renames by definition.</p><p id="storage-info"></p><button id="persist">Request persistent browser storage</button>`,d=>{
    void navigator.storage?.estimate().then(e=>{const p=d.querySelector('#storage-info');if(p)p.textContent=`Browser storage: approximately ${((e.usage??0)/1048576).toFixed(1)} MB used of ${((e.quota??0)/1048576).toFixed(0)} MB available.`;});
    d.querySelector<HTMLButtonElement>('#persist')!.onclick=async()=>{try{const ok=await navigator.storage.persist();d.querySelector('#storage-info')!.textContent=ok?'Persistent storage granted. Still keep independent backups.':'Browser did not grant persistent storage. Download backups regularly.';}catch(e){flash(e);}};
  });
}
function deleteSelection(structural:boolean):void {
  if(!editableReference()){flash('Edit the live list source instead.');return;}
  const s=sheet(),b=bounds(),kind=structural?selectionMode():'cells',rowIndices=selectedAxisIndices('row'),columnIndices=selectedAxisIndices('column');
  if(structural&&kind!=='cells'&&!sheetAxisSelectionAllowed('Deleting rows or columns'))return;
  const owner=scopedSelectionTable();
  if(owner&&!referenceId&&kind!=='cells'){const axis=kind==='rows'?'row':'column';runTableEdit(owner.id,axis,{kind:'delete',ids:(axis==='row'?rowIndices:columnIndices).map(i=>(axis==='row'?s.rows:s.columns)[i].id)},`Delete table ${kind}`);return;}
  if(referenceId&&kind==='rows'){
    try{
      const ids=selectedReferenceRows(),source=activeReference()!,usages=ids.map(id=>referenceUsages(book,source,id));
      if(usages.some(u=>u.linked||u.formulas||u.manual)){
        const choices=referenceChoices(book,source).filter(c=>!ids.includes(c.row));
        dialog('Options are in use',`<p>${usages.reduce((n,u)=>n+u.linked,0)} linked cells. Formula or manual lookups may also use these options. Hide options to preserve history, replace exact links, or cancel.</p><button id="archive-option">Hide selected options</button>${ids.length===1?`<label>Replace linked values with<select id="replacement"><option value="">Choose replacement</option>${choices.map(c=>`<option value="${c.row}">${esc(c.value)}</option>`).join('')}</select></label><button id="delete-option">Replace links and delete</button>`:''}`,d=>{
          d.querySelector<HTMLButtonElement>('#archive-option')!.onclick=()=>{mutate('Archive options',()=>{source.archivedRows=[...new Set([...source.archivedRows,...ids])];});d.close();};
          d.querySelector<HTMLButtonElement>('#delete-option')?.addEventListener('click',()=>{if(mutate('Replace and delete option',()=>removeReferenceValue(book,activeReference()!,ids[0],d.querySelector<HTMLSelectElement>('#replacement')!.value||undefined,!!owner)))d.close();});
        });return;
      }
      if(owner)runTableEdit(owner.id,'row',{kind:'delete',ids},'Delete table options');
      else mutate('Delete options',()=>ids.forEach(id=>removeReferenceValue(book,activeReference()!,id)));return;
    }catch(e){flash(e);return;}
  }
  if(referenceId&&kind==='columns'){
    const ids=columnIndices.map(i=>s.columns[i]).filter(c=>gridReference()!.columns.includes(c.id)).map(c=>c.id);
    if(owner)runTableEdit(owner.id,'column',{kind:'delete',ids},'Delete reference fields');
    else mutate('Delete reference fields',()=>deleteReferenceColumns(book,activeReference()!,ids));extraSelections=[];return;
  }
  mutate(kind==='rows'?'Delete rows':kind==='columns'?'Delete columns':'Clear cells',()=>{
    if(kind==='rows'){
      if(rowIndices.length===s.rows.length)throw Error('Keep at least one row.');
      deleteRows(book,s,rowIndices.map(i=>s.rows[i].id));extraSelections=[];
      selected={r:Math.min(b.r1,s.rows.length-1),c:s.columns.length-1};anchor={r:selected.r,c:0};
    }else if(kind==='columns'){
      if(columnIndices.length===s.columns.length)throw Error('Keep at least one column.');
      for(const c of columnIndices.map(i=>s.columns[i]))deleteColumn(book,s,c.id);extraSelections=[];
      selected={r:s.rows.length-1,c:Math.min(b.c1,s.columns.length-1)};anchor={r:0,c:selected.c};
      renderedTarget=`${sheetId}:${selected.r}`;
    }else eachSelected((s,r,c)=>{
      if(allTables(book).some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(x=>x.column===s.columns[c].id)))throw Error('Rename table headers explicitly.');
      setInput(book,s,s.rows[r].id,s.columns[c].id,'');
    });
  });
}
document.addEventListener('keydown',e=>{
  if(e.isComposing||e.keyCode===229||e.altKey||!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='f')return;
  e.preventDefault();e.stopPropagation();
  const existing=document.querySelector<HTMLInputElement>('.find-dialog[open] #find-text');
  if(existing){document.querySelector<HTMLButtonElement>('.find-dialog[open] #text-tab')!.click();existing.focus();existing.select();return;}
  if(!book)return;
  if(document.querySelector('dialog[open]')){flash('Close the current dialog before opening Find and Replace.');return;}
  void action('find');
},{capture:true});
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||e.keyCode===229)return;
  if(resizing){if(e.key==='Escape'){e.preventDefault();finishResize(false);}return;}
  if(!book||document.querySelector('dialog[open]:not(.color-picker)'))return;
  if(busy)return;
  const target=e.target as HTMLElement,editing=['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable;
  if(target.closest('.sheet-tab,.tab-context-menu'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void manualSave();return;}
  if(editing)return;
  if(e.altKey&&e.key==='ArrowDown'){e.preventDefault();openCellDropdown();return;}
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&!e.altKey&&!e.shiftKey&&!e.getModifierState('AltGraph')&&e.key.toLowerCase()==='t'){e.preventDefault();openCreateTable();return;}
  if(mod&&!e.altKey&&!e.getModifierState('AltGraph')&&e.key.toLowerCase()==='h'){e.preventDefault();void action(e.shiftKey?'clear-hypothetical':'hypothetical');return;}
  if(mod&&!e.getModifierState('AltGraph')&&e.key.toLowerCase()==='g'){e.preventDefault();groupSelected(e.shiftKey,undefined,e.altKey?'range':'summary');return;}
  if(mod&&!e.shiftKey&&!e.getModifierState('AltGraph')){
    const shortcut=formattingShortcuts.find(shortcut=>shortcut.key===e.key.toLowerCase()&&shortcut.alt===e.altKey);
    if(shortcut){e.preventDefault();void action(shortcut.action);return;}
  }
  if(mod&&e.key.toLowerCase()==='c')return;
  if(mod&&['z','y','a'].includes(e.key.toLowerCase())){
    e.preventDefault();void action(e.key.toLowerCase()==='z'?(e.shiftKey?'redo':'undo'):e.key.toLowerCase()==='y'?'redo':'select-all');return;
  }
  if(e.key==='Escape'){copied=undefined;movingRows=movingColumns=undefined;clearMovePreview();render();return;}
  if(e.key==='Enter'||e.key==='F2'){e.preventDefault();syncDraft(inputText(current()),true);return;}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.key)){
    if(!mod||!e.shiftKey)extraSelections=[];
    e.preventDefault();navigateSelection(e.key,e.shiftKey);return;
  }
  if((e.key==='Delete'||e.key==='Backspace')&&!mod&&!e.altKey){e.preventDefault();deleteSelection(e.key==='Delete');}
  else if(e.key.length===1&&!mod&&!e.altKey){
    const s=sheet(),row=s.rows[selected.r].id,column=s.columns[selected.c].id,cell=current(),validation=cellValidation(s,row,column);
    const custom=!!validation&&((book.pickerSources[`default:${s.id}:${column}`]??book.pickerSources[`${s.id}:${column}`])==='manual'||!cell.binding&&!cell.formula&&cell.value!==undefined&&cell.value!==null&&cell.value!=='');
    e.preventDefault();
    if(validation&&!custom)openCellDropdown(undefined,true,e.key);
    else syncDraft(e.key,true,custom);
  }
});
document.addEventListener('paste',e=>{
  const own=e.clipboardData?.getData('application/x-fnt-copy')===clipboardId&&!!copied;
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)&&!(own&&emptyDropdownSearch(e.target))||document.querySelector('dialog[open]'))return;
  const text=e.clipboardData?.getData('text/plain');if(!text)return;e.preventDefault();
  if(!requireRectangle('Paste'))return;
  if(own){closeCellDropdown?.();pasteCells();return;}
  if(!editableReference()){flash('Edit the live list source instead.');return;}
  mutate('Paste text',()=>{const rows=parseTsv(text),s=sheet();let positionAt=pastePositions();rows.forEach((row,i)=>row.forEach((v,j)=>{const p=positionAt(i,j);if(!p)throw Error('Paste exceeds this sheet or list.');if(allTables(book).some(t=>t.sheet===s.id&&t.header===s.rows[p.r].id&&t.columns.some(c=>c.column===s.columns[p.c].id)))throw Error('Rename table headers explicitly.');const count=s.rows.length;writeGridCell(book,s,s.rows[p.r].id,s.columns[p.c].id,v);if(count!==s.rows.length)positionAt=pastePositions();}));});
});
document.addEventListener('cut',e=>{
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)||document.querySelector('dialog[open]'))return;
  if(!commitDraft())return;e.preventDefault();if(!copyCells(true))return;
  e.clipboardData?.setData('application/x-fnt-copy',clipboardId);
  e.clipboardData?.setData('text/plain',copiedText(copied!));
});
document.addEventListener('copy',e=>{
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)&&!emptyDropdownSearch(e.target))return;
  e.preventDefault();if(!copyCells())return;e.clipboardData?.setData('text/plain',copiedText(copied!));
  e.clipboardData?.setData('application/x-fnt-copy',clipboardId);e.preventDefault();
});
function emptyDropdownSearch(target:EventTarget|null):boolean{
  return target instanceof HTMLInputElement&&!!target.closest('.cell-dropdown')&&target.value===''&&target.selectionStart===target.selectionEnd;
}
document.addEventListener('click',e=>{if(appendDraft&&!(e.target as HTMLElement).closest('.reference-append-row')&&!commitDraft()){e.preventDefault();e.stopImmediatePropagation();}});
window.addEventListener('beforeunload',e=>{if(generation!==savedGeneration||draft!==undefined||appendDraft||colorPicker?.pending||navigationError){e.preventDefault();e.returnValue='Unsaved workbook edits or navigation preferences';}});
window.addEventListener('resize',()=>drawRowWindow?.());
window.addEventListener('online',()=>{if(state?.sync){status='Online - use Save to sync pending changes';renderStatus();}});
window.addEventListener('offline',()=>{status='Offline - local autosave remains available';renderStatus();});
channel?.addEventListener('message',e=>{if(state&&e.data.version>state.version){error='Another tab saved newer changes. Download a backup of this tab before reloading; further saves are blocked by revision checks.';renderStatus();}});
async function start():Promise<void> {
  root.innerHTML='<main class="startup"><p>Opening your local workbook...</p></main>';
  const publishedStarter=import.meta.env.PROD||import.meta.env.VITE_FNT_SYNTHETIC_STARTER!=='true';
  let stage='opening local storage';
  try{
    store=await Store.open();stage='loading the saved workbook';const loaded=await store.load();
    if(loaded){
      state=loaded;book=clone(state.book);
      if(!book.catalogMigrations?.includes(dropdownCatalog.id)||!book.catalogMigrations.includes(dropdownFormatMigration)||!book.catalogMigrations.includes(dropdownGroupMigration)){
        const before=await store.backup(state),result=seedDropdownCatalog(book,book.catalogMigrations?.includes(dropdownCatalog.id)?new Set():await verifiedCatalogOrigins(before));
        if(result.changed){
          state=await store.save(result.book,state.version,'Add original Dropdowns catalogs',true,undefined,{recoveryArchive:stringifyArchive(before)});
          book=clone(state.book);
          // Undo also records the user's choice not to seed these catalogs again.
          undo.push({book:{...clone(before.state.book),catalogMigrations:book.catalogMigrations}});
          channel?.postMessage({version:state.version});
        }
      }
      if(publishedStarter&&untouchedStarter(state,await store.originalCount())){
        try{
          const publishedId=await publishedTestingId();
          if(state.publishedSnapshot!==publishedId){
            const snapshot=await loadPublishedTesting(fetch,publishedId);
            const before=await store.backup(state);
            state=await store.save(snapshot.book,state.version,'Load published testing workbook',true,undefined,{localOnly:true,recoveryArchive:stringifyArchive(before),publishedSnapshot:snapshot.id});
            book=clone(state.book);
          }
        }catch(e){error=`Published testing data could not be updated; your existing workbook was retained. ${String(e)}`;}
      }
    }else{
      if(publishedStarter){
        stage='loading the published testing workbook';const snapshot=await loadPublishedTesting();book=snapshot.book;
        state=await store.save(book,0,'Load published testing workbook',false,undefined,{localOnly:true,publishedSnapshot:snapshot.id});
      }else{book=seedDropdownCatalog(createDemo()).book;state=await store.save(book,0,'Create starter workbook with original Dropdowns catalogs');}
    }
    stage='moving supporting data into DD storage';
    const migrated=migrateDropdownData(book);
    if(migrated.changed){
      const before=await store.backup(state);
      state=await store.save(migrated.book,state.version,'Move dropdown records into DD storage',true,undefined,{recoveryArchive:stringifyArchive(before)});
      book=clone(state.book);for(const entry of undo)if('book'in entry)entry.book=migrateDropdownData(entry.book).book;
      channel?.postMessage({version:state.version});
    }
    const savedUndo=await store.undoHistory(state.version,book.id);
    if(savedUndo){undo.splice(0,undo.length,...savedUndo.undo);redo.splice(0,redo.length,...savedUndo.redo);}
    let remembered:string|null=null;try{remembered=sessionStorage.getItem('fnt-current-sheet');}catch(e){error=`Selected-tab preference unavailable: ${String(e)}`;}
    stage='rendering the spreadsheet';engine=new Engine(book);sheetId=book.sheets.some(s=>s.id===remembered)?remembered!:book.sheets[0].id;const view=restoreView(remembered);if(referenceId&&!workbookView){const s=book.sheets.find(s=>!s.supporting)??book.sheets[0];workbookView={sheet:s.id,selected:{r:0,c:0},anchor:{r:0,c:0},kind:'cells',scroll:0,left:0};}status=state.sync?`Saved locally - ${state.pending.length} pending changes`:'Saved in this browser';render();if(view){const grid=root.querySelector<HTMLElement>('#grid-scroll')!;grid.scrollTop=view.scroll;grid.scrollLeft=view.left;drawRowWindow?.();rememberView();}
    if('serviceWorker'in navigator&&import.meta.env.PROD){
      navigator.serviceWorker.addEventListener('message',e=>{
        if(e.data?.type!=='fnt-update-ready'||!Array.isArray(e.data.files))return;
        const current=document.querySelector<HTMLScriptElement>('script[type=module][src]')?.src;
        if(current&&e.data.files.some((file:string)=>new URL(file,location.href).href===current))return;
        if(document.querySelector('#app-update'))return;
        const banner=document.createElement('div');banner.id='app-update';banner.className='app-update';banner.textContent='A newer website version is ready. ';
        const update=document.createElement('button');update.textContent='Save and update';
        update.onclick=()=>void(async()=>{if(!commitDraft())return;await flush();if(savedGeneration!==generation){flash('Save failed. Download a backup before updating.');return;}location.reload();})();
        banner.append(update);root.before(banner);
      });
      void navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(registration=>{
        const current=document.querySelector<HTMLScriptElement>('script[type=module][src]')?.src;
        const acknowledge=()=>navigator.serviceWorker.controller?.postMessage({type:'fnt-shell-loaded',file:current});
        navigator.serviceWorker.addEventListener('controllerchange',acknowledge);acknowledge();
        return registration.update();
      }).catch(e=>{flash(`Offline app cache failed: ${String(e)}`);});
    }
  }catch(e){root.innerHTML=`<main class="startup"><h1>Could not finish ${esc(stage)}</h1><p>${esc(String(e))}</p><p>Your browser data has not been cleared. Do not delete site data. ${stage==='rendering the spreadsheet'?'Reload after the application error is fixed.':'Check browser storage access, or restore a complete independent backup.'}</p></main>`;}
}
void start();
