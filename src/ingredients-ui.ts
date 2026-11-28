import {captureData,ingredientKey,ingredientList,type FoodValues,type IngredientIdentity} from './food-capture';
import type {Engine} from './formula';
import type {Cell,Workbook} from './model';
import type {Patch} from './undo-history';
import type {createPhotoUI} from './photo-ui';
import {localToday} from './day-logging';
import {RowViewport} from './row-viewport';
import {navigationIcon,toolbarIcon} from './icons';
import {dropdownArrowHtml} from './dropdown-ui';

type Values=FoodValues&{type?:string};
export interface IngredientsPanelHost{
  book:()=>Workbook;engine:()=>Engine;sourceVersion:()=>number;
  write:(label:string,paths:Patch['path'][],change:()=>void)=>boolean;
  apply:(identity:IngredientIdentity,values:Values,base:Values)=>boolean;
  add:()=>void;review:()=>void;error:(error:unknown)=>void;
  photos?:ReturnType<typeof createPhotoUI>;
  table?:{
    add:(after?:IngredientIdentity)=>IngredientIdentity|undefined;
    move:(identity:IngredientIdentity,direction:-1|1)=>boolean;
    remove:(identity:IngredientIdentity)=>boolean;
    dropdown:(identity:IngredientIdentity,anchor:HTMLElement)=>void;
    history:(action:'undo'|'redo')=>void;
    historyState:()=>{undo:boolean;redo:boolean};
  };
  actions?:NonNullable<IngredientsPanelHost['table']>;
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const fields={food:'Ingredient',weight:'Reference grams',amount:'Reference amount',unit:'Reference unit',calories:'Calories',protein:'Protein (g)',fat:'Fat (g)',carbs:'Carbs (g)',sugar:'Sugar (g)',sodium:'Sodium (mg)',type:'Type',notes:'Notes'} as const;
const glyph=(label:string,svg:string,attributes:string)=>`<button type="button" class="icon-button group-control summary-chevron" aria-label="${label}" title="${label}" ${attributes}>${svg}</button>`;
function fieldHtml(field:keyof typeof fields,table:boolean):string{
  const tableLabels:Partial<Record<keyof typeof fields,string>>={food:'Food',weight:'Weight (g)',amount:'Amount',unit:'Unit'};
  const label=table?(tableLabels[field]??fields[field]):fields[field];
  const input=field==='notes'?`<textarea rows="3" data-field="${field}" aria-label="Ingredient ${label}"></textarea>`:`<input data-field="${field}" aria-label="Ingredient ${label}" ${['food','unit','type'].includes(field)?'':'inputmode="decimal"'}>`;
  return`<label class="meal-log-field ${field==='food'?'meal-log-field-wide':''}"><span>${label}</span>${field==='type'?`<span class="meal-log-input">${input}<button type="button" class="icon-button" data-ingredient-type aria-label="Choose Ingredient Type"><span class="format-caret">${dropdownArrowHtml}</span></button></span>`:input}</label>`;
}
export function mountIngredientsPanel(host:IngredientsPanelHost){
  const element=document.createElement('section'),controller=new AbortController(),actions=host.table??host.actions,expanded=new Set<string>();
  element.className='capture-pane';element.setAttribute('aria-label','Ingredient editor');
  element.innerHTML=`<nav class="panel-tabs" aria-label="Ingredient filter"><button type="button" data-filter="all" aria-pressed="true">All</button><button type="button" data-filter="missing" aria-pressed="false">Needs nutrition</button></nav><label class="capture-search">Search Ingredients<input type="search" aria-label="Search Ingredients"></label><button type="button" data-review hidden>Review nutrition changes</button><details class="capture-notice"><summary>Reference serving</summary><p class="muted">Reference quantities are independent of food consumed. Draft edits save locally; Apply updates the source Ingredients row.</p></details><div class="capture-foods"></div><footer class="capture-footer"><button type="button" data-ingredient-add>+ Ingredient</button><span data-count></span>${glyph('Undo',toolbarIcon('undo'),'data-ingredient-history="undo"')}${glyph('Redo',toolbarIcon('redo'),'data-ingredient-history="redo"')}</footer>`;
  const list=element.querySelector<HTMLElement>('.capture-foods')!,search=element.querySelector<HTMLInputElement>('[type=search]')!;
  if(host.table){
    element.setAttribute('aria-label','Ingredients TABLE');
    for(const child of element.querySelectorAll<HTMLElement>('.capture-toolbar,.panel-tabs,.capture-search,.capture-notice'))child.hidden=true;
    list.dataset.virtual='true';
  }
  let filter='all',page=0,shape='',frame=0;
  let layout=new RowViewport([]),ordered:string[]=[],savedScroll=0,refreshing=false,replacingCards=false,active:{key:string;field:string}|undefined;
  type ScrollAnchor={key:string;selector?:string;offset:number};
  let savedAnchor:ScrollAnchor|undefined;
  const scrollAnchor=():ScrollAnchor|undefined=>{
    const box=list.getBoundingClientRect(),focused=document.activeElement;
    const control=focused instanceof HTMLElement&&list.contains(focused)?focused:undefined;
    const focusedCard=control?.closest<HTMLElement>('[data-ingredient-key]');
    const visible=(card:HTMLElement)=>{const rect=card.getBoundingClientRect();return rect.bottom>box.top&&rect.top<box.bottom;};
    const card=focusedCard&&visible(focusedCard)?focusedCard:[...list.querySelectorAll<HTMLElement>('[data-ingredient-key]')].find(visible);
    if(!card)return;
    const selector=card===focusedCard&&control instanceof HTMLInputElement?`[data-field="${control.dataset.field}"]`:card===focusedCard&&control?.hasAttribute('data-ingredient-type')?'[data-ingredient-type]':undefined;
    const target=selector?control!:card;
    return{key:card.dataset.ingredientKey!,selector,offset:target.getBoundingClientRect().top-box.top};
  };
  const restoreAnchor=(anchor:ScrollAnchor|undefined):boolean=>{
    if(!anchor)return false;
    const target=list.querySelector<HTMLElement>(`[data-ingredient-key="${anchor.key}"]${anchor.selector?' '+anchor.selector:''}`);
    if(!target)return false;
    list.scrollTop+=target.getBoundingClientRect().top-list.getBoundingClientRect().top-anchor.offset;
    return true;
  };
  const heights=new Map<string,number>();
  const resize=new ResizeObserver(entries=>{
    let changed=false;
    for(const entry of entries){
      const card=entry.target as HTMLElement,key=card.dataset.ingredientKey!,height=card.getBoundingClientRect().height;
      if(height>0&&Math.abs((heights.get(key)??0)-height)>.5){heights.set(key,height);changed=true;}
    }
    if(changed)schedule();
  });
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{try{refresh();}catch(error){host.error(error);}});};
  const photoPanels:{refresh:()=>void;dispose:()=>void}[]=[];
  let projectionBook:Workbook|undefined,projectionEngine:Engine|undefined,projectionVersion=-1,projection:ReturnType<typeof ingredientList>=[];
  let byKey=new Map<string,ReturnType<typeof ingredientList>[number]>();
  const records=()=>{
    const book=host.book(),engine=host.engine(),version=host.sourceVersion();
    if(projectionBook!==book||projectionEngine!==engine||projectionVersion!==version){
      projection=ingredientList(book,engine,actions?{includeBlank:true}:undefined);byKey=new Map(projection.map(item=>[ingredientKey({table:item.table.id,row:item.row}),item]));
      projectionBook=book;projectionEngine=engine;projectionVersion=version;
    }
    return projection;
  };
  const draw=()=>{
    const book=host.book(),query=search.value.trim().toLocaleLowerCase();
    const visualAnchor=host.table?scrollAnchor():undefined;
    const matches=records().filter(item=>(filter!=='missing'||item.missing.length)&&(!query||item.values.food?.toLocaleLowerCase().includes(query)));
    const focused=document.activeElement;
    const focusedControl=host.table&&(focused instanceof HTMLInputElement||focused instanceof HTMLButtonElement&&focused.hasAttribute('data-ingredient-type'))?focused:undefined;
    const focusedCard=focusedControl?.closest<HTMLElement>('[data-ingredient-key]');
    const focus=focusedControl&&focusedCard&&list.contains(focusedCard)?{key:focusedCard.dataset.ingredientKey!,
      selector:focusedControl instanceof HTMLInputElement?`[data-field="${focusedControl.dataset.field}"]`:'[data-ingredient-type]',
      selection:focusedControl instanceof HTMLInputElement&&focusedControl.selectionStart!==null?{start:focusedControl.selectionStart,end:focusedControl.selectionEnd,direction:focusedControl.selectionDirection}:undefined}:undefined;
    let redrawn=false;
    page=Math.min(page,Math.max(0,Math.ceil(matches.length/20)-1));
    let start=page*20,end=(page+1)*20;
    if(host.table){
      const focusedAt=focus?ordered.indexOf(focus.key):-1;
      const at=focusedAt>=0&&layout.offsets[focusedAt]<list.scrollTop+list.clientHeight&&layout.offsets[focusedAt+1]>list.scrollTop?focusedAt:layout.at(list.scrollTop);
      const anchor=ordered[at],offset=list.scrollTop-(layout.offsets[at]??0);
      ordered=matches.map(item=>ingredientKey({table:item.table.id,row:item.row}));
      layout=new RowViewport(ordered.map(key=>heights.get(key)??530));
      const next=anchor?ordered.indexOf(anchor):-1;
      if(next>=0)list.scrollTop=layout.offsets[next]+offset;
      start=Math.max(0,layout.at(list.scrollTop)-2);end=Math.min(matches.length,layout.at(list.scrollTop+list.clientHeight)+3);
    }
    const visible=matches.slice(start,end),nextShape=JSON.stringify([filter,query,start,end,visible.map(item=>[item.table.id,item.row,Object.keys(item.mapping.fields)])]);
    if(shape!==nextShape){
      if(host.table&&focused instanceof HTMLInputElement&&list.contains(focused)&&!visible.some(item=>ingredientKey({table:item.table.id,row:item.row})===focused.closest<HTMLElement>('[data-ingredient-key]')?.dataset.ingredientKey)){
        focused.blur();schedule();return;
      }
      redrawn=true;
      shape=nextShape;resize.disconnect();for(const panel of photoPanels)panel.dispose();photoPanels.length=0;
      replacingCards=true;
      try{list.innerHTML=visible.map(item=>{
        const key=ingredientKey({table:item.table.id,row:item.row});
        const editable=(Object.keys(fields) as (keyof typeof fields)[]).filter(field=>(!host.table||field!=='notes')&&(field==='notes'||item.mapping.fields[field]));
        const at=matches.indexOf(item);
        const pending='<div class="button-row" data-pending-edit hidden><button type="button" class="primary" data-apply>Apply</button><button type="button" data-discard>Discard draft edits</button></div>';
        const cardActions=pending+(actions?`<div class="meal-log-row-actions">${glyph('Move Ingredient up',navigationIcon('up'),`data-ingredient-move="-1" ${at===0?'disabled':''}`)}${glyph('Move Ingredient down',navigationIcon('down'),`data-ingredient-move="1" ${at===matches.length-1?'disabled':''}`)}${glyph('Insert Ingredient',toolbarIcon('add'),'data-ingredient-insert')}${glyph('Delete Ingredient',toolbarIcon('trash'),'data-ingredient-delete')}</div>`:'');
        const field=(name:keyof typeof fields)=>editable.includes(name)?fieldHtml(name,!!host.table):'';
        const content=host.table?`<div class="meal-log-fields">${editable.map(field).join('')}</div>`:
          `${field('food')}<div class="meal-log-fields">${(['weight','amount','unit'] as const).map(field).join('')}</div><details class="meal-log-macros" data-ingredient-details="macros" ${expanded.has(key+':macros')?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Macros</span></summary><div class="meal-log-fields">${(['calories','protein','fat','carbs','sugar','sodium'] as const).map(field).join('')}</div></details><div class="capture-ingredient-tools">${field('type')}<div data-ingredient-photos></div></div><details class="meal-log-notes" data-ingredient-details="notes" ${expanded.has(key+':notes')?'open':''}><summary><span class="meal-log-macro-label"><span class="format-caret">${dropdownArrowHtml}</span>Notes</span></summary>${field('notes')}</details>`;
        return`<section class="meal-log-card" data-ingredient-key="${key}" data-table="${item.table.id}" data-row="${item.row}"><h3 data-name hidden></h3><p class="muted" data-missing role="status"></p>${content}${cardActions}</section>`;
      }).join('')||'<p class="muted">No matching Ingredients.</p>';}finally{replacingCards=false;}
      if(host.table){
        list.insertAdjacentHTML('afterbegin','<div data-ingredient-spacer="before" aria-hidden="true"></div>');
        list.insertAdjacentHTML('beforeend','<div data-ingredient-spacer="after" aria-hidden="true"></div>');
        for(const card of list.querySelectorAll<HTMLElement>('[data-ingredient-key]'))resize.observe(card);
      }
      if(host.photos&&!host.table)for(const item of visible){
        const identity={table:item.table.id,row:item.row},key=ingredientKey(identity);
        const photos=host.photos.strip(()=>({book:host.book().id,date:host.book().foodCapture?.selectedDate??localToday(),target:{kind:'ingredient',identity}}),()=>host.book().foodCapture?.ingredientDetails[key]?.photos??[]);
        list.querySelector(`[data-ingredient-key="${key}"] [data-ingredient-photos]`)!.append(photos.element);photoPanels.push(photos);
      }
      if(!host.table){
        if(matches.length>20)list.insertAdjacentHTML('beforeend',`<nav class="button-row capture-pagination" aria-label="Ingredient pages"><button type="button" data-page="-1" ${page===0?'disabled':''}>Previous</button><span>${page*20+1}-${Math.min(matches.length,(page+1)*20)} of ${matches.length}</span><button type="button" data-page="1" ${(page+1)*20>=matches.length?'disabled':''}>Next</button></nav>`);
        for(const card of list.querySelectorAll<HTMLElement>('[data-ingredient-key]'))for(const details of card.querySelectorAll<HTMLDetailsElement>('[data-ingredient-details]'))details.ontoggle=()=>{
          const key=card.dataset.ingredientKey!+':'+details.dataset.ingredientDetails;if(details.open)expanded.add(key);else expanded.delete(key);
        };
      }
    }
    for(const panel of photoPanels)panel.refresh();
    for(const item of visible){
      const key=ingredientKey({table:item.table.id,row:item.row}),card=list.querySelector<HTMLElement>(`[data-ingredient-key="${key}"]`)!,edit=book.foodCapture?.ingredientEdits[key];
      const notes=book.foodCapture?.ingredientDetails[key]?.notes??'',source={...item.values,notes},values={...source,...edit?.values};
      card.querySelector<HTMLElement>('[data-name]')!.textContent=values.food??'';
      const stale=edit&&Object.entries(edit.base).some(([field,value])=>source[field as keyof Values]!==value);
      card.querySelector<HTMLElement>('[data-missing]')!.textContent=[item.missing.length?'Needs nutrition':'Nutrition complete',edit?'Draft edits saved locally':'',stale?'Source changed; review before applying':''].filter(Boolean).join(' · ');
      for(const input of card.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[data-field]'))if(input!==document.activeElement)input.value=values[input.dataset.field as keyof Values]??'';
      card.querySelector<HTMLButtonElement>('[data-apply]')!.disabled=!edit;card.querySelector<HTMLButtonElement>('[data-discard]')!.disabled=!edit;
      const pending=card.querySelector<HTMLElement>('[data-pending-edit]')!;if(pending.hidden!==!edit)pending.hidden=!edit;
      const type=card.querySelector<HTMLButtonElement>('[data-ingredient-type]');if(type&&type.disabled!==!actions)type.disabled=!actions;
    }
    for(const button of element.querySelectorAll<HTMLButtonElement>('[data-filter]'))button.setAttribute('aria-pressed',String(button.dataset.filter===filter));
    const review=element.querySelector<HTMLButtonElement>('[data-review]')!,count=book.foodCapture?.nutritionConflicts?.length??0;
    review.hidden=!count;review.textContent=`Review nutrition changes (${count})`;
    element.querySelector<HTMLElement>('[data-count]')!.textContent=host.table?`${matches.length} Ingredients`:matches.length?`${page*20+1}–${Math.min(matches.length,(page+1)*20)} of ${matches.length}`:'0 Ingredients';
    if(host.table){
      for(const side of ['before','after'] as const)list.querySelector<HTMLElement>(`[data-ingredient-spacer="${side}"]`)!.style.height=(side==='before'?layout.offsets[start]:layout.offsets.at(-1)!-layout.offsets[end])+'px';
    }
    const history=actions?.historyState();
    for(const button of element.querySelectorAll<HTMLButtonElement>('[data-ingredient-history]'))button.disabled=!history?.[button.dataset.ingredientHistory as 'undo'|'redo'];
    if(redrawn&&focus){
      const control=list.querySelector<HTMLInputElement|HTMLButtonElement>(`[data-ingredient-key="${focus.key}"] ${focus.selector}`);
      control?.focus({preventScroll:true});
      if(control instanceof HTMLInputElement&&focus.selection)control.setSelectionRange(focus.selection.start,focus.selection.end,focus.selection.direction??undefined);
    }
    if(host.table)restoreAnchor(visualAnchor);
  };
  const refresh=()=>{if(refreshing)return;refreshing=true;try{draw();}finally{refreshing=false;}};
  const reveal=(row:string,focus=false,end=false)=>{
    if(!host.table){
      let matches=records().filter(item=>(filter!=='missing'||item.missing.length)&&(!search.value.trim()||item.values.food?.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
      if(!matches.some(item=>item.row===row)){filter='all';search.value='';matches=records();}
      const at=matches.findIndex(item=>item.row===row);if(at<0)throw Error('The Ingredient was not found after this action. Reopen Ingredients.');
      page=Math.floor(at/20);refresh();
      const card=list.querySelector<HTMLElement>(`[data-row="${row}"]`);card?.scrollIntoView({block:'nearest'});
      if(focus)card?.querySelector<HTMLInputElement>('[data-field="food"]')?.focus({preventScroll:true});
      return;
    }
    refresh();const at=records().findIndex(item=>item.row===row);if(at<0)return;
    list.scrollTop=end?Math.max(0,layout.offsets[at+1]-list.clientHeight):layout.offsets[at];refresh();
    if(focus)list.querySelector<HTMLInputElement>(`[data-row="${row}"] [data-field="food"]`)?.focus({preventScroll:true});
  };
  const last=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const row=records().at(-1)?.row;if(row)reveal(row,false,true);});};
  const commit=()=>{
    if(!host.table||!active)return true;
    const record=records().find(item=>ingredientKey({table:item.table.id,row:item.row})===active!.key),field=active.field as keyof Values,edit=host.book().foodCapture?.ingredientEdits[active.key];
    if(!edit||!Object.hasOwn(edit.values,field))return true;
    if(!record)throw Error('This Ingredient was removed. Its pending edit is preserved for recovery.');
    return host.apply({table:record.table.id,row:record.row},{[field]:edit.values[field]},{[field]:edit.base[field]});
  };
  list.addEventListener('scroll',()=>{savedScroll=list.scrollTop;if(host.table)schedule();},{signal:controller.signal});
  element.addEventListener('focusin',event=>{const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||!input.dataset.field)return;const card=input.closest<HTMLElement>('[data-ingredient-key]');if(card)active={key:card.dataset.ingredientKey!,field:input.dataset.field};},{signal:controller.signal});
  const commitField=(event:Event)=>{
    const input=event.target;if(!host.table||replacingCards||!(input instanceof HTMLInputElement)||!input.dataset.field)return;
    try{commit();refresh();}catch(error){host.error(error);}
  };
  element.addEventListener('change',commitField,{signal:controller.signal});
  element.addEventListener('focusout',commitField,{signal:controller.signal});
  element.addEventListener('keydown',event=>{
    if(!host.table||event.isComposing)return;
    try{
      if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();commit();refresh();}
      else if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();host.table.history(event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo');}
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  const stage=(identity:IngredientIdentity,field:keyof Values,value:string,binding?:NonNullable<Cell['binding']>)=>{
    const key=ingredientKey(identity);records();const record=byKey.get(key);
    if(!record)throw Error('This Ingredient was removed. Reopen Ingredients before editing.');
    return host.write('Edit Ingredient draft',[['foodCapture','ingredientEdits',key]],()=>{
      const data=captureData(host.book()),edit=data.ingredientEdits[key]??={values:{},base:{}};
      if(!Object.hasOwn(edit.base,field))edit.base[field]=field==='notes'?data.ingredientDetails[key]?.notes??'':record.values[field]??'';
      edit.values[field]=value;
      if(field==='type'){if(binding)edit.typeBinding={...binding};else delete edit.typeBinding;}
    });
  };
  element.addEventListener('input',event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||event instanceof InputEvent&&event.isComposing)return;
    try{
      if(input!==search){
        const card=input.closest<HTMLElement>('[data-ingredient-key]');if(!card||!input.dataset.field)return;
        stage({table:card.dataset.table!,row:card.dataset.row!},input.dataset.field as keyof Values,input.value);
      }else page=0;
      schedule();
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('compositionend',event=>event.target?.dispatchEvent(new InputEvent('input',{bubbles:true})),{signal:controller.signal});
  element.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;if(!button||button.disabled)return;
    try{
      if(button.hasAttribute('data-ingredient-add')){if(actions){const added=actions.add();if(added){refresh();reveal(added.row,true);}}else host.add();}
      else if(button.dataset.ingredientHistory)actions?.history(button.dataset.ingredientHistory as 'undo'|'redo');
      else if(button.hasAttribute('data-review'))host.review();
      else if(button.dataset.filter){filter=button.dataset.filter;page=0;refresh();}
      else if(button.dataset.page){page+=Number(button.dataset.page);refresh();list.scrollTop=0;}
      else{
        const card=button.closest<HTMLElement>('[data-ingredient-key]');if(!card)return;
        const key=card.dataset.ingredientKey!,edit=host.book().foodCapture?.ingredientEdits[key];
        const identity={table:card.dataset.table!,row:card.dataset.row!};
        if(actions){
          if(button.hasAttribute('data-ingredient-type'))actions.dropdown(identity,button);
          else if(button.hasAttribute('data-ingredient-insert')){const added=actions.add(identity);if(added){refresh();reveal(added.row,true);}}
          else if(button.dataset.ingredientMove){if(actions.move(identity,Number(button.dataset.ingredientMove) as -1|1)){refresh();reveal(identity.row);}}
          else if(button.hasAttribute('data-ingredient-delete'))actions.remove(identity);
        }
        if(button.hasAttribute('data-discard'))host.write('Discard Ingredient draft',[['foodCapture','ingredientEdits',key]],()=>{delete captureData(host.book()).ingredientEdits[key];});
        else if(button.hasAttribute('data-apply')&&edit)host.apply({table:card.dataset.table!,row:card.dataset.row!},edit.values,edit.base);
        refresh();
      }
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  return{element,refresh,last,commit,stageType:(identity:IngredientIdentity,value:string,binding?:NonNullable<Cell['binding']>)=>{const ok=stage(identity,'type',value,binding);if(ok)refresh();return ok;},navigate:(direction:-1|1)=>{refresh();const row=records()[Math.max(0,Math.min(ordered.length-1,layout.at(list.scrollTop)+direction))]?.row;if(row)reveal(row);},
    rememberScroll:()=>{savedScroll=list.scrollTop;savedAnchor=scrollAnchor();},restoreScroll:()=>{if(!restoreAnchor(savedAnchor))list.scrollTop=savedScroll;},restoreFocus:()=>{if(active)list.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[data-ingredient-key="${active.key}"] [data-field="${active.field}"]`)?.focus({preventScroll:true});},
    dispose:()=>{cancelAnimationFrame(frame);resize.disconnect();for(const panel of photoPanels)panel.dispose();controller.abort();projection=[];byKey.clear();projectionBook=undefined;projectionEngine=undefined;}};
}
