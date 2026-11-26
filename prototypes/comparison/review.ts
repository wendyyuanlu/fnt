export {};

const toggle=document.getElementById('mobile-mode') as HTMLButtonElement;
const frame=document.getElementById('comparison-frame') as HTMLIFrameElement;
const status=document.getElementById('viewport-size')!;
let controlStyle='after',dropdownStyle='dd';
function applyStyles(){
  const child=frame.contentDocument;
  if(!child?.body)return;
  child.body.dataset.controlStyle=controlStyle;
  child.body.dataset.dropdownStyle=dropdownStyle;
  frame.contentWindow?.dispatchEvent(new Event('resize'));
}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-control-style],[data-dropdown-style]')){
  button.onclick=()=>{
    const attribute=button.hasAttribute('data-control-style')?'data-control-style':'data-dropdown-style';
    const value=button.getAttribute(attribute)!;
    if(attribute==='data-control-style')controlStyle=value;
    else dropdownStyle=value;
    for(const peer of document.querySelectorAll<HTMLButtonElement>(`[${attribute}]`))peer.setAttribute('aria-pressed',String(peer===button));
    applyStyles();
  };
}
frame.addEventListener('load',applyStyles);
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
