import {dropdownArrowHtml,dropdownOptionsKey,dropdownSectionHeader,mountDropdownPanel,mountDropdownPopup} from './dropdown-ui';
import {excelDateText} from './dates';
import {ingredientKey,restaurantName,type DraftFood,type FoodPhoto,type IngredientIdentity} from './food-capture';
import {toolbarIcon} from './icons';
import type {Workbook} from './model';
import './photo-ui.css';

export type PhotoTarget={kind:'draft';id:string}|{kind:'ingredient';identity:IngredientIdentity};
export interface PhotoScope {book:string;date:number;target?:PhotoTarget}
export interface PhotoUIHost{
  book:()=>Workbook;date:()=>number;
  add:(files:File[],scope:PhotoScope)=>Promise<void>;
  attach:(ids:string[],scope:PhotoScope,move:boolean)=>Promise<void>;
  remove:(ids:string[])=>void;
  preview:(photo:FoodPhoto)=>Promise<Blob>;
  original:(photo:FoodPhoto)=>Promise<Blob>;
  privateGallery?:()=>void;
  privateStatus?:()=>string;
  dialog:(title:string,html:string,mount:(dialog:HTMLDialogElement)=>void)=>HTMLDialogElement;
  error:(error:unknown)=>void;
}
const icon=(name:keyof typeof import('./icons').toolbarIconPaths,label:string)=>`<button type="button" class="icon-button" aria-label="${label}" title="${label}">${toolbarIcon(name)}</button>`;
export function createPhotoUI(host:PhotoUIHost){
  let previewVersion=0;
  const metadata=(id:string)=>host.book().foodCapture?.photos.find(photo=>photo.id===id);
  const report=(action:Promise<unknown>)=>{void action.catch(host.error);};
  const capture=(scope:PhotoScope,camera:boolean)=>{
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,image/gif';
    if(camera)input.setAttribute('capture','environment');else input.multiple=true;
    input.onchange=()=>{const files=Array.from(input.files??[]);if(files.length)report(host.add(files,scope));};
    input.click();
  };
  const view=(photo:FoodPhoto)=>{
    host.dialog(photo.name,'<p class="muted" data-photo-status>Loading original…</p><div class="photo-original"></div><div class="button-row" data-photo-actions></div>',dialog=>{
      let url:string|undefined,closed=false;
      const status=dialog.querySelector<HTMLElement>('[data-photo-status]')!,target=dialog.querySelector<HTMLElement>('.photo-original')!,actions=dialog.querySelector<HTMLElement>('[data-photo-actions]')!;
      dialog.addEventListener('close',()=>{closed=true;if(url)URL.revokeObjectURL(url);},{once:true});
      void(async()=>{
        const blob=await host.original(photo);if(closed)return;
        url=URL.createObjectURL(blob);
        const image=new Image();image.alt=photo.name;image.src=url;target.append(image);await image.decode();if(closed)return;
        const open=document.createElement('a');open.href=url;open.target='_blank';open.rel='noopener';open.textContent='Open original';
        const save=document.createElement('a');save.href=url;save.download=photo.name;save.textContent='Save to device';
        save.onclick=()=>{status.textContent='Device download requested. Your browser controls saving; this cannot guarantee a copy in the Photos app.';};
        const fullscreen=document.createElement('button');fullscreen.type='button';fullscreen.textContent='Full screen';fullscreen.disabled=!image.requestFullscreen;
        fullscreen.onclick=()=>report(image.requestFullscreen());
        actions.append(open,save,fullscreen);
        if(navigator.canShare?.({files:[new File([blob],photo.name,{type:blob.type})]})){
          const share=document.createElement('button');share.type='button';share.textContent='Share / save';
          share.onclick=()=>{void navigator.share({files:[new File([blob],photo.name,{type:blob.type})]}).then(()=>{status.textContent='Device share completed.';}).catch(error=>{
            if(error instanceof DOMException&&error.name==='AbortError')status.textContent='Device share cancelled.';else host.error(error);
          });};actions.append(share);
        }
        status.textContent='Original photo. Use your device’s native pinch and drag gestures, or Open original for its browser image viewer.';
      })().catch(error=>{if(!closed){status.textContent=error instanceof Error?error.message:String(error);host.error(error);}});
    });
  };
  const organize=(trigger:HTMLButtonElement,ids:()=>string[],scope:()=>PhotoScope)=>{
    return mountDropdownPopup(trigger,'Organize photos',(panel,position,close)=>{
      const captured=scope(),{search,list}=mountDropdownPanel(panel,'Photo destinations','Search photo destinations');
      const draw=()=>{
        const groups=new Map<string,DraftFood[]>(),query=search.value.trim().toLocaleLowerCase();list.replaceChildren();
        const general=document.createElement('button');general.type='button';general.setAttribute('role','option');general.textContent='General (not attached to food)';
        general.onclick=()=>report(host.attach(ids(),{...captured,target:undefined},true).then(close));list.append(general);
        const matches=(host.book().foodCapture?.foods??[]).filter(food=>food.date===captured.date&&(!query||[food.values.food,restaurantName(host.book(),food)].some(value=>value?.toLocaleLowerCase().includes(query))));
        for(const food of matches.slice(0,40)){
          const name=restaurantName(host.book(),food)||'General',foods=groups.get(name)??[];foods.push(food);groups.set(name,foods);
        }
        for(const [name,foods]of groups){
          const details=document.createElement('details'),rows=document.createElement('div');details.className='dropdown-section';details.open=true;details.append(dropdownSectionHeader(name),rows);
          rows.setAttribute('role','group');rows.setAttribute('aria-label',name);
          for(const food of foods){
            const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.textContent=food.values.food?.trim()||'(Unnamed food)';
            button.onclick=()=>report(host.attach(ids(),{...captured,target:{kind:'draft',id:food.id}},true).then(close));rows.append(button);
          }list.append(details);
        }
        if(matches.length>40){const note=document.createElement('p');note.className='muted';note.textContent='First 40 destinations shown. Search to narrow the list.';list.append(note);}
        position();
      };
      search.oninput=draw;panel.onkeydown=event=>dropdownOptionsKey(event,search,list);draw();search.focus({preventScroll:true});
    },336);
  };
  const strip=(scope:()=>PhotoScope,ids:()=>string[],controls=true,limit=4,selectionState?:{selected:Set<string>;available:()=>string[]})=>{
    const element=document.createElement('section');element.className='photo-strip';element.setAttribute('aria-label','Food photos');
    const actions=document.createElement('div'),selection=document.createElement('div'),list=document.createElement('div'),more=document.createElement('button');
    actions.className='button-row';selection.className='button-row';list.className='photo-thumbnails';more.type='button';more.textContent='More photos';
    actions.innerHTML=icon('camera','Take photo')+icon('upload','Upload photo')+icon('photos','FNT photos');
    selection.innerHTML=`<button type="button" class="dropdown-field" aria-label="Organize selected photos">Organize selected photos <span class="format-caret">${dropdownArrowHtml}</span></button>`+icon('trash','Remove selected photos');
    const selected=selectionState?.selected??new Set<string>(),urls:string[]=[];let shape='',generation=0,disposed=false;
    const popup=organize(selection.querySelector('button')!,()=>[...selected],scope);
    actions.children[0].addEventListener('click',()=>capture(scope(),true));actions.children[1].addEventListener('click',()=>capture(scope(),false));actions.children[2].addEventListener('click',()=>choose(scope()));
    selection.children[1].addEventListener('click',()=>host.remove([...selected]));
    more.onclick=()=>choose(scope());
    if(controls)element.append(actions);element.append(selection,list,more);
    const refresh=()=>{
      const all=[...new Set(ids())],photos=all.slice(0,limit).map(metadata),next=JSON.stringify([previewVersion,photos.map((photo,index)=>[all[index],photo?.digest,photo?.name])]);
      const available=new Set(selectionState?.available()??all);
      for(const id of selected)if(!available.has(id))selected.delete(id);selection.hidden=!selected.size;more.hidden=all.length<=limit;
      if(next===shape)return;
      shape=next;generation++;const current=generation;
      for(const url of urls)URL.revokeObjectURL(url);urls.length=0;list.replaceChildren();
      for(const [index,photo]of photos.entries()){
        const id=all[index],figure=document.createElement('figure'),button=document.createElement('button'),label=document.createElement('label'),check=document.createElement('input');
        button.type='button';button.textContent=photo?'Loading preview…':'Photo metadata unavailable';button.setAttribute('aria-label',photo?'Open photo '+photo.name:'Photo metadata unavailable');button.disabled=!photo;
        label.className='inline';check.type='checkbox';check.checked=selected.has(id);check.setAttribute('aria-label','Select photo '+(photo?.name??id));label.append(check,' Select');
        check.onchange=()=>{if(check.checked)selected.add(id);else selected.delete(id);selection.hidden=!selected.size;};
        figure.append(button,label);list.append(figure);
        if(!photo)continue;
        button.onclick=()=>view(photo);
        void host.preview(photo).then(blob=>{
          if(disposed||current!==generation)return;
          const url=URL.createObjectURL(blob);urls.push(url);const image=new Image();image.alt=photo.name;image.src=url;button.replaceChildren(image);
        }).catch(error=>{
          if(disposed||current!==generation)return;
          const message=error instanceof Error?error.message:String(error);
          button.textContent=message.includes('not stored')?'Original unavailable on this device':'Preview unavailable - open original';button.title=message;
        });
      }
    };
    return{element,refresh,dispose:()=>{disposed=true;generation++;popup.close();for(const url of urls)URL.revokeObjectURL(url);}};
  };
  const choose=(scope:PhotoScope)=>{
    host.dialog('FNT photos','<p class="muted">Choose an existing photo. It remains in the gallery and can be linked to more than one food.</p><div data-photo-picker></div><div class="button-row"><button type="button" data-photo-previous>Previous</button><span data-photo-count></span><button type="button" data-photo-next>Next</button></div>',dialog=>{
      const target=dialog.querySelector<HTMLElement>('[data-photo-picker]')!,selected=new Set<string>();let page=0,previous:ReturnType<typeof strip>|undefined;
      const draw=()=>{
        const photos=host.book().foodCapture?.photos??[];page=Math.min(page,Math.max(0,Math.ceil(photos.length/12)-1));previous?.dispose();
        previous=strip(()=>scope,()=>photos.slice(page*12,(page+1)*12).map(photo=>photo.id),false,12,{selected,available:()=>host.book().foodCapture?.photos.map(photo=>photo.id)??[]});target.replaceChildren(previous.element);previous.refresh();
        const apply=document.createElement('button');apply.type='button';apply.textContent='Attach selected photos';if(scope.target)target.append(apply);
        apply.onclick=()=>{
          const ids=[...selected];
          if(!ids.length){host.error(Error('Select at least one photo.'));return;}
          report(host.attach(ids,scope,false).then(()=>dialog.close()));
        };
        dialog.querySelector('[data-photo-count]')!.textContent=photos.length?`${page*12+1}–${Math.min(photos.length,(page+1)*12)} of ${photos.length}`:'No photos yet';
        dialog.querySelector<HTMLButtonElement>('[data-photo-previous]')!.disabled=page===0;
        dialog.querySelector<HTMLButtonElement>('[data-photo-next]')!.disabled=(page+1)*12>=photos.length;
      };
      dialog.querySelector<HTMLButtonElement>('[data-photo-previous]')!.onclick=()=>{page--;draw();};
      dialog.querySelector<HTMLButtonElement>('[data-photo-next]')!.onclick=()=>{page++;draw();};
      dialog.addEventListener('close',()=>previous?.dispose(),{once:true});draw();
    });
  };
  const gallery=()=>{
    const element=document.createElement('section');element.className='capture-pane';element.setAttribute('aria-label','FNT photo gallery');
    element.innerHTML='<header class="capture-toolbar"><h2>FNT photos</h2></header><p class="muted">Originals are saved separately on this device. Workbook sync carries photo references, not image bytes. Private gallery transfer is not connected.</p><div class="capture-foods"></div><div class="button-row"><button type="button" data-previous>Previous</button><span data-count></span><button type="button" data-next>Next</button></div>';
    element.querySelector<HTMLElement>(':scope > .button-row')!.className='capture-footer';
    if(host.privateGallery){
      const button=document.createElement('button');button.type='button';button.className='icon-button';button.setAttribute('aria-label','Private photo gallery');button.title='Private photo gallery';button.innerHTML=toolbarIcon('settings');button.onclick=host.privateGallery;element.querySelector('header')!.append(button);
    }
    let page=0;const photoStrip=strip(()=>({book:host.book().id,date:host.date()}),()=>(host.book().foodCapture?.photos??[]).slice(page*20,(page+1)*20).map(photo=>photo.id),true,20,{selected:new Set<string>(),available:()=>host.book().foodCapture?.photos.map(photo=>photo.id)??[]});
    photoStrip.element.querySelector<HTMLButtonElement>('[aria-label="FNT photos"]')!.hidden=true;
    element.querySelector('.capture-foods')!.append(photoStrip.element);
    const refresh=()=>{
      const count=host.book().foodCapture?.photos.length??0;page=Math.min(page,Math.max(0,Math.ceil(count/20)-1));photoStrip.refresh();
      element.querySelector<HTMLElement>('p.muted')!.textContent='Originals are saved separately on this device. Workbook sync carries photo references, not image bytes. '+(host.privateStatus?.()??'Private gallery transfer is not connected.');
      element.querySelector('[data-count]')!.textContent=count?`${page*20+1}–${Math.min(count,(page+1)*20)} of ${count} · ${excelDateText(host.date())}`:'No photos yet';
      element.querySelector<HTMLButtonElement>('[data-previous]')!.disabled=page===0;element.querySelector<HTMLButtonElement>('[data-next]')!.disabled=(page+1)*20>=count;
    };
    element.querySelector<HTMLButtonElement>('[data-previous]')!.onclick=()=>{page--;refresh();};element.querySelector<HTMLButtonElement>('[data-next]')!.onclick=()=>{page++;refresh();};
    return{element,refresh,dispose:photoStrip.dispose};
  };
  const targetIds=(target:PhotoTarget):string[]=>{
    const data=host.book().foodCapture;
    return target.kind==='draft'?data?.foods.find(food=>food.id===target.id)?.photos??[]:data?.ingredientDetails[ingredientKey(target.identity)]?.photos??[];
  };
  return{strip,gallery,capture,choose,targetIds,invalidate:()=>{previewVersion++;}};
}
