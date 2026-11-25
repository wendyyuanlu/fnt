const dayMs=86400000,epoch=Date.UTC(1899,11,31),march1900=Date.UTC(1900,2,1);
export const maxDateSerial=2958465;

export function excelDate(year:number,month:number,day:number):number|undefined {
  if(![year,month,day].every(Number.isFinite))return;
  year=Math.trunc(year);month=Math.trunc(month);day=Math.trunc(day);
  if(year>=0&&year<1900)year+=1900;
  if(year<1900||year>9999)return;
  const first=Date.UTC(year,month-1,1);
  // Excel's 1900 system includes the nonexistent February 29 as serial 60.
  const serial=(first-epoch)/dayMs+(first>=march1900?1:0)+day-1;
  return Number.isInteger(serial)&&serial>=0&&serial<=maxDateSerial?serial:undefined;
}

export function excelDateParts(serial:number):{year:number;month:number;day:number}|undefined {
  serial=Math.floor(serial);
  if(!Number.isFinite(serial)||serial<0||serial>maxDateSerial)return;
  if(serial===0)return{year:1900,month:1,day:0};
  if(serial===60)return{year:1900,month:2,day:29};
  const date=new Date(epoch+(serial-(serial>60?1:0))*dayMs);
  return{year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}

export function excelDateText(serial:number):string|undefined {
  const date=excelDateParts(serial);
  return date?`${String(date.year).padStart(4,'0')}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`:undefined;
}

export function displayExcelDate(serial:number,currentYear=new Date().getFullYear(),compactPastMonth=false):string|undefined {
  const date=excelDateParts(serial);
  if(!date)return;
  const day=String(date.day).padStart(2,'0');
  return date.year<currentYear?`${String(date.year%100).padStart(2,'0')}/${String(date.month).padStart(compactPastMonth?1:2,'0')}/${day}`:`${date.month}/${day}`;
}
export function parseDateInput(input:string,currentYear=new Date().getFullYear(),yearFirst=false):number|undefined{
  const text=input.trim();let year=currentYear,month:number,day:number;
  const iso=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text),numeric=/^(\d{1,4})\/(\d{1,2})(?:\/(\d{1,4}))?$/.exec(text),named=/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{2}|\d{4}))?$/i.exec(text);
  if(iso){year=Number(iso[1]);month=Number(iso[2]);day=Number(iso[3]);}
  else if(named){
    const names=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],full=['january','february','march','april','may','june','july','august','september','october','november','december'],name=named[1].toLowerCase();
    const index=name==='sept'?8:names.indexOf(name)>=0?names.indexOf(name):full.indexOf(name);if(index<0)return;
    month=index+1;day=Number(named[2]);if(named[3])year=Number(named[3]);
  }else if(numeric){
    const first=Number(numeric[1]),second=Number(numeric[2]),third=numeric[3]===undefined?undefined:Number(numeric[3]);
    if(third!==undefined&&(numeric[1].length===4||first>12||yearFirst&&numeric[3].length<=2&&third<=31&&second<=12)){
      year=first;month=second;day=third;
    }else{month=first;day=second;if(third!==undefined)year=third;}
  }else return;
  if(year<100)year+=2000;
  const serial=excelDate(year,month,day),parts=serial===undefined?undefined:excelDateParts(serial);
  return parts?.year===year&&parts.month===month&&parts.day===day?serial:undefined;
}
