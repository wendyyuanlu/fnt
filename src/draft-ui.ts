import {dropdownArrowHtml,mountDropdownOptions,mountDropdownPopup,renderDropdownTrigger} from './dropdown-ui';
import {excelDateText,parseDateInput} from './dates';
import {localToday} from './day-logging';
import {navigationIcon,toolbarIcon} from './icons';
import {addDraftFood,captureData,createFoodCaptureContext,ingredientKey,ingredientList,scaledDraft,updateDraftText,type DraftFood,type IngredientIdentity,type NutritionTarget} from './food-capture';
import type {Engine} from './formula';
import type {Workbook} from './model';
import type {MealField} from './meal-log';
import type {Patch} from './undo-history';
import type {createPhotoUI} from './photo-ui';
import {mountRestaurantField,restaurantFieldHtml,showRestaurants,type RestaurantField} from './restaurant-ui';

export interface DraftPanelHost{
  book:()=>Workbook;engine:()=>Engine;
  write:(label:string,paths:Patch['path'][],change:()=>void)=>boolean;
  addIngredient:(id:string)=>boolean;
  linkIngredient:(id:string,ingredient:IngredientIdentity|undefined)=>boolean;
  historyState:()=>{undo:boolean;redo:boolean};
  loggingTarget:()=>NutritionTarget|undefined;
  dialog:(title:string,html:string,mount:(dialog:HTMLDialogElement)=>void)=>HTMLDialogElement;
  error:(error:unknown)=>void;
  photos?:ReturnType<typeof createPhotoUI>;
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const titles:Record<MealField,string>={food:'Food',calories:'Calories',protein:'Protein (g)',fat:'Fat (g)',carbs:'Carbs (g)',sugar:'Sugar (g)',sodium:'Sodium (mg)',weight:'Grams',amount:'Amount',unit:'Unit',notes:'Notes'};
const glyph=(name:string,svg:string,extra='')=>`<button type="button" class="icon-button group-control summary-chevron" aria-label="${name}" title="${name}" ${extra}>${svg}</button>`;
export function mountDraftPanel(host:DraftPanelHost){
  const element=document.createElement('section'),controller=new AbortController(),popups:{close:()=>void}[]=[];
  element.className='capture-pane';element.setAttribute('aria-label','Draft foods');
  element.innerHTML=`<div class="capture-day-bar"><button type="button" data-draft-today>Today</button>${glyph('Previous draft day',toolbarIcon('previous'))}${glyph('Next draft day',toolbarIcon('next'))}<label class="capture-date"><span class="sr-only">Draft date</span><input type="date" aria-label="Draft date" min="1900-01-01" max="9999-12-31"></label></div><div class="capture-foods"></div><footer class="capture-footer"><button type="button" data-draft-add>+ Food</button><button type="button" data-restaurants>Restaurants</button></footer>`;
  const list=element.querySelector<HTMLElement>('.capture-foods')!,date=element.querySelector<HTMLInputElement>('[type=date]')!;
  element.querySelector('.capture-footer')!.insertAdjacentHTML('beforeend',glyph('Undo',toolbarIcon('undo'),'data-draft-history="undo"')+glyph('Redo',toolbarIcon('redo'),'data-draft-history="redo"'));
  let shape='',page=0,frame=0;const pageSize=30,expanded=new Set<string>();
  const photoPanels:{refresh:()=>void;dispose:()=>void}[]=[];
  const restaurantFields:RestaurantField[]=[];
  if(host.photos)element.querySelector('.capture-footer')!.insertAdjacentHTML('beforeend',`<button type="button" class="icon-button" data-draft-photo aria-label="Add photo" title="Add photo">${toolbarIcon('camera')}</button>`);
  const data=()=>host.book().foodCapture;
  const currentDate=()=>data()?.selectedDate??localToday();
  const foodById=(id:string)=>{const food=data()?.foods.find(food=>food.id===id);if(!food)throw Error('This draft food no longer exists.');return food;};
  const foodPath=(id:string):Patch['path']=>{
    const index=data()?.foods.findIndex(food=>food.id===id)??-1;if(index<0)throw Error('This draft food no longer exists.');
    return['foodCapture','foods',index];
  };
  const save=(label:string,paths:Patch['path'][],change:()=>void)=>host.write(label,paths,change);
  const writeFood=(id:string,field:MealField,value:string)=>{
    const path=foodPath(id),paths=field==='food'?[[...path,'values','food'],[...path,'parts']]:[[...path,'values',field]];
    return save('Edit draft '+titles[field],paths,()=>{const food=foodById(id);if(field==='food')updateDraftText(food,value);else food.values[field]=value;});
  };
  const chooseDate=(day:number)=>{
    if(save('Choose draft date',[['foodCapture','selectedDate']],()=>{captureData(host.book()).selectedDate=day;})){page=0;refresh();}
  };
  const add=(after?:string)=>{
    let id='';
    if(save('Add draft food',[['foodCapture','foods']],()=>{id=addDraftFood(host.book(),currentDate(),after,host.loggingTarget()).id;})){
      const foods=data()!.foods.filter(food=>food.date===currentDate());page=Math.floor(foods.findIndex(food=>food.id===id)/pageSize);refresh();
      const card=list.querySelector<HTMLElement>(`[data-draft-card="${id}"]`);
      card?.scrollIntoView({block:'nearest'});card?.querySelector<HTMLTextAreaElement>('[data-draft-field=food]')?.focus({preventScroll:true});
    }
  };
  const restaurants=()=>showRestaurants({...host,changed:refresh});
  const closePopups=()=>{for(const popup of popups)popup.close();popups.length=0;for(const field of restaurantFields)field.dispose();restaurantFields.length=0;};
  const wirePickers=(card:HTMLElement,food:DraftFood)=>{
    restaurantFields.push(mountRestaurantField({...host,changed:refresh},card,()=>foodById(food.id),()=>foodPath(food.id)));
    const ingredientTrigger=card.querySelector<HTMLButtonElement>('[data-ingredient-picker]')!;
    popups.push(mountDropdownPopup(ingredientTrigger,'Ingredients',(panel,position,close)=>{
      const filter=document.createElement('div'),options=document.createElement('div');filter.className='button-row';panel.replaceChildren(filter,options);
      let needs=false;const choices=ingredientList(host.book(),host.engine());let dispose:(()=>void)|undefined;
      const draw=()=>{
        dispose?.();filter.replaceChildren();
        for(const [label,value]of [['All',false],['Needs nutrition',true]] as const){
          const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(needs===value));button.onclick=()=>{needs=value;draw();};filter.append(button);
        }
        const view=mountDropdownOptions(options,{choices:choices.filter(item=>!needs||item.missing.length),name:'Ingredients',value:item=>item.values.food??'',selected:item=>ingredientKey({table:item.table.id,row:item.row})===ingredientKey(foodById(food.id).ingredient??{table:'',row:''}),position,
          choose:item=>{if(host.linkIngredient(food.id,{table:item.table.id,row:item.row})){close();shape='';refresh();}},
          renderOption:(button,item)=>{if(item.missing.length){const tag=document.createElement('span');tag.className='count';tag.textContent='Needs nutrition';button.append(' ',tag);}}});
        dispose=view.dispose;position();view.search.focus({preventScroll:true});
      };draw();return()=>dispose?.();
    },380));
  };
  const refresh=()=>{
    const foods=(data()?.foods??[]).filter(food=>food.date===currentDate());page=Math.min(page,Math.max(0,Math.ceil(foods.length/pageSize)-1));
    const visible=foods.slice(page*pageSize,(page+1)*pageSize),visibleById=new Map(visible.map(food=>[food.id,food])),nextShape=JSON.stringify([currentDate(),page,visible.map(food=>[food.id,food.mode,food.ingredient])]);
    date.value=excelDateText(currentDate())??'';
    const history=host.historyState();
    for(const action of ['undo','redo'] as const)element.querySelector<HTMLButtonElement>(`[data-draft-history="${action}"]`)!.disabled=!history[action];
    if(nextShape!==shape){
      shape=nextShape;closePopups();for(const panel of photoPanels)panel.dispose();photoPanels.length=0;
      list.innerHTML=visible.map(food=>{
        const field=(name:MealField)=>{
          const attributes=`data-draft-field="${name}" aria-label="Draft ${titles[name]}" autocomplete="off"`;
          const input=name==='food'||name==='notes'?`<textarea ${attributes} rows="${name==='notes'?3:food.mode==='multi'?6:food.mode==='packaged'?2:3}" ${name==='food'&&food.ingredient?'readonly':''}></textarea>`:`<input ${attributes} inputmode="${name==='unit'?'text':'decimal'}">`;
          return`<label class="meal-log-field">${name==='notes'?'':`<span>${titles[name]}</span>`}${input}</label>`;
        };
        const linked=!!food.ingredient;
        return`<section class="meal-log-card" data-draft-card="${food.id}" aria-label="Draft food ${foods.indexOf(food)+1}">${restaurantFieldHtml()}<div class="button-row capture-mode-tabs" role="tablist" aria-label="Food draft type">${([['single','Single'],['multi','Multi'],['packaged','Pre-packaged'],['ingredient','Ingredient']] as const).map(([mode,label])=>`<button type="button" role="tab" data-draft-mode="${mode}" aria-selected="${food.mode===mode}" tabindex="${food.mode===mode?0:-1}">${label}</button>`).join('')}</div>${field('food')}<div class="button-row"><button type="button" class="dropdown-field" data-ingredient-picker aria-label="Choose draft Ingredient">Choose Ingredient <span class="format-caret">${dropdownArrowHtml}</span></button>${linked?glyph('Unlink Ingredient',toolbarIcon('unlink'),'data-unlink-ingredient'):''}</div><p class="muted" data-draft-diagnostic role="status"></p><details class="meal-log-macros" data-draft-details="macros" ${expanded.has(food.id+':macros')?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Macros</span></summary><div class="meal-log-fields">${(['calories','protein','fat','carbs','sugar','sodium'] as const).map(field).join('')}</div></details><div class="meal-log-fields">${(['weight','amount','unit'] as const).map(field).join('')}</div><details class="meal-log-notes" data-draft-details="notes" ${expanded.has(food.id+':notes')?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Notes</span></summary>${field('notes')}</details><label class="inline meal-log-ingredient"><input type="checkbox" data-draft-ingredient ${linked||food.mode==='multi'||food.mode==='ingredient'?'disabled':''}>Add as ingredient</label><div class="meal-log-row-actions">${glyph('Move draft food up',navigationIcon('up'),'data-draft-move="-1"')}${glyph('Move draft food down',navigationIcon('down'),'data-draft-move="1"')}<button type="button" data-draft-insert>+ Food</button>${glyph('Delete draft food',toolbarIcon('trash'),'data-draft-delete')}</div></section>`;
      }).join('')||'<p class="muted">No draft foods for this day. Use + Food to add a note without creating Master rows.</p>';
      if(foods.length>pageSize)list.insertAdjacentHTML('beforeend',`<div class="button-row"><button type="button" data-draft-page="-1" ${page===0?'disabled':''}>Previous foods</button><span>${page*pageSize+1}–${Math.min(foods.length,(page+1)*pageSize)} of ${foods.length}</span><button type="button" data-draft-page="1" ${(page+1)*pageSize>=foods.length?'disabled':''}>Next foods</button></div>`);
      for(const card of list.querySelectorAll<HTMLElement>('[data-draft-card]')){
        const food=visibleById.get(card.dataset.draftCard!)!;wirePickers(card,food);
        if(host.photos){
          const photos=host.photos.strip(()=>({book:host.book().id,date:foodById(food.id).date,target:{kind:'draft',id:food.id}}),()=>foodById(food.id).photos);
          card.append(photos.element);photoPanels.push(photos);
        }
        for(const details of card.querySelectorAll<HTMLDetailsElement>('[data-draft-details]'))details.ontoggle=()=>{const key=food.id+':'+details.dataset.draftDetails;if(details.open)expanded.add(key);else expanded.delete(key);};
      }
      if(host.photos&&(page+1)*pageSize>=foods.length){
        const photos=host.photos.strip(()=>({book:host.book().id,date:currentDate()}),()=>{
          const capture=data(),candidates=capture?.photos.filter(photo=>photo.date===currentDate())??[];if(!candidates.length)return[];
          const attached=new Set([...(capture?.foods.flatMap(food=>food.photos)??[]),...Object.values(capture?.ingredientDetails??{}).flatMap(details=>details.photos)]);
          return candidates.filter(photo=>!attached.has(photo.id)).map(photo=>photo.id);
        },false,12);
        list.append(photos.element);photoPanels.push(photos);
      }
    }
    for(const panel of photoPanels)panel.refresh();
    for(const field of restaurantFields)field.refresh();
    const context=createFoodCaptureContext(host.book(),host.engine());
    for(const card of list.querySelectorAll<HTMLElement>('[data-draft-card]')){
      const food=visibleById.get(card.dataset.draftCard!)!;
      let resolved:ReturnType<typeof scaledDraft>;
      try{resolved=scaledDraft(host.book(),food,context);}catch(error){resolved={values:food.values,missing:[],issue:error instanceof Error?error.message:String(error)};}
      const diagnostic=card.querySelector<HTMLElement>('[data-draft-diagnostic]')!,message=resolved.issue??(resolved.missing.length?'Needs nutrition':'');
      if(diagnostic.textContent!==message)diagnostic.textContent=message;
      for(const input of card.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[data-draft-field]')){
        const field=input.dataset.draftField as MealField;
        if(input!==document.activeElement)input.value=resolved.values[field]??'';
        input.classList.toggle('calculated',!!food.ingredient&&!food.values[field]?.trim()&&!!resolved.values[field]?.trim());
      }
      const ingredient=card.querySelector<HTMLButtonElement>('[data-ingredient-picker]')!;
      const label=food.ingredient?resolved.values.food||'Linked Ingredient':'Choose Ingredient';
      if(ingredient.dataset.label!==label){renderDropdownTrigger(ingredient,label);ingredient.dataset.label=label;}
    }
  };
  element.addEventListener('input',event=>{
    const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||event instanceof InputEvent&&event.isComposing)return;
    const id=input.closest<HTMLElement>('[data-draft-card]')?.dataset.draftCard;if(!id)return;
    try{
      if(input.dataset.draftField)writeFood(id,input.dataset.draftField as MealField,input.value);
      cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{try{refresh();}catch(error){host.error(error);}});
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('compositionend',event=>{if(event.target instanceof Element&&event.target.hasAttribute('data-draft-field'))event.target.dispatchEvent(new InputEvent('input',{bubbles:true}));},{signal:controller.signal});
  element.addEventListener('change',event=>{
    const input=event.target;if(!(input instanceof HTMLInputElement))return;
    const id=input.closest<HTMLElement>('[data-draft-card]')?.dataset.draftCard;
    try{
      if(input===date){const day=parseDateInput(date.value);if(typeof day!=='number')throw Error('Choose a valid draft date.');chooseDate(day);}
      else if(id&&input.hasAttribute('data-draft-ingredient')){if(host.addIngredient(id)){shape='';refresh();}input.checked=false;}
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;
    if(!button||button.disabled)return;
    const id=button.closest<HTMLElement>('[data-draft-card]')?.dataset.draftCard;
    try{
      if(button.hasAttribute('data-draft-add'))add();
      else if(button.hasAttribute('data-draft-photo')){
        page=Math.max(0,Math.ceil((data()?.foods.filter(food=>food.date===currentDate()).length??0)/pageSize)-1);refresh();
        host.photos?.capture({book:host.book().id,date:currentDate()},true);
      }
      else if(button.hasAttribute('data-draft-today'))chooseDate(localToday());
      else if(button.getAttribute('aria-label')==='Previous draft day')chooseDate(currentDate()-1);
      else if(button.getAttribute('aria-label')==='Next draft day')chooseDate(currentDate()+1);
      else if(button.hasAttribute('data-restaurants'))restaurants();
      else if(button.dataset.draftPage){page+=Number(button.dataset.draftPage);refresh();list.scrollTop=0;}
      else if(id){
        const path=foodPath(id);
        if(button.dataset.draftMode){save('Change draft mode',[[...path,'mode']],()=>{foodById(id).mode=button.dataset.draftMode as DraftFood['mode'];});refresh();}
        else if(button.hasAttribute('data-unlink-ingredient')){if(host.linkIngredient(id,undefined)){shape='';refresh();}}
        else if(button.hasAttribute('data-draft-insert'))add(id);
        else if(button.hasAttribute('data-draft-delete')){
          host.dialog('Delete draft food?',`<p>Delete ${esc(foodById(id).values.food||'this draft food')}? Undo remains available.</p><button type="button" class="danger" data-confirm>Delete food</button>`,dialog=>{
            dialog.querySelector<HTMLButtonElement>('[data-confirm]')!.onclick=()=>{if(save('Delete draft food',[['foodCapture','foods']],()=>{captureData(host.book()).foods=captureData(host.book()).foods.filter(food=>food.id!==id);})){dialog.close();refresh();}};
          });
        }else if(button.dataset.draftMove){
          const foods=data()!.foods.filter(food=>food.date===currentDate()),at=foods.findIndex(food=>food.id===id),other=foods[at+Number(button.dataset.draftMove)];
          if(other)save('Move draft food',[['foodCapture','foods']],()=>{const all=captureData(host.book()).foods,a=all.findIndex(food=>food.id===id),b=all.findIndex(food=>food.id===other.id);[all[a],all[b]]=[all[b],all[a]];});refresh();
        }
      }
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('keydown',event=>{
    if(event.target instanceof HTMLInputElement&&event.key==='Enter'){event.preventDefault();event.target.blur();}
    if(event.target instanceof HTMLButtonElement&&event.target.dataset.draftMode&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();const controls=[...event.target.parentElement!.querySelectorAll<HTMLButtonElement>('[data-draft-mode]')],at=controls.indexOf(event.target),next=event.key==='Home'?0:event.key==='End'?controls.length-1:(at+(event.key==='ArrowRight'?1:-1)+controls.length)%controls.length;
      const id=event.target.closest<HTMLElement>('[data-draft-card]')!.dataset.draftCard!;controls[next].click();element.querySelector<HTMLButtonElement>(`[data-draft-card="${id}"] [aria-selected=true]`)?.focus({preventScroll:true});
    }
  },{signal:controller.signal});
  refresh();return{element,refresh,dispose:()=>{cancelAnimationFrame(frame);closePopups();for(const panel of photoPanels)panel.dispose();controller.abort();}};
}
