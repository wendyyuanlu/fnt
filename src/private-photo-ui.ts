import {excelDateText} from './dates';
import type {FoodPhoto} from './food-capture';
import type {PhotoBlob} from './food-photos';
import {downloadPrivatePhoto,listPrivatePhotos,PhotoGalleryConflict,uploadPrivatePhoto,type PrivatePhoto} from './github-photos';
import type {Workbook} from './model';
import type {SyncConfig} from './storage';

export interface DownloadedPhoto {metadata:PrivatePhoto;file:PhotoBlob;expected?:FoodPhoto}
export interface PrivatePhotoHost{
  book:()=>Workbook;defaults:()=>SyncConfig|undefined;
  original:(photo:FoodPhoto)=>Promise<Blob>;
  accept:(photos:DownloadedPhoto[],book:string)=>Promise<void>;
  dialog:(title:string,html:string,mount:(dialog:HTMLDialogElement)=>void)=>HTMLDialogElement;
  changed:()=>void;error:(error:unknown)=>void;
}
const same=(left:FoodPhoto,right:FoodPhoto)=>left.id===right.id&&left.digest===right.digest&&left.mime===right.mime&&left.bytes===right.bytes&&left.name===right.name&&left.date===right.date;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function createPrivatePhotoUI(host:PrivatePhotoHost){
  let connection:{config:SyncConfig;token:string;automatic:boolean}|undefined,remote:PrivatePhoto[]=[],working=false;
  let status='Private gallery disconnected. Originals stay on this device until you explicitly upload them.';
  let automaticPaused=false,transferFinished=Promise.resolve(),automaticTail:Promise<string>=Promise.resolve('');
  let conflict:{local:FoodPhoto;remote:PrivatePhoto;book:string}|undefined,redraw:(()=>void)|undefined;
  const changed=()=>{redraw?.();host.changed();};
  const run=async(label:string,action:()=>Promise<void>):Promise<boolean>=>{
    if(working){host.error(Error('Wait for the current private photo transfer to finish.'));return false;}
    let finished!:()=>void;transferFinished=new Promise<void>(resolve=>{finished=resolve;});
    working=true;status=label;changed();
    try{await action();return true;}
    catch(error){
      automaticPaused=true;status=`Transfer stopped: ${error instanceof Error?error.message:String(error)} Local originals and food links are retained. Automatic uploads are paused. Earlier confirmed transfers are not rolled back; refresh before retrying.`;
      host.error(error);return false;
    }finally{working=false;changed();finished();}
  };
  const requireConnection=()=>{if(!connection)throw Error('Connect and verify a private photo gallery first.');return connection;};
  const currentPhoto=(id:string)=>host.book().foodCapture?.photos.find(photo=>photo.id===id);
  const checkLocal=(book:string,photo:FoodPhoto)=>{
    const current=currentPhoto(photo.id);
    if(host.book().id!==book||!current||!same(current,photo))throw Error('The local photo or workbook changed during transfer. Refresh and review it before retrying.');
  };
  const uploadOne=async(photo:FoodPhoto,book:string,replacement?:Pick<FoodPhoto,'name'|'date'>)=>{
    const target=requireConnection();checkLocal(book,photo);
    const blob=await host.original(photo);checkLocal(book,photo);
    try{remote=(await uploadPrivatePhoto(target.config,target.token,photo,blob,fetch,replacement)).photos;}
    catch(error){
      if(error instanceof PhotoGalleryConflict){conflict={local:structuredClone(photo),remote:error.remote,book};remote=[...remote.filter(entry=>entry.id!==error.remote.id),error.remote];}
      throw error;
    }
    checkLocal(book,photo);
  };
  const upload=async(ids?:readonly string[])=>{
    const book=host.book().id,photos=(host.book().foodCapture?.photos??[]).filter(photo=>!ids||ids.includes(photo.id)).map(photo=>structuredClone(photo));
    if(ids&&new Set(ids).size!==photos.length)throw Error('A selected local photo no longer exists. Reopen the gallery.');
    requireConnection();conflict=undefined;
    for(const [index,photo]of photos.entries()){
      await uploadOne(photo,book);status=`Confirmed ${index+1} of ${photos.length} private photo originals.`;changed();
    }
    status=photos.length?`Confirmed ${photos.length} private photo originals. Local copies and links are unchanged.`:'No local photos to upload.';
  };
  const reviewConflict=()=>{
    const review=conflict;if(!review)return;
    host.dialog('Private photo metadata conflict',`<p>The original bytes have the same identity. Choose explicitly whether to replace the private gallery’s name and date. No food link is changed.</p><div class="capture-notice"><h2>Local metadata</h2><p class="capture-original">${esc(review.local.name)} · ${esc(excelDateText(review.local.date))}</p><h2>Private gallery metadata</h2><p class="capture-original">${esc(review.remote.name)} · ${esc(excelDateText(review.remote.date))}</p></div><div class="button-row"><button type="button" data-keep>Keep private metadata; do not upload</button><button type="button" data-replace>Upload this local name and date</button></div>`,dialog=>{
      dialog.querySelector<HTMLButtonElement>('[data-keep]')!.onclick=()=>{conflict=undefined;status='Private metadata kept. The local name and date are unchanged; future uploads still require conflict review.';dialog.close();changed();};
      dialog.querySelector<HTMLButtonElement>('[data-replace]')!.onclick=()=>{
        const button=dialog.querySelector<HTMLButtonElement>('[data-replace]')!;button.disabled=true;
        void run('Verifying the reviewed photo metadata…',async()=>{
          await uploadOne(review.local,review.book,review.remote);conflict=undefined;status='Private photo metadata updated after explicit review.';dialog.close();
        }).then(ok=>{button.disabled=false;if(!ok&&conflict&&conflict!==review)reviewConflict();});
      };
    });
  };
  const open=()=>{
    const defaults=connection?.config??{owner:host.defaults()?.owner??'wendyyuanlu',repo:host.defaults()?.repo??'fnt-data',branch:host.defaults()?.branch??'main',path:'photos/index.json'};
    host.dialog('Private photo gallery',`<p>Optional transfer of photo originals to a separate private data repository with GitHub Pages disabled. Connecting verifies access and reads the gallery; it does not upload existing photos or change workbook sync.</p><form data-gallery-connect><label>Personal repository owner<input name="owner" value="${esc(defaults.owner)}" required autocomplete="off"></label><label>Private data repository<input name="repo" value="${esc(defaults.repo)}" required autocomplete="off"></label><label>Existing branch<input name="branch" value="${esc(defaults.branch)}" required autocomplete="off"></label><label>Separate gallery JSON path<input name="path" value="${esc(defaults.path)}" required autocomplete="off"></label><label>Fine-grained token: Contents read/write for only this data repository<input name="token" type="password" required autocomplete="off"></label><label class="inline"><input name="automatic" type="checkbox" ${connection?.automatic?'checked':''}>Automatically upload newly captured photos while connected</label><p class="muted">The token and connection stay only in this tab’s memory. Reloading disconnects and never loses local originals. After reconnecting, use Upload local originals to retry; confirmed content is verified, not duplicated. No repository is created. The gallery index must not be your workbook JSON file.</p><button type="submit">Connect and verify gallery</button></form><p class="muted" role="status" data-gallery-status></p><div class="button-row"><button type="button" data-gallery-refresh>Refresh private gallery</button><button type="button" data-gallery-upload>Upload local originals</button><button type="button" data-gallery-disconnect>Disconnect gallery</button><button type="button" data-gallery-conflict hidden>Review metadata conflict</button></div><section data-gallery-browser><label>Search private photos<input type="search" data-gallery-search></label><div class="capture-foods" data-gallery-list></div><div class="button-row"><button type="button" data-gallery-previous>Previous</button><span data-gallery-count></span><button type="button" data-gallery-next>Next</button></div><button type="button" data-gallery-download>Download selected originals</button><p class="muted">Select at most eight originals per download. New gallery entries are added with their private name/date. Existing local names, dates and food links are kept; identity or checksum conflicts stop the download. Closing the gallery does not cancel an in-flight transfer.</p></section>`,dialog=>{
      let page=0;const selected=new Set<string>(),form=dialog.querySelector<HTMLFormElement>('form')!,search=dialog.querySelector<HTMLInputElement>('[data-gallery-search]')!,list=dialog.querySelector<HTMLElement>('[data-gallery-list]')!;
      const read=(name:string)=>form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value.trim();
      const draw=()=>{
        if(!dialog.open)return;
        dialog.querySelector('[data-gallery-status]')!.textContent=status;
        for(const input of form.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button'))input.disabled=working;
        for(const name of ['refresh','upload','disconnect','download'])dialog.querySelector<HTMLButtonElement>(`[data-gallery-${name}]`)!.disabled=working||!connection;
        dialog.querySelector<HTMLButtonElement>('[data-gallery-conflict]')!.hidden=!conflict;
        dialog.querySelector<HTMLButtonElement>('[data-gallery-conflict]')!.disabled=working;
        dialog.querySelector<HTMLElement>('[data-gallery-browser]')!.hidden=!connection;
        const matches=remote.filter(photo=>photo.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
        page=Math.min(page,Math.max(0,Math.ceil(matches.length/12)-1));list.replaceChildren();
        for(const photo of matches.slice(page*12,(page+1)*12)){
          const label=document.createElement('label'),check=document.createElement('input');label.className='inline';check.type='checkbox';check.checked=selected.has(photo.id);check.disabled=working;
          check.setAttribute('aria-label','Download private photo '+photo.name);check.onchange=()=>{if(check.checked)selected.add(photo.id);else selected.delete(photo.id);};
          const caption=document.createElement('span');caption.className='capture-original';caption.textContent=`${photo.name} · ${excelDateText(photo.date)}${currentPhoto(photo.id)?' · local reference exists':''}`;
          label.append(check,caption);list.append(label);
        }
        dialog.querySelector('[data-gallery-count]')!.textContent=matches.length?`${page*12+1}–${Math.min(matches.length,(page+1)*12)} of ${matches.length}`:'No private photos found';
        dialog.querySelector<HTMLButtonElement>('[data-gallery-previous]')!.disabled=working||page===0;
        dialog.querySelector<HTMLButtonElement>('[data-gallery-next]')!.disabled=working||(page+1)*12>=matches.length;
      };
      redraw=draw;dialog.addEventListener('close',()=>{if(redraw===draw)redraw=undefined;form.querySelector<HTMLInputElement>('[name="token"]')!.value='';},{once:true});
      form.onsubmit=event=>{
        event.preventDefault();
        const config:SyncConfig={owner:read('owner'),repo:read('repo'),branch:read('branch'),path:read('path')},token=read('token'),automatic=form.querySelector<HTMLInputElement>('[name="automatic"]')!.checked;
        void run('Verifying private gallery access without uploading…',async()=>{
          connection=undefined;remote=[];selected.clear();conflict=undefined;changed();
          const workbook=host.defaults();
          if(workbook&&config.owner.toLowerCase()===workbook.owner.toLowerCase()&&config.repo.toLowerCase()===workbook.repo.toLowerCase()&&config.branch===workbook.branch&&config.path===workbook.path)throw Error('Use a separate gallery JSON path, not the workbook sync file.');
          const gallery=await listPrivatePhotos(config,token);
          if(!dialog.open){status='Connection cancelled when the dialog closed. No upload was started.';return;}
          connection={config,token,automatic};automaticPaused=false;remote=gallery.photos;selected.clear();conflict=undefined;form.querySelector<HTMLInputElement>('[name="token"]')!.value='';
          status=`Private gallery connected for this tab. ${remote.length} entries; automatic new-photo upload ${automatic?'enabled':'off'}. Existing local photos have not been uploaded.`;
        });
      };
      dialog.querySelector<HTMLButtonElement>('[data-gallery-refresh]')!.onclick=()=>{void run('Reading private gallery…',async()=>{
        const target=requireConnection();remote=(await listPrivatePhotos(target.config,target.token)).photos;
        const ids=new Set(remote.map(photo=>photo.id));for(const id of selected)if(!ids.has(id))selected.delete(id);status=`Private gallery refreshed: ${remote.length} photos.`;
      });};
      dialog.querySelector<HTMLButtonElement>('[data-gallery-upload]')!.onclick=()=>{void run('Uploading and verifying local originals sequentially…',async()=>{await upload();automaticPaused=false;});};
      dialog.querySelector<HTMLButtonElement>('[data-gallery-disconnect]')!.onclick=()=>{
        if(working)return;connection=undefined;remote=[];selected.clear();conflict=undefined;status='Private gallery disconnected. The token was forgotten; local and private originals are unchanged.';changed();
      };
      dialog.querySelector<HTMLButtonElement>('[data-gallery-conflict]')!.onclick=reviewConflict;
      dialog.querySelector<HTMLButtonElement>('[data-gallery-download]')!.onclick=()=>{
        const ids=[...selected],book=host.book().id;
        if(!ids.length||ids.length>8){host.error(Error('Select between one and eight private photo originals.'));return;}
        const photos=ids.map(id=>remote.find(photo=>photo.id===id)),expected=ids.map(id=>{const photo=currentPhoto(id);return photo?structuredClone(photo):undefined;});
        void run('Downloading and verifying selected originals…',async()=>{
          const target=requireConnection(),downloads:DownloadedPhoto[]=[];
          for(const [index,photo]of photos.entries()){
            if(!photo)throw Error('A selected private photo disappeared. Refresh the gallery.');
            downloads.push({metadata:photo,file:await downloadPrivatePhoto(target.config,target.token,photo),expected:expected[index]});
          }
          await host.accept(downloads,book);selected.clear();status=`Saved ${downloads.length} selected originals on this device. Existing local names, dates and links were kept.`;
        });
      };
      search.oninput=()=>{page=0;draw();};
      dialog.querySelector<HTMLButtonElement>('[data-gallery-previous]')!.onclick=()=>{page--;draw();};
      dialog.querySelector<HTMLButtonElement>('[data-gallery-next]')!.onclick=()=>{page++;draw();};
      draw();
    });
  };
  return{
    open,status:()=>status,
    uploadAdded:async(ids:readonly string[])=>{
      if(!connection?.automatic)return connection?'Saved locally. Automatic private-photo upload is off.':'Saved locally. Private photo gallery is disconnected.';
      const target=connection,book=host.book().id,wait=transferFinished,selected=[...ids];
      automaticTail=automaticTail.then(async()=>{
        await wait;
        if(connection!==target||host.book().id!==book)return'Saved locally. The private gallery or workbook changed; upload these local originals explicitly after reconnecting.';
        if(automaticPaused)return'Saved locally. Automatic private-photo uploads are paused after a transfer error. Review the gallery and retry Upload local originals.';
        await run('Uploading newly captured photo originals…',()=>upload(selected));return status;
      });
      return automaticTail;
    }
  };
}
