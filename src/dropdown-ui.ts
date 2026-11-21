export const dropdownManualActionHtml='<button type="button" class="dropdown-manual-action" aria-label="Manual" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path class="pencil-body" vector-effect="non-scaling-stroke" d="M4 20h4L20 8l-4-4L4 16v4Z"/><path class="pencil-detail" vector-effect="non-scaling-stroke" d="m14 6 4 4"/></svg><span>manual</span></button>';

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
