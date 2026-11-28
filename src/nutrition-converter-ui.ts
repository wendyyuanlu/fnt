import {allTables,type Workbook} from './model';
import {nutrients,nutritionReference,type NutritionBatch,type NutritionTarget} from './food-capture';
import {mealLogContext} from './meal-log';
import {converterSignature,prepareNutritionApply,type ConverterReceipt} from './nutrition-apply';
import {toolbarIcon} from './icons';
import {dropdownArrowHtml,mountSelectDropdown} from './dropdown-ui';
import {excelDateText} from './dates';
import {converterFields,converterLabels,mapNutritionTable,parseNutritionTable,type ConverterField} from './nutrition-table';
import {converterReview,newConverterState,remapConverterTable,reviewNutritionTable,selectedNutritionItems,type ConverterReview,type ConverterState} from './nutrition-converter';
import {newStandaloneConverterState,preflightStandaloneImport,reviewStandaloneImport,remapStandaloneTable,standaloneDestinations,standaloneReview,standaloneSignature,standaloneTypeChoices,type StandaloneReceipt,type StandaloneReview} from './nutrition-converter-import';
import './nutrition-converter.css';

export interface ConverterPanelHost{
  book:()=>Workbook;state:()=>ConverterState|undefined;
  stage?:(next:ConverterState)=>void;
  change:(next:ConverterState)=>Promise<void>;
  apply:(review:ConverterReview)=>Promise<unknown>;
  receipts?:()=>readonly ConverterReceipt[];
  applyImport?:(review:StandaloneReview)=>Promise<unknown>;
  imports?:()=>readonly StandaloneReceipt[];
  sourceVersion?:()=>string|number;
  error:(error:unknown)=>void;
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const disclosureHeader=(label:string)=>`<summary class="dropdown-section-header"><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>${esc(label)}</span></summary>`;
const quantity=(values:{weight?:unknown;amount?:unknown;unit?:unknown})=>[values.weight!==undefined&&values.weight!==''?`${values.weight} g`:'',values.amount!==undefined&&values.amount!==''?`${values.amount} ${values.unit??''}`:''].filter(Boolean).join(' / ')||'Not supplied';
const day=(value:number|undefined)=>value===undefined?'date missing':excelDateText(value)??'date invalid';
export function mountConverterPanel(host:ConverterPanelHost){
  const element=document.createElement('section'),controller=new AbortController();
  element.className='capture-pane nutrition-converter';element.setAttribute('aria-label','Nutrition table converter');
  element.innerHTML=`<div class="capture-foods">
    <label class="meal-log-field converter-mode"><span>Conversion mode</span><select data-convert-mode aria-label="Conversion mode"><option value="tracked">Tracked nutrition response</option><option value="untracked">New table</option></select></label>
    <p class="muted converter-help" data-mode-help></p>
    <details class="converter-source dropdown-section" data-convert-source-panel open>${disclosureHeader('Paste table')}
      <label class="meal-log-field"><span>Nutrition response</span><textarea rows="6" data-convert-source aria-label="Nutrition response" placeholder="Paste a Markdown, CSV, tab-separated or copied HTML table"></textarea></label>
      <button type="button" data-convert="process">Process table</button>
    </details>
    <div data-standalone-target hidden><label class="meal-log-field"><span>Add to</span><select data-import-target aria-label="New table destination"></select></label><label class="meal-log-field" data-import-date-label hidden><span>Date</span><input type="date" data-import-date aria-label="Master date"></label></div>
    <div class="converter-save"><span data-convert-status role="status" class="muted"></span><button type="button" data-convert="retry-save" hidden>Retry saving review</button><button type="button" data-convert="new-table" hidden>New table</button></div>
    <div data-convert-error class="capture-original bad" role="alert" hidden></div>
    <section data-convert-review hidden aria-label="Review">
      <h3 data-preview-title>Review</h3>
      <div class="nutrition-converter-table" tabindex="0" aria-label="Editable nutrition table; scroll horizontally"><table class="spreadsheet-grid"><thead data-convert-head></thead><tbody data-convert-table></tbody></table></div>
      <nav class="converter-pages" data-convert-pages aria-label="Review pages" hidden><button type="button" class="icon-button" data-convert="previous" aria-label="Previous review rows" title="Previous review rows">${toolbarIcon('previous')}</button><span data-convert-count></span><button type="button" class="icon-button" data-convert="next" aria-label="Next review rows" title="Next review rows">${toolbarIcon('next')}</button></nav>
      <label class="inline"><input type="checkbox" data-convert-description>remove description</label>
      <p class="muted converter-help">Remove only the final parenthetical text from the saved name. Original names remain in the receipt.</p>
      <section data-route-section><h3>Write-back routes</h3><div data-convert-cards></div><div data-convert-missing></div></section>
      <details class="converter-details dropdown-section" data-convert-identities hidden>${disclosureHeader('Batch and Item IDs')}<label class="meal-log-field"><span>Response Batch ID</span><input data-convert-batch aria-label="Response Batch ID"></label><div data-item-identities></div></details>
    </section>
    <details class="converter-details dropdown-section" data-convert-mapping hidden>${disclosureHeader('Column mapping')}<div data-mapping-fields></div><button type="button" data-convert="remap">Rebuild mapped review (replaces edits)</button></details>
    <section data-convert-linked></section>
    <p data-convert-issues role="status" class="capture-original converter-issues" hidden></p>
    <div data-write-preview class="capture-original converter-write-preview" hidden></div>
  </div><footer class="capture-footer" hidden><button type="button" data-convert="validate" aria-label="Validate write-back preview">Review changes</button><button type="button" class="primary" data-convert="apply" aria-label="Apply reviewed nutrition" disabled>Apply nutrition</button></footer>`;
  let state=structuredClone(host.state()??newConverterState(host.book().foodCapture?.builder?.id)),page=0,pending=0,applying=false,saveError='',operationError='',disposed=false,previewSignature='',previewVersion:string|number=-1;
  let chain=Promise.resolve(),queuedSave:{state:ConverterState;version:number;generation:number}|undefined,saveVersion=0,generation=0,renderedVersion:string|number|undefined;
  const dropdownPrefix='nutrition-converter-'+crypto.randomUUID(),dropdowns=new Map<HTMLSelectElement,ReturnType<typeof mountSelectDropdown>>();
  const $=<T extends HTMLElement=HTMLElement>(selector:string)=>element.querySelector<T>(selector)!;
  const active=()=>state.mode==='untracked'?(state.standalone??=newStandaloneConverterState()):state;
  const untracked=()=>state.mode==='untracked';
  const source=$<HTMLTextAreaElement>('[data-convert-source]');
  const batch=():NutritionBatch|undefined=>host.book().foodCapture?.builder;
  const message=(error:unknown)=>error instanceof Error?error.message:String(error);
  const sourceVersion=()=>host.sourceVersion?.()??host.book().revision;
  const token=()=>untracked()?state.standalone!.operation:state.batch;
  const clearPreview=()=>{previewSignature='';$('[data-write-preview]').textContent='';$('[data-write-preview]').hidden=true;};
  const refreshDropdowns=()=>{
    for(const [select,control]of dropdowns){
      if(!element.contains(select)){control.close();dropdowns.delete(select);}
      else{if(select.disabled)control.close();control.refresh();}
    }
    for(const select of element.querySelectorAll<HTMLSelectElement>('select')){
      if(dropdowns.has(select))continue;
      const identity=select.hasAttribute('data-convert-mode')?'mode':select.hasAttribute('data-import-target')?'import-target':select.dataset.importType!==undefined?'import-type-'+select.dataset.importType:select.dataset.map!==undefined?'mapping-'+select.dataset.map:select.dataset.targetId?'destination-'+select.dataset.targetId:'manual-'+select.dataset.linkedManual;
      select.id=dropdownPrefix+'-'+encodeURIComponent(identity);
      if(!select.hasAttribute('aria-label'))select.setAttribute('aria-label','Converter choice');
      dropdowns.set(select,mountSelectDropdown(select));
    }
  };
  const signature=()=>untracked()?standaloneSignature(standaloneReview(state.standalone!)):converterSignature(converterReview(state));
  const issues=()=>{
    if(untracked()){
      try{
        preflightStandaloneImport(host.book(),standaloneReview(state.standalone!));
        return host.applyImport?[]:['Adding new tables is not available in this host yet. Your review is saved; nothing has been added.'];
      }catch(error){return[message(error)];}
    }
    const current=batch();if(!current)return['Open a nutrition batch in Get nutrition first, or choose New table.'];
    if(current.id!==state.batch)return['This review belongs to another batch. Reopen its matching batch.'];
    try{
      const names=new Map(current.items.map(item=>[item.id,item.name]));
      return reviewNutritionTable(current,converterReview(state)).issues.map(issue=>`${issue.item?(names.get(issue.item)??issue.item)+': ':''}${issue.message}`);
    }catch(error){return[message(error)];}
  };
  const updateStatus=()=>{
    if(disposed)return;
    const current=active(),problems=issues(),locked=applying||current.status==='applied';
    const hasReview=current.rows.length>0||!untracked()&&Object.values(state.linkedChoices).some(choice=>choice.include);
    $('.capture-footer').hidden=!hasReview;
    $('[data-convert-status]').textContent=applying?'Applying and saving...':pending?'Saving review...':saveError?'Not saved. Retry before applying.':current.status==='applied'?'Applied and saved.':current.raw||current.parsed?'Review saved automatically.':'Edits save automatically.';
    $('[data-convert-error]').textContent=[saveError,operationError].filter(Boolean).join('\n');$('[data-convert-error]').hidden=!saveError&&!operationError;
    $('[data-convert-issues]').textContent=problems.join('\n');
    $('[data-convert-issues]').hidden=current.status==='applied'||!problems.length||!current.parsed&&!current.raw&&!Object.values(state.linkedChoices).some(choice=>choice.include);
    let currentSignature='';try{currentSignature=signature();}catch{}
    const blocked=!!problems.length||!!pending||!!saveError||locked;
    const apply=$<HTMLButtonElement>('[data-convert="apply"]'),validate=$<HTMLButtonElement>('[data-convert="validate"]');
    apply.disabled=blocked||!previewSignature||previewSignature!==currentSignature||previewVersion!==sourceVersion();
    validate.disabled=blocked;
    const target=untracked()?state.standalone?.target:undefined;
    apply.textContent=untracked()?target?.kind==='master'?'Add to Master':target?.kind==='ingredients'?'Add to Ingredients':'Add reviewed rows':'Apply nutrition';
    apply.setAttribute('aria-label',untracked()?apply.textContent:'Apply reviewed nutrition');
    validate.textContent=untracked()?'Review Add':'Review changes';
    const retry=$<HTMLButtonElement>('[data-convert="retry-save"]');retry.hidden=!saveError;retry.disabled=!!pending||applying;
    const next=$<HTMLButtonElement>('[data-convert="new-table"]');next.hidden=!untracked()||current.status!=='applied';next.disabled=!!pending||!!saveError||applying;
    element.setAttribute('aria-busy',String(applying));
    for(const input of element.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select'))input.disabled=input.hasAttribute('data-convert-mode')?applying:locked;
    for(const button of element.querySelectorAll<HTMLButtonElement>('[data-convert="process"],[data-convert="remap"]'))button.disabled=locked;
    refreshDropdowns();
  };
  const persist=()=>{
    const snapshot=structuredClone(state),version=++saveVersion;
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
  const edit=()=>{active().status='editing';operationError='';clearPreview();persist();};
  const targets=()=>host.book().sheets.flatMap(sheet=>{
    try{const context=mealLogContext(host.book(),sheet);return[{sheet:sheet.id,table:context.table.id,label:`${sheet.name} / ${context.table.name}`}];}catch{return[];}
  });
  const destinationLabel=(target:NutritionTarget|undefined)=>target?allTables(host.book()).find(table=>table.id===target.table)?.name??'Destination removed':'Choose a destination';
  const targetControl=(id:string,target:NutritionTarget|undefined,linked=false)=>{
    const choice=(linked?state.linkedChoices:state.choices)[id];
    if(target)return`<p class="muted">Destination: ${esc(destinationLabel(target))}</p>`;
    return`<label class="meal-log-field"><span>Destination for this legacy Draft</span><select data-target-id="${esc(id)}" ${linked?'data-linked-target':''} aria-label="Destination ${esc(id)}"><option value="">Choose destination</option>${targets().map(target=>`<option value="${esc(target.table)}" ${choice?.target?.table===target.table?'selected':''}>${esc(target.label)}</option>`).join('')}</select></label>`;
  };
  const checkbox=(id:string,field:string,checked:boolean|undefined,label:string)=>`<label class="inline"><input type="checkbox" data-review-choice="${field}" data-review-id="${esc(id)}" ${checked?'checked':''}>${label}</label>`;
  const renderRoutes=()=>{
    $('[data-route-section]').hidden=untracked();
    if(untracked()){$('[data-convert-cards]').replaceChildren();$('[data-convert-missing]').replaceChildren();return;}
    const items=new Map(batch()?.items.map(item=>[item.id,item])??[]),rows=state.rows.slice(page*30,(page+1)*30);
    $('[data-convert-cards]').innerHTML=rows.map((row,index)=>{
      const item=items.get(row.id),choice=state.choices[row.id],at=page*30+index;
      let reference:ReturnType<typeof nutritionReference>|undefined,referenceError='';
      if(item?.kind==='ingredient')try{reference=nutritionReference(item);}catch(error){referenceError=message(error);}
      const differs=(field:'weight'|'amount'|'unit',expected:unknown)=>{
        const text=row[field].trim(),before=String(expected??'').trim();
        return field==='unit'?text.toLowerCase()!==before.toLowerCase():(!text)!==(!before)||!!text&&Number(text)!==Number(before);
      };
      const referenceChanged=reference&&(['weight','amount','unit'] as const).some(field=>differs(field,reference[field]));
      const consumedChanged=item?.kind==='logged'&&(['weight','amount','unit'] as const).some(field=>row[field].trim()&&differs(field,item.values[field]));
      const conflicts=item&&nutrients.filter(field=>item.values[field]?.trim()&&Number(item.values[field])!==Number(row[field]));
      const route=item?.kind==='ingredient'?`Update existing Ingredient. Reference: ${reference?quantity(reference):referenceError}.`:item?.kind==='logged'?`Update original Logged row - ${day(item.date)}. Consumed: ${quantity(item.values)}. Blank response quantities keep this portion.`:item?`Create dated consumption for Draft - ${day(item.date)}. Consumed: ${quantity(item.values)}.`:'Unmatched row. Correct its Item ID in Batch and Item IDs below; names and positions are not used to match.';
      return`<article class="meal-log-card converter-route"><h4>${at+1}. ${esc(row.name||'Unnamed result')}</h4><p class="muted">${esc(route)}</p>${item?.kind==='draft'?targetControl(item.id,item.loggingTarget):''}${item?`<details class="converter-details dropdown-section">${disclosureHeader('Original food and source')}<p class="capture-original">${esc(item.originalName)}${item.restaurant?'\nRestaurant: '+esc(item.restaurant):''}</p><p class="muted">Item ID: ${esc(row.id)}<br>Source: ${esc(item.source.table??'Draft')} / ${esc(item.source.row)}${item.source.part?' / '+esc(item.source.part):''}</p></details>`:''}${referenceChanged?checkbox(row.id,'referenceAcknowledged',choice?.referenceAcknowledged,'I verified ALL nutrients use the captured Ingredient reference, regardless of returned quantities.'):''}${consumedChanged?checkbox(row.id,'quantityAcknowledged',choice?.quantityAcknowledged,'I verified the nutrition describes the intended consumed portion and approve replacing its changed quantities.'):''}${conflicts?.length?checkbox(row.id,'overwrite',choice?.overwrite,"Allow replacement of this request's existing nutrition values after review."):''}</article>`;
    }).join('');
    const seen=new Set(state.rows.map(row=>row.id)),missing=batch()?selectedNutritionItems(batch()!).filter(item=>!seen.has(item.id)):[];
    $('[data-convert-missing]').innerHTML=missing.length?`<h3>Missing results</h3>${missing.map(item=>`<label class="meal-log-field"><span>${esc(item.name)} - reason for not applying</span><input data-missing-id="${esc(item.id)}" aria-label="Missing result reason ${esc(item.id)}" value="${esc(state.choices[item.id]?.missingReason??'')}"></label>`).join('')}`:'';
  };
  const renderLinked=()=>{
    $('[data-convert-linked]').innerHTML=untracked()?'':(batch()?.linkedIntents??[]).filter(intent=>batch()!.days.includes(intent.date)).map(intent=>{
      const choice=state.linkedChoices[intent.key],manual=Object.values(intent.overrides).some(value=>value?.trim());
      return`<article class="meal-log-card"><h4>Linked Draft: ${esc(intent.values.food)}</h4><p class="muted">${esc(day(intent.date))} - Consumed: ${esc(quantity(intent.values))}${intent.restaurant?' - '+esc(intent.restaurant):''}</p><label class="inline"><input type="checkbox" data-linked-id="${esc(intent.key)}" ${choice?.include?'checked':''}>Log this captured Draft on ${esc(day(intent.date))}</label>${choice?.include?targetControl(intent.key,intent.target,true):''}${choice?.include&&manual?`<label class="meal-log-field"><span>Manual macro conflict decision</span><select data-linked-manual="${esc(intent.key)}" aria-label="Manual overrides ${esc(intent.key)}"><option value="">Review if different</option><option value="keep" ${choice.manual==='keep'?'selected':''}>Keep manual values</option><option value="reference" ${choice.manual==='reference'?'selected':''}>Use refreshed Ingredient reference</option></select></label>`:''}<details class="converter-details dropdown-section">${disclosureHeader('Original food and source')}<p class="capture-original">${esc(intent.values.notes??'')}</p><p class="muted">Captured Draft: ${esc(intent.key)}. Retains its consumed portion and Ingredient link; removed from Draft only after its Logged row is saved.</p></details></article>`;
    }).join('');
  };
  const render=()=>{
    if(disposed)return;
    const current=active(),standalone=state.standalone;
    renderedVersion=sourceVersion();
    if(document.activeElement!==source)source.value=current.raw;
    $<HTMLSelectElement>('[data-convert-mode]').value=state.mode;
    $('[data-mode-help]').textContent=untracked()?'Add new rows to an explicit destination. Tables with Batch or Item IDs belong in Tracked nutrition response.':'Updates captured Logged and Ingredient rows; logs selected Drafts. Keep the supplied Batch and Item IDs.';
    $('[data-convert-review]').hidden=!current.parsed;
    $('[data-convert-mapping]').hidden=!current.parsed;
    $('[data-standalone-target]').hidden=!untracked();
    if(untracked()){
      let destinations:ReturnType<typeof standaloneDestinations>=[];
      try{destinations=standaloneDestinations(host.book());}catch(error){operationError=message(error);}
      $<HTMLSelectElement>('[data-import-target]').innerHTML=`<option value="">Choose Master or Ingredients</option>${destinations.map(target=>`<option value="${esc(target.kind+':'+target.table)}" ${standalone?.target?.kind===target.kind&&standalone.target.table===target.table?'selected':''}>${esc(target.label)}</option>`).join('')}`;
    }
    $('[data-import-date-label]').hidden=!untracked()||standalone?.target?.kind!=='master';
    $<HTMLInputElement>('[data-import-date]').value=standalone?.date??'';
    $<HTMLInputElement>('[data-convert-description]').checked=current.removeDescription;
    $<HTMLInputElement>('[data-convert-batch]').value=state.parsed?.batch??'';
    $('[data-convert-identities]').hidden=untracked();
    $('[data-mapping-fields]').innerHTML=current.parsed?.headers.map((header,index)=>`<label class="meal-log-field"><span>${esc(header)}</span><select data-map="${index}" aria-label="Map ${esc(header)}">${[...converterFields,'extra'].map(field=>`<option value="${field}" ${(current.pendingMapping??current.parsed!.mapping)[index]===field?'selected':''}>${field==='extra'?'Retain as extra source field':esc(converterLabels[field as ConverterField])}</option>`).join('')}</select></label>`).join('')??'';
    if(current.pendingMapping)$<HTMLDetailsElement>('[data-convert-mapping]').open=true;
    page=Math.min(page,Math.max(0,Math.ceil(current.rows.length/30)-1));
    const rows=current.rows.slice(page*30,(page+1)*30),ingredient=untracked()&&standalone?.target?.kind==='ingredients';
    let types:string[]=[];
    if(ingredient)try{types=standaloneTypeChoices(host.book(),standalone!.target!);}catch(error){operationError=message(error);}
    const fields=converterFields.filter(field=>field!=='id');
    $('[data-preview-title]').textContent=ingredient?'Ingredients preview':untracked()?(standalone?.target?.kind==='master'?'Master preview':'Table preview'):'Review';
    $('[data-convert-head]').innerHTML=`<tr>${ingredient?'<th scope="col">Type</th>':''}${fields.map(field=>`<th scope="col">${esc(converterLabels[field])}</th>`).join('')}</tr>`;
    const input=(index:number,field:ConverterField)=>`<input data-convert-row="${index}" data-convert-field="${field}" aria-label="Row ${index+1} ${esc(converterLabels[field])}" value="${esc(current.rows[index][field])}" ${field!=='id'&&field!=='name'&&field!=='unit'?'inputmode="decimal"':''}>`;
    $('[data-convert-table]').innerHTML=rows.map((_,index)=>{
      const at=page*30+index;
      return`<tr>${ingredient?`<td><select data-import-type="${at}" aria-label="Row ${at+1} Type"><option value="">Choose Type</option>${types.map(type=>`<option ${standalone!.types[at]===type?'selected':''}>${esc(type)}</option>`).join('')}</select></td>`:''}${fields.map(field=>`<td>${input(at,field)}</td>`).join('')}</tr>`;
    }).join('');
    $('[data-item-identities]').innerHTML=untracked()?'':rows.map((row,index)=>`<label class="meal-log-field"><span>${page*30+index+1}. ${esc(row.name)}</span>${input(page*30+index,'id')}</label>`).join('');
    $('[data-convert-count]').textContent=rows.length?`${page*30+1}-${page*30+rows.length} of ${current.rows.length}`:'No rows';
    $('[data-convert-pages]').hidden=current.rows.length<=30;
    $<HTMLButtonElement>('[data-convert="previous"]').disabled=page===0;
    $<HTMLButtonElement>('[data-convert="next"]').disabled=(page+1)*30>=current.rows.length;
    renderRoutes();renderLinked();updateStatus();
  };
  element.addEventListener('paste',event=>{
    if(event.target!==source||!event.clipboardData||applying||active().status==='applied')return;
    const text=event.clipboardData.getData('text/plain'),html=event.clipboardData.getData('text/html');if(!html)return;
    event.preventDefault();
    const start=source.selectionStart,end=source.selectionEnd,whole=start===0&&end===source.value.length||!source.value;
    source.setRangeText(text,start,end,'end');active().raw=source.value;active().html=whole?html:'';edit();
  },{signal:controller.signal});
  element.addEventListener('input',event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||applying||active().status==='applied'||event instanceof InputEvent&&event.isComposing)return;
    if(input===source){active().raw=input.value;active().html='';}
    else if(input.hasAttribute('data-convert-batch')&&state.parsed)state.parsed.batch=input.value;
    else if(input.hasAttribute('data-import-date'))state.standalone!.date=input.value;
    else if(input.dataset.convertRow!==undefined&&input.dataset.convertField){
      const index=Number(input.dataset.convertRow),field=input.dataset.convertField as ConverterField,row=active().rows[index];if(!row)return;
      if(!untracked())delete state.choices[row.id];
      row[field]=input.value;
      if(!untracked()&&field==='id')delete state.choices[row.id];
      renderRoutes();
      if(field==='name'&&!untracked()){
        const label=$('[data-item-identities]').querySelectorAll('label>span')[index-page*30];if(label)label.textContent=`${index+1}. ${row.name}`;
      }
    }else if(input.dataset.missingId){const id=input.dataset.missingId;state.choices[id]={...state.choices[id],missingReason:input.value};}
    else return;
    edit();
  },{signal:controller.signal});
  element.addEventListener('compositionend',event=>event.target?.dispatchEvent(new InputEvent('input',{bubbles:true})),{signal:controller.signal});
  element.addEventListener('change',event=>{
    const input=event.target;if(applying)return;
    if(input instanceof HTMLSelectElement&&input.hasAttribute('data-convert-mode')){
      state.mode=input.value as ConverterState['mode'];active();operationError='';clearPreview();page=0;persist();render();return;
    }
    if(active().status==='applied')return;
    if(input instanceof HTMLSelectElement&&input.dataset.map!==undefined){
      const current=active();if(!current.parsed)return;
      const mapping=[...element.querySelectorAll<HTMLSelectElement>('[data-map]')].map(select=>select.value as ConverterField|'extra');
      current.pendingMapping=mapping.every((field,index)=>field===current.parsed!.mapping[index])?undefined:mapping;
      edit();
    }else if(input instanceof HTMLSelectElement&&input.hasAttribute('data-import-target')){
      try{
        const target=standaloneDestinations(host.book()).find(target=>target.kind+':'+target.table===input.value);
        state.standalone!.target=target?{kind:target.kind,sheet:target.sheet,table:target.table,fields:{...target.fields}}:undefined;state.standalone!.types=state.standalone!.rows.map(()=>'');
        edit();render();
      }catch(error){operationError=message(error);host.error(error);updateStatus();}
    }else if(input instanceof HTMLSelectElement&&input.dataset.importType!==undefined){state.standalone!.types[Number(input.dataset.importType)]=input.value;edit();}
    else if(input instanceof HTMLSelectElement&&input.dataset.targetId){
      const choices=input.hasAttribute('data-linked-target')?state.linkedChoices:state.choices,id=input.dataset.targetId,target=targets().find(target=>target.table===input.value);
      choices[id]={...choices[id],target:target?{sheet:target.sheet,table:target.table}:undefined};edit();
    }else if(input instanceof HTMLSelectElement&&input.dataset.linkedManual){
      const id=input.dataset.linkedManual;state.linkedChoices[id]={...state.linkedChoices[id],manual:input.value==='keep'||input.value==='reference'?input.value:undefined};edit();
    }else if(input instanceof HTMLInputElement){
      if(input.hasAttribute('data-convert-description'))active().removeDescription=input.checked;
      else if(input.dataset.linkedId){const id=input.dataset.linkedId;state.linkedChoices[id]={...state.linkedChoices[id],include:input.checked};renderLinked();}
      else if(input.dataset.reviewChoice&&input.dataset.reviewId){const id=input.dataset.reviewId;state.choices[id]={...state.choices[id],[input.dataset.reviewChoice]:input.checked};}
      else return;
      edit();
    }
  },{signal:controller.signal});
  element.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[data-convert]'):null;
    if(!button||button.disabled||applying)return;event.stopPropagation();
    try{
      switch(button.dataset.convert){
        case'process':{
          const current=active(),parsed=parseNutritionTable(current.raw,current.html);
          current.parsed=parsed;current.rows=[];current.processedRaw=current.raw;current.pendingMapping=undefined;
          if(!untracked())state.choices={};
          page=0;
          try{current.rows=mapNutritionTable(parsed);if(untracked())state.standalone!.types=current.rows.map(()=>'');}
          catch(error){edit();render();$<HTMLDetailsElement>('[data-convert-mapping]').open=true;throw error;}
          edit();render();$<HTMLDetailsElement>('[data-convert-source-panel]').open=false;break;
        }
        case'remap':{
          const mapping=[...element.querySelectorAll<HTMLSelectElement>('[data-map]')].map(select=>select.value as ConverterField|'extra');
          if(untracked())state.standalone=remapStandaloneTable(state.standalone!,mapping);
          else state=remapConverterTable(state,mapping);
          edit();render();break;
        }
        case'previous':page--;render();break;
        case'next':page++;render();break;
        case'retry-save':persist();break;
        case'new-table':state.standalone=newStandaloneConverterState();page=0;edit();render();$<HTMLDetailsElement>('[data-convert-source-panel]').open=true;source.focus();break;
        case'validate':{
          clearPreview();let summary:string;
          if(untracked()){
            const result=reviewStandaloneImport(host.book(),standaloneReview(state.standalone!),host.imports?.()??[]);
            summary=result.alreadyApplied?'This exact Add was already saved. It will not be added twice.':`Add ${result.entries.length} new ${state.standalone!.target!.kind==='master'?'Master rows on '+state.standalone!.date:'Ingredients'}:\n`+result.entries.map(entry=>`${entry.values.food}${entry.type?' - '+entry.type:''}: ${quantity(entry.values)}; ${nutrients.map(field=>`${converterLabels[field]}: ${entry.values[field]}`).join('; ')}`).join('\n');
          }else{
            const current=batch();if(!current)throw Error('Open the nutrition batch before validation.');
            const result=prepareNutritionApply(host.book(),current,converterReview(state),host.receipts?.()??[]);
            summary=result.alreadyApplied?'This exact operation was already saved. It will not be applied twice.':result.receipt.entries.map(entry=>`${entry.kind==='ingredient'?'Update Ingredient':entry.kind==='logged'?'Update Logged row':'Log Draft'}: ${entry.values.food} - ${destinationLabel({table:entry.target.table,sheet:''})}\n${quantity(entry.values)}; ${nutrients.map(field=>`${converterLabels[field]}: ${entry.values[field]}`).join('; ')}${entry.kind==='draft'||entry.kind==='linked'?'\nRemove captured Draft only after saving its Logged row.':''}`).join('\n\n');
          }
          $('[data-write-preview]').textContent=summary;$('[data-write-preview]').hidden=false;
          previewSignature=signature();previewVersion=sourceVersion();operationError='';updateStatus();break;
        }
        case'apply':{
          if(issues().length||pending||saveError||previewSignature!==signature()||previewVersion!==sourceVersion())return;
          const applyGeneration=generation,operation=token(),mode=state.mode;
          const run=untracked()?()=>host.applyImport!(standaloneReview(state.standalone!)):()=>host.apply(converterReview(state));
          applying=true;operationError='';updateStatus();
          void Promise.resolve().then(run).then(()=>{
            if(generation!==applyGeneration||state.mode!==mode||token()!==operation)return;
            active().status='applied';saveError='';operationError='';
          }).catch(error=>{
            if(generation!==applyGeneration||state.mode!==mode||token()!==operation)return;
            const staged=host.state(),stagedStatus=mode==='untracked'?staged?.standalone?.status:staged?.status;
            const stagedOperation=mode==='untracked'?staged?.standalone?.operation:staged?.batch;
            if(staged&&stagedOperation===operation&&stagedStatus==='applied'){
              state=structuredClone(staged);
              saveError=`Write-back is staged in memory but not saved: ${message(error)}. Keep this page open and retry saving the review; do not apply again.`;operationError='';
            }else{operationError=`Apply did not complete: ${message(error)}. Your review is preserved. Resolve the error before retrying.`;active().status='failed';}
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
      generation++;saveVersion++;queuedSave=undefined;state=structuredClone(external);saveError='';operationError='';clearPreview();page=0;render();return;
    }
    if(!pending&&!saveError&&!applying){const next=host.state();if(next&&JSON.stringify(next)!==JSON.stringify(state)){state=structuredClone(next);clearPreview();render();return;}}
    if(renderedVersion!==sourceVersion()){
      const hadPreview=!!previewSignature;
      clearPreview();
      if(hadPreview&&!applying&&active().status!=='applied'){$('[data-write-preview]').textContent='Sources changed. Review changes again before applying.';$('[data-write-preview]').hidden=false;}
      render();return;
    }
    updateStatus();
  },dispose:()=>{disposed=true;controller.abort();for(const control of dropdowns.values())control.close();dropdowns.clear();},saved:()=>chain};
}
