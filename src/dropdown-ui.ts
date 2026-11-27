export const dropdownManualActionHtml='<button type="button" class="dropdown-manual-action" aria-label="Custom" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path class="pencil-body" vector-effect="non-scaling-stroke" d="M4 20h4L20 8l-4-4L4 16v4Z"/><path class="pencil-detail" vector-effect="non-scaling-stroke" d="m14 6 4 4"/></svg><span>Custom</span></button>';
export const dropdownArrowHtml='<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path vector-effect="non-scaling-stroke" d="m3 4 3 3 3-3"/></svg>';
export const sourcePickerControlsHtml='<div class="button-row dropdown-view-controls"><button type="button" id="dropdown-list-view">List view</button><button type="button" id="dropdown-grid-view">Grid view</button></div>';
export const sourcePickerBodyHtml='<input class="dropdown-source-search" type="search" aria-label="Search dropdown sources" placeholder="Search sources…"><div id="dropdown-source-cards" class="dropdown-source-cards"></div>';
export type SourcePage=<T>(items:T[])=>T[];
const optionNavigation=new WeakMap<HTMLElement,(key:string,focused:Element|null)=>void>();

export function renderDropdownTrigger(trigger:HTMLButtonElement,label:string,renderContent?:()=>void):void{
  const text=document.createElement('span');text.textContent=label;trigger.replaceChildren(text);
  renderContent?.();trigger.insertAdjacentHTML('beforeend',dropdownArrowHtml);
}

export function findSheetHeaderHtml(label:string,columns?:number):string{
  const header=document.createElement(columns?'tr':'div');header.className='find-sheet-header';
  if(columns){const cell=document.createElement('th');cell.colSpan=columns;cell.textContent=label;header.append(cell);}else header.textContent=label;
  return header.outerHTML;
}
export function dropdownSectionHeader(label:string):HTMLElement{
  const template=document.createElement('template');template.innerHTML=findSheetHeaderHtml(label);
  const summary=document.createElement('summary');summary.className='find-sheet-header dropdown-section-header';
  summary.insertAdjacentHTML('beforeend',`<span class="format-caret">${dropdownArrowHtml}</span>`);summary.append(...template.content.firstChild!.childNodes);
  return summary;
}
export function mountDropdownPanel(panel:HTMLElement,name:string,searchLabel?:string,sharedInput?:HTMLInputElement):{search:HTMLInputElement;list:HTMLDivElement}{
  const search=sharedInput??document.createElement('input'),list=document.createElement('div');
  if(!sharedInput){search.type='search';search.setAttribute('aria-label',searchLabel??'Search dropdown options');search.placeholder='Search options…';search.autocomplete='off';}
  panel.classList.add('dropdown-panel');list.className='cell-dropdown-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',name+' options');
  panel.replaceChildren(...sharedInput?[list]:[search,list]);return{search,list};
}
export function mountDropdownPopup(trigger:HTMLButtonElement,name:string,render:(panel:HTMLElement,position:()=>void,close:()=>void,popup:HTMLDivElement)=>void|(()=>void),width?:number):{close:()=>void}{
  let closePopup:(()=>void)|undefined;
  trigger.type='button';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  trigger.onclick=()=>{
    if(closePopup){closePopup();return;}
    const popup=document.createElement('div'),panel=document.createElement('div'),controller=new AbortController();
    popup.className='cell-dropdown';popup.setAttribute('aria-label',name+' dropdown');panel.className='dropdown-panel';popup.append(panel);
    let dispose:void|(()=>void);
    const close=()=>{dispose?.();controller.abort();popup.remove();trigger.setAttribute('aria-expanded','false');closePopup=undefined;};
    const position=()=>{
      if(!popup.isConnected)return;
      const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,w=viewport?.width??innerWidth,h=viewport?.height??innerHeight;
      popup.style.width=Math.min(width??rect.width,w-12)+'px';popup.style.maxHeight=Math.min(360,h-12)+'px';
      const bounds=popup.getBoundingClientRect();popup.style.left=Math.max(left+6,Math.min(rect.left,left+w-bounds.width-6))+'px';popup.style.top=Math.max(top+6,Math.min(rect.bottom+3,top+h-bounds.height-6))+'px';
    };
    closePopup=close;(trigger.closest('dialog')??document.body).append(popup);trigger.setAttribute('aria-expanded','true');
    dispose=render(panel,position,close,popup);position();
    popup.addEventListener('keydown',event=>{if(event.key==='Escape'||event.key==='Tab'){if(event.key==='Escape')event.preventDefault();trigger.focus({preventScroll:true});close();}event.stopPropagation();});
    popup.addEventListener('focusout',event=>{if(event.relatedTarget instanceof Node&&!popup.contains(event.relatedTarget)&&!trigger.contains(event.relatedTarget))close();});
    document.addEventListener('pointerdown',event=>{if(event.target instanceof Node&&!popup.contains(event.target)&&!trigger.contains(event.target))close();},{capture:true,signal:controller.signal});
    window.addEventListener('resize',position,{signal:controller.signal});window.visualViewport?.addEventListener('resize',position,{signal:controller.signal});
    document.addEventListener('scroll',event=>{if(event.target instanceof Node&&!popup.contains(event.target))position();},{capture:true,signal:controller.signal});
  };
  trigger.closest('dialog')?.addEventListener('close',()=>closePopup?.());
  trigger.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();if(!closePopup)trigger.click();}};
  return{close:()=>closePopup?.()};
}

