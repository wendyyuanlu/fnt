import {syncCodec,type SyncCodecRequest} from './sync-codec';

export function runSyncCodec(request:SyncCodecRequest):Promise<unknown>{
  if(typeof Worker==='undefined')return Promise.resolve(syncCodec(request));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./sync-codec-worker.ts',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timer);worker.terminate();};
    const timer=setTimeout(()=>{finish();reject(Error('Private sync processing timed out. Local edits retained.'));},90000);
    worker.onmessage=event=>{finish();const result=event.data as {value?:unknown;error?:string};if(result.error)reject(Error(result.error));else resolve(result.value);};
    worker.onerror=event=>{finish();reject(Error(`Private sync processing failed: ${event.message}`));};
    worker.postMessage(request);
  });
}
