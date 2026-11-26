export {};

const toggle=document.getElementById('mobile-mode') as HTMLButtonElement;
const frame=document.getElementById('comparison-frame') as HTMLIFrameElement;
const status=document.getElementById('viewport-size')!;
let filterDesign='tabs';
function applyDesign(){
  const child=frame.contentDocument;
  if(!child?.body)return;
  child.body.dataset.filterDesign=filterDesign;
  frame.contentWindow?.dispatchEvent(new Event('comparison-filter-design'));
}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-filter-design]')){
  button.onclick=()=>{
    filterDesign=button.dataset.filterDesign!;
    for(const peer of document.querySelectorAll<HTMLButtonElement>('[data-filter-design]'))peer.setAttribute('aria-pressed',String(peer===button));
    applyDesign();
  };
}
frame.addEventListener('load',applyDesign);
function updateSize(){
  status.textContent=`${toggle.getAttribute('aria-pressed')==='true'?'Phone preview':'Full width'} · ${frame.clientWidth} px`;
}
toggle.onclick=()=>{
  const mobile=toggle.getAttribute('aria-pressed')!=='true';
  toggle.setAttribute('aria-pressed',String(mobile));
  toggle.classList.toggle('primary',mobile);
  document.body.classList.toggle('mobile',mobile);
  updateSize();
};
new ResizeObserver(updateSize).observe(frame);
updateSize();