export function mountSourcePicker(dialog:HTMLDialogElement,options:{
  grid:boolean;viewControls?:boolean;searchLabel?:string;placeholder?:string;changeView?:(grid:boolean)=>void;render:(grid:boolean,query:string,page:SourcePage)=>void;
}):{refresh:()=>void}{
  const cards=dialog.querySelector<HTMLElement>('#dropdown-source-cards')!,search=dialog.querySelector<HTMLInputElement>('.dropdown-source-search')!;
  if(options.searchLabel)search.setAttribute('aria-label',options.searchLabel);
  if(options.placeholder)search.placeholder=options.placeholder;
  let grid=options.grid,page=0,total=0;
  const pagination=document.createElement('div'),previous=document.createElement('button'),next=document.createElement('button'),count=document.createElement('span');
  pagination.className='find-pagination';previous.type=next.type='button';previous.textContent='Previous';next.textContent='Next';
  previous.setAttribute('aria-label','Previous sources page');next.setAttribute('aria-label','Next sources page');pagination.append(previous,count,next);cards.after(pagination);
  const refresh=()=>{
    cards.classList.toggle('dropdown-source-checklist',!grid);
    if(options.viewControls!==false){
      dialog.querySelector('#dropdown-grid-view')!.setAttribute('aria-pressed',String(grid));
      dialog.querySelector('#dropdown-list-view')!.setAttribute('aria-pressed',String(!grid));
    }
    total=0;
    options.render(grid,search.value.toLowerCase(),items=>{
      total=items.length;page=Math.min(page,Math.max(0,Math.ceil(total/40)-1));return items.slice(page*40,page*40+40);
    });
    pagination.hidden=total<=40;count.textContent=`${page*40+1}-${Math.min(total,page*40+40)} of ${total}`;
    previous.disabled=page===0;next.disabled=(page+1)*40>=total;
  };
  search.oninput=()=>{page=0;refresh();};
  previous.onclick=()=>{page--;refresh();cards.scrollTop=0;};next.onclick=()=>{page++;refresh();cards.scrollTop=0;};
  if(options.viewControls!==false)for(const [id,value]of [['dropdown-grid-view',true],['dropdown-list-view',false]] as const)dialog.querySelector<HTMLButtonElement>('#'+id)!.onclick=()=>{grid=value;options.changeView?.(grid);refresh();};
  refresh();return{refresh};
}

