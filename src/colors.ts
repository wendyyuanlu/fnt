export function normalizeHex(value:string):string{
  if(!/^#[0-9a-f]{6}$/i.test(value))throw Error('Enter a six-digit hex color, such as #195747.');
  return value.toLowerCase();
}
export function hexToHsv(value:string):{h:number;s:number;v:number}{
  const hex=normalizeHex(value),[r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  let h=0;
  if(delta)h=60*(max===r?(g-b)/delta%6:max===g?(b-r)/delta+2:(r-g)/delta+4);
  return{h:(h+360)%360,s:max===0?0:delta/max,v:max};
}
export function hsvToHex(h:number,s:number,v:number):string{
  if(!Number.isFinite(h)||!Number.isFinite(s)||!Number.isFinite(v)||s<0||s>1||v<0||v>1)throw Error('Invalid hue, saturation or brightness.');
  h=((h%360)+360)%360;
  const channel=(n:number)=>{const k=(n+h/60)%6;return Math.round(255*(v-v*s*Math.max(0,Math.min(k,4-k,1)))).toString(16).padStart(2,'0');};
  return'#'+channel(5)+channel(3)+channel(1);
}
