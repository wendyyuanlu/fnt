import {bytes64,unbase64} from './archive';
import type {FoodPhoto} from './food-capture';
import {inspectPhoto,photoByteLimit,type PhotoBlob} from './food-photos';
import {withPrivateGitHub,type PrivateGitHubClient} from './github-client';
import type {SyncConfig} from './storage';

export interface PrivatePhoto extends FoodPhoto {path:string}
interface Gallery {format:'fnt-photo-gallery';version:1;photos:PrivatePhoto[]}
export interface PrivateGallery {photos:PrivatePhoto[];sha?:string}
export class PhotoGalleryConflict extends Error{
  constructor(public remote:PrivatePhoto){super('This photo has a different name or date in the private gallery. Review both versions before replacing metadata. No gallery entry was overwritten.');}
}
const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
const sha=(value:unknown):value is string=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
const indexByteLimit=4*1024*1024;
function prefix(config:SyncConfig):string{return config.path.slice(0,config.path.lastIndexOf('/')+1)+'fnt-photos/';}
function imagePath(config:SyncConfig,photo:FoodPhoto):string{return prefix(config)+photo.digest+'.'+extensions[photo.mime];}
function photoMetadata(value:unknown):asserts value is FoodPhoto{
  const photo=value as Partial<FoodPhoto>|null;
  if(!photo||typeof photo!=='object'||typeof photo.id!=='string'||!/^[\w.-]{1,128}$/.test(photo.id)||typeof photo.name!=='string'||photo.name.length>4096||!Number.isSafeInteger(photo.date)||typeof photo.mime!=='string'||!Object.hasOwn(extensions,photo.mime)||typeof photo.bytes!=='number'||!Number.isSafeInteger(photo.bytes)||photo.bytes<=0||photo.bytes>photoByteLimit||typeof photo.digest!=='string'||!/^[a-f0-9]{64}$/.test(photo.digest))throw Error('Invalid private photo metadata. Nothing was transferred.');
}
function gallery(value:unknown,config:SyncConfig):Gallery{
  const result=value as Partial<Gallery>|null;
  if(!result||result.format!=='fnt-photo-gallery'||result.version!==1||!Array.isArray(result.photos)||result.photos.length>50000)throw Error('This destination is not a supported Fnt photo gallery. Existing content was not replaced.');
  const ids=new Set<string>();
  for(const photo of result.photos){
    photoMetadata(photo);
    if(ids.has(photo.id)||photo.path!==imagePath(config,photo))throw Error('The private gallery has duplicate identities or an invalid image path. Nothing was replaced.');
    ids.add(photo.id);
  }
  return result as Gallery;
}
type Client=PrivateGitHubClient;
async function readFile(client:Client,path:string,limit:number):Promise<{bytes:Uint8Array;sha:string}|undefined>{
  const response=await client.request(client.contentURL(path),{headers:client.headers,cache:'no-store',redirect:'error'});
  if(response.status===404)return;
  if(!response.ok)throw Error(`Cannot read the private photo gallery (${response.status}). Local originals are unchanged.`);
  let data=await response.json() as {encoding?:unknown;content?:unknown;sha?:unknown;size?:unknown};
  if(typeof data.size==='number'&&(!Number.isSafeInteger(data.size)||data.size>limit))throw Error('The private gallery file exceeds its supported size limit.');
  if(data.encoding==='none'||!data.content&&typeof data.size==='number'&&data.size>0){
    if(!sha(data.sha))throw Error('GitHub did not return the photo file revision.');
    const blob=await client.request(`${client.root}/git/blobs/${encodeURIComponent(data.sha)}`,{headers:client.headers,cache:'no-store',redirect:'error'});
    if(!blob.ok)throw Error(`Cannot retrieve the private photo original (${blob.status}). Local originals are unchanged.`);
    data=await blob.json() as typeof data;
  }
  if(data.encoding!=='base64'||typeof data.content!=='string'||!sha(data.sha)||data.content.length>Math.ceil(limit/3)*4*1.1+256)throw Error('GitHub returned invalid or oversized photo file content.');
  const encoded=data.content.replace(/\s/g,'');
  if(encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('GitHub returned invalid photo file encoding.');
  const bytes=new Uint8Array(unbase64(encoded));
  if(bytes.length>limit)throw Error('The private gallery file exceeds its supported size limit.');
  return{bytes,sha:data.sha};
}
async function readIndex(client:Client):Promise<PrivateGallery>{
  const file=await readFile(client,client.config.path,indexByteLimit);if(!file)return{photos:[]};
  let parsed:unknown;
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(file.bytes));}
  catch{throw Error('The private gallery index is damaged or is not JSON. Existing content was not replaced.');}
  return{photos:gallery(parsed,client.config).photos,sha:file.sha};
}
async function writeFile(client:Client,path:string,bytes:Uint8Array,message:string,previous?:string):Promise<string>{
  const response=await client.request(client.contentURL(path),{
    method:'PUT',headers:{...client.headers,'Content-Type':'application/json'},redirect:'error',
    body:JSON.stringify({message,branch:client.config.branch,content:bytes64(bytes),...(previous?{sha:previous}:{})})
  });
  if(response.status===409||response.status===422)throw Error('The private photo gallery changed during transfer. No conflicting file was overwritten. Refresh the gallery before retrying.');
  if(!response.ok)throw Error(`Private photo transfer failed (${response.status}). The original remains local; check the gallery before retrying.`);
  const saved=await response.json() as {content?:{sha?:unknown}};
  if(!sha(saved.content?.sha))throw Error('GitHub did not confirm the photo transfer. Check the private gallery before retrying; the local original is unchanged.');
  return saved.content.sha;
}
export async function listPrivatePhotos(config:SyncConfig|undefined,token:string,fetcher:typeof fetch=fetch):Promise<PrivateGallery>{
  return withPrivateGitHub(config,token,fetcher,readIndex);
}
export async function downloadPrivatePhoto(config:SyncConfig|undefined,token:string,photo:PrivatePhoto,fetcher:typeof fetch=fetch):Promise<PhotoBlob>{
  photoMetadata(photo);
  return withPrivateGitHub(config,token,fetcher,async client=>{
    if(photo.path!==imagePath(client.config,photo))throw Error('Invalid private photo path.');
    const file=await readFile(client,photo.path,photoByteLimit);
    if(!file)throw Error('This original is missing from the private gallery. Its local reference was not removed.');
    return inspectPhoto(photo.id,new Blob([new Uint8Array(file.bytes)],{type:photo.mime}),photo);
  });
}
export async function uploadPrivatePhoto(config:SyncConfig|undefined,token:string,photo:FoodPhoto,blob:Blob,fetcher:typeof fetch=fetch,replaceMetadata?:Pick<FoodPhoto,'name'|'date'>):Promise<PrivateGallery>{
  photoMetadata(photo);await inspectPhoto(photo.id,blob,photo);
  return withPrivateGitHub(config,token,fetcher,async client=>{
    const index=await readIndex(client),existing=index.photos.find(entry=>entry.id===photo.id),path=imagePath(client.config,photo);
    if(existing&&(existing.digest!==photo.digest||existing.mime!==photo.mime||existing.bytes!==photo.bytes))throw Error('A different photo already uses this private gallery identity. Nothing was replaced.');
    const changed=existing&&(existing.name!==photo.name||existing.date!==photo.date);
    if(changed&&(!replaceMetadata||replaceMetadata.name!==existing.name||replaceMetadata.date!==existing.date))throw new PhotoGalleryConflict(existing);
    const original=await readFile(client,path,photoByteLimit);
    if(original)await inspectPhoto(photo.id,new Blob([new Uint8Array(original.bytes)],{type:photo.mime}),photo);
    else await writeFile(client,path,new Uint8Array(await blob.arrayBuffer()),'Fnt: save private photo original');
    if(existing&&!changed)return index;
    const entry:PrivatePhoto={id:photo.id,name:photo.name,date:photo.date,mime:photo.mime,bytes:photo.bytes,digest:photo.digest,path};
    const next:Gallery={format:'fnt-photo-gallery',version:1,photos:[...index.photos.filter(item=>item.id!==photo.id),entry]};
    const bytes=new TextEncoder().encode(JSON.stringify(next));
    if(bytes.length>indexByteLimit)throw Error('The private photo gallery index exceeds 4 MB. The original may already be uploaded, but no gallery entry was confirmed.');
    const revision=await writeFile(client,client.config.path,bytes,'Fnt: update private photo gallery',index.sha);
    return{photos:next.photos,sha:revision};
  });
}
