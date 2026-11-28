import {githubFormDefaults} from './github-client';
import type {SyncConfig} from './storage';

interface PrivateWorkbookPreview{
  config:SyncConfig;sha:string;book:{title:string};
}
export type PrivateWorkbookAction='replace-local'|'replace-remote'|'migrate-canonical';
interface PrivateWorkbookHost<T extends PrivateWorkbookPreview>{
  dialog:(title:string,html:string,mount:(dialog:HTMLDialogElement)=>void)=>HTMLDialogElement;
  mode?:PrivateWorkbookAction;
  config?:SyncConfig;
  fixedPath?:string;
  canonical?:{path:string;inspect:(config:SyncConfig,token:string)=>Promise<T|undefined>};
  localTitle?:string;
  ensureReady:()=>Promise<void>;
  inspect:(config:SyncConfig,token:string)=>Promise<T>;
  initialize:(source:T,token:string,action?:PrivateWorkbookAction,legacy?:T)=>Promise<void>;
  opened:()=>void;
}

export function openPrivateWorkbook<T extends PrivateWorkbookPreview>(host:PrivateWorkbookHost<T>):HTMLDialogElement{
  const migrating=host.mode==='migrate-canonical',replacing=host.mode!==undefined,uploading=host.mode==='replace-remote'||migrating;
  if(migrating&&!host.canonical)throw Error('Canonical migration requires an explicit canonical reader.');
  const title=migrating?'Use fnt-data.json on this device':uploading?'Replace GitHub with this copy':replacing?'Use latest GitHub copy':'Open existing private workbook';
  const confirmLabel=migrating?'Create fnt-data.json from this browser':uploading?'Replace GitHub with this copy':replacing?'Use this GitHub copy':'Open locally';
  const detail=migrating?'Workbook sync now uses fnt-data.json on every device. Read the saved legacy file and fnt-data.json before choosing. Neither filename is assumed to contain the newest data. These are whole-workbook choices, not an automatic merge. Recovery preserves the displaced copies, the legacy file is not deleted, and automatic sync stays paused.':uploading?'Read and review the current GitHub revision before replacing it with this browser\'s saved workbook. The inspected GitHub copy is preserved in local recovery. Other devices are not changed by this browser action; they may need to refresh or resolve a conflict. Automatic sync stays paused.':replacing?'Only this browser will change. Its prior local edits and saved reviews remain recoverable. GitHub is not overwritten, and automatic sync stays paused. Read and review the latest GitHub copy, then confirm separately.':'Read an existing workbook from your private data repository. Reading does not save it here or upload anything. Review the source, then separately choose Open locally.';
  const tokenNote=replacing?'The token is held only in this dialog for the explicit read and confirmation requests. It is not remembered or used to connect automatic sync.':'The token is used only for this read and is not remembered. Opening locally keeps sync paused. Connecting and syncing later is a separate action. Existing local workbooks are never replaced.';
  return host.dialog(title,`<p>${detail}</p><form data-private-open-form><label>Personal repository owner<input name="owner" required autocomplete="off"></label><label>Private data repository<input name="repo" required autocomplete="off"></label><label>Existing branch<input name="branch" required autocomplete="off"></label><label>JSON path<input name="path" required autocomplete="off"></label><label>Fine-grained token: Contents ${uploading?'read/write':'read'}, only this data repository<input name="token" type="password" required autocomplete="off"></label><p class="muted">${tokenNote}</p><div class="button-row"><button type="submit" data-inspect>${replacing?'Read latest GitHub copy':'Read private workbook'}</button><button type="button" class="primary" data-open-locally disabled>${confirmLabel}</button><button type="button" data-cancel>Cancel</button></div><p class="capture-original" data-private-preview hidden></p><p data-private-status role="status"></p><p data-private-error role="alert"></p></form>`,dialog=>{
    const form=dialog.querySelector<HTMLFormElement>('[data-private-open-form]')!;
    if(replacing&&host.localTitle!==undefined){
      const local=document.createElement('p');local.className='capture-original';local.dataset.localCopy='';
      local.textContent=`This browser's current workbook: ${host.localTitle}.`;form.before(local);
    }
    form.querySelector('.muted')!.insertAdjacentHTML('afterend',uploading?'<p class="muted">The displaced GitHub workbook and original workbook attachments are kept in local recovery. Photo originals are not downloaded with that archive; missing originals are listed for recovery. Keep an independent full backup.</p>':'<p class="muted">Workbook metadata and original workbook attachments are included. Photo originals are not downloaded here; you may need to retrieve them separately from your private gallery, another device or a complete backup.</p>');
    const fields=[...form.querySelectorAll('input')],inspect=form.querySelector<HTMLButtonElement>('[data-inspect]')!,confirm=form.querySelector<HTMLButtonElement>('[data-open-locally]')!,cancel=form.querySelector<HTMLButtonElement>('[data-cancel]')!;
    const previewText=form.querySelector<HTMLElement>('[data-private-preview]')!,status=form.querySelector<HTMLElement>('[data-private-status]')!,error=form.querySelector<HTMLElement>('[data-private-error]')!;
    const close=dialog.querySelector<HTMLButtonElement>('.close')!;
    const input=(name:string)=>form.elements.namedItem(name) as HTMLInputElement;
    for(const [name,value]of Object.entries(host.config??githubFormDefaults()))input(name).value=value;
    if(host.fixedPath!==undefined){input('path').value=host.fixedPath;input('path').readOnly=true;}
    const canonicalText=document.createElement('p');canonicalText.className='capture-original';canonicalText.dataset.canonicalPreview='';canonicalText.hidden=true;
    previewText.after(canonicalText);
    const migrationButtons:HTMLButtonElement[]=[];
    let apply:(action?:PrivateWorkbookAction,useLegacy?:boolean)=>Promise<void>;
    if(migrating){
      for(const field of fields)if(field.name!=='token')field.readOnly=true;
      inspect.textContent='Read both GitHub files';
      for(const [label,action,useLegacy]of [
        ['Use fnt-data.json in this browser','replace-local',false],
        ['Replace fnt-data.json with this browser','replace-remote',false],
        ['Use legacy GitHub copy locally first','replace-local',true],
      ] as const){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.hidden=true;button.disabled=true;
        button.onclick=()=>void apply(action,useLegacy);confirm.before(button);migrationButtons.push(button);
      }
    }
    let preview:T|undefined,canonical:T|undefined,previewToken='',revision=0,reading=false,opening=false;
    const invalidate=()=>{
      revision++;preview=canonical=undefined;previewToken='';previewText.textContent='';previewText.hidden=true;canonicalText.hidden=true;confirm.hidden=false;confirm.disabled=true;error.textContent='';
      for(const button of migrationButtons){button.hidden=true;button.disabled=true;}
      status.textContent=reading?'Source changed. Read the workbook again when the current request finishes.':'';
    };
    const report=(reason:unknown)=>{error.textContent=reason instanceof Error?reason.message:String(reason);};
    const showPreview=(source:T)=>{
      preview=source;
      previewText.textContent=`Workbook: ${source.book.title}. Source: ${source.config.owner}/${source.config.repo}, branch ${source.config.branch}, path ${source.config.path}. Revision: ${source.sha}.`;
      previewText.hidden=false;confirm.disabled=false;
      if(migrating){
        canonicalText.textContent=canonical?`fnt-data.json already exists: ${canonical.book.title}. Revision: ${canonical.sha}. It may differ from both this browser and the legacy file. Choose explicitly; neither file will be silently overwritten.`:'fnt-data.json does not exist. Creating it copies this browser\'s saved workbook, not an assumed newer remote file. The legacy file remains available.';
        canonicalText.hidden=false;confirm.hidden=!!canonical;confirm.disabled=!!canonical;
        migrationButtons.forEach((button,index)=>{button.hidden=index<2&&!canonical;button.disabled=button.hidden;});
      }
    };
    const unlock=()=>{opening=false;for(const field of fields)field.disabled=false;inspect.disabled=cancel.disabled=close.disabled=false;for(const button of migrationButtons)button.disabled=button.hidden||!preview;};
    form.addEventListener('input',invalidate);
    dialog.addEventListener('cancel',event=>{if(opening)event.preventDefault();});
    dialog.addEventListener('close',()=>{revision++;preview=canonical=undefined;previewToken='';input('token').value='';});
    cancel.onclick=()=>dialog.close();
    form.onsubmit=async event=>{
      event.preventDefault();
      if(reading||opening||!form.reportValidity())return;
      invalidate();reading=true;inspect.disabled=true;status.textContent='Verifying and reading the private workbook...';
      const request=revision,config={owner:input('owner').value.trim(),repo:input('repo').value.trim(),branch:input('branch').value.trim(),path:input('path').value.trim()};
      const token=input('token').value.trim();
      input('token').value='';
      try{
        await host.ensureReady();
        if(!dialog.open||request!==revision)return;
        const source=await host.inspect(config,token);
        if(!dialog.open||request!==revision)return;
        if(migrating){
          const currentCanonical=await host.canonical!.inspect(source.config,token);
          if(!dialog.open||request!==revision)return;
          if(currentCanonical&&currentCanonical.config.path!==host.canonical!.path)throw Error('Canonical preview returned an unexpected file path.');
          canonical=currentCanonical;
        }
        await host.ensureReady();
        if(!dialog.open||request!==revision)return;
        showPreview(source);previewToken=replacing?token:'';
        status.textContent=migrating?'Both files checked. Nothing changed. Review the browser, legacy and canonical copies before choosing.':replacing?`Read complete. Neither copy has been replaced. Review the source, then choose ${confirmLabel}.`:'Read complete. Nothing saved locally or uploaded. Choose Open locally to save this verified copy with sync paused.';
      }catch(reason){
        if(dialog.open&&request===revision){preview=canonical=undefined;confirm.disabled=true;status.textContent='Nothing opened locally.';report(reason);}
      }finally{
        reading=false;if(dialog.open)inspect.disabled=false;
      }
    };
    apply=async(action=host.mode,useLegacy=false)=>{
      let source=preview;
      if(!source||opening||reading)return;
      opening=true;for(const field of fields)field.disabled=true;inspect.disabled=confirm.disabled=cancel.disabled=close.disabled=true;
      for(const button of migrationButtons)button.disabled=true;
      error.textContent='';status.textContent='Opening the verified copy locally with sync paused...';
      try{
        await host.ensureReady();
        if(!dialog.open||preview!==source){unlock();return;}
        let verified:T|undefined=source;
        if(migrating){
          const request=revision,sourceConfig={...source.config},sourceSha=source.sha,canonicalSha=canonical?.sha;
          // Keep only small identities while refreshing the pair, not both old workbooks too.
          preview=canonical=source=verified=undefined;
          const legacy=await host.inspect(sourceConfig,previewToken);
          if(!dialog.open||request!==revision){unlock();return;}
          const currentCanonical=await host.canonical!.inspect(sourceConfig,previewToken);
          if(!dialog.open||request!==revision){unlock();return;}
          if(currentCanonical&&currentCanonical.config.path!==host.canonical!.path)throw Error('Canonical preview returned an unexpected file path.');
          await host.ensureReady();
          if(!dialog.open||request!==revision){unlock();return;}
          const changed=legacy.sha!==sourceSha||currentCanonical?.sha!==canonicalSha;
          canonical=currentCanonical;
          if(changed){
            showPreview(legacy);unlock();status.textContent='GitHub files changed since the preview. Nothing replaced. Review the refreshed copies and confirm again.';return;
          }
          verified=useLegacy?legacy:action==='migrate-canonical'?legacy:canonical!;
          if(!verified)throw Error('The canonical file is missing. Read both files again before choosing.');
          status.textContent=action==='replace-local'?'Preserving recovery before using the selected copy locally...':'Preserving recovery before changing fnt-data.json...';
          await host.initialize(verified,previewToken,action,legacy);
        }else if(replacing){
          status.textContent='Rechecking the latest GitHub revision before replacement...';
          verified=await host.inspect(source.config,previewToken);
          await host.ensureReady();
          if(!dialog.open||preview!==source){unlock();return;}
          const verifiedConfig=verified.config,sourceConfig=source.config;
          if(verified.sha!==source.sha||(['owner','repo','branch','path'] as const).some(key=>verifiedConfig[key]!==sourceConfig[key])){
            showPreview(verified);unlock();
            status.textContent='GitHub changed since the preview. Neither copy was replaced. Review the refreshed source and confirm again.';
            return;
          }
        }
        if(!migrating){
          if(!verified)throw Error('The inspected copy is no longer available. Read the source again.');
          status.textContent=uploading?'Preserving recovery and replacing the inspected GitHub copy...':replacing?'Preserving local recovery and using the verified GitHub copy...':'Opening the verified copy locally with sync paused...';
          await host.initialize(verified,previewToken,action);
        }
      }catch(reason){
        preview=canonical=undefined;previewToken='';previewText.hidden=true;canonicalText.hidden=true;status.textContent=uploading?'Replacement needs attention. Check GitHub before retrying.':replacing?'Replacement failed. Your previous local copy remains in place or in recovery.':'Open failed. Existing local data was not replaced.';report(reason);
        unlock();return;
      }
      opening=false;dialog.close();host.opened();
    };
    confirm.onclick=()=>void apply();
  });
}
