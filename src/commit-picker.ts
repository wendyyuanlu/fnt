import {dropdownOptionsKey,dropdownSectionHeader,mountDropdownPanel,mountDropdownPopup,renderDropdownTrigger} from './dropdown-ui';
import {snapshotDate,type ComparisonCommit,type ComparisonCommitPage,type ComparisonSnapshot} from './github-snapshots';
import './commit-picker.css';

interface PickerEntry {id:string;time:string;search:string;cells:string[];title?:string}
interface PickerOptions {
  label:string;headers:string[];list?:((page:number)=>Promise<{entries:PickerEntry[];next?:number}>);
  choose:(id:string)=>void;selected:()=>string|undefined;available?:()=>boolean;
  latest?:{choose:()=>void;selected:()=>boolean};sync?:()=>void;manage?:()=>void;canChoose?:()=>boolean;
}
function mountComparisonPicker(trigger:HTMLButtonElement,options:PickerOptions):{close:()=>void}{
  trigger.classList.add('dropdown-field');renderDropdownTrigger(trigger,options.label);
  return mountDropdownPopup(trigger,trigger.getAttribute('aria-label')??options.label,(panel,position,close,popup)=>{
    popup.classList.add('commit-popup');popup.dataset.columns=String(options.headers.length);
    const {search,list}=mountDropdownPanel(panel,options.label,'Search '+options.label.toLowerCase());
    list.classList.add('commit-options');list.setAttribute('aria-label',options.label);list.id=trigger.id+'-options';trigger.setAttribute('aria-controls',list.id);
    const status=document.createElement('div'),footer=document.createElement('div'),more=document.createElement('button');
    status.setAttribute('role','status');footer.className='dropdown-footer';more.type='button';more.textContent='Load earlier commits';footer.append(more);popup.append(status,footer);
    const available=()=>options.available?.()??true,canChoose=()=>available()&&(options.canChoose?.()??true);
    const action=(label:string,run:()=>void)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>{close();run();};footer.append(button);return button;};
    if(options.sync&&!available())action('Sync GitHub',options.sync);
    if(options.manage){const manage=action('Manage',options.manage);manage.disabled=!available();}
    let entries:PickerEntry[]=[],next:number|undefined=options.list&&available()?1:undefined,loading=false,failure:string|undefined;
    const collapsed=new Set<string>(),dayFormat=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'long',day:'numeric'});
    const draw=()=>{
      const query=search.value.toLowerCase(),groups=new Map<string,PickerEntry[]>();
      for(const entry of [...entries].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time))){
        const day=dayFormat.format(new Date(entry.time));if(query&&!`${day} ${entry.search}`.toLowerCase().includes(query))continue;
        const group=groups.get(day)??[];group.push(entry);groups.set(day,group);
      }
      const header=document.createElement('div');header.className='find-sheet-header commit-columns commit-header';
      for(const text of options.headers){const cell=document.createElement('span');cell.textContent=text;header.append(cell);}
      list.replaceChildren(header);
      if(options.latest&&(!query||'latest saved workbook current branch'.includes(query))){
        const button=document.createElement('button');button.type='button';button.className='commit-columns commit-option';button.setAttribute('role','option');button.setAttribute('aria-label','Latest saved workbook');
        button.setAttribute('aria-selected',String(options.latest.selected()));button.disabled=!canChoose();
        for(const text of ['Latest saved workbook','—','Current']){const cell=document.createElement('span');cell.textContent=text;button.append(cell);}
        button.title='Fetch the newest saved workbook now. Dated rows open a fixed saved version.';
        button.onclick=()=>{close();options.latest!.choose();};list.append(button);
      }
      for(const [day,groupEntries]of groups){
        const group=document.createElement('details'),rows=document.createElement('div');group.className='dropdown-section commit-day';group.open=!!query||!collapsed.has(day);
        rows.setAttribute('role','group');rows.setAttribute('aria-label',day);
        for(const entry of groupEntries){
          const button=document.createElement('button');button.type='button';button.className='commit-columns commit-option';button.setAttribute('role','option');button.setAttribute('aria-selected',String(options.selected()===entry.id));
          button.dataset[options.headers.length===3?'commit':'upload']=entry.id;button.disabled=!canChoose();button.title=entry.title??entry.search;
          for(const [index,text]of entry.cells.entries()){const cell=document.createElement('span');cell.textContent=text;if(options.headers.length===2)cell.className=index?'snapshot-device':'snapshot-date';button.append(cell);}
          button.onclick=()=>{close();options.choose(entry.id);};rows.append(button);
        }
        if(options.headers.length===2){list.append(rows);continue;}
        group.append(dropdownSectionHeader(day),rows);group.ontoggle=()=>{if(!query){if(group.open)collapsed.delete(day);else collapsed.add(day);}};list.append(group);
      }
      status.textContent=loading?'Reading '+options.label.toLowerCase()+'…':failure??(query&&!groups.size?'No matching options.':'');
      status.hidden=!status.textContent;
      more.textContent=failure?'Retry reading copies':'Load earlier commits';more.hidden=next===undefined;more.disabled=loading;
      footer.hidden=[...footer.children].every(button=>(button as HTMLElement).hidden);position();
    };
    const load=async()=>{
      if(loading||next===undefined)return;loading=true;failure=undefined;draw();
      try{const result=await options.list!(next);if(!popup.isConnected)return;const known=new Set(entries.map(entry=>entry.id));for(const entry of result.entries)if(!known.has(entry.id)){known.add(entry.id);entries.push(entry);}next=result.next;loading=false;draw();}
      catch(error){if(popup.isConnected){loading=false;failure=`${options.label} unavailable. ${error instanceof Error?error.message:String(error)}`;draw();}}
    };
    more.onclick=()=>void load();search.oninput=draw;popup.onkeydown=event=>dropdownOptionsKey(event,search,list);
    draw();search.focus({preventScroll:true});void load();
  },380);
}
export function mountCommitPicker(trigger:HTMLButtonElement,options:{
  list?:((page:number)=>Promise<ComparisonCommitPage>);choose:(commit:ComparisonCommit)=>void;selected:()=>string|undefined;
  latest?:{choose:()=>void;selected:()=>boolean};available?:()=>boolean;sync?:()=>void;canChoose?:()=>boolean;
}):{close:()=>void}{
  const commits=new Map<string,ComparisonCommit>(),time=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'});
  return mountComparisonPicker(trigger,{...options,label:'Commits',headers:['Time','Changes','Commit'],choose:id=>options.choose(commits.get(id)!),
    list:options.list?async page=>{const result=await options.list!(page);return{entries:result.commits.map(commit=>{commits.set(commit.sha,commit);return{id:commit.sha,time:commit.time,search:`${time.format(new Date(commit.time))} ${commit.message} ${commit.sha}`,cells:[time.format(new Date(commit.time)),commit.changes===undefined?'—':String(commit.changes),commit.sha.slice(0,8)]};}),next:result.next};}:undefined});
}
export function mountUploadPicker(trigger:HTMLButtonElement,options:{
  list:()=>Promise<ComparisonSnapshot[]>;choose:(entry:ComparisonSnapshot)=>void;selected:()=>string|undefined;available:()=>boolean;sync?:()=>void;manage:()=>void;canChoose?:()=>boolean;
}):{close:()=>void}{
  const files=new Map<string,ComparisonSnapshot>();
  return mountComparisonPicker(trigger,{...options,label:'Uploads',headers:['Date','Device'],choose:id=>options.choose(files.get(id)!),
    list:async()=>({entries:(await options.list()).map(entry=>{files.set(entry.path,entry);return{id:entry.path,time:entry.time,search:`${snapshotDate(entry.time)} ${entry.device}`,cells:[snapshotDate(entry.time),entry.device]};})})});
}