export function mountSelectDropdown(select:HTMLSelectElement,options?:{renderOption?:(button:HTMLButtonElement,option:HTMLOptionElement)=>void;fitOptions?:boolean}):{refresh:()=>void;close:()=>void}{
  const label=select.labels?.[0],trigger=document.createElement('button');
  const name=select.getAttribute('aria-label')??[...label?.childNodes??[]].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim();
  trigger.type='button';trigger.id=select.id+'-trigger';trigger.className='dropdown-field';
  trigger.classList.toggle('dropdown-fit-options',options?.fitOptions===true);
  trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label',name);trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',select.id+'-options');
  select.hidden=true;select.after(trigger);if(label)label.htmlFor=trigger.id;
  const refresh=()=>{
    trigger.title=select.title;
    const description=select.getAttribute('aria-description');
    if(description)trigger.setAttribute('aria-description',description);else trigger.removeAttribute('aria-description');
    renderDropdownTrigger(trigger,select.selectedOptions[0]?.textContent??'',()=>{
      if(select.selectedOptions[0])options?.renderOption?.(trigger,select.selectedOptions[0]);
      if(options?.fitOptions)for(const option of select.options){
        const size=document.createElement('span');size.className='dropdown-option-size';size.setAttribute('aria-hidden','true');size.textContent=option.textContent;trigger.append(size);
      }
    });
    trigger.disabled=select.disabled;
  };
  const popupControl=mountDropdownPopup(trigger,name,(panel,position,close,popup)=>{
    const {search,list,dispose}=mountDropdownOptions(panel,{choices:[...select.options].filter(option=>!option.disabled),value:option=>option.text,selected:option=>option.value===select.value,name,position,renderOption:options?.renderOption,
      choose:option=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));refresh();close();trigger.focus({preventScroll:true});}});
    search.hidden=true;list.id=select.id+'-options';
    popup.onkeydown=e=>dropdownOptionsKey(e,search,list);
    position();(list.querySelector<HTMLButtonElement>('[aria-selected=true]')??list.querySelector<HTMLButtonElement>('button'))?.focus({preventScroll:true});
    return dispose;
  });
  select.addEventListener('change',refresh);refresh();return{refresh,close:popupControl.close};
}

