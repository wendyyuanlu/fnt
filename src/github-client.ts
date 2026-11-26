import type {SyncConfig} from './storage';

export interface PrivateGitHubClient {
  config:SyncConfig;
  root:string;
  headers:Record<string,string>;
  request:(url:string,init:RequestInit)=>Promise<Response>;
  contentURL:(path:string)=>string;
}

export async function withPrivateGitHub<T>(config:SyncConfig|undefined,token:string,fetcher:typeof fetch,run:(client:PrivateGitHubClient)=>Promise<T>):Promise<T>{
  if(!config||!token)throw Error('Connect a private repository and enter a token for this browser session.');
  if(!/^[\w.-]+$/.test(config.owner)||!/^[\w.-]+$/.test(config.repo)||typeof config.branch!=='string'||!config.branch||typeof config.path!=='string'||!config.path.endsWith('.json')||config.path.split('/').some(s=>s==='..'))throw Error('Invalid sync destination. Use a JSON file in a private data repository.');
  if(`${config.owner}/${config.repo}`.toLowerCase()==='wendyyuanlu/fnt')throw Error('The website source repository cannot be used for nutrition data. Choose a separate private data repository with no Pages publishing.');
  const root=`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const controller=new AbortController();let deadline:ReturnType<typeof setTimeout>|undefined;
  const request=async(url:string,init:RequestInit)=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      return await Promise.race([fetcher(url,{...init,signal:controller.signal}),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(Error('Private GitHub request timed out. Local edits are retained.'));},30000);
      })]);
    }finally{clearTimeout(timer);}
  };
  const operation=async()=>{
    const repo=await request(root,{headers,cache:'no-store',redirect:'error'});
    if(!repo.ok)throw Error(`Cannot verify private repository (${repo.status}). Nothing uploaded.`);
    const info=await repo.json() as {private?:boolean;has_pages?:boolean};
    if(info.private!==true)throw Error('Sync requires a PRIVATE repository. Nothing uploaded.');
    if(info.has_pages!==false)throw Error('Sync requires a private data repository with GitHub Pages disabled. Nothing uploaded.');
    return run({config,root,headers,request,contentURL:path=>`${root}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(config.branch)}`});
  };
  try{
    return await Promise.race([operation(),new Promise<never>((_,reject)=>{
      deadline=setTimeout(()=>reject(Error('Private sync timed out while transferring data. Local edits are retained.')),90000);
    })]);
  }finally{clearTimeout(deadline);controller.abort();}
}
