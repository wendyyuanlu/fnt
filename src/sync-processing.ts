import {syncCodec,type SyncCodecRequest,type SyncCodecMessage} from './sync-codec';

const afterPaint=(done:()=>void)=>{
  if(typeof document==='undefined'||document.visibilityState!=='visible'){setTimeout(done,0);return;}
  let completed=false,frame=0;
  const finish=()=>{if(completed)return;completed=true;clearTimeout(timer);cancelAnimationFrame(frame);done();};
  const timer=setTimeout(finish,50);
  frame=requestAnimationFrame(()=>setTimeout(finish,0));
};
export function runSyncCodec(request:SyncCodecRequest,options?:{snapshots?:boolean}):Promise<unknown>{
  if(typeof Worker==='undefined')return Promise.resolve().then(()=>syncCodec(request));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./sync-codec-worker.ts',import.meta.url),{type:'module'});
    let finished=false;
    const finish=()=>{finished=true;clearTimeout(timer);worker.terminate();};
    const timer=setTimeout(()=>{finish();reject(Error('Private sync processing timed out. Local edits retained.'));},90000);
    worker.onmessage=event=>{
      finish();const result=event.data as {value?:unknown;error?:string};
      if(result.error){reject(Error(result.error));return;}
      afterPaint(()=>resolve(result.value));
    };
    worker.onerror=event=>{finish();reject(Error(`Private sync processing failed: ${event.message}`));};
    const post=(message:SyncCodecMessage)=>worker.postMessage(message);
    if(options?.snapshots&&(request.kind==='merge'||request.kind==='equal'||request.kind==='history'||request.kind==='nutrition')){
      // These callers own immutable snapshots, so large books can yield separately.
      const send=async()=>{
        post({kind:'start',operation:request.kind});
        for(const [field,value]of Object.entries(request)){
          if(field==='kind')continue;
          await new Promise<void>(afterPaint);if(finished)return;
          post({kind:'part',field,value});
        }
        post({kind:'run'});
      };
      void send().catch(error=>{finish();reject(error);});
    }else{
      try{post({kind:'complete',request});}
      catch(error){finish();reject(error);}
    }
  });
}
