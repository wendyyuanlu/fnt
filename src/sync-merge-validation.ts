import {type Workbook} from './model';
import {mergeSyncWorkbooks,type SyncMerge} from './sync-merge';
import {validateBook} from './storage';
import {missingDependencies} from './comparison-merge';

export function validatedSyncMerge(base:Workbook,local:Workbook,remote:Workbook):SyncMerge{
  const merged=mergeSyncWorkbooks(base,local,remote);
  const existing=new Set([...missingDependencies(local),...missingDependencies(remote)]);
  try{
    for(const book of new Set([merged.local,merged.remote])){
      validateBook(book);
      if([...missingDependencies(book)].some(issue=>!existing.has(issue)))throw Error('Merged changes have incompatible dependencies.');
    }
  }catch(error){
    // Coupled structural choices must stay together, never orphan or discard content.
    return{local,remote,conflicts:[...merged.conflicts,`structure/dependencies: ${String(error)}`]};
  }
  return merged;
}
