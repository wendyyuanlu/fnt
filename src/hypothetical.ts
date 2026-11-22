import type {HypotheticalStyle,HypotheticalTreatment,Workbook} from './model';

export const hypotheticalPatterns={none:'No pattern',lines:'Lines',dots:'Dots',crosshatch:'Crosshatch',grid:'Grid',checkerboard:'Checkerboard'} as const;
export function defaultHypotheticalTreatment():HypotheticalTreatment{
  return {pattern:'lines',patternColor:'#777777',patternOpacity:18/255,strokeWidth:2,gap:6,angle:135,
    textOpacity:.8,fillColor:'#fff7e6',fillOpacity:0,bold:false,italic:false,underline:false,badge:false,
    badgeColor:'#785a30',badgeBackground:'#fff7e6',badgeBorder:'#98764e',badgeBorderStyle:'solid',badgeDashSize:3,badgeDashGap:2};
}
export function getHypotheticalStyle(book:Pick<Workbook,'hypotheticalStyle'>):HypotheticalStyle{
  const style=book.hypotheticalStyle??{label:'Hypo',linked:true,rows:defaultHypotheticalTreatment(),columns:defaultHypotheticalTreatment()};
  return style.label==='Hypothetical'?{...style,label:'Hypo'}:style;
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validateHypotheticalStyle(value:unknown):asserts value is HypotheticalStyle{
  if(!record(value)||typeof value.label!=='string'||!value.label.trim()||value.label.length>40||
    value.badgeText!==undefined&&(typeof value.badgeText!=='string'||!value.badgeText.trim()||value.badgeText.length>12)||typeof value.linked!=='boolean')throw Error('Invalid hypothetical treatment settings.');
  for(const treatment of [value.rows,value.columns]){
    if(!record(treatment)||typeof treatment.pattern!=='string'||!Object.hasOwn(hypotheticalPatterns,treatment.pattern))throw Error('Invalid hypothetical pattern.');
    for(const field of ['patternColor','fillColor','badgeColor','badgeBackground','badgeBorder','textColor']){
      if(field==='textColor'&&treatment[field]===undefined)continue;
      if(typeof treatment[field]!=='string'||!/^#[0-9a-f]{6}$/i.test(treatment[field]))throw Error('Invalid hypothetical treatment color.');
    }
    for(const [field,min,max]of [['strokeWidth',.25,16],['gap',0,64],['angle',0,360],['patternOpacity',0,1],['textOpacity',0,1],['fillOpacity',0,1]] as const){
      const number=treatment[field];if(typeof number!=='number'||!Number.isFinite(number)||number<min||number>max)throw Error(`Invalid hypothetical ${field}.`);
    }
    for(const field of ['bold','italic','underline','badge'])if(typeof treatment[field]!=='boolean')throw Error('Invalid hypothetical text or badge setting.');
    if(treatment.badgeBorderStyle!==undefined&&treatment.badgeBorderStyle!=='solid'&&treatment.badgeBorderStyle!=='dashed')throw Error('Invalid hypothetical badge border style.');
    for(const field of ['badgeDashSize','badgeDashGap']){
      const number=treatment[field];if(number!==undefined&&(typeof number!=='number'||!Number.isFinite(number)||number<.5||number>12))throw Error('Invalid hypothetical badge dash size or gap.');
    }
  }
  if(value.linked&&JSON.stringify(value.rows)!==JSON.stringify(value.columns))throw Error('Linked row and column treatments must match.');
}
function rgba(color:string,opacity:number):string{
  return `rgba(${[1,3,5].map(at=>parseInt(color.slice(at,at+2),16)).join(',')},${opacity})`;
}
export function hypotheticalCss(t:HypotheticalTreatment):string{
  const color=rgba(t.patternColor,t.patternOpacity),period=t.strokeWidth+t.gap;
  const lines=(angle:number)=>`repeating-linear-gradient(${angle}deg,${color} 0px,${color} ${t.strokeWidth}px,transparent ${t.strokeWidth}px,transparent ${period}px)`;
  let pattern:string='none',size='auto';
  switch(t.pattern){
    case 'lines':pattern=lines(t.angle);break;
    case 'crosshatch':pattern=`${lines(t.angle)},${lines((t.angle+90)%360)}`;size='auto,auto';break;
    case 'grid':pattern=`${lines(0)},${lines(90)}`;size='auto,auto';break;
    case 'dots':pattern=`radial-gradient(circle,${color} ${t.strokeWidth/2}px,transparent ${t.strokeWidth/2+.15}px)`;size=`${period}px ${period}px`;break;
    case 'checkerboard':pattern=`repeating-conic-gradient(from ${t.angle}deg,${color} 0% 25%,transparent 25% 50%)`;size=`${period*2}px ${period*2}px`;break;
  }
  const fill=rgba(t.fillColor,t.fillOpacity);
  return `--hyp-pattern:${pattern};--hyp-pattern-size:${size};--hyp-fill:linear-gradient(${fill},${fill});`;
}
export function hypotheticalTextCss(t:HypotheticalTreatment):string{
  return `opacity:${t.textOpacity};${t.textColor?`color:${t.textColor};`:''}${t.bold?'font-weight:700;':''}${t.italic?'font-style:italic;':''}${t.underline?'text-decoration:underline;':''}`;
}
export function hypotheticalBadgeCss(t:HypotheticalTreatment):string{
  const dashed=t.badgeBorderStyle==='dashed',dash=t.badgeDashSize??3,period=dash+(t.badgeDashGap??2);
  const border=(angle:number)=>dashed?`repeating-linear-gradient(${angle}deg,${t.badgeBorder} 0px,${t.badgeBorder} ${dash}px,transparent ${dash}px,transparent ${period}px)`:'none';
  return `color:${t.badgeColor};background-color:${t.badgeBackground};border-color:${dashed?'transparent':t.badgeBorder};--hyp-badge-horizontal:${border(90)};--hyp-badge-vertical:${border(180)};`;
}
