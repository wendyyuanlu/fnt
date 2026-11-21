import { createReference,duplicateReference,normalizeReferenceGroup,referenceCaption,referenceLabel,referenceNavigation,referenceUsages,setDerivedSource,setReferencePresentation,type ReferenceNavigation } from './references';
import { clone,uniqueName,type ReferenceSource,type Workbook } from './model';
import { dropdownManualActionHtml,dropdownOptionsKey,mountDropdownOptions } from './dropdown-ui';

export interface ReferenceHost{
  book:()=>Workbook;esc:(v:unknown)=>string;mutate:(label:string,fn:()=>void)=>boolean;
  dialog:(title:string,html:string,mount?:(d:HTMLDialogElement)=>void)=>HTMLDialogElement;
  askText:(title:string,value:string,fn:(value:string)=>void)=>void;
  importSource:(file?:File)=>Promise<void>;open:(id:string,selection?:string[])=>void;bind:(source:ReferenceSource,selection?:ReferenceSource[])=>void;
}
function mountGroupPicker(host:ReferenceHost,d:HTMLDialogElement):void{
  const input=d.querySelector<HTMLInputElement>('#reference-group')!;
  input.removeAttribute('list');input.hidden=true;d.querySelector('#reference-groups')?.remove();
  const trigger=document.createElement('button');trigger.type='button';trigger.className='reference-group-picker';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label','Group');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  input.after(trigger);let closePopup:(()=>void)|undefined,manualStart=input.value,manualChanged=input.dataset.changed,manualEmpty=input.dataset.emptyLabel;
  const display=()=>{trigger.replaceChildren(document.createTextNode(input.value||input.dataset.emptyLabel||'Standalone'));const caret=document.createElement('span');caret.className='format-caret';caret.setAttribute('aria-hidden','true');trigger.append(caret);};
  input.addEventListener('input',()=>{input.dataset.changed='true';delete input.dataset.emptyLabel;});
  const finishManual=()=>{input.hidden=true;trigger.hidden=false;display();};
  input.onblur=finishManual;
  input.onkeydown=e=>{if(!['Enter','Escape'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='Escape'){input.value=manualStart;if(manualChanged===undefined)delete input.dataset.changed;else input.dataset.changed=manualChanged;if(manualEmpty===undefined)delete input.dataset.emptyLabel;else input.dataset.emptyLabel=manualEmpty;}finishManual();trigger.focus();};
  trigger.onclick=()=>{
    if(closePopup){closePopup();return;}
    const popup=document.createElement('div'),controller=new AbortController();popup.className='cell-dropdown reference-group-dropdown';popup.setAttribute('aria-label','Group dropdown');
    popup.innerHTML=`<div class="dropdown-source-tabs"><div role="tablist" aria-label="Group sources"><button type="button" role="tab" aria-selected="true">Groups</button></div>${dropdownManualActionHtml}</div><div class="dropdown-panel"></div>`;
    const close=()=>{controller.abort();popup.remove();trigger.setAttribute('aria-expanded','false');closePopup=undefined;};closePopup=close;
    const position=()=>{
      if(!popup.isConnected)return;
      const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
      popup.style.width=Math.min(Math.max(280,rect.width),width-12)+'px';popup.style.maxHeight=Math.max(120,Math.min(360,height-12))+'px';
      const bounds=popup.getBoundingClientRect();popup.style.left=Math.max(left+6,Math.min(rect.left,left+width-bounds.width-6))+'px';popup.style.top=Math.max(top+6,Math.min(rect.bottom+3,top+height-bounds.height-6))+'px';
    };
    const choices=[{value:'',label:'Standalone'}];
    const collect=(nodes:ReferenceNavigation[])=>{for(const node of nodes)if(node.group){choices.push({value:node.group,label:node.group});collect(node.children);}};
    collect(referenceNavigation(host.book()));
    const panel=popup.querySelector<HTMLElement>('.dropdown-panel')!,{search,list}=mountDropdownOptions(panel,{choices,value:choice=>choice.label,selected:choice=>choice.value===input.value,name:'Group',searchLabel:'Search groups',position,
      choose:choice=>{input.value=choice.value;input.dispatchEvent(new Event('input',{bubbles:true}));display();close();trigger.focus({preventScroll:true});}});
    const custom=popup.querySelector<HTMLButtonElement>('.dropdown-manual-action')!;custom.setAttribute('aria-label','Custom');custom.querySelector('span')!.textContent='Custom';
    custom.onclick=()=>{close();manualStart=input.value;manualChanged=input.dataset.changed;manualEmpty=input.dataset.emptyLabel;trigger.hidden=true;input.hidden=false;input.focus();input.select();};
    const add=document.createElement('button'),creator=document.createElement('div'),newName=document.createElement('input'),create=document.createElement('button'),problem=document.createElement('div');
    add.type='button';add.className='reference-create-category';add.textContent='+ New category';add.setAttribute('aria-label','New category');
    creator.className='reference-category-create';creator.hidden=true;newName.setAttribute('aria-label','New category path');newName.placeholder='Category / Subcategory / Third level';create.type='button';create.textContent='Create category';problem.className='error';problem.setAttribute('role','alert');problem.hidden=true;creator.append(newName,create,problem);popup.append(add,creator);
    add.onclick=()=>{creator.hidden=false;add.hidden=true;newName.value=search.value||(input.value&&input.value.split(' / ').length<3?input.value+' / ':'');newName.focus({preventScroll:true});position();};
    create.onclick=()=>{try{const group=normalizeReferenceGroup(newName.value);if(!group)throw Error('Enter a category name.');if(choices.some(choice=>choice.value.toLowerCase()===group.toLowerCase()))throw Error('That category already exists. Choose it from the list.');input.value=group;input.dispatchEvent(new Event('input',{bubbles:true}));display();close();trigger.focus({preventScroll:true});}catch(e){problem.textContent=e instanceof Error?e.message:String(e);problem.hidden=false;position();}};
    newName.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();create.click();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();creator.hidden=true;add.hidden=false;search.focus({preventScroll:true});position();}};
    popup.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();trigger.focus({preventScroll:true});}else if(e.key==='Tab'&&!creator.contains(e.target as Node))close();else dropdownOptionsKey(e,search,list);e.stopPropagation();};
    d.append(popup);trigger.setAttribute('aria-expanded','true');position();
    document.addEventListener('pointerdown',e=>{if(!popup.contains(e.target as Node)&&!trigger.contains(e.target as Node))close();},{capture:true,signal:controller.signal});
    window.addEventListener('resize',position,{signal:controller.signal});window.visualViewport?.addEventListener('resize',position,{signal:controller.signal});
    d.addEventListener('scroll',position,{capture:true,signal:controller.signal});search.focus({preventScroll:true});
  };
  d.addEventListener('close',()=>closePopup?.());display();
}
export function newReference(host:ReferenceHost):void{
  host.dialog('New dropdown list or conversions',`<form><label>Name<input id="answer" required></label><label>Group (optional)<input id="reference-group" placeholder="Leave empty for a standalone dropdown" list="reference-groups"></label><datalist id="reference-groups">${[...new Set(host.book().references?.flatMap(s=>s.group?[s.group]:[])??[])].map(g=>`<option value="${host.esc(g)}">`).join('')}</datalist><label>Contents<select id="reference-kind"><option value="list">Editable dropdown options</option><option value="conversions">Unit conversions</option><option value="derived">Live options from another table</option></select></label><button class="primary">Create</button></form>`,d=>{
    mountGroupPicker(host,d);
    d.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();const name=d.querySelector<HTMLInputElement>('#answer')!.value,kind=d.querySelector<HTMLSelectElement>('#reference-kind')!.value as ReferenceSource['kind'];
      let id='';if(host.mutate('Create reference',()=>{const book=host.book(),source=createReference(book,uniqueName(book.references?.map(s=>s.name)??[],name),kind);setReferencePresentation(book,source,name,d.querySelector<HTMLInputElement>('#reference-group')!.value);id=source.id;})){d.close();host.open(id);if(kind==='derived')editConnection(host,host.book().references!.find(s=>s.id===id)!);}
    };
  });
}
export function referenceSettings(host:ReferenceHost,source:ReferenceSource,selection:ReferenceSource[]=[source]):void{
  const esc=host.esc,targets=[...new Map(selection.map(s=>[s.id,s])).values()],bulk=targets.length>1;
  const mixedGroups=targets.some(s=>s.group!==targets[0].group),initialGroup=mixedGroups?'':targets[0].group??'',mixedAvailable=targets.some(s=>!!s.archived!==!!targets[0].archived);
  const names=bulk?`<fieldset class="reference-selected-tabs"><legend>Selected tabs (${targets.length})</legend>${targets.map(s=>`<label><span>${esc(referenceCaption(s))}</span><input data-reference-label="${s.id}" aria-label="${esc(referenceCaption(s))} dropdown name" value="${esc(referenceLabel(s))}" required></label>`).join('')}</fieldset>`:`<label>Dropdown name<input id="reference-label" data-reference-label="${source.id}" value="${esc(referenceLabel(source))}" required></label>`;
  host.dialog('Dropdown settings',`<form id="reference-organization">${names}<label>${bulk?'Group (all selected tabs)':'Group (optional)'}<input id="reference-group" value="${esc(initialGroup)}" ${mixedGroups?'data-empty-label="Mixed groups"':''} placeholder="Category / Subcategory / Third level"></label><label class="reference-availability"><input id="reference-available" type="checkbox" role="${mixedAvailable?'checkbox':'switch'}" ${mixedAvailable?'aria-checked="mixed"':targets[0].archived?'':'checked'}>Show in DD picker</label><div id="reference-settings-error" class="error" role="alert" hidden></div></form><div class="reference-setting-actions"><button id="reference-bind">Apply to selected cells</button><button id="reference-duplicate" title="${bulk?'Duplicate all selected tabs':'Duplicate this tab'}">Duplicate</button><button id="reference-usage">Connections</button>${!bulk&&source.kind==='derived'?'<button id="reference-connect">Edit connection</button>':''}</div><p id="reference-notice" role="status" hidden></p><details><summary>Import supporting data</summary><button id="import-attached-references" ${host.book().importReport?'':'disabled'}>Import attached Excel sources</button><label>Local Excel file<input id="import-references" type="file" accept=".xlsx"></label></details>`,d=>{
    d.classList.add('reference-settings');
    mountGroupPicker(host,d);
    const names=[...d.querySelectorAll<HTMLInputElement>('[data-reference-label]')],group=d.querySelector<HTMLInputElement>('#reference-group')!,available=d.querySelector<HTMLInputElement>('#reference-available')!,message=d.querySelector<HTMLElement>('#reference-settings-error')!;
    let availabilityChanged=false;available.indeterminate=mixedAvailable;
    available.onchange=()=>{availabilityChanged=true;available.indeterminate=false;available.setAttribute('role','switch');available.removeAttribute('aria-checked');};
    const apply=()=>{
      const current=targets.map(target=>host.book().references?.find(s=>s.id===target.id));
      if(current.some(s=>!s)){message.textContent='A selected DD no longer exists.';message.hidden=false;return false;}
      const groupChanged=group.value!==initialGroup||group.dataset.changed==='true';
      if(current.every((s,i)=>names[i].value.trim()===referenceLabel(s!)&&(!groupChanged||(group.value.trim()||undefined)===s!.group)&&(!availabilityChanged&&mixedAvailable||available.checked===!s!.archived)))return true;
      let problem='';
      const ok=host.mutate('Update DD settings',()=>{
        const book=host.book(),ids=new Set(targets.map(s=>s.id)),draft={...book,references:book.references!.filter(s=>!ids.has(s.id))},updates=new Map<string,ReferenceSource>();
        try{for(let i=0;i<targets.length;i++){const found=book.references!.find(s=>s.id===targets[i].id);if(!found)throw Error('A selected DD no longer exists.');const next=clone(found);setReferencePresentation(draft,next,names[i].value,groupChanged?group.value:next.group);if(availabilityChanged||!mixedAvailable)next.archived=!available.checked;draft.references.push(next);updates.set(next.id,next);}}catch(e){problem=e instanceof Error?e.message:String(e);throw e;}
        book.references=book.references!.map(s=>updates.get(s.id)??s);
      });
      if(!ok){message.textContent=problem||'Changes could not be applied. See the workbook error.';message.hidden=false;names[0].focus();}return ok;
    };
    const close=()=>{if(apply())d.close();};
    d.querySelector<HTMLButtonElement>('.close')!.onclick=close;
    d.addEventListener('cancel',e=>{e.preventDefault();close();});
    d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
    d.querySelector<HTMLFormElement>('#reference-organization')!.onsubmit=e=>{e.preventDefault();close();};
    d.querySelector<HTMLButtonElement>('#reference-usage')!.onclick=()=>{const usages=targets.map(s=>referenceUsages(host.book(),host.book().references!.find(t=>t.id===s.id)!)),notice=d.querySelector<HTMLElement>('#reference-notice')!;notice.hidden=false;notice.textContent=`${usages.reduce((n,u)=>n+u.linked,0)} linked cells · ${usages.reduce((n,u)=>n+u.formulas,0)} formula/name usages · ${usages.reduce((n,u)=>n+u.dropdowns,0)} DD usages`;};
    d.querySelector<HTMLButtonElement>('#reference-bind')!.onclick=()=>{if(apply()){d.close();host.bind(host.book().references!.find(s=>s.id===source.id)!,targets.map(t=>host.book().references!.find(s=>s.id===t.id)!));}};
    d.querySelector<HTMLButtonElement>('#reference-duplicate')!.onclick=()=>{if(!apply())return;const copies:string[]=[];if(host.mutate('Duplicate DD tabs',()=>{for(const target of targets){const current=host.book().references!.find(s=>s.id===target.id);if(!current)throw Error('A selected DD no longer exists.');copies.push(duplicateReference(host.book(),current).id);}})){d.close();host.open(copies[0],copies);}};
    d.querySelector<HTMLButtonElement>('#reference-connect')?.addEventListener('click',()=>editConnection(host,source));
    d.querySelector<HTMLButtonElement>('#import-attached-references')!.onclick=()=>{void host.importSource();};
    d.querySelector<HTMLInputElement>('#import-references')!.onchange=e=>{const f=(e.target as HTMLInputElement).files?.[0];if(f)void host.importSource(f);};
  });
}
export function groupReference(host:ReferenceHost,source:ReferenceSource):void{
  const groups=[...new Set(host.book().references?.flatMap(s=>s.group?[s.group]:[])??[])];
  host.dialog('Group DD',`<div class="menu">${groups.map(group=>`<button data-dd-group="${host.esc(group)}">${host.esc(group)}</button>`).join('')}<button id="ungroup-dd">Standalone</button></div><form><label>New group<input id="new-dd-group" placeholder="Group name"></label></form>`,d=>{
    d.classList.add('dd-group-chooser');
    const choose=(group:string)=>{if(host.mutate('Group DD',()=>{const current=host.book().references?.find(s=>s.id===source.id);if(!current)throw Error('This DD no longer exists.');setReferencePresentation(host.book(),current,referenceLabel(current),group);}))d.close();};
    d.querySelectorAll<HTMLButtonElement>('[data-dd-group]').forEach(b=>b.onclick=()=>choose(b.dataset.ddGroup!));
    d.querySelector<HTMLButtonElement>('#ungroup-dd')!.onclick=()=>choose('');
    d.querySelector('form')!.onsubmit=e=>{e.preventDefault();const value=d.querySelector<HTMLInputElement>('#new-dd-group')!.value.trim();if(value)choose(value);};
  });
}
export function editConnection(host:ReferenceHost,source:ReferenceSource):void{
  const b=host.book(),esc=host.esc;
  host.dialog('Live dropdown connection',`<form id="derived-form"><label>Table<select id="derived-table" required><option value="">Choose original source</option>${b.tables.map(t=>`<option value="${t.id}" ${source.derived?.table===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>Options field<select id="derived-column" required></select></label><label>Filter field<select id="derived-filter"></select></label><label>Equals<input id="derived-equals" value="${esc(source.derived?.filter?.value??'TRUE')}"></label><button class="primary">Save connection</button></form>`,d=>{
    const table=d.querySelector<HTMLSelectElement>('#derived-table')!,field=d.querySelector<HTMLSelectElement>('#derived-column')!,filter=d.querySelector<HTMLSelectElement>('#derived-filter')!;
    const fields=()=>{const t=b.tables.find(t=>t.id===table.value);field.innerHTML=(t?.columns??[]).map(c=>`<option value="${c.id}" ${c.id===source.derived?.column?'selected':''}>${esc(c.name)}</option>`).join('');filter.innerHTML='<option value="">No filter</option>'+(t?.columns??[]).map(c=>`<option value="${c.id}" ${c.id===source.derived?.filter?.column?'selected':''}>${esc(c.name)}</option>`).join('');};table.onchange=fields;fields();
    d.querySelector('form')!.onsubmit=e=>{e.preventDefault();const raw=d.querySelector<HTMLInputElement>('#derived-equals')!.value,value=raw==='TRUE'?true:raw==='FALSE'?false:raw.trim()&&Number.isFinite(Number(raw))?Number(raw):raw;if(host.mutate('Connect derived list',()=>setDerivedSource(b,source,table.value,field.value,filter.value||undefined,value))){d.close();host.open(source.id);}};
  });
}
