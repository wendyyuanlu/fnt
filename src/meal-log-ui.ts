import './meal-log.css';
import {dropdownArrowHtml} from './dropdown-ui';
import {navigationIcon,toolbarIcon} from './icons';
import {mealFields,type MealField} from './meal-log';

export interface MealLogView{
  header:string;date:string;totals:string;undo:boolean;redo:boolean;busy:boolean;
  weight:{value:string;numeric:boolean;calculated:boolean};
  fields:Partial<Record<MealField,{name:string;numeric:boolean}>>;
  rows:{id:string;values:Partial<Record<MealField,string>>;calculated:MealField[];manual:boolean;meal?:string;totals:string}[];
}
export type MealLogInputField=MealField|'dayWeight';
export interface MealLogHost{
  view:()=>MealLogView;close:()=>void;today:()=>void;day:(direction:-1|1)=>void;
  date:(button:HTMLButtonElement)=>void;write:(row:string,field:MealLogInputField,value:string)=>boolean;
  select:(row:string,field:MealLogInputField)=>void;dropdown:(row:string,field:MealField,anchor:HTMLElement)=>void;
  add:(after?:string)=>void;move:(row:string,direction:-1|1)=>void;remove:(row:string)=>void;
  ingredient:(row:string)=>void;history:(action:'undo'|'redo')=>void;error:(error:unknown)=>void;
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const captions:Record<MealField,string>={food:'Food',calories:'Calories',protein:'Protein (g)',fat:'Fat (g)',carbs:'Carbs (g)',sugar:'Sugar (g)',sodium:'Sodium (mg)',weight:'Grams',amount:'Amount',unit:'Unit',notes:'Notes'};
const icon=(label:string,svg:string,disabled=false)=>`<button type="button" class="icon-button group-control summary-chevron" aria-label="${label}" title="${label}" ${disabled?'disabled data-log-boundary':''}>${svg}</button>`;
export function mountMealLog(host:MealLogHost){
  const element=document.createElement('aside'),controller=new AbortController(),expanded=new Set<string>(),notesExpanded=new Set<string>(),quantitiesExpanded=new Set<string>(),dirty=new WeakSet<HTMLInputElement|HTMLTextAreaElement>();
  element.className='meal-log-panel';element.setAttribute('aria-label','Meal log');
  element.innerHTML=`<header class="meal-log-header">${icon('Close Meal log',toolbarIcon('close'))}<button type="button" data-log-today>Today</button>${icon('Previous day',toolbarIcon('previous'))}${icon('Next day',toolbarIcon('next'))}<button type="button" data-log-date aria-label="Choose log date"></button><span class="meal-log-day-totals"></span></header><div class="meal-log-scroll"></div><footer class="meal-log-footer"><button type="button" data-log-add>+ Food</button>${icon('Undo',toolbarIcon('undo'))}${icon('Redo',toolbarIcon('redo'))}${icon('Next field',toolbarIcon('next-field'))}</footer>`;
  const scroll=element.querySelector<HTMLElement>('.meal-log-scroll')!,footer=element.querySelector<HTMLElement>('.meal-log-footer')!;
  const button=(label:string)=>element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  let shape='',active:{row:string;field:MealLogInputField}|undefined,lastHeader='',focusMode=false,writing=false,savedScroll=0,pendingBottom=true,scrollFrame=0;
  let fullHeight=window.visualViewport?.height??innerHeight;
  const touch=()=>document.body.classList.contains('touch-input-device');
  const fieldInput=(row:string,field:MealLogInputField)=>element.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[data-log-row="${row}"][data-log-field="${field}"]`);
  scroll.addEventListener('scroll',()=>{savedScroll=scroll.scrollTop;},{signal:controller.signal});
  const restoreScroll=()=>{
    cancelAnimationFrame(scrollFrame);
    scrollFrame=requestAnimationFrame(()=>{if(!element.isConnected)return;scroll.scrollTop=pendingBottom?scroll.scrollHeight:savedScroll;pendingBottom=false;position();});
  };
  const position=()=>{
    if(!element.isConnected||!touch()){element.style.removeProperty('top');element.style.removeProperty('height');return;}
    const viewport=window.visualViewport,top=Math.max(viewport?.offsetTop??0,document.querySelector('.app-header')?.getBoundingClientRect().bottom??0);
    const height=viewport?.height??innerHeight;if(!focusMode)fullHeight=height;
    const bottom=(viewport?.offsetTop??0)+height,keyboard=innerHeight-height>80||focusMode&&fullHeight-height>80;
    document.body.classList.toggle('meal-log-keyboard',keyboard);
    const tabs=keyboard?0:document.querySelector('.sheet-bar')?.getBoundingClientRect().height??0;
    element.style.top=top+'px';element.style.height=Math.max(0,bottom-top-tabs)+'px';
  };
  const reveal=(row:string,field?:MealLogInputField,focus=false)=>{
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
  const update=()=>{
    const view=host.view(),before=active&&fieldInput(active.row,active.field),focused=before===document.activeElement,caret=before?[before.selectionStart,before.selectionEnd]:undefined;
    const currentShape=JSON.stringify([view.header,view.fields,view.rows.map(row=>[row.id,row.manual,row.meal])]);
    if(currentShape!==shape){
      shape=currentShape;
      scroll.innerHTML=`<label class="meal-log-field meal-log-day-weight"><span>Weight</span><input data-log-row="${view.header}" data-log-field="dayWeight" aria-label="Weight" autocomplete="off" enterkeyhint="next" inputmode="${view.weight.numeric?'decimal':'text'}" value="${esc(view.weight.value)}"></label>`+(view.rows.length?view.rows.map((row,i)=>{
        const field=(name:MealField)=>{
          const info=view.fields[name];if(!info)return'';
          const dropdown=name==='food';
          const attributes=`data-log-row="${row.id}" data-log-field="${name}" aria-label="${captions[name]}" autocomplete="off" enterkeyhint="next"`;
          const input=name==='notes'?`<textarea ${attributes} rows="3">${esc(row.values[name])}</textarea>`:`<input ${attributes} inputmode="${info.numeric||mealFields.slice(1,7).includes(name)?'decimal':'text'}" value="${esc(row.values[name])}" ${name==='food'?`data-log-manual="${row.manual}" ${row.manual?'placeholder="Manual input"':'readonly'}`:''}>`;
          return`<label class="meal-log-field" title="${esc(info.name)}">${name==='notes'?'':`<span>${captions[name]}</span>`}<span class="meal-log-input">${input}${dropdown?`<button type="button" class="icon-button" data-log-dropdown="${name}" aria-label="Choose ${captions[name]}"><span class="format-caret">${dropdownArrowHtml}</span></button>`:''}</span></label>`;
        };
        const quantities=`<div class="meal-log-fields">${(['weight','amount','unit'] as const).map(field).join('')}</div>`,quantityKey=row.id+':'+row.meal;
        return`<section class="meal-log-card" data-log-card="${row.id}" aria-label="Food ${i+1}">${field('food')}<details class="meal-log-macros" ${expanded.has(row.id)?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Macros</span><span data-log-totals></span></summary><div class="meal-log-fields">${mealFields.slice(1,7).map(field).join('')}</div></details>${row.meal?`<details class="meal-log-quantities" data-quantity-key="${quantityKey}" ${quantitiesExpanded.has(quantityKey)?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Grams</span></summary>${quantities}</details>`:quantities}${view.fields.notes?`<details class="meal-log-notes" ${notesExpanded.has(row.id)?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Notes</span></summary>${field('notes')}</details>`:''}${row.manual?'<label class="inline meal-log-ingredient"><input type="checkbox" data-log-ingredient>Add to Ingredients</label>':''}<div class="meal-log-row-actions">${icon('Move food up',navigationIcon('up'),i===0)}${icon('Move food down',navigationIcon('down'),i===view.rows.length-1)}<button type="button" data-log-insert>+ Food</button>${icon('Delete food',toolbarIcon('trash'))}</div></section>`;
      }).join(''):'<p class="muted">No foods in this day. Use + Food to start logging.</p>');
      for(const details of scroll.querySelectorAll<HTMLDetailsElement>('details'))details.ontoggle=()=>{const row=details.closest<HTMLElement>('[data-log-card]')!.dataset.logCard!,state=details.classList.contains('meal-log-notes')?notesExpanded:details.classList.contains('meal-log-quantities')?quantitiesExpanded:expanded,id=details.dataset.quantityKey??row;if(details.open)state.add(id);else state.delete(id);};
      if(focused&&active){const input=fieldInput(active.row,active.field);input?.focus({preventScroll:true});if(input&&caret?.[0]!=null&&caret[1]!=null)input.setSelectionRange(caret[0],caret[1]);}
    }
    const weight=fieldInput(view.header,'dayWeight')!;
    if((!writing||weight!==document.activeElement)&&weight.value!==view.weight.value)weight.value=view.weight.value;
    weight.disabled=view.busy;weight.classList.toggle('calculated',view.weight.calculated);
    for(const row of view.rows){
      element.querySelector<HTMLElement>(`[data-log-card="${row.id}"] [data-log-totals]`)!.textContent=row.totals;
      for(const field of mealFields){const input=fieldInput(row.id,field),value=row.values[field]??'';if(input&&(!writing||input!==document.activeElement)&&input.value!==value)input.value=value;if(input){input.disabled=view.busy;input.classList.toggle('calculated',row.calculated.includes(field));}}
    }
    element.querySelector<HTMLElement>('[data-log-date]')!.textContent=view.date;
    for(const button of element.querySelectorAll('button')){
      button.classList.add('group-control','summary-chevron');
      button.disabled=view.busy||button.hasAttribute('data-log-boundary');
    }
    button('Close Meal log').disabled=false;
    for(const row of view.rows){const checkbox=element.querySelector<HTMLInputElement>(`[data-log-card="${row.id}"] [data-log-ingredient]`);if(checkbox)checkbox.disabled=view.busy;}
    element.querySelector<HTMLElement>('.meal-log-day-totals')!.textContent=view.totals;
    button('Undo').disabled=!view.undo||view.busy;button('Redo').disabled=!view.redo||view.busy;
    footer.querySelector<HTMLButtonElement>('[data-log-add]')!.disabled=view.busy;
    button('Next field').hidden=!touch()||!focusMode;
    if(lastHeader!==view.header){lastHeader=view.header;pendingBottom=true;restoreScroll();}
    position();
  };
  const write=(input:HTMLInputElement|HTMLTextAreaElement)=>{
    writing=true;
    try{const saved=host.write(input.dataset.logRow!,input.dataset.logField as MealLogInputField,input.value);if(saved)dirty.delete(input);return saved;}
    finally{writing=false;}
  };
  const next=()=>{
    if(!active)return;
    const inputs=[...scroll.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[data-log-field]')].filter(input=>!input.disabled&&input.checkVisibility()),current=fieldInput(active.row,active.field),at=current?inputs.indexOf(current):-1;
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
  element.addEventListener('focusout',()=>queueMicrotask(()=>{
    const target=document.activeElement;
    if(!(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement)||!target.dataset.logField||!element.contains(target)){focusMode=false;button('Next field').hidden=true;}
  }));
  element.addEventListener('compositionend',event=>{const input=event.target;if((input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)&&input.dataset.logField)write(input);});
  element.addEventListener('pointerdown',event=>{
    const target=event.target;if(!(target instanceof Element)||target.closest('button'))return;
    const input=target.closest('.meal-log-field')?.querySelector<HTMLInputElement>('input[data-log-field="food"]');
    if(input&&!input.disabled&&input.dataset.logManual!=='true'){event.preventDefault();host.dropdown(input.dataset.logRow!,'food',input.closest<HTMLElement>('.meal-log-input')!);}
  });
  element.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();host.close();}
    else if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();next();}
    else if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();host.history(event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo');}
    event.stopPropagation();
  });
  footer.addEventListener('pointerdown',event=>{if(touch()&&focusMode)event.preventDefault();});
  element.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;if(!target)return;
    const row=target.closest<HTMLElement>('[data-log-card]')?.dataset.logCard;
    if(target.dataset.logDropdown&&row){host.dropdown(row,target.dataset.logDropdown as MealField,target.closest<HTMLElement>('.meal-log-input')!);return;}
    if(target.hasAttribute('data-log-insert')&&row){host.add(row);return;}
    if(target.hasAttribute('data-log-add')){host.add();return;}
    if(target.hasAttribute('data-log-today')){host.today();return;}
    if(target.hasAttribute('data-log-date')){host.date(target);return;}
    switch(target.getAttribute('aria-label')){
      case 'Close Meal log':host.close();break;
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
  const foodMode=(row:string,manual:boolean)=>{
    if(manual)expanded.delete(row);
    for(const key of quantitiesExpanded)if(key.startsWith(row+':'))quantitiesExpanded.delete(key);
    const card=element.querySelector<HTMLElement>(`[data-log-card="${row}"]`);
    for(const details of card?.querySelectorAll<HTMLDetailsElement>(manual?'.meal-log-macros,.meal-log-quantities':'.meal-log-quantities')??[])details.open=false;
  };
  return{element,refresh:()=>{try{update();}catch(error){host.error(error);}},reveal,foodMode,bottom:()=>{pendingBottom=true;restoreScroll();},rememberScroll:()=>{if(element.isConnected)savedScroll=scroll.scrollTop;},restoreScroll,dispose:()=>{controller.abort();cancelAnimationFrame(scrollFrame);element.remove();document.body.classList.remove('meal-log-keyboard');},restoreFocus:()=>{
    if(active&&focusMode)fieldInput(active.row,active.field)?.focus({preventScroll:true});
  }};
}
