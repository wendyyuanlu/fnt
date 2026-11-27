import {syncCodec,type SyncCodecRequest,type SyncCodecMessage} from './sync-codec';

let partial:{kind:'merge'|'equal'|'history';[field:string]:unknown}|undefined;
self.onmessage=(event:MessageEvent<SyncCodecMessage>)=>{
  try{
    const message=event.data;
    if(message.kind==='start'){partial={kind:message.operation};return;}
    if(message.kind==='part'){
      if(!partial||!['base','local','remote','before','after','history'].includes(message.field))throw Error('Invalid sync processing input.');
      partial[message.field]=message.value;return;
    }
    if(message.kind==='run'&&!partial)throw Error('Missing sync processing input.');
    const request=message.kind==='complete'?message.request:partial as SyncCodecRequest;
    self.postMessage({value:syncCodec(request)});
  }
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
