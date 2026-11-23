export const dropdownManualActionHtml='<button type="button" class="dropdown-manual-action" aria-label="Custom" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path class="pencil-body" vector-effect="non-scaling-stroke" d="M4 20h4L20 8l-4-4L4 16v4Z"/><path class="pencil-detail" vector-effect="non-scaling-stroke" d="m14 6 4 4"/></svg><span>Custom</span></button>';
export const dropdownArrowHtml='<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path vector-effect="non-scaling-stroke" d="m3 4 3 3 3-3"/></svg>';
export const sourcePickerControlsHtml='<div class="button-row dropdown-view-controls"><button type="button" id="dropdown-list-view">List view</button><button type="button" id="dropdown-grid-view">Grid view</button></div>';
export const sourcePickerBodyHtml='<input class="dropdown-source-search" type="search" aria-label="Search dropdown sources" placeholder="Search sources…"><div id="dropdown-source-cards" class="dropdown-source-cards"></div>';

export function mountSourcePicker(dialog:HTMLDialogElement,options:{
  grid:boolean;viewControls?:boolean;searchLabel?:string;placeholder?:string;changeView?:(grid:boolean)=>void;render:(grid:boolean,query:string)=>void;
}):{refresh:()=>void}{
  const cards=dialog.querySelector<HTMLElement>('#dropdown-source-cards')!,search=dialog.querySelector<HTMLInputElement>('.dropdown-source-search')!;
  if(options.searchLabel)search.setAttribute('aria-label',options.searchLabel);
  if(options.placeholder)search.placeholder=options.placeholder;
  let grid=options.grid;
  const refresh=()=>{
    cards.classList.toggle('dropdown-source-checklist',!grid);
    if(options.viewControls!==false){
      dialog.querySelector('#dropdown-grid-view')!.setAttribute('aria-pressed',String(grid));
      dialog.querySelector('#dropdown-list-view')!.setAttribute('aria-pressed',String(!grid));
    }
    options.render(grid,search.value.toLowerCase());
  };
  search.oninput=refresh;
  if(options.viewControls!==false)for(const [id,value]of [['dropdown-grid-view',true],['dropdown-list-view',false]] as const)dialog.querySelector<HTMLButtonElement>('#'+id)!.onclick=()=>{grid=value;options.changeView?.(grid);refresh();};
  refresh();return{refresh};
}

export function mountSelectDropdown(select:HTMLSelectElement):{refresh:()=>void}{
  const dialog=select.closest('dialog')!,label=select.labels?.[0],trigger=document.createElement('button');
  const name=select.getAttribute('aria-label')??[...label?.childNodes??[]].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim();
  trigger.type='button';trigger.id=select.id+'-trigger';trigger.className='dropdown-field';
  trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label',name);trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',select.id+'-options');
  select.hidden=true;select.after(trigger);if(label)label.htmlFor=trigger.id;
  let closePopup:(()=>void)|undefined;
  const refresh=()=>{const text=document.createElement('span');text.textContent=select.selectedOptions[0]?.textContent??'';trigger.replaceChildren(text);trigger.insertAdjacentHTML('beforeend',dropdownArrowHtml);trigger.disabled=select.disabled;};
  trigger.onclick=()=>{
    if(closePopup){closePopup();return;}
    const popup=document.createElement('div'),panel=document.createElement('div'),controller=new AbortController();
    popup.className='cell-dropdown';popup.setAttribute('aria-label',name+' dropdown');panel.className='dropdown-panel';popup.append(panel);
    const close=()=>{controller.abort();popup.remove();trigger.setAttribute('aria-expanded','false');closePopup=undefined;};closePopup=close;
    const position=()=>{
      if(!popup.isConnected)return;
      const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
      popup.style.width=Math.min(rect.width,width-12)+'px';popup.style.maxHeight=Math.min(360,height-12)+'px';
      const bounds=popup.getBoundingClientRect();popup.style.left=Math.max(left+6,Math.min(rect.left,left+width-bounds.width-6))+'px';popup.style.top=Math.max(top+6,Math.min(rect.bottom+3,top+height-bounds.height-6))+'px';
    };
    const {search,list}=mountDropdownOptions(panel,{choices:[...select.options].filter(option=>!option.disabled),value:option=>option.text,selected:option=>option.value===select.value,name,position,
      choose:option=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));refresh();close();trigger.focus({preventScroll:true});}});
    search.hidden=true;list.id=select.id+'-options';
    popup.onkeydown=e=>{if(e.key==='Escape'||e.key==='Tab'){if(e.key==='Escape')e.preventDefault();close();trigger.focus({preventScroll:true});}else dropdownOptionsKey(e,search,list);e.stopPropagation();};
    popup.addEventListener('focusout',e=>{if(e.relatedTarget instanceof Node&&!popup.contains(e.relatedTarget)&&!trigger.contains(e.relatedTarget))close();});
    dialog.append(popup);trigger.setAttribute('aria-expanded','true');position();(list.querySelector<HTMLButtonElement>('[aria-selected=true]')??list.querySelector<HTMLButtonElement>('button'))?.focus({preventScroll:true});
    document.addEventListener('pointerdown',e=>{if(!popup.contains(e.target as Node)&&!trigger.contains(e.target as Node))close();},{capture:true,signal:controller.signal});
    window.addEventListener('resize',position,{signal:controller.signal});window.visualViewport?.addEventListener('resize',position,{signal:controller.signal});
    dialog.addEventListener('scroll',position,{capture:true,signal:controller.signal});
  };
  trigger.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();if(!closePopup)trigger.click();}};
  select.addEventListener('change',refresh);dialog.addEventListener('close',()=>closePopup?.());refresh();return{refresh};
}

