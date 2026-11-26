import {syncCodec,type SyncCodecRequest} from './sync-codec';

self.onmessage=(event:MessageEvent<SyncCodecRequest>)=>{
  try{self.postMessage({value:syncCodec(event.data)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
