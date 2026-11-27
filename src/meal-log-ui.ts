import './meal-log.css';
import {dropdownArrowHtml,mountDropdownOptions,mountDropdownPopup} from './dropdown-ui';
import {navigationIcon,toolbarIcon} from './icons';
import {mealFields,type MealField} from './meal-log';
import {virtualKeyboard} from './touch-keyboard';
import {restaurantFieldHtml,type RestaurantField} from './restaurant-ui';

export interface MealLogView{
  header:string;date:string;totals:string;undo:boolean;redo:boolean;busy:boolean;
  weight:{value:string;numeric:boolean;calculated:boolean};
  fields:Partial<Record<MealField,{name:string;numeric:boolean}>>;
  rows:{id:string;values:Partial<Record<MealField,string>>;calculated:MealField[];manual:boolean;meal?:string;needsNutrition:boolean;totals:string}[];
}
export type MealLogInputField=MealField|'dayWeight';
export type MealLogTab='formal'|'draft'|'ingredients'|'table'|'nutrition'|'gallery';
export interface FoodPanel{element:HTMLElement;refresh:()=>void;dispose:()=>void}
export interface MealLogHost{
  view:()=>MealLogView;close:()=>void;today:()=>void;day:(direction:-1|1)=>void;
  activateTab:(tab:MealLogTab)=>boolean;tabChanged:()=>void;
  date:(button:HTMLButtonElement)=>void;write:(row:string,field:MealLogInputField,value:string)=>boolean;
  select:(row:string,field:MealLogInputField)=>void;dropdown:(row:string,field:MealField,anchor:HTMLElement)=>void;
  add:(after?:string)=>void;move:(row:string,direction:-1|1)=>void;remove:(row:string)=>void;
  ingredient:(row:string)=>void;history:(action:'undo'|'redo')=>void;error:(error:unknown)=>void;
  restaurant?:(row:string,element:HTMLElement)=>RestaurantField;restaurants?:()=>void;
  nutritionReview?:{count:()=>number;open:()=>void};
  draft?:FoodPanel;ingredients?:FoodPanel;nutrition?:FoodPanel;gallery?:FoodPanel;
  table?:FoodPanel&{navigate:(direction:-1|1)=>void;last:()=>void;commit:()=>boolean;rememberScroll:()=>void;restoreScroll:()=>void;restoreFocus:()=>void};
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const captions:Record<MealField,string>={food:'Food',calories:'Calories',protein:'Protein (g)',fat:'Fat (g)',carbs:'Carbs (g)',sugar:'Sugar (g)',sodium:'Sodium (mg)',weight:'Grams',amount:'Amount',unit:'Unit',notes:'Notes'};
const icon=(label:string,svg:string,disabled=false)=>`<button type="button" class="icon-button group-control summary-chevron" aria-label="${label}" title="${label}" ${disabled?'disabled data-log-boundary':''}>${svg}</button>`;
export function mountMealLog(host:MealLogHost,initialTab:MealLogTab='formal'){
  const element=document.createElement('aside'),controller=new AbortController(),expanded=new Set<string>(),notesExpanded=new Set<string>(),quantitiesExpanded=new Set<string>(),dirty=new WeakSet<HTMLInputElement|HTMLTextAreaElement>();
  element.className='meal-log-panel';element.setAttribute('aria-label','Meal log');
  element.innerHTML=`<header class="meal-log-header"><nav class="panel-tabs" role="tablist" aria-label="Meal logging mode"><button type="button" role="tab" id="meal-log-formal-tab" data-log-tab="formal" aria-controls="meal-log-formal">Formal</button><button type="button" role="tab" id="meal-log-draft-tab" data-log-tab="draft" aria-controls="meal-log-draft">Draft</button></nav><button type="button" data-log-unavailable disabled title="Get nutrition is not available yet">Get Nutrition</button>${icon('Close Meal log',toolbarIcon('close'))}</header><div class="meal-log-day-bar"><button type="button" data-log-today>Today</button>${icon('Previous day',toolbarIcon('previous'))}${icon('Next day',toolbarIcon('next'))}<button type="button" data-log-date aria-label="Choose log date"></button><span class="meal-log-day-totals"></span></div><div class="meal-log-scroll" id="meal-log-formal" role="tabpanel" aria-labelledby="meal-log-formal-tab"></div><section class="meal-log-draft" id="meal-log-draft" role="tabpanel" aria-labelledby="meal-log-draft-tab" tabindex="0"><p class="muted">Draft capture is not available yet.</p></section><footer class="meal-log-footer"><button type="button" data-log-add>+ Food</button>${icon('Undo',toolbarIcon('undo'))}${icon('Redo',toolbarIcon('redo'))}${icon('Next field',toolbarIcon('next-field'))}</footer>`;
  const scroll=element.querySelector<HTMLElement>('.meal-log-scroll')!,footer=element.querySelector<HTMLElement>('.meal-log-footer')!;
  if(host.draft)element.querySelector('.meal-log-draft')!.replaceChildren(host.draft.element);
  if(host.restaurants){const button=document.createElement('button');button.type='button';button.textContent='Restaurants';button.onclick=host.restaurants;footer.querySelector('[data-log-add]')!.after(button);}
  const restaurantFields:RestaurantField[]=[];
  element.querySelector('#meal-log-formal-tab')!.textContent='Logged';
  const panels={draft:host.draft,ingredients:host.ingredients,table:host.table,nutrition:host.nutrition,gallery:host.gallery};
  const labels={ingredients:'Ingredients',table:'Ingredients TABLE',nutrition:'Get nutrition',gallery:'Photos'};
  const more=document.createElement('button');more.type='button';more.className='icon-button';more.setAttribute('aria-label','Food panels');more.innerHTML=`<span class="format-caret">${dropdownArrowHtml}</span>`;
  const nutrition=element.querySelector<HTMLButtonElement>('[data-log-unavailable]')!;
  nutrition.before(more);more.hidden=!host.ingredients&&!host.gallery&&!host.nutritionReview;
  for(const name of ['ingredients','table','nutrition','gallery'] as const)if(panels[name]){
    const section=document.createElement('section');section.className='capture-wrapper';section.dataset.captureView=name;section.setAttribute('aria-label',labels[name]);section.hidden=true;section.append(panels[name]!.element);footer.before(section);
  }
  if(host.nutrition){nutrition.removeAttribute('data-log-unavailable');nutrition.removeAttribute('title');nutrition.disabled=false;nutrition.dataset.logOpen='nutrition';}
  const morePopup=mountDropdownPopup(more,'Food panels',(panel,position,close)=>{
    const choices:('ingredients'|'gallery'|'review')[]=(['ingredients','gallery'] as const).filter(name=>panels[name]);
    if(host.nutritionReview?.count())choices.push('review');
    const view=mountDropdownOptions(panel,{choices,name:'Food panels',value:name=>name==='review'?`Review nutrition changes (${host.nutritionReview!.count()})`:labels[name],selected:name=>name===tab,position,choose:name=>{close();if(name==='review')host.nutritionReview!.open();else showTab(name);}});
    view.search.focus({preventScroll:true});return view.dispose;
  },230);
  const button=(label:string)=>(footer.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)??element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`))!;
  const tableMode=initialTab==='table',tableNav=document.createElement('nav');
  if(tableMode){
    element.setAttribute('aria-label','Ingredients TABLE');
    element.querySelector<HTMLElement>('[aria-label="Meal logging mode"]')!.hidden=true;
    more.hidden=true;tableNav.className='ingredient-table-nav';tableNav.setAttribute('aria-label','Ingredient navigation');
    tableNav.innerHTML=icon('Previous Ingredient',navigationIcon('up'))+icon('Next Ingredient',navigationIcon('down'));
    nutrition.before(tableNav);
    button('Close Meal log').setAttribute('aria-label','Close Ingredients TABLE');
  }
  for(const control of element.querySelectorAll('button:not([role="tab"])'))if(!control.closest('.photo-strip')&&!control.hasAttribute('data-draft-photo'))control.classList.add('group-control','summary-chevron');
  let shape='',active:{row:string;field:MealLogInputField}|undefined,lastHeader='',focusMode=false,writing=false,savedScroll=0,pendingBottom=true,atBottom=true,scrollFrame=0;
  let tab=initialTab;
  const drawTab=()=>{
    for(const button of element.querySelectorAll<HTMLButtonElement>('[data-log-tab]')){
      const selected=button.dataset.logTab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    }
    for(const section of [scroll,footer,element.querySelector<HTMLElement>('.meal-log-day-bar')!])section.hidden=tab!=='formal';
    element.querySelector<HTMLElement>('.meal-log-draft')!.hidden=tab!=='draft';
    for(const section of element.querySelectorAll<HTMLElement>('[data-capture-view]'))section.hidden=section.dataset.captureView!==tab;
    more.setAttribute('aria-pressed',String(tab==='ingredients'||tab==='gallery'));
    nutrition.setAttribute('aria-pressed',String(tab==='nutrition'));
    if(tableMode)tableNav.hidden=tab!=='table';
  };
  drawTab();
  let weightEdit:{row:string;value:string}|undefined;
  let observedHeader:Element|undefined;
  let fullHeight=window.visualViewport?.height??innerHeight;
  const touch=()=>document.body.classList.contains('touch-input-device');
  const fieldInput=(row:string,field:MealLogInputField)=>element.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[data-log-row="${row}"][data-log-field="${field}"]`);
  scroll.addEventListener('scroll',()=>{savedScroll=scroll.scrollTop;atBottom=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<1;},{signal:controller.signal});
  const restoreScroll=()=>{
    cancelAnimationFrame(scrollFrame);
    scrollFrame=requestAnimationFrame(()=>{if(!element.isConnected||tab!=='formal')return;position();scroll.scrollTop=pendingBottom?scroll.scrollHeight:savedScroll;pendingBottom=false;});
  };
  const position=()=>{
    if(!element.isConnected||!touch()){element.style.removeProperty('top');element.style.removeProperty('height');return;}
    const header=document.querySelector('.app-header');
    if(header!==observedHeader){if(observedHeader)resize.unobserve(observedHeader);observedHeader=header??undefined;if(header)resize.observe(header);}
    const viewport=window.visualViewport,top=Math.max(viewport?.offsetTop??0,header?.getBoundingClientRect().bottom??0);
    const height=viewport?.height??innerHeight;if(!focusMode)fullHeight=height;
    const viewportBottom=(viewport?.offsetTop??0)+height,bounds=virtualKeyboard?.boundingRect,overlay=!!bounds&&bounds.height>0&&bounds.top<viewportBottom&&bounds.bottom>top;
    const bottom=overlay?Math.max(top,bounds.top):viewportBottom,keyboard=overlay||innerHeight-height>80||focusMode&&fullHeight-height>80;
    document.body.classList.toggle('meal-log-keyboard',keyboard);
    const tabs=keyboard?0:document.querySelector('.sheet-bar')?.getBoundingClientRect().height??0;
    element.style.top=top+'px';element.style.height=Math.max(0,bottom-top-tabs)+'px';
  };
  const resize=new ResizeObserver(()=>{
    if(!element.isConnected)return;
    if(tab!=='formal'){position();return;}
    if(atBottom){pendingBottom=true;restoreScroll();}else position();
  });
  resize.observe(scroll);
  const reveal=(row:string,field?:MealLogInputField,focus=false)=>{
    if(tab!=='formal')return;
    const card=field==='dayWeight'?element.querySelector<HTMLElement>('.meal-log-day-weight'):element.querySelector<HTMLElement>(`[data-log-card="${row}"]`);
    if(!card)return;
    if(field&&field!=='dayWeight'&&mealFields.slice(1,7).includes(field))expanded.add(row);
    const details=card.querySelector<HTMLDetailsElement>('.meal-log-macros');
    if(details&&expanded.has(row))details.open=true;
    if(field==='notes'){notesExpanded.add(row);card.querySelector<HTMLDetailsElement>('.meal-log-notes')!.open=true;}
    const quantities=card.querySelector<HTMLDetailsElement>('.meal-log-quantities');
    if(quantities&&field&&['weight','amount','unit'].includes(field)){quantitiesExpanded.add(quantities.dataset.quantityKey!);quantities.open=true;}
    pendingBottom=false;
    card.scrollIntoView({block:'nearest'});
    if(field){
      const input=fieldInput(row,field);
      input?.scrollIntoView({block:'nearest'});
      if(focus)input?.focus({preventScroll:true});
    }
  };
  const openPicker=(row:string,field:MealField,anchor:HTMLElement)=>{
    active={row,field};host.dropdown(row,field,anchor);
  };
  const startFood=(row:string)=>{
    reveal(row,'food',true);
    const input=fieldInput(row,'food');
    if(input&&!input.disabled&&input.dataset.logManual!=='true')openPicker(row,'food',input.closest<HTMLElement>('.meal-log-input')!);
  };
  const update=()=>{
    if(tab!=='formal'){panels[tab]?.refresh();position();return;}
    const view=host.view(),before=active&&fieldInput(active.row,active.field),focused=before===document.activeElement,caret=before?[before.selectionStart,before.selectionEnd]:undefined;
    if(writing&&focused&&active?.field==='dayWeight')weightEdit={row:view.header,value:view.weight.value};
    const keepWeight=focused&&active?.field==='dayWeight'&&weightEdit?.row===view.header&&weightEdit.value===view.weight.value;
    if(!keepWeight)weightEdit=undefined;
    const currentShape=JSON.stringify([view.header,view.fields,view.rows.map(row=>[row.id,row.manual,row.meal])]);
    if(currentShape!==shape){
      shape=currentShape;
      for(const field of restaurantFields)field.dispose();restaurantFields.length=0;
      scroll.innerHTML=`<label class="meal-log-field meal-log-day-weight"><span>Weight</span><input data-log-row="${view.header}" data-log-field="dayWeight" aria-label="Weight" autocomplete="off" enterkeyhint="next" inputmode="${view.weight.numeric?'decimal':'text'}" value="${esc(view.weight.value)}"></label>`+(view.rows.length?view.rows.map((row,i)=>{
        const field=(name:MealField)=>{
          const info=view.fields[name];if(!info)return'';
          const dropdown=name==='food';
          const attributes=`data-log-row="${row.id}" data-log-field="${name}" aria-label="${captions[name]}" autocomplete="off" enterkeyhint="next"`;
          const input=name==='notes'?`<textarea ${attributes} rows="3">${esc(row.values[name])}</textarea>`:`<input ${attributes} inputmode="${info.numeric||mealFields.slice(1,7).includes(name)?'decimal':'text'}" value="${esc(row.values[name])}" ${name==='food'?`data-log-manual="${row.manual}" ${row.manual?'placeholder="Manual input"':'readonly'}`:''}>`;
          return`<label class="meal-log-field" title="${esc(info.name)}">${name==='notes'?'':`<span>${captions[name]}${name==='food'?' <span class="count" data-log-needs-nutrition hidden>Needs nutrition</span>':''}</span>`}<span class="meal-log-input">${input}${dropdown?`<button type="button" class="icon-button" data-log-dropdown="${name}" aria-label="Choose ${captions[name]}"><span class="format-caret">${dropdownArrowHtml}</span></button>`:''}</span></label>`;
        };
        const quantities=`<div class="meal-log-fields">${(['weight','amount','unit'] as const).map(field).join('')}</div>`,quantityKey=row.id+':'+row.meal;
        return`<section class="meal-log-card" data-log-card="${row.id}" aria-label="Food ${i+1}">${host.restaurant?restaurantFieldHtml():''}${field('food')}<details class="meal-log-macros" ${expanded.has(row.id)?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Macros</span><span data-log-totals></span></summary><div class="meal-log-fields">${mealFields.slice(1,7).map(field).join('')}</div></details>${row.meal?`<details class="meal-log-quantities" data-quantity-key="${quantityKey}" ${quantitiesExpanded.has(quantityKey)?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Grams</span></summary>${quantities}</details>`:quantities}${view.fields.notes?`<details class="meal-log-notes" data-log-notes ${notesExpanded.has(row.id)?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Notes</span></summary>${field('notes')}</details>`:''}${row.manual?'<label class="inline meal-log-ingredient"><input type="checkbox" data-log-ingredient>Add to Ingredients</label>':''}<div class="meal-log-row-actions">${icon('Move food up',navigationIcon('up'),i===0)}${icon('Move food down',navigationIcon('down'),i===view.rows.length-1)}<button type="button" data-log-insert>+ Food</button>${icon('Delete food',toolbarIcon('trash'))}</div></section>`;
      }).join(''):'<p class="muted">No foods in this day. Use + Food to start logging.</p>');
      if(host.restaurant)for(const card of scroll.querySelectorAll<HTMLElement>('[data-log-card]'))restaurantFields.push(host.restaurant(card.dataset.logCard!,card));
      for(const details of scroll.querySelectorAll<HTMLDetailsElement>('details'))details.ontoggle=()=>{const row=details.closest<HTMLElement>('[data-log-card]')!.dataset.logCard!,state=details.classList.contains('meal-log-notes')?notesExpanded:details.classList.contains('meal-log-quantities')?quantitiesExpanded:expanded,id=details.dataset.quantityKey??row;if(details.open)state.add(id);else state.delete(id);};
      if(focused&&active){const input=fieldInput(active.row,active.field);if(input&&keepWeight&&before)input.value=before.value;input?.focus({preventScroll:true});if(input&&caret?.[0]!=null&&caret[1]!=null)input.setSelectionRange(caret[0],caret[1]);}
    }
    const weight=fieldInput(view.header,'dayWeight')!;
    if(!keepWeight&&weight.value!==view.weight.value)weight.value=view.weight.value;
    weight.disabled=view.busy;weight.classList.toggle('calculated',view.weight.calculated);
    for(const row of view.rows){
      element.querySelector<HTMLElement>(`[data-log-card="${row.id}"] [data-log-totals]`)!.textContent=row.totals;
      element.querySelector<HTMLElement>(`[data-log-card="${row.id}"] [data-log-needs-nutrition]`)!.hidden=!row.needsNutrition;
      for(const field of mealFields){const input=fieldInput(row.id,field),value=row.values[field]??'';if(input&&(!writing||input!==document.activeElement)&&input.value!==value)input.value=value;if(input){input.disabled=view.busy;input.classList.toggle('calculated',row.calculated.includes(field));}}
    }
    element.querySelector<HTMLElement>('[data-log-date]')!.textContent=view.date;
    for(const button of element.querySelectorAll('button')){
      if(button.hasAttribute('data-log-tab'))continue;
      button.disabled=view.busy||button.hasAttribute('data-log-boundary')||button.hasAttribute('data-log-unavailable');
    }
    button('Close Meal log').disabled=false;
    for(const row of view.rows){const checkbox=element.querySelector<HTMLInputElement>(`[data-log-card="${row.id}"] [data-log-ingredient]`);if(checkbox)checkbox.disabled=view.busy;}
    element.querySelector<HTMLElement>('.meal-log-day-totals')!.textContent=view.totals;
    button('Undo').disabled=!view.undo||view.busy;button('Redo').disabled=!view.redo||view.busy;
    footer.querySelector<HTMLButtonElement>('[data-log-add]')!.disabled=view.busy;
    button('Next field').hidden=!touch()||!focusMode;
    for(const field of restaurantFields)field.refresh(view.busy);
    if(lastHeader!==view.header){lastHeader=view.header;pendingBottom=true;restoreScroll();}
    position();
  };
  const write=(input:HTMLInputElement|HTMLTextAreaElement)=>{
    writing=true;
    try{const saved=host.write(input.dataset.logRow!,input.dataset.logField as MealLogInputField,input.value);if(saved)dirty.delete(input);return saved;}
    finally{writing=false;}
  };
  const showTab=(next:MealLogTab)=>{
    if(next===tab)return;
    try{
      const input=active&&fieldInput(active.row,active.field);
      if(input&&dirty.has(input)&&!write(input))return;
      if(!host.activateTab(next))return;
      if(tab==='formal')savedScroll=scroll.scrollTop;
      tab=next;focusMode=false;document.body.classList.remove('meal-log-keyboard');
      drawTab();update();if(tab==='formal')restoreScroll();host.tabChanged();
    }catch(error){host.error(error);}
  };
  const next=()=>{
    const focused=document.activeElement,current=(focused instanceof HTMLInputElement||focused instanceof HTMLTextAreaElement)&&scroll.contains(focused)?focused:active&&fieldInput(active.row,active.field);
    if(!current)return;
    const inputs=[...scroll.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[data-log-field],[data-restaurant-input]')].filter(input=>!input.disabled&&input.checkVisibility()),at=inputs.indexOf(current);
    if(current&&dirty.has(current)&&!write(current))return;
    const target=inputs[at+1];if(target){target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}else current?.blur();
  };
  element.addEventListener('focusin',event=>{
    const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||!input.dataset.logField)return;
    active={row:input.dataset.logRow!,field:input.dataset.logField as MealLogInputField};focusMode=true;
    host.select(active.row,active.field);button('Next field').hidden=!touch();
    input.scrollIntoView({block:'nearest'});position();
  });
  element.addEventListener('input',event=>{
    const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||!input.dataset.logField)return;
    dirty.add(input);if(event instanceof InputEvent&&event.isComposing)return;
    write(input);
  });
  const syncFocus=()=>{
    const target=document.activeElement;
    focusMode=(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement)&&element.isConnected&&(element.contains(target)||!!target.closest('[data-meal-log-picker]'));
    button('Next field').hidden=!touch()||!focusMode;position();
  };
  document.addEventListener('focusin',syncFocus,{signal:controller.signal});
  document.addEventListener('focusout',()=>queueMicrotask(syncFocus),{signal:controller.signal});
  element.addEventListener('compositionend',event=>{const input=event.target;if((input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)&&input.dataset.logField)write(input);});
  element.addEventListener('pointerdown',event=>{
    const target=event.target;if(!(target instanceof Element))return;
    if(touch()&&target.closest('[data-log-add],[data-log-insert],[data-log-dropdown]'))event.preventDefault();
    if(target.closest('button'))return;
    const input=target.closest('.meal-log-field')?.querySelector<HTMLInputElement>('input[data-log-field="food"]');
    if(input&&!input.disabled&&input.dataset.logManual!=='true')event.preventDefault();
  });
  element.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.target instanceof Element&&event.target.closest('[aria-label="Meal logging mode"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();showTab(event.key==='Home'?'formal':event.key==='End'?'draft':tab==='formal'?'draft':'formal');
      if(element.isConnected)element.querySelector<HTMLButtonElement>(`[data-log-tab="${tab}"]`)!.focus();
    }
    else if(event.key==='Escape'){event.preventDefault();host.close();}
    else if(tab==='formal'&&event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();next();}
    else if(tab==='formal'&&(event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();host.history(event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo');}
    event.stopPropagation();
  });
  footer.addEventListener('pointerdown',event=>{if(touch()&&focusMode)event.preventDefault();});
  element.addEventListener('click',event=>{
    const source=event.target instanceof Element?event.target:null,target=source?.closest<HTMLButtonElement>('button');
    if(!target){
      const input=source?.closest('.meal-log-field')?.querySelector<HTMLInputElement>('input[data-log-field="food"]');
      if(input&&!input.disabled&&input.dataset.logManual!=='true'){
        event.preventDefault();openPicker(input.dataset.logRow!,'food',input.closest<HTMLElement>('.meal-log-input')!);
      }
      return;
    }
    const row=target.closest<HTMLElement>('[data-log-card]')?.dataset.logCard;
    if(target.closest('[data-capture-view="table"]'))return;
    if(target.dataset.logTab){showTab(target.dataset.logTab as MealLogTab);return;}
    if(target.dataset.logOpen){showTab(target.dataset.logOpen as MealLogTab);return;}
    if(target.dataset.logDropdown&&row){event.preventDefault();openPicker(row,target.dataset.logDropdown as MealField,target.closest<HTMLElement>('.meal-log-input')!);return;}
    if(target.hasAttribute('data-log-insert')&&row){host.add(row);return;}
    if(target.hasAttribute('data-log-add')){host.add();return;}
    if(target.hasAttribute('data-log-today')){host.today();return;}
    if(target.hasAttribute('data-log-date')){host.date(target);return;}
    switch(target.getAttribute('aria-label')){
      case 'Close Meal log':case 'Close Ingredients TABLE':host.close();break;
      case 'Previous Ingredient':host.table?.navigate(-1);break;case 'Next Ingredient':host.table?.navigate(1);break;
      case 'Previous day':host.day(-1);break;case 'Next day':host.day(1);break;
      case 'Undo':host.history('undo');break;case 'Redo':host.history('redo');break;
      case 'Next field':next();break;
      case 'Move food up':if(row)host.move(row,-1);break;case 'Move food down':if(row)host.move(row,1);break;
      case 'Delete food':if(row)host.remove(row);break;
    }
  });
  element.addEventListener('change',event=>{
    const checkbox=event.target;if(!(checkbox instanceof HTMLInputElement)||!checkbox.hasAttribute('data-log-ingredient'))return;
    host.ingredient(checkbox.closest<HTMLElement>('[data-log-card]')!.dataset.logCard!);
    if(checkbox.isConnected)checkbox.checked=false;
  });
  window.addEventListener('resize',position,{signal:controller.signal});
  window.visualViewport?.addEventListener('resize',()=>{position();if(active)reveal(active.row,active.field);},{signal:controller.signal});
  window.visualViewport?.addEventListener('scroll',position,{signal:controller.signal});
  virtualKeyboard?.addEventListener('geometrychange',position,{signal:controller.signal});
  const foodMode=(row:string,manual:boolean)=>{
    if(manual)expanded.delete(row);
    for(const key of quantitiesExpanded)if(key.startsWith(row+':'))quantitiesExpanded.delete(key);
    const card=element.querySelector<HTMLElement>(`[data-log-card="${row}"]`);
    for(const details of card?.querySelectorAll<HTMLDetailsElement>(manual?'.meal-log-macros,.meal-log-quantities':'.meal-log-quantities')??[])details.open=false;
  };
  return{element,get tab(){return tab;},tableMode,commit:()=>host.table?.commit()??true,showTab,refresh:()=>{try{update();}catch(error){host.error(error);}},reveal,startFood,foodMode,tableLast:()=>host.table?.last(),bottom:()=>{pendingBottom=true;restoreScroll();},rememberScroll:()=>{if(element.isConnected&&tab==='formal')savedScroll=scroll.scrollTop;if(element.isConnected&&tab==='table')host.table?.rememberScroll();},restoreScroll:()=>{if(tab==='table')host.table?.restoreScroll();else restoreScroll();},dispose:()=>{morePopup.close();resize.disconnect();for(const field of restaurantFields)field.dispose();for(const panel of Object.values(panels))panel?.dispose();controller.abort();cancelAnimationFrame(scrollFrame);element.remove();document.body.classList.remove('meal-log-keyboard');},restoreFocus:()=>{
    if(tab==='formal'&&active&&focusMode)fieldInput(active.row,active.field)?.focus({preventScroll:true});
    else if(tab==='table')host.table?.restoreFocus();
  }};
}
