import {clone,uid} from './model';
import {Store,SyncConflict,syncGitHub,mergeForSync,type LocalState,type SyncPlan} from './storage';
import {assertUndecidedReview,type StoredComparisonReview} from './comparison-host';
import {runSyncCodec} from './sync-processing';
import {syncEqual} from './sync-merge';
export interface SyncRecheck {
  state:LocalState;
  config:NonNullable<LocalState['sync']>;
  plan:SyncPlan;
  previousId:string;
  previous:StoredComparisonReview;
  storedPrevious?:StoredComparisonReview;
  reviewId:string;
  review:StoredComparisonReview;
  backupId:string;
}
export async function prepareSyncRecheck(store:Store,state:LocalState,token:string,reviewId:string|undefined,canContinue:()=>boolean,fetcher:typeof fetch=fetch,progress?:(message:string)=>void):Promise<SyncRecheck>{
  progress?.('Rechecking paused sync - checking saved state (no upload)');
  const captured=clone(state),config=captured.sync;
  if(!config||!token||!captured.syncReview)throw Error('Connect private sync and open the paused review before rechecking.');
  const unchanged=async()=>{
    const current=await store.load();
    if(!canContinue()||!current||current.version!==captured.version||!syncEqual(current,captured)){
      throw Error('The local workbook or sync connection changed during recheck. Nothing was replaced; recheck again after saving.');
    }
  };
  await unchanged();
  if(reviewId)await store.assertUndecidedComparisonReview(reviewId);
  progress?.('Rechecking paused sync - saving a full local recovery backup (no upload)');
  const backupId=await store.preserveSyncRecheckBackup(captured);
  await unchanged();
  progress?.('Rechecking paused sync - reading GitHub and comparing saved changes (no upload)');
  const storedPrevious=reviewId?await store.comparisonReview(reviewId):undefined;
  if(reviewId&&!storedPrevious)throw Error('The saved comparison could not be found. Open the paused comparison before rechecking.');
  assertUndecidedReview(storedPrevious);
  const preserved=await store.syncConflict(config);
  const previous=storedPrevious??{
    left:{book:clone(preserved?.local??captured.book),kind:'This device',label:'Preserved local source before recheck'},
    right:preserved?{book:preserved.book,kind:'GitHub',label:'Preserved paused sync source',revision:preserved.sha}:undefined,
    baseRevision:captured.book.revision,
    sync:preserved?{config,path:config.path,sha:preserved.sha}:undefined,
  };
  const [base,attempt,originals]=await Promise.all([store.syncBase(config,captured.remoteSha),store.syncAttempt(config),store.originals()]);
  let plan:SyncPlan;
  try{
    const result=await syncGitHub(captured,token,fetcher,originals,{base,attempt,planOnly:true});
    if(!result.plan)throw Error('Recheck did not return a merge preview. The paused review was retained.');
    plan=result.plan;
  }catch(error){
    if(error instanceof SyncConflict)throw Error('A shared sync ancestor could not be verified. The original review remains unchanged; neither copy was uploaded or replaced.');
    throw error;
  }
  if(preserved?.local&&preserved.sha===captured.remoteSha){
    if(!base)throw Error('The previous unresolved conflict has no verified remote baseline. Continue the preserved review; recheck did not choose either side.');
    // The conflict head is a confirmed remote baseline, not a resolution of the old alternatives.
    const carried=await mergeForSync(preserved.local,plan.local,preserved.book);
    const updated=await mergeForSync(base,carried.remote,plan.originalRemote);
    const equal=await runSyncCodec({kind:'equal',local:plan.local,remote:updated.remote},{snapshots:true}) as boolean;
    plan={...plan,remote:updated.remote,conflicts:equal?[]:['preserved-unresolved-review']};
  }
  await unchanged();
  return{
    state:captured,config,plan,previousId:reviewId??uid(),previous:clone(previous),storedPrevious,
    reviewId:uid(),backupId,
    review:{
      left:{book:plan.local,kind:'This device',label:'Rechecked local choice with compatible changes'},
      right:{book:plan.remote,kind:'GitHub',label:'Rechecked GitHub choice with compatible changes',revision:plan.sha},
      baseRevision:captured.book.revision,sync:{config,path:config.path,sha:plan.sha},
    },
  };
}
