import './style.css';
import { addRow, blankSheet, clone, columnIndex, createDemo, deleteColumn, deleteRows, duplicateSheet, expandAdjacentTable, fillCells, getCell, insertColumn, isFault, key, letters, move, moveColumns, renameColumn, setInput, tableAt, translate, uid, uniqueName, type Cell, type Sheet, type Workbook } from './model';
import { compile, displayFormula, Engine, flatten, scalar } from './formula';
import { Store, SyncConflict, syncGitHub, type Backup, type LocalState } from './storage';
import { parseArchive, stringifyArchive } from './archive';
import { parseTsv,serializeTsv } from './clipboard';
import { cutCells, shiftCells } from './cell-operations';
import { excelDate,excelDateText } from './dates';
import { RowViewport } from './row-viewport';
import { defaultHeaderFormula,groupBlockToTop,positionalBlock } from './meal-block';
import { columnCalculations,quantityDiagnostic,restoreCalculation } from './calculation';
import { openReferenceManager } from './reference-ui';
import { referenceChoices,referenceFormula,validationReference } from './references';
import { dropdownCatalog,seedDropdownCatalog,verifiedCatalogOrigins } from './dropdown-catalog';

const root = document.querySelector<HTMLDivElement>('#app')!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let book: Workbook, state: LocalState, store: Store, engine: Engine;
let sheetId = '', selected = {r:1,c:0}, anchor = {...selected}, page = 0, filter = 'all';
let selectionKind:'cells'|'rows'|'columns'='cells';
let renderedSheet='',renderedTarget='',scrollTarget:number|undefined,drawRowWindow:(()=>void)|undefined;
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
let movingColumns:string[]|undefined;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fnt-edits') : undefined;
const clipboardId=uid();
const sheet = () => book.sheets.find(s => s.id === sheetId)!;
const current = () => getCell(sheet(),sheet().rows[selected.r].id,sheet().columns[selected.c].id);
const bounds = () => ({r1:Math.min(anchor.r,selected.r),r2:Math.max(anchor.r,selected.r),c1:Math.min(anchor.c,selected.c),c2:Math.max(anchor.c,selected.c)});
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
function mutate(label: string, fn: () => void): boolean {
  if (busy) { flash('Wait for the current save or sync to finish.'); return false; }
  const before = clone(book);
  const priorBook=book,shape=structureKey(book),metadata=metadataKey(book),cells=new Map(book.sheets.map(s=>[s.id,new Map(Object.entries(s.cells))]));
  try { fn(); }
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
  root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('#formula,.cell-inline-editor').forEach(el=>el.disabled=busy);
  const el = document.querySelector('#save-state');
  if (el) { el.textContent = draft!==undefined?'Editing cell - not saved yet':status; el.className = `save-state ${error ? 'bad' : ''}`; }
  const alert = document.querySelector<HTMLElement>('#error');
  if (alert) { alert.textContent = error; alert.hidden = !error; }
}
function render(): void {
  engine.beginPass();
  const s = sheet();
  if (!s.rows.length || !s.columns.length) return;
  try{sessionStorage.setItem('fnt-current-sheet',s.id);}catch(e){error=`Could not remember the selected tab: ${String(e)}`;}
  selected.r=Math.min(selected.r,s.rows.length-1); selected.c=Math.min(selected.c,s.columns.length-1);
  anchor.r=Math.min(anchor.r,s.rows.length-1); anchor.c=Math.min(anchor.c,s.columns.length-1);
  const b = bounds(),previousGrid=root.querySelector<HTMLElement>('#grid-scroll'),sameSheet=renderedSheet===s.id;
  const collapsedRows=new Set(s.groups.filter(g=>g.axis==='row'&&g.collapsed).flatMap(g=>g.members));
  const collapsed = (axis: 'row'|'column', id:string) => s.groups.some(g => g.axis===axis && g.collapsed && g.members.includes(id));
  const pins=pinnedColumns.get(s.id)??[];
  const columns = s.columns.map((c,i) => ({...c,i})).filter(c => !c.hidden && !collapsed('column',c.id));
  columns.sort((a,b)=>Number(pins.includes(b.id))-Number(pins.includes(a.id)));
  const pinOffsets=new Map<string,number>();let pinLeft=44;
  for(const c of columns)if(pins.includes(c.id)){pinOffsets.set(c.id,pinLeft);pinLeft+=c.width??145;}
  const pinnedStyle=(id:string,header=false)=>pinOffsets.has(id)?`position:sticky;left:${pinOffsets.get(id)}px;z-index:${header?6:3};`:'';
  const rows = s.rows.map((r,i) => ({...r,i})).filter(r => !r.hidden && !collapsedRows.has(r.id) && (filter === 'all' || (r.status ?? 'real') === filter));
  const headers=new Set(book.tables.filter(t=>t.sheet===s.id).map(t=>t.header));
  const layout=new RowViewport(rows.map(r=>measuredRowHeights.get(r.id)??Math.max(r.height?r.height*4/3:33,headers.has(r.id)?38:0)));
  let vertical=sameSheet?previousGrid?.scrollTop??0:0;
  const target=scrollTarget??(renderedTarget!==`${s.id}:${selected.r}`?selected.r:undefined);
  if(target!==undefined){
    const position=rows.findIndex(r=>r.i>=target),at=position<0?rows.length-1:position,top=layout.offsets[Math.max(0,at)],height=previousGrid?.clientHeight??innerHeight-180;
    if(!sameSheet||scrollTarget!==undefined||top<vertical||top+(layout.heights[at]??33)>vertical+height-28)vertical=top;
  }
  scrollTarget=undefined;renderedSheet=s.id;renderedTarget=`${s.id}:${selected.r}`;
  const t = tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id);
  const scroll = document.querySelector('#grid-scroll')?.scrollLeft ?? 0;
  root.innerHTML = `
    <header class="app-header">
      <div class="workbook-heading"><button id="title" title="Rename workbook">${esc(book.title)}</button></div>
      <div class="save-area"><span id="save-state" class="save-state">${esc(status)}</span><button class="primary" data-action="save">Save <span class="desktop">workbook</span></button><button data-action="file" aria-label="Workbook and backups" title="Import Excel, export and browser-local recovery">File</button></div>
    </header>
    <div id="error" role="alert" class="error" ${error?'':'hidden'}>${esc(error)}</div>
    <nav class="toolbar" aria-label="Spreadsheet tools">
      <div class="tool-set"><button data-action="quick-add">+ Add entry</button><button data-action="picker">Choose source</button></div>
      <div class="tool-set"><button data-action="undo" title="Undo (Ctrl+Z)" ${undo.length?'':'disabled'}>Undo</button><button data-action="redo" title="Redo (Ctrl+Y)" ${redo.length?'':'disabled'}>Redo</button></div>
      <div class="tool-set"><button data-action="bold" title="Bold"><b>B</b></button><button data-action="underline" title="Underline"><u>U</u></button><button data-action="wrap" title="Toggle cell wrapping">Wrap</button><button data-action="format">123</button></div>
      <div class="tool-set"><button data-action="structure">Rows & columns</button><button data-action="tables">Tables</button><button data-action="groups">Groups</button><button data-action="block">Meal / day</button></div>
      <div class="tool-set"><button data-action="find">Find / replace</button><button data-action="copy">Copy</button><button data-action="cut">Cut</button><button data-action="paste">Paste</button><button data-action="fill">Fill down</button></div>
      <div class="tool-set"><button data-action="pin" aria-pressed="${pins.length>0}">${pins.length?'Unpin columns':'Pin selected columns'}</button><button data-action="browse">Browse values</button><select id="status-filter" aria-label="Filter row status"><option value="all">All entries</option>${['real','planned','hypothetical'].map(v => `<option ${v===filter?'selected':''}>${v}</option>`).join('')}</select><button data-action="row-status">Set status</button></div>
    </nav>
    <form class="formula-bar" id="formula-form"><span class="address">${letters(selected.c)}${selected.r+1}</span><span class="fx">fx</span><input id="formula" aria-label="Cell value or formula" autocomplete="off" spellcheck="false" value="${esc(draft??inputText(current()))}"><span id="calculation-state"></span><button type="submit" title="Apply cell edit">Apply</button><button type="button" data-action="editor" title="Expanded cell editor">Expand</button></form>
    <div class="grid-shell"><div id="grid-scroll" class="grid-scroll" tabindex="0" aria-label="Spreadsheet, use arrow keys to navigate">
    <table class="grid ${touchSelection?'touch-select':''}" role="grid" aria-label="${esc(s.name)}" aria-rowcount="${s.rows.length}" aria-colcount="${s.columns.length}"><colgroup><col style="width:44px">${columns.map(c=>`<col style="width:${c.width??145}px">`).join('')}</colgroup>
    <thead><tr><th class="corner"><button data-action="select-all" aria-label="Select all cells">+</button><button class="boundary-control first-column" data-insert-column="0" aria-label="Insert column before A">+</button></th>${columns.map(c=>`<th data-col="${c.i}" style="${pinnedStyle(c.id,true)}" class="${c.i>=b.c1&&c.i<=b.c2?'column-selected ':''}${movingColumns?'move-target':''}" title="Double-click to rename column">${letters(c.i)}<span>${esc(t?.columns.find(x=>x.column===c.id)?.name??c.label)}</span><button class="move-control" data-move-column="${c.i}" draggable="true" aria-label="Move selected columns" title="Drag, or tap then tap a destination boundary">&harr;</button><button class="boundary-control" data-insert-column="${c.i+1}" aria-label="${movingColumns?'Move columns':'Insert column'} after ${letters(c.i)}">+</button></th>`).join('')}</tr></thead>
    <tbody></tbody></table></div></div>
    <div class="grid-footer"><div><button class="selection-count" data-action="range" title="Select a cell range, including on mobile">${(b.r2-b.r1+1)*(b.c2-b.c1+1)} cells</button><span class="desktop"> ${t?esc(t.name)+' / stable references':'Freeform sheet'}</span></div><div class="navigator"><button data-action="top" aria-label="Jump to top">Top</button><button data-action="prev" aria-label="Previous rows">&larr;</button><input id="row-jump" type="number" min="1" max="${s.rows.length}" aria-label="Jump to row"><span>/ ${s.rows.length}</span><button data-action="next" aria-label="Next rows">&rarr;</button><button data-action="bottom">Bottom</button></div></div>
    <footer class="sheet-bar" aria-label="Workbook sheets"><div class="tabs">${book.sheets.filter(tab=>!tab.supporting||tab.id===s.id).map(tab=>`<button class="sheet-tab ${tab.id===s.id?'current':''}" data-sheet="${tab.id}" style="--tab-color:${esc(tab.color)}">${esc(tab.name)}</button>`).join('')}<button data-action="new-sheet" title="Add sheet" aria-label="Add sheet">+</button><button data-action="sheet-options" title="Sheet settings">Sheet settings</button></div><button class="reference-manager" data-action="references" title="Dropdown lists & conversions" aria-label="Lists & conversions">DD</button></footer>`;
  const grid=root.querySelector<HTMLElement>('#grid-scroll')!,body=grid.querySelector('tbody')!;
  let lastStart=-1,lastEnd=-1;
  const spacer=(height:number,position:string)=>`<tr class="virtual-spacer" aria-hidden="true" data-spacer="${position}"><td colspan="${columns.length+1}" style="height:${height}px;padding:0;border:0;line-height:0;font-size:0"></td></tr>`;
  const draw=(initialTop?:number)=>{
    const top=initialTop??grid.scrollTop,window=layout.window(top,Math.max(100,grid.clientHeight-28));
    page=Math.floor((rows[layout.at(top)]?.i??0)/60);
    const jump=root.querySelector<HTMLInputElement>('#row-jump')!;
    if(document.activeElement!==jump)jump.value=String((rows[layout.at(top)]?.i??0)+1);
    root.querySelector<HTMLButtonElement>('[data-action="prev"]')!.disabled=top<=0;
    root.querySelector<HTMLButtonElement>('[data-action="next"]')!.disabled=top+grid.clientHeight>=layout.offsets.at(-1)!+28;
    if(window.start===lastStart&&window.end===lastEnd&&initialTop===undefined)return;
    lastStart=window.start;lastEnd=window.end;engine.beginPass();
    const active=document.activeElement,wasInline=active instanceof HTMLTextAreaElement&&active.classList.contains('cell-inline-editor'),caret=wasInline?[active.selectionStart,active.selectionEnd]:undefined,b=bounds();
    body.innerHTML=spacer(window.before,'before')+rows.slice(window.start,window.end).map((r,index)=>`<tr data-row="${r.i}"${r.height?` style="--row-height:${r.height*4/3}px"`:''} class="${r.status&&r.status!=='real'?r.status:''}"><th data-row-select="${r.i}" class="${r.i>=b.r1&&r.i<=b.r2?'row-selected':''}">${r.i+1}<button class="boundary-control row-boundary" data-insert-row="${r.i+1}" aria-label="Insert row after ${r.i+1}">+</button>${index===0?`<button class="boundary-control row-start" data-insert-row="${r.i}" aria-label="Insert row before ${r.i+1}">+</button>`:''}</th>${columns.map(c=>{
      const cell=getCell(s,r.id,c.id),val=cellText(cell,s,r.i,c.i),header=book.tables.some(t=>t.sheet===s.id&&t.header===r.id&&t.columns.some(x=>x.column===c.id)),inSelection=r.i>=b.r1&&r.i<=b.r2&&c.i>=b.c1&&c.i<=b.c2,copying=copied?.sheet===s.id&&r.i>=copied.r&&r.i<copied.r+copied.cells.length&&c.i>=copied.c&&c.i<copied.c+copied.cells[0].length;
      return `<td tabindex="-1" data-r="${r.i}" data-c="${c.i}" class="${header?'table-header ':''}${inSelection?'selected ':''}${selected.r===r.i&&selected.c===c.i?'active ':''}${copying?'copying ':''}${cell.formula?'calculated ':''}${val.startsWith('#')?'cell-error ':''}${cell.binding?'linked ':''}" style="${pinnedStyle(c.id)}${cell.format?.bold?'font-weight:700;':''}${cell.format?.underline?'text-decoration:underline;':''}${cell.format?.wrap?'white-space:pre-wrap;overflow-wrap:anywhere;':''}${cell.format?.background?`background-color:${esc(cell.format.background)};`:''}${cell.format?.color?`color:${esc(cell.format.color)};`:''}" title="${esc(cell.formula?displayFormula(cell.formula,book):val)}">${safeLink(cell.link??val)?`<a href="${esc(cell.link??val)}" target="_blank" rel="noopener noreferrer">${esc(val)}</a>`:esc(val)}${cell.note?'<span class="note-dot" title="Cell has a note"></span>':''}${r.i===b.r2&&c.i===b.c2?'<button type="button" class="fill-handle" data-fill-handle aria-label="Drag to fill"></button>':''}</td>`;
    }).join('')}</tr>`).join('')+spacer(window.after,'after');
    const anchorIndex=layout.at(top),anchorOffset=top-layout.offsets[anchorIndex];let resized=false;
    body.querySelectorAll<HTMLElement>('tr[data-row]').forEach((el,i)=>{
      const height=el.getBoundingClientRect().height,position=window.start+i;
      if(height>0&&Math.abs(layout.heights[position]-height)>.1){layout.heights[position]=height;measuredRowHeights.set(rows[position].id,height);resized=true;}
    });
    if(resized){layout.rebuild();(body.querySelector('[data-spacer="before"] td') as HTMLElement).style.height=layout.offsets[window.start]+'px';(body.querySelector('[data-spacer="after"] td') as HTMLElement).style.height=layout.offsets.at(-1)!-layout.offsets[window.end]+'px';}
    grid.scrollTop=layout.offsets[anchorIndex]+anchorOffset;bindRowControls();
    if(draft!==undefined&&!busy){
      syncDraft(draft);
      if(wasInline){const editor=root.querySelector<HTMLTextAreaElement>('.cell-inline-editor')??root.querySelector<HTMLInputElement>('#formula')!;editor.focus({preventScroll:true});editor.setSelectionRange(caret![0],caret![1]);}
    }
  };
  drawRowWindow=()=>draw();draw(vertical);
  grid.scrollLeft=scroll;
  bind();
  if(draft!==undefined)syncDraft(draft);
  renderStatus();
}
function safeLink(value: string): boolean {
  try { return ['https:','http:','mailto:'].includes(new URL(value).protocol); } catch { return false; }
}
function bindRowControls():void {
  root.querySelectorAll<HTMLElement>('td[data-r]').forEach(el=>{
    el.onpointerdown=e=>{
      if((e.target as HTMLElement).closest('a,textarea,input'))return;
      if(!commitDraft())return;
      selected={r:Number(el.dataset.r),c:Number(el.dataset.c)};if(!e.shiftKey||selectionKind!=='cells')anchor={...selected};selectionKind='cells';
      if(touchSelection){e.preventDefault();touchPointer=e.pointerId;(root.querySelector('#grid-scroll') as HTMLElement).setPointerCapture(e.pointerId);}
      refreshSelection();(root.querySelector('#grid-scroll') as HTMLElement).focus({preventScroll:true});
    };
    el.ondblclick=()=>openEditor();
  });
  root.querySelector<HTMLButtonElement>('[data-fill-handle]')?.addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();if(!commitDraft())return;fillSource={...bounds()};fillPointer=e.pointerId;(root.querySelector('#grid-scroll') as HTMLElement).setPointerCapture(e.pointerId);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-row]').forEach(el=>el.onclick=e=>{
    e.stopPropagation();if(!commitDraft())return;const at=Number(el.dataset.insertRow),s=sheet();
    mutate('Insert row',()=>{addRow(book,s,at,tableAt(book,s.id,s.rows[at]?.id??s.rows[at-1].id,s.columns[selected.c].id));selected.r=at;anchor={...selected};selectionKind='cells';page=Math.floor(at/60);});
  });
  root.querySelectorAll<HTMLElement>('[data-row-select]').forEach(el=>el.onclick=e=>{
    if(!commitDraft())return;
    selected={r:Number(el.dataset.rowSelect),c:sheet().columns.length-1};if(!e.shiftKey||selectionKind!=='rows')anchor={r:selected.r,c:0};
    selectionKind='rows';refreshSelection();root.querySelector<HTMLElement>('#grid-scroll')!.focus({preventScroll:true});
  });
}
function bind(): void {
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(el => el.onclick = () => { void action(el.dataset.action!); });
  root.querySelectorAll<HTMLElement>('[data-sheet]').forEach(el=> {
    el.onclick=()=>{if(sheetId===el.dataset.sheet||!commitDraft())return;sheetId=el.dataset.sheet!;selected={r:0,c:0};anchor={...selected};selectionKind='cells';page=0;render();};
    el.ondblclick=()=>inlineSheetName(el);
    el.draggable=true;el.ondragstart=e=>{if(!commitDraft()){e.preventDefault();return;}e.dataTransfer?.setData('application/x-fnt-sheet',el.dataset.sheet!);};
    el.ondragover=e=>e.preventDefault();el.ondrop=e=>{e.preventDefault();const id=e.dataTransfer?.getData('application/x-fnt-sheet');if(!id)return;mutate('Reorder tabs',()=>move(book.sheets,book.sheets.findIndex(s=>s.id===id),book.sheets.findIndex(s=>s.id===el.dataset.sheet)));};
  });
  const scrolling=root.querySelector<HTMLElement>('#grid-scroll')!;let frame=0;
  scrolling.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;drawRowWindow?.();});},{passive:true});
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
      selected.c=Number(el.dataset.col);if(!e.shiftKey||selectionKind!=='columns')anchor={r:0,c:selected.c};else anchor.r=0;selected.r=sheet().rows.length-1;selectionKind='columns';refreshSelection();scrolling.focus({preventScroll:true});
    };
    el.ondblclick=()=>{ selected={r:Math.min(sheet().rows.length-1,Math.max(1,Number(root.querySelector<HTMLInputElement>('#row-jump')!.value)-1)),c:Number(el.dataset.col)};anchor={...selected};selectionKind='cells';renameSelectedColumn(); };
    el.ondragover=e=>{e.preventDefault();root.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));el.classList.add(e.clientX<el.getBoundingClientRect().left+el.getBoundingClientRect().width/2?'drop-before':'drop-after');};
    el.ondrop=e=>{
      e.preventDefault();const data=e.dataTransfer?.getData('application/x-fnt-columns');if(!data)return;
      try{const ids:unknown=JSON.parse(data);if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Invalid column drag.');dropColumns(ids,Number(el.dataset.col)+(el.classList.contains('drop-after')?1:0));}catch(error){flash(error);}
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-move-column]').forEach(el=>{
    el.onpointerdown=()=>el.focus({preventScroll:true});
    const ids=()=>{const b=bounds(),c=Number(el.dataset.moveColumn);return sheet().columns.slice(c>=b.c1&&c<=b.c2?b.c1:c,c>=b.c1&&c<=b.c2?b.c2+1:c+1).map(c=>c.id);};
    el.onclick=e=>{e.stopPropagation();if(!commitDraft())return;movingColumns=movingColumns?undefined:ids();render();};
    el.ondragstart=e=>{e.stopPropagation();if(!commitDraft()){e.preventDefault();return;}e.dataTransfer?.setData('application/x-fnt-columns',JSON.stringify(ids()));if(e.dataTransfer)e.dataTransfer.effectAllowed='move';};
    el.ondragend=()=>root.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-insert-column]').forEach(el=>el.onclick=e=>{
    e.stopPropagation();if(!commitDraft())return;const at=Number(el.dataset.insertColumn);
    if(movingColumns){dropColumns(movingColumns,at);return;}
    mutate('Insert column',()=>{insertColumn(book,sheet(),at);selected.c=at;anchor={...selected};selectionKind='cells';});
  });
  document.querySelector('#formula-form')!.addEventListener('submit',e=>{
    e.preventDefault(); const text=(document.querySelector('#formula') as HTMLInputElement).value;
    applyInput(text);
  });
  document.querySelector<HTMLInputElement>('#formula')!.oninput=e=>syncDraft((e.target as HTMLInputElement).value);
  document.querySelector<HTMLInputElement>('#formula')!.onkeydown=editKey;
  document.querySelector<HTMLSelectElement>('#status-filter')!.onchange=e=>{filter=(e.target as HTMLSelectElement).value;render();};
  document.querySelector<HTMLInputElement>('#row-jump')!.onchange=e=>{
    if(!commitDraft())return;selected.r=Math.max(0,Math.min(sheet().rows.length-1,Math.trunc(Number((e.target as HTMLInputElement).value))-1));anchor={...selected};selectionKind='cells';scrollTarget=selected.r;page=Math.floor(selected.r/60);render();
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
function refreshSelection():void {
  renderedTarget=`${sheetId}:${selected.r}`;
  const b=bounds();
  root.querySelectorAll<HTMLElement>('td[data-r]').forEach(el=>{
    const r=Number(el.dataset.r),c=Number(el.dataset.c);
    el.classList.toggle('selected',r>=b.r1&&r<=b.r2&&c>=b.c1&&c<=b.c2);
    el.classList.toggle('active',r===selected.r&&c===selected.c);
  });
  root.querySelectorAll<HTMLElement>('[data-col]').forEach(el=>{const c=Number(el.dataset.col);el.classList.toggle('column-selected',c>=b.c1&&c<=b.c2);});
  root.querySelectorAll<HTMLElement>('[data-row-select]').forEach(el=>{const r=Number(el.dataset.rowSelect);el.classList.toggle('row-selected',r>=b.r1&&r<=b.r2);});
  const fill=root.querySelector('[data-fill-handle]'),last=root.querySelector(`td[data-r="${b.r2}"][data-c="${b.c2}"]`);if(fill&&last&&!last.querySelector('textarea'))last.append(fill);
  const formula=root.querySelector<HTMLInputElement>('#formula');if(formula)formula.value=inputText(current());
  const address=root.querySelector('.address');if(address)address.textContent=`${letters(selected.c)}${selected.r+1}`;
  const count=root.querySelector('.selection-count');if(count)count.textContent=`${(b.r2-b.r1+1)*(b.c2-b.c1+1)} cells`;
  updateCalculationState();
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
  movingColumns=undefined;
  mutate('Move columns',()=>{
    const at=moveColumns(book,sheet(),ids,boundary);anchor={r:0,c:at};selected={r:sheet().rows.length-1,c:at+ids.length-1};selectionKind='columns';
    renderedTarget=`${sheetId}:${selected.r}`;scrollTarget=undefined;
  });
}
function syncDraft(value:string,focus=false):void {
  if(busy){flash('Wait for the current save or sync to finish.');return;}
  selectionKind='cells';
  draft=value;
  const formula=root.querySelector<HTMLInputElement>('#formula');if(formula&&formula.value!==value)formula.value=value;
  const cell=root.querySelector<HTMLElement>(`td[data-r="${selected.r}"][data-c="${selected.c}"]`);
  if(cell){
    let editor=cell.querySelector<HTMLTextAreaElement>('.cell-inline-editor');
    if(!editor){
      editor=document.createElement('textarea');editor.className='cell-inline-editor';editor.setAttribute('aria-label','Edit selected cell');editor.spellcheck=false;editor.rows=1;
      editor.oninput=()=>syncDraft(editor!.value);editor.onkeydown=editKey;cell.replaceChildren(editor);
    }
    if(editor.value!==value)editor.value=value;
    if(focus){editor.focus();editor.setSelectionRange(value.length,value.length);}
  }
  renderStatus();
}
function editKey(e:KeyboardEvent):void {
  if(e.isComposing||e.keyCode===229)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();draft=undefined;render();(root.querySelector('#grid-scroll') as HTMLElement).focus();return;}
  if(e.key==='Enter'&&!e.shiftKey||e.key==='Tab'){
    e.preventDefault();e.stopPropagation();
    if(!commitDraft())return;
    if(e.key==='Tab'){selected.c=Math.max(0,Math.min(sheet().columns.length-1,selected.c+(e.shiftKey?-1:1)));anchor={...selected};refreshSelection();}
    (root.querySelector('#grid-scroll') as HTMLElement).focus();
  }
}
function applyInput(text:string): boolean {
  if(busy){flash('Wait for the current save or sync to finish.');return false;}
  const previousDraft=draft;draft=undefined;
  if(text===inputText(current())){render();return true;}
  const ok=mutate('Edit cell',()=>{
    const s=sheet(),t=book.tables.find(t=>t.sheet===s.id&&t.header===s.rows[selected.r].id&&t.columns.some(c=>c.column===s.columns[selected.c].id));
    if(t) renameColumn(book,t,t.columns.find(c=>c.column===s.columns[selected.c].id)!.id,text);
    else setInput(book,s,s.rows[selected.r].id,s.columns[selected.c].id,text);
  });
  if(!ok)draft=previousDraft??text;
  return ok;
}
function commitDraft():boolean{return draft===undefined||applyInput(draft);}
function dialog(title:string,html:string,onMount?:(d:HTMLDialogElement)=>void): HTMLDialogElement {
  document.querySelector('dialog')?.remove();
  const d=document.createElement('dialog');d.innerHTML=`<div class="dialog-heading"><h2>${esc(title)}</h2><button class="close" aria-label="Close dialog">x</button></div>${html}`;
  document.body.append(d);d.querySelector<HTMLButtonElement>('.close')!.onclick=()=>d.close();d.onclose=()=>d.remove();d.showModal();onMount?.(d);return d;
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
  const cell=current();
  dialog(`Edit ${letters(selected.c)}${selected.r+1}`,`<p class="muted">Expanded editing never changes cell wrapping. A formula starts with =. Plain text never silently links to a source.</p><form id="cell-form"><label>Value or formula<textarea id="cell-editor" rows="9" spellcheck="false">${esc(inputText(cell))}</textarea></label><label>Cell note<textarea id="cell-note" rows="3">${esc(cell.note)}</textarea></label><label>Hyperlink (http, https, mailto)<input id="cell-link" value="${esc(cell.link)}"></label><button class="primary">Apply changes</button></form>`,d=>{
    d.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();const link=d.querySelector<HTMLInputElement>('#cell-link')!.value;
      if(link&&!safeLink(link)){flash('Unsafe or invalid hyperlink. Use http, https, or mailto.');return;}
      const text=d.querySelector<HTMLTextAreaElement>('#cell-editor')!.value;
      mutate('Edit cell and note',()=>{
        const s=sheet(),r=s.rows[selected.r].id,c=s.columns[selected.c].id;
        if(text!==inputText(cell))setInput(book,s,r,c,text);
        const updated=clone(getCell(s,r,c));updated.note=d.querySelector<HTMLTextAreaElement>('#cell-note')!.value;updated.link=link;s.cells[key(r,c)]=updated;
      });d.close();
    };
    d.querySelector<HTMLTextAreaElement>('#cell-editor')!.focus();
  });
}
function eachSelected(fn:(s:Sheet,r:number,c:number)=>void):void {
  const s=sheet(),b=bounds();for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++)fn(s,r,c);
}
function copyCells(cut=false):void {
  const s=sheet(),b=bounds();
  copied={sheet:s.id,r:b.r1,c:b.c1,rows:s.rows.slice(b.r1,b.r2+1).map(r=>r.id),columns:s.columns.slice(b.c1,b.c2+1).map(c=>c.id),cells:s.rows.slice(b.r1,b.r2+1).map(r=>s.columns.slice(b.c1,b.c2+1).map(c=>clone(getCell(s,r.id,c.id)))),cut};
  render();
}
function pasteCells():void {
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
      if(!s.rows[selected.r+i]||!s.columns[selected.c+j])throw Error('Paste exceeds the sheet. Add rows or columns first.');
      const target=clone(cell);
      if(!from.rows.some(r=>r.id===source.rows[i])||!from.columns.some(c=>c.id===source.columns[j]))throw Error('Copied source was deleted. Copy again before pasting.');
      if(target.formula||target.binding||target.value!=null&&target.value!=='')expandAdjacentTable(book,s,s.rows[selected.r+i].id,s.columns[selected.c+j].id);
      if(target.formula)target.formula=translate(target.formula,book,from.id,source.rows[i],source.columns[j],s.rows[selected.r+i].id,s.columns[selected.c+j].id,s.id);
      if(target.calculation)target.calculation=translate(target.calculation,book,from.id,source.rows[i],source.columns[j],s.rows[selected.r+i].id,s.columns[selected.c+j].id,s.id);
      const targetTable=book.tables.find(t=>t.sheet===s.id&&t.header===s.rows[selected.r+i].id&&t.columns.some(c=>c.column===s.columns[selected.c+j].id));
      if(targetTable)throw Error('Paste into table headers is disabled. Rename headers explicitly to protect table integrity.');
      s.cells[key(s.rows[selected.r+i].id,s.columns[selected.c+j].id)]=target;
    }));
  });
}
async function action(name:string):Promise<void> {
  if(busy){flash('Wait for the current save or sync to finish.');return;}
  if(!commitDraft())return;
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
    case 'bold':case 'underline':case 'wrap':mutate(`Toggle ${name}`,()=>eachSelected((s,r,c)=>{
      const cell=clone(getCell(s,s.rows[r].id,s.columns[c].id));cell.format={...cell.format,[name]:!cell.format?.[name]};s.cells[key(s.rows[r].id,s.columns[c].id)]=cell;
    }));break;
    case 'format':openFormat();break;
    case 'editor':openEditor();break;
    case 'copy':copyCells();break;
    case 'cut':copyCells(true);break;
    case 'paste':pasteCells();break;
    case 'fill':mutate('Fill down',()=>{
      const s=sheet(),b=bounds();
      for(let c=b.c1;c<=b.c2;c++)for(let r=b.r1+1;r<=b.r2;r++){
        if(book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(x=>x.column===s.columns[c].id)))throw Error('Fill cannot overwrite table headers. Rename headers explicitly.');
        const cell=clone(getCell(s,s.rows[b.r1].id,s.columns[c].id));
        if(cell.formula)cell.formula=translate(cell.formula,book,s.id,s.rows[b.r1].id,s.columns[c].id,s.rows[r].id,s.columns[c].id);
        else if(typeof cell.value==='string'&&/\d+$/.test(cell.value))cell.value=cell.value.replace(/\d+$/,n=>String(Number(n)+r-b.r1));
        if(cell.calculation)cell.calculation=translate(cell.calculation,book,s.id,s.rows[b.r1].id,s.columns[c].id,s.rows[r].id,s.columns[c].id);
        s.cells[key(s.rows[r].id,s.columns[c].id)]=cell;
      }
    });break;
    case 'pin':{const b=bounds();pinnedColumns.set(sheetId,(pinnedColumns.get(sheetId)?.length??0)>0?[]:sheet().columns.slice(b.c1,b.c2+1).map(c=>c.id));render();break;}
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
    case 'references':openReferences();break;
    case 'groups':openGroups();break;
    case 'block':openBlock();break;
    case 'find':openFind();break;
    case 'picker':openPicker();break;
    case 'quick-add':{
      const s=sheet(),t=tableAt(book,s.id,s.rows[selected.r].id,s.columns[selected.c].id)??book.tables.find(t=>t.sheet===s.id);
      mutate('Add entry',()=>{const at=t?Math.max(s.rows.findIndex(r=>r.id===t.header)+1,...t.rows.map(id=>s.rows.findIndex(r=>r.id===id)+1)):selected.r+1;addRow(book,s,at,t);selected={r:at,c:t?s.columns.findIndex(c=>c.id===t.columns[0].column):0};anchor={...selected};selectionKind='cells';page=Math.floor(at/60);});document.querySelector<HTMLInputElement>('#formula')?.focus();break;
    }
    case 'row-status':dialog('Entry status','<p>Metadata only. This does not rewrite dates or change imported formulas. Your formulas must explicitly exclude hypothetical rows if needed.</p><div class="menu">'+['real','planned','hypothetical'].map(x=>`<button data-status="${x}">${x}</button>`).join('')+'</div>',d=>{
      d.querySelectorAll<HTMLButtonElement>('[data-status]').forEach(el=>el.onclick=()=>{mutate('Set entry status',()=>{const b=bounds();sheet().rows.slice(b.r1,b.r2+1).forEach(r=>r.status=el.dataset.status as 'real'|'planned'|'hypothetical');});d.close();});
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
  askText('Rename column',col?.name??s.columns[selected.c].label,name=>mutate('Rename column',()=>{if(t&&col)renameColumn(book,t,col.id,name);else s.columns[selected.c].label=name;}));
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
  dialog('Rows & columns',`<p class="muted">Shift-click to select a range. Row / column headers select the whole row / column. Moves keep record identities intact.</p><div class="menu">${items.map((s,i)=>`<button data-op="${i}">${s}</button>`).join('')}</div>`,d=>{
    d.querySelectorAll<HTMLButtonElement>('[data-op]').forEach(el=>el.onclick=()=>{
      d.close();const op=Number(el.dataset.op),s=sheet(),b=bounds();
      if(op===2){renameSelectedColumn();return;}
      if(op===11){askText('Column width (pixels)',String(s.columns[selected.c].width??145),v=>mutate('Resize column',()=>{const width=Number(v);if(!Number.isFinite(width)||width<60||width>800)throw Error('Width must be between 60 and 800 pixels.');s.columns[selected.c].width=width;}));return;}
      const run=()=>mutate(items[op],()=>{
        switch(op){
          case 0:addRow(book,s,b.r1,tableAt(book,s.id,s.rows[b.r1].id));break;
          case 1:insertColumn(book,s,b.c1);break;
          case 3:case 4:move(s.columns,selected.c,selected.c+(op===3?-1:1));selected.c+=op===3?-1:1;anchor={...selected};break;
          case 5:case 6:case 7:{
            const rows=s.rows.splice(b.r1,b.r2-b.r1+1),at=op===7?0:op===5?Math.max(0,b.r1-1):Math.min(s.rows.length,b.r1+1);
            s.rows.splice(at,0,...rows);
            for(const t of book.tables.filter(t=>t.sheet===s.id))t.rows.sort((a,b)=>s.rows.findIndex(r=>r.id===a)-s.rows.findIndex(r=>r.id===b));
            selected.r=at;anchor={...selected};page=Math.floor(at/60);break;
          }
          case 8:s.rows.slice(b.r1,b.r2+1).forEach(r=>r.hidden=true);break;
          case 9:s.columns.slice(b.c1,b.c2+1).forEach(c=>c.hidden=true);break;
          case 10:s.rows.forEach(r=>r.hidden=false);s.columns.forEach(c=>c.hidden=false);s.groups.forEach(g=>g.collapsed=false);break;
          case 12:if(b.r2-b.r1+1===s.rows.length)throw Error('Keep at least one row.');deleteRows(book,s,s.rows.slice(b.r1,b.r2+1).map(r=>r.id));break;
          case 13:if(b.c2-b.c1+1===s.columns.length)throw Error('Keep at least one column.');for(const c of s.columns.slice(b.c1,b.c2+1))deleteColumn(book,s,c.id);break;
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
function clearValidations():void {
  const s=sheet(),b=bounds(),rows=new Set(s.rows.slice(b.r1,b.r2+1).map(r=>r.id)),cols=new Set(s.columns.slice(b.c1,b.c2+1).map(c=>c.id));
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
  const s=sheet();
  dialog('Nested groups',`<p>Select a row or column range, then group it. Overlapping groups remain independent.</p><div class="button-row"><button id="group-row">Group selected rows</button><button id="group-column">Group selected columns</button></div>${s.groups.map(g=>`<div class="table-setting"><span>${esc(g.label)} (${g.members.length} ${g.axis}s)</span><button data-toggle="${g.id}">${g.collapsed?'Expand':'Collapse'}</button><button data-ungroup="${g.id}">Ungroup</button></div>`).join('')}`,d=>{
    for(const axis of ['row','column'] as const)d.querySelector<HTMLButtonElement>(`#group-${axis}`)!.onclick=()=>{mutate('Create group',()=>{const b=bounds();s.groups.push({id:uid(),axis,members:axis==='row'?s.rows.slice(b.r1,b.r2+1).map(r=>r.id):s.columns.slice(b.c1,b.c2+1).map(c=>c.id),collapsed:false,label:`${axis==='row'?'Rows':'Columns'} ${axis==='row'?`${b.r1+1}-${b.r2+1}`:`${letters(b.c1)}-${letters(b.c2)}`}`});});d.close();};
    d.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(el=>el.onclick=()=>{mutate('Toggle group',()=>{const g=s.groups.find(g=>g.id===el.dataset.toggle)!;g.collapsed=!g.collapsed;});d.close();});
    d.querySelectorAll<HTMLButtonElement>('[data-ungroup]').forEach(el=>el.onclick=()=>{mutate('Ungroup',()=>{s.groups=s.groups.filter(g=>g.id!==el.dataset.ungroup);});d.close();});
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
      const rows=s.rows.filter(r=>members.includes(r.id));s.rows=s.rows.filter(r=>!members.includes(r.id));
      const at=s.rows.findIndex(r=>r.id===t.header)+1;s.rows.splice(at,0,...rows);
      t.rows.sort((a,b)=>s.rows.findIndex(r=>r.id===a)-s.rows.findIndex(r=>r.id===b));
      selected={r:at,c:0};anchor={...selected};selectionKind='cells';page=Math.floor(at/60);
    });d.close();};
    d.querySelector<HTMLButtonElement>('#collapse-block')!.onclick=()=>{mutate('Group block details',()=>{if(members.length<2)throw Error('Add detail rows to this block first.');s.groups.push({id:uid(),axis:'row',members:members.slice(1),collapsed:true,label:`${title} details`});});d.close();};
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
  openReferenceManager({
    book:()=>book,esc,mutate,dialog,askText,confirm:confirmAction,importSource:importReferenceSources,
    openSheet:target=>{if(!commitDraft())return;sheetId=target;selected={r:0,c:0};anchor={...selected};selectionKind='cells';scrollTarget=0;render();},
    bind:source=>{
      mutate('Set linked reference dropdown',()=>{
        const s=sheet(),b=bounds(),ast=referenceFormula(source);
        clearValidations();s.validations.push({id:uid(),sheet:s.id,rows:s.rows.slice(b.r1,b.r2+1).map(r=>r.id),columns:s.columns.slice(b.c1,b.c2+1).map(c=>c.id),source:JSON.stringify(ast)});
        for(const c of s.columns.slice(b.c1,b.c2+1))book.pickerSources[`${s.id}:${c.id}`]=source.kind==='derived'?`ref:${source.id}`:`${source.table}:${source.column}`;
      });
      openReferences(source.id,'Dropdown connected. Existing cell contents were not changed.');
    }
  },id,notice);
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
function openPicker():void {
  const s=sheet(),column=s.columns[selected.c].id,remembered=book.pickerSources[`${s.id}:${column}`]??'manual';
  if(book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[selected.r].id&&t.columns.some(c=>c.column===column))){flash('Choose a data cell, not a table header.');return;}
  dialog('Choose an entry',`<p class="muted">Linked entries follow the exact source record, even when renamed. Manual text stays manual. Switching sources never changes existing entries.</p><label>Source<select id="picker-source"><option value="manual">Manual - no link</option>${book.tables.filter(t=>!book.references?.some(source=>source.table===t.id&&source.archived)).flatMap(t=>t.columns.map(c=>`<option value="${t.id}:${c.id}" ${remembered===`${t.id}:${c.id}`?'selected':''}>${esc(book.references?.find(source=>source.table===t.id)?.name??t.name)} / ${esc(c.name)}</option>`)).join('')}${(book.references??[]).filter(source=>source.kind==='derived'&&!source.archived).map(source=>`<option value="ref:${source.id}" ${remembered===`ref:${source.id}`?'selected':''}>${esc(source.name)} / derived</option>`).join('')}</select></label><label>Search source / manual entry<input id="picker-search" placeholder="Type to search..."></label><div id="picker-results" class="picker-results"></div>`,d=>{
    const select=d.querySelector<HTMLSelectElement>('#picker-source')!,search=d.querySelector<HTMLInputElement>('#picker-search')!,results=d.querySelector('#picker-results')!;
    const link=(binding:NonNullable<Cell['binding']>,source=select.value)=>{mutate('Link exact source record',()=>{
      expandAdjacentTable(book,s,s.rows[selected.r].id,column);
      book.pickerSources[`${s.id}:${column}`]=source;
      const previous=getCell(s,s.rows[selected.r].id,column);
      s.cells[key(s.rows[selected.r].id,column)]={...previous,value:undefined,formula:undefined,original:undefined,calculation:previous.formula??previous.calculation,binding};
    });d.close();};
    const draw=()=>{
      try{
      const [tid,cid]=select.value.split(':'),t=book.tables.find(t=>t.id===tid),c=t?.columns.find(c=>c.id===cid);
      const derived=tid==='ref'?book.references?.find(source=>source.id===cid):undefined;
      if(select.value==='manual'){results.innerHTML='<button id="manual-entry" class="primary">Use as manual text</button>';results.querySelector<HTMLButtonElement>('button')!.onclick=()=>{mutate('Manual entry',()=>{book.pickerSources[`${s.id}:${column}`]='manual';setInput(book,s,s.rows[selected.r].id,column,search.value);});d.close();};return;}
      if(!derived&&(!t||!c))throw Error('The saved picker source is missing. Choose another source explicitly.');
      const archived=book.references?.find(source=>source.table===t?.id)?.archivedRows??[];
      const choices=derived?referenceChoices(book,derived):t!.rows.filter(r=>!archived.includes(r)).map(r=>{
        const value=scalar(engine.cell(t!.sheet,r,c!.column));if(isFault(value))throw Error(`${value.error}: a picker source cannot be calculated.`);
        return{row:r,value:String(value??''),binding:{table:t!.id,row:r,column:c!.id}};
      });
      const items=choices.map((choice,i)=>({...choice,i})).filter(x=>x.value&&x.value.toLowerCase().includes(search.value.toLowerCase())).slice(0,150);
      results.innerHTML=items.map(x=>`<button data-record="${x.row}"><span>${esc(x.value)}</span><small>${esc(derived?.name??t!.name)} / record ${x.i+1} / ${x.row.slice(0,8)}</small></button>`).join('')||'<p>No matching records.</p>';
      results.querySelectorAll<HTMLButtonElement>('[data-record]').forEach(el=>el.onclick=()=>link(items.find(x=>x.row===el.dataset.record)!.binding));
      }catch(e){results.textContent=String(e);}
    };
    const validation=s.validations.find(v=>v.rows.includes(s.rows[selected.r].id)&&v.columns.includes(column));
    if(validation){
      try{
        const ast=validation.source.startsWith('{')?JSON.parse(validation.source):compile(validation.source,book,s.id,s.rows[selected.r].id,column);
        const reference=validationReference(book,ast,validation.sheet);
        if(reference){
          const choices=referenceChoices(book,reference),extra=document.createElement('div');extra.className='validation-values';
          extra.innerHTML=`<p>${esc(reference.name)} / linked choices</p>${choices.slice(0,150).map((choice,i)=>`<button data-choice="${i}">${esc(choice.value)} / ${choice.row.slice(0,6)}</button>`).join('')}`;
          extra.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach(button=>button.onclick=()=>link(choices[Number(button.dataset.choice)].binding,reference.kind==='derived'?`ref:${reference.id}`:`${reference.table}:${reference.column}`));
          results.after(extra);
        }else{
        const evaluated=validation.values??flatten(engine.evaluate(ast,s.id,s.rows[selected.r].id,column));
        const failed=evaluated.find(isFault);
        if(failed&&isFault(failed))throw Error(`${failed.error}: dropdown source is unavailable. Its original reference is preserved; choose a source explicitly instead.`);
        const list=evaluated.filter(x=>x!=null).map(String);
        const extra=document.createElement('div');extra.className='validation-values';extra.innerHTML=`<p>Configured validation list (text values)</p>${list.slice(0,100).map(v=>`<button>${esc(v)}</button>`).join('')}`;
        extra.querySelectorAll('button').forEach(el=>el.onclick=()=>{applyInput(el.textContent??'');d.close();});results.after(extra);
        }
      }catch(e){const p=document.createElement('p');p.textContent=`Validation source could not be calculated: ${String(e)}`;results.after(p);}
    }
    select.onchange=draw;search.oninput=draw;draw();search.focus();
  });
}
function openFind():void {
  dialog('Find & replace',`<div class="button-row"><button id="find-tab" class="primary">Find</button><button id="replace-tab">Replace</button></div><label>Find text<input id="find-text" type="search"></label><label id="replace-label" hidden>Replace with<input id="replace-text"></label><fieldset><legend>Search sheets</legend>${book.sheets.map(s=>`<label class="inline"><input type="checkbox" name="scope" value="${s.id}" ${s.id===sheetId?'checked':''}>${esc(s.name)}</label>`).join('')}</fieldset><p class="muted">Searches literal text and rendered values. Replace only changes literal text, never formula source or linked records.</p><button id="replace-all" hidden>Replace all literal matches</button><div id="find-results" class="picker-results"></div>`,d=>{
    const input=d.querySelector<HTMLInputElement>('#find-text')!,results=d.querySelector('#find-results')!;
    let matches:{s:Sheet;r:number;c:number}[]=[];
    const draw=()=>{
      const scope=[...d.querySelectorAll<HTMLInputElement>('input[name=scope]:checked')].map(e=>e.value),query=input.value.toLowerCase();matches=[];
      if(query)for(const s of book.sheets.filter(s=>scope.includes(s.id)))for(const [k,cell]of Object.entries(s.cells)){const [rid,cid]=k.split(':'),r=s.rows.findIndex(r=>r.id===rid),c=s.columns.findIndex(c=>c.id===cid);if(r>=0&&c>=0&&cellText(cell,s,r,c).toLowerCase().includes(query))matches.push({s,r,c});}
      results.innerHTML=`<p>${matches.length} matches</p>`+matches.slice(0,200).map((m,i)=>`<button data-match="${i}">${esc(m.s.name)} / ${letters(m.c)}${m.r+1}<small>${esc(cellText(getCell(m.s,m.s.rows[m.r].id,m.s.columns[m.c].id),m.s,m.r,m.c))}</small></button>`).join('');
      results.querySelectorAll<HTMLButtonElement>('[data-match]').forEach(el=>el.onclick=()=>{const m=matches[Number(el.dataset.match)];sheetId=m.s.id;selected={r:m.r,c:m.c};anchor={...selected};selectionKind='cells';scrollTarget=m.r;page=Math.floor(m.r/60);render();d.close();});
    };
    input.oninput=draw;d.querySelectorAll('input[name=scope]').forEach(e=>e.addEventListener('change',draw));
    d.querySelector<HTMLButtonElement>('#replace-tab')!.onclick=()=>{d.querySelector<HTMLElement>('#replace-label')!.hidden=false;d.querySelector<HTMLElement>('#replace-all')!.hidden=false;};
    d.querySelector<HTMLButtonElement>('#find-tab')!.onclick=()=>{d.querySelector<HTMLElement>('#replace-label')!.hidden=true;d.querySelector<HTMLElement>('#replace-all')!.hidden=true;};
    d.querySelector<HTMLButtonElement>('#replace-all')!.onclick=()=>{
      if(!input.value)return;
      const value=d.querySelector<HTMLInputElement>('#replace-text')!.value,q=input.value;
      mutate('Replace literal text',()=>{for(const m of matches){const cell=getCell(m.s,m.s.rows[m.r].id,m.s.columns[m.c].id);if(!cell.formula&&!cell.binding&&typeof cell.value==='string'){
        const t=book.tables.find(t=>t.sheet===m.s.id&&t.header===m.s.rows[m.r].id&&t.columns.some(c=>c.column===m.s.columns[m.c].id));
        const next=cell.value.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),()=>value);
        if(t)renameColumn(book,t,t.columns.find(c=>c.column===m.s.columns[m.c].id)!.id,next);else m.s.cells[key(m.s.rows[m.r].id,m.s.columns[m.c].id)]={...cell,value:next};
      }}});draw();
    };input.focus();
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
  const s=sheet(),b=bounds(),kind=structural?selectionKind:'cells';
  mutate(kind==='rows'?'Delete rows':kind==='columns'?'Delete columns':'Clear cells',()=>{
    if(kind==='rows'){
      if(b.r2-b.r1+1===s.rows.length)throw Error('Keep at least one row.');
      deleteRows(book,s,s.rows.slice(b.r1,b.r2+1).map(r=>r.id));
      selected={r:Math.min(b.r1,s.rows.length-1),c:s.columns.length-1};anchor={r:selected.r,c:0};
    }else if(kind==='columns'){
      if(b.c2-b.c1+1===s.columns.length)throw Error('Keep at least one column.');
      for(const c of s.columns.slice(b.c1,b.c2+1))deleteColumn(book,s,c.id);
      selected={r:s.rows.length-1,c:Math.min(b.c1,s.columns.length-1)};anchor={r:0,c:selected.c};
      renderedTarget=`${sheetId}:${selected.r}`;
    }else eachSelected((s,r,c)=>{
      if(book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[r].id&&t.columns.some(x=>x.column===s.columns[c].id)))throw Error('Rename table headers explicitly.');
      setInput(book,s,s.rows[r].id,s.columns[c].id,'');
    });
  });
}
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||e.keyCode===229)return;
  if(!book||document.querySelector('dialog[open]'))return;
  if(busy)return;
  const target=e.target as HTMLElement,editing=['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void manualSave();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();openFind();return;}
  if(editing)return;
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key.toLowerCase()==='c')return;
  if(mod&&['z','y','a'].includes(e.key.toLowerCase())){
    e.preventDefault();void action(e.key.toLowerCase()==='z'?(e.shiftKey?'redo':'undo'):e.key.toLowerCase()==='y'?'redo':'select-all');return;
  }
  if(e.key==='Escape'){copied=undefined;movingColumns=undefined;render();return;}
  if(e.key==='Enter'||e.key==='F2'){e.preventDefault();syncDraft(inputText(current()),true);return;}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.key)){
    e.preventDefault();selected.r=Math.max(0,Math.min(sheet().rows.length-1,selected.r+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)));
    selected.c=Math.max(0,Math.min(sheet().columns.length-1,selected.c+(e.key==='ArrowRight'||e.key==='Tab'?1:e.key==='ArrowLeft'?-1:0)));
    if(!e.shiftKey||selectionKind!=='cells')anchor={...selected};selectionKind='cells';page=Math.floor(selected.r/60);render();return;
  }
  if((e.key==='Delete'||e.key==='Backspace')&&!mod&&!e.altKey){e.preventDefault();deleteSelection(e.key==='Delete');}
  else if(e.key.length===1&&!mod&&!e.altKey){syncDraft(e.key,true);e.preventDefault();}
});
document.addEventListener('paste',e=>{
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)||document.querySelector('dialog[open]'))return;
  const text=e.clipboardData?.getData('text/plain');if(!text)return;e.preventDefault();
  if(e.clipboardData?.getData('application/x-fnt-copy')===clipboardId&&copied){pasteCells();return;}
  mutate('Paste text',()=>{const rows=parseTsv(text),s=sheet();rows.forEach((row,i)=>row.forEach((v,j)=>{if(!s.rows[selected.r+i]||!s.columns[selected.c+j])throw Error('Paste exceeds sheet dimensions.');if(book.tables.some(t=>t.sheet===s.id&&t.header===s.rows[selected.r+i].id&&t.columns.some(c=>c.column===s.columns[selected.c+j].id)))throw Error('Rename table headers explicitly.');setInput(book,s,s.rows[selected.r+i].id,s.columns[selected.c+j].id,v);}));});
});
document.addEventListener('cut',e=>{
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)||document.querySelector('dialog[open]'))return;
  if(!commitDraft())return;e.preventDefault();copyCells(true);
  e.clipboardData?.setData('application/x-fnt-copy',clipboardId);
  const s=sheet(),b=bounds();e.clipboardData?.setData('text/plain',serializeTsv(s.rows.slice(b.r1,b.r2+1).map((r,i)=>s.columns.slice(b.c1,b.c2+1).map((c,j)=>cellText(getCell(s,r.id,c.id),s,b.r1+i,b.c1+j)))));
});
document.addEventListener('copy',e=>{
  if(!book||['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName))return;
  copyCells();const s=sheet(),b=bounds();e.clipboardData?.setData('text/plain',serializeTsv(s.rows.slice(b.r1,b.r2+1).map((_,i)=>s.columns.slice(b.c1,b.c2+1).map((_,j)=>cellText(getCell(s,s.rows[b.r1+i].id,s.columns[b.c1+j].id),s,b.r1+i,b.c1+j)))));
  e.clipboardData?.setData('application/x-fnt-copy',clipboardId);e.preventDefault();
});
window.addEventListener('beforeunload',e=>{if(generation!==savedGeneration||draft!==undefined){e.preventDefault();e.returnValue='Unsaved workbook edits';}});
window.addEventListener('resize',()=>drawRowWindow?.());
window.addEventListener('online',()=>{if(state?.sync){status='Online - use Save to sync pending changes';renderStatus();}});
window.addEventListener('offline',()=>{status='Offline - local autosave remains available';renderStatus();});
channel?.addEventListener('message',e=>{if(state&&e.data.version>state.version){error='Another tab saved newer changes. Download a backup of this tab before reloading; further saves are blocked by revision checks.';renderStatus();}});
async function start():Promise<void> {
  root.innerHTML='<main class="startup"><p>Opening your local workbook...</p></main>';
  try{
    store=await Store.open();const loaded=await store.load();
    if(loaded){
      state=loaded;book=clone(state.book);
      if(!book.catalogMigrations?.includes(dropdownCatalog.id)){
        const before=await store.backup(state),result=seedDropdownCatalog(book,await verifiedCatalogOrigins(before));
        if(result.changed){
          state=await store.save(result.book,state.version,'Add original Dropdowns catalogs',true,undefined,{recoveryArchive:stringifyArchive(before)});
          book=clone(state.book);
          // Undo also records the user's choice not to seed these catalogs again.
          undo.push({book:{...clone(before.state.book),catalogMigrations:book.catalogMigrations}});
          channel?.postMessage({version:state.version});
        }
      }
    }else{book=seedDropdownCatalog(createDemo()).book;state=await store.save(book,0,'Create starter workbook with original Dropdowns catalogs');}
    let remembered:string|null=null;try{remembered=sessionStorage.getItem('fnt-current-sheet');}catch(e){error=`Selected-tab preference unavailable: ${String(e)}`;}
    engine=new Engine(book);sheetId=book.sheets.some(s=>s.id===remembered)?remembered!:book.sheets[0].id;status=state.sync?`Saved locally - ${state.pending.length} pending changes`:'Saved in this browser';render();
    if('serviceWorker'in navigator&&import.meta.env.PROD)void navigator.serviceWorker.register('./sw.js').catch(e=>{flash(`Offline app cache failed: ${String(e)}`);});
  }catch(e){root.innerHTML=`<main class="startup"><h1>Local storage could not open</h1><p>${esc(String(e))}</p><p>No edits were made. Enable browser storage and reload. Do not clear existing site data if it contains your workbook.</p></main>`;}
}
void start();
