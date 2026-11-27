import {captureData,ingredientKey,ingredientList,type FoodValues,type IngredientIdentity} from './food-capture';
import type {Engine} from './formula';
import type {Workbook} from './model';
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
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const fields={food:'Ingredient',weight:'Reference grams',amount:'Reference amount',unit:'Reference unit',calories:'Calories',protein:'Protein (g)',fat:'Fat (g)',carbs:'Carbs (g)',sugar:'Sugar (g)',sodium:'Sodium (mg)',type:'Type',notes:'Notes'} as const;
const glyph=(label:string,svg:string,attributes:string)=>`<button type="button" class="icon-button group-control summary-chevron" aria-label="${label}" title="${label}" ${attributes}>${svg}</button>`;
function fieldHtml(field:keyof typeof fields,table:boolean):string{
  const tableLabels:Partial<Record<keyof typeof fields,string>>={food:'Food',weight:'Weight (g)',amount:'Amount',unit:'Unit'};
  const label=table?(tableLabels[field]??fields[field]):fields[field];
  const input=field==='notes'?`<textarea rows="3" data-field="${field}" aria-label="Ingredient ${label}"></textarea>`:`<input data-field="${field}" aria-label="Ingredient ${label}" ${['food','unit','type'].includes(field)?'':'inputmode="decimal"'}>`;
  return`<label class="meal-log-field ${table&&field==='food'?'meal-log-field-wide':''}"><span>${label}</span>${table&&field==='type'?`<span class="meal-log-input">${input}<button type="button" class="icon-button" data-ingredient-type aria-label="Choose Ingredient Type"><span class="format-caret">${dropdownArrowHtml}</span></button></span>`:input}</label>`;
}
export function mountIngredientsPanel(host:IngredientsPanelHost){
  const element=document.createElement('section'),controller=new AbortController();
  element.className='capture-pane';element.setAttribute('aria-label','Ingredient editor');
  element.innerHTML='<header class="capture-toolbar"><h2>Ingredients</h2><button type="button" data-ingredient-add>+ Ingredient</button></header><nav class="panel-tabs" aria-label="Ingredient filter"><button type="button" data-filter="all" aria-pressed="true">All</button><button type="button" data-filter="missing" aria-pressed="false">Needs nutrition</button></nav><label class="capture-search">Search Ingredients<input type="search" aria-label="Search Ingredients"></label><button type="button" data-review hidden>Review nutrition changes</button><p class="muted capture-notice">These are your real Ingredients rows. Draft edits save locally; Apply updates the source table. Reference serving is independent of food consumed.</p><div class="capture-foods"></div><footer class="capture-footer"><button type="button" data-page="-1">Previous</button><span data-count></span><button type="button" data-page="1">Next</button></footer>';
  const list=element.querySelector<HTMLElement>('.capture-foods')!,search=element.querySelector<HTMLInputElement>('[type=search]')!;
  if(host.table){
    element.setAttribute('aria-label','Ingredients TABLE');
    for(const child of element.querySelectorAll<HTMLElement>('.capture-toolbar,.panel-tabs,.capture-search,.capture-notice'))child.hidden=true;
    list.dataset.virtual='true';
    element.querySelector('.capture-footer')!.innerHTML=`<button type="button" data-ingredient-add>+ Ingredient</button><span data-count></span>${glyph('Undo',toolbarIcon('undo'),'data-ingredient-history="undo"')}${glyph('Redo',toolbarIcon('redo'),'data-ingredient-history="redo"')}`;
  }
  let filter='all',page=0,shape='',frame=0;
  let layout=new RowViewport([]),ordered:string[]=[],savedScroll=0,refreshing=false,active:{key:string;field:string}|undefined;
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
      projection=ingredientList(book,engine,host.table?{includeBlank:true}:undefined);byKey=new Map(projection.map(item=>[ingredientKey({table:item.table.id,row:item.row}),item]));
      projectionBook=book;projectionEngine=engine;projectionVersion=version;
    }
    return projection;
  };
  const draw=()=>{
    const book=host.book(),query=search.value.trim().toLocaleLowerCase();
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
      if(host.table&&focused instanceof HTMLInputElement&&list.contains(focused)&&!visible.some(item=>ingredientKey({table:item.table.id,row:item.row})===focused.closest<HTMLElement>('[data-ingredient-key]')?.dataset.ingredientKey))focused.blur();
      redrawn=true;
      shape=nextShape;resize.disconnect();for(const panel of photoPanels)panel.dispose();photoPanels.length=0;
      list.innerHTML=visible.map(item=>{
        const key=ingredientKey({table:item.table.id,row:item.row});
        const editable=(Object.keys(fields) as (keyof typeof fields)[]).filter(field=>(!host.table||field!=='notes')&&(field==='notes'||item.mapping.fields[field]));
        const at=matches.indexOf(item);
        const pending=`<div class="button-row" ${host.table?'data-pending-edit hidden':''}><button type="button" class="primary" data-apply>Apply</button><button type="button" data-discard>Discard draft edits</button></div>`;
        const actions=pending+(host.table?`<div class="meal-log-row-actions">${glyph('Move Ingredient up',navigationIcon('up'),`data-ingredient-move="-1" ${at===0?'disabled':''}`)}${glyph('Move Ingredient down',navigationIcon('down'),`data-ingredient-move="1" ${at===matches.length-1?'disabled':''}`)}${glyph('Insert Ingredient',toolbarIcon('add'),'data-ingredient-insert')}${glyph('Delete Ingredient',toolbarIcon('trash'),'data-ingredient-delete')}</div>`:'');
        return`<section class="meal-log-card" data-ingredient-key="${key}" data-table="${item.table.id}" data-row="${item.row}"><h3 data-name ${host.table?'hidden':''}></h3><p class="muted" data-missing role="status"></p><div class="meal-log-fields">${editable.map(field=>fieldHtml(field,!!host.table)).join('')}</div>${actions}</section>`;
      }).join('')||'<p class="muted">No matching Ingredients.</p>';
      if(host.table){
        list.insertAdjacentHTML('afterbegin','<div data-ingredient-spacer="before" aria-hidden="true"></div>');
        list.insertAdjacentHTML('beforeend','<div data-ingredient-spacer="after" aria-hidden="true"></div>');
        for(const card of list.querySelectorAll<HTMLElement>('[data-ingredient-key]'))resize.observe(card);
      }
      if(host.photos&&!host.table)for(const item of visible){
        const identity={table:item.table.id,row:item.row},key=ingredientKey(identity);
        const photos=host.photos.strip(()=>({book:host.book().id,date:host.book().foodCapture?.selectedDate??localToday(),target:{kind:'ingredient',identity}}),()=>host.book().foodCapture?.ingredientDetails[key]?.photos??[]);
        list.querySelector(`[data-ingredient-key="${key}"]`)!.append(photos.element);photoPanels.push(photos);
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
      if(host.table)card.querySelector<HTMLElement>('[data-pending-edit]')!.hidden=!edit;
    }
    for(const button of element.querySelectorAll<HTMLButtonElement>('[data-filter]'))button.setAttribute('aria-pressed',String(button.dataset.filter===filter));
    const review=element.querySelector<HTMLButtonElement>('[data-review]')!,count=book.foodCapture?.nutritionConflicts?.length??0;
    review.hidden=!count;review.textContent=`Review nutrition changes (${count})`;
    element.querySelector<HTMLElement>('[data-count]')!.textContent=host.table?`${matches.length} Ingredients`:matches.length?`${page*20+1}–${Math.min(matches.length,(page+1)*20)} of ${matches.length}`:'0 Ingredients';
    if(host.table){
      for(const side of ['before','after'] as const)list.querySelector<HTMLElement>(`[data-ingredient-spacer="${side}"]`)!.style.height=(side==='before'?layout.offsets[start]:layout.offsets.at(-1)!-layout.offsets[end])+'px';
      const history=host.table.historyState();
      for(const button of element.querySelectorAll<HTMLButtonElement>('[data-ingredient-history]'))button.disabled=!history[button.dataset.ingredientHistory as 'undo'|'redo'];
    }else{
      element.querySelector<HTMLButtonElement>('[data-page="-1"]')!.disabled=page===0;
      element.querySelector<HTMLButtonElement>('[data-page="1"]')!.disabled=(page+1)*20>=matches.length;
    }
    if(redrawn&&focus){
      const control=list.querySelector<HTMLInputElement|HTMLButtonElement>(`[data-ingredient-key="${focus.key}"] ${focus.selector}`);
      control?.focus({preventScroll:true});
      if(control instanceof HTMLInputElement&&focus.selection)control.setSelectionRange(focus.selection.start,focus.selection.end,focus.selection.direction??undefined);
    }
  };
  const refresh=()=>{if(refreshing)return;refreshing=true;try{draw();}finally{refreshing=false;}};
  const reveal=(row:string,focus=false,end=false)=>{
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
  element.addEventListener('change',event=>{
    const input=event.target;if(!host.table||!(input instanceof HTMLInputElement)||!input.dataset.field)return;
    try{commit();refresh();}catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('keydown',event=>{
    if(!host.table||event.isComposing)return;
    try{
      if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();commit();refresh();}
      else if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();host.table.history(event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo');}
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('input',event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||event instanceof InputEvent&&event.isComposing)return;
    try{
      if(input!==search){
        const card=input.closest<HTMLElement>('[data-ingredient-key]');if(!card||!input.dataset.field)return;
        const key=card.dataset.ingredientKey!,field=input.dataset.field as keyof Values;
        records();const record=byKey.get(key);if(!record)throw Error('This Ingredient was removed. Reopen Ingredients before editing.');
        host.write('Edit Ingredient draft',[['foodCapture','ingredientEdits',key]],()=>{
          const data=captureData(host.book()),edit=data.ingredientEdits[key]??={values:{},base:{}};
          if(!Object.hasOwn(edit.base,field))edit.base[field]=field==='notes'?data.ingredientDetails[key]?.notes??'':record.values[field]??'';
          edit.values[field]=input.value;
        });
      }else page=0;
      schedule();
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  element.addEventListener('compositionend',event=>event.target?.dispatchEvent(new InputEvent('input',{bubbles:true})),{signal:controller.signal});
  element.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;if(!button||button.disabled)return;
    try{
      if(button.hasAttribute('data-ingredient-add')){if(host.table){const added=host.table.add();if(added){refresh();reveal(added.row,true);}}else host.add();}
      else if(button.dataset.ingredientHistory)host.table?.history(button.dataset.ingredientHistory as 'undo'|'redo');
      else if(button.hasAttribute('data-review'))host.review();
      else if(button.dataset.filter){filter=button.dataset.filter;page=0;refresh();}
      else if(button.dataset.page){page+=Number(button.dataset.page);refresh();list.scrollTop=0;}
      else{
        const card=button.closest<HTMLElement>('[data-ingredient-key]');if(!card)return;
        const key=card.dataset.ingredientKey!,edit=host.book().foodCapture?.ingredientEdits[key];
        const identity={table:card.dataset.table!,row:card.dataset.row!};
        if(host.table){
          if(button.hasAttribute('data-ingredient-type'))host.table.dropdown(identity,button);
          else if(button.hasAttribute('data-ingredient-insert')){const added=host.table.add(identity);if(added){refresh();reveal(added.row,true);}}
          else if(button.dataset.ingredientMove){if(host.table.move(identity,Number(button.dataset.ingredientMove) as -1|1)){refresh();reveal(identity.row);}}
          else if(button.hasAttribute('data-ingredient-delete'))host.table.remove(identity);
        }
        if(button.hasAttribute('data-discard'))host.write('Discard Ingredient draft',[['foodCapture','ingredientEdits',key]],()=>{delete captureData(host.book()).ingredientEdits[key];});
        else if(button.hasAttribute('data-apply')&&edit)host.apply({table:card.dataset.table!,row:card.dataset.row!},edit.values,edit.base);
        refresh();
      }
    }catch(error){host.error(error);}
  },{signal:controller.signal});
  return{element,refresh,last,commit,navigate:(direction:-1|1)=>{refresh();const row=records()[Math.max(0,Math.min(ordered.length-1,layout.at(list.scrollTop)+direction))]?.row;if(row)reveal(row);},
    rememberScroll:()=>{savedScroll=list.scrollTop;},restoreScroll:()=>{list.scrollTop=savedScroll;},restoreFocus:()=>{if(active)list.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[data-ingredient-key="${active.key}"] [data-field="${active.field}"]`)?.focus({preventScroll:true});},
    dispose:()=>{cancelAnimationFrame(frame);resize.disconnect();for(const panel of photoPanels)panel.dispose();controller.abort();projection=[];byKey.clear();projectionBook=undefined;projectionEngine=undefined;}};
}
