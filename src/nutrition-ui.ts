import {availableFoodDays,captureData,missingNutrition,missingNutritionReference,nutritionReference,refreshNutritionPrompt,saveNameVersion,type NutritionItem} from './food-capture';
import {excelDateText} from './dates';
import type {Engine} from './formula';
import type {Workbook} from './model';
import type {Patch} from './undo-history';
import {mountConverterPanel,type ConverterPanelHost} from './nutrition-converter-ui';
import {toolbarIcon} from './icons';
import {mountSelectDropdown} from './dropdown-ui';

export interface NutritionPanelHost{
  book:()=>Workbook;engine:()=>Engine;sourceVersion:()=>number;
  converter:ConverterPanelHost;
  write:(label:string,paths:Patch['path'][],change:()=>void)=>boolean;
  days:(days:number[])=>boolean;checkNew:()=>void;generate:()=>void;reset:()=>void;back:()=>void;
  exportNames:()=>void;importNames:(file:File)=>Promise<void>;versions:()=>void;error:(error:unknown)=>void;
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const hasReference=(item:NutritionItem)=>{try{nutritionReference(item);return true;}catch{return false;}};
export function mountNutritionPanel(host:NutritionPanelHost){
  const element=document.createElement('section'),controller=new AbortController();
  element.className='capture-pane';element.setAttribute('aria-label','Nutrition builder');
  element.innerHTML='<header class="capture-toolbar"><button type="button" data-action="back">Back</button><h2>Get nutrition</h2><button type="button" data-action="reset">Reset batch</button></header><nav class="panel-tabs" aria-label="Nutrition workflow"><button type="button" data-workflow="builder" aria-pressed="true">Prompt builder</button><button type="button" data-workflow="converter" aria-pressed="false">Table converter</button></nav><section data-converter hidden class="capture-notice"><h3>Table converter</h3><p>This converter is not implemented yet. Generating a prompt never applies returned nutrition to your workbook.</p></section><div class="capture-foods" data-builder><p class="muted" data-batch></p><details data-days><summary>Food days</summary><div class="button-row"><button type="button" data-action="all-days">All available days</button><label class="inline"><input type="checkbox" data-multi>Multiple days</label></div><div data-day-list></div><div class="button-row"><button type="button" data-day-page="-1">Earlier page</button><button type="button" data-day-page="1">Later page</button></div></details><div class="button-row"><button type="button" data-action="new">Check new food</button><button type="button" data-action="100g">Set missing to 100g</button></div><details data-items><summary>Select foods and Ingredients <span data-selection-count></span></summary><div class="button-row"><button type="button" data-select="true">Select all shown</button><button type="button" data-select="false">Clear shown</button><select aria-label="Nutrition item filter"><option value="all">All</option><option value="ingredient">Ingredients</option><option value="food">Unlinked food</option></select></div><div data-item-list></div><div class="button-row"><button type="button" data-page="-1">Previous items</button><span data-page-count></span><button type="button" data-page="1">Next items</button></div></details><label class="inline"><input type="checkbox" data-review-names>Review names</label><div class="button-row"><button type="button" data-action="versions">Name versions</button><button type="button" data-action="export">Export names</button><label class="file-button">Import names<input type="file" accept=".json,application/json" data-name-import></label></div><details data-template><summary>Edit prompt template</summary><label class="meal-log-field"><span>Prompt template</span><textarea rows="12" aria-label="Prompt template" data-template-input></textarea></label></details><button type="button" class="primary" data-action="generate">Generate prompt</button><p class="muted" role="status" data-prompt-issue></p><details data-prompt><summary>Generated prompt</summary><label class="meal-log-field"><span>Prompt</span><textarea rows="14" aria-label="Generated nutrition prompt" readonly data-prompt-text></textarea></label><button type="button" data-action="copy">Copy prompt</button><p class="muted" data-copy-status role="status"></p></details></div>';
  for(const [action,icon,label]of [['back','previous','Back'],['reset','redo','Reset batch']] as const){
    const button=element.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;button.classList.add('icon-button');button.setAttribute('aria-label',label);button.title=label;button.innerHTML=toolbarIcon(icon);
  }
  const converter=mountConverterPanel(host.converter),converterRoot=element.querySelector<HTMLElement>('[data-converter]')!;
  converterRoot.classList.remove('capture-notice');converterRoot.replaceChildren(converter.element);
  const builder=element.querySelector<HTMLElement>('[data-builder]')!,list=element.querySelector<HTMLElement>('[data-item-list]')!,dayList=element.querySelector<HTMLElement>('[data-day-list]')!;
  const itemFilter=element.querySelector<HTMLSelectElement>('[aria-label="Nutrition item filter"]')!;
  itemFilter.id='nutrition-filter-'+crypto.randomUUID();const itemFilterDropdown=mountSelectDropdown(itemFilter);
  element.querySelector<HTMLInputElement>('[data-name-import]')!.closest('label')!.className='file-action';
  let page=0,dayPage=0,shape='',dayShape='',dayKey='',days:number[]=[],frame=0,copiedPrompt:string|undefined;
  const current=()=>{const batch=host.book().foodCapture?.builder;if(!batch)throw Error('This nutrition batch no longer exists. Reopen Get nutrition to start a batch.');return batch;};
  const eligible=(item:NutritionItem,days:ReadonlySet<number>)=>item.date===undefined||days.has(item.date);
  const shown=(batch=current(),days=new Set(batch.days))=>batch.items.filter(item=>eligible(item,days)&&(itemFilter.value==='all'||itemFilter.value==='ingredient'&&item.kind==='ingredient'||itemFilter.value==='food'&&item.kind!=='ingredient'));
  const promptPaths:Patch['path'][]=[['foodCapture','builder','prompt'],['foodCapture','builder','promptIssue']];
  let validatedBatch:ReturnType<typeof current>|undefined,promptValidationIssue='';
  const validateSavedPrompt=(force=false):boolean=>{
    const batch=current();
    if(!batch.generated||!force&&validatedBatch===batch)return !promptValidationIssue;
    const checked={...batch};refreshNutritionPrompt(checked);
    if(checked.prompt!==batch.prompt||checked.promptIssue!==batch.promptIssue){
      if(!host.write('Revalidate saved nutrition prompt',promptPaths,()=>{
        if(current()!==batch)throw Error('The nutrition batch changed during prompt validation.');
        batch.prompt=checked.prompt;
        if(checked.promptIssue)batch.promptIssue=checked.promptIssue;else delete batch.promptIssue;
      })){
        promptValidationIssue='The saved prompt could not be revalidated. Finish saving and reopen Get nutrition before copying.';
        return false;
      }
    }
    validatedBatch=batch;promptValidationIssue='';return true;
  };
  const write=(label:string,paths:Patch['path'][],change:()=>void,refreshPrompt=true)=>{
    return host.write(label,[...paths,...(refreshPrompt?promptPaths:[])],()=>{change();if(refreshPrompt)refreshNutritionPrompt(current());});
  };
  const editItem=(id:string,field:'name'|'restaurant'|'basis'|'selected'|'includeNotes',value:string|boolean)=>{
    const batch=current(),index=batch.items.findIndex(item=>item.id===id);if(index<0)throw Error('The nutrition item was removed.');
    const item=batch.items[index],affectsPrompt=batch.generated&&eligible(item,new Set(batch.days))&&(field==='selected'||item.selected);
    if(field==='basis'&&!missingNutritionReference(item)&&value!=='')throw Error('Edit the captured Ingredient reference at its source, then reset the batch.');
    write('Edit nutrition request',[['foodCapture','builder','items',index,field]],()=>{
      const item=current().items[index];
      if(field==='selected'||field==='includeNotes'){if(typeof value!=='boolean')throw Error('Invalid selection.');item[field]=value;}
      else{if(typeof value!=='string')throw Error('Invalid nutrition request text.');item[field]=value;}
    },affectsPrompt);
  };
  const refresh=()=>{
    const batch=host.book().foodCapture?.builder;
    if(!batch){builder.hidden=true;converterRoot.hidden=true;return;}
    validateSavedPrompt();
    const workflow=batch.workflow??'builder';
    for(const tab of element.querySelectorAll<HTMLElement>('[data-workflow]'))tab.setAttribute('aria-pressed',String(tab.dataset.workflow===workflow));
    builder.hidden=workflow!=='builder';converterRoot.hidden=workflow!=='converter';
    if(workflow==='converter'){converter.refresh();return;}
    const sourceKey=host.book().id+':'+host.sourceVersion()+':'+(host.book().foodCapture?.foods.length??0);
    if(sourceKey!==dayKey){dayKey=sourceKey;days=availableFoodDays(host.book(),host.engine());}
    const available=[...new Set([...days,...batch.days])].sort((a,b)=>b-a);dayPage=Math.min(dayPage,Math.max(0,Math.ceil(available.length/30)-1));
    const nextDays=JSON.stringify([available,dayPage,batch.days,batch.multiDay]);
    if(dayShape!==nextDays){
      dayShape=nextDays;
      dayList.innerHTML=available.slice(dayPage*30,(dayPage+1)*30).map(day=>`<label class="inline"><input type="${batch.multiDay?'checkbox':'radio'}" name="nutrition-day" data-day="${day}" ${batch.days.includes(day)?'checked':''}>${esc(excelDateText(day))}</label>`).join('');
    }
    element.querySelector<HTMLInputElement>('[data-multi]')!.checked=batch.multiDay;
    element.querySelector<HTMLButtonElement>('[data-day-page="-1"]')!.disabled=dayPage===0;
    element.querySelector<HTMLButtonElement>('[data-day-page="1"]')!.disabled=(dayPage+1)*30>=available.length;
    const selectedDays=new Set(batch.days),items=shown(batch,selectedDays);page=Math.min(page,Math.max(0,Math.ceil(items.length/30)-1));
    const visible=items.slice(page*30,(page+1)*30),nextShape=JSON.stringify([batch.id,page,itemFilter.value,batch.reviewNames,visible.map(item=>item.id)]);
    if(shape!==nextShape){
      shape=nextShape;
      list.innerHTML=visible.map(item=>`<section class="meal-log-card" data-nutrition-item="${item.id}"><label class="inline"><input type="checkbox" data-field="selected"><strong data-name></strong></label><p class="muted" data-source></p>${batch.reviewNames?'<label class="meal-log-field"><span>Dish name</span><input aria-label="Dish name" data-field="name"></label><label class="meal-log-field"><span>Restaurant</span><input aria-label="Request restaurant" data-field="restaurant"></label>':''}<p class="capture-original" data-original></p>${item.kind==='ingredient'?'<label class="meal-log-field"><span>Nutrition reference serving</span><input aria-label="Nutrition reference serving" data-field="basis" placeholder="40g or 4 each"></label><p class="muted" data-reference></p>':''}<label class="inline"><input type="checkbox" data-field="includeNotes" ${item.values.notes?.trim()?'':'disabled'}>Include notes</label>${item.values.notes?.trim()?`<p class="capture-original">${esc(item.values.notes)}</p>`:''}${item.photos.length?`<p class="muted">${item.photos.length} photo reference(s); attach photos manually.</p>`:''}</section>`).join('')||'<p class="muted">No matching items for these days.</p>';
    }
    const byId=new Map(visible.map(item=>[item.id,item]));
    for(const card of list.querySelectorAll<HTMLElement>('[data-nutrition-item]')){
      const item=byId.get(card.dataset.nutritionItem!)!;
      card.querySelector<HTMLElement>('[data-name]')!.textContent=item.name;
      const missing=missingNutrition(item.values);
      card.querySelector<HTMLElement>('[data-source]')!.textContent=[item.id,item.kind==='ingredient'?'Ingredient reference':item.kind==='draft'?'Draft':'Logged',item.restaurant,item.date===undefined?'':excelDateText(item.date),missing.length?'Needs nutrition':''].filter(Boolean).join(' · ');
      card.querySelector<HTMLElement>('[data-original]')!.textContent='Original description: '+item.originalName;
      for(const input of card.querySelectorAll<HTMLInputElement>('[data-field]')){
        const field=input.dataset.field as 'selected'|'includeNotes'|'name'|'restaurant'|'basis';
        if(input.type==='checkbox')input.checked=!!item[field];else if(input!==document.activeElement)input.value=String(item[field]);
      }
      if(item.kind==='ingredient'){
        const missing=missingNutritionReference(item),input=card.querySelector<HTMLInputElement>('[data-field=basis]')!;
        input.readOnly=!missing;
        if(!missing)input.value=[item.values.weight?.trim()?item.values.weight+'g':'',item.values.amount?.trim(),item.values.unit?.trim()].filter(Boolean).join(' ');
        card.querySelector<HTMLElement>('[data-reference]')!.textContent=hasReference(item)?'Reference serving ready. Existing quantities are not overwritten.':missing?'A reference serving is required before generating.':'Correct the reference in Ingredients, then reset this batch. Captured references cannot be replaced here.';
        let clear=card.querySelector<HTMLButtonElement>('[data-clear-basis]');
        if(!missing&&item.basis.trim()&&!clear){clear=document.createElement('button');clear.type='button';clear.dataset.clearBasis=item.id;clear.textContent='Use captured reference';card.append(clear);}
        if(missing||!item.basis.trim())clear?.remove();
      }
    }
    element.querySelector<HTMLInputElement>('[data-review-names]')!.checked=batch.reviewNames;
    const select=element.querySelector<HTMLDetailsElement>('[data-items]')!,prompt=element.querySelector<HTMLDetailsElement>('[data-prompt]')!;
    if(select.open!==batch.selectOpen)select.open=batch.selectOpen;if(prompt.open!==batch.promptOpen)prompt.open=batch.promptOpen;
    const template=element.querySelector<HTMLTextAreaElement>('[data-template-input]')!;if(template!==document.activeElement&&template.value!==batch.template)template.value=batch.template;
    const promptText=promptValidationIssue?'':batch.prompt,text=element.querySelector<HTMLTextAreaElement>('[data-prompt-text]')!;if(text.value!==promptText)text.value=promptText;
    element.querySelector<HTMLElement>('[data-prompt-issue]')!.textContent=[promptValidationIssue,batch.promptIssue,batch.sourceChanges?.length?`${batch.sourceChanges.length} captured sources changed or were removed. The saved requests are unchanged; Generate asks before using them.`:''].filter(Boolean).join(' ');
    element.querySelector<HTMLElement>('[data-copy-status]')!.textContent=copiedPrompt===undefined?'':copiedPrompt===batch.prompt?'Copied current prompt.':'Prompt changed — copy again.';
    element.querySelector<HTMLButtonElement>('[data-action=copy]')!.disabled=!batch.generated||!batch.prompt||!!batch.promptIssue||!!promptValidationIssue;
    element.querySelector<HTMLElement>('[data-batch]')!.textContent=`Batch ${batch.id} · ${batch.created}`;
    element.querySelector<HTMLElement>('[data-selection-count]')!.textContent=`(${batch.items.filter(item=>item.selected&&eligible(item,selectedDays)).length} selected)`;
    element.querySelector<HTMLElement>('[data-page-count]')!.textContent=items.length?`${page*30+1}–${Math.min(items.length,(page+1)*30)} of ${items.length}`:'0 items';
    element.querySelector<HTMLButtonElement>('[data-page="-1"]')!.disabled=page===0;
    element.querySelector<HTMLButtonElement>('[data-page="1"]')!.disabled=(page+1)*30>=items.length;
    itemFilterDropdown.refresh();
  };
  const queue=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{try{refresh();}catch(error){host.error(error);}});};
  element.addEventListener('input',event=>{
    const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||converterRoot.contains(input)||event instanceof InputEvent&&event.isComposing)return;
    if(input instanceof HTMLInputElement&&input.type!=='text'&&input.type!=='search')return;
    try{
      if(input.hasAttribute('data-template-input'))write('Edit nutrition template',[['foodCapture','builder','template'],['foodCapture','promptTemplate']],()=>{current().template=input.value;captureData(host.book()).promptTemplate=input.value;});
      else if(input.dataset.field){const id=input.closest<HTMLElement>('[data-nutrition-item]')!.dataset.nutritionItem!;editItem(id,input.dataset.field as 'name'|'restaurant'|'basis',input.value);}
      queue();
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('compositionend',event=>{if(event.target instanceof Node&&!converterRoot.contains(event.target))event.target.dispatchEvent(new InputEvent('input',{bubbles:true}));},{signal:controller.signal});
  element.addEventListener('change',event=>{
    const input=event.target;
    if(input instanceof Node&&converterRoot.contains(input))return;
    try{
      if(input===itemFilter){page=0;refresh();}
      else if(input instanceof HTMLInputElement){
        if(input.hasAttribute('data-name-import')){const file=input.files?.[0];if(file)void host.importNames(file).then(refresh).catch(host.error);input.value='';return;}
        if(input.dataset.day){
          const day=Number(input.dataset.day),days=current().multiDay?[...new Set([...current().days.filter(value=>value!==day),...(input.checked?[day]:[])])]:[day];
          host.days(days);page=0;
        }else if(input.hasAttribute('data-multi'))write('Choose nutrition day mode',[['foodCapture','builder','multiDay']],()=>{current().multiDay=input.checked;});
        else if(input.hasAttribute('data-review-names'))write('Review nutrition names',[['foodCapture','builder','reviewNames'],['foodCapture','nameVersions']],()=>{if(input.checked)saveNameVersion(captureData(host.book()));current().reviewNames=input.checked;});
        else if(input.type==='checkbox'&&input.dataset.field)editItem(input.closest<HTMLElement>('[data-nutrition-item]')!.dataset.nutritionItem!,input.dataset.field as 'selected'|'includeNotes',input.checked);
        refresh();
      }
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;if(!button||button.disabled||converterRoot.contains(button))return;
    event.stopPropagation();
    try{
      if(button.dataset.workflow){
        const workflow=button.dataset.workflow;if(workflow!=='builder'&&workflow!=='converter')throw Error('Invalid nutrition workflow.');
        host.write('Choose nutrition workflow',[['foodCapture','builder','workflow']],()=>{current().workflow=workflow;});
        refresh();return;
      }
      if(button.dataset.clearBasis){editItem(button.dataset.clearBasis,'basis','');refresh();return;}
      if(button.dataset.page){page+=Number(button.dataset.page);refresh();return;}
      if(button.dataset.dayPage){dayPage+=Number(button.dataset.dayPage);refresh();return;}
      if(button.dataset.select){
        const selected=button.dataset.select==='true',ids=new Set(shown().map(item=>item.id)),batch=current();
        const paths=batch.items.flatMap((item,index)=>ids.has(item.id)?[['foodCapture','builder','items',index,'selected'] as Patch['path']]:[]);
        write('Select nutrition items',paths,()=>{for(const item of current().items)if(ids.has(item.id))item.selected=selected;});refresh();return;
      }
      switch(button.dataset.action){
        case'back':host.back();break;
        case'reset':host.reset();break;
        case'new':host.checkNew();break;
        case'generate':host.generate();break;
        case'all-days':host.days(days);break;
        case'100g':{
          const batch=current(),selectedDays=new Set(batch.days),items=batch.items.map((item,index)=>({item,index})).filter(({item})=>item.kind==='ingredient'&&item.selected&&eligible(item,selectedDays)&&!item.basis.trim()&&missingNutritionReference(item));
          write('Set missing nutrition references',items.map(({index})=>['foodCapture','builder','items',index,'basis']),()=>{for(const {item}of items)item.basis='100g';});break;
        }
        case'versions':host.versions();break;
        case'export':host.exportNames();break;
        case'copy':{
          if(!validateSavedPrompt(true)){refresh();throw Error(promptValidationIssue);}
          const text=current().prompt;if(!text||current().promptIssue)throw Error('Generate a valid current prompt before copying.');
          if(!navigator.clipboard?.writeText)throw Error('Clipboard is unavailable. Select the generated prompt and copy it using your browser.');
          void navigator.clipboard.writeText(text).then(()=>{copiedPrompt=text;refresh();}).catch(error=>host.error(Error(`Copy failed: ${error instanceof Error?error.message:String(error)}. Select the prompt and copy it using your browser.`)));break;
        }
      }
      refresh();
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  for(const [selector,field]of [['[data-items]','selectOpen'],['[data-prompt]','promptOpen']] as const){
    const details=element.querySelector<HTMLDetailsElement>(selector)!;
    details.addEventListener('toggle',()=>{const batch=host.book().foodCapture?.builder;if(batch&&batch[field]!==details.open)host.write('Remember nutrition panel',[['foodCapture','builder',field]],()=>{current()[field]=details.open;});},{signal:controller.signal});
  }
  return{element,refresh,saved:converter.saved,dispose:()=>{cancelAnimationFrame(frame);itemFilterDropdown.close();controller.abort();converter.dispose();}};
}
