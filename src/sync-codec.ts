import {compressArchive,decompressArchive} from './archive';

export type SyncCodecRequest={kind:'pack';value:unknown}|{kind:'unpack';value:string};
export function syncCodec(request:SyncCodecRequest):unknown{
  if(request.kind==='pack'){
    const text=JSON.stringify({format:'fnt-sync-v2',payload:compressArchive(request.value)}),bytes=new TextEncoder().encode(text);
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  const bytes=Uint8Array.from(atob(request.value.replace(/\s/g,'')),char=>char.charCodeAt(0));
  const envelope=JSON.parse(new TextDecoder().decode(bytes)) as {format?:string;payload?:string};
  return envelope.format==='fnt-sync-v2'&&typeof envelope.payload==='string'?decompressArchive(envelope.payload):envelope;
}
