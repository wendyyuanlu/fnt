import {type Workbook} from './model';
import {nutritionReference,type NutritionBatch,type NutritionTarget} from './food-capture';
import {mealLogContext} from './meal-log';
import {converterSignature,prepareNutritionApply,type ConverterReceipt} from './nutrition-apply';
import {toolbarIcon} from './icons';
import {mountSelectDropdown} from './dropdown-ui';
import {converterFields,converterLabels,mapNutritionTable,parseNutritionTable,type ConverterField} from './nutrition-table';
import {converterReview,newConverterState,remapConverterTable,reviewNutritionTable,selectedNutritionItems,type ConverterReview,type ConverterState} from './nutrition-converter';
import './nutrition-converter.css';

export interface ConverterPanelHost{
  book:()=>Workbook;state:()=>ConverterState|undefined;
  stage?:(next:ConverterState)=>void;
  change:(next:ConverterState)=>Promise<void>;
  apply:(review:ConverterReview)=>Promise<unknown>;
  receipts?:()=>readonly ConverterReceipt[];
  sourceVersion?:()=>string|number;
  error:(error:unknown)=>void;
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function mountConverterPanel(host:ConverterPanelHost){
  const element=document.createElement('section'),controller=new AbortController();
  element.className='capture-pane nutrition-converter';element.setAttribute('aria-label','Nutrition table converter');
  element.innerHTML=`<header class="capture-toolbar"><h2>Table converter</h2><button type="button" class="icon-button" data-convert="retry-save" aria-label="Retry saving review" title="Retry saving review">${toolbarIcon('redo')}</button></header><div class="capture-foods"><label class="meal-log-field"><span>Conversion mode</span><select data-convert-mode><option value="tracked">Tracked nutrition response</option><option value="untracked">Untracked table review only</option></select></label><p class="muted" data-mode-help></p><label class="meal-log-field"><span>Paste the complete nutrition response</span><textarea rows="8" data-convert-source aria-label="Nutrition response" placeholder="Batch ID: …&#10;Item ID | Dish Name | Calories (kcal) | …"></textarea></label><div class="button-row"><button type="button" data-convert="process">Process table</button></div><p data-convert-status role="status" class="muted"></p><div data-convert-error class="capture-original bad" role="alert"></div><details data-convert-mapping hidden><summary>Column mapping</summary><div data-mapping-fields></div><button type="button" data-convert="remap">Rebuild mapped review (replaces edits)</button></details><div data-convert-review hidden><label class="meal-log-field"><span>Response Batch ID</span><input data-convert-batch aria-label="Response Batch ID"></label><label class="inline"><input type="checkbox" data-convert-description>Remove final parenthetical description (reversible)</label><p class="muted">Only the displayed name is shortened. The original response and removed text remain in the applied receipt; no Description column is created.</p><h3>Editable table preview</h3><div class="nutrition-converter-table" tabindex="0" aria-label="Editable nutrition table; scroll horizontally"><table class="spreadsheet-grid"><thead><tr>${converterFields.map(field=>`<th scope="col">${esc(converterLabels[field])}</th>`).join('')}</tr></thead><tbody data-convert-table></tbody></table></div><nav class="capture-toolbar" aria-label="Review pages"><button type="button" class="icon-button" data-convert="previous" aria-label="Previous review rows" title="Previous review rows">${toolbarIcon('previous')}</button><span data-convert-count></span><button type="button" class="icon-button" data-convert="next" aria-label="Next review rows" title="Next review rows">${toolbarIcon('next')}</button></nav><h3>Review each route</h3><div data-convert-cards></div><div data-convert-missing></div></div><div data-convert-linked></div><p data-convert-issues role="status" class="capture-original"></p><footer class="capture-footer"><button type="button" class="primary" data-convert="apply" disabled>Apply reviewed nutrition</button></footer></div>`;
  element.querySelector<HTMLElement>('.capture-footer')!.insertAdjacentHTML('afterbegin','<button type="button" data-convert="validate">Validate write-back preview</button>');
  element.querySelector<HTMLElement>('.capture-footer')!.insertAdjacentHTML('beforebegin','<div data-write-preview class="capture-original"></div>');
  let state=structuredClone(host.state()??newConverterState(host.book().foodCapture?.builder?.id)),page=0,pending=0,applying=false,saveError='',operationError='',disposed=false,previewSignature='',previewVersion:string|number=-1;
  let chain=Promise.resolve(),queuedSave:{state:ConverterState;version:number;generation:number}|undefined,saveVersion=0,generation=0,renderedVersion:string|number|undefined;
  const dropdownPrefix='nutrition-converter-'+crypto.randomUUID(),dropdowns=new Map<HTMLSelectElement,ReturnType<typeof mountSelectDropdown>>();
  const refreshDropdowns=()=>{
    for(const [select,control]of dropdowns){
      if(!element.contains(select)){control.close();dropdowns.delete(select);}
      else{if(select.disabled)control.close();control.refresh();}
    }
    for(const select of element.querySelectorAll<HTMLSelectElement>('select')){
      if(dropdowns.has(select))continue;
      const identity=select.hasAttribute('data-convert-mode')?'mode':select.dataset.map!==undefined?'mapping-'+select.dataset.map:select.dataset.targetId?'destination-'+select.dataset.targetId:'manual-'+select.dataset.linkedManual;
      select.id=dropdownPrefix+'-'+encodeURIComponent(identity);
      if(!select.hasAttribute('aria-label'))select.setAttribute('aria-label',select.hasAttribute('data-convert-mode')?'Conversion mode':'Converter choice');
      dropdowns.set(select,mountSelectDropdown(select));
    }
  };
  const source=element.querySelector<HTMLTextAreaElement>('[data-convert-source]')!;
  const batch=():NutritionBatch|undefined=>host.book().foodCapture?.builder;
  const message=(error:unknown)=>error instanceof Error?error.message:String(error);
  const currentReview=()=>converterReview(state);
  const sourceVersion=()=>host.sourceVersion?.()??host.book().revision;
  const issues=()=>{
    if(state.mode==='untracked')return['Untracked review cannot write into a tracked nutrition batch. No matching by name or position is performed.'];
    const current=batch();if(!current)return['Open a nutrition batch in the Prompt builder first.'];
    if(current.id!==state.batch)return['This saved review belongs to another batch. Resetting the builder never reuses a previous result.'];
    try{return reviewNutritionTable(current,currentReview()).issues.map(issue=>`${issue.item?issue.item+': ':''}${issue.message}`);}
    catch(error){return[message(error)];}
  };
  const updateStatus=()=>{
    if(disposed)return;
    const problems=issues();
    element.querySelector<HTMLElement>('[data-convert-status]')!.textContent=applying?'Applying and saving; do not retry until confirmed.':pending?'Saving review…':saveError?'Review not saved. Retry saving before applying.':state.status==='applied'?'Applied and saved.':!state.raw&&!state.parsed?'Edits save automatically.':'Review saved automatically.';
    element.querySelector<HTMLElement>('[data-convert-error]')!.textContent=[saveError,operationError].filter(Boolean).join('\n');
    element.querySelector<HTMLElement>('[data-convert-issues]')!.textContent=problems.join('\n');
    let signature='';try{signature=converterSignature(currentReview());}catch{}
    element.querySelector<HTMLButtonElement>('[data-convert="apply"]')!.disabled=!!problems.length||!!pending||!!saveError||applying||state.status==='applied'||!previewSignature||previewSignature!==signature||previewVersion!==sourceVersion();
    element.querySelector<HTMLButtonElement>('[data-convert="validate"]')!.disabled=!!problems.length||!!pending||!!saveError||applying||state.status==='applied';
    element.querySelector<HTMLButtonElement>('[data-convert="retry-save"]')!.disabled=!saveError||!!pending||applying;
    element.setAttribute('aria-busy',String(applying));
    for(const input of element.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select'))input.disabled=applying||state.status==='applied';
    for(const button of element.querySelectorAll<HTMLButtonElement>('[data-convert="process"],[data-convert="remap"]'))button.disabled=applying;
    refreshDropdowns();
  };
  const persist=()=>{
    const snapshot=structuredClone({...state,status:state.status==='applied'?'applied' as const:'editing' as const}),version=++saveVersion;
    try{host.stage?.(structuredClone(snapshot));}
    catch(error){saveError=`Could not stage converter review: ${message(error)}`;host.error(error);updateStatus();return;}
    queuedSave={state:snapshot,version,generation};
    if(pending){updateStatus();return;}
    pending=1;
    chain=(async()=>{
      while(queuedSave){
        const next=queuedSave;queuedSave=undefined;
        try{await host.change(next.state);if(next.generation===generation&&next.version===saveVersion)saveError='';}
        catch(error){if(next.generation===generation&&next.version===saveVersion){saveError=`Could not save converter review: ${message(error)}`;host.error(error);}}
      }
      pending=0;updateStatus();
    })();updateStatus();
  };
  const edit=()=>{
    state.status='editing';operationError='';previewSignature='';element.querySelector<HTMLElement>('[data-write-preview]')!.textContent='';persist();
  };
  const targets=()=>host.book().sheets.flatMap(sheet=>{
    try{const context=mealLogContext(host.book(),sheet);return[{sheet:sheet.id,table:context.table.id,label:`${sheet.name} / ${context.table.name}`}];}catch{return[];}
  });
  const targetControl=(id:string,target:NutritionTarget|undefined,linked=false)=>{
    const choice=(linked?state.linkedChoices:state.choices)[id];
    if(target)return`<p class="muted">Captured destination: ${esc(target.table)} (stable table identity).</p>`;
    return`<label class="meal-log-field"><span>Choose an explicit destination for this legacy Draft</span><select data-target-id="${esc(id)}" ${linked?'data-linked-target':''} aria-label="Destination ${esc(id)}"><option value="">Choose destination</option>${targets().map(target=>`<option value="${esc(target.table)}" ${choice?.target?.table===target.table?'selected':''}>${esc(target.label)}</option>`).join('')}</select></label>`;
  };
  const render=()=>{
    if(disposed)return;
    renderedVersion=sourceVersion();
    if(document.activeElement!==source)source.value=state.raw;
    element.querySelector<HTMLSelectElement>('[data-convert-mode]')!.value=state.mode;
    element.querySelector<HTMLElement>('[data-mode-help]')!.textContent=state.mode==='tracked'?'Paste Batch ID plus every selected Item ID. Routes are fixed to captured sources, not a global destination.':'Separate untracked review: parsing and editing only. Applying to a nutrition batch is unavailable without its supplied IDs.';
    element.querySelector<HTMLElement>('[data-convert-review]')!.hidden=!state.parsed;
    element.querySelector<HTMLElement>('[data-convert-mapping]')!.hidden=!state.parsed;
    element.querySelector<HTMLInputElement>('[data-convert-description]')!.checked=state.removeDescription;
    element.querySelector<HTMLInputElement>('[data-convert-batch]')!.value=state.parsed?.batch??'';
    const mapping=element.querySelector<HTMLElement>('[data-mapping-fields]')!;
    mapping.innerHTML=state.parsed?.headers.map((header,index)=>`<label class="meal-log-field"><span>${esc(header)}</span><select data-map="${index}" aria-label="Map ${esc(header)}">${[...converterFields,'extra'].map(field=>`<option value="${field}" ${state.parsed!.mapping[index]===field?'selected':''}>${field==='extra'?'Retain as extra source field':esc(converterLabels[field as ConverterField])}</option>`).join('')}</select></label>`).join('')??'';
    page=Math.min(page,Math.max(0,Math.ceil(state.rows.length/30)-1));
    const rows=state.rows.slice(page*30,(page+1)*30),items=new Map(batch()?.items.map(item=>[item.id,item])??[]);
    const input=(index:number,field:ConverterField)=>`<input data-convert-row="${index}" data-convert-field="${field}" aria-label="Row ${index+1} ${esc(converterLabels[field])}" value="${esc(state.rows[index][field])}" ${field!=='id'&&field!=='name'&&field!=='unit'?'inputmode="decimal"':''}>`;
    element.querySelector<HTMLElement>('[data-convert-table]')!.innerHTML=rows.map((_,index)=>`<tr>${converterFields.map(field=>`<td>${input(page*30+index,field)}</td>`).join('')}</tr>`).join('');
    element.querySelector<HTMLElement>('[data-convert-count]')!.textContent=rows.length?`${page*30+1}–${page*30+rows.length} of ${state.rows.length}`:'No rows';
    element.querySelector<HTMLButtonElement>('[data-convert="previous"]')!.disabled=page===0;
    element.querySelector<HTMLButtonElement>('[data-convert="next"]')!.disabled=(page+1)*30>=state.rows.length;
    element.querySelector<HTMLElement>('[data-convert-cards]')!.innerHTML=rows.map((row,index)=>{
      const item=items.get(row.id),choice=state.choices[row.id];
      let reference='';if(item?.kind==='ingredient')try{reference=JSON.stringify(nutritionReference(item));}catch(error){reference=message(error);}
      const route=item?.kind==='ingredient'?`Update existing Ingredient ${item.reference?.table??'?'} / ${item.reference?.row??'?'}. Reference: ${reference}`:item?.kind==='logged'?`Update original logged row ${item.source.table??'?'} / ${item.source.row} on original day ${item.date??'?'}.`:item?`Create dated consumption for Draft ${item.source.row}${item.source.part?' / '+item.source.part:''} on day ${item.date??'?'}.`:'Unmatched row: fix Item ID before applying.';
      return`<article class="meal-log-card"><h4>${esc(row.id)} · ${esc(row.name)}</h4><p class="muted">${esc(route)}</p>${item?`<p class="capture-original">Original: ${esc(item.originalName)}${item.restaurant?'\nRestaurant: '+esc(item.restaurant):''}</p>`:''}${item?.kind==='draft'?targetControl(item.id,item.loggingTarget):''}<div class="meal-log-fields">${converterFields.map(field=>`<label class="meal-log-field"><span>${esc(converterLabels[field])}</span>${input(page*30+index,field)}</label>`).join('')}</div>${item?.kind==='ingredient'?`<label class="inline"><input type="checkbox" data-review-choice="referenceAcknowledged" data-review-id="${esc(row.id)}" ${choice?.referenceAcknowledged?'checked':''}>I verified ALL nutrients use the captured Ingredient reference, regardless of returned quantities.</label>`:''}<label class="inline"><input type="checkbox" data-review-choice="overwrite" data-review-id="${esc(row.id)}" ${choice?.overwrite?'checked':''}>Allow replacement of this request's existing nutrition values after review.</label></article>`;
    }).join('');
    for(const [index,card]of [...element.querySelectorAll<HTMLElement>('[data-convert-cards] article')].entries()){
      const row=rows[index],item=items.get(row.id);
      if(item?.kind==='logged')card.insertAdjacentHTML('beforeend',`<p class="muted">Captured consumption: ${esc(item.values.weight||'—')} g; ${esc(item.values.amount||'—')} ${esc(item.values.unit)}. Blank response quantity cells preserve these values.</p><label class="inline"><input type="checkbox" data-review-choice="quantityAcknowledged" data-review-id="${esc(row.id)}" ${state.choices[row.id]?.quantityAcknowledged?'checked':''}>I verified the nutrition describes the intended consumed portion and approve replacing its changed quantities.</label>`);
    }
    const seen=new Set(state.rows.map(row=>row.id)),missing=batch()?selectedNutritionItems(batch()!).filter(item=>!seen.has(item.id)):[];
    element.querySelector<HTMLElement>('[data-convert-missing]')!.innerHTML=missing.map(item=>`<label class="meal-log-field"><span>${esc(item.id)} · ${esc(item.name)}: reason for not applying this missing result</span><input data-missing-id="${esc(item.id)}" aria-label="Missing result reason ${esc(item.id)}" value="${esc(state.choices[item.id]?.missingReason??'')}"></label>`).join('');
    element.querySelector<HTMLElement>('[data-convert-linked]')!.innerHTML=(batch()?.linkedIntents??[]).filter(intent=>batch()!.days.includes(intent.date)).map(intent=>{
      const choice=state.linkedChoices[intent.key];
      return`<article class="meal-log-card"><h4>Linked Draft: ${esc(intent.values.food)}</h4><p class="capture-original">${esc(intent.key)}\nConsumed: ${esc(intent.values.weight||'—')} g; ${esc(intent.values.amount||'—')} ${esc(intent.values.unit)}\nRestaurant: ${esc(intent.restaurant||'None')}\n${esc(intent.values.notes??'')}</p><p class="muted">Updates the existing Ingredient at most once; this selected Draft becomes a real dated Logged row, retaining consumption and its Ingredient link. Only this captured Draft is logged.</p><label class="inline"><input type="checkbox" data-linked-id="${esc(intent.key)}" ${choice?.include?'checked':''}>Log this captured Draft on day ${intent.date}</label>${targetControl(intent.key,intent.target,true)}<label class="meal-log-field"><span>Manual macro conflict decision</span><select data-linked-manual="${esc(intent.key)}" aria-label="Manual overrides ${esc(intent.key)}"><option value="">Review if different</option><option value="keep" ${choice?.manual==='keep'?'selected':''}>Keep manual values</option><option value="reference" ${choice?.manual==='reference'?'selected':''}>Use refreshed Ingredient reference</option></select></label></article>`;
    }).join('');
    updateStatus();
  };
  element.addEventListener('paste',event=>{
    if(event.target!==source||!event.clipboardData)return;
    const text=event.clipboardData.getData('text/plain'),html=event.clipboardData.getData('text/html');
    if(!html)return;
    event.preventDefault();
    const start=source.selectionStart,end=source.selectionEnd,whole=start===0&&end===source.value.length||!source.value;
    source.setRangeText(text,start,end,'end');state.raw=source.value;state.html=whole?html:'';
    edit();
  },{signal:controller.signal});
  element.addEventListener('input',event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||applying||event instanceof InputEvent&&event.isComposing)return;
    let rerender=false;
    const selectionStart=input.selectionStart,selectionEnd=input.selectionEnd,cardInput=!!input.closest('[data-convert-cards]');
    if(input===source){state.raw=input.value;state.html='';}
    else if(input.hasAttribute('data-convert-batch')&&state.parsed)state.parsed.batch=input.value;
    else if(input.dataset.convertRow!==undefined&&input.dataset.convertField){
      const index=Number(input.dataset.convertRow),field=input.dataset.convertField as ConverterField,row=state.rows[index];if(!row)return;
      delete state.choices[row.id];row[field]=input.value;
      rerender=field==='id'||field==='name';
      for(const duplicate of element.querySelectorAll<HTMLInputElement>(`[data-convert-row="${index}"][data-convert-field="${field}"]`))if(duplicate!==input)duplicate.value=input.value;
      for(const choice of element.querySelectorAll<HTMLInputElement>('[data-review-choice]'))if(choice.dataset.reviewId===row.id)choice.checked=false;
    }else if(input.dataset.missingId){const id=input.dataset.missingId;state.choices[id]={...state.choices[id],missingReason:input.value};}
    else return;
    const index=input.dataset.convertRow,field=input.dataset.convertField;
    edit();
    if(rerender){
      render();
      const replacement=element.querySelector<HTMLInputElement>(`${cardInput?'[data-convert-cards]':'[data-convert-table]'} [data-convert-row="${index}"][data-convert-field="${field}"]`);
      replacement?.focus({preventScroll:true});if(selectionStart!==null&&selectionEnd!==null)replacement?.setSelectionRange(selectionStart,selectionEnd);
    }
  },{signal:controller.signal});
  element.addEventListener('compositionend',event=>event.target?.dispatchEvent(new InputEvent('input',{bubbles:true})),{signal:controller.signal});
  element.addEventListener('change',event=>{
    const input=event.target;if(applying)return;
    if(input instanceof HTMLSelectElement&&input.hasAttribute('data-convert-mode')){state.mode=input.value as ConverterState['mode'];edit();render();}
    else if(input instanceof HTMLSelectElement&&input.dataset.targetId){
      const choices=input.hasAttribute('data-linked-target')?state.linkedChoices:state.choices,id=input.dataset.targetId,target=targets().find(target=>target.table===input.value);
      choices[id]={...choices[id],target:target?{sheet:target.sheet,table:target.table}:undefined};edit();
    }else if(input instanceof HTMLSelectElement&&input.dataset.linkedManual){
      const id=input.dataset.linkedManual;state.linkedChoices[id]={...state.linkedChoices[id],manual:input.value==='keep'||input.value==='reference'?input.value:undefined};edit();
    }
    else if(input instanceof HTMLInputElement){
      if(input.hasAttribute('data-convert-description'))state.removeDescription=input.checked;
      else if(input.dataset.linkedId){const id=input.dataset.linkedId;state.linkedChoices[id]={...state.linkedChoices[id],include:input.checked};}
      else if(input.dataset.reviewChoice&&input.dataset.reviewId){
        const id=input.dataset.reviewId;state.choices[id]={...state.choices[id],[input.dataset.reviewChoice]:input.checked};
      }else return;
      edit();updateStatus();
    }
  },{signal:controller.signal});
  element.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[data-convert]'):null;
    if(!button||button.disabled||applying)return;event.stopPropagation();
    try{
      switch(button.dataset.convert){
        case'process':{
          const parsed=parseNutritionTable(state.raw,state.html);
          state={...state,parsed,rows:[],choices:{},processedRaw:state.raw,status:'editing'};page=0;
          try{state.rows=mapNutritionTable(parsed);}
          catch(error){edit();render();element.querySelector<HTMLDetailsElement>('[data-convert-mapping]')!.open=true;throw error;}
          edit();render();break;
        }
        case'remap':{
          const mapping=[...element.querySelectorAll<HTMLSelectElement>('[data-map]')].map(select=>select.value as ConverterField|'extra');
          state=remapConverterTable(state,mapping);edit();render();break;
        }
        case'previous':page--;render();break;
        case'next':page++;render();break;
        case'retry-save':persist();break;
        case'validate':{
          previewSignature='';
          const current=batch();if(!current)throw Error('Open the nutrition batch before validation.');
          const result=prepareNutritionApply(host.book(),current,currentReview(),host.receipts?.()??[]);
          element.querySelector<HTMLElement>('[data-write-preview]')!.textContent=result.alreadyApplied?'This exact operation was already saved. It will not be applied twice.':result.receipt.entries.map(entry=>`${entry.kind}: ${entry.key} → ${entry.target.table} / ${entry.target.row}\n${Object.entries(entry.values).map(([field,value])=>`${field}: ${value}`).join('; ')}${entry.kind==='draft'||entry.kind==='linked'?'\nThe captured Draft/part will be removed only after this row is saved.':''}`).join('\n\n');
          previewSignature=converterSignature(currentReview());previewVersion=sourceVersion();operationError='';updateStatus();break;
        }
        case'apply':{
          const review=currentReview();if(issues().length||pending||saveError)return;
          const applyingGeneration=generation;
          applying=true;operationError='';updateStatus();
          void host.apply(review).then(()=>{
            if(generation!==applyingGeneration||state.batch!==review.batch)return;
            state.status='applied';state.error=undefined;saveError='';operationError='';
          }).catch(error=>{
            if(generation!==applyingGeneration||state.batch!==review.batch)return;
            const staged=host.state();
            if(staged?.batch===state.batch&&staged.status==='applied'){
              state=structuredClone(staged);
              saveError=`Write-back is staged in memory but not saved: ${message(error)}. Keep this page open and retry saving the review; do not apply again.`;
              operationError='';
            }else{
              operationError=`Apply did not complete: ${message(error)}. Your review is preserved. Retry only after resolving the error.`;state.status='failed';
            }
            host.error(error);
          }).finally(()=>{applying=false;updateStatus();});break;
        }
      }
    }catch(error){operationError=message(error);host.error(error);updateStatus();}
  },{signal:controller.signal});
  render();
  return{element,refresh:()=>{
    const external=host.state(),activeBatch=batch()?.id;
    if(external&&external.batch!==state.batch&&external.batch===activeBatch){
      generation++;saveVersion++;queuedSave=undefined;state=structuredClone(external);saveError='';operationError='';previewSignature='';page=0;render();return;
    }
    if(!pending&&!saveError&&!applying){const next=host.state();if(next&&JSON.stringify(next)!==JSON.stringify(state)){state=structuredClone(next);previewSignature='';render();return;}}
    if(renderedVersion!==sourceVersion()){
      previewSignature='';
      element.querySelector<HTMLElement>('[data-write-preview]')!.textContent='Sources or batch requests changed. Validate the write-back preview again before applying.';
      render();return;
    }
    updateStatus();
  },dispose:()=>{disposed=true;controller.abort();for(const control of dropdowns.values())control.close();dropdowns.clear();},saved:()=>chain};
}
