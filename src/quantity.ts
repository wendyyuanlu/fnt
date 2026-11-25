export type FractionResult=
  |{kind:'fraction';value:number;text:string}
  |{kind:'invalid';error:'#VALUE!'|'#DIV/0!'|'#NUM!';message:string}
  |{kind:'text'};
const glyphs:Record<string,[number,number]>={'¼':[1,4],'½':[1,2],'¾':[3,4],'⅐':[1,7],'⅑':[1,9],'⅒':[1,10],'⅓':[1,3],'⅔':[2,3],'⅕':[1,5],'⅖':[2,5],'⅗':[3,5],'⅘':[4,5],'⅙':[1,6],'⅚':[5,6],'⅛':[1,8],'⅜':[3,8],'⅝':[5,8],'⅞':[7,8]};
function fractionText(numerator:number,denominator:number):string{
  const sign=numerator<0?'-':'';numerator=Math.abs(numerator);
  let a=numerator,b=denominator;while(b){const next=a%b;a=b;b=next;}
  numerator/=a||1;denominator/=a||1;
  const whole=Math.floor(numerator/denominator),remainder=numerator%denominator;
  return sign+(remainder?`${whole?whole+' ':''}${remainder}/${denominator}`:String(whole));
}
export function parseFraction(input:string):FractionResult{
  const text=input.trim().replace(/\u2212/g,'-');
  const ordinary=/^([+-])?\s*(?:(\d+)\s+)?(\d+)\s*[\/⁄]\s*(\d+)$/.exec(text);
  const vulgar=/^([+-])?\s*(?:(\d+)\s*)?([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/.exec(text);
  if(!ordinary&&!vulgar){
    return /^[+\-\d\s./⁄¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]+$/.test(text)&&/[\/⁄¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(text)
      ?{kind:'invalid',error:'#VALUE!',message:'Enter a whole fraction such as 1/2 or 1 1/2, with a positive whole-number denominator.'}:{kind:'text'};
  }
  const sign=(ordinary??vulgar)![1]==='-'?-1:1,whole=Number((ordinary??vulgar)![2]??0);
  const [part,denominator]=ordinary?[Number(ordinary[3]),Number(ordinary[4])]:glyphs[vulgar![3]];
  if(denominator===0)return{kind:'invalid',error:'#DIV/0!',message:'A fraction cannot divide by zero.'};
  const numerator=sign*(whole*denominator+part);
  if(![whole,part,denominator,numerator].every(Number.isSafeInteger))return{kind:'invalid',error:'#NUM!',message:'The fraction is too large to represent safely.'};
  return{kind:'fraction',value:numerator/denominator,text:fractionText(numerator,denominator)};
}
export function displayFraction(value:number,input?:string):string{
  if(input){const fraction=parseFraction(input);if(fraction.kind==='fraction'&&fraction.value===value)return fraction.text;}
  if(!Number.isFinite(value)||Number.isInteger(value))return String(value);
  const sign=value<0?-1:1;let x=Math.abs(value),n0=0,n1=1,d0=1,d1=0;
  for(let i=0;i<32;i++){
    const whole=Math.floor(x),n=whole*n1+n0,d=whole*d1+d0;
    if(!Number.isSafeInteger(n)||!Number.isSafeInteger(d)||d>1_000_000)break;
    if(sign*n/d===value)return fractionText(sign*n,d);
    if(x===whole)break;
    [n0,n1,d0,d1]=[n1,n,d1,d];x=1/(x-whole);
  }
  return String(value);
}
