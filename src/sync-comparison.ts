import {parseArchive} from './archive';
import {validateBackup,type Backup} from './storage';
import type {Workbook} from './model';
import {workbookDifferences,type WorkbookDifference} from './sync-diff';

export function comparisonBackup(contents:string):Workbook{
  const backup=parseArchive(contents) as Backup;
  validateBackup(backup);
  return backup.state.book;
}
export function mountWorkbookComparison(container:HTMLElement,local:Workbook,remote:Workbook|undefined,onError:(error:unknown)=>void):{dispose:()=>void;setRemote:(copy:Workbook)=>void}{
  container.classList.add('sync-comparison');
  container.innerHTML=`<p>Read-only comparison. Backup files stay in this browser: they are not restored or sent to GitHub. Without a common base, these are differences, not proof both devices edited the same cell. Revision and activity counters are ignored.</p>
    <p id="comparison-left-label"></p><label>Use a backup for the left side<input id="comparison-left" type="file" accept=".json"></label>
    <p id="comparison-right-label"></p><label>Use a backup for the right side<input id="comparison-right" type="file" accept=".json"></label>
    <label>Filter differences<input id="comparison-search" type="search" placeholder="Sheet, table, field or contents"></label>
    <label>Difference type<select id="comparison-kind"><option value="">All differences</option value="Cell">Cells</option><option value="Structure">Structure</option><option value="Settings">Settings</option></select></label>
    <p id="comparison-status" role="status"></p><p id="comparison-error" role="alert" hidden></p>
    <div class="find-results-scroll sync-comparison-results"><table class="spreadsheet-grid find-results-table sync-comparison-table" aria-label="Workbook differences"><colgroup><col style="width:30%"><col style="width:35%"><col style="width:35%"></colgroup><thead><tr><th>Location</th><th id="comparison-left-heading">This device</th><th id="comparison-right-heading">Compared copy</th></tr></thead><tbody></tbody></table></div>
    <div class="find-pagination"><button id="comparison-previous">Previous</button><span id="comparison-page"></span><button id="comparison-next">Next</button></div>`;
  const find=<T extends HTMLElement>(selector:string)=>container.querySelector<T>(selector)!;
  const status=find('#comparison-status'),error=find('#comparison-error'),body=find('tbody'),search=find<HTMLInputElement>('#comparison-search'),kind=find<HTMLSelectElement>('#comparison-kind');
  const previous=find<HTMLButtonElement>('#comparison-previous'),next=find<HTMLButtonElement>('#comparison-next'),pageLabel=find('#comparison-page');
  let left=local,right=remote,leftLabel='This device',rightLabel=remote?'GitHub saved version':'No compared copy loaded';
  let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,scanning=false,checked=0,page=0,lastPaint=0;
  let entries:WorkbookDifference[]=[],filtered:WorkbookDifference[]=[];
  let counts={Cell:0,Structure:0,Settings:0};
  const loads={left:0,right:0},pageSize=30;
  const matches=(entry:WorkbookDifference)=>!kind.value||entry.kind===kind.value;
  const matchesQuery=(entry:WorkbookDifference)=>{
    const query=search.value.trim().toLowerCase();
    return matches(entry)&&(!query||`${entry.location}\n${entry.local}\n${entry.remote}`.toLowerCase().includes(query));
  };
  const valueElement=(value:string)=>{
    const element=document.createElement(value.length>240?'details':'div');
    if(value.length>240){
      const summary=document.createElement('summary');summary.textContent=`${value.slice(0,160)}… (show full value)`;element.append(summary);
      element.addEventListener('toggle',()=>{
        if(!(element as HTMLDetailsElement).open||element.querySelector('pre'))return;
        const pre=document.createElement('pre');pre.textContent=value;element.append(pre);
      });
    }else element.textContent=value;
    return element;
  };
  const draw=()=>{
    status.textContent=right?`${entries.length} differences: ${counts.Cell} cells, ${counts.Structure} structure, ${counts.Settings} settings. ${scanning?`Comparing… ${checked} items checked.`:'Comparison complete.'}`:'Choose a full Fnt backup for the right side to begin.';
    body.replaceChildren();
    const pages=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,pages-1);
    for(const entry of filtered.slice(page*pageSize,(page+1)*pageSize)){
      const row=document.createElement('tr');
      for(const value of [`${entry.kind}\n${entry.location}`,entry.local,entry.remote]){
        const cell=document.createElement('td');cell.append(valueElement(value));row.append(cell);
      }
      body.append(row);
    }
    pageLabel.textContent=`${filtered.length} matching · Page ${page+1} of ${pages}`;
    previous.disabled=page===0;next.disabled=page+1===pages;
  };
  const start=()=>{
    clearTimeout(timer);entries=[];filtered=[];counts={Cell:0,Structure:0,Settings:0};checked=0;page=0;scanning=!!right;
    find('#comparison-left-label').textContent=`Left: ${leftLabel} — ${left.title}`;
    find('#comparison-right-label').textContent=`Right: ${rightLabel}${right?` — ${right.title}`:''}`;
    find('#comparison-left-heading').textContent=leftLabel;find('#comparison-right-heading').textContent=right?'Compared copy':'No copy loaded';
    draw();if(!right)return;
    const iterator=workbookDifferences(left,right);
    const step=()=>{
      if(disposed||!container.isConnected)return;
      try{
        const until=performance.now()+8;
        do{
          const result=iterator.next();
          if(result.done){scanning=false;draw();return;}
          checked++;
          if(result.value){entries.push(result.value);counts[result.value.kind]++;if(matchesQuery(result.value))filtered.push(result.value);}
        }while(performance.now()<until);
        if(performance.now()-lastPaint>100){draw();lastPaint=performance.now();}
        timer=setTimeout(step,0);
      }catch(e){scanning=false;error.hidden=false;error.textContent=`Comparison failed. Both workbooks are unchanged. ${String(e)}`;draw();onError(e);}
    };
    timer=setTimeout(step,0);
  };
  for(const side of ['left','right'] as const){
    const input=find<HTMLInputElement>(`#comparison-${side}`);
    input.onchange=async()=>{
      const file=input.files?.[0];if(!file)return;
      const request=++loads[side];
      try{
        const copy=comparisonBackup(await file.text());
        if(disposed||request!==loads[side])return;
        if(side==='left'){left=copy;leftLabel=`Backup: ${file.name}`;}else{right=copy;rightLabel=`Backup: ${file.name}`;}
        error.hidden=true;start();
      }catch(e){if(disposed||request!==loads[side])return;error.hidden=false;error.textContent=`Backup not loaded; previous comparison retained. ${String(e)}`;onError(e);}
    };
  }
  const filter=()=>{page=0;filtered=entries.filter(matchesQuery);draw();};
  search.oninput=filter;kind.onchange=filter;
  previous.onclick=()=>{page--;draw();};next.onclick=()=>{page++;draw();};
  start();
  return{
    dispose:()=>{disposed=true;clearTimeout(timer);},
    setRemote:copy=>{right=copy;rightLabel='GitHub saved version';error.hidden=true;start();},
  };
}
