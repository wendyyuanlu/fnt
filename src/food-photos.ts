import {bytes64,unbase64} from './archive';
import type {Workbook} from './model';

export const photoByteLimit=12*1024*1024;
export interface PhotoBlob{
  id:string;digest:string;mime:string;bytes:number;blob:Blob;
}
export interface PhotoArchive{
  id:string;digest:string;mime:string;bytes:number;data:string;
}
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/gif']);
const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[\w.-]{1,128}$/.test(value);
export function referencedPhotoIds(book:Workbook):Set<string>{
  const data=book.foodCapture,ids=new Set(data?.photos.map(photo=>photo.id));
  for(const food of data?.foods??[])for(const id of food.photos)ids.add(id);
  for(const details of Object.values(data?.ingredientDetails??{}))for(const id of details.photos)ids.add(id);
  for(const item of data?.builder?.items??[])for(const id of item.photos)ids.add(id);
  for(const item of data?.builder?.linkedIntents??[])for(const id of item.photos)ids.add(id);
  return ids;
}
export function validatePhotoArchives(value:unknown):asserts value is PhotoArchive[]{
  if(!Array.isArray(value)||value.length>100000)throw Error('Invalid photo archive.');
  const seen=new Set<string>();
  for(const photo of value){
    if(!photo||typeof photo!=='object'||!safeId(photo.id)||seen.has(photo.id)||typeof photo.digest!=='string'||!/^[a-f0-9]{64}$/.test(photo.digest)||!imageTypes.has(photo.mime)||!Number.isSafeInteger(photo.bytes)||photo.bytes<=0||photo.bytes>photoByteLimit||typeof photo.data!=='string'||photo.data.length!==4*Math.ceil(photo.bytes/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(photo.data))throw Error('Invalid photo archive entry.');
    seen.add(photo.id);
  }
}
function imageSignature(bytes:Uint8Array,mime:string):boolean{
  const text=(start:number,length:number)=>String.fromCharCode(...bytes.slice(start,start+length));
  if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(mime==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
  if(mime==='image/gif')return text(0,6)==='GIF87a'||text(0,6)==='GIF89a';
  return mime==='image/webp'&&text(0,4)==='RIFF'&&text(8,4)==='WEBP';
}
export async function inspectPhoto(id:string,blob:Blob,expected?:Pick<PhotoBlob,'digest'|'mime'|'bytes'>):Promise<PhotoBlob>{
  if(!safeId(id)||!imageTypes.has(blob.type))throw Error('Choose a JPEG, PNG, WebP or GIF photo. Other formats must be converted on your device first.');
  if(!blob.size||blob.size>photoByteLimit)throw Error('Each photo must be nonempty and at most 12 MB.');
  if(expected&&(expected.bytes!==blob.size||expected.mime!==blob.type))throw Error('Photo size or type differs from its saved metadata. Nothing was replaced.');
  const data=new Uint8Array(await blob.arrayBuffer());
  if(!imageSignature(data,blob.type))throw Error('The photo contents do not match its image format.');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),value=>value.toString(16).padStart(2,'0')).join('');
  if(expected&&expected.digest!==digest)throw Error('Photo checksum mismatch. The saved photo was not replaced.');
  return{id,blob,digest,mime:blob.type,bytes:blob.size};
}
export async function encodePhotoArchives(photos:PhotoBlob[]):Promise<PhotoArchive[]>{
  const archives:PhotoArchive[]=[];
  for(const photo of photos){
    await inspectPhoto(photo.id,photo.blob,photo);
    archives.push({id:photo.id,digest:photo.digest,mime:photo.mime,bytes:photo.bytes,data:bytes64(new Uint8Array(await photo.blob.arrayBuffer()))});
  }
  return archives;
}
export async function decodePhotoArchives(photos:PhotoArchive[]):Promise<PhotoBlob[]>{
  validatePhotoArchives(photos);
  const decoded:PhotoBlob[]=[];
  for(const photo of photos)decoded.push(await inspectPhoto(photo.id,new Blob([new Uint8Array(unbase64(photo.data))],{type:photo.mime}),photo));
  return decoded;
}
