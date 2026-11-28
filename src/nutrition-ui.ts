import {availableFoodDays,captureData,missingNutrition,missingNutritionReference,nutritionReference,nutrients,refreshNutritionPrompt,saveNameVersion,type NutritionItem} from './food-capture';
import {displayExcelDate,excelDateText,parseDateInput} from './dates';
import type {Engine} from './formula';
import type {Workbook} from './model';
import type {Patch} from './undo-history';
import {mountConverterPanel,type ConverterPanelHost} from './nutrition-converter-ui';
import {toolbarIcon} from './icons';
import {dropdownArrowHtml,dropdownOptionsKey,mountDropdownOptions,mountDropdownPopup,renderDropdownTrigger} from './dropdown-ui';
import './nutrition-ui.css';

export interface NutritionPanelHost{
  book:()=>Workbook;engine:()=>Engine;sourceVersion:()=>number;
  converter:ConverterPanelHost;
  write:(label:string,paths:Patch['path'][],change:()=>void)=>boolean;
  days:(days:number[])=>boolean;checkNew:()=>void;generate:()=>void;reset:()=>void;back:()=>void;
  close:()=>void;exportNames:()=>void;importNames:(file:File)=>Promise<void>;versions:()=>void;saveNames:()=>Promise<void>;error:(error:unknown)=>void;
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const hasReference=(item:NutritionItem)=>{try{nutritionReference(item);return true;}catch{return false;}};
export function mountNutritionPanel(host:NutritionPanelHost){
  const element=document.createElement('section'),controller=new AbortController();
  element.className='capture-pane';element.setAttribute('aria-label','Nutrition builder');
  element.innerHTML=`<header class="capture-toolbar nutrition-header"><button type="button" data-action="back">Back</button><nav class="panel-tabs" aria-label="Nutrition workflow"><button type="button" data-workflow="builder" aria-pressed="true">Get nutrition</button><button type="button" data-workflow="converter" aria-pressed="false">Table converter</button></nav><button type="button" data-action="close">Close</button></header>
    <section data-converter hidden></section>
    <div class="capture-foods" data-builder>
      <details data-items><summary>Select foods and Ingredients <span data-selection-count></span></summary>
        <div data-item-list>
          <div data-item-section="ingredient"></div>
          <label class="inline nutrition-default-reference"><input type="checkbox" data-100g>Set 100g for missing reference servings</label>
          <div class="nutrition-day-bar"><div class="panel-tabs capture-mode-tabs" role="group" aria-label="Nutrition day mode"><button type="button" data-day-mode="single">Single day</button><button type="button" data-day-mode="multi">Multi days</button></div><button type="button" class="dropdown-field" data-day-picker aria-label="Choose nutrition dates"></button></div>
          <div data-item-section="draft"></div><div data-item-section="logged"></div>
        </div>
      </details>
      <p class="muted" role="status" data-prompt-issue></p>
      <details class="dropdown-section" data-prompt><summary class="dropdown-section-header nutrition-prompt-heading"><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Prompt</span><span class="button-row"><button type="button" data-action="copy">Copy prompt</button><button type="button" data-action="review" data-review-names aria-pressed="false">Review dish names</button></span></summary>
        <div data-name-review hidden></div>
        <div class="button-row nutrition-name-backups" data-name-backups hidden><button type="button" data-action="versions">Name versions</button><button type="button" data-action="export">Export names</button><label class="file-action">Import names<input type="file" accept=".json,application/json" data-name-import></label></div>
        <label class="meal-log-field"><span>Prompt</span><textarea rows="14" aria-label="Generated nutrition prompt" readonly data-prompt-text></textarea></label><p class="muted" data-copy-status role="status"></p>
      </details>
      <details data-template><summary>Edit prompt template</summary><label class="meal-log-field"><span>Prompt template</span><textarea rows="12" aria-label="Prompt template" data-template-input></textarea></label></details><p class="muted" data-batch></p>
    </div>
    <footer class="capture-footer nutrition-footer"><button type="button" class="primary" data-action="generate">Generate prompt</button><button type="button" data-action="save-names" hidden>Save name version</button><button type="button" data-action="new">Check for new food</button><button type="button" data-action="reset">Reset batch</button></footer>`;
  for(const [action,icon,label]of [['back','previous','Back'],['close','close','Close nutrition'],['reset','redo','Reset batch']] as const){
    const button=element.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;button.classList.add('icon-button');button.setAttribute('aria-label',label);button.title=label;button.innerHTML=toolbarIcon(icon);
  }
  const converter=mountConverterPanel(host.converter),converterRoot=element.querySelector<HTMLElement>('[data-converter]')!;
  converterRoot.classList.remove('capture-notice');converterRoot.classList.add('capture-pane');converterRoot.replaceChildren(converter.element);
  const builder=element.querySelector<HTMLElement>('[data-builder]')!,list=element.querySelector<HTMLElement>('[data-item-list]')!;
  const kinds=['ingredient','draft','logged'] as const,pages=new Map<string,number>(),openGroups=new Map<string,boolean>(),groups=new Map<string,NutritionItem[]>();
  let restaurantGroups:{id:string;members:string[];editable:boolean}[]=[],restaurantBatch='',restaurantMembers:string[]=[];
  const dayTrigger=element.querySelector<HTMLButtonElement>('[data-day-picker]')!;
  let shape='',dayKey='',reviewBatch='',savingNames=false,days:number[]=[],frame=0,copiedPrompt:string|undefined;
  const current=()=>{const batch=host.book().foodCapture?.builder;if(!batch)throw Error('This nutrition batch no longer exists. Reopen Get nutrition to start a batch.');return batch;};
  const eligible=(item:NutritionItem,days:ReadonlySet<number>)=>item.date===undefined||days.has(item.date);
  const shown=(batch=current(),days=new Set(batch.days))=>batch.items.filter(item=>eligible(item,days)&&(!batch.reviewNames||item.selected));
  const availableDays=()=>[...new Set([...days,...current().days])].sort((a,b)=>b-a);
  const datePopup=mountDropdownPopup(dayTrigger,'Nutrition dates',(panel,position,close,popup)=>{
    const batchId=current().id,available=availableDays(),calendar=document.createElement('input'),all=document.createElement('button'),options=document.createElement('div');
    calendar.type='date';calendar.setAttribute('aria-label','Nutrition calendar');
    calendar.value=excelDateText(current().days[0])??'';
    calendar.min=excelDateText(available.at(-1)!)??'';calendar.max=excelDateText(available[0])??'';
    all.type='button';all.textContent='All available days';panel.replaceChildren(calendar,all,options);
    const updateSelection=()=>{const selected=new Set(current().days);for(const option of options.querySelectorAll<HTMLButtonElement>('[data-nutrition-day]'))option.setAttribute('aria-selected',String(selected.has(Number(option.dataset.nutritionDay))));};
    const choose=(day:number,toggle:boolean)=>{
      try{
        if(current().id!==batchId||!availableDays().includes(day))throw Error('The available nutrition days changed. Reopen the date picker.');
        const batch=current(),selected=batch.multiDay?[...new Set([...batch.days.filter(value=>value!==day),...(!toggle||!batch.days.includes(day)?[day]:[])])]:[day];
        if(host.days(selected)){refresh();updateSelection();if(!current().multiDay)close();}
      }catch(error){host.error(error);}
    };
    const view=mountDropdownOptions(options,{choices:available,name:'Nutrition dates',searchLabel:'Search nutrition dates',value:day=>excelDateText(day)!,selected:day=>current().days.includes(day),choose:day=>choose(day,true),position,renderOption:(button,day)=>{button.dataset.nutritionDay=String(day);}});
    popup.onkeydown=event=>dropdownOptionsKey(event,view.search,view.list);
    calendar.onchange=()=>{const day=parseDateInput(calendar.value);if(day===undefined){host.error(Error('Choose an available food day.'));return;}choose(day,false);};
    all.onclick=()=>{try{if(current().id!==batchId)throw Error('The nutrition batch changed. Reopen the date picker.');if(host.days(days)){refresh();updateSelection();}}catch(error){host.error(error);}};
    calendar.disabled=all.disabled=!available.length;view.search.focus({preventScroll:true});return view.dispose;
  },336);
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
    const footer=element.querySelector<HTMLElement>('.nutrition-footer')!;
    if(!batch){builder.hidden=true;converterRoot.hidden=true;footer.hidden=true;return;}
    validateSavedPrompt();
    if(batch.reviewNames&&reviewBatch!==batch.id&&(batch.selectOpen||!batch.promptOpen)){
      if(!host.write('Open saved name review',[['foodCapture','builder','selectOpen'],['foodCapture','builder','promptOpen']],()=>{batch.selectOpen=false;batch.promptOpen=true;}))return;
    }
    reviewBatch=batch.reviewNames?batch.id:'';
    const workflow=batch.workflow??'builder';
    for(const tab of element.querySelectorAll<HTMLElement>('[data-workflow]'))tab.setAttribute('aria-pressed',String(tab.dataset.workflow===workflow));
    builder.hidden=workflow!=='builder';footer.hidden=workflow!=='builder';converterRoot.hidden=workflow!=='converter';
    if(workflow==='converter'){converter.refresh();return;}
    const selection=element.querySelector<HTMLDetailsElement>('[data-items]')!,review=element.querySelector<HTMLElement>('[data-name-review]')!,target=batch.reviewNames?review:selection;
    review.hidden=!batch.reviewNames;
    if(list.parentElement!==target){
      target.append(list);
      const section=(kind:typeof kinds[number])=>list.querySelector<HTMLElement>(`[data-item-section="${kind}"]`)!;
      if(batch.reviewNames)list.append(section('ingredient'),section('logged'),section('draft'));
      else{list.prepend(section('ingredient'));list.append(section('draft'),section('logged'));}
    }
    const sourceKey=host.book().id+':'+host.sourceVersion()+':'+(host.book().foodCapture?.foods.length??0);
    if(sourceKey!==dayKey){dayKey=sourceKey;days=availableFoodDays(host.book(),host.engine());}
    renderDropdownTrigger(dayTrigger,batch.days.length===1?displayExcelDate(batch.days[0])??'Choose date':batch.days.length?`${batch.days.length} days`:'Choose date');
    dayTrigger.disabled=!availableDays().length;
    for(const button of element.querySelectorAll<HTMLButtonElement>('[data-day-mode]'))button.setAttribute('aria-pressed',String((button.dataset.dayMode==='multi')===batch.multiDay));
    element.querySelector<HTMLElement>('.nutrition-day-bar')!.hidden=batch.reviewNames;
    const selectedDays=new Set(batch.days),items=shown(batch,selectedDays);
    const sections=kinds.map(kind=>{
      const members=items.filter(item=>item.kind===kind),page=Math.min(pages.get(kind)??0,Math.max(0,Math.ceil(members.length/30)-1));pages.set(kind,page);
      return{kind,members,page,visible:members.slice(page*30,(page+1)*30)};
    });
    const draftItems=sections.find(section=>section.kind==='draft')!.members,draftById=new Map(draftItems.map(item=>[item.id,item]));
    const focused=document.activeElement,editingRestaurant=focused instanceof HTMLInputElement&&list.contains(focused)&&focused.hasAttribute('data-restaurant-name');
    if(!editingRestaurant||restaurantBatch!==batch.id||restaurantMembers.length!==draftItems.length||draftItems.some((item,index)=>item.id!==restaurantMembers[index])){
      const byRestaurant=new Map<string,NutritionItem[]>();
      for(const item of draftItems){const members=byRestaurant.get(item.restaurant)??[];members.push(item);byRestaurant.set(item.restaurant,members);}
      restaurantGroups=[...byRestaurant].map(([name,members])=>({id:'restaurant:'+members[0].id,members:members.map(item=>item.id),editable:!!name}));
      restaurantBatch=batch.id;restaurantMembers=draftItems.map(item=>item.id);
    }
    const restaurantByItem=new Map(restaurantGroups.flatMap(group=>group.members.map(id=>[id,group.id] as const)));
    const visible=sections.flatMap(section=>section.visible),visibleRestaurants=new Set(sections.find(section=>section.kind==='draft')!.visible.map(item=>restaurantByItem.get(item.id)));
    const nextShape=JSON.stringify([batch.id,batch.reviewNames,sections.map(section=>[section.kind,section.page,section.members.length,section.visible.map(item=>[item.id,item.kind==='draft'?restaurantByItem.get(item.id):''])]),restaurantGroups.filter(group=>visibleRestaurants.has(group.id)).map(group=>[group.id,group.editable])]);
    groups.clear();
    for(const {kind,members}of sections)groups.set(kind,members);
    for(const group of restaurantGroups)groups.set(group.id,group.members.map(id=>draftById.get(id)!));
    if(shape!==nextShape){
      const active=focused instanceof HTMLInputElement&&list.contains(focused)&&['text','search'].includes(focused.type)?focused:undefined;
      const focus=active?{item:active.closest<HTMLElement>('[data-nutrition-item]')?.dataset.nutritionItem,field:active.dataset.field,restaurant:active.dataset.restaurantName,start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection,scroll:builder.scrollTop}:undefined;
      shape=nextShape;
      for(const details of list.querySelectorAll<HTMLDetailsElement>('[data-nutrition-group]'))openGroups.set(details.dataset.nutritionGroup!,details.open);
      const card=(item:NutritionItem)=>`<section class="meal-log-card" data-nutrition-item="${item.id}"><div class="nutrition-item-heading"><label class="inline">${batch.reviewNames?'':'<input type="checkbox" data-field="selected">'}<strong data-name></strong></label>${!batch.reviewNames&&item.kind==='ingredient'&&missingNutritionReference(item)?'<input aria-label="Nutrition reference serving" data-field="basis" placeholder="40g or 4 each">':''}</div><p class="muted" data-source></p><p class="muted" data-nutrition-status></p>${batch.reviewNames?'<label class="meal-log-field"><span>Dish name</span><input aria-label="Dish name" data-field="name"></label>':''}<p class="capture-original" data-original ${batch.reviewNames?'':'hidden'}></p>${item.kind==='ingredient'?'<p class="muted" data-reference></p>':''}${item.values.notes?.trim()?`<label class="inline"><input type="checkbox" data-field="includeNotes">Include notes</label><p class="capture-original">${esc(item.values.notes)}</p>`:''}${item.photos.length?`<p class="muted">${item.photos.length} photo reference(s); attach photos manually.</p>`:''}</section>`;
      const group=(id:string,label:string,content:string,restaurant=false)=>`<details class="nutrition-section" data-nutrition-group="${esc(id)}" ${(openGroups.get(id)??true)?'open':''}><summary>${batch.reviewNames?'':`<input type="checkbox" data-select-group="${esc(id)}" aria-label="Select ${esc(label)}">`}<span class="format-caret">${dropdownArrowHtml}</span><span data-group-label>${esc(label)}</span><span class="count" data-group-count>${groups.get(id)?.length??0}</span></summary>${batch.reviewNames&&restaurant?`<label class="meal-log-field"><span>Restaurant</span><input aria-label="Restaurant name" data-restaurant-name="${esc(id)}"></label>`:''}${content}</details>`;
      for(const {kind,members,page,visible}of sections){
        let content:string;
        if(kind==='draft'){
          const visibleIds=new Set(visible.map(item=>item.id));
          content=restaurantGroups.filter(restaurant=>visibleRestaurants.has(restaurant.id)).map(restaurant=>{
            const members=groups.get(restaurant.id)!,rows=members.filter(item=>visibleIds.has(item.id));
            return group(restaurant.id,members[0].restaurant||'Other',rows.map(card).join(''),restaurant.editable);
          }).join('');
        }else content=visible.map(card).join('');
        content||='<p class="muted">No matching items for these days.</p>';
        const pagination=members.length>30?`<div class="find-pagination"><button type="button" data-page="-1" data-kind="${kind}" ${page===0?'disabled':''}>Previous</button><span>${page*30+1}-${Math.min(members.length,(page+1)*30)} of ${members.length}</span><button type="button" data-page="1" data-kind="${kind}" ${(page+1)*30>=members.length?'disabled':''}>Next</button></div>`:'';
        const label=kind==='ingredient'?'Ingredients':`${kind==='draft'?'Draft':'Logged'}${batch.reviewNames?' food':''}`;
        list.querySelector<HTMLElement>(`[data-item-section="${kind}"]`)!.innerHTML=group(kind,label,content+pagination);
      }
      if(focus){
        const target=focus.restaurant?list.querySelector<HTMLInputElement>(`[data-restaurant-name="${focus.restaurant}"]`):focus.item&&focus.field?list.querySelector<HTMLInputElement>(`[data-nutrition-item="${focus.item}"] [data-field="${focus.field}"]`):null;
        if(target){target.focus({preventScroll:true});if(focus.start!==null&&focus.end!==null)target.setSelectionRange(focus.start,focus.end,focus.direction??'none');builder.scrollTop=focus.scroll;}
      }
    }
    for(const details of list.querySelectorAll<HTMLDetailsElement>('[data-nutrition-group]')){
      const id=details.dataset.nutritionGroup!,members=groups.get(id)??[];
      details.querySelector<HTMLElement>(':scope > summary [data-group-count]')!.textContent=String(members.length);
      if(id.startsWith('restaurant:'))details.querySelector<HTMLElement>(':scope > summary [data-group-label]')!.textContent=members[0]?.restaurant||'Other';
      const input=details.querySelector<HTMLInputElement>(':scope > .meal-log-field [data-restaurant-name]');
      if(input&&input!==document.activeElement)input.value=members[0]?.restaurant??'';
    }
    for(const input of list.querySelectorAll<HTMLInputElement>('[data-select-group]')){
      const members=groups.get(input.dataset.selectGroup!)??[],selected=members.filter(item=>item.selected).length;
      if(input.dataset.selectGroup!.startsWith('restaurant:'))input.setAttribute('aria-label','Select '+(members[0]?.restaurant||'Other'));
      input.checked=!!members.length&&selected===members.length;input.indeterminate=selected>0&&selected<members.length;input.disabled=!members.length;
    }
    const references=items.filter(item=>item.kind==='ingredient'&&missingNutritionReference(item)&&(!item.basis.trim()||item.basis.trim()==='100g')),defaults=element.querySelector<HTMLInputElement>('[data-100g]')!,filled=references.filter(item=>item.basis.trim()==='100g').length;
    defaults.closest<HTMLElement>('label')!.hidden=batch.reviewNames||!items.some(item=>item.kind==='ingredient'&&missingNutritionReference(item));
    defaults.checked=!!references.length&&filled===references.length;defaults.indeterminate=filled>0&&filled<references.length;defaults.disabled=!references.length;
    const byId=new Map(visible.map(item=>[item.id,item]));
    for(const card of list.querySelectorAll<HTMLElement>('[data-nutrition-item]')){
      const item=byId.get(card.dataset.nutritionItem!)!;
      card.querySelector<HTMLElement>('[data-name]')!.textContent=item.name;
      const missing=missingNutrition(item.values);
      card.querySelector<HTMLElement>('[data-source]')!.textContent=[item.id,item.kind==='ingredient'?'Ingredient reference':item.kind==='draft'?'Draft':'Logged',item.restaurant,item.date===undefined?'':excelDateText(item.date),missing.length?'Needs nutrition':''].filter(Boolean).join(' · ');
      card.querySelector<HTMLElement>('[data-nutrition-status]')!.textContent=[nutrients.filter(field=>!missing.includes(field)).map(field=>`${field}: ${item.values[field]}`).join(' · '),missing.length?`Missing: ${missing.map(field=>item.values[field]?.trim()?`${field} (${item.values[field]})`:field).join(', ')}`:''].filter(Boolean).join(' · ');
      card.querySelector<HTMLElement>('[data-original]')!.textContent='Original description: '+item.originalName;
      for(const input of card.querySelectorAll<HTMLInputElement>('[data-field]')){
        const field=input.dataset.field as 'selected'|'includeNotes'|'name'|'restaurant'|'basis';
        if(input.type==='checkbox')input.checked=!!item[field];else if(input!==document.activeElement)input.value=String(item[field]);
      }
      if(item.kind==='ingredient'){
        const missing=missingNutritionReference(item);
        const reference=[item.values.weight?.trim()?item.values.weight+'g':'',item.values.amount?.trim(),item.values.unit?.trim()].filter(Boolean).join(' ');
        card.querySelector<HTMLElement>('[data-reference]')!.textContent=hasReference(item)?`Reference: ${missing?item.basis:reference}`:missing?'Enter a reference serving before generating.':'Correct the reference in Ingredients, then reset this batch. Captured references cannot be replaced here.';
        let clear=card.querySelector<HTMLButtonElement>('[data-clear-basis]');
        if(!missing&&item.basis.trim()&&!clear){clear=document.createElement('button');clear.type='button';clear.dataset.clearBasis=item.id;clear.textContent='Use captured reference';card.append(clear);}
        if(missing||!item.basis.trim())clear?.remove();
      }
    }
    const reviewButton=element.querySelector<HTMLButtonElement>('[data-review-names]')!;
    reviewButton.setAttribute('aria-pressed',String(batch.reviewNames));reviewButton.disabled=!batch.generated&&!batch.reviewNames;
    reviewButton.title=reviewButton.disabled?'Generate a prompt before reviewing its names.':'Review the selected names included in this prompt.';
    element.querySelector<HTMLElement>('[data-name-backups]')!.hidden=!batch.reviewNames;
    element.querySelector<HTMLButtonElement>('[data-action="generate"]')!.textContent=batch.reviewNames?'Regenerate prompt':'Generate prompt';
    const saveNames=element.querySelector<HTMLButtonElement>('[data-action="save-names"]')!;saveNames.hidden=!batch.reviewNames;saveNames.disabled=savingNames;
    for(const action of ['new','reset'])element.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.hidden=batch.reviewNames;
    const select=element.querySelector<HTMLDetailsElement>('[data-items]')!,prompt=element.querySelector<HTMLDetailsElement>('[data-prompt]')!;
    if(select.open!==batch.selectOpen)select.open=batch.selectOpen;if(prompt.open!==batch.promptOpen)prompt.open=batch.promptOpen;
    const template=element.querySelector<HTMLTextAreaElement>('[data-template-input]')!;if(template!==document.activeElement&&template.value!==batch.template)template.value=batch.template;
    const promptText=promptValidationIssue?'':batch.prompt,text=element.querySelector<HTMLTextAreaElement>('[data-prompt-text]')!;if(text.value!==promptText)text.value=promptText;
    element.querySelector<HTMLElement>('[data-prompt-issue]')!.textContent=[promptValidationIssue,batch.promptIssue,batch.sourceChanges?.length?`${batch.sourceChanges.length} captured sources changed or were removed. The saved requests are unchanged; Generate asks before using them.`:''].filter(Boolean).join(' ');
    element.querySelector<HTMLElement>('[data-copy-status]')!.textContent=copiedPrompt===undefined?'':copiedPrompt===batch.prompt?'Copied current prompt.':'Prompt changed — copy again.';
    element.querySelector<HTMLButtonElement>('[data-action=copy]')!.disabled=!batch.generated||!batch.prompt||!!batch.promptIssue||!!promptValidationIssue;
    element.querySelector<HTMLElement>('[data-batch]')!.textContent=`Batch ${batch.id} · ${batch.created}`;
    element.querySelector<HTMLElement>('[data-selection-count]')!.textContent=`(${batch.items.filter(item=>item.selected&&eligible(item,selectedDays)).length} selected)`;
  };
  const queue=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{try{refresh();}catch(error){host.error(error);}});};
  element.addEventListener('input',event=>{
    const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||converterRoot.contains(input)||event instanceof InputEvent&&event.isComposing)return;
    if(input instanceof HTMLInputElement&&input.type!=='text'&&input.type!=='search')return;
    try{
      if(input.hasAttribute('data-template-input'))write('Edit nutrition template',[['foodCapture','builder','template'],['foodCapture','promptTemplate']],()=>{current().template=input.value;captureData(host.book()).promptTemplate=input.value;});
      else if(input.dataset.restaurantName){
        const ids=new Set((groups.get(input.dataset.restaurantName)??[]).map(item=>item.id)),batch=current();
        if(!ids.size)throw Error('This restaurant group changed. Reopen Review dish names.');
        const members=batch.items.map((item,index)=>({item,index})).filter(({item})=>ids.has(item.id));
        if(members.length!==ids.size)throw Error('This restaurant group changed. Reopen Review dish names.');
        write('Edit nutrition restaurant',members.map(({index})=>['foodCapture','builder','items',index,'restaurant']),()=>{for(const {item}of members)item.restaurant=input.value;});
      }else if(input.dataset.field){const id=input.closest<HTMLElement>('[data-nutrition-item]')!.dataset.nutritionItem!;editItem(id,input.dataset.field as 'name'|'restaurant'|'basis',input.value);}
      queue();
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('focusout',event=>{if(event.target instanceof HTMLInputElement&&event.target.hasAttribute('data-restaurant-name'))queue();},{signal:controller.signal});
  element.addEventListener('compositionend',event=>{if(event.target instanceof Node&&!converterRoot.contains(event.target))event.target.dispatchEvent(new InputEvent('input',{bubbles:true}));},{signal:controller.signal});
  element.addEventListener('change',event=>{
    const input=event.target;
    if(input instanceof Node&&converterRoot.contains(input))return;
    try{
      if(input instanceof HTMLInputElement){
        if(input.hasAttribute('data-name-import')){const file=input.files?.[0];if(file)void host.importNames(file).then(refresh).catch(host.error);input.value='';return;}
        if(input.dataset.selectGroup){
          const ids=new Set((groups.get(input.dataset.selectGroup)??[]).map(item=>item.id)),batch=current();
          write('Select nutrition group',batch.items.flatMap((item,index)=>ids.has(item.id)?[['foodCapture','builder','items',index,'selected'] as Patch['path']]:[]),()=>{for(const item of current().items)if(ids.has(item.id))item.selected=input.checked;});
        }else if(input.hasAttribute('data-100g')){
          const batch=current(),items=batch.items.map((item,index)=>({item,index})).filter(({item})=>item.kind==='ingredient'&&missingNutritionReference(item)&&(input.checked?!item.basis.trim():item.basis.trim()==='100g'));
          write('Set missing nutrition references',items.map(({index})=>['foodCapture','builder','items',index,'basis']),()=>{for(const {item}of items)item.basis=input.checked?'100g':'';});
        }else if(input.type==='checkbox'&&input.dataset.field)editItem(input.closest<HTMLElement>('[data-nutrition-item]')!.dataset.nutritionItem!,input.dataset.field as 'selected'|'includeNotes',input.checked);
        refresh();
      }
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;if(!button||button.disabled||converterRoot.contains(button))return;
    event.stopPropagation();
    if(button.closest('summary'))event.preventDefault();
    try{
      if(button.dataset.dayMode){
        const multiDay=button.dataset.dayMode==='multi';
        write('Choose nutrition day mode',[['foodCapture','builder','multiDay'],['foodCapture','builder','days']],()=>{const batch=current();batch.multiDay=multiDay;if(!multiDay)batch.days=batch.days.slice(0,1);});
        pages.clear();refresh();return;
      }
      if(button.dataset.workflow){
        const workflow=button.dataset.workflow;if(workflow!=='builder'&&workflow!=='converter')throw Error('Invalid nutrition workflow.');
        host.write('Choose nutrition workflow',[['foodCapture','builder','workflow']],()=>{current().workflow=workflow;});
        refresh();return;
      }
      if(button.dataset.clearBasis){editItem(button.dataset.clearBasis,'basis','');refresh();return;}
      if(button.dataset.page){const kind=button.dataset.kind;if(!kind||!kinds.some(value=>value===kind))throw Error('Invalid nutrition section.');pages.set(kind,(pages.get(kind)??0)+Number(button.dataset.page));refresh();return;}
      switch(button.dataset.action){
        case'back':host.back();return;
        case'close':host.close();return;
        case'reset':host.reset();break;
        case'new':host.checkNew();break;
        case'generate':host.generate();break;
        case'review':write('Review nutrition names',[['foodCapture','builder','reviewNames'],['foodCapture','builder','selectOpen'],['foodCapture','builder','promptOpen'],['foodCapture','nameVersions']],()=>{
          const batch=current();if(!batch.reviewNames)saveNameVersion(captureData(host.book()));
          batch.reviewNames=!batch.reviewNames;batch.selectOpen=!batch.reviewNames;if(batch.reviewNames)batch.promptOpen=true;
        },false);break;
        case'save-names':
          if(savingNames)return;
          savingNames=true;refresh();
          void host.saveNames().catch(host.error).finally(()=>{savingNames=false;if(!controller.signal.aborted)refresh();});return;
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
    details.addEventListener('toggle',()=>{
      const batch=host.book().foodCapture?.builder;if(!batch)return;
      const leaveReview=field==='selectOpen'&&details.open&&batch.reviewNames;
      if(batch[field]!==details.open||leaveReview){
        const paths:Patch['path'][]=[['foodCapture','builder',field],...(leaveReview?[['foodCapture','builder','reviewNames'] as Patch['path']]:[])];
        if(host.write('Remember nutrition panel',paths,()=>{current()[field]=details.open;if(leaveReview)current().reviewNames=false;})&&leaveReview)refresh();
      }
    },{signal:controller.signal});
  }
  return{element,refresh,saved:converter.saved,dispose:()=>{cancelAnimationFrame(frame);datePopup.close();controller.abort();converter.dispose();}};
}
