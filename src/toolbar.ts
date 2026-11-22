type ToolbarHost={order?:readonly string[];dividers?:readonly string[];editing:boolean;change:(order:string[],dividers:string[])=>boolean};

export function mountToolbar(toolbar:HTMLElement,host:ToolbarHost):()=>void{
  const groups=[...toolbar.querySelectorAll<HTMLElement>('.tool-set:not(.toolbar-layout-controls)')];
  const tools=groups.flatMap(group=>[...group.querySelectorAll<HTMLButtonElement|HTMLSelectElement>(':scope > button,:scope > select')]);
  const identities=new Map(tools.map(tool=>{
    const id=tool.dataset.action?`action:${tool.dataset.action}`:`control:${tool.id}`;
    tool.dataset.toolbarTool=id;return [id,tool] as const;
  }));
  const order=[...host.order??[]].filter(id=>identities.has(id));
  order.push(...[...identities.keys()].filter(id=>!order.includes(id)));
  const dividers=[...host.dividers??groups.slice(0,-1).flatMap(group=>{
    const last=group.lastElementChild;return last instanceof HTMLElement&&last.dataset.toolbarTool?[last.dataset.toolbarTool]:[];
  })];
  const layout=document.createElement('div');layout.className='toolbar-tools';groups[0].before(layout);
  for(const id of order){
    const tool=identities.get(id)!;layout.append(tool);
    if(tool.hidden)continue;
    const divided=dividers.includes(id);if(!divided&&!host.editing)continue;
    const boundary=document.createElement(host.editing?'button':'span');
    boundary.className=divided?'toolbar-divider':'toolbar-gap';
    if(host.editing){
      const name=tool.getAttribute('aria-label')??tool.textContent?.trim()??id;
      boundary.setAttribute('type','button');boundary.setAttribute('aria-label',`${divided?'Remove':'Add'} divider after ${name}`);
      boundary.title=divided?'Click to remove divider':'Click to add divider';
      boundary.dataset[divided?'toolbarDivider':'toolbarGap']=id;
      boundary.onclick=event=>{
        event.stopPropagation();
        if(host.change([...host.order??order],divided?dividers.filter(key=>key!==id):[...dividers,id])){
          document.querySelector<HTMLElement>(`[data-${divided?'toolbar-gap':'toolbar-divider'}="${id}"]`)?.focus();
        }
      };
      boundary.onkeydown=event=>{if(event.key==='Enter'||event.key===' ')event.stopPropagation();};
    }else{boundary.setAttribute('role','separator');boundary.setAttribute('aria-orientation','vertical');boundary.dataset.toolbarDivider=id;}
    layout.append(boundary);
  }
  groups.forEach(group=>group.remove());
  toolbar.classList.toggle('arranging-toolbar',host.editing);
  if(!host.editing)return()=>{};
  for(const tool of tools){tool.draggable=false;tool.disabled=false;tool.title='Drag to arrange; Alt+Left/Right to move';}
  const controller=new AbortController(),options={signal:controller.signal};
  const visible=()=>order.filter(id=>!identities.get(id)!.hidden);
  const identify=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('[data-toolbar-tool]')?.dataset.toolbarTool:undefined;
  let moving:string|undefined,drop:{id:string;after:boolean}|undefined,pointer:number|undefined,startX=0,startY=0,started=false,frame=0,point:{x:number;y:number}|undefined;
  const clear=()=>{
    cancelAnimationFrame(frame);frame=0;point=undefined;drop=undefined;moving=undefined;started=false;
    if(pointer!==undefined&&toolbar.hasPointerCapture(pointer))toolbar.releasePointerCapture(pointer);pointer=undefined;
    tools.forEach(tool=>tool.classList.remove('toolbar-dragging','toolbar-drop-before','toolbar-drop-after'));
  };
  const commit=(id:string,target:string,after:boolean)=>{
    const next=order.filter(key=>key!==id),at=next.indexOf(target);if(at<0)return;
    next.splice(at+Number(after),0,id);if(next.every((key,index)=>key===order[index]))return;
    // Keep temporarily absent DD/workbook tools in the saved order.
    let index=0;const saved=(host.order??[]).map(key=>identities.has(key)?next[index++]:key);
    saved.push(...next.slice(index));
    if(host.change(saved,dividers))document.querySelector<HTMLElement>(`[data-toolbar-tool="${id}"]`)?.focus();
  };
  const paint=()=>{
    tools.forEach(tool=>tool.classList.remove('toolbar-drop-before','toolbar-drop-after'));drop=undefined;
    if(!point||!moving)return;
    const bounds=toolbar.getBoundingClientRect();if(point.y<bounds.top-24||point.y>bounds.bottom+24)return;
    let distance=Infinity;
    for(const id of visible()){
      if(id===moving)continue;const rect=identities.get(id)!.getBoundingClientRect();
      if(rect.right<bounds.left||rect.left>bounds.right)continue;
      const delta=Math.abs(point.x-(rect.left+rect.width/2));
      if(delta<distance){distance=delta;drop={id,after:point.x>rect.left+rect.width/2};}
    }
    if(drop)identities.get(drop.id)!.classList.add(drop.after?'toolbar-drop-after':'toolbar-drop-before');
  };
  const scroll=()=>{
    frame=0;if(!point||!moving||!started)return;
    const bounds=toolbar.getBoundingClientRect(),delta=point.x<bounds.left+24?-8:point.x>bounds.right-24?8:0;
    if(point.y<bounds.top-24||point.y>bounds.bottom+24)return;
    if(delta){toolbar.scrollLeft+=delta;paint();frame=requestAnimationFrame(scroll);}
  };
  const track=(x:number,y:number)=>{point={x,y};paint();if(!frame)frame=requestAnimationFrame(scroll);};
  toolbar.addEventListener('click',event=>{if(identify(event.target)){event.preventDefault();event.stopImmediatePropagation();}}, {...options,capture:true});
  toolbar.addEventListener('keydown',event=>{
    const id=identify(event.target);if(!id)return;
    if(event.key==='Escape'){clear();event.preventDefault();event.stopPropagation();return;}
    if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
      event.preventDefault();event.stopPropagation();const ids=visible(),direction=event.key==='ArrowLeft'?-1:1,target=ids[ids.indexOf(id)+direction];
      if(target)commit(id,target,direction>0);
    }
    if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();}
  },options);
  toolbar.addEventListener('pointerdown',event=>{
    const id=identify(event.target);if(!id||event.button!==0)return;
    event.preventDefault();clear();moving=id;pointer=event.pointerId;startX=event.clientX;startY=event.clientY;toolbar.setPointerCapture(pointer);
  },options);
  toolbar.addEventListener('pointermove',event=>{
    if(event.pointerId!==pointer||!moving)return;
    if(!started&&Math.hypot(event.clientX-startX,event.clientY-startY)<4)return;
    started=true;identities.get(moving)!.classList.add('toolbar-dragging');track(event.clientX,event.clientY);
  },options);
  toolbar.addEventListener('pointerup',event=>{
    if(event.pointerId!==pointer)return;
    const id=moving,target=drop,apply=started;clear();if(apply&&id&&target)commit(id,target.id,target.after);
  },options);
  toolbar.addEventListener('pointercancel',clear,options);
  return()=>{clear();controller.abort();};
}
