import './style.css';
import { addRow, blankSheet, clone, columnIndex, createDemo, deleteColumn, deleteRows, duplicateSheet, expandAdjacentTable, fillCells, getCell, groupMoveTarget, insertColumn, isFault, key, letters, move, moveColumns, moveRows, moveIntoGroup, moveTargetGroups, outlineMembers, renameColumn, setInput, setHypotheticalTag, summaryMoveMembers, tableAt, translate, uid, uniqueName, type Cell, type Group, type ReferenceSource, type Sheet, type Workbook } from './model';
import { compile, displayFormula, Engine, scalar, type Ast } from './formula';
import { Store, SyncConflict, syncGitHub, type Backup, type LocalState } from './storage';
import { parseArchive, stringifyArchive } from './archive';
import { parseTsv,serializeTsv } from './clipboard';
import { cutCells, shiftCells } from './cell-operations';
import { excelDate,excelDateText } from './dates';
import { RowViewport } from './row-viewport';
import {captureSelection,selectionCount,selectionRanges,type SelectionArea,type SelectionBounds} from './selection';
import { defaultHeaderFormula,groupBlockToTop,positionalBlock } from './meal-block';
import { applyTableColumnFormula,columnCalculations,quantityDiagnostic,restoreCalculation,tableColumnFormulas } from './calculation';
import { groupReference,newReference,referenceSettings,type ReferenceHost } from './reference-ui';
import { dropdownArrowHtml,dropdownManualActionHtml,dropdownOptionsKey,mountDropdownOptions,mountSelectDropdown } from './dropdown-ui';
import { duplicateReference,moveReferenceGroup,referenceCaption,referenceChoices,referenceFormula,referenceGroups,referenceLabel,referenceNavigation,referenceUsages,removeReferenceValue,renameReferenceGroup,reorderReferenceSelection,setReferencePresentation,validationChoiceGroups,validationChoices,validationReference,type DropdownChoice,type ReferenceNavigation } from './references';
import { appendReferenceOption,conversionEditImpact,deleteReferenceColumns,referenceView,writeGridCell } from './reference-grid';
import { hexToHsv,hsvToHex,normalizeHex } from './colors';
import { dropdownCatalog,dropdownFormatMigration,dropdownGroupMigration,seedDropdownCatalog,verifiedCatalogOrigins } from './dropdown-catalog';
import { hypotheticalMembers,outlineGroups,outlineGutter,precedingGroupMember,summaryRowLayout,ungroupPlainGroups } from './grouping';
import {getHypotheticalStyle,hypotheticalBadgeCss,hypotheticalCss,hypotheticalTextCss} from './hypothetical';
import {openHypotheticalSettings} from './hypothetical-ui';
import {toolbarIcon} from './icons';
import { mountGroupControls } from './grouping-ui';
import {createTextSearch} from './find';
import {loadPublishedTesting,untouchedStarter} from './published';

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
let sheetId = '', selected = {r:1,c:0}, anchor = {...selected}, page = 0, filter = 'all';
let selectionKind:'cells'|'rows'|'columns'='cells';
let extraSelections:SelectionArea[]=[];
let renderedSheet='',renderedTarget='',scrollTarget:number|undefined,drawRowWindow:(()=>void)|undefined;
let navigationRows:number[]=[],navigationColumns:number[]=[];
const measuredRowHeights=new Map<string,number>();
const pinnedColumns=new Map<string,string[]>();
let touchSelection=false,touchPointer:number|undefined;
let fillSource:ReturnType<typeof bounds>|undefined,fillPointer:number|undefined;
let status = 'Opening local workbook...', error = '', busy = false, token = '';
let savedGeneration = 0, generation = 0, saving: Promise<void> = Promise.resolve();
type History = {book:Workbook}|{cells:{sheet:string;key:string;value?:Cell}[]};
const undo: History[] = [], redo: History[] = [];
let copied: {sheet:string; r:number;c:number;rows:string[];columns:string[];cells:Cell[][];cut?:boolean} | undefined;
let saveTimer: ReturnType<typeof setTimeout>;
let draft:string|undefined;
let draftLiteral=false;
let movingColumns:string[]|undefined;
let movingRows:string[]|undefined,referenceId:string|undefined,selectionTable:string|undefined;
let movePreview:{axis:'row'|'column';boundary:number;index:number;after:boolean;groupId?:string}|undefined;
let appendDraft:{source:string;column:string;value:string}|undefined;
let colorPicker:{pending:boolean;commit:()=>boolean;close:(apply?:boolean)=>boolean}|undefined;
let referenceNotice='';
let awaitingMutationConfirmation=false;
let closeCellDropdown:(()=>void)|undefined;
let groupControls:ReturnType<typeof mountGroupControls>|undefined,groupMenuOpen=false,groupMenuSheet='';
let groupManager:{refresh:()=>void;paint:()=>void;close:()=>void}|undefined;
let expandedEditor:{input:HTMLTextAreaElement;controller:AbortController;position:()=>void}|undefined;
function closeExpandedEditor():void{
  expandedEditor?.controller.abort();expandedEditor?.input.remove();expandedEditor=undefined;
}
let dropdownAssignmentGrid=true;
let resizing:{axis:'column'|'row';id:string;sheet:string;start:number;size:number;position:number;pointer:number;capture:HTMLElement}|undefined;
let workbookView:{sheet:string;selected:typeof selected;anchor:typeof anchor;kind:'cells'|'rows'|'columns';scroll:number;left:number;filter:string}|undefined;
const activeReference=()=>book.references?.find(s=>s.id===referenceId);
const gridReference=()=>{const source=activeReference();return source?referenceView(book,source):undefined;};
const editableReference=()=>!activeReference()||activeReference()!.kind!=='derived';
const inGrid=(r:number,c:number)=>{const view=gridReference(),s=sheet();return!view||view.rows.includes(s.rows[r]?.id)&&view.columns.includes(s.columns[c]?.id);};
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fnt-edits') : undefined;
const clipboardId=uid();
const sheet = () => book.sheets.find(s => s.id === sheetId)!;
const current = () => getCell(sheet(),sheet().rows[selected.r].id,sheet().columns[selected.c].id);
const bounds = () => ({r1:Math.min(anchor.r,selected.r),r2:Math.max(anchor.r,selected.r),c1:Math.min(anchor.c,selected.c),c2:Math.max(anchor.c,selected.c)});
const currentSelections=()=>selectionRanges(sheet(),bounds(),extraSelections);
const selectionMode=()=>extraSelections.every(area=>area.kind===selectionKind)?selectionKind:'cells';
const selectedAxisIndices=(axis:'row'|'column')=>{
  const ranges=currentSelections(),items=axis==='row'?sheet().rows:sheet().columns;
  return items.map((_,i)=>i).filter(i=>ranges.some(r=>axis==='row'?i>=r.r1&&i<=r.r2:i>=r.c1&&i<=r.c2));
};
function beginSelection(e:MouseEvent|PointerEvent,kind:typeof selectionKind):void{
  if(e.ctrlKey||e.metaKey){if(!e.shiftKey||selectionKind!==kind)extraSelections.push(captureSelection(sheet(),bounds(),selectionKind));}
  else extraSelections=[];
}
function requireRectangle(operation:string):SelectionBounds|undefined{
  const ranges=currentSelections();if(ranges.length===1)return ranges[0];
  flash(`${operation} requires one rectangular range. The unselected cells between your selections will not be changed.`);return;
}
function rememberView():void{
  const s=book?.sheets.find(s=>s.id===sheetId);if(!s?.rows[selected.r]||!s.columns[selected.c])return;
  const grid=root.querySelector<HTMLElement>('#grid-scroll');
  try{sessionStorage.setItem(`fnt-view:${book.id}`,JSON.stringify({reference:referenceId??null,sheet:sheetId,row:s.rows[selected.r].id,column:s.columns[selected.c].id,anchorRow:s.rows[anchor.r]?.id,anchorColumn:s.columns[anchor.c]?.id,kind:selectionKind,scroll:grid?.scrollTop??0,left:grid?.scrollLeft??0,workbookView}));sessionStorage.setItem('fnt-current-reference',referenceId??'');}catch(e){flash(`View preference could not be saved: ${String(e)}`);}
}
function restoreView():{scroll:number;left:number}|undefined{
  try{
    const raw=sessionStorage.getItem(`fnt-view:${book.id}`),legacy=sessionStorage.getItem('fnt-current-reference');
    if(!raw){if(legacy&&book.references?.some(s=>s.id===legacy&&s.kind!=='units')){referenceId=legacy;const view=gridReference();if(view?.sheet){sheetId=view.sheet.id;selected={r:Math.max(0,view.sheet.rows.findIndex(r=>r.id===(view.rows[1]??view.rows[0]))),c:Math.max(0,view.sheet.columns.findIndex(c=>c.id===view.columns[0]))};anchor={...selected};}}return;}
    const view=JSON.parse(raw);
    if(!view||typeof view.sheet!=='string'||typeof view.row!=='string'||typeof view.column!=='string'||!Number.isFinite(view.scroll)||!Number.isFinite(view.left))throw Error('Invalid saved view preference.');
    const s=book.sheets.find(s=>s.id===view.sheet);if(!s)return;
    referenceId=typeof view.reference==='string'&&book.references?.some(s=>s.id===view.reference&&s.kind!=='units')?view.reference:undefined;sheetId=s.id;
    selected={r:Math.max(0,s.rows.findIndex(r=>r.id===view.row)),c:Math.max(0,s.columns.findIndex(c=>c.id===view.column))};anchor={r:Math.max(0,s.rows.findIndex(r=>r.id===view.anchorRow)),c:Math.max(0,s.columns.findIndex(c=>c.id===view.anchorColumn))};
    selectionKind=['cells','rows','columns'].includes(view.kind)?view.kind:'cells';
    if(view.workbookView&&book.sheets.some(s=>s.id===view.workbookView.sheet))workbookView=view.workbookView;
    return{scroll:Math.max(0,view.scroll),left:Math.max(0,view.left)};
  }catch(e){error=`View preference could not be restored: ${String(e)}`;}
}
const inputText = (cell: Cell): string => cell.formula ? displayFormula(cell.formula,book) : cell.binding ? String(scalar(engine.cell(sheetId,sheet().rows[selected.r].id,sheet().columns[selected.c].id)) ?? '') : String(cell.value ?? '');
const cellText = (cell: Cell, s: Sheet, r: number,c: number): string => {
  const value = scalar(engine.cell(s.id,s.rows[r].id,s.columns[c].id));
  if (isFault(value)) return value.error;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if(!Number.isFinite(value))return '#NUM!';
    if (cell.format?.number === 'date') return excelDateText(value)??'#NUM!';
    if (cell.format?.number === 'percent') return `${+(value*100).toFixed(2)}%`;
    return cell.format?.number === 'decimal' ? value.toFixed(2) : String(+value.toPrecision(11));
  }
  return value;
};
function flash(e: unknown): void { error = e instanceof Error ? e.message : String(e); renderStatus(); }
function mutate(label: string, fn: () => void,confirmed=false): boolean {
  if (busy) { flash('Wait for the current save or sync to finish.'); return false; }
  const before = clone(book);
  const priorBook=book,shape=structureKey(book),metadata=metadataKey(book),cells=new Map(book.sheets.map(s=>[s.id,new Map(Object.entries(s.cells))]));
  try {
    fn();
    const impact=confirmed?'':conversionEditImpact(before,book);
    if(impact){
      const proposed=clone(book);book=before;engine=new Engine(book);
      draft=undefined;awaitingMutationConfirmation=true;render();
      confirmAction('Change conversion factor?',impact,()=>{draft=undefined;mutate(label,()=>{book=proposed;},true);});
      document.querySelector('dialog')?.addEventListener('close',()=>{awaitingMutationConfirmation=false;draft=undefined;renderStatus();});
      return false;
    }
  }
  catch(e) { book = before; engine = new Engine(book); flash(e); return false; }
  const changes:{sheet:string;key:string;value?:Cell}[]=[];
  if(priorBook===book&&metadata===metadataKey(book)){
    for(const s of book.sheets){
      const previous=cells.get(s.id)!,old=before.sheets.find(old=>old.id===s.id)!;
      for(const k of new Set([...Object.keys(s.cells),...previous.keys()]))if(previous.get(k)!==s.cells[k])changes.push({sheet:s.id,key:k,value:old.cells[k]});
    }
    undo.push({cells:changes});
  }else undo.push({book:before});
  while(undo.length>30||undo.filter(e=>'book'in e).length>3)undo.shift();
  redo.length = 0;
  const reset=priorBook!==book||shape!==structureKey(book);
  if(!reset){
    const changedCells:string[]=[];
    for(const s of book.sheets){
      const previous=cells.get(s.id)!;
      for(const [k,v]of Object.entries(s.cells))if(previous.get(k)!==v)changedCells.push(`${s.id}:${k}`);
      for(const k of previous.keys())if(!(k in s.cells))changedCells.push(`${s.id}:${k}`);
    }
    engine.invalidate(changedCells);
  }
  changed(label,reset); render();return true;
}
function structureKey(b:Workbook):string {
  return JSON.stringify([b.sheets.map(s=>[s.id,s.name,s.rows.map(r=>r.id),s.columns.map(c=>c.id)]),b.tables,b.names]);
}
function metadataKey(b:Workbook):string{return JSON.stringify(b,(k,v)=>k==='cells'?undefined:v);}
function changed(label: string,reset=true): void {
  book.revision++; generation++; if(reset)engine = new Engine(book); error = '';
  status = 'Unsaved changes - saving locally...'; clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flush(label); },350);
}
async function flush(label = 'Edit workbook'): Promise<void> {
  clearTimeout(saveTimer);
  saving = saving.then(async () => {
    if (savedGeneration === generation && state) return;
    const snapshot = clone(book), g = generation;
    status = 'Saving locally...'; renderStatus();
    try {
      state = await store.save(snapshot,state?.version ?? 0,label);
      savedGeneration = g;
      status = state.sync ? `Saved locally - ${state.pending.length} pending changes` : 'Saved in this browser';
      channel?.postMessage({version:state.version});
    } catch(e) { status = 'NOT SAVED - download a backup'; flash(e); throw e; }
    finally { renderStatus(); }
  }).catch(e => { flash(e); });
  await saving;
}
async function manualSave(): Promise<void> {
  if(busy){flash('Wait for the current save or sync to finish.');return;}
  if(!commitDraft())return;
  busy=true;renderStatus();
  try {
    await flush('Manual save');
    if(savedGeneration!==generation)return;
    if(!state.sync){await store.checkpoint('Manual save',book);status='Saved locally + recovery checkpoint';return;}
    if(!token){openSync();return;}
    status='Syncing private repository...';renderStatus();
    const originals=(await store.backup(state)).originals;
    const result = await syncGitHub(state,token,fetch,originals);
    if (result.remote) await store.checkpoint('Before remote download',book,result.originals??[]);
    state = await store.metadata(state.version,s => ({...s,book:clone(result.remote??book),remoteSha:result.sha,pending:[]}));
    if(result.remote){book=clone(state.book);engine=new Engine(book);sheetId=book.sheets[0].id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';page=0;undo.length=redo.length=0;}
    status = 'Synced with private repository'; render();
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
        state=await store.metadata(state.version,s=>({...s,book:clone(conflict.remote),remoteSha:conflict.sha,pending:[]}));
        book=clone(state.book);engine=new Engine(book);sheetId=book.sheets[0].id;page=0;selected={r:0,c:0};anchor={...selected};selectionKind='cells';generation++;savedGeneration=generation;undo.length=redo.length=0;
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
  updateCalculationState();
  root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('#formula,.cell-inline-editor').forEach(el=>el.disabled=busy||!editableReference()||!!gridReference()?.error);
  if(expandedEditor)expandedEditor.input.disabled=busy||!editableReference()||!!gridReference()?.error;
  const el = document.querySelector('#save-state');
  if (el) { el.textContent = draft!==undefined?'Editing cell - not saved yet':appendDraft?'Editing new option - not saved yet':colorPicker?.pending?'Previewing color - release to apply':status; el.className = `save-state ${error ? 'bad' : ''}`; }
  const alert = document.querySelector<HTMLElement>('#error');
  if (alert) { alert.textContent = error; alert.hidden = !error; }
  if(root.querySelector('[data-action="bold"]')){
    const format=inGrid(selected.r,selected.c)?current().format:undefined;
    for(const flag of ['bold','italic','underline','strikethrough','wrap'] as const)root.querySelector(`[data-action="${flag}"]`)?.setAttribute('aria-pressed',String(!!format?.[flag]));
  }
}
function referenceTabsHtml():string{
  const button=(source:ReferenceSource,label=referenceLabel(source),category?:string)=>`<button class="sheet-tab ${!category&&source.id===referenceId?'current ':''}${source.archived?'archived':''}" data-reference="${source.id}" ${category?`data-reference-group="${esc(category)}"`:''}>${esc(label)}</button>`;
  const node=(g:ReferenceNavigation,depth=1):string=>g.group?`<span class="reference-tab-group reference-group-depth-${depth}" role="group" aria-label="${esc(g.group)}">${button(g.members.find(s=>s.id===referenceId)??g.members[0],g.label,g.group)}<span class="reference-group-members" ${book.pickerSources[`dd-group-collapsed:${g.group.toLowerCase()}`]==='true'?'hidden':''}>${g.children.map(child=>node(child,depth+1)).join('')}</span></span>`:button(g.members[0]);
  return`<div class="tabs">${referenceNavigation(book).map(g=>node(g)).join('')}<button data-action="new-reference" aria-label="Add dropdown source">+</button><span class="tab-drop-marker" hidden></span></div>`;
}
function render(): void {
  hideShortcutHint();
  groupControls?.close();groupControls=undefined;
  closeCellDropdown?.();
  if(draft===undefined)closeExpandedEditor();
  engine.beginPass();
  if(activeReference()?.kind==='conversions'){const table=book.tables.find(t=>t.id===activeReference()!.table);if(table)sheetId=table.sheet;referenceId=undefined;}
  if(referenceId&&(!activeReference()||activeReference()?.kind==='units'))referenceId=book.references?.find(s=>s.kind!=='units'&&s.kind!=='conversions')?.id;
  document.body.classList.toggle('dd-mode',!!referenceId);
  const view=gridReference();
  if(view?.sheet)sheetId=view.sheet.id;
  const s = sheet();
  if (!s.rows.length || !s.columns.length) return;
  try{sessionStorage.setItem('fnt-current-sheet',s.id);}catch(e){error=`Could not remember the selected tab: ${String(e)}`;}
  selected.r=Math.min(selected.r,s.rows.length-1); selected.c=Math.min(selected.c,s.columns.length-1);
  anchor.r=Math.min(anchor.r,s.rows.length-1); anchor.c=Math.min(anchor.c,s.columns.length-1);
  if(view?.rows.length&&view.columns.length&&selectionKind==='cells'&&!inGrid(selected.r,selected.c)){selected={r:s.rows.findIndex(r=>r.id===(view.rows[1]??view.rows[0])),c:s.columns.findIndex(c=>c.id===view.columns[0])};anchor={...selected};selectionKind='cells';}
  const b = bounds(),previousGrid=root.querySelector<HTMLElement>('#grid-scroll'),viewKey=s.id+(referenceId??''),sameSheet=renderedSheet===viewKey;
  if(!sameSheet)extraSelections=[];
  const selectedRanges=currentSelections();
  const tabScroll=root.querySelector<HTMLElement>('.tabs')?.scrollLeft??0;
  const collapsedRows=new Set(s.groups.filter(g=>g.axis==='row'&&g.collapsed).flatMap(g=>outlineMembers(g,s.groups)));
  const collapsedColumns=new Set(s.groups.filter(g=>g.axis==='column'&&g.collapsed).flatMap(g=>outlineMembers(g,s.groups)));
  const pins=pinnedColumns.get(s.id)??[];
  const columns = s.columns.map((c,i) => ({...c,i})).filter(c => !c.hidden && !collapsedColumns.has(c.id)&&(!view||view.columns.includes(c.id)));
  columns.sort((a,b)=>Number(pins.includes(b.id))-Number(pins.includes(a.id)));
  const rows = s.rows.map((r,i) => ({...r,i})).filter(r => !r.hidden && !collapsedRows.has(r.id) && (!view?filter === 'all' || (r.status ?? 'real') === filter:view.rows.includes(r.id)));
  navigationRows=rows.map(r=>r.i);navigationColumns=columns.map(c=>c.i);
  const groups=s.groups.filter(g=>!view||g.members.some(id=>(g.axis==='row'?view.rows:view.columns).includes(id)));
  const tree=!!s.outlineView?.tree,hints=s.outlineView?.plainGroupHints!==false,outlines=outlineGroups(groups),gutter=outlineGutter(outlines,rows.map(r=>r.id),tree,s.rows.length,hints);
  const firstColumn=columns[0],rowLayouts=summaryRowLayout(groups,rows.map(r=>r.id),tree,()=>true);
  const hypotheticalRows=hypotheticalMembers(s,'row'),hypotheticalColumns=hypotheticalMembers(s,'column');
  const hypotheticalStyle=getHypotheticalStyle(book);
  const tableRightEdges=new Set<string>(),tableBottomEdges=new Set<string>();
  for(const table of book.tables.filter(table=>table.sheet===s.id)){
    const rowIds=new Set([table.header,...table.rows]),columnIds=new Set(table.columns.map(column=>column.column));
    const tableRows=rows.filter(row=>rowIds.has(row.id)),tableColumns=columns.filter(column=>columnIds.has(column.id));
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
  if(hints)for(const group of groups.filter(g=>g.axis==='column'&&g.kind!=='summary')){
    const id=precedingGroupMember(s,group,visibleColumns);
    if(id)columnHints.set(id,(columnHints.get(id)??0)+1);
  }
  let hasColumnControls=false;
  for(const column of columns){
    const controls=columnHints.get(column.id)??0;
    if(controls){hasColumnControls=true;column.width=Math.max(column.width??145,20+controls*52);}
    const rowInset=column.id===firstColumn?.id?Math.max(0,...[...rowLayouts.values()].map(row=>row.inset)):0;
    const summaryInset=(columnSummaries.get(column.id)??0)*24;
    if(rowInset||summaryInset)column.width=Math.max(column.width??145,rowInset+summaryInset+32);
  }
  const columnHeaderHeight=hasColumnControls?40:35;
  const estimatedHeaderHeight=columnHeaderHeight;
  if(groupMenuSheet!==viewKey){groupMenuOpen=false;groupMenuSheet=viewKey;}
  const pinOffsets=new Map<string,number>();let pinLeft=gutter;
  for(const c of columns)if(pins.includes(c.id)){pinOffsets.set(c.id,pinLeft);pinLeft+=c.width??145;}
  const pinnedStyle=(id:string,header=false)=>pinOffsets.has(id)?`position:sticky;left:${pinOffsets.get(id)}px;z-index:${header?6:3};`:'';
  const headers=new Set(book.tables.filter(t=>t.sheet===s.id).map(t=>t.header));
  const layout=new RowViewport(rows.map(r=>measuredRowHeights.get(r.id)??Math.max(r.height?r.height*4/3:33,headers.has(r.id)?38:0)));
  let vertical=sameSheet?previousGrid?.scrollTop??0:0;
  const target=scrollTarget??(renderedTarget!==`${s.id}:${selected.r}`?selected.r:undefined);
  if(target!==undefined){
    const position=rows.findIndex(r=>r.i>=target),at=position<0?rows.length-1:position,top=layout.offsets[Math.max(0,at)],height=previousGrid?.clientHeight??innerHeight-180;
    if(!sameSheet||scrollTarget!==undefined||top<vertical||top+(layout.heights[at]??33)>vertical+height-estimatedHeaderHeight)vertical=top;
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
    <div id="error" role="alert" class="error" ${error?'':'hidden'}>${esc(error)}</div>
    <nav class="toolbar" aria-label="Spreadsheet tools">
      <div class="tool-set">${(['undo','redo'] as const).map(name=>`<button class="icon-button" data-action="${name}" aria-label="${name==='undo'?'Undo':'Redo'}" title="${name==='undo'?'Undo (Ctrl+Z)':'Redo (Ctrl+Y)'}" ${(name==='undo'?undo:redo).length?'':'disabled'}>${toolbarIcon(name)}</button>`).join('')}</div>
      <div class="tool-set">${(['bold','italic','underline','strikethrough','wrap'] as const).map(name=>{const label={bold:'Bold',italic:'Italic',underline:'Underline',strikethrough:'Strikethrough',wrap:'Wrap text'}[name];return`<button class="icon-button" data-action="${name}" title="${label}" aria-label="${label}">${toolbarIcon(name)}</button>`;}).join('')}<button class="icon-button palette-button" data-action="text-color" title="Text color" aria-label="Text color">${toolbarIcon('text-color',current().format?.color??'#cc1122')}<span class="format-caret"></span></button><button class="icon-button palette-button" data-action="background-color" title="Cell background color" aria-label="Cell background color">${toolbarIcon('background-color',current().format?.background??'#ffdf00')}<span class="format-caret"></span></button><button data-action="format">123</button></div>
      <div class="tool-set">${referenceId?'<button data-action="reference-settings">DD settings</button>':''}<button data-action="dropdown-source" title="Assign a dropdown without changing cell contents">Assign DD</button></div>
      <div class="tool-set"><button class="icon-button" data-action="structure" title="Rows & columns" aria-label="Rows & columns">${toolbarIcon('structure')}</button>${referenceId?'<button data-action="archive-options">Hide / show selected options</button>':''}</div>
      <div class="tool-set">${(['find','copy','cut','paste','fill'] as const).map(name=>{const label={find:'Find / replace',copy:'Copy',cut:'Cut',paste:'Paste',fill:'Fill down'}[name];return`<button class="icon-button" data-action="${name}" title="${label}" aria-label="${label}">${toolbarIcon(name)}</button>`;}).join('')}</div>
      <div class="tool-set"><button class="icon-button" data-action="pin" aria-pressed="${pins.length>0}" title="${pins.length?'Unpin columns':'Pin selected columns'}" aria-label="${pins.length?'Unpin columns':'Pin selected columns'}">${toolbarIcon('pin')}</button><button class="icon-button" data-action="browse" title="Browse values" aria-label="Browse values">${toolbarIcon('browse')}</button><button class="icon-button" data-action="hypothetical" aria-label="Mark ${esc(hypotheticalStyle.label)}" title="Mark selected rows or columns ${esc(hypotheticalStyle.label)}" data-shortcut-label="Mark ${esc(hypotheticalStyle.label)}" data-shortcut-keys="Ctrl|H" aria-keyshortcuts="Control+H">${toolbarIcon('hypothetical')}</button><button class="icon-button" data-action="hypothetical-settings" aria-label="Hypothetical treatments" title="Customize ${esc(hypotheticalStyle.label)} row and column treatments">${toolbarIcon('hypothetical-settings')}</button><select id="status-filter" ${referenceId?'hidden':''} aria-label="Filter row status"><option value="all">All entries</option>${['real','planned','hypothetical'].map(v => `<option ${v===filter?'selected':''}>${v}</option>`).join('')}</select>${referenceId?'':'<button data-action="row-status">Set status</button>'}</div>
      ${referenceId?'':'<div class="tool-set"><button data-action="quick-add">+ Add entry</button></div>'}
      ${referenceId?'':'<div class="tool-set"><button data-action="tables">Tables</button><button data-action="block">Meal / day</button></div>'}
    </nav>
    <form class="formula-bar" id="formula-form"><span class="address">${letters(selected.c)}${selected.r+1}</span><span class="fx">fx</span><input id="formula" aria-label="Cell value or formula" autocomplete="off" spellcheck="false" value="${esc(draft??inputText(current()))}"><span id="calculation-state"></span></form>
    ${view&&(view.error||referenceNotice)?`<div class="reference-notice" id="reference-notice" role="${view.error?'alert':'status'}">${esc(view.error||referenceNotice)}</div>`:''}
    <div class="grid-shell"><div id="grid-scroll" class="grid-scroll" tabindex="0" aria-label="Spreadsheet, use arrow keys to navigate">
    <table class="grid option-a-outline ${tree?'tree-outline ':''}selection-${selectionKind} ${touchSelection?'touch-select':''}" role="grid" aria-label="${esc(activeReference()?.name??s.name)}" aria-rowcount="${s.rows.length}" aria-colcount="${s.columns.length}" style="--outline-gutter:${gutter}px;--column-header-height:${columnHeaderHeight}px;--grid-insert-width:${columns.reduce((w,c)=>w+(c.width??145),gutter)}px;--grid-insert-height:${layout.offsets.at(-1)!+estimatedHeaderHeight}px"><colgroup><col style="width:${gutter}px">${columns.map(c=>`<col style="width:${c.width??145}px">`).join('')}</colgroup>
    <thead><tr><th class="corner"><button data-action="select-all" aria-label="Select all cells">+</button><button class="boundary-control first-column" data-insert-column="0" aria-label="Insert column before A">+</button></th>${columns.map(c=>`<th data-col="${c.i}" style="${pinnedStyle(c.id,true)}" class="${c.i>=b.c1&&c.i<=b.c2?'column-selected ':''}${movingColumns?'move-target':''}" title="Double-click to rename column"><span class="column-index">${letters(c.i)}</span><span>${esc(t?.columns.find(x=>x.column===c.id)?.name??c.label)}</span><button class="move-control" data-move-column="${c.i}" draggable="true" aria-label="Move selected columns" title="Drag, or tap then tap a destination boundary">${grip(true)}</button><button class="boundary-control" data-insert-column="${c.i+1}" aria-label="${movingColumns?'Move columns':'Insert column'} after ${letters(c.i)}">+</button><button class="resize-edge resize-column" data-resize-column="${c.i}" aria-label="Resize column ${letters(c.i)}" title="Drag to resize; double-click to fit"></button></th>`).join('')}</tr></thead>
    <tbody></tbody></table></div></div>
    <div class="grid-footer"><div><button class="selection-count" data-action="range" title="Select a cell range, including on mobile">${selectionCount(selectedRanges)} cells</button><span class="desktop"> ${t?esc(t.name)+' / stable references':'Freeform sheet'}</span></div><div class="navigator"><button data-action="top" aria-label="Jump to top">Top</button><button data-action="prev" aria-label="Previous rows">&larr;</button><input id="row-jump" type="number" min="1" max="${s.rows.length}" aria-label="Jump to row"><span>/ ${s.rows.length}</span><button data-action="next" aria-label="Next rows">&rarr;</button><button data-action="bottom">Bottom</button></div></div>
    <footer class="sheet-bar" aria-label="${referenceId?'Dropdown sources':'Workbook sheets'}">${referenceId?referenceTabsHtml():`<div class="tabs">${book.sheets.filter(tab=>!tab.supporting||tab.id===s.id||(book.references??[]).some(source=>source.kind==='conversions'&&book.tables.some(table=>table.id===source.table&&table.sheet===tab.id))).map(tab=>`<button class="sheet-tab ${tab.id===s.id?'current':''}" data-sheet="${tab.id}" style="--tab-color:${esc(tab.color)}">${esc(tab.name)}</button>`).join('')}<button data-action="new-sheet" title="Add sheet" aria-label="Add sheet">+</button><span class="tab-drop-marker" hidden></span></div>`}<button class="reference-manager" data-action="references" title="Dropdown sources" aria-label="DD">DD</button></footer>`;
  const grid=root.querySelector<HTMLElement>('#grid-scroll')!,body=grid.querySelector('tbody')!;
  grid.dataset.firstRow=String(rows[0]?.i??0);grid.dataset.firstColumn=String(columns[0]?.i??0);
  groupControls=mountGroupControls({sheet:s,groups,grid,rows:rows.map(r=>r.id),columns:columns.map(c=>c.id),rowLayouts,tree,hints,menuOpen:groupMenuOpen,setMenuOpen:open=>{groupMenuOpen=open;},
    change:(label,fn)=>commitDraft()&&mutate(label,fn),selectAll:()=>{void action('select-all');},manage:openGroups});
  const headerHeight=grid.querySelector('thead')!.getBoundingClientRect().height;
  let lastStart=-1,lastEnd=-1;
  const spacer=(height:number,position:string)=>`<tr class="virtual-spacer" aria-hidden="true" data-spacer="${position}"><td colspan="${columns.length+1}" style="height:${height}px;padding:0;border:0;line-height:0;font-size:0"></td></tr>`;
  const draw=(initialTop?:number)=>{
    const top=initialTop??grid.scrollTop,window=layout.window(top,Math.max(100,grid.clientHeight-headerHeight));
    page=Math.floor((rows[layout.at(top)]?.i??0)/60);
    const jump=root.querySelector<HTMLInputElement>('#row-jump')!;
    if(document.activeElement!==jump)jump.value=String(view?layout.at(top)+1:(rows[layout.at(top)]?.i??0)+1);
    root.querySelector<HTMLButtonElement>('[data-action="prev"]')!.disabled=top<=0;
    root.querySelector<HTMLButtonElement>('[data-action="next"]')!.disabled=top+grid.clientHeight>=layout.offsets.at(-1)!+headerHeight;
    if(window.start===lastStart&&window.end===lastEnd&&initialTop===undefined)return;
    lastStart=window.start;lastEnd=window.end;engine.beginPass();
    const active=document.activeElement,wasInline=active instanceof HTMLTextAreaElement&&active.classList.contains('cell-inline-editor'),caret=wasInline?[active.selectionStart,active.selectionEnd]:undefined,b=bounds(),ranges=currentSelections();
    body.innerHTML=spacer(window.before,'before')+rows.slice(window.start,window.end).map((r,index)=>{const rowNumber=view?window.start+index+1:r.i+1;return`<tr data-row="${r.i}"${r.height?` style="--row-height:${r.height*4/3}px"`:''} class="${activeReference()?.archivedRows.includes(r.id)?'archived ':''}${r.status&&r.status!=='real'?r.status:''}"><th data-row-select="${r.i}" class="${r.i>=b.r1&&r.i<=b.r2?'row-selected':''}"><span class="row-index">${rowNumber}</span>${editableReference()&&(!view||r.id!==view.table?.header)?`<button class="row-move-control" data-move-row="${r.i}" draggable="true" aria-label="Move row ${rowNumber}" title="Drag row, or tap then tap destination">${grip(false)}</button>`:''}<button class="boundary-control row-boundary" data-insert-row="${r.i+1}" aria-label="${movingRows?'Move rows':'Insert row'} after ${rowNumber}">+</button>${index===0||view&&r.id===view.table?.rows[0]?`<button class="boundary-control row-start" data-insert-row="${r.i}" aria-label="Insert row before ${rowNumber}">+</button>`:''}<button class="resize-edge resize-row" data-resize-row="${r.i}" aria-label="Resize row ${rowNumber}" title="Drag to resize; double-click to fit"></button></th>${columns.map(c=>{
      const cell=getCell(s,r.id,c.id),val=cellText(cell,s,r.i,c.i),header=book.tables.some(t=>t.sheet===s.id&&t.header===r.id&&t.columns.some(x=>x.column===c.id)),inSelection=ranges.some(b=>r.i>=b.r1&&r.i<=b.r2&&c.i>=b.c1&&c.i<=b.c2),copying=copied?.sheet===s.id&&r.i>=copied.r&&r.i<copied.r+copied.cells.length&&c.i>=copied.c&&c.i<copied.c+copied.cells[0].length;
      const inset=(c.id===firstColumn?.id?rowLayouts.get(r.id)?.inset??0:0)+(r.id===rows[0]?.id?(columnSummaries.get(c.id)??0)*24:0);
      const tagged=hypotheticalRows.has(r.id)&&c.id===firstColumn?.id||hypotheticalColumns.has(c.id)&&r.id===rows[0]?.id;
      const treatment=hypotheticalRows.has(r.id)?hypotheticalStyle.rows:hypotheticalColumns.has(c.id)?hypotheticalStyle.columns:undefined;
      const badge=tagged&&treatment?.badge?`<span class="hypothetical-badge" style="${hypotheticalBadgeCss(treatment)}" role="img" aria-label="${esc(hypotheticalStyle.label)}" title="${esc(hypotheticalStyle.label)}">${toolbarIcon('hypothetical-badge')}</span>`:'';
      return `<td tabindex="-1" data-r="${r.i}" data-c="${c.i}" class="${tableRightEdges.has(key(r.id,c.id))?'table-right-edge ':''}${tableBottomEdges.has(key(r.id,c.id))?'table-bottom-edge ':''}${treatment?`hypothetical-cell ${treatment.fillOpacity>0?'has-hyp-fill ':''}${treatment.textColor?'custom-hyp-text ':''}`:''}${inset?'summary-cell ':''}${header?'table-header ':''}${inSelection?'selected ':''}${selected.r===r.i&&selected.c===c.i?'active ':''}${copying?'copying ':''}${cell.formula?'calculated ':''}${val.startsWith('#')?'cell-error ':''}${cell.binding?'linked ':''}" style="${treatment?hypotheticalCss(treatment):''}${inset?`--summary-text-inset:${inset}px;`:''}${pinnedStyle(c.id)}${cell.format?.bold?'font-weight:700;':''}${cell.format?.italic?'font-style:italic;':''}${cell.format?.underline||cell.format?.strikethrough?`text-decoration:${[cell.format?.underline?'underline':'',cell.format?.strikethrough?'line-through':''].filter(Boolean).join(' ')};`:''}${cell.format?.wrap?'white-space:pre-wrap;overflow-wrap:anywhere;':''}${cell.format?.background?`background-color:${esc(cell.format.background)};`:''}${cell.format?.color?`color:${esc(cell.format.color)};`:''}" title="${esc(cell.formula?displayFormula(cell.formula,book):val)}"><span class="cell-display">${badge}<span class="cell-value"${treatment?` style="${hypotheticalTextCss(treatment)}"`:''}>${safeLink(cell.link??val)?`<a href="${esc(cell.link??val)}" target="_blank" rel="noopener noreferrer">${esc(val)}</a>`:esc(val)}</span></span>${cell.note?'<span class="note-dot" title="Cell has a note"></span>':''}${r.i===b.r2&&c.i===b.c2?'<button type="button" class="fill-handle" data-fill-handle aria-label="Drag to fill"></button>':''}</td>`;
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
    const anchorIndex=layout.at(top),anchorOffset=top-layout.offsets[anchorIndex];let resized=false;
    body.querySelectorAll<HTMLElement>('tr[data-row]').forEach((el,i)=>{
      const height=el.getBoundingClientRect().height,position=window.start+i;
      if(height>0&&Math.abs(layout.heights[position]-height)>.1){layout.heights[position]=height;measuredRowHeights.set(rows[position].id,height);resized=true;}
    });
    if(resized){layout.rebuild();(body.querySelector('[data-spacer="before"] td') as HTMLElement).style.height=layout.offsets[window.start]+'px';(body.querySelector('[data-spacer="after"] td') as HTMLElement).style.height=layout.offsets.at(-1)!-layout.offsets[window.end]+'px';}
    grid.querySelector<HTMLElement>('.grid')!.style.setProperty('--grid-insert-height',layout.offsets.at(-1)!+headerHeight+'px');
    grid.scrollTop=layout.offsets[anchorIndex]+anchorOffset;bindRowControls();refreshSelection(false);groupControls?.drawRows();groupManager?.paint();paintMoving();rememberView();
    if(draft!==undefined&&!busy){
      syncDraft(draft,false,draftLiteral);
      if(wasInline){const editor=root.querySelector<HTMLTextAreaElement>('.cell-inline-editor')??root.querySelector<HTMLInputElement>('#formula')!;editor.focus({preventScroll:true});editor.setSelectionRange(caret![0],caret![1]);}
    }
  };
  drawRowWindow=()=>draw();draw(vertical);
  grid.scrollLeft=scroll;
  bind();
  groupManager?.refresh();
  root.querySelector<HTMLElement>('.tabs')!.scrollLeft=tabScroll;
  if(draft!==undefined)syncDraft(draft,false,draftLiteral);
  expandedEditor?.position();
  renderStatus();
  rememberView();
}
function safeLink(value: string): boolean {
  try { return ['https:','http:','mailto:'].includes(new URL(value).protocol); } catch { return false; }
}
function cellValidation(s:Sheet,row:string,column:string){
  if(book.tables.some(t=>t.sheet===s.id&&t.header===row&&t.columns.some(c=>c.column===column)))return;
  const assigned=s.validations.find(v=>v.rows.includes(row)&&v.columns.includes(column));if(!assigned)return;
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
function openCellDropdown(cell?:HTMLElement,force=true):void{
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
      book.pickerSources[preferenceKey]=source;book.pickerSources[listKey]=browsing;changed('Remember dropdown source',false);renderStatus();
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
    if(matchMedia('(pointer:fine)').matches)panel.querySelector<HTMLElement>('input,textarea')?.focus({preventScroll:true});
  }catch(e){close();flash(`Dropdown could not open: ${e instanceof Error?e.message:String(e)}`);}
}
function bindRowControls():void {
  root.querySelectorAll<HTMLElement>('td[data-r]').forEach(el=>{
    el.onpointerdown=e=>{
      if((e.target as HTMLElement).closest('a,textarea,input,button'))return;
      closeCellDropdown?.();
      if(!commitDraft())return;
      beginSelection(e,'cells');
      selected={r:Number(el.dataset.r),c:Number(el.dataset.c)};if(!e.shiftKey||selectionKind!=='cells')anchor={...selected};selectionKind='cells';
      if(touchSelection){e.preventDefault();touchPointer=e.pointerId;(root.querySelector('#grid-scroll') as HTMLElement).setPointerCapture(e.pointerId);}
      refreshSelection();(root.querySelector('#grid-scroll') as HTMLElement).focus({preventScroll:true});
    };
    el.onclick=e=>{if(!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!extraSelections.length&&e.detail<2&&!(e.target as HTMLElement).closest('a,textarea,input,button')&&anchor.r===selected.r&&anchor.c===selected.c)openCellDropdown(el,false);};
    el.ondblclick=()=>{closeCellDropdown?.();openEditor();};
  });
  root.querySelector<HTMLButtonElement>('[data-fill-handle]')?.addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();if(!commitDraft())return;const range=requireRectangle('Fill');if(!range)return;extraSelections=[];anchor={r:range.r1,c:range.c1};selected={r:range.r2,c:range.c2};fillSource={...range};fillPointer=e.pointerId;(root.querySelector('#grid-scroll') as HTMLElement).setPointerCapture(e.pointerId);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-row]').forEach(el=>el.onclick=e=>{
    e.stopPropagation();if(!commitDraft())return;const at=Number(el.dataset.insertRow),s=sheet();
    if(!editableReference()){flash('This is a read-only live list. Edit its source table.');return;}
    if(movingRows){dropRows(movingRows,at);return;}
    mutate('Insert rows',()=>insertDimensions('row',at));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-row]').forEach(el=>{
    const index=Number(el.closest<HTMLElement>('[data-row-select]')!.dataset.rowSelect),boundary=Number(el.dataset.insertRow);
    bindMoveBoundaryPreview(el,'row',boundary,index,boundary>index);
  });
  root.querySelectorAll<HTMLElement>('[data-row-select]').forEach(el=>el.onclick=e=>{
    if((e.target as HTMLElement).closest('button'))return;
    if(!commitDraft())return;
    beginSelection(e,'rows');
    selected={r:Number(el.dataset.rowSelect),c:sheet().columns.length-1};if(!e.shiftKey||selectionKind!=='rows')anchor={r:selected.r,c:0};
    selectionKind='rows';refreshSelection();root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});
  });
  root.querySelectorAll<HTMLButtonElement>('[data-move-row]').forEach(el=>{
    const ids=()=>{const at=Number(el.dataset.moveRow),indices=selectedAxisIndices('row'),block=selectionMode()==='rows'&&indices.includes(at);return summaryMoveMembers(sheet(),'row',sheet().rows.filter((r,i)=>(block?indices.includes(i):i===at)&&(!gridReference()||gridReference()!.rows.includes(r.id))).map(r=>r.id));};
    el.onclick=e=>{e.stopPropagation();if(!commitDraft())return;clearMovePreview();movingRows=movingRows?undefined:ids();movingColumns=undefined;render();};
    el.ondragstart=e=>{e.stopPropagation();if(!commitDraft()){e.preventDefault();return;}clearMovePreview();movingRows=ids();movingColumns=undefined;paintMoving();e.dataTransfer?.setData('application/x-fnt-rows',JSON.stringify(movingRows));if(e.dataTransfer)e.dataTransfer.effectAllowed='move';};
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
  scrolling.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;drawRowWindow?.();paintMovePreview();});},{passive:true});
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
    const target=movePreview;if(!target)return;
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
      if(cell){anchor={r:Math.min(fillSource.r1,Number(cell.dataset.r)),c:Math.min(fillSource.c1,Number(cell.dataset.c))};selected={r:Math.max(fillSource.r2,Number(cell.dataset.r)),c:Math.max(fillSource.c2,Number(cell.dataset.c))};refreshSelection();}return;
    }
    if(!touchSelection||event.pointerId!==touchPointer)return;
    event.preventDefault();const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('td[data-r]');
    if(cell){selected={r:Number(cell.dataset.r),c:Number(cell.dataset.c)};refreshSelection();}
  });
  const endTouch=()=>{touchPointer=undefined;touchSelection=false;root.querySelector('.grid')?.classList.remove('touch-select');};
  root.querySelector('#grid-scroll')!.addEventListener('pointerup',()=>{
    endTouch();if(fillSource){const source=fillSource,target=bounds();fillSource=undefined;fillPointer=undefined;if(JSON.stringify(source)!==JSON.stringify(target))mutate('Drag fill',()=>fillCells(book,sheet(),source,target));}
  });
  root.querySelector('#grid-scroll')!.addEventListener('pointercancel',()=>{endTouch();fillSource=undefined;fillPointer=undefined;});
  root.querySelectorAll<HTMLElement>('[data-col]').forEach(el=>{
    el.onclick=e=>{
      if((e.target as HTMLElement).closest('button')||!commitDraft())return;
      beginSelection(e,'columns');
      selected.c=Number(el.dataset.col);if(!e.shiftKey||selectionKind!=='columns')anchor={r:0,c:selected.c};else anchor.r=0;selected.r=sheet().rows.length-1;selectionKind='columns';refreshSelection();scrolling.focus({preventScroll:true});
    };
    el.ondblclick=()=>{ selected={r:Math.min(sheet().rows.length-1,Math.max(1,Number(root.querySelector<HTMLInputElement>('#row-jump')!.value)-1)),c:Number(el.dataset.col)};anchor={...selected};selectionKind='cells';renameSelectedColumn(); };
    el.ondragover=e=>{if(!e.dataTransfer?.types.includes('application/x-fnt-columns'))return;e.preventDefault();root.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));const after=e.clientX>=el.getBoundingClientRect().left+el.getBoundingClientRect().width/2;el.classList.add(after?'drop-after':'drop-before');const index=Number(el.dataset.col);showMovePreview('column',index+Number(after),index,after);};
    el.ondrop=e=>{
      e.preventDefault();const data=e.dataTransfer?.getData('application/x-fnt-columns');if(!data)return;
      try{const ids:unknown=JSON.parse(data);if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Invalid column drag.');dropColumns(ids,Number(el.dataset.col)+(el.classList.contains('drop-after')?1:0));}catch(error){flash(error);}
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-move-column]').forEach(el=>{
    el.onpointerdown=()=>el.focus({preventScroll:true});
    const ids=()=>{const c=Number(el.dataset.moveColumn),indices=selectedAxisIndices('column'),block=selectionMode()==='columns'&&indices.includes(c);return summaryMoveMembers(sheet(),'column',sheet().columns.filter((column,i)=>(block?indices.includes(i):i===c)&&(!gridReference()||gridReference()!.columns.includes(column.id))).map(column=>column.id));};
    el.onclick=e=>{e.stopPropagation();if(!commitDraft()||!editableReference())return;clearMovePreview();movingRows=undefined;movingColumns=movingColumns?undefined:ids();if(movingColumns){if(selectionMode()!=='columns'){extraSelections=[];const at=sheet().columns.findIndex(c=>c.id===movingColumns![0]);anchor={r:0,c:at};selected={r:sheet().rows.length-1,c:at};selectionKind='columns';}renderedTarget=`${sheetId}:${selected.r}`;}render();};
    el.ondragstart=e=>{e.stopPropagation();if(!commitDraft()||!editableReference()){e.preventDefault();return;}clearMovePreview();movingColumns=ids();movingRows=undefined;paintMoving();e.dataTransfer?.setData('application/x-fnt-columns',JSON.stringify(movingColumns));if(e.dataTransfer)e.dataTransfer.effectAllowed='move';};
    el.ondragend=()=>{movingColumns=undefined;paintMoving();root.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));};
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-column]').forEach(el=>el.onclick=e=>{
    e.stopPropagation();if(!commitDraft())return;const at=Number(el.dataset.insertColumn);
    if(movingColumns){dropColumns(movingColumns,at);return;}
    if(!editableReference()){flash('Edit the live list source instead.');return;}
    mutate('Insert columns',()=>insertDimensions('column',at));
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
  document.querySelector<HTMLSelectElement>('#status-filter')!.onchange=e=>{filter=(e.target as HTMLSelectElement).value;render();};
  document.querySelector<HTMLInputElement>('#row-jump')!.onchange=e=>{
    if(!commitDraft())return;const s=sheet(),view=gridReference(),number=Number((e.target as HTMLInputElement).value),count=view?.rows.length??s.rows.length;if(!Number.isInteger(number)||number<1||number>count){flash(`Enter a row between 1 and ${count}.`);return;}selected.r=view?s.rows.findIndex(r=>r.id===view.rows[number-1]):number-1;anchor={...selected};selectionKind='cells';scrollTarget=selected.r;page=Math.floor(selected.r/60);render();
  };
  document.querySelector('#title')!.addEventListener('click',()=>askText('Rename workbook',book.title,name=>mutate('Rename workbook',()=>{book.title=name;})));
}
function inlineSheetName(el:HTMLElement):void {
  const s=book.sheets.find(s=>s.id===el.dataset.sheet)!;el.draggable=false;
  const input=document.createElement('input');input.value=s.name;input.setAttribute('aria-label','Rename sheet');input.style.width='130px';el.replaceChildren(input);input.focus();input.select();
  let committed=false;
  const commit=()=>{if(committed)return;committed=true;const name=input.value.trim();if(name&&name!==s.name)mutate('Rename sheet',()=>{if(book.sheets.some(x=>x.id!==s.id&&x.name.toLowerCase()===name.toLowerCase()))throw Error('Sheet name is already in use.');s.name=name;});render();};
  input.onclick=e=>e.stopPropagation();input.onblur=commit;input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape'){committed=true;render();}};
}
function refreshSelection(closeDropdown=true):void {
  if(closeDropdown)closeCellDropdown?.();
  const grid=root.querySelector('.grid');grid?.classList.remove('selection-cells','selection-rows','selection-columns');grid?.classList.add(`selection-${selectionKind}`);
  renderedTarget=`${sheetId}:${selected.r}`;
  const b=bounds(),ranges=currentSelections();
  root.querySelectorAll<HTMLElement>('td[data-r]').forEach(el=>{
    const r=Number(el.dataset.r),c=Number(el.dataset.c);
    el.classList.toggle('selected',ranges.some(b=>r>=b.r1&&r<=b.r2&&c>=b.c1&&c<=b.c2));
    el.classList.toggle('active',r===selected.r&&c===selected.c);
  });
  root.querySelectorAll<HTMLElement>('[data-col]').forEach(el=>{const c=Number(el.dataset.col);el.classList.toggle('column-selected',ranges.some(b=>c>=b.c1&&c<=b.c2));});
  root.querySelectorAll<HTMLElement>('[data-row-select]').forEach(el=>{const r=Number(el.dataset.rowSelect);el.classList.toggle('row-selected',ranges.some(b=>r>=b.r1&&r<=b.r2));});
  const fill=root.querySelector('[data-fill-handle]'),last=root.querySelector(`td[data-r="${b.r2}"][data-c="${b.c2}"]`);if(fill&&last&&!last.querySelector('textarea'))last.append(fill);
  refreshDropdownControl();
  const formula=root.querySelector<HTMLInputElement>('#formula');if(formula)formula.value=inGrid(selected.r,selected.c)?inputText(current()):'';
  const address=root.querySelector('.address');if(address)address.textContent=`${letters(selected.c)}${selected.r+1}`;
  const count=root.querySelector('.selection-count');if(count)count.textContent=`${selectionCount(ranges)} cells`;
  renderStatus();
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
      const options=columnCalculations(book,s,row,column);
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
  if(!editableReference()){flash('Edit the live list source instead.');return;}
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
    if(e.key==='Tab'){selected.c=Math.max(0,Math.min(sheet().columns.length-1,selected.c+(e.shiftKey?-1:1)));anchor={...selected};refreshSelection();}
    (root.querySelector('#grid-scroll') as HTMLElement).focus();
  }
}
function navigateSelection(key:string,extend=false):void{
  if(!navigationRows.length||!navigationColumns.length)return;
  const row=Math.max(0,navigationRows.indexOf(selected.r)),column=Math.max(0,navigationColumns.indexOf(selected.c));
  selected={
    r:navigationRows[Math.max(0,Math.min(navigationRows.length-1,row+(key==='ArrowDown'?1:key==='ArrowUp'?-1:0)))],
    c:navigationColumns[Math.max(0,Math.min(navigationColumns.length-1,column+(key==='ArrowRight'||key==='Tab'?1:key==='ArrowLeft'?-1:0)))]
  };
  if(!extend||selectionKind!=='cells')anchor={...selected};selectionKind='cells';page=Math.floor(selected.r/60);render();
}
function applyInput(text:string): boolean {
  if(busy){flash('Wait for the current save or sync to finish.');return false;}
  if(!editableReference()||gridReference()?.error){flash('This list is read-only or unavailable. Edit its original source instead.');return false;}
  const previousDraft=draft,literal=draft!==undefined&&draftLiteral;draft=undefined;draftLiteral=false;
  if(!literal&&text===inputText(current())){render();return true;}
  const ok=mutate('Edit cell',()=>{
    const s=sheet(),t=book.tables.find(t=>t.sheet===s.id&&t.header===s.rows[selected.r].id&&t.columns.some(c=>c.column===s.columns[selected.c].id));
    if(t) renameColumn(book,t,t.columns.find(c=>c.column===s.columns[selected.c].id)!.id,text);
    else writeGridCell(book,s,s.rows[selected.r].id,s.columns[selected.c].id,text,literal);
  });
  if(!ok&&!awaitingMutationConfirmation){draft=previousDraft??text;draftLiteral=literal;}
  return ok;
}
function commitDraft():boolean{
  if(colorPicker?.pending&&!colorPicker.commit())return false;
  if(appendDraft){
    const pending=appendDraft;appendDraft=undefined;
    if(!mutate('Add dropdown option',()=>{const source=book.references?.find(s=>s.id===pending.source);if(!source)throw Error('This list no longer exists.');const row=appendReferenceOption(book,source,pending.column,pending.value),s=book.sheets.find(s=>s.id===book.tables.find(t=>t.id===source.table)!.sheet)!;selected={r:s.rows.findIndex(r=>r.id===row),c:s.columns.findIndex(c=>c.id===pending.column)};anchor={...selected};selectionKind='cells';})){appendDraft=pending;renderStatus();return false;}
  }
  const ok=draft===undefined||applyInput(draft);
  if(ok)closeExpandedEditor();else expandedEditor?.input.focus({preventScroll:true});
  renderStatus();return ok;
}
function dialog(title:string,html:string,onMount?:(d:HTMLDialogElement)=>void): HTMLDialogElement {
  hideShortcutHint();
  groupManager?.close();
  document.querySelector('dialog')?.remove();
  const d=document.createElement('dialog');d.innerHTML=`<div class="dialog-heading"><h2>${esc(title)}</h2><button class="close" aria-label="Close dialog">x</button></div>${html}`;
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
      if(e.key==='Tab'){selected.c=Math.max(0,Math.min(sheet().columns.length-1,selected.c+(e.shiftKey?-1:1)));anchor={...selected};selectionKind='cells';refreshSelection();}
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
  copied={sheet:s.id,r:b.r1,c:b.c1,rows:rows.map(r=>r.id),columns:columns.map(c=>c.id),cells:rows.map(r=>columns.map(c=>clone(getCell(s,r.id,c.id)))),cut};
  render();return true;
}
function pasteCells():void {
  if(!requireRectangle('Paste'))return;
  if(!copied){flash('Copy a cell range first, or paste tab-separated text with Ctrl+V.');return;}
  const source=copied, s=sheet(),from=book.sheets.find(s=>s.id===source.sheet);
  if(!from){flash('The copied sheet was deleted.');return;}
  if(source.cut){
    const rows=source.rows.map(id=>from.rows.findIndex(r=>r.id===id)),columns=source.columns.map(id=>from.columns.findIndex(c=>c.id===id));
    if(rows.some((r,i)=>r<0||r!==rows[0]+i)||columns.some((c,i)=>c<0||c!==columns[0]+i)){flash('The cut selection changed shape. Select and cut it again.');return;}
    if(mutate('Cut and move cells',()=>cutCells(book,from,{r1:rows[0],r2:rows.at(-1)!,c1:columns[0],c2:columns.at(-1)!},s,selected.r,selected.c))){copied=undefined;render();}
    return;
  }
  mutate('Paste cells',()=>{
    source.cells.forEach((row,i)=>row.forEach((cell,j)=>{
      const position=pastePosition(i,j);
      if(!position)throw Error('Paste exceeds this sheet or list. Add rows or columns first.');
      const row=position.r,column=position.c;
      const target=clone(cell);
      if(!from.rows.some(r=>r.id===source.rows[i])||!from.columns.some(c=>c.id===source.columns[j]))throw Error('Copied source was deleted. Copy again before pasting.');
      if(target.formula||target.binding||target.value!=null&&target.value!=='')expandAdjacentTable(book,s,s.rows[row].id,s.columns[column].id);
      if(target.formula)target.formula=translate(target.formula,book,from.id,source.rows[i],source.columns[j],s.rows[row].id,s.columns[column].id,s.id);
      if(target.calculation)target.calculation=translate(target.calculation,book,from.id,source.rows[i],source.columns[j],s.rows[row].id,s.columns[column].id,s.id);
      const targetTable=book.tables.find(t=>t.sheet===s.id&&t.header===s.rows[row].id&&t.columns.some(c=>c.column===s.columns[column].id));
      if(targetTable)throw Error('Paste into table headers is disabled. Rename headers explicitly to protect table integrity.');
      s.cells[key(s.rows[row].id,s.columns[column].id)]=target;
    }));
  });
}
function copiedText(source:NonNullable<typeof copied>):string{
  const s=book.sheets.find(s=>s.id===source.sheet)!;
  return serializeTsv(source.rows.map(row=>{
    const r=s.rows.findIndex(r=>r.id===row);
    return source.columns.map(column=>cellText(getCell(s,row,column),s,r,s.columns.findIndex(c=>c.id===column)));
  }));
}
function pastePosition(i:number,j:number):typeof selected|undefined{
  const s=sheet(),view=gridReference(),rows=s.rows.map((_,r)=>r).filter(r=>r>=selected.r&&(!view||view.rows.includes(s.rows[r].id))),cols=s.columns.map((_,c)=>c).filter(c=>c>=selected.c&&(!view||view.columns.includes(s.columns[c].id)));
  return rows[i]!==undefined&&cols[j]!==undefined?{r:rows[i],c:cols[j]}:undefined;
}
async function action(name:string):Promise<void> {
  if(busy){flash('Wait for the current save or sync to finish.');return;}
  if(!commitDraft())return;
  if(['fill','tables','dropdown-source','block'].includes(name)&&extraSelections.length){const b=requireRectangle(name==='dropdown-source'?'Assign dropdown':name);if(!b)return;extraSelections=[];anchor={r:b.r1,c:b.c1};selected={r:b.r2,c:b.c2};}
  if(['select-all','range','top','bottom','next','prev','undo','redo'].includes(name))extraSelections=[];
  if(referenceId&&!editableReference()&&!['back-workbook','reference-settings','references','new-reference','copy','save','file','find','hypothetical-settings','undo','redo','range','top','bottom','next','prev','dropdown-source'].includes(name)){flash('This is a read-only live list. Edit its source table or change its connection.');return;}
  switch(name) {
    case 'save': await manualSave();break;
    case 'undo':case 'redo': {
      const from=name==='undo'?undo:redo,to=name==='undo'?redo:undo,previous=from.pop();
      if(previous){
        const revision=book.revision;
        if('book'in previous){to.push({book:clone(book)});book=previous.book;}
        else{
          const inverse:Extract<History,{cells:unknown}>={cells:[]};
          for(const change of previous.cells){
            const s=book.sheets.find(s=>s.id===change.sheet);if(!s){flash('Undo target no longer exists. Restore from recovery.');return;}
            inverse.cells.push({sheet:s.id,key:change.key,value:s.cells[change.key]?clone(s.cells[change.key]):undefined});
            if(change.value)s.cells[change.key]=clone(change.value);else delete s.cells[change.key];
          }
          to.push(inverse);
        }
        book.revision=revision;if(!book.sheets.some(s=>s.id===sheetId))sheetId=book.sheets[0].id;changed(name);render();
      }break;
    }
    case 'bold':case 'italic':case 'underline':case 'strikethrough':case 'wrap':{
      let enabled=true;eachSelected((s,r,c)=>{if(!getCell(s,s.rows[r].id,s.columns[c].id).format?.[name])enabled=false;});
      mutate(`Toggle ${name}`,()=>eachSelected((s,r,c)=>{
        const cell=clone(getCell(s,s.rows[r].id,s.columns[c].id));cell.format={...cell.format,[name]:!enabled};s.cells[key(s.rows[r].id,s.columns[c].id)]=cell;
      }));break;
    }
    case 'text-color':openColorPalette('color');break;
    case 'background-color':openColorPalette('background');break;
    case 'format':openFormat();break;
    case 'editor':openEditor();break;
    case 'copy':copyCells();break;
    case 'cut':copyCells(true);break;
    case 'paste':pasteCells();break;
    case 'fill':mutate('Fill down',()=>{
      const s=sheet(),b=bounds();
      const rows=s.rows.map((_,i)=>i).filter(r=>r>=b.r1&&r<=b.r2&&inGrid(r,selected.c)),columns=s.columns.map((_,i)=>i).filter(c=>c>=b.c1&&c<=b.c2&&(!gridReference()||gridReference()!.columns.includes(s.columns[c].id)));
      for(const c of columns)for(const r of rows.slice(1)){
        if(book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(x=>x.column===s.columns[c].id)))throw Error('Fill cannot overwrite table headers. Rename headers explicitly.');
        const cell=clone(getCell(s,s.rows[rows[0]].id,s.columns[c].id));
        if(cell.formula)cell.formula=translate(cell.formula,book,s.id,s.rows[rows[0]].id,s.columns[c].id,s.rows[r].id,s.columns[c].id);
        else if(typeof cell.value==='string'&&/\d+$/.test(cell.value))cell.value=cell.value.replace(/\d+$/,n=>String(Number(n)+rows.indexOf(r)));
        if(cell.calculation)cell.calculation=translate(cell.calculation,book,s.id,s.rows[rows[0]].id,s.columns[c].id,s.rows[r].id,s.columns[c].id);
        s.cells[key(s.rows[r].id,s.columns[c].id)]=cell;
      }
    });break;
    case 'pin':{const indices=selectedAxisIndices('column');pinnedColumns.set(sheetId,(pinnedColumns.get(sheetId)?.length??0)>0?[]:indices.map(i=>sheet().columns[i].id));render();break;}
    case 'browse':openBrowse();break;
    case 'select-all':anchor={r:0,c:0};selected={r:sheet().rows.length-1,c:sheet().columns.length-1};selectionKind='cells';scrollTarget=0;render();break;
    case 'range':{const b=bounds();askText('Select a range (for example A2:C6)',`${letters(b.c1)}${b.r1+1}:${letters(b.c2)}${b.r2+1}`,text=>{
      const m=text.toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);if(!m){flash('Use a range such as A2:C6.');return;}
      const a={r:Number(m[2])-1,c:columnIndex(m[1])},z={r:Number(m[4]??m[2])-1,c:columnIndex(m[3]??m[1])};
      if([a,z].some(p=>p.r<0||p.r>=sheet().rows.length||p.c<0||p.c>=sheet().columns.length)){flash('Range is outside this sheet.');return;}
      anchor=a;selected=z;selectionKind='cells';scrollTarget=Math.min(a.r,z.r);page=Math.floor(Math.min(a.r,z.r)/60);render();
    });const d=document.querySelector<HTMLDialogElement>('dialog')!,button=document.createElement('button');button.textContent='Drag to select cells';button.type='button';button.onclick=()=>{d.close();touchSelection=true;render();};d.append(button);break;}
    case 'top':page=0;selected.r=0;scrollTarget=0;anchor={...selected};selectionKind='cells';render();break;
    case 'bottom':{
      const s=sheet(),used=new Set(Object.entries(s.cells).filter(([,c])=>c.value!=null||c.formula||c.binding||c.note).map(([k])=>k.split(':')[0]));
      selected.r=0;for(let i=s.rows.length-1;i>=0;i--)if(used.has(s.rows[i].id)){selected.r=i;break;}page=Math.floor(selected.r/60);scrollTarget=selected.r;anchor={...selected};selectionKind='cells';render();break;
    }
    case 'prev':scrollTarget=Math.max(0,page*60-60);render();break;
    case 'next':scrollTarget=Math.min(sheet().rows.length-1,(page+1)*60);render();break;
    case 'new-sheet':askText('New sheet','Untitled',name=>mutate('Add sheet',()=>{const s=blankSheet(uniqueName(book.sheets.map(s=>s.name),name));book.sheets.push(s);sheetId=s.id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';page=0;}));break;
    case 'sheet-options':openSheetOptions();break;
    case 'structure':openStructure();break;
    case 'tables':openTables();break;
    case 'references':if(referenceId)backToWorkbook();else openReferences();break;
    case 'back-workbook':backToWorkbook();break;
    case 'new-reference':newReference(referenceHost());break;
    case 'reference-settings':if(activeReference()){const targets=selectedReferenceTabs();referenceSettings(referenceHost(),activeReference()!,targets.length?targets:undefined);}break;
    case 'dropdown-source':openDropdownAssignment();break;
    case 'archive-options':{
      const source=activeReference();if(!source)break;
      mutate('Archive options',()=>{const ids=selectedReferenceRows(),show=ids.every(id=>source.archivedRows.includes(id));source.archivedRows=show?source.archivedRows.filter(id=>!ids.includes(id)):[...new Set([...source.archivedRows,...ids])];});break;
    }
    case 'groups':openGroups();break;
    case 'hypothetical-settings':{
      openHypotheticalSettings({style:getHypotheticalStyle(book),dialog,save:async style=>{
        if(!mutate('Save hypothetical treatments',()=>{book.hypotheticalStyle=style;}))throw Error(error||'Treatment settings could not be applied.');
        const g=generation;await flush('Save hypothetical treatments');
        if(savedGeneration<g)throw Error(error||'Treatment settings are not saved. Retry or download a backup.');
      }});break;
    }
    case 'hypothetical':case 'clear-hypothetical':{
      const mode=selectionMode();
      if(mode!=='rows'&&mode!=='columns'){flash('Select entire rows or columns to change their hypothetical tag.');break;}
      const axis=mode==='rows'?'row':'column',items=axis==='row'?sheet().rows:sheet().columns;
      const ids=selectedAxisIndices(axis).map(i=>items[i].id);
      mutate(name==='hypothetical'?'Mark hypothetical':'Remove hypothetical tag',()=>setHypotheticalTag(sheet(),axis,ids,name==='hypothetical'));
      break;
    }
    case 'ungroup-plain':{
      if(!book.sheets.some(s=>s.groups.some(g=>g.kind!=='summary'))){flash('There are no plain groups in this workbook.');break;}
      try{
        await flush();await store.checkpoint('Before ungrouping all plain groups',book);
        if(mutate('Ungroup all plain groups',()=>ungroupPlainGroups(book)))await flush('Ungroup all plain groups');
      }catch(e){flash(e);}
      break;
    }
    case 'block':openBlock();break;
    case 'find':openFind();break;
    case 'quick-add':{
      const s=sheet(),t=gridReference()?.table??tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??book.tables.find(t=>t.sheet===s.id);
      mutate('Add entry',()=>{const at=t?Math.max(s.rows.findIndex(r=>r.id===t.header)+1,...t.rows.map(id=>s.rows.findIndex(r=>r.id===id)+1)):selected.r+1;addRow(book,s,at,t);selected={r:at,c:t?s.columns.findIndex(c=>c.id===t.columns[0].column):0};anchor={...selected};selectionKind='cells';page=Math.floor(at/60);});document.querySelector<HTMLInputElement>('#formula')?.focus();break;
    }
    case 'row-status':dialog('Entry status','<p>Metadata only. This does not rewrite dates or change imported formulas. Your formulas must explicitly exclude hypothetical rows if needed.</p><div class="menu">'+['real','planned','hypothetical'].map(x=>`<button data-status="${x}">${x}</button>`).join('')+'</div><hr><div class="button-row"><button id="mark-hypothetical">Mark hypothetical tag</button><button id="clear-hypothetical">Remove hypothetical tag</button></div>',d=>{
      d.querySelectorAll<HTMLButtonElement>('[data-status]').forEach(el=>el.onclick=()=>{mutate('Set entry status',()=>{selectedAxisIndices('row').forEach(i=>sheet().rows[i].status=el.dataset.status as 'real'|'planned'|'hypothetical');});d.close();});
      for(const [id,name]of [['mark-hypothetical','hypothetical'],['clear-hypothetical','clear-hypothetical']])d.querySelector<HTMLButtonElement>('#'+id)!.onclick=()=>{d.close();void action(name);};
    });break;
    case 'file':openFile();break;
    case 'safety':openSafety();break;
    case 'report':dialog('Import compatibility',`<p>Original Excel remains authoritative. Recalculated results have not been comprehensively compared with Excel.</p><pre>${esc(JSON.stringify(book.importReport,null,2))}</pre>`);break;
  }
}
function openFormat():void {
  dialog('Cell formatting',`<form><label>Number display<select id="number-format"><option value="">General</option><option value="decimal">Two decimals</option><option value="percent">Percent</option><option value="date">Date</option></select></label><label>Text color<input type="color" id="text-color" value="#193c34"></label><label>Background<input type="color" id="bg-color" value="#ffffff"></label><button class="primary">Apply to selection</button></form>`,d=>d.querySelector('form')!.onsubmit=e=>{
    e.preventDefault();mutate('Format cells',()=>eachSelected((s,r,c)=>{const cell=clone(getCell(s,s.rows[r].id,s.columns[c].id));cell.format={...cell.format,excelNumberFormat:undefined,number:d.querySelector<HTMLSelectElement>('#number-format')!.value,color:d.querySelector<HTMLInputElement>('#text-color')!.value,background:d.querySelector<HTMLInputElement>('#bg-color')!.value};s.cells[key(s.rows[r].id,s.columns[c].id)]=cell;}));d.close();
  });
}
function openColorPalette(property:'color'|'background'):void{
  if(busy||!editableReference()){flash('Wait for saving to finish or select an editable cell.');return;}
  if(!commitDraft()||colorPicker&&!colorPicker.close())return;
  const colors=['#ffffff','#000000','#e7e6e6','#44546a','#4472c4','#ed7d31','#a5a5a5','#ffc000','#5b9bd5','#70ad47','#f2f2f2','#7f7f7f','#d0cece','#d6dce4','#d9e2f3','#fbe5d6','#ededed','#fff2cc','#ddebf7','#e2efda','#c00000','#ff0000','#ffc000','#ffff00','#92d050','#00b050','#00b0f0','#0070c0','#002060','#7030a0'];
  const targets:{sheet:string;row:string;column:string}[]=[];eachSelected((s,r,c)=>targets.push({sheet:s.id,row:s.rows[r].id,column:s.columns[c].id}));
  const d=document.createElement('dialog'),controller=new AbortController();d.className='color-picker';
  d.innerHTML=`<div class="dialog-heading"><h2></h2><button class="close" aria-label="Close color picker" data-shortcut-label="Close color picker" data-shortcut-keys="Esc" aria-keyshortcuts="Escape"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div><div class="color-mode"><button data-color-mode="background">Fill</button><button data-color-mode="color">Text</button></div><div class="color-palette" role="group" aria-label="Color palette">${colors.map((color,i)=>`<button class="color-swatch" data-color="${color}" style="background:${color}" aria-label="Color ${color}, swatch ${i+1}" title="${color}"></button>`).join('')}</div><div class="color-shade" tabindex="0" role="slider" aria-label="Custom saturation and brightness" aria-valuemin="0" aria-valuemax="100"><span class="color-shade-marker"></span></div><input class="color-hue" type="range" min="0" max="360" aria-label="Hue"><button id="clear-color"></button><label class="custom-color-row">Custom<span class="custom-color-chip" aria-hidden="true"></span><input id="custom-color" aria-label="Custom hex color" maxlength="7" autocomplete="off" spellcheck="false"></label><div class="color-picker-error" role="alert"></div>`;
  const hex=d.querySelector<HTMLInputElement>('#custom-color')!,hue=d.querySelector<HTMLInputElement>('.color-hue')!,shade=d.querySelector<HTMLElement>('.color-shade')!,marker=d.querySelector<HTMLElement>('.color-shade-marker')!,message=d.querySelector<HTMLElement>('.color-picker-error')!;
  let chosen:string|undefined,currentHex='#233c34',hsv=hexToHsv(currentHex);
  const cells=()=>targets.map(target=>{const s=book.sheets.find(s=>s.id===target.sheet);if(!s||!s.rows.some(r=>r.id===target.row)||!s.columns.some(c=>c.id===target.column))throw Error('The selected cells changed. Reopen the color picker.');return{s,...target};});
  const restore=()=>{for(const target of cells()){const r=target.s.rows.findIndex(r=>r.id===target.row),c=target.s.columns.findIndex(c=>c.id===target.column),td=root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);if(td)td.style[property]=getCell(target.s,target.row,target.column).format?.[property]??'';}};
  const position=()=>{const viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;d.style.maxHeight=Math.max(80,height-16)+'px';d.style.width=Math.min(336,width-16)+'px';const button=root.querySelector<HTMLElement>(`[data-action="${property==='color'?'text-color':'background-color'}"]`),rect=button?.getBoundingClientRect(),size=d.getBoundingClientRect();d.style.left=Math.max(left+8,Math.min(rect?.left??left+8,left+width-size.width-8))+'px';d.style.top=Math.max(top+8,Math.min((rect?.bottom??top)+6,top+height-size.height-8))+'px';};
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
function renameSheet():void {askText('Rename sheet',sheet().name,name=>mutate('Rename sheet',()=>{if(book.sheets.some(s=>s.id!==sheetId&&s.name.toLowerCase()===name.toLowerCase()))throw Error('Sheet name is already in use.');sheet().name=name;}));}
function openSheetOptions():void {
  dialog('Sheet settings',`<div class="menu"><button id="rename-sheet">Rename sheet</button><button id="duplicate-sheet">Duplicate sheet with independent identities</button><button id="sheet-left">Move tab left</button><button id="sheet-right">Move tab right</button><label>Tab color<input id="sheet-color" type="color" value="${esc(sheet().color)}"></label><button id="delete-sheet" class="danger">Delete sheet</button></div>`,d=>{
    const run=(id:string,fn:()=>void)=>d.querySelector<HTMLButtonElement>(id)!.onclick=()=>{d.close();fn();};
    run('#rename-sheet',renameSheet);
    run('#duplicate-sheet',()=>mutate('Duplicate sheet',()=>{sheetId=duplicateSheet(book,sheet()).id;}));
    for(const [id,delta] of [['#sheet-left',-1],['#sheet-right',1]] as const)run(id,()=>mutate('Move sheet',()=>{const i=book.sheets.findIndex(s=>s.id===sheetId);move(book.sheets,i,i+delta);}));
    d.querySelector<HTMLInputElement>('#sheet-color')!.onchange=e=>mutate('Tab color',()=>{sheet().color=(e.target as HTMLInputElement).value;});
    run('#delete-sheet',()=>confirmAction('Delete sheet?', 'References to deleted cells and tables will show #REF!, never relink to replacement names.',()=>mutate('Delete sheet',()=>{
      if(book.sheets.length===1)throw Error('Keep at least one sheet.');book.sheets=book.sheets.filter(s=>s.id!==sheetId);book.tables=book.tables.filter(t=>t.sheet!==sheetId);book.names=book.names.filter(n=>n.sheet!==sheetId);sheetId=book.sheets[0].id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';page=0;
    })));
  });
}
function renameSelectedColumn():void {
  const s=sheet(),t=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??book.tables.find(t=>t.sheet===s.id&&t.columns.some(c=>c.column===s.columns[selected.c].id));
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
  const t=book.tables.find(t=>t.id===tableId),s=t&&book.sheets.find(s=>s.id===t.sheet);
  if(!t||!s||!t.rows.length){flash('Add a data row before editing this table column.');return;}
  const patterns=tableColumnFormulas(book,t,column);
  dialog('Column formulas',`<form id="column-formula-form"><label>Formula pattern<select id="column-formula-pattern">${patterns.map((p,i)=>`<option value="${i}">Pattern ${i+1} · row ${s.rows.findIndex(r=>r.id===p.row)+1}</option>`).join('')}<option value="-1" ${patterns.length?'':'selected'}>New formula</option></select></label><label>Formula<textarea id="column-formula" rows="4" required spellcheck="false">${esc(patterns.length?displayFormula(patterns[0].formula,book):'=')}</textarea></label><label>Apply to<select id="column-formula-scope"><option value="matching" ${patterns.length?'':'disabled'}>Matching formula pattern; preserve manual overrides</option><option value="calculated" ${patterns.length?'':'selected'}>Calculated and empty cells; preserve manual values</option><option value="all">All data rows; replace manual values</option></select></label><p>Table headers are never changed. Other formula patterns stay intact when editing a matching pattern. Rows with saved manual overrides keep their values and receive the updated restore formula.</p><button class="primary">Apply formula</button></form>`,d=>{
    const picker=d.querySelector<HTMLSelectElement>('#column-formula-pattern')!,input=d.querySelector<HTMLTextAreaElement>('#column-formula')!,scope=d.querySelector<HTMLSelectElement>('#column-formula-scope')!;
    picker.onchange=()=>{const pattern=patterns[Number(picker.value)];input.value=pattern?displayFormula(pattern.formula,book):'=';scope.options[0].disabled=!pattern;scope.value=pattern?'matching':'calculated';};
    d.querySelector('form')!.onsubmit=e=>{e.preventDefault();if(mutate('Edit table column formulas',()=>{
      const current=book.tables.find(t=>t.id===tableId);if(!current)throw Error('This table was removed.');
      if(!input.value.trim().startsWith('='))throw Error('Enter a formula beginning with =.');
      const formula=compile(input.value,book,s.id,current.rows[0],column);
      applyTableColumnFormula(book,current,column,formula,scope.value as 'matching'|'calculated'|'all',patterns[Number(picker.value)]?.formula);
    }))d.close();};
  });
}
function openBrowse():void {
  const s=sheet();
  dialog('Browse dates or values',`<label>Column<select id="browse-column">${s.columns.map((c,i)=>`<option value="${i}" ${i===selected.c?'selected':''}>${letters(i)} / ${esc(book.tables.find(t=>t.sheet===s.id&&t.columns.some(x=>x.column===c.id))?.columns.find(x=>x.column===c.id)?.name??c.label)}</option>`).join('')}</select></label><label>Search<input id="browse-search" type="search"></label><input id="browse-position" type="range" min="0" max="0" value="0" aria-label="Value position"><p id="browse-preview" aria-live="polite"></p><button id="browse-go" class="primary">Go to row</button>`,d=>{
    const column=d.querySelector<HTMLSelectElement>('#browse-column')!,search=d.querySelector<HTMLInputElement>('#browse-search')!,slider=d.querySelector<HTMLInputElement>('#browse-position')!,preview=d.querySelector<HTMLElement>('#browse-preview')!,go=d.querySelector<HTMLButtonElement>('#browse-go')!;
    let entries:{row:string;text:string;index:number}[]=[],matches:typeof entries=[],browseError='';
    const update=()=>{const entry=matches[Number(slider.value)];preview.textContent=entry?`${entry.text} / row ${entry.index+1} / ${Number(slider.value)+1} of ${matches.length}`:browseError||'No matching values';go.disabled=!entry;slider.disabled=!matches.length;};
    const filterEntries=()=>{matches=entries.filter(e=>e.text.toLowerCase().includes(search.value.toLowerCase()));slider.max=String(Math.max(0,matches.length-1));slider.value='0';update();};
    const load=()=>{
      engine.beginPass();entries=[];browseError='';
      try{
        const c=Number(column.value);
        for(let r=0;r<s.rows.length;r++){
          const row=s.rows[r];
          if(row.hidden||filter!=='all'&&(row.status??'real')!==filter||book.tables.some(t=>t.sheet===s.id&&t.header===row.id))continue;
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
  const items=['Insert row above','Insert column left','Rename column','Move column left','Move column right','Move rows up','Move rows down','Move rows to top','Hide selected rows','Hide selected columns','Unhide all','Set column width','Delete selected rows','Delete selected columns','Clear selected cells','Insert cells, shift right','Insert cells, shift down','Delete cells, shift left','Delete cells, shift up'];
  const allowed=(i:number)=>!referenceId||[0,1,2,5,6,7,11,12,13,14].includes(i),b=bounds();
  const sections=[{name:'Rows',ops:[0,5,6,7,8,12]},{name:'Columns',ops:[1,2,3,4,9,11,13]},{name:'Cells',ops:[14,15,16,17,18]}];
  dialog('Rows & columns',`<p class="structure-selection">Selected: rows ${b.r1+1}${b.r2>b.r1?'–'+(b.r2+1):''} · columns ${letters(b.c1)}${b.c2>b.c1?'–'+letters(b.c2):''}</p><div class="structure-sections">${sections.map(section=>`<section><h3>${section.name}</h3>${section.ops.filter(allowed).map(i=>`<button data-op="${i}" ${[12,13,17,18].includes(i)?'class="structure-delete"':''}>${items[i]}</button>`).join('')}</section>`).join('')}</div>${allowed(10)?'<div class="structure-footer"><button data-op="10">Unhide all</button></div>':''}`,d=>{
    d.classList.add('structure-dialog');
    d.querySelectorAll<HTMLButtonElement>('[data-op]').forEach(el=>el.onclick=()=>{
      d.close();const op=Number(el.dataset.op),s=sheet();let b=bounds();
      if(op===2){renameSelectedColumn();return;}
      if(op===11){const columns=selectedAxisIndices('column').map(c=>s.columns[c]);askText('Column width (pixels)',String(s.columns[selected.c].width??145),v=>mutate('Resize columns',()=>{const width=Number(v);if(!Number.isFinite(width)||width<60||width>800)throw Error('Width must be between 60 and 800 pixels.');columns.forEach(c=>c.width=width);}));return;}
      if(op>=15){const range=requireRectangle('Shifting cells');if(!range)return;b=range;}
      if(referenceId&&(op===12||op===13)){selectionKind=op===12?'rows':'columns';deleteSelection(true);return;}
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
          case 14:eachSelected((s,r,c)=>{if(book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(x=>x.column===s.columns[c].id)))throw Error('Rename table headers explicitly.');setInput(book,s,s.rows[r].id,s.columns[c].id,'');});break;
          case 15:case 16:case 17:case 18:shiftCells(book,s,b,(['right','down','left','up'] as const)[op-15]);break;
        }
      });
      if(op>=12)confirmAction(items[op]+'?', 'This changes the selected range. Deleted references become explicit errors.',run);else run();
    });
  });
}
function openTables():void {
  const s=sheet(),tables=book.tables.filter(t=>t.sheet===s.id);
  dialog('Tables & dropdown sources',`<p>Multiple independent tables can share a sheet. Select a rectangle: the first row becomes headers, the rest records.</p><button id="create-table" class="primary">Create table from selection</button>${tables.map(t=>`<div class="table-setting"><strong>${esc(t.name)}</strong><small>${t.rows.length} records / ${t.columns.length} columns</small><button data-rename="${t.id}">Rename</button><button data-remove="${t.id}">Remove table</button></div>`).join('')}<hr><div class="button-row"><button id="validation">Set dropdown source for selection</button><button id="clear-validation">Remove selected dropdowns</button><button id="named">Named ranges & formulas</button></div>`,d=>{
    d.querySelector<HTMLButtonElement>('#create-table')!.onclick=()=>{d.close();askText('Table name','Table',name=>mutate('Create table',()=>{
      const b=bounds();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||/^[A-Za-z]+\d+$/.test(name))throw Error('Use a name such as Pantry or Meal_Prep, not a cell address.');
      if(book.tables.some(t=>t.name.toLowerCase()===name.toLowerCase()))throw Error('Table name is already in use.');
      if(b.r1===b.r2)throw Error('Select a header and at least one data row.');
      if(book.tables.some(t=>t.sheet===s.id&&[t.header,...t.rows].some(id=>s.rows.slice(b.r1,b.r2+1).some(r=>r.id===id))&&t.columns.some(c=>s.columns.slice(b.c1,b.c2+1).some(x=>x.id===c.column))))throw Error('Tables cannot overlap.');
      const names:string[]=[];const columns=s.columns.slice(b.c1,b.c2+1).map(c=>{const title=uniqueName(names,String(getCell(s,s.rows[b.r1].id,c.id).value??c.label));names.push(title);s.cells[key(s.rows[b.r1].id,c.id)]={value:title};return{id:uid(),column:c.id,name:title};});
      book.tables.push({id:uid(),name,sheet:s.id,header:s.rows[b.r1].id,rows:s.rows.slice(b.r1+1,b.r2+1).map(r=>r.id),columns});
    }));};
    d.querySelectorAll<HTMLButtonElement>('[data-rename]').forEach(el=>el.onclick=()=>{const t=book.tables.find(t=>t.id===el.dataset.rename)!;d.close();askText('Rename table',t.name,name=>mutate('Rename table',()=>{if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||book.tables.some(x=>x.id!==t.id&&x.name.toLowerCase()===name.toLowerCase()))throw Error('Choose a valid unique table name.');t.name=name;}));});
    d.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(el=>el.onclick=()=>{d.close();confirmAction('Remove table?', 'Cell contents remain. References to this table become #REF!.',()=>mutate('Remove table',()=>{book.tables=book.tables.filter(t=>t.id!==el.dataset.remove);}));});
    d.querySelector<HTMLButtonElement>('#validation')!.onclick=()=>{d.close();askText('Dropdown formula (for example =Ingredients[Ingredient])','=Ingredients[Ingredient]',source=>mutate('Set dropdown',()=>{
      const ast=compile(source,book,s.id,s.rows[selected.r].id,s.columns[selected.c].id);
      const b=bounds();clearValidations();s.validations.push({id:uid(),rows:s.rows.slice(b.r1,b.r2+1).map(r=>r.id),columns:s.columns.slice(b.c1,b.c2+1).map(c=>c.id),source:JSON.stringify(ast),sheet:s.id,...(ast.kind==='literal'&&typeof ast.value==='string'?{values:ast.value.split(',')}:{})});
    }));};
    d.querySelector<HTMLButtonElement>('#clear-validation')!.onclick=()=>{mutate('Remove selected dropdowns',clearValidations);d.close();};
    d.querySelector<HTMLButtonElement>('#named')!.onclick=()=>{d.close();openNames();};
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
function openNames():void {
  dialog('Named ranges & formulas',`<p>Names have workbook or sheet scope. Renames keep formula bindings; deleting a name yields #REF!, never a new-name relink.</p><div class="menu">${book.names.map(n=>`<button data-name="${n.id}">${esc(n.name)}<small>${esc(n.sheet?book.sheets.find(s=>s.id===n.sheet)?.name:'Workbook')} / ${esc(displayFormula(n.formula,book))}</small></button>`).join('')}</div><hr><button id="new-name" class="primary">New name</button>`,d=>{
    const edit=(id?:string)=>{
      const named=book.names.find(n=>n.id===id);d.close();
      dialog(named?'Edit name':'New name',`<form><label>Name<input id="name-label" required value="${esc(named?.name)}"></label><label>Scope<select id="name-scope"><option value="">Workbook</option>${book.sheets.map(s=>`<option value="${s.id}" ${named?.sheet===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>Formula<textarea rows="4" id="name-formula" required>${esc(named?displayFormula(named.formula,book):'=')}</textarea></label><button class="primary">Save name</button>${named?'<button type="button" class="danger" id="delete-name">Delete name</button>':''}</form>`,editor=>{
        editor.querySelector('form')!.onsubmit=e=>{
          e.preventDefault();const label=editor.querySelector<HTMLInputElement>('#name-label')!.value.trim(),scope=editor.querySelector<HTMLSelectElement>('#name-scope')!.value||undefined,formula=editor.querySelector<HTMLTextAreaElement>('#name-formula')!.value;
          mutate('Save name',()=>{
            if(!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(label)||/^[A-Za-z]+\d+$/.test(label))throw Error('Use a name like IngredientDD, not a cell address.');
            if(book.names.some(n=>n.id!==id&&n.name.toLowerCase()===label.toLowerCase()&&n.sheet===scope))throw Error('A name already exists in this scope.');
            const s=book.sheets.find(s=>s.id===(scope??sheetId))!,entry=named??{id:uid(),name:label,sheet:scope,context:s.id,formula:{kind:'literal' as const,value:null},original:formula};
            if(!named)book.names.push(entry);entry.name=label;entry.sheet=scope;entry.context=s.id;entry.original=formula;entry.formula=compile(formula,book,s.id,s.rows[0].id,s.columns[0].id);
          });editor.close();
        };
        const del=editor.querySelector<HTMLButtonElement>('#delete-name');if(del)del.onclick=()=>{editor.close();confirmAction('Delete name?', 'Bound formulas will show #REF! until the deletion is undone or restored.',()=>mutate('Delete name',()=>{book.names=book.names.filter(n=>n.id!==id);}));};
      });
    };
    d.querySelectorAll<HTMLButtonElement>('[data-name]').forEach(el=>el.onclick=()=>edit(el.dataset.name));d.querySelector<HTMLButtonElement>('#new-name')!.onclick=()=>edit();
  });
}
function openGroups():void {
  if(!commitDraft())return;
  groupManager?.close();document.querySelector('dialog')?.remove();
  const id=sheetId,panel=document.createElement('aside'),controller=new AbortController();let located:string|undefined;
  panel.className='group-manager';panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','group-manager-title');
  const affected=(g:Sheet['groups'][number],s:Sheet)=>new Set(g.kind==='summary'?g.members:outlineMembers(g,s.groups));
  const coordinates=(g:Sheet['groups'][number],s:Sheet,effective=true)=>{
    const ids=effective?affected(g,s):new Set(g.members),positions=(g.axis==='row'?s.rows:s.columns).map((item,i)=>ids.has(item.id)?i:-1).filter(i=>i>=0),chunks:string[]=[];
    for(let at=0;at<positions.length;){const start=positions[at];let end=start;while(at+1<positions.length&&positions[at+1]===end+1)end=positions[++at];const name=(n:number)=>g.axis==='row'?String(n+1):letters(n);chunks.push(start===end?name(start):name(start)+'-'+name(end));at++;}
    return `${g.axis==='row'?'Rows':'Columns'} ${chunks.join(', ')||'(removed)'}`;
  };
  const paint=()=>{
    const s=book.sheets.find(s=>s.id===id),g=s?.groups.find(g=>g.id===located),members=g&&s?affected(g,s):new Set<string>();
    root.querySelectorAll<HTMLElement>('td[data-r],th[data-row-select],th[data-col]').forEach(el=>{
      const r=Number(el.dataset.r??el.dataset.rowSelect),c=Number(el.dataset.c??el.dataset.col);
      el.classList.toggle('group-located',!!g&&sheetId===id&&(g.axis==='row'?!!s?.rows[r]&&members.has(s.rows[r].id):!!s?.columns[c]&&members.has(s.columns[c].id)));
    });
    root.querySelectorAll<HTMLElement>('.grid [data-group-id]').forEach(el=>el.classList.toggle('group-located',el.dataset.groupId===located));
  };
  const close=()=>{controller.abort();panel.remove();located=undefined;paint();groupManager=undefined;};
  const refresh=()=>{
    const s=book.sheets.find(s=>s.id===id);if(!s||sheetId!==id){close();return;}
    const focus=panel.contains(document.activeElement)?(document.activeElement as HTMLElement).dataset:undefined;
    const scroll=panel.querySelector('.group-card-list')?.scrollTop??0;
    const preview=(g:Sheet['groups'][number])=>{
      const members=affected(g,s),allRows=s.rows.map((r,i)=>({...r,i})),allColumns=s.columns.map((c,i)=>({...c,i}));
      const sample=<T,>(items:T[]):T[]=>items.length>4?[...items.slice(0,3),items.at(-1)!]:items;
      const rows=g.axis==='row'?sample(allRows.filter(r=>members.has(r.id))):allRows.slice(0,3),columns=g.axis==='column'?sample(allColumns.filter(c=>members.has(c.id))):allColumns.slice(0,3);
      return `<div class="group-cell-preview"><table aria-label="${esc(coordinates(g,s))} cell preview"><thead><tr><th>Row</th>${columns.map(c=>`<th class="${g.kind==='summary'&&g.axis==='column'&&c.id===g.members[0]?'preview-summary':''}">${letters(c.i)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr class="${g.kind==='summary'&&g.axis==='row'&&r.id===g.members[0]?'preview-summary':''}"><th>${r.i+1}</th>${columns.map(c=>`<td class="${g.kind==='summary'&&g.axis==='column'&&c.id===g.members[0]?'preview-summary':''}" title="${esc(cellText(getCell(s,r.id,c.id),s,r.i,c.i))}">${esc(cellText(getCell(s,r.id,c.id),s,r.i,c.i))||'<span class="muted">(blank)</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    };
    panel.innerHTML=`<div class="dialog-heading"><h2 id="group-manager-title">Groups on ${esc(s.name)}</h2><button class="close" aria-label="Close group manager">x</button></div>
      <div class="group-type-guide"><p><strong>Summary group</strong> keeps its summary row/column visible and hides the details.</p><p><strong>Plain group</strong> hides all its members. A selected summary also hides its entire group.</p></div>
      <div class="group-create-controls">${(['summary','range'] as const).map(kind=>`<div><strong>${kind==='summary'?'Summary':'Plain'}</strong>${(['row','column'] as const).map(axis=>`<button data-create-kind="${kind}" data-create-axis="${axis}">${axis==='row'?'Group selected rows':'Group selected columns'}</button>`).join('')}</div>`).join('')}</div>
      <button id="ungroup-all-plain" ${book.sheets.some(s=>s.groups.some(g=>g.kind!=='summary'))?'':'disabled'}>Ungroup all plain groups (workbook)</button>
      <div class="group-card-list">${s.groups.length?s.groups.map(g=>{
        const summary=g.kind==='summary',rootAt=(g.axis==='row'?s.rows:s.columns).findIndex(item=>item.id===g.members[0]),count=affected(g,s).size;
        return `<section class="group-card ${located===g.id?'located':''}" data-group-card="${g.id}"><div class="group-card-heading"><strong>${summary?'Summary group':'Plain group'}</strong><span>${esc(coordinates(g,s))}</span></div>
          <p>${summary?`Summary ${g.axis} ${g.axis==='row'?rootAt+1:letters(rootAt)} stays visible; ${Math.max(0,count-1)} detail${count===2?'':'s'} ${g.collapsed?'hidden':'shown'}.`:`All ${count} ${g.axis}${count===1?'':'s'} ${g.collapsed?'hidden':'shown'}.${count>g.members.length?` Selected ${esc(coordinates(g,s,false).toLowerCase())} includes a summary and its details.`:''}`}</p>
          ${preview(g)}<div class="group-card-actions"><button data-locate="${g.id}">Locate on sheet</button><button data-toggle="${g.id}">${g.collapsed?'Show':'Hide'} ${summary?'details':'group'}</button><button data-ungroup="${g.id}">Ungroup</button></div></section>`;
      }).join(''):'<p>No groups on this sheet. Select rows or columns on the sheet, then choose Summary or Plain above.</p>'}</div>`;
    panel.querySelector<HTMLButtonElement>('.close')!.onclick=close;
    panel.querySelector<HTMLButtonElement>('#ungroup-all-plain')!.onclick=()=>{void action('ungroup-plain');};
    panel.querySelectorAll<HTMLButtonElement>('[data-create-kind]').forEach(el=>el.onclick=()=>groupSelected(false,el.dataset.createAxis as 'row'|'column',el.dataset.createKind as 'summary'|'range'));
    panel.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(el=>el.onclick=()=>{if(!commitDraft())return;mutate('Toggle group',()=>{const g=sheet().groups.find(g=>g.id===el.dataset.toggle)!;g.collapsed=!g.collapsed;});});
    panel.querySelectorAll<HTMLButtonElement>('[data-ungroup]').forEach(el=>el.onclick=()=>{if(!commitDraft())return;mutate('Ungroup',()=>{sheet().groups=sheet().groups.filter(g=>g.id!==el.dataset.ungroup);});});
    panel.querySelectorAll<HTMLButtonElement>('[data-locate]').forEach(el=>el.onclick=()=>{
      if(!commitDraft())return;located=el.dataset.locate;
      const g=sheet().groups.find(g=>g.id===located)!,members=affected(g,sheet());
      if(g.axis==='row'){scrollTarget=Math.min(...sheet().rows.map((r,i)=>members.has(r.id)?i:Infinity));render();}
      else{refresh();const positions=sheet().columns.map((c,i)=>members.has(c.id)?i:-1).filter(i=>i>=0),th=root.querySelector<HTMLElement>(`th[data-col="${Math.min(...positions)}"]`)??root.querySelector<HTMLElement>(`.grid [data-group-id="${g.id}"]`);th?.scrollIntoView({block:'nearest',inline:'start'});}
      paint();
    });
    panel.querySelector('.group-card-list')!.scrollTop=scroll;
    if(focus){const attr=focus.toggle?'data-toggle':focus.ungroup?'data-ungroup':focus.locate?'data-locate':undefined;if(attr)panel.querySelector<HTMLButtonElement>(`[${attr}="${focus.toggle??focus.ungroup??focus.locate}"]`)?.focus({preventScroll:true});}
    paint();
  };
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}e.stopPropagation();},{signal:controller.signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&draft===undefined){e.preventDefault();e.stopPropagation();close();}},{capture:true,signal:controller.signal});
  groupManager={refresh,paint,close};document.body.append(panel);refresh();
}
function groupSelected(remove=false,axis?:'row'|'column',kind:'summary'|'range'='summary'):void {
  if(!commitDraft()||!editableReference())return;
  axis??=selectionMode()==='rows'?'row':selectionMode()==='columns'?'column':undefined;
  if(!axis){
    dialog(remove?'Ungroup selection':'Group selection','<div class="button-row"><button data-group-axis="row">Rows</button><button data-group-axis="column">Columns</button></div>',d=>{
      d.querySelectorAll<HTMLButtonElement>('[data-group-axis]').forEach(button=>button.onclick=()=>{d.close();groupSelected(remove,button.dataset.groupAxis as 'row'|'column',kind);});
    });return;
  }
  const s=sheet(),b=bounds(),view=gridReference(),members=axis==='row'
    ?selectedAxisIndices('row').map(i=>s.rows[i]).filter(r=>!view||view.rows.includes(r.id)).map(r=>r.id)
    :selectedAxisIndices('column').map(i=>s.columns[i]).filter(c=>!view||view.columns.includes(c.id)).map(c=>c.id);
  const chosen=new Set(members),groups=s.groups.filter(g=>g.axis===axis&&(g.kind??'range')===kind),exact=groups.find(g=>g.members.length===chosen.size&&g.members.every(id=>chosen.has(id)));
  mutate(remove?'Ungroup selection':'Group selection',()=>{
    if(!members.length)throw Error('Select rows or columns to group.');
    if(!remove){
      if(exact)throw Error('That selection is already grouped.');
      if(kind==='summary'&&members.length<2)throw Error('Select the summary row or column together with at least one detail.');
      s.groups.push({id:uid(),axis,members,kind,collapsed:false,label:axis==='row'?`Rows ${b.r1+1}-${b.r2+1}`:`Columns ${letters(b.c1)}-${letters(b.c2)}`});return;
    }
    const containing=groups.filter(g=>members.every(id=>g.members.includes(id))).sort((a,z)=>a.members.length-z.members.length);
    const inside=groups.filter(g=>g.members.every(id=>chosen.has(id)));
    const targets=exact?[exact]:containing.length?[containing[0]]:inside.filter(g=>!inside.some(parent=>parent.id!==g.id&&parent.members.length>g.members.length&&g.members.every(id=>parent.members.includes(id))));
    if(!targets.length)throw Error('No complete or containing group matches this selection.');
    const ids=new Set(targets.map(g=>g.id));s.groups=s.groups.filter(g=>!ids.has(g.id));
  });
}
function openBlock():void {
  const s=sheet(),t=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??book.tables.find(t=>t.sheet===s.id);
  if(!t){flash('Choose a table with Meal, Date, isMeal, or isDay columns. Other tables still support ordinary row groups.');return;}
  const find=(name:string)=>t.columns.find(c=>c.name.toLowerCase()===name.toLowerCase());
  const flag=find('isDay')??find('isMeal'),label=find('Meal')??find('Weight'),date=find('Date');
  if(!label&&!flag){flash('This table has no meal/day header marker. Use ordinary row groups.');return;}
  let members:string[]=[],blockIssue='';
  try{members=positionalBlock(book,s,t,s.rows[selected.r].id,engine);}catch(e){blockIssue=e instanceof Error?e.message:String(e);}
  const positions=members.map(id=>s.rows.findIndex(r=>r.id===id));
  const isDay=!!find('isDay')||(!find('Meal')&&!!date),title=isDay?'Day':'Meal';
  dialog(`${title} blocks`, `<p>A block runs from one header record to the next. Moving ingredients across a header still changes membership. Existing formulas are never silently repaired.</p>${blockIssue?`<p>${esc(blockIssue)}</p>`:''}<div class="menu"><button id="group-top" ${members.length?'':'disabled'}>Group & move to top</button><button id="select-block" ${members.length?'':'disabled'}>Select current block (${members.length} records)</button><button id="move-block" ${members.length?'':'disabled'}>Move current block below table header</button><button id="collapse-block" ${members.length?'':'disabled'}>Group block details for collapse</button></div><hr><h3>New ${title.toLowerCase()} header</h3><form id="new-block"><label>${isDay?'Date':'Meal name'}<input id="block-label" ${isDay?'type="date"':''} required></label><label>Status<select id="block-status"><option>real</option><option>planned</option><option>hypothetical</option></select></label><button class="primary">Create explicit ${title.toLowerCase()}</button></form><p class="muted">Only newly created headers get default totals, including an explicit end-of-table bound. Imported header formulas remain unchanged.</p>`,d=>{
    d.querySelector<HTMLButtonElement>('#group-top')!.onclick=()=>{mutate('Group & move block to top',()=>{
      const at=groupBlockToTop(book,s,t,s.rows[selected.r].id);selected={r:at,c:0};anchor={...selected};selectionKind='cells';scrollTarget=at;
    });d.close();};
    d.querySelector<HTMLButtonElement>('#select-block')!.onclick=()=>{anchor={r:Math.min(...positions),c:0};selected={r:Math.max(...positions),c:s.columns.length-1};selectionKind='cells';scrollTarget=anchor.r;page=Math.floor(anchor.r/60);render();d.close();};
    d.querySelector<HTMLButtonElement>('#move-block')!.onclick=()=>{mutate('Move whole block',()=>{
      if(!label&&!flag)throw Error('This table has no recognized meal/day header marker. Use explicit row selection instead.');
      const at=moveRows(book,s,members,s.rows.findIndex(r=>r.id===t.header)+1);
      selected={r:at,c:0};anchor={...selected};selectionKind='cells';page=Math.floor(at/60);
    });d.close();};
    d.querySelector<HTMLButtonElement>('#collapse-block')!.onclick=()=>{mutate('Group block details',()=>{if(members.length<2)throw Error('Add detail rows to this block first.');s.groups.push({id:uid(),axis:'row',members,kind:'summary',collapsed:true,label:`${title} details`});});d.close();};
    d.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();const text=d.querySelector<HTMLInputElement>('#block-label')!.value,status=d.querySelector<HTMLSelectElement>('#block-status')!.value as 'real'|'planned'|'hypothetical';
      mutate(`Create ${title.toLowerCase()}`,()=>{
        if(isDay&&!date)throw Error('This table needs a Date column to create an explicit day.');
        if(!isDay&&!find('Meal'))throw Error('This table needs a Meal column to create a meal header.');
        const at=Math.max(s.rows.findIndex(r=>r.id===t.header)+1,...t.rows.map(id=>s.rows.findIndex(r=>r.id===id)+1)),r=addRow(book,s,at,t);
        r.status=status;
        if(isDay){
          const [year,month,day]=text.split('-').map(Number),serial=excelDate(year,month,day);
          if(year<1900||serial===undefined||excelDateText(serial)!==text)throw Error('Choose a valid date from 1900-01-01 through 9999-12-31.');
          setInput(book,s,r.id,date!.column,String(serial));const cell=s.cells[key(r.id,date!.column)];cell.format={...cell.format,number:'date',excelNumberFormat:undefined};if(flag)setInput(book,s,r.id,flag.column,'TRUE');
        }
        else{setInput(book,s,r.id,find('Meal')!.column,text);if(flag)setInput(book,s,r.id,flag.column,'TRUE');}
        const portions=find('Portions');if(portions)setInput(book,s,r.id,portions.column,'1');
        for(const c of t.columns)if(/^(Calories(?: \(kcal\))?|(?:Fat|Carbs|Sugar|Protein) \(g\)|Sodium \(mg\))$/i.test(c.name))setInput(book,s,r.id,c.column,defaultHeaderFormula(book,t,c.id));
        selected={r:at,c:0};anchor={...selected};selectionKind='cells';page=Math.floor(at/60);
      });d.close();
    };
  });
}
function openReferences(id?:string,notice=''):void{
  if(!commitDraft())return;
  if(!referenceId){const grid=root.querySelector<HTMLElement>('#grid-scroll');workbookView={sheet:sheetId,selected:{...selected},anchor:{...anchor},kind:selectionKind,scroll:grid?.scrollTop??0,left:grid?.scrollLeft??0,filter};}
  referenceId=id??referenceId??book.references?.find(s=>s.kind!=='units'&&s.kind!=='conversions')?.id;
  if(!referenceId){newReference(referenceHost());return;}
  document.querySelector<HTMLDialogElement>('dialog')?.close();
  const view=gridReference();if(view?.sheet){sheetId=view.sheet.id;const row=view.rows[1]??view.rows[0];selected={r:Math.max(0,view.sheet.rows.findIndex(r=>r.id===row)),c:Math.max(0,view.sheet.columns.findIndex(c=>c.id===view.columns[0]))};anchor={...selected};}
  referenceNotice=notice;selectionKind='cells';movingRows=movingColumns=undefined;renderedSheet='';render();
}
function backToWorkbook():void{
  if(!commitDraft())return;
  referenceId=undefined;movingRows=movingColumns=undefined;
  const view=workbookView;workbookView=undefined;
  if(view&&book.sheets.some(s=>s.id===view.sheet)){sheetId=view.sheet;selected=view.selected;anchor=view.anchor;selectionKind=view.kind;filter=view.filter;}
  renderedSheet='';render();const grid=root.querySelector<HTMLElement>('#grid-scroll')!;if(view){grid.scrollTop=view.scroll;grid.scrollLeft=view.left;drawRowWindow?.();}
}
function referenceHost():ReferenceHost{return{
  book:()=>book,esc,mutate,dialog,askText,importSource:importReferenceSources,  open:(id,selection=[id])=>{selectedTabs.clear();for(const token of selection)selectedTabs.add(token);tabSelectionAnchor=id;openReferences(id);},
  bind:(source,selection=[source])=>{
    const target=workbookView;if(!target){flash('Select workbook cells before opening DD.');return;}
    const previous={referenceId,sheetId,selected:{...selected},anchor:{...anchor},selectionKind},grid=root.querySelector<HTMLElement>('#grid-scroll'),scroll=grid?.scrollTop??0,left=grid?.scrollLeft??0;
    try{const formulas=selection.map(referenceFormula),ast:Ast=formulas.length===1?formulas[0]:{kind:'call',name:'VSTACK',args:formulas},keys=selection.map(s=>s.kind==='derived'?`ref:${s.id}`:`${s.table}:${s.column}`);referenceId=undefined;sheetId=target.sheet;selected={...target.selected};anchor={...target.anchor};selectionKind=target.kind;assignDropdown(ast,keys.length===1?keys[0]:JSON.stringify(keys));}
    catch(e){flash(e);}
    finally{referenceId=previous.referenceId;sheetId=previous.sheetId;selected=previous.selected;anchor=previous.anchor;selectionKind=previous.selectionKind;render();const grid=root.querySelector<HTMLElement>('#grid-scroll')!;grid.scrollTop=scroll;grid.scrollLeft=left;drawRowWindow?.();rememberView();}
  }
};}
function dropdownScope():{rows:string[];columns:string[]}{
  const s=sheet(),b=bounds(),cols=s.columns.filter((c,i)=>i>=b.c1&&i<=b.c2&&(!gridReference()||gridReference()!.columns.includes(c.id))).map(c=>c.id);
  let rows=s.rows.filter((r,i)=>i>=b.r1&&i<=b.r2&&(!gridReference()||gridReference()!.rows.includes(r.id))).map(r=>r.id);
  if(selectionKind==='columns'){
    const candidates=book.tables.filter(t=>t.sheet===s.id&&t.columns.some(c=>cols.includes(c.column))),t=gridReference()?.table??candidates.find(t=>t.id===selectionTable)??(candidates.length===1?candidates[0]:undefined);
    if(candidates.length>1&&!t)throw Error('This column crosses multiple tables. Select a data cell in your intended table before selecting its column.');
    if(t)rows=t.rows;
  }
  rows=rows.filter(r=>!book.tables.some(t=>t.sheet===s.id&&t.header===r&&t.columns.some(c=>cols.includes(c.column))));
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
    const fields=book.tables.filter(t=>!book.references?.some(r=>r.table===t.id)).flatMap(t=>t.columns.filter(c=>t.name.toLowerCase()==='ingredients'&&/^ingredients?$/i.test(c.name)||rememberedFields.has(`${t.id}:${c.id}`)).map(c=>({table:t,column:c})));
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
    dialog('Dropdowns for selection',`<div class="button-row dropdown-view-controls"><button type="button" id="dropdown-list-view">List view</button><button type="button" id="dropdown-grid-view">Grid view</button></div><form><input class="dropdown-source-search" type="search" aria-label="Search dropdown sources" placeholder="Search sources…"><div id="dropdown-source-cards" class="dropdown-source-cards"></div><div class="dropdown-assignment-footer"><button type="button" id="no-dropdown">No dropdown</button><span id="dropdown-selected-count" role="status"></span><button class="primary">Apply dropdown</button></div><p id="dropdown-assignment-error" class="dropdown-source-error" role="alert" hidden></p></form>`,d=>{
      d.classList.add('dropdown-assignment');
      const cards=d.querySelector<HTMLElement>('#dropdown-source-cards')!,search=d.querySelector<HTMLInputElement>('.dropdown-source-search')!,previews=new Map<string,{choices:string[];error?:string}>();
      const sync=()=>{cards.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.checked=selectedSources.has(input.value));d.querySelector('#dropdown-selected-count')!.textContent=`${selectedSources.size} selected`;d.querySelector('#no-dropdown')!.setAttribute('aria-pressed',String(!selectedSources.size));};
      const setView=(grid:boolean)=>{
        dropdownAssignmentGrid=grid;cards.classList.toggle('dropdown-source-checklist',!grid);cards.replaceChildren();
        d.querySelector('#dropdown-grid-view')!.setAttribute('aria-pressed',String(grid));d.querySelector('#dropdown-list-view')!.setAttribute('aria-pressed',String(!grid));
        const query=search.value.toLowerCase(),visible=options.filter(o=>o.label.toLowerCase().includes(query)),ordered:typeof options=[];
        for(const option of visible)if(!ordered.includes(option))ordered.push(...(option.group?visible.filter(o=>o.group?.toLowerCase()===option.group!.toLowerCase()):[option]));
        let group='';
        for(const option of ordered){
          if(!grid&&option.group&&option.group!==group){const heading=document.createElement('div');heading.className='dropdown-source-group';heading.textContent=option.group;cards.append(heading);}group=option.group??'';
          const card=document.createElement('label');card.className=grid?'dropdown-source-card':'dropdown-source-row';const check=document.createElement('input');check.type='checkbox';check.value=option.value;check.checked=selectedSources.has(option.value);check.setAttribute('aria-label',option.label);
          const title=document.createElement('strong');title.textContent=grid?option.label:option.displayLabel??option.label;card.append(check,title);
          if(!previews.has(option.value))try{
            if(option.error||!option.ast)throw Error(option.error??'This source is unavailable.');
            const preview=validationChoices(book,{id:'preview',rows:scope.rows,columns:scope.columns,sheet:s.id,source:JSON.stringify(option.ast)},scope.rows[0],scope.columns[0],engine).choices.slice(0,4);
            previews.set(option.value,{choices:preview.map(c=>c.value===''?'(Blank)':c.value===' '?'(Space)':c.value)});
          }catch(e){previews.set(option.value,{choices:[],error:String(e)});}
          const preview=previews.get(option.value)!;
          if(preview.error){check.disabled=!selectedSources.has(option.value);check.dataset.unavailable='true';const error=document.createElement('span');error.className='dropdown-source-error';error.textContent=preview.error;card.append(error);}
          else if(grid){const list=document.createElement('ul');for(const value of preview.choices.length?preview.choices:['No available options']){const item=document.createElement('li');item.textContent=value;list.append(item);}card.append(list);}
          else{const values=document.createElement('span');values.className='dropdown-source-row-preview';values.textContent=preview.choices.join(' · ')||'No available options';card.append(values);}
          check.onchange=()=>{if(check.checked)selectedSources.add(option.value);else selectedSources.delete(option.value);if(check.dataset.unavailable)check.disabled=!check.checked;sync();};cards.append(card);
        }
        if(!visible.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No matching sources';cards.append(empty);}sync();
      };
      search.oninput=()=>setView(dropdownAssignmentGrid);
      d.querySelector<HTMLButtonElement>('#no-dropdown')!.onclick=()=>{selectedSources.clear();sync();};
      d.querySelector<HTMLButtonElement>('#dropdown-grid-view')!.onclick=()=>setView(true);d.querySelector<HTMLButtonElement>('#dropdown-list-view')!.onclick=()=>setView(false);setView(dropdownAssignmentGrid);
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
  if(!editableReference()){flash('Edit the live list source instead.');return;}
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
  movePreview=undefined;root.querySelector('.move-drop-guide')?.remove();
  root.querySelectorAll<HTMLElement>('.group-drop-target').forEach(el=>{el.classList.remove('group-drop-target');delete el.dataset.dropGroup;});
}
function bindMoveBoundaryPreview(el:HTMLElement,axis:'row'|'column',boundary:number,index:number,after:boolean):void{
  const show=()=>showMovePreview(axis,boundary,index,after);
  el.addEventListener('pointerenter',show);el.addEventListener('focus',show);
}
function showMovePreview(axis:'row'|'column',boundary:number,index:number,after:boolean):void{
  const ids=axis==='row'?movingRows:movingColumns;if(!ids)return;
  try{
    const group=moveTargetGroups(sheet(),axis,ids,boundary,axis==='row'?gridReference()?.table:undefined).filter(g=>g.collapsed).sort((a,b)=>a.members.length-b.members.length)[0];
    if(group){showGroupMovePreview(axis,group.id);return;}
  }catch(error){clearMovePreview();flash(error);return;}
  movePreview={axis,boundary,index,after};paintMovePreview();
}
function moveGroupAt(element:Element,axis:'row'|'column',x:number,y:number):string|undefined{
  const s=sheet(),button=element.closest<HTMLElement>('.group-control[data-group-id]');
  if(button&&s.groups.some(g=>g.id===button.dataset.groupId&&g.axis===axis&&g.collapsed))return button.dataset.groupId;
  const cell=element.closest<HTMLElement>('td[data-r][data-c]'),grid=root.querySelector<HTMLElement>('#grid-scroll');if(!cell||!grid)return;
  const rect=cell.getBoundingClientRect(),fraction=axis==='row'?(y-rect.top)/rect.height:(x-rect.left)/rect.width;
  if(fraction<.25||fraction>.75)return;
  const items=axis==='row'?s.rows:s.columns,index=Number(axis==='row'?cell.dataset.r:cell.dataset.c);
  if(axis==='row'&&cell.dataset.c!==grid.dataset.firstColumn||axis==='column'&&cell.dataset.r!==grid.dataset.firstRow)return;
  return s.groups.filter(g=>g.axis===axis&&g.collapsed&&(g.kind==='summary'?g.members[0]:items.find(item=>g.members.includes(item.id))?.id)===items[index]?.id).sort((a,b)=>a.members.length-b.members.length)[0]?.id;
}
function showGroupMovePreview(axis:'row'|'column',groupId:string):void{
  const ids=axis==='row'?movingRows:movingColumns;if(!ids)return;
  try{const target=groupMoveTarget(sheet(),axis,ids,groupId,axis==='row'?gridReference()?.table:undefined);movePreview={axis,groupId,boundary:target.boundary,index:0,after:false};paintMovePreview();}
  catch(error){clearMovePreview();flash(error);}
}
function dropIntoGroup(axis:'row'|'column',ids:string[],groupId:string):void{
  if(!editableReference()){flash('Edit the live list source instead.');return;}
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
    grid.querySelectorAll<HTMLElement>('.group-drop-target').forEach(el=>{el.classList.remove('group-drop-target');delete el.dataset.dropGroup;});
    const s=sheet(),group=s.groups.find(g=>g.id===target.groupId&&g.axis===target.axis);if(!group)return;
    highlightMoveGroup(grid,table,target.axis,group);return;
  }
  const host=target.axis==='row'?table.querySelector<HTMLElement>(`[data-row-select="${target.index}"]`):target.index<0?table.querySelector<HTMLElement>('.corner'):table.querySelector<HTMLElement>(`thead [data-col="${target.index}"]`);
  grid.querySelector('.move-drop-guide')?.remove();
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
  if(group.kind!=='summary'){
    const hint=table.querySelector<HTMLElement>(`.group-control[data-group-id="${group.id}"]`);
    if(axis==='row'&&!table.querySelector(`[data-row-select="${row}"]`)){const host=hint?.closest<HTMLElement>('tr[data-row]');if(host)row=Number(host.dataset.row);}
    if(axis==='column'&&!table.querySelector(`thead [data-col="${column}"]`)){const host=hint?.closest<HTMLElement>('thead [data-col]');column=host?Number(host.dataset.col):Number(grid.dataset.firstColumn);}
  }
  const cell=grid.querySelector<HTMLElement>(`td[data-r="${row}"][data-c="${column}"]`);
  if(cell){cell.classList.add('group-drop-target');cell.dataset.dropGroup=group.id;}
}
function insertDimensions(axis:'row'|'column',boundary:number):void{
  const s=sheet(),b=bounds(),view=gridReference();
  const count=axis==='row'&&selectionMode()==='rows'?selectedAxisIndices('row').filter(i=>!view||view.rows.includes(s.rows[i].id)).length:axis==='column'&&selectionMode()==='columns'?selectedAxisIndices('column').filter(i=>!view||view.columns.includes(s.columns[i].id)).length:1;
  extraSelections=[];
  if(axis==='column'){
    for(let i=0;i<count;i++)insertColumn(book,s,boundary+i,view?.table);
    if(count>1){anchor={r:0,c:boundary};selected={r:s.rows.length-1,c:boundary+count-1};selectionKind='columns';}
    else{selected.c=boundary;anchor={...selected};selectionKind='cells';}
  }else{
    const at=view?.table?Math.max(boundary,s.rows.findIndex(r=>r.id===view.table!.header)+1):boundary;
    let table=view?.table??tableAt(book,s.id,s.rows[Math.max(0,at-1)]?.id,s.columns[selected.c].id)??tableAt(book,s.id,s.rows[at]?.id,s.columns[selected.c].id);
    if(!view&&table?.header===s.rows[at]?.id)table=undefined;
    for(let i=0;i<count;i++)addRow(book,s,at+i,table);
    selected.r=at+count-1;anchor={...selected};
    if(count>1){anchor={r:at,c:0};selected.c=s.columns.length-1;selectionKind='rows';}else selectionKind='cells';
    page=Math.floor(at/60);
  }
  renderedTarget=`${sheetId}:${selected.r}`;
}
  function bindResizeControls():void{
    root.querySelectorAll<HTMLElement>('[data-resize-column],[data-resize-row]').forEach(el=>{
      const axis=el.dataset.resizeColumn!==undefined?'column':'row',index=Number(el.dataset.resizeColumn??el.dataset.resizeRow);
      el.onpointerdown=e=>{
        e.stopPropagation();if(e.button!==0||busy||!editableReference()||!commitDraft())return;
        const s=sheet(),id=axis==='column'?s.columns[index].id:s.rows[index].id;
        const size=axis==='column'?s.columns[index].width??145:el.closest('tr')!.getBoundingClientRect().height;
        resizing={axis,id,sheet:s.id,start:size,size,position:axis==='column'?e.clientX:e.clientY,pointer:e.pointerId,capture:el};el.setPointerCapture(e.pointerId);
      };
      el.ondblclick=e=>{e.preventDefault();e.stopPropagation();if(!busy&&editableReference()&&commitDraft())autoFit(axis,index);};
      el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(!busy&&editableReference()&&commitDraft())autoFit(axis,index);}};
    });
  }
  function finishResize(commit:boolean):void{
    const resize=resizing;if(!resize)return;resizing=undefined;
    if(resize.capture.hasPointerCapture(resize.pointer))resize.capture.releasePointerCapture(resize.pointer);
    if(resize.start===resize.size)return;
    if(!commit){render();return;}
    const s=book.sheets.find(s=>s.id===resize.sheet)!;
    mutate(`Resize ${resize.axis}`,()=>{
      if(resize.axis==='column'){s.columns.find(c=>c.id===resize.id)!.width=resize.size;measuredRowHeights.clear();}
      else{s.rows.find(r=>r.id===resize.id)!.height=resize.size*3/4;measuredRowHeights.delete(resize.id);}
      renderedTarget=`${sheetId}:${selected.r}`;
    });
  }
  root.addEventListener('pointermove',e=>{
    const resize=resizing;if(!resize||resize.pointer!==e.pointerId)return;e.preventDefault();
    resize.size=Math.max(resize.axis==='column'?24:20,Math.round(resize.start+(resize.axis==='column'?e.clientX:e.clientY)-resize.position));
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
  });
  root.addEventListener('pointerup',e=>{if(resizing?.pointer===e.pointerId)finishResize(true);});
  root.addEventListener('pointercancel',e=>{if(resizing?.pointer===e.pointerId)finishResize(false);});
  function autoFit(axis:'column'|'row',index:number):void{
    const s=sheet(),view=gridReference(),sample=root.querySelector<HTMLElement>('td[data-r]:not(.table-header)')??root.querySelector<HTMLElement>('td[data-r]'),style=sample?getComputedStyle(sample):getComputedStyle(root),canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    if(!context){flash('This browser cannot measure text for auto-fit.');return;}
    engine.beginPass();
    const font=(cell:Cell,header:boolean)=>`${cell.format?.italic?'italic ':''}${cell.format?.bold?'700':header?'600':'400'} ${style.fontSize} ${style.fontFamily}`;
    let size=axis==='column'?24:33;
    const measure=document.createElement('div');measure.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;box-sizing:border-box;padding:6px 10px;border:1px solid transparent;overflow-wrap:anywhere;';
    document.body.append(measure);
    try{
      const rows=axis==='row'?[index]:s.rows.map((r,i)=>!view||view.rows.includes(r.id)?i:-1).filter(i=>i>=0);
      const columns=axis==='column'?[index]:s.columns.map((c,i)=>!view||view.columns.includes(c.id)?i:-1).filter(i=>i>=0);
      for(const r of rows)for(const c of columns){
        const cell=getCell(s,s.rows[r].id,s.columns[c].id),text=cellText(cell,s,r,c),header=book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(col=>col.column===s.columns[c].id));
        if(axis==='column'){
          context.font=font(cell,header);
          const lines=cell.format?.wrap?text.split(/\r?\n/):[text.replace(/[ \t\r\n\f]+/g,' ')];
          for(const line of lines)size=Math.max(size,Math.ceil(context.measureText(line).width+22));
        }else{
          measure.style.font=font(cell,header);measure.style.whiteSpace=cell.format?.wrap?'pre-wrap':'nowrap';measure.style.width=(s.columns[c].width??145)+'px';measure.textContent=text;size=Math.max(size,Math.ceil(measure.getBoundingClientRect().height));
        }
      }
      if(!Number.isFinite(size))throw Error('The measured size is invalid.');
      mutate(`Auto-fit ${axis}`,()=>{if(axis==='column'){s.columns[index].width=size;measuredRowHeights.clear();}else{s.rows[index].height=size*3/4;measuredRowHeights.delete(s.rows[index].id);}renderedTarget=`${sheetId}:${selected.r}`;});
    }catch(e){flash(e);}finally{measure.remove();}
  }
const selectedTabs=new Set<string>();let tabSelectionAnchor:string|undefined;
function selectedReferenceTabs():ReferenceSource[]{
  const selected=new Map<string,ReferenceSource>();
  const collect=(nodes:ReferenceNavigation[])=>{for(const node of nodes){if(selectedTabs.has(node.group?`group:${node.group}`:node.members[0].id))for(const source of node.members)selected.set(source.id,source);collect(node.children);}};collect(referenceNavigation(book));return[...selected.values()];
}
function bindTabs():void{
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
      if(group){const key=`dd-group-collapsed:${group.toLowerCase()}`;book.pickerSources[key]=book.pickerSources[key]==='true'?'false':'true';changed('Toggle dropdown group',false);render();}else if(reference){if(referenceId!==id)openReferences(id);}else if(sheetId!==id){sheetId=id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';render();}};
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
  const reference=!!el.dataset.reference,id=el.dataset.reference??el.dataset.sheet!,entry=reference?book.references?.find(s=>s.id===id):book.sheets.find(s=>s.id===id);if(!entry)return;
  const group=el.dataset.referenceGroup,style=getComputedStyle(el),pseudo=getComputedStyle(el,'::before'),width=el.getBoundingClientRect().width,contentWidth=Math.max(1,width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth)-(pseudo.content==='none'?0:parseFloat(pseudo.width)+parseFloat(pseudo.marginRight)));
  el.draggable=false;el.style.minWidth=width+'px';const input=document.createElement('input');input.value=group?group.split(' / ').at(-1)!:(reference?referenceLabel(entry as ReferenceSource):entry.name);input.style.width=contentWidth+'px';input.setAttribute('aria-label',group?'Rename group':reference?'Rename list':'Rename sheet');el.replaceChildren(input);input.onclick=e=>e.stopPropagation();
  const measure=document.createElement('canvas').getContext('2d')!;measure.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;input.oninput=()=>{input.style.width=Math.max(contentWidth,Math.ceil(measure.measureText(input.value).width)+1)+'px';};input.focus();input.select();
  let done=false;
  const commit=()=>{if(done)return;done=true;const name=input.value.trim();if(!name){flash('Use a nonempty tab name.');render();return;}
    if(!mutate('Rename tab',()=>{if(group){renameReferenceGroup(book,group,name);return;}if(reference){const source=book.references?.find(s=>s.id===id);if(!source)throw Error('This list was removed.');setReferencePresentation(book,source,name,source.group);return;}const target=book.sheets.find(s=>s.id===id);if(!target)throw Error('This tab was removed.');if(book.sheets.some(s=>s.id!==id&&s.name.toLowerCase()===name.toLowerCase()))throw Error('That tab name is already in use.');target.name=name;})){done=false;input.focus();input.select();}
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
    button('Duplicate',()=>mutate('Duplicate sheet',()=>{const source=book.sheets.find(s=>s.id===id);if(!source)throw Error('Sheet was removed.');sheetId=duplicateSheet(book,source).id;}));
    button('Tab color',()=>{const s=book.sheets.find(s=>s.id===id)!;dialog('Tab color',`<form><label>Color<input type="color" id="sheet-color" value="${esc(s.color)}"></label><button class="primary">Apply color</button></form>`,d=>{d.querySelector('form')!.onsubmit=e=>{e.preventDefault();mutate('Tab color',()=>{s.color=d.querySelector<HTMLInputElement>('#sheet-color')!.value;});d.close();};});});
    button('Delete',()=>confirmAction('Delete sheet?', 'Deleted references become #REF!. Undo restores the complete sheet.',()=>mutate('Delete sheet',()=>{if(book.sheets.length===1)throw Error('Keep at least one sheet.');book.sheets=book.sheets.filter(s=>s.id!==id);book.tables=book.tables.filter(t=>t.sheet!==id);book.names=book.names.filter(n=>n.sheet!==id);if(sheetId===id){sheetId=book.sheets[0].id;selected={r:0,c:0};anchor={...selected};}})));
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
  dialog('Find and Replace',`<div class="find-tabs" role="tablist" aria-label="Search mode"><button id="find-tab" role="tab" aria-controls="find-controls">Find</button><button id="replace-tab" role="tab" aria-controls="find-controls">Replace</button></div>
    <div id="find-controls" class="find-controls" role="tabpanel"><label>Find<input id="find-text" type="search" autocomplete="off"></label><div id="replace-fields"></div>
    <details class="find-options" open><summary>Search options</summary><div class="find-selectors"><label>Within<select id="find-within"><option value="selected">Selected sheets</option><option value="workbook">Workbook</option></select></label><label>Direction<select id="find-direction"><option value="down">Down</option><option value="up">Up</option></select></label></div>
    <div class="find-flags"><label class="inline"><input id="find-case" type="checkbox">Match case</label><label class="inline"><input id="find-entire" type="checkbox">Match entire cell contents</label></div>
    <fieldset class="find-scope"><legend>Search sheets</legend><label class="inline"><input id="find-all-sheets" type="checkbox">All</label>${book.sheets.map(s=>`<label class="inline"><input type="checkbox" name="scope" value="${s.id}" ${s.id===sheetId?'checked':''}>${esc(s.name)}</label>`).join('')}</fieldset></details></div>
    <div class="find-results-panel"><p id="find-count" role="status">Results found (0)</p><div id="find-results" class="find-results-scroll"><table class="find-results-table"><colgroup><col style="width:80px"><col></colgroup><thead><tr><th scope="col">Cell</th><th scope="col">Value</th></tr></thead><tbody></tbody></table></div><div class="find-pagination" hidden><button id="find-previous-page" aria-label="Previous results page">Previous</button><span id="find-page-count"></span><button id="find-next-page" aria-label="Next results page">Next</button></div></div>
    <p id="find-feedback" class="find-feedback" role="status"></p><div class="button-row find-actions"><button id="find-next" class="primary">Find next</button><button id="find-all">Find all</button><span id="replace-actions" class="button-row"></span></div>`,d=>{
    d.classList.add('find-dialog');
    const field=<T extends HTMLElement>(id:string)=>d.querySelector<T>('#'+id)!;
    const input=field<HTMLInputElement>('find-text'),scopes=[...d.querySelectorAll<HTMLInputElement>('input[name=scope]')],all=field<HTMLInputElement>('find-all-sheets');
    const within=mountSelectDropdown(field<HTMLSelectElement>('find-within'));
    mountSelectDropdown(field<HTMLSelectElement>('find-direction'));
    type Match={sid:string;row:string;column:string;r:number;c:number;value:string};
    let matches:Match[]=[],active:string|undefined,resultPage=0,replacement='';
    const identity=(m:Match)=>`${m.sid}:${m.row}:${m.column}`;
    const source=(m:Match)=>book.sheets.find(s=>s.id===m.sid)!;
    const literal=(m:Match)=>{const cell=getCell(source(m),m.row,m.column);return !cell.formula&&!cell.binding&&typeof cell.value==='string';};
    const matcher=()=>createTextSearch(input.value,{matchCase:field<HTMLInputElement>('find-case').checked,entire:field<HTMLInputElement>('find-entire').checked});
    const feedback=(text:string,bad=false)=>{const el=field('find-feedback');el.textContent=text;el.classList.toggle('bad',bad);el.setAttribute('role',bad?'alert':'status');};
    const buttons=()=>{
      field<HTMLButtonElement>('find-next').disabled=!matches.length;
      field<HTMLButtonElement>('find-all').disabled=!input.value||!scopes.some(s=>s.checked);
      const current=matches.find(m=>identity(m)===active);
      const single=d.querySelector<HTMLButtonElement>('#replace-one'),multiple=d.querySelector<HTMLButtonElement>('#replace-all');
      if(single){single.disabled=current?!literal(current):!matches.some(literal);single.title='Replaces literal text only';}
      if(multiple)multiple.disabled=!matches.some(literal);
    };
    const paint=()=>{
      let previous='';
      field('find-results').querySelector('tbody')!.innerHTML=matches.slice(resultPage*200,resultPage*200+200).map((m,j)=>{
        const i=resultPage*200+j,s=source(m),header=previous===s.id?'':`<tr class="find-sheet-header"><th colspan="2">${esc(s.name)}</th></tr>`;previous=s.id;
        return`${header}<tr data-find-match="${i}" tabindex="0" aria-selected="${identity(m)===active}"><th scope="row">${letters(m.c)}${m.r+1}</th><td title="${esc(m.value)}">${esc(m.value)}</td></tr>`;
      }).join('');
      field('find-count').textContent=`Results found (${matches.length})`;
      d.querySelector<HTMLElement>('.find-pagination')!.hidden=matches.length<=200;
      field('find-page-count').textContent=`${resultPage*200+1}-${Math.min(matches.length,resultPage*200+200)} of ${matches.length}`;
      field<HTMLButtonElement>('find-previous-page').disabled=resultPage===0;
      field<HTMLButtonElement>('find-next-page').disabled=(resultPage+1)*200>=matches.length;
      buttons();
    };
    const draw=(reset=true)=>{
      if(reset){active=undefined;resultPage=0;feedback('');}
      const chosen=new Set(scopes.filter(s=>s.checked).map(s=>s.value)),search=matcher();matches=[];engine.beginPass();
      if(input.value)for(const s of book.sheets.filter(s=>chosen.has(s.id))){
        const rows=new Map(s.rows.map((r,i)=>[r.id,i])),columns=new Map(s.columns.map((c,i)=>[c.id,i])),found:Match[]=[];
        for(const [k,cell]of Object.entries(s.cells)){
          const [row,column]=k.split(':'),r=rows.get(row),c=columns.get(column);if(r===undefined||c===undefined)continue;
          const value=cellText(cell,s,r,c);if(value&&search.matches(value))found.push({sid:s.id,row,column,r,c,value});
        }
        matches=matches.concat(found.sort((a,b)=>a.r-b.r||a.c-b.c));
      }
      if(active&&!matches.some(m=>identity(m)===active))active=undefined;
      resultPage=Math.min(resultPage,Math.max(0,Math.ceil(matches.length/200)-1));paint();
      if(input.value&&!chosen.size)feedback('Select at least one sheet to search.',true);
    };
    const go=(index:number)=>{
      const m=matches[index];if(!m)return;
      const s=source(m),row=s.rows.find(r=>r.id===m.row)!,column=s.columns.find(c=>c.id===m.column)!;
      const hidden=s.groups.filter(g=>g.collapsed&&outlineMembers(g,s.groups).includes(g.axis==='row'?m.row:m.column));
      if(row.hidden||column.hidden||hidden.length){
        if(!mutate('Reveal search result',()=>{if(row.hidden)row.hidden=false;if(column.hidden)column.hidden=false;hidden.forEach(g=>g.collapsed=false);})){feedback(error,true);return;}
      }
      sheetId=s.id;referenceId=undefined;workbookView=undefined;filter='all';extraSelections=[];selected={r:m.r,c:m.c};anchor={...selected};selectionKind='cells';scrollTarget=m.r;page=Math.floor(m.r/60);active=identity(m);resultPage=Math.floor(index/200);render();paint();
      d.querySelector<HTMLElement>(`[data-find-match="${index}"]`)?.scrollIntoView({block:'nearest'});
    };
    const next=()=>{
      if(!matches.length)return;
      const up=field<HTMLSelectElement>('find-direction').value==='up',current=matches.findIndex(m=>identity(m)===active);
      if(current>=0){go((current+(up?-1:1)+matches.length)%matches.length);return;}
      const order=book.sheets.findIndex(s=>s.id===sheetId),after=(m:Match)=>book.sheets.findIndex(s=>s.id===m.sid)-order||m.r-selected.r||m.c-selected.c;
      const index=up?matches.reduce((last,m,i)=>after(m)<0?i:last,-1):matches.findIndex(m=>after(m)>0);go(index<0?(up?matches.length-1:0):index);
    };
    const replace=(every:boolean)=>{
      draw(false);if(!every&&!active)next();
      const targets=every?matches:matches.filter(m=>identity(m)===active),editable=targets.filter(literal),search=matcher();let changed=0;
      if(!editable.length){feedback('Only literal text can be replaced. Formula and linked cells are unchanged.',true);return;}
      if(!mutate('Replace literal text',()=>{for(const m of editable){
        const s=source(m),cell=getCell(s,m.row,m.column);if(typeof cell.value!=='string'||cell.formula||cell.binding)throw Error('This result changed. Search again before replacing it.');
        const value=search.replace(cell.value,replacement);if(value===cell.value)continue;
        const table=book.tables.find(t=>t.sheet===m.sid&&t.header===m.row&&t.columns.some(c=>c.column===m.column));
        if(table)renameColumn(book,table,table.columns.find(c=>c.column===m.column)!.id,value);
        else s.cells[key(m.row,m.column)]={...cell,value};changed++;
      }})){feedback(error,true);return;}
      draw(false);feedback(`${changed} literal cell${changed===1?'':'s'} replaced.${targets.length>editable.length?` ${targets.length-editable.length} other results left unchanged.`:''}`);
    };
    const mode=(replaceMode:boolean)=>{
      for(const id of ['find-tab','replace-tab']){const tab=field<HTMLButtonElement>(id),selected=id===(replaceMode?'replace-tab':'find-tab');tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
      field('find-controls').setAttribute('aria-labelledby',replaceMode?'replace-tab':'find-tab');
      field('replace-fields').innerHTML=replaceMode?`<label id="replace-label">Replace with<input id="replace-text" value="${esc(replacement)}"></label>`:'';
      field('replace-actions').innerHTML=replaceMode?'<button id="replace-one">Replace</button><button id="replace-all">Replace all</button>':'';
      if(replaceMode){field<HTMLInputElement>('replace-text').oninput=e=>replacement=(e.target as HTMLInputElement).value;field<HTMLButtonElement>('replace-one').onclick=()=>replace(false);field<HTMLButtonElement>('replace-all').onclick=()=>replace(true);}
      buttons();
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
    field<HTMLButtonElement>('find-tab').onclick=()=>mode(false);field<HTMLButtonElement>('replace-tab').onclick=()=>mode(true);
    d.querySelector<HTMLElement>('.find-tabs')!.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const replaceMode=e.key==='ArrowRight'||e.key==='End';mode(replaceMode);field(replaceMode?'replace-tab':'find-tab').focus();}};
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
    const ingredients=book.tables.find(t=>t.name.toLowerCase()==='ingredients'),localContext=document.createElement('p');
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
          state=await store.save(snapshot.book,state.version,'Load published testing workbook',true,undefined,{localOnly:true,recoveryArchive:stringifyArchive(before),publishedSnapshot:snapshot.id});
          book=clone(state.book);engine=new Engine(book);sheetId=(book.sheets.find(s=>!s.supporting)??book.sheets[0]).id;referenceId=undefined;workbookView=undefined;extraSelections=[];selected={r:0,c:0};anchor={...selected};undo.length=redo.length=0;generation++;savedGeneration=generation;status='Published testing workbook saved in this browser';channel?.postMessage({version:state.version});render();
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
        state=await store.restore(backup,state.version);token='';book=clone(state.book);engine=new Engine(book);generation++;savedGeneration=generation;sheetId=book.sheets[0].id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';page=0;undo.length=redo.length=0;status='Restored locally - sync disconnected; full pre-restore archive in recovery';channel?.postMessage({version:state.version});render();d.close();
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
        if(result.nativeBackup)state=await store.restore(result.nativeBackup,state.version);
        else state=await store.save(result.book,state.version,'Excel import',true,result.original,{localOnly:true,recoveryArchive:recovery});
        token='';book=clone(state.book);engine=new Engine(book);generation++;savedGeneration=generation;sheetId=book.sheets[0].id;selected={r:0,c:0};anchor={...selected};selectionKind='cells';page=0;undo.length=redo.length=0;status='Imported locally - sync disconnected; compatibility review required';channel?.postMessage({version:state.version});render();d.close();
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
        if(beforeImport.originals.some(original=>original.data===source.original.data))throw Error('This unchanged source file is already attached locally. Import cancelled to avoid duplicate records; use recovery or select an updated source file deliberately.');
        const result=mergeIngredients(book,source.book);
        state=await store.save(result.book,state.version,'Ingredients import',true,source.original,{localOnly:true,recoveryArchive:recovery});
        token='';book=clone(state.book);engine=new Engine(book);generation++;savedGeneration=generation;
        sheetId=result.sheet;selected={r:1,c:0};anchor={...selected};selectionKind='cells';page=0;filter='all';undo.length=redo.length=0;
        status=`Imported ${result.rows} Ingredients records locally; ${result.retainedRows} existing records retained - sync disconnected`;
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
          state=await store.restore(backup,state.version);token='';book=clone(state.book);engine=new Engine(book);generation++;savedGeneration=generation;sheetId=book.sheets[0].id;page=0;selected={r:0,c:0};anchor={...selected};selectionKind='cells';undo.length=redo.length=0;status='Checkpoint restored locally - sync disconnected; full pre-restore archive in recovery';channel?.postMessage({version:state.version});render();d.close();
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
  if(referenceId&&kind==='rows'){
    try{
      const ids=selectedReferenceRows(),source=activeReference()!,usages=ids.map(id=>referenceUsages(book,source,id));
      if(usages.some(u=>u.linked||u.formulas||u.manual)){
        const choices=referenceChoices(book,source).filter(c=>!ids.includes(c.row));
        dialog('Options are in use',`<p>${usages.reduce((n,u)=>n+u.linked,0)} linked cells. Formula or manual lookups may also use these options. Hide options to preserve history, replace exact links, or cancel.</p><button id="archive-option">Hide selected options</button>${ids.length===1?`<label>Replace linked values with<select id="replacement"><option value="">Choose replacement</option>${choices.map(c=>`<option value="${c.row}">${esc(c.value)}</option>`).join('')}</select></label><button id="delete-option">Replace links and delete</button>`:''}`,d=>{
          d.querySelector<HTMLButtonElement>('#archive-option')!.onclick=()=>{mutate('Archive options',()=>{source.archivedRows=[...new Set([...source.archivedRows,...ids])];});d.close();};
          d.querySelector<HTMLButtonElement>('#delete-option')?.addEventListener('click',()=>{if(mutate('Replace and delete option',()=>removeReferenceValue(book,activeReference()!,ids[0],d.querySelector<HTMLSelectElement>('#replacement')!.value||undefined)))d.close();});
        });return;
      }
      mutate('Delete options',()=>ids.forEach(id=>removeReferenceValue(book,activeReference()!,id)));return;
    }catch(e){flash(e);return;}
  }
  if(referenceId&&kind==='columns'){mutate('Delete reference fields',()=>deleteReferenceColumns(book,activeReference()!,columnIndices.map(i=>s.columns[i]).filter(c=>gridReference()!.columns.includes(c.id)).map(c=>c.id)));extraSelections=[];return;}
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
      if(book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(x=>x.column===s.columns[c].id)))throw Error('Rename table headers explicitly.');
      setInput(book,s,s.rows[r].id,s.columns[c].id,'');
    });
  });
}
document.addEventListener('keydown',e=>{
  if(e.isComposing||e.keyCode===229||e.altKey||!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='f')return;
  e.preventDefault();e.stopPropagation();
  const existing=document.querySelector<HTMLInputElement>('.find-dialog[open] #find-text');
  if(existing){existing.focus();existing.select();return;}
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
  else if(e.key.length===1&&!mod&&!e.altKey){syncDraft(e.key,true);e.preventDefault();}
});
document.addEventListener('paste',e=>{
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)||document.querySelector('dialog[open]'))return;
  const text=e.clipboardData?.getData('text/plain');if(!text)return;e.preventDefault();
  if(!requireRectangle('Paste'))return;
  if(e.clipboardData?.getData('application/x-fnt-copy')===clipboardId&&copied){pasteCells();return;}
  if(!editableReference()){flash('Edit the live list source instead.');return;}
  mutate('Paste text',()=>{const rows=parseTsv(text),s=sheet();rows.forEach((row,i)=>row.forEach((v,j)=>{const p=pastePosition(i,j);if(!p)throw Error('Paste exceeds this sheet or list.');if(book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[p.r].id&&t.columns.some(c=>c.column===s.columns[p.c].id)))throw Error('Rename table headers explicitly.');writeGridCell(book,s,s.rows[p.r].id,s.columns[p.c].id,v);}));});
});
document.addEventListener('cut',e=>{
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)||document.querySelector('dialog[open]'))return;
  if(!commitDraft())return;e.preventDefault();if(!copyCells(true))return;
  e.clipboardData?.setData('application/x-fnt-copy',clipboardId);
  e.clipboardData?.setData('text/plain',copiedText(copied!));
});
document.addEventListener('copy',e=>{
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName))return;
  e.preventDefault();if(!copyCells())return;e.clipboardData?.setData('text/plain',copiedText(copied!));
  e.clipboardData?.setData('application/x-fnt-copy',clipboardId);e.preventDefault();
});
document.addEventListener('click',e=>{if(appendDraft&&!(e.target as HTMLElement).closest('.reference-append-row')&&!commitDraft()){e.preventDefault();e.stopImmediatePropagation();}});
window.addEventListener('beforeunload',e=>{if(generation!==savedGeneration||draft!==undefined||appendDraft||colorPicker?.pending){e.preventDefault();e.returnValue='Unsaved workbook edits';}});
window.addEventListener('resize',()=>drawRowWindow?.());
window.addEventListener('online',()=>{if(state?.sync){status='Online - use Save to sync pending changes';renderStatus();}});
window.addEventListener('offline',()=>{status='Offline - local autosave remains available';renderStatus();});
channel?.addEventListener('message',e=>{if(state&&e.data.version>state.version){error='Another tab saved newer changes. Download a backup of this tab before reloading; further saves are blocked by revision checks.';renderStatus();}});
async function start():Promise<void> {
  root.innerHTML='<main class="startup"><p>Opening your local workbook...</p></main>';
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
      if(import.meta.env.PROD&&untouchedStarter(state,await store.originalCount())){
        try{
          const snapshot=await loadPublishedTesting();
          if(state.publishedSnapshot!==snapshot.id){
            const before=await store.backup(state);
            state=await store.save(snapshot.book,state.version,'Load published testing workbook',true,undefined,{localOnly:true,recoveryArchive:stringifyArchive(before),publishedSnapshot:snapshot.id});
            book=clone(state.book);
          }
        }catch(e){error=`Published testing data could not be updated; your existing workbook was retained. ${String(e)}`;}
      }
    }else{
      if(import.meta.env.PROD){
        stage='loading the published testing workbook';const snapshot=await loadPublishedTesting();book=clone(snapshot.book);
        state=await store.save(book,0,'Load published testing workbook',false,undefined,{localOnly:true,publishedSnapshot:snapshot.id});
      }else{book=seedDropdownCatalog(createDemo()).book;state=await store.save(book,0,'Create starter workbook with original Dropdowns catalogs');}
    }
    let remembered:string|null=null;try{remembered=sessionStorage.getItem('fnt-current-sheet');}catch(e){error=`Selected-tab preference unavailable: ${String(e)}`;}
    stage='rendering the spreadsheet';engine=new Engine(book);sheetId=book.sheets.some(s=>s.id===remembered)?remembered!:book.sheets[0].id;const view=restoreView();if(referenceId&&!workbookView){const s=book.sheets.find(s=>!s.supporting)??book.sheets[0];workbookView={sheet:s.id,selected:{r:0,c:0},anchor:{r:0,c:0},kind:'cells',scroll:0,left:0,filter:'all'};}status=state.sync?`Saved locally - ${state.pending.length} pending changes`:'Saved in this browser';render();if(view){const grid=root.querySelector<HTMLElement>('#grid-scroll')!;grid.scrollTop=view.scroll;grid.scrollLeft=view.left;drawRowWindow?.();rememberView();}
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