export function mountDropdownOptions<T>(panel:HTMLElement,options:{
  choices:T[];value:(choice:T)=>string;selected:(choice:T)=>boolean;choose:(choice:T)=>void;
  name:string;searchLabel?:string;empty?:string;position:()=>void;sharedInput?:HTMLInputElement;initialQuery?:string;renderOption?:(button:HTMLButtonElement,choice:T)=>void;
}):{search:HTMLInputElement;list:HTMLDivElement;dispose:()=>void}{
  const {search,list}=mountDropdownPanel(panel,options.name,options.searchLabel,options.sharedInput);
  const normalized=options.choices.map(choice=>({choice,value:options.value(choice),lower:options.value(choice).toLowerCase()}));
  let matches=normalized,start=0,active=0,frame=0;
  const heights=new Map<(typeof normalized)[number],number>();
  let offsets:number[]=[];
  const measureOffsets=()=>{offsets=[0];for(const match of matches)offsets.push(offsets.at(-1)!+(heights.get(match)??28));};
  const spacer=(height:number)=>{const element=document.createElement('div');element.setAttribute('role','presentation');element.style.height=Math.max(0,height)+'px';element.style.flexShrink='0';return element;};
  const draw=()=>{
    const end=Math.min(matches.length,start+80),focused=document.activeElement as HTMLElement|null,focusedIndex=focused?.parentElement===list?Number(focused.dataset.optionIndex):undefined;
    list.replaceChildren();
    const top=spacer(offsets[start]??0),bottom=spacer((offsets.at(-1)??0)-(offsets[end]??0));
    list.append(top);
    for(let i=start;i<end;i++){
      const {choice,value}=matches[i],button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.tabIndex=i===active?0:-1;button.dataset.optionIndex=String(i);
      button.setAttribute('aria-posinset',String(i+1));button.setAttribute('aria-setsize',String(matches.length));
      button.textContent=value===''?'(Blank)':value===' '?'(Space)':value;options.renderOption?.(button,choice);button.title=value;button.setAttribute('aria-selected',String(options.selected(choice)));button.onclick=()=>options.choose(choice);list.append(button);
    }
    list.append(bottom);
    if(!matches.length)list.textContent=options.choices.length?'No matching options.':options.empty??'No available options.';
    options.position();
    let changed=false;
    for(const button of list.querySelectorAll<HTMLElement>('[role=option]')){
      const match=matches[Number(button.dataset.optionIndex)],height=button.getBoundingClientRect().height;
      if(height&&heights.get(match)!==height){heights.set(match,height);changed=true;}
    }
    if(changed){measureOffsets();top.style.height=offsets[start]+'px';bottom.style.height=(offsets.at(-1)!-offsets[end])+'px';}
    if(focusedIndex!==undefined&&focusedIndex>=start&&focusedIndex<end)list.querySelector<HTMLButtonElement>(`[data-option-index="${focusedIndex}"]`)?.focus({preventScroll:true});
  };
  const focus=(index:number)=>{
    if(!matches.length)return;
    active=index;
    if(index<start||index>=start+80){start=Math.max(0,Math.min(index-8,matches.length-80));draw();}
    list.querySelectorAll<HTMLButtonElement>('[role=option]').forEach(button=>button.tabIndex=Number(button.dataset.optionIndex)===index?0:-1);
    const button=list.querySelector<HTMLButtonElement>(`[data-option-index="${index}"]`)!;button.focus({preventScroll:true});button.scrollIntoView({block:'nearest'});
  };
  const onScroll=()=>{
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      let low=0,high=matches.length;
      while(low<high){const middle=(low+high)>>>1;if(offsets[middle+1]<=list.scrollTop)low=middle+1;else high=middle;}
      const next=Math.max(0,Math.min(low-8,matches.length-80));
      if(start!==next){start=next;draw();}
    });
  };
  list.addEventListener('scroll',onScroll);
  optionNavigation.set(list,(key,focused)=>{
    const at=focused===search?-1:Number((focused as HTMLElement)?.dataset.optionIndex??active);
    focus(key==='Home'?0:key==='End'?matches.length-1:key==='ArrowDown'?(at+1)%matches.length:at<0?matches.length-1:(at-1+matches.length)%matches.length);
  });
  const filter=(value:string)=>{
    const query=value.toLowerCase();matches=normalized.filter(choice=>choice.lower.includes(query));
    active=Math.max(0,matches.findIndex(entry=>options.selected(entry.choice)));start=Math.max(0,Math.min(active-8,matches.length-80));measureOffsets();draw();list.scrollTop=offsets[active]??0;
  };
  const onInput=()=>filter(search.value);
  search.addEventListener('input',onInput);filter(options.initialQuery??search.value);
  return{search,list,dispose:()=>{search.removeEventListener('input',onInput);list.removeEventListener('scroll',onScroll);cancelAnimationFrame(frame);optionNavigation.delete(list);}};
}
export function dropdownOptionsKey(e:KeyboardEvent,search:HTMLInputElement,list:HTMLElement):void{
  const focused=document.activeElement;
  if((focused===search&&['ArrowDown','ArrowUp'].includes(e.key))||(focused?.getAttribute('role')==='option'&&['ArrowDown','ArrowUp','Home','End'].includes(e.key))){
    const navigate=optionNavigation.get(list);if(navigate){e.preventDefault();navigate(e.key,focused);return;}
    e.preventDefault();const entries=[...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].filter(entry=>entry.checkVisibility()),at=entries.indexOf(focused as HTMLButtonElement);
    const next=e.key==='Home'?0:e.key==='End'?entries.length-1:(at+(e.key==='ArrowDown'?1:at<0?0:-1)+entries.length)%entries.length;
    if(entries.length){entries.forEach((entry,i)=>entry.tabIndex=i===next?0:-1);entries[next].focus({preventScroll:true});entries[next].scrollIntoView({block:'nearest'});}
  }else if(e.key==='Enter'&&focused===search){e.preventDefault();[...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(entry=>entry.checkVisibility())?.click();}
}
