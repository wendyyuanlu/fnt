import '../prototypes/comparison/style.css';
import template from '../prototypes/comparison/index.html?raw';

const source=new DOMParser().parseFromString(template,'text/html').body;
source.querySelectorAll('script').forEach(script=>script.remove());
for(const attribute of source.attributes)document.body.setAttribute(attribute.name,attribute.value);
document.body.dataset.production='true';
document.body.replaceChildren(...source.childNodes);
void import('../prototypes/comparison/main').then(()=>{
  navigator.serviceWorker?.controller?.postMessage({type:'fnt-shell-loaded',file:import.meta.url});
}).catch(error=>{
  const notice=document.querySelector<HTMLElement>('#error')!;
  notice.hidden=false;notice.textContent=`Comparison could not be opened. Your workbook is unchanged. ${String(error)}`;
  document.body.dataset.loading='false';
});
