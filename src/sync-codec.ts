import {compressArchive,decompressArchive} from './archive';
import {rebaseSyncHistory,sameSharedWorkbook} from './sync-merge';
import {validatedSyncMerge} from './sync-merge-validation';
import {validateBook} from './storage';
import {captureNutritionReview,queueNutritionReview} from './ingredient-edit';
import type {Workbook} from './model';
import type {UndoHistory} from './undo-history';

export type SyncCodecRequest={kind:'capture';book:Workbook}|{kind:'pack';value:unknown}|{kind:'unpack';value:string}|{kind:'equal';local:Workbook;remote:Workbook}|{kind:'merge';base:Workbook;local:Workbook;remote:Workbook}|{kind:'nutrition';before:Workbook;after:Workbook}|{kind:'history';before:Workbook;after:Workbook;history:UndoHistory};
export type SyncCodecMessage={kind:'complete';request:SyncCodecRequest}|{kind:'start';operation:'merge'|'equal'|'history'|'nutrition'}|{kind:'part';field:string;value:unknown}|{kind:'run'};
export function syncCodec(request:SyncCodecRequest):unknown{
  if(request.kind==='capture')return structuredClone(request.book);
  if(request.kind==='equal')return sameSharedWorkbook(request.local,request.remote);
  if(request.kind==='merge'){
    const merged=validatedSyncMerge(request.base,request.local,request.remote);
    return{...merged,unchangedLocal:sameSharedWorkbook(merged.local,request.local),unchangedRemote:sameSharedWorkbook(merged.local,request.remote)};
  }
  if(request.kind==='history')return rebaseSyncHistory(request.before,request.after,request.history,validatedSyncMerge);
  if(request.kind==='nutrition'){
    const book=structuredClone(request.after),before=captureNutritionReview(request.before),previous=book.foodCapture?.nutritionConflicts;
    queueNutritionReview(book,before);
    return{book,changed:previous!==book.foodCapture?.nutritionConflicts};
  }
  if(request.kind==='pack'){
    const text=JSON.stringify({format:'fnt-sync-v2',payload:compressArchive(request.value)}),bytes=new TextEncoder().encode(text);
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  const bytes=Uint8Array.from(atob(request.value.replace(/\s/g,'')),char=>char.charCodeAt(0));
  const envelope=JSON.parse(new TextDecoder().decode(bytes)) as {format?:string;payload?:string};
  const decoded=envelope.format==='fnt-sync-v2'&&typeof envelope.payload==='string'?decompressArchive(envelope.payload):envelope;
  if(decoded&&typeof decoded==='object'&&'format'in decoded&&decoded.format==='fnt-sync-v1')validateBook('book'in decoded?decoded.book:undefined);
  return decoded;
}
