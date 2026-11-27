import type {NameVersion} from './food-capture';
export function validateNameVersion(value:unknown):asserts value is NameVersion{
  const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const id=(value:unknown):value is string=>typeof value==='string'&&/^[\w.-]{1,128}$/.test(value);
  const text=(value:unknown):value is string=>typeof value==='string'&&value.length<=1000000;
  if(!record(value)||!id(value.id)||!id(value.batch)||!text(value.time)||!Number.isFinite(Date.parse(value.time))||!Array.isArray(value.names)||value.names.length>100000)throw Error('Invalid saved name version.');
  const seen=new Set<string>();
  for(const name of value.names){
    if(!record(name)||!id(name.id)||seen.has(name.id)||!text(name.key)||!name.key||!text(name.originalName)||!text(name.name)||!text(name.restaurant))throw Error('Invalid saved name mapping.');
    seen.add(name.id);
  }
}
export function parseNameBackup(text:string):NameVersion{
  if(text.length>10000000)throw Error('Name backup exceeds the supported 10 MB limit.');
  const data:unknown=JSON.parse(text);
  if(!data||typeof data!=='object'||!('format'in data)||data.format!=='fnt-nutrition-names'||!('version'in data)||data.version!==1||!('names'in data))throw Error('Choose an fnt nutrition-name backup, not a workbook or nutrition-response file.');
  validateNameVersion(data.names);return data.names;
}
export function encodeNameBackup(version:NameVersion):string{
  validateNameVersion(version);return JSON.stringify({format:'fnt-nutrition-names',version:1,names:version},null,2);
}