export function mountDropdownOptions<T>(panel:HTMLElement,options:{
  choices:T[];value:(choice:T)=>string;selected:(choice:T)=>boolean;choose:(choice:T)=>void;
  name:string;searchLabel?:string;empty?:string;position:()=>void;
}):{search:HTMLInputElement;list:HTMLDivElement}{
  const search=document.createElement('input'),list=document.createElement('div');
  search.type='search';search.setAttribute('aria-label',options.searchLabel??'Search dropdown options');search.placeholder='Search options…';search.autocomplete='off';
  list.className='cell-dropdown-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',options.name+' options');panel.replaceChildren(search,list);
  const filter=()=>{
    const matches=options.choices.filter(choice=>options.value(choice).toLowerCase().includes(search.value.toLowerCase()));list.replaceChildren();
    for(const choice of matches){
      const value=options.value(choice),button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.tabIndex=-1;
      button.textContent=value===''?'(Blank)':value===' '?'(Space)':value;button.title=value;button.setAttribute('aria-selected',String(options.selected(choice)));button.onclick=()=>options.choose(choice);list.append(button);
    }
    const entry=list.querySelector<HTMLButtonElement>('[aria-selected="true"]')??list.querySelector<HTMLButtonElement>('button');if(entry)entry.tabIndex=0;
    if(!matches.length)list.textContent=options.choices.length?'No matching options.':options.empty??'No available options.';
    options.position();
  };
  search.oninput=filter;filter();return{search,list};
}
export function dropdownOptionsKey(e:KeyboardEvent,search:HTMLInputElement,list:HTMLElement):void{
  const focused=document.activeElement;
  if((focused===search&&['ArrowDown','ArrowUp'].includes(e.key))||(focused?.getAttribute('role')==='option'&&['ArrowDown','ArrowUp','Home','End'].includes(e.key))){
    e.preventDefault();const entries=[...list.querySelectorAll<HTMLButtonElement>('[role="option"]')],at=entries.indexOf(focused as HTMLButtonElement);
    const next=e.key==='Home'?0:e.key==='End'?entries.length-1:(at+(e.key==='ArrowDown'?1:at<0?0:-1)+entries.length)%entries.length;
    if(entries.length){entries.forEach((entry,i)=>entry.tabIndex=i===next?0:-1);entries[next].focus({preventScroll:true});entries[next].scrollIntoView({block:'nearest'});}
  }else if(e.key==='Enter'&&focused===search){e.preventDefault();list.querySelector<HTMLButtonElement>('[role="option"]')?.click();}
}
