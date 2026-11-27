import {compressArchive,decompressArchive} from './archive';
import {uid,type Workbook} from './model';
import {encode64,decode64,validateBook,type SyncConfig} from './storage';
import {githubFormDefaults,withPrivateGitHub} from './github-client';
import {runSyncCodec} from './sync-processing';

export interface ComparisonSnapshot {path:string;sha:string;time:string;device:string;workbook:string}
export interface ComparisonCommit {sha:string;time:string;message:string;changes?:number}
export interface ComparisonCommitPage {commits:ComparisonCommit[];next?:number}
interface SnapshotFile {format:'fnt-comparison-snapshot';version:1;time:string;device:string;workbook:string;payload:string}
const revision=(value:unknown):value is string=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
export async function listComparisonCommits(config:SyncConfig|undefined,token:string,page=1,fetcher:typeof fetch=fetch):Promise<ComparisonCommitPage>{
  if(!Number.isSafeInteger(page)||page<1)throw Error('Invalid commit history page.');
  return withPrivateGitHub(config,token,fetcher,async client=>{
    const response=await client.request(`${client.root}/commits?sha=${encodeURIComponent(client.config.branch)}&per_page=100&page=${page}`,{headers:client.headers,cache:'no-store',redirect:'error'});
    if(!response.ok)throw Error(`Cannot read commit history (${response.status}). Previous comparison retained.`);
    const rows=await response.json() as {sha?:unknown;commit?:{message?:unknown;committer?:{date?:unknown}}}[];
    if(!Array.isArray(rows)||rows.length>100)throw Error('GitHub returned invalid commit history.');
    const commits=rows.map(row=>{
      if(!row||typeof row!=='object')throw Error('A commit has invalid revision or date metadata.');
      const time=row.commit?.committer?.date,message=row.commit?.message;
      if(!revision(row.sha)||typeof time!=='string'||!Number.isFinite(Date.parse(time))||typeof message!=='string')throw Error('A commit has invalid revision or date metadata.');
      const count=/^(?:Fnt: save (\d+) local changes?|Fnt save \((\d+) pending changes?\))(?:\s|$)/i.exec(message),changes=count?Number(count[1]??count[2]):undefined;
      if(changes!==undefined&&!Number.isSafeInteger(changes))throw Error('A commit has invalid saved-change metadata.');
      return{sha:row.sha,time,message:message.split('\n')[0],...(changes!==undefined?{changes}:{})};
    });
    return{commits,...(response.headers.get('link')?.includes('rel="next"')?{next:page+1}:{})};
  });
}
export async function readComparisonCommit(config:SyncConfig|undefined,token:string,commit:ComparisonCommit,fetcher:typeof fetch=fetch):Promise<{book:Workbook;path:string}>{
  if(!revision(commit.sha))throw Error('Invalid comparison commit selection.');
  return withPrivateGitHub(config,token,fetcher,async client=>{
    const defaults=githubFormDefaults(client.config),paths=[client.config.path,defaults.path];
    if(defaults.path==='fnt-data.json'&&githubFormDefaults({...client.config,path:'personal-workbook.json'}).path==='fnt-data.json')paths.push('personal-workbook.json','workbook.json');
    for(const path of new Set(paths)){
      const url=new URL(client.contentURL(path));url.searchParams.set('ref',commit.sha);
      const response=await client.request(url.toString(),{headers:client.headers,cache:'no-store',redirect:'error'});
      if(response.status===404)continue;
      if(!response.ok)throw Error(`Cannot read this commit's workbook (${response.status}). Previous comparison retained.`);
      let data=await response.json() as {content?:unknown;encoding?:unknown;sha?:unknown;size?:unknown};
      if(data?.encoding==='none'||(!data?.content&&typeof data?.size==='number'&&data.size>0)){
        if(!revision(data.sha))throw Error("GitHub did not return this commit's workbook revision.");
        const blob=await client.request(`${client.root}/git/blobs/${encodeURIComponent(data.sha)}`,{headers:client.headers,cache:'no-store',redirect:'error'});
        if(!blob.ok)throw Error(`Cannot read this commit's larger workbook (${blob.status}). Previous comparison retained.`);
        data=await blob.json() as typeof data;
      }
      if(data?.encoding!=='base64'||typeof data.content!=='string')throw Error("GitHub did not return this commit's workbook content.");
      const envelope=await runSyncCodec({kind:'unpack',value:data.content}) as {book?:Workbook};
      const book=envelope?.book;validateBook(book);return{book,path};
    }
    throw Error('This commit does not contain the configured workbook JSON, including its recognized previous filenames. Previous comparison retained.');
  });
}
export function comparisonDeviceName(value:string):string{
  const name=value.trim();
  if(!name||name.length>64||new TextEncoder().encode(name).length>96||/[\u0000-\u001f\u007f]/.test(name))throw Error('Enter a device name of 1–64 characters (at most 96 UTF-8 bytes), without control characters.');
  return name;
}
function folder(config:SyncConfig,book:string):string{
  if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(book))throw Error('Invalid workbook identity. No snapshot uploaded.');
  return `${config.path.slice(0,config.path.lastIndexOf('/')+1)}fnt-snapshots/${book}/`;
}
export function snapshotDate(time:string):string{
  const date=new Date(time);
  return `${date.getMonth()+1}/${date.getDate()} @ ${date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
}
function fileEntry(path:string,sha:string,workbook:string,prefix:string):ComparisonSnapshot|undefined{
  if(!path.startsWith(prefix))return;
  const match=/^(\d{13})_([A-Za-z0-9_-]+)_([a-f0-9-]{36})\.json$/i.exec(path.slice(prefix.length));if(!match)return;
  const time=new Date(Number(match[1]));if(!Number.isFinite(time.getTime()))throw Error('An uploaded snapshot has an invalid date.');
  const encoded=match[2].replace(/-/g,'+').replace(/_/g,'/'),device=comparisonDeviceName(decode64(encoded+'='.repeat((4-encoded.length%4)%4)));
  return {path,sha,time:time.toISOString(),device,workbook};
}
export async function uploadComparisonSnapshot(config:SyncConfig|undefined,token:string,book:Workbook,device:string,fetcher:typeof fetch=fetch):Promise<ComparisonSnapshot>{
  const name=comparisonDeviceName(device);validateBook(book);
  const captured=structuredClone(book);
  return withPrivateGitHub(config,token,fetcher,async client=>{
    const time=new Date().toISOString(),encoded=encode64(name).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const path=`${folder(client.config,captured.id)}${new Date(time).getTime()}_${encoded}_${uid()}.json`;
    if(path===client.config.path)throw Error('A comparison snapshot cannot replace the synced workbook.');
    const file:SnapshotFile={format:'fnt-comparison-snapshot',version:1,time,device:name,workbook:captured.id,payload:compressArchive(captured)};
    const content=encode64(JSON.stringify(file));
    if(content.length>100*1024*1024)throw Error('This snapshot exceeds the GitHub upload limit. Download a local backup instead.');
    const response=await client.request(client.contentURL(path),{method:'PUT',headers:{...client.headers,'Content-Type':'application/json'},redirect:'error',
      body:JSON.stringify({message:`Fnt: comparison snapshot from ${name}`,branch:client.config.branch,content})});
    if(!response.ok)throw Error(`Snapshot upload failed (${response.status}). The synced workbook and local edits are unchanged.`);
    const result=await response.json() as {content?:{sha?:unknown}};
    if(!revision(result.content?.sha))throw Error('GitHub did not acknowledge the snapshot. Check uploaded copies before retrying; the main workbook was not replaced.');
    return {path,sha:result.content.sha,time,device:name,workbook:captured.id};
  });
}
export async function listComparisonSnapshots(config:SyncConfig|undefined,token:string,workbook:string,fetcher:typeof fetch=fetch):Promise<ComparisonSnapshot[]>{
  return withPrivateGitHub(config,token,fetcher,async client=>{
    const prefix=folder(client.config,workbook),response=await client.request(`${client.root}/git/trees/${encodeURIComponent(client.config.branch)}?recursive=1`,{headers:client.headers,cache:'no-store',redirect:'error'});
    if(!response.ok)throw Error(`Cannot list uploaded snapshots (${response.status}). No workbook was changed.`);
    const tree=await response.json() as {truncated?:boolean;tree?:{path?:unknown;sha?:unknown;type?:unknown}[]};
    if(tree.truncated||!Array.isArray(tree.tree))throw Error('GitHub returned an incomplete snapshot listing. No partial list will be shown.');
    const files:ComparisonSnapshot[]=[];
    for(const node of tree.tree){
      if(node.type!=='blob'||typeof node.path!=='string'||!node.path.startsWith(prefix))continue;
      if(!revision(node.sha))throw Error('An uploaded snapshot is missing its GitHub revision.');
      const entry=fileEntry(node.path,node.sha,workbook,prefix);if(entry)files.push(entry);
    }
    return files.sort((a,b)=>b.time.localeCompare(a.time)||b.path.localeCompare(a.path));
  });
}
export function comparisonSnapshot(contents:string):Workbook{
  const file=JSON.parse(contents) as SnapshotFile;
  if(file?.format!=='fnt-comparison-snapshot'||file.version!==1||typeof file.payload!=='string'||typeof file.time!=='string'||!Number.isFinite(Date.parse(file.time))||typeof file.device!=='string')throw Error('This file is not a valid uploaded comparison snapshot.');
  comparisonDeviceName(file.device);
  const book=decompressArchive(file.payload) as Workbook;validateBook(book);
  if(book.id!==file.workbook)throw Error('Snapshot workbook identity does not match its metadata.');
  return book;
}
export async function readComparisonSnapshot(config:SyncConfig|undefined,token:string,entry:ComparisonSnapshot,fetcher:typeof fetch=fetch):Promise<Workbook>{
  return withPrivateGitHub(config,token,fetcher,async client=>{
    const expected=fileEntry(entry.path,entry.sha,entry.workbook,folder(client.config,entry.workbook));
    if(!expected||!revision(entry.sha)||expected.time!==entry.time||expected.device!==entry.device)throw Error('Invalid comparison snapshot selection.');
    const response=await client.request(`${client.root}/git/blobs/${encodeURIComponent(entry.sha)}`,{headers:client.headers,cache:'no-store',redirect:'error'});
    if(!response.ok)throw Error(`Cannot read uploaded snapshot (${response.status}). Previous comparison retained.`);
    const blob=await response.json() as {content?:unknown;encoding?:string};
    if(blob.encoding!=='base64'||typeof blob.content!=='string')throw Error('GitHub did not return the snapshot content.');
    const contents=decode64(blob.content),file=JSON.parse(contents) as SnapshotFile,book=comparisonSnapshot(contents);
    if(file.time!==entry.time||file.device!==entry.device||book.id!==entry.workbook)throw Error('Uploaded snapshot metadata does not match the selected copy.');
    return book;
  });
}
export async function deleteComparisonSnapshot(config:SyncConfig|undefined,token:string,entry:ComparisonSnapshot,fetcher:typeof fetch=fetch):Promise<void>{
  await withPrivateGitHub(config,token,fetcher,async client=>{
    const expected=fileEntry(entry.path,entry.sha,entry.workbook,folder(client.config,entry.workbook));
    if(entry.path===client.config.path||!expected||!revision(entry.sha)||expected.time!==entry.time||expected.device!==entry.device)throw Error('Invalid uploaded copy. Nothing deleted.');
    const current=await client.request(client.contentURL(entry.path),{headers:client.headers,cache:'no-store',redirect:'error'});
    if(!current.ok)throw Error(`Cannot verify uploaded copy (${current.status}). Refresh the list before retrying.`);
    const file=await current.json() as {sha?:unknown};
    if(file.sha!==entry.sha)throw Error('This uploaded copy changed. Refresh the list; nothing deleted.');
    const response=await client.request(client.contentURL(entry.path),{method:'DELETE',headers:{...client.headers,'Content-Type':'application/json'},redirect:'error',
      body:JSON.stringify({message:'Fnt: delete comparison snapshot',branch:client.config.branch,sha:entry.sha})});
    if(!response.ok)throw Error(`Uploaded copy deletion could not be confirmed (${response.status}). Refresh the list before retrying.`);
    const result=await response.json() as {commit?:{sha?:unknown}};
    if(!revision(result.commit?.sha))throw Error('GitHub did not confirm deletion. Refresh the list before retrying.');
  });
}
