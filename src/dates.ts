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
