import {clone,type HypotheticalStyle,type HypotheticalTreatment} from './model';
import {mountSelectDropdown} from './dropdown-ui';
import {hypotheticalBadgeCss,hypotheticalCss,hypotheticalPatterns,hypotheticalTextCss,validateHypotheticalStyle} from './hypothetical';
import {toolbarIcon} from './icons';

export function openHypotheticalSettings(host:{
  style:HypotheticalStyle;
  dialog:(title:string,html:string,mount:(dialog:HTMLDialogElement)=>void)=>HTMLDialogElement;
  save:(style:HypotheticalStyle)=>Promise<void>;
}):void{
  const draft=clone(host.style);let axis:'rows'|'columns'='rows';
  const numbers=[
    ['strokeWidth','Stroke / dot size (px)',.25,16,.25],['gap','Clear gap (px)',0,64,.5],
    ['angle','Angle (degrees)',0,360,1],['patternOpacity','Pattern opacity (%)',0,100,.01],
    ['textOpacity','Text opacity (%)',0,100,1],['fillOpacity','Fill opacity (%)',0,100,1],
    ['badgeDashSize','Dash size (px)',.5,12,.5],['badgeDashGap','Dash gap (px)',.5,12,.5]
  ] as const;
  host.dialog('Hypo styling',`<form id="hypothetical-form">
    <label class="inline"><input type="checkbox" id="hyp-linked">Use the same treatment for rows and columns</label>
    <div class="button-row treatment-axis"><button type="button" data-treatment-axis="rows">Rows</button><button type="button" data-treatment-axis="columns">Columns</button></div>
    <div id="hypothetical-preview" class="hypothetical-preview" aria-label="Treatment preview"></div>
    <div class="treatment-fields">
      <fieldset class="treatment-section"><legend>Pattern</legend>
        <label class="treatment-field">Pattern<select id="hyp-pattern">${Object.entries(hypotheticalPatterns).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>
        <label class="treatment-color">Pattern color<input type="color" id="hyp-patternColor"></label>
        ${numbers.slice(0,4).map(([name,label,min,max,step])=>`<div class="treatment-control"><label for="hyp-${name}">${label}</label><div><input id="hyp-${name}" type="number" min="${min}" max="${max}" step="${step}" required><input type="range" data-number="${name}" min="${min}" max="${max}" step="${step}" aria-label="${label} slider"></div></div>`).join('')}
      </fieldset>
      <fieldset class="treatment-section"><legend>Text</legend>
        <label class="inline"><input type="checkbox" id="hyp-keep-color">Keep cell text colors</label>
        <label class="treatment-color">Text color<input type="color" id="hyp-textColor"></label>
        ${numbers.slice(4,5).map(([name,label,min,max,step])=>`<div class="treatment-control"><label for="hyp-${name}">${label}</label><div><input id="hyp-${name}" type="number" min="${min}" max="${max}" step="${step}" required><input type="range" data-number="${name}" min="${min}" max="${max}" step="${step}" aria-label="${label} slider"></div></div>`).join('')}
        <div class="treatment-control"><label>Emphasis</label><div class="treatment-emphasis">${(['bold','italic','underline'] as const).map(name=>`<label class="inline"><input type="checkbox" id="hyp-${name}" title="Add ${name} without replacing existing cell formatting">${name[0].toUpperCase()+name.slice(1)}</label>`).join('')}</div></div>
      </fieldset>
      <fieldset class="treatment-section"><legend>Fill</legend>
        <label class="treatment-color">Fill color<input type="color" id="hyp-fillColor"></label>
        ${numbers.slice(5,6).map(([name,label,min,max,step])=>`<div class="treatment-control"><label for="hyp-${name}">${label}</label><div><input id="hyp-${name}" type="number" min="${min}" max="${max}" step="${step}" required><input type="range" data-number="${name}" min="${min}" max="${max}" step="${step}" aria-label="${label} slider"></div></div>`).join('')}
      </fieldset>
      <fieldset class="treatment-section"><legend>Badge</legend>
        <label class="inline"><input type="checkbox" id="hyp-badge">Show badge ${toolbarIcon('hypothetical-badge')}</label>
        <div class="treatment-badge-colors">${[['badgeColor','Ink'],['badgeBackground','Fill'],['badgeBorder','Border']].map(([name,label])=>`<label class="treatment-color">Badge ${label.toLowerCase()}<input type="color" id="hyp-${name}"></label>`).join('')}
          <label class="treatment-field">Border<select id="hyp-badgeBorderStyle"><option value="solid">Solid</option><option value="dashed">Dashed</option></select></label>
          ${numbers.slice(6).map(([name,label,min,max,step])=>`<div class="treatment-control"><label for="hyp-${name}">${label}</label><div><input id="hyp-${name}" type="number" min="${min}" max="${max}" step="${step}" required><input type="range" data-number="${name}" min="${min}" max="${max}" step="${step}" aria-label="${label} slider"></div></div>`).join('')}
        </div>
      </fieldset>
    </div>
    <label class="treatment-name">Display name<input id="hyp-label" required maxlength="40" placeholder="Hypo, Planned or Draft"></label>
    <p class="treatment-error error" role="alert" hidden></p>
    <div class="button-row treatment-footer"><button class="primary" type="submit">Save</button><button id="hyp-cancel" type="button">Cancel</button></div>
  </form>`,d=>{
    d.classList.add('hypothetical-dialog');
    const field=<T extends HTMLElement>(id:string)=>d.querySelector<T>('#'+id)!;
    const form=field<HTMLFormElement>('hypothetical-form'),message=d.querySelector<HTMLElement>('.treatment-error')!;
    const pattern=field<HTMLSelectElement>('hyp-pattern'),dropdown=mountSelectDropdown(pattern);
    const border=field<HTMLSelectElement>('hyp-badgeBorderStyle'),borderDropdown=mountSelectDropdown(border);
    const current=()=>draft[axis];
    function preview():void{
      if(draft.linked)draft[axis==='rows'?'columns':'rows']=clone(current());
      d.querySelector<HTMLElement>('.treatment-axis')!.hidden=draft.linked;
      const t=current(),badge=t.badge?`<span class="hypothetical-badge" role="img">${toolbarIcon('hypothetical-badge')}</span>`:'';
      d.querySelector<HTMLElement>('.treatment-badge-colors')!.hidden=!t.badge;
      for(const [name]of numbers.slice(6)){
        const disabled=!t.badge||t.badgeBorderStyle!=='dashed';
        field<HTMLInputElement>('hyp-'+name).disabled=disabled;
        d.querySelector<HTMLInputElement>(`[data-number="${name}"]`)!.disabled=disabled;
      }
      const classes=`hypothetical-cell${t.fillOpacity>0?' has-hyp-fill':''}${t.textColor?' custom-hyp-text':''}`;
      field<HTMLDivElement>('hypothetical-preview').innerHTML=`<table><tbody><tr><td><span class="cell-value">Ordinary example</span></td><td><span class="cell-value">120</span></td></tr>${['','selected'].map(state=>`<tr><td class="${classes} ${state}" style="${hypotheticalCss(t)}">${badge}<span class="cell-value" style="${hypotheticalTextCss(t)}"></span></td><td class="${classes} ${state}" style="${hypotheticalCss(t)}"><span class="cell-value" style="${hypotheticalTextCss(t)}">120</span></td></tr>`).join('')}</tbody></table>`;
      const cells=d.querySelectorAll<HTMLElement>('.hypothetical-preview td:first-child .cell-value');
      cells.forEach((cell,index)=>{if(index)cell.textContent=(draft.label.trim()||'Hypo')+' example';});
      d.querySelectorAll<HTMLElement>('.hypothetical-preview .hypothetical-badge').forEach(badge=>{badge.setAttribute('aria-label',draft.label);badge.style.cssText=hypotheticalBadgeCss(t);});
    }
    function refresh():void{
      const t=current();
      field<HTMLInputElement>('hyp-label').value=draft.label;
      field<HTMLInputElement>('hyp-linked').checked=draft.linked;
      d.querySelectorAll<HTMLButtonElement>('[data-treatment-axis]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.treatmentAxis===axis)));
      pattern.value=t.pattern;dropdown.refresh();
      border.value=t.badgeBorderStyle??'solid';borderDropdown.refresh();
      for(const [name]of numbers){
        const number=t[name]??(name==='badgeDashSize'?3:2),value=name.endsWith('Opacity')?+(number*100).toFixed(2):number;
        field<HTMLInputElement>('hyp-'+name).value=String(value);
        d.querySelector<HTMLInputElement>(`[data-number="${name}"]`)!.value=String(value);
      }
      for(const name of ['patternColor','fillColor','badgeColor','badgeBackground','badgeBorder'] as const)field<HTMLInputElement>('hyp-'+name).value=t[name];
      field<HTMLInputElement>('hyp-textColor').value=t.textColor??'#233c34';
      field<HTMLInputElement>('hyp-textColor').disabled=t.textColor===undefined;
      field<HTMLInputElement>('hyp-keep-color').checked=t.textColor===undefined;
      for(const name of ['bold','italic','underline','badge'] as const)field<HTMLInputElement>('hyp-'+name).checked=t[name];
      preview();
    }
    pattern.onchange=()=>{current().pattern=pattern.value as HypotheticalTreatment['pattern'];preview();};
    border.onchange=()=>{current().badgeBorderStyle=border.value==='dashed'?'dashed':'solid';preview();};
    for(const [name]of numbers){
      const input=field<HTMLInputElement>('hyp-'+name),range=d.querySelector<HTMLInputElement>(`[data-number="${name}"]`)!;
      input.oninput=()=>{
        if(!input.checkValidity()||input.value==='')return;
        current()[name]=input.valueAsNumber/(name.endsWith('Opacity')?100:1);range.value=input.value;preview();
      };
      range.oninput=()=>{input.value=range.value;input.dispatchEvent(new Event('input'));};
    }
    for(const name of ['patternColor','fillColor','badgeColor','badgeBackground','badgeBorder'] as const)field<HTMLInputElement>('hyp-'+name).oninput=()=>{current()[name]=field<HTMLInputElement>('hyp-'+name).value;preview();};
    for(const name of ['bold','italic','underline','badge'] as const)field<HTMLInputElement>('hyp-'+name).onchange=()=>{current()[name]=field<HTMLInputElement>('hyp-'+name).checked;preview();};
    field<HTMLInputElement>('hyp-label').oninput=()=>{draft.label=field<HTMLInputElement>('hyp-label').value;preview();};
    field<HTMLInputElement>('hyp-textColor').oninput=()=>{current().textColor=field<HTMLInputElement>('hyp-textColor').value;preview();};
    field<HTMLInputElement>('hyp-keep-color').onchange=()=>{
      if(field<HTMLInputElement>('hyp-keep-color').checked)delete current().textColor;
      else current().textColor=field<HTMLInputElement>('hyp-textColor').value;
      field<HTMLInputElement>('hyp-textColor').disabled=current().textColor===undefined;preview();
    };
    field<HTMLInputElement>('hyp-linked').onchange=()=>{draft.linked=field<HTMLInputElement>('hyp-linked').checked;preview();};
    d.querySelectorAll<HTMLButtonElement>('[data-treatment-axis]').forEach(button=>button.onclick=()=>{
      if(!form.reportValidity())return;
      axis=button.dataset.treatmentAxis==='columns'?'columns':'rows';refresh();
    });
    field<HTMLButtonElement>('hyp-cancel').onclick=()=>d.close();
    form.onsubmit=async e=>{
      e.preventDefault();if(!form.reportValidity())return;
      message.hidden=true;
      try{
        draft.label=draft.label.trim();validateHypotheticalStyle(draft);
        const controls=[...d.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select')],disabled=controls.map(control=>control.disabled);
        controls.forEach(control=>control.disabled=true);
        try{await host.save(clone(draft));d.close();}
        finally{controls.forEach((control,index)=>control.disabled=disabled[index]);}
      }catch(error){message.textContent=error instanceof Error?error.message:String(error);message.hidden=false;message.scrollIntoView({block:'nearest'});}
    };
    refresh();
  });
}
