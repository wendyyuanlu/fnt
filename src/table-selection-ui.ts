import {dropdownArrowHtml,dropdownOptionsKey,mountDropdownOptions} from './dropdown-ui';

export function mountTableSelection(control:HTMLElement,host:{
  enabled:()=>boolean;target:()=>string|undefined;choices:{id:string;name:string}[];choose:(id:string)=>void;
}):{refresh:()=>void;close:()=>void}{
  const toggle=control.querySelector<HTMLButtonElement>('[data-action="table-selection"]')!,menu=control.querySelector<HTMLButtonElement>('#table-selection-target')!;
  let closePopup:(()=>void)|undefined;
  const refresh=()=>{
    const enabled=host.enabled(),name=host.choices.find(choice=>choice.id===(host.target()??''))?.name??'Auto';
    control.dataset.enabled=String(enabled);menu.dataset.value=host.target()??'';
    toggle.setAttribute('aria-pressed',String(enabled));toggle.title=enabled?'Turn off table selection':'Turn on table selection';
    toggle.innerHTML=`<svg class="toolbar-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect vector-effect="non-scaling-stroke" x="5" y="10" width="14" height="11" rx="2"/><path vector-effect="non-scaling-stroke" d="${enabled?'M8 10V7a4 4 0 0 1 8 0v3':'M8 10V7a4 4 0 0 1 8 0'}"/><path vector-effect="non-scaling-stroke" d="M12 14v3"/></svg>`;
    menu.title='Choose selection table: '+name;
  };
  menu.innerHTML=dropdownArrowHtml;menu.setAttribute('aria-haspopup','listbox');menu.setAttribute('aria-expanded','false');
  menu.onclick=()=>{
    if(closePopup){closePopup();return;}
    const popup=document.createElement('div'),panel=document.createElement('div'),controller=new AbortController();
    popup.className='cell-dropdown table-selection-dropdown';panel.className='dropdown-panel';popup.append(panel);document.body.append(popup);
    const close=()=>{controller.abort();popup.remove();menu.setAttribute('aria-expanded','false');closePopup=undefined;};closePopup=close;
    const position=()=>{
      const rect=control.getBoundingClientRect(),viewport=visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
      popup.style.width=Math.min(220,width-12)+'px';popup.style.maxHeight=Math.min(360,height-12)+'px';
      const box=popup.getBoundingClientRect();popup.style.left=Math.max(left+6,Math.min(rect.left,left+width-box.width-6))+'px';popup.style.top=Math.max(top+6,Math.min(rect.bottom+4,top+height-box.height-6))+'px';
    };
    const {search,list}=mountDropdownOptions(panel,{choices:host.choices,value:choice=>choice.name,selected:choice=>choice.id===(host.target()??''),name:'Table selection',position,choose:choice=>{
      close();host.choose(choice.id);refresh();menu.focus({preventScroll:true});
    }});
    search.hidden=true;menu.setAttribute('aria-expanded','true');position();
    (list.querySelector<HTMLButtonElement>('[aria-selected=true]')??list.querySelector<HTMLButtonElement>('button'))?.focus({preventScroll:true});
    popup.onkeydown=e=>{if(e.key==='Escape'||e.key==='Tab'){if(e.key==='Escape')e.preventDefault();close();if(e.key==='Escape')menu.focus({preventScroll:true});}else dropdownOptionsKey(e,search,list);e.stopPropagation();};
    popup.addEventListener('focusout',e=>{if(e.relatedTarget instanceof Node&&!popup.contains(e.relatedTarget)&&!control.contains(e.relatedTarget))close();});
    document.addEventListener('pointerdown',e=>{if(!popup.contains(e.target as Node)&&!control.contains(e.target as Node))close();},{capture:true,signal:controller.signal});
    window.addEventListener('resize',position,{signal:controller.signal});visualViewport?.addEventListener('resize',position,{signal:controller.signal});document.addEventListener('scroll',position,{capture:true,signal:controller.signal});
  };
  menu.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();if(!closePopup)menu.click();}};
  refresh();return{refresh:()=>{closePopup?.();refresh();},close:()=>closePopup?.()};
}
