import { displayFormula } from './formula';
import { addReferenceValue,createReference,moveReferenceValue,referenceChoices,referenceTable,referenceUsages,removeReferenceValue,renameReferenceValue,setDerivedSource,unitsSource,upsertConversion } from './references';
import { getCell,move,type ReferenceSource,type Workbook } from './model';

export interface ReferenceHost {
  book:()=>Workbook;esc:(value:unknown)=>string;mutate:(label:string,fn:()=>void)=>boolean;
  dialog:(title:string,html:string,mount?:(d:HTMLDialogElement)=>void)=>HTMLDialogElement;
  askText:(title:string,value:string,fn:(value:string)=>void)=>void;
  confirm:(title:string,detail:string,fn:()=>void)=>void;
  importSource:(file?:File)=>Promise<void>;bind:(source:ReferenceSource)=>void;openSheet:(id:string)=>void;
}
export function openReferenceManager(host:ReferenceHost,id?:string,notice=''):void{
  const b=host.book(),esc=host.esc,sources=b.references??[],source=sources.find(s=>s.id===id)??sources[0];
  const d=host.dialog('Lists & conversions',`<p id="reference-notice" role="status">${esc(notice)}</p><div class="button-row"><button id="new-list">New list</button><button id="new-rules">New conversions</button><button id="new-derived">New derived list</button></div><label>Source<select id="reference-source"><option value="">Choose a source</option>${sources.map(s=>`<option value="${s.id}" ${s===source?'selected':''}>${esc(s.name)}${s.archived?' (archived)':''}</option>`).join('')}</select></label>${source?`<div class="button-row"><button id="reference-rename">Rename</button><button id="reference-up">Earlier</button><button id="reference-down">Later</button><button id="reference-archive">${source.archived?'Unarchive source':'Archive source'}</button><button id="reference-usage">Used by</button>${source.kind!=='conversions'?'<button id="reference-bind">Use for selected cells</button>':''}${source.table?'<button id="reference-backing">Backing sheet</button>':''}</div>`:''}<div id="reference-content"></div><hr><div class="button-row"><button id="import-attached-references" ${b.importReport?.originalId?'':'disabled'}>Import attached Excel sources</button><label>Import supporting data from local Excel<input id="import-references" type="file" accept=".xlsx"></label></div><p class="muted">Local only, with a full pre-import recovery archive. Existing logs and Ingredients stay intact. Linked choices follow renames; manual text stays manual. Archived options remain available to old links/formulas, but not new selections.</p>`);
  const content=d.querySelector<HTMLElement>('#reference-content')!;
  const change=(label:string,fn:()=>void,next=id??source?.id)=>{
    let failure:unknown;
    const ok=host.mutate(label,()=>{try{fn();}catch(e){failure=e;throw e;}});
    openReferenceManager(host,next,ok?'':failure instanceof Error?failure.message:'The change could not be saved. Check the workbook error.');
  };
  d.querySelector<HTMLSelectElement>('#reference-source')!.onchange=e=>openReferenceManager(host,(e.target as HTMLSelectElement).value);
  for(const [button,kind,title]of [['new-list','list','New list'],['new-rules','conversions','New conversions'],['new-derived','derived','New derived list']] as const){
    d.querySelector<HTMLButtonElement>('#'+button)!.onclick=()=>host.askText(title,'',name=>{
      let next:string|undefined;const ok=host.mutate(title,()=>{const created=createReference(host.book(),name,kind);next=created.id;if(kind==='conversions')unitsSource(host.book());});openReferenceManager(host,ok?next:source?.id,ok?'':'Creation failed; check the workbook error.');
    });
  }
  d.querySelector<HTMLButtonElement>('#import-attached-references')!.onclick=()=>{void host.importSource();};
  d.querySelector<HTMLInputElement>('#import-references')!.onchange=e=>{const file=(e.target as HTMLInputElement).files?.[0];if(file)void host.importSource(file);};
  if(!source){content.innerHTML='<p>Create a list, or import the original supporting sources. No examples are substituted for missing Excel data.</p>';return;}
  d.querySelector<HTMLButtonElement>('#reference-rename')!.onclick=()=>host.askText('Reference name',source.name,name=>change('Rename reference',()=>{
    if(!name.trim()||sources.some(s=>s.id!==source.id&&s.name.toLowerCase()===name.trim().toLowerCase()))throw Error('Use a nonempty, unique name.');
    source.name=name.trim();
  }));
  for(const [selector,delta]of [['#reference-up',-1],['#reference-down',1]] as const)d.querySelector<HTMLButtonElement>(selector)!.onclick=()=>change('Reorder reference sources',()=>move(sources,sources.indexOf(source),sources.indexOf(source)+delta));
  d.querySelector<HTMLButtonElement>('#reference-archive')!.onclick=()=>change('Archive reference source',()=>{source.archived=!source.archived;});
  d.querySelector<HTMLButtonElement>('#reference-usage')!.onclick=()=>{
    try{const u=referenceUsages(b,source);d.querySelector('#reference-notice')!.textContent=`Used by ${u.linked} exact links, ${u.formulas} formula/name expressions and ${u.dropdowns} linked dropdown sources. Text lookups can recalculate; existing numeric values are not frozen.`;}
    catch(e){d.querySelector('#reference-notice')!.textContent=String(e);}
  };
  const bind=d.querySelector<HTMLButtonElement>('#reference-bind');if(bind)bind.onclick=()=>host.bind(source);
  const backing=d.querySelector<HTMLButtonElement>('#reference-backing');if(backing)backing.onclick=()=>{try{host.openSheet(referenceTable(b,source).sheet.id);d.close();}catch(e){d.querySelector('#reference-notice')!.textContent=String(e);}};
  const remove=(row:string)=>{
    try{
      const usage=referenceUsages(b,source,row),choices=referenceChoices(b,source,true).filter(o=>o.row!==row&&!source.archivedRows.includes(o.row)),blocked=!!(usage.formulas||usage.manual);
      host.dialog('Remove reference option',`<p>${usage.linked} linked cells, ${usage.formulas} formula/name usages, ${usage.dropdowns} dropdown sources, and ${usage.manual} matching manual strings. ${blocked?'Archive is safest: text/formula lookups cannot be silently retargeted.':''}</p><select id="replacement"><option value="">No replacement</option>${choices.map((o,i)=>`<option value="${o.row}">${esc(o.value)} / ${i+1} / ${o.row.slice(0,8)}</option>`).join('')}</select><div class="button-row"><button id="archive-option">Archive</button><button id="delete-option" ${blocked?'disabled':''}>${usage.linked?'Replace links & delete':'Delete'}</button><button id="cancel-option">Cancel</button></div>`,confirm=>{
        confirm.querySelector<HTMLButtonElement>('#archive-option')!.onclick=()=>change('Archive reference option',()=>{if(!source.archivedRows.includes(row))source.archivedRows.push(row);});
        confirm.querySelector<HTMLButtonElement>('#delete-option')!.onclick=()=>change('Delete reference option',()=>removeReferenceValue(b,source,row,confirm.querySelector<HTMLSelectElement>('#replacement')!.value||undefined));
        confirm.querySelector<HTMLButtonElement>('#cancel-option')!.onclick=()=>openReferenceManager(host,source.id);
      });
    }catch(e){d.querySelector('#reference-notice')!.textContent=String(e);}
  };
  if(source.kind==='derived'){
    const selected=b.tables.find(t=>t.id===source.derived?.table);
    content.innerHTML=`<form id="derived-form"><label>Source table<select id="derived-table" required><option value="">${selected?'Choose a source':'Original source unavailable - choose explicitly'}</option>${b.tables.map(t=>`<option value="${t.id}" ${t===selected?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>Value field<select id="derived-column" required></select></label><label>Filter field<select id="derived-filter"></select></label><label>Equals<input id="derived-equals" value="${esc(source.derived?.filter?.value??'TRUE')}"></label><button class="primary">Save connection</button></form><p id="derived-status"></p><p class="muted">${esc(source.origin?.definition??'Generated choices stay linked to their original source records.')}${source.deferredNames?.length?` ${source.deferredNames.length} original sheet-scoped definitions are preserved until their owning sheets are imported.`:''}</p>`;
    const table=content.querySelector<HTMLSelectElement>('#derived-table')!,field=content.querySelector<HTMLSelectElement>('#derived-column')!,filter=content.querySelector<HTMLSelectElement>('#derived-filter')!;
    const fields=()=>{const t=b.tables.find(t=>t.id===table.value);field.innerHTML=(t?.columns??[]).map(c=>`<option value="${c.id}" ${c.id===source.derived?.column?'selected':''}>${esc(c.name)}</option>`).join('');filter.innerHTML='<option value="">No filter</option>'+(t?.columns??[]).map(c=>`<option value="${c.id}" ${c.id===source.derived?.filter?.column?'selected':''}>${esc(c.name)}</option>`).join('');};table.onchange=fields;fields();
    content.querySelector<HTMLFormElement>('form')!.onsubmit=e=>{e.preventDefault();const raw=content.querySelector<HTMLInputElement>('#derived-equals')!.value,value=raw==='TRUE'?true:raw==='FALSE'?false:raw.trim()!==''&&Number.isFinite(Number(raw))?Number(raw):raw;change('Connect derived list',()=>setDerivedSource(b,source,table.value,field.value,filter.value||undefined,value));};
    try{const choices=referenceChoices(b,source);content.querySelector('#derived-status')!.textContent=`Live: ${choices.length} choices.`;}catch(e){content.querySelector('#derived-status')!.textContent=String(e);}
    return;
  }
  if(source.kind==='conversions'){
    const units=b.references?.find(s=>s.kind==='units'&&!s.archived);
    if(!units){content.textContent='Create or unarchive the Units list before editing conversion rules.';return;}
    const choices=referenceChoices(b,units,true),{table,sheet}=referenceTable(b,source),roles=source.conversion;
    if(!roles){content.textContent='Conversion field bindings are missing. Restore their original identities.';return;}
    const from=table.columns.find(c=>c.id===roles.from)!,to=table.columns.find(c=>c.id===roles.to)!,factor=table.columns.find(c=>c.id===roles.factor)!;
    const rule=(row?:string)=>{
      const selection=(column:string)=>row?getCell(sheet,row,column).binding?.row:undefined;
      const options=(chosen?:string)=>'<option value="">Choose unit</option>'+choices.filter(o=>!units.archivedRows.includes(o.row)||o.row===chosen).map(o=>`<option value="${o.row}" ${o.row===chosen?'selected':''}>${esc(o.value)} / ${o.row.slice(0,6)}</option>`).join('');
      const cell=row?getCell(sheet,row,factor.column):{},text=cell.formula?cell.original??displayFormula(cell.formula,b):cell.value??'';
      return `<form class="conversion-rule ${row&&source.archivedRows.includes(row)?'archived':''}" data-rule="${row??''}"><select aria-label="From unit" required>${options(selection(from.column))}</select><select aria-label="To unit" required>${options(selection(to.column))}</select><input aria-label="Conversion factor" value="${esc(text)}" placeholder="Factor or formula" required><button>${row?'Save':'Add rule'}</button>${row?source.archivedRows.includes(row)?`<button type="button" data-unarchive="${row}">Unarchive</button>`:`<button type="button" data-remove="${row}">Remove</button>`:''}</form>`;
    };
    content.innerHTML='<p class="muted">Universal unit-to-unit rules only. Ingredient-specific scoops/servings use that ingredient’s Serving (g) and Conversion Amount. Factor changes can recalculate historical records; confirmation is required when referenced. Archived rules remain visible to legacy formulas.</p>'+table.rows.map(row=>rule(row)).join('')+rule();
    content.querySelectorAll<HTMLFormElement>('.conversion-rule').forEach(form=>form.onsubmit=e=>{
      e.preventDefault();const selects=form.querySelectorAll('select'),row=form.dataset.rule||undefined,text=form.querySelector('input')!.value,apply=()=>change('Edit conversion rule',()=>upsertConversion(b,source,row,selects[0].value,selects[1].value,text,true));
      const usage=referenceUsages(b,source);
      if(row&&(usage.formulas||usage.linked))host.confirm('Recalculate affected records?',`${usage.formulas} formula/source and ${usage.linked} linked usages may update, including historical records. This does not freeze historical values.`,apply);else apply();
    });
    content.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button=>button.onclick=()=>remove(button.dataset.remove!));
    content.querySelectorAll<HTMLButtonElement>('[data-unarchive]').forEach(button=>button.onclick=()=>change('Unarchive conversion rule',()=>{source.archivedRows=source.archivedRows.filter(row=>row!==button.dataset.unarchive);}));
    return;
  }
  try{
    const choices=referenceChoices(b,source,true,true);
    content.innerHTML=choices.map((o,i)=>`<div class="reference-option ${source.archivedRows.includes(o.row)?'archived':''}"><input data-value="${o.row}" aria-label="List value ${i+1}" value="${esc(o.value)}"><button data-up="${o.row}" aria-label="Move option ${i+1} earlier">&uarr;</button><button data-down="${o.row}" aria-label="Move option ${i+1} later">&darr;</button><button data-archive="${o.row}">${source.archivedRows.includes(o.row)?'Unarchive':'Archive'}</button><button data-remove="${o.row}">Remove</button></div>`).join('')+'<form id="add-reference-value"><input aria-label="New list value" required><button>Add value</button></form>';
    content.querySelectorAll<HTMLInputElement>('[data-value]').forEach(input=>input.onchange=()=>{
      let failure:unknown;
      if(!host.mutate('Rename reference option',()=>{try{renameReferenceValue(b,source,input.dataset.value!,input.value);}catch(e){failure=e;throw e;}}))openReferenceManager(host,source.id,failure instanceof Error?failure.message:'The edit could not be saved.');
    });
    for(const[key,direction]of[['up',-1],['down',1]] as const)content.querySelectorAll<HTMLButtonElement>(`[data-${key}]`).forEach(button=>button.onclick=()=>change('Reorder reference option',()=>moveReferenceValue(b,source,button.dataset[key]!,direction)));
    content.querySelectorAll<HTMLButtonElement>('[data-archive]').forEach(button=>button.onclick=()=>change('Archive reference option',()=>{const row=button.dataset.archive!;source.archivedRows=source.archivedRows.includes(row)?source.archivedRows.filter(r=>r!==row):[...source.archivedRows,row];}));
    content.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button=>button.onclick=()=>remove(button.dataset.remove!));
    content.querySelector<HTMLFormElement>('#add-reference-value')!.onsubmit=e=>{e.preventDefault();change('Add reference option',()=>addReferenceValue(b,source,content.querySelector<HTMLInputElement>('#add-reference-value input')!.value));};
  }catch(e){content.textContent=String(e);}
}
