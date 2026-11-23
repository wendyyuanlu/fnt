import {formulaCellContext,type TableEditPlan} from './table-edit-plan';
import type {Workbook} from './model';
import {Engine} from './formula';

type Dialog=(title:string,html:string,onMount?:(dialog:HTMLDialogElement)=>void)=>HTMLDialogElement;
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const skips=new Map<string,number>();
export function confirmTableExpansion(before:Workbook,plan:TableEditPlan,name:string,dialog:Dialog,commit:()=>boolean):void{
  const shift=plan.shift;
  if(!shift){commit();return;}
  const risk=shift.impacts.some(impact=>impact.reason==='broken'||impact.reason==='review'||impact.reason==='changed')?'review':shift.impacts.length?'updated':'none';
  const skipKey=`${before.id}:${shift.axis}:${risk}`,remaining=skips.get(skipKey)??0;
  if(remaining>0){if(commit())skips.set(skipKey,remaining-1);return;}
  const count=shift.count,axis=shift.axis==='row'?'row':'column',plural=axis+(count===1?'':'s');
  const d=dialog(`Make room for ${name}?`,`<form><p class="shift-description">Shift all contents ${axis==='row'?'below down':'to the right'} by <strong>${count} ${plural}</strong>?</p>${shift.impacts.length?`<section class="formula-impact"><strong>${shift.impacts.length} affected formula${shift.impacts.length===1?'':'s'}</strong><div class="formula-impact-list"></div></section>`:''}<div class="hypothetical-override-skip"><label class="inline"><input type="checkbox" id="skip-table-expansion">Don't show this for</label><input id="skip-table-expansion-count" type="number" aria-label="Number of times to skip" min="1" step="1" max="${Number.MAX_SAFE_INTEGER}" value="1" inputmode="numeric" disabled><span>times</span></div><div class="button-row"><button type="button" id="cancel-table-expansion">Cancel</button><button type="submit" class="${risk==='review'?'danger':'primary'}" id="confirm-table-expansion">${risk==='review'?'Shift anyway':`Shift ${count} ${plural}`}</button></div></form>`);
  d.classList.add('table-expansion-dialog');
  const list=d.querySelector<HTMLElement>('.formula-impact-list');
  const chunk=20,firstEngine=new Engine(before),secondEngine=new Engine(plan.book);let rendered=0;
  const more=()=>{
    if(!list)return;
    list.querySelector('.more-formula-impacts')?.remove();
    for(const impact of shift.impacts.slice(rendered,rendered+chunk)){
      const first=formulaCellContext(before,impact.sheet,impact.row,impact.column,firstEngine),second=formulaCellContext(plan.book,impact.sheet,impact.afterRow,impact.afterColumn,secondEngine),card=document.createElement('section');
      card.className='formula-context-card';
      const reason={broken:'Would break',changed:'Result changes',updated:'Moves or references update; result preserved',review:'Needs review: dynamic reference or calculation limit'}[impact.reason];
      card.innerHTML=`<div class="formula-context-heading"><strong>${escape(first.address)}${first.address!==second.address?` &rarr; ${escape(second.address)}`:''}</strong><span class="${impact.reason==='broken'?'bad':''}">${reason}</span></div><div class="formula-context-switch"><button type="button" data-preview="before" aria-pressed="true">Before</button><button type="button" data-preview="after" aria-pressed="false">After</button></div><div class="formula-context-grid"></div><code class="formula-context-expression"></code>`;
      const paint=(after:boolean)=>{
        const context=after?second:first;
        card.querySelector('.formula-context-grid')!.innerHTML=`<table aria-label="${escape(context.address)} and surrounding cells"><thead><tr><th></th>${context.columns.map(column=>`<th scope="col">${column}</th>`).join('')}</tr></thead><tbody>${context.rows.map(row=>`<tr><th scope="row">${row.number}</th>${row.cells.map(cell=>`<td class="${cell.focused?'context-focus':''} ${cell.focused&&after&&impact.reason==='broken'?'context-error':''}" title="${escape(cell.value)}">${escape(cell.value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        card.querySelector('.formula-context-expression')!.textContent=after?impact.after:impact.before;
        card.querySelectorAll<HTMLButtonElement>('[data-preview]').forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.preview==='after')===after)));
      };
      card.querySelectorAll<HTMLButtonElement>('[data-preview]').forEach(button=>button.onclick=()=>paint(button.dataset.preview==='after'));paint(false);list.append(card);
    }
    rendered=Math.min(shift.impacts.length,rendered+chunk);
    if(rendered<shift.impacts.length){const button=document.createElement('button');button.type='button';button.className='more-formula-impacts';button.textContent=`Show next ${Math.min(chunk,shift.impacts.length-rendered)} (${shift.impacts.length-rendered} remaining)`;button.onclick=more;list.append(button);}
  };
  more();
  const checkbox=d.querySelector<HTMLInputElement>('#skip-table-expansion')!,input=d.querySelector<HTMLInputElement>('#skip-table-expansion-count')!;
  checkbox.onchange=()=>{input.disabled=!checkbox.checked;input.setCustomValidity('');if(checkbox.checked){input.focus();input.select();}};
  input.oninput=()=>input.setCustomValidity('');
  d.querySelector<HTMLButtonElement>('#cancel-table-expansion')!.onclick=()=>d.close();
  d.querySelector('form')!.onsubmit=e=>{
    e.preventDefault();const count=Number(input.value);
    if(checkbox.checked&&(!Number.isSafeInteger(count)||count<1)){input.setCustomValidity('Enter a positive whole number of times.');input.reportValidity();return;}
    if(commit()){if(checkbox.checked)skips.set(skipKey,count);d.close();}
  };
}
