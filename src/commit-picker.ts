import {dropdownArrowHtml,dropdownOptionsKey} from './dropdown-ui';
import type {ComparisonCommit,ComparisonCommitPage} from './github-snapshots';
import './commit-picker.css';

export function mountCommitPicker(trigger:HTMLButtonElement,options:{
  list:(page:number)=>Promise<ComparisonCommitPage>;choose:(commit:ComparisonCommit)=>void;selected:()=>string|undefined;
}):{close:()=>void}{
  trigger.type='button';trigger.classList.add('dropdown-field');
  trigger.innerHTML=`<span>Commits</span><span class="format-caret">${dropdownArrowHtml}</span>`;
  trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  let closePopup:(()=>void)|undefined;
  trigger.onclick=()=>{
    if(closePopup){closePopup();return;}
    const popup=document.createElement('div'),search=document.createElement('input'),list=document.createElement('div'),status=document.createElement('p'),more=document.createElement('button'),controller=new AbortController();
    popup.className='cell-dropdown commit-popup';popup.setAttribute('aria-label',trigger.getAttribute('aria-label')!);
    search.type='search';search.autocomplete='off';search.placeholder='Search commits…';search.setAttribute('aria-label','Search commits');
    list.className='cell-dropdown-options commit-options';list.setAttribute('role','listbox');list.setAttribute('aria-label','Commits');list.id=trigger.id+'-options';
    trigger.setAttribute('aria-controls',list.id);
    status.className='muted';status.setAttribute('role','status');more.type='button';more.textContent='Load earlier commits';
    popup.append(search,list,status,more);
    let entries:ComparisonCommit[]=[],next:number|undefined=1,loading=false,failure:string|undefined;
    const collapsed=new Set<string>(),timeFormat=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZoneName:'short'}),dayFormat=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'long',day:'numeric'});
    const close=()=>{controller.abort();popup.remove();trigger.setAttribute('aria-expanded','false');closePopup=undefined;};closePopup=close;
    const position=()=>{
      const rect=trigger.getBoundingClientRect(),viewport=visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
      popup.style.width=Math.min(480,width-20)+'px';popup.style.maxHeight=Math.max(0,Math.min(440,height-20))+'px';
      popup.style.left=Math.max(left+10,Math.min(rect.left,left+width-popup.offsetWidth-10))+'px';
      popup.style.top=Math.max(top+10,Math.min(rect.bottom+4,top+height-popup.offsetHeight-10))+'px';
    };
    const draw=()=>{
      const query=search.value.toLowerCase(),groups=new Map<string,ComparisonCommit[]>();
      for(const entry of [...entries].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time))){
        const date=dayFormat.format(new Date(entry.time)),time=timeFormat.format(new Date(entry.time));
        if(query&&!`${date} ${time} ${entry.message} ${entry.sha}`.toLowerCase().includes(query))continue;
        const group=groups.get(date)??[];group.push(entry);groups.set(date,group);
      }
      const header=document.createElement('div');header.className='commit-columns commit-header';
      for(const name of ['Time','Changes','Commit']){const cell=document.createElement('span');cell.textContent=name;header.append(cell);}
      list.replaceChildren(header);
      for(const [date,commits]of groups){
        const group=document.createElement('details'),summary=document.createElement('summary'),label=document.createElement('span'),rows=document.createElement('div');
        group.className='commit-day';group.open=!!query||!collapsed.has(date);
        summary.innerHTML=`<span class="format-caret">${dropdownArrowHtml}</span>`;label.textContent=date;summary.append(label);
        rows.setAttribute('role','group');rows.setAttribute('aria-label',date);
        for(const entry of commits){
          const button=document.createElement('button'),time=document.createElement('span'),changes=document.createElement('span'),sha=document.createElement('span');
          button.type='button';button.className='commit-columns commit-option';button.setAttribute('role','option');button.setAttribute('aria-selected',String(options.selected()===entry.sha));button.dataset.commit=entry.sha;
          time.textContent=timeFormat.format(new Date(entry.time));changes.textContent=entry.changes===undefined?entry.message:String(entry.changes);changes.title=entry.message;sha.textContent=entry.sha.slice(0,8);sha.title=entry.sha;
          button.title=`${date} · ${time.textContent} · ${entry.message} · ${entry.sha}`;
          button.append(time,changes,sha);button.onclick=()=>{close();options.choose(entry);};rows.append(button);
        }
        group.append(summary,rows);group.ontoggle=()=>{if(!query){if(group.open)collapsed.delete(date);else collapsed.add(date);}};list.append(group);
      }
      status.textContent=loading?'Reading commit history…':failure??(query&&!groups.size?'No matching commits.':entries.length?`${entries.length} commits loaded. Times use this device’s time zone. Changes shows the recorded save count, or the commit message.`:'No commits found.');
      more.textContent=failure?'Retry reading commits':'Load earlier commits';more.hidden=next===undefined;more.disabled=loading;position();
    };
    const load=async()=>{
      if(loading||next===undefined)return;
      loading=true;failure=undefined;draw();
      try{
        const page=await options.list(next);
        if(!popup.isConnected)return;
        const known=new Set(entries.map(entry=>entry.sha));for(const entry of page.commits)if(!known.has(entry.sha)){known.add(entry.sha);entries.push(entry);}next=page.next;loading=false;draw();
      }catch(error){if(popup.isConnected){loading=false;failure=`Commit history unavailable. ${error instanceof Error?error.message:String(error)}`;draw();}}
    };
    more.onclick=()=>void load();search.oninput=draw;
    popup.onkeydown=event=>{
      if(event.key==='Escape'){event.preventDefault();close();trigger.focus({preventScroll:true});}
      else if(event.key==='Tab')close();
      else dropdownOptionsKey(event,search,list);
      event.stopPropagation();
    };
    document.body.append(popup);trigger.setAttribute('aria-expanded','true');position();search.focus({preventScroll:true});void load();
    document.addEventListener('pointerdown',event=>{if(event.target instanceof Node&&!popup.contains(event.target)&&!trigger.contains(event.target))close();},{capture:true,signal:controller.signal});
    window.addEventListener('resize',position,{signal:controller.signal});window.visualViewport?.addEventListener('resize',position,{signal:controller.signal});
    document.addEventListener('scroll',event=>{if(event.target instanceof Node&&!popup.contains(event.target))position();},{capture:true,signal:controller.signal});
  };
  trigger.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();if(!closePopup)trigger.click();}};
  return{close:()=>closePopup?.()};
}
