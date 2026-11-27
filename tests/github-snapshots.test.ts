import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDemo} from '../src/model';
import {decode64,encode64,type SyncConfig} from '../src/storage';
import {uploadComparisonSnapshot,listComparisonSnapshots,readComparisonSnapshot,deleteComparisonSnapshot,comparisonSnapshot,listComparisonCommits,readComparisonCommit} from '../src/github-snapshots';
import {syncCodec} from '../src/sync-codec';
import {githubFormDefaults} from '../src/github-client';

const config:SyncConfig={owner:'example',repo:'private-data',branch:'main',path:'personal/workbook.json'};
const token='invented-restricted-token';
afterEach(()=>vi.useRealTimers());
it('suggests the renamed private data filename without mutating saved or custom destinations',()=>{
  const saved={owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:'workbook.json'};
  for(const path of ['workbook.json','personal-workbook.json']){
    const legacy={...saved,path};expect(githubFormDefaults(legacy).path).toBe('fnt-data.json');expect(legacy.path).toBe(path);
  }
  for(const custom of [{...saved,path:'private/custom.json'},{...saved,repo:'another-private-repo'},{...saved,branch:'other'}])expect(githubFormDefaults(custom)).toEqual(custom);
});
function server(){
  const files=new Map<string,{sha:string;content:string}>(),writes:{path:string;body:Record<string,unknown>}[]=[];
  const fetcher:typeof fetch=vi.fn(async(input,init)=>{
    const url=new URL(String(input)),path=decodeURIComponent(url.pathname.split('/contents/')[1]??'');
    if(init?.method==='PUT'){
      const body=JSON.parse(String(init.body)) as Record<string,unknown>;
      const sha=(files.size+1).toString(16).padStart(40,'0');
      files.set(path,{sha,content:String(body.content)});writes.push({path,body});
      return Response.json({content:{sha}});
    }
    if(init?.method==='DELETE'){
      const body=JSON.parse(String(init.body)) as Record<string,unknown>,file=files.get(path);
      if(file?.sha!==body.sha)return new Response(null,{status:409});
      files.delete(path);writes.push({path,body});return Response.json({commit:{sha:'d'.repeat(40)}});
    }
    if(url.pathname.includes('/contents/'))return files.has(path)?Response.json({sha:files.get(path)!.sha}):new Response(null,{status:404});
    if(url.pathname.includes('/git/trees/'))return Response.json({tree:[...files].reverse().map(([path,file])=>({path,sha:file.sha,type:'blob'})),truncated:false});
    if(url.pathname.includes('/git/blobs/')){
      const file=[...files.values()].find(file=>file.sha===url.pathname.split('/').at(-1));
      return file?Response.json({encoding:'base64',content:file.content}):new Response(null,{status:404});
    }
    return Response.json({private:true,has_pages:false});
  });
  return {fetcher,files,writes};
}
describe('private comparison snapshots',()=>{
  it('deletes only the listed snapshot current file with a fresh SHA check, leaving the workbook untouched',async()=>{
    const {fetcher,files,writes}=server(),book=createDemo(),entry=await uploadComparisonSnapshot(config,token,book,'Phone',fetcher);
    files.set(config.path,{sha:'a'.repeat(40),content:'Invented main file'});
    await deleteComparisonSnapshot(config,token,entry,fetcher);
    expect(files.has(entry.path)).toBe(false);expect(files.get(config.path)?.content).toBe('Invented main file');
    expect(writes.at(-1)).toEqual({path:entry.path,body:{message:'Fnt: delete comparison snapshot',branch:config.branch,sha:entry.sha}});
    await expect(deleteComparisonSnapshot(config,token,{...entry,path:config.path},fetcher)).rejects.toThrow('Invalid uploaded copy');
  });
  it('rejects changed, missing, and unacknowledged deletions without retrying a destructive request',async()=>{
    for(const kind of ['changed','missing','unacknowledged']){
      const {fetcher,files}=server(),entry=await uploadComparisonSnapshot(config,token,createDemo(),'Phone',fetcher);let deletes=0;
      if(kind==='changed')files.get(entry.path)!.sha='c'.repeat(40);
      if(kind==='missing')files.delete(entry.path);
      const wrapped:typeof fetch=async(input,init)=>{
        if(init?.method==='DELETE'){deletes++;return Response.json({});}
        return fetcher(input,init);
      };
      await expect(deleteComparisonSnapshot(config,token,entry,wrapped)).rejects.toThrow(/Refresh|refresh/);
      expect(deletes).toBe(kind==='unacknowledged'?1:0);
    }
  });
  it('creates independent copies with device labels, lists newest first and reads the selected immutable blob',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    const {fetcher,writes}=server(),book=createDemo(),before=JSON.stringify(book);
    const first=await uploadComparisonSnapshot(config,token,book,'Phone',fetcher);
    vi.setSystemTime(new Date('2026-11-25T19:00:00Z'));
    const second=await uploadComparisonSnapshot(config,token,book,'Desktop',fetcher);
    expect(first.path).not.toBe(config.path);expect(second.path).not.toBe(first.path);
    for(const write of writes){
      expect(write.path.startsWith(`personal/fnt-snapshots/${book.id}/`)).toBe(true);
      expect(write.body).not.toHaveProperty('sha');
      const text=decode64(String(write.body.content));
      expect(text).not.toContain(token);expect(text).not.toContain('"originals"');
      expect(comparisonSnapshot(text)).toEqual(book);
    }
    const list=await listComparisonSnapshots(config,token,book.id,fetcher);
    expect(list.map(file=>file.device)).toEqual(['Desktop','Phone']);
    expect(await readComparisonSnapshot(config,token,list[1],fetcher)).toEqual(book);
    expect(JSON.stringify(book)).toBe(before);
  });
  describe('read-only comparison commits',()=>{
    it.each([['Fnt: save 2 local changes',2],['Fnt: save 1 local change',1],['Fnt: save 0 local changes',0]] as const)('reads the recorded count from the current writer: %s',async(message,changes)=>{
      const sha='e'.repeat(40),time='2026-11-26T22:00:00Z';
      const fetcher:typeof fetch=vi.fn(async input=>String(input).includes('/commits')?Response.json([{sha,commit:{committer:{date:time},message}}]):Response.json({private:true,has_pages:false}));
      expect((await listComparisonCommits(config,token,1,fetcher)).commits).toEqual([{sha,time,message,changes}]);
    });
    const sha='a'.repeat(40),commit={sha,time:'2026-11-25T22:00:00Z',message:'Fnt save (7 pending changes)'};
    it('loads large historical JSON from its immutable blob rather than the branch or a download URL',async()=>{
      const blob='d'.repeat(40),book=createDemo(),requests:string[]=[],fetcher:typeof fetch=vi.fn(async(input,init)=>{
        expect(init?.method).not.toBe('PUT');const url=new URL(String(input));requests.push(url.toString());
        if(url.pathname.includes('/contents/')){
          expect(url.searchParams.get('ref')).toBe(sha);
          return Response.json({sha:blob,size:2*1024*1024,encoding:'none',content:''});
        }
        if(url.pathname.includes('/git/blobs/')){
          expect(url.pathname.endsWith(blob)).toBe(true);
          return Response.json({encoding:'base64',content:encode64(JSON.stringify({format:'fnt-sync-v1',book}))});
        }
        return Response.json({private:true,has_pages:false});
      });
      expect((await readComparisonCommit(config,token,commit,fetcher)).book).toEqual(book);expect(requests).toHaveLength(3);
    });
    it('lists bounded history pages and preserves recorded counts without inventing counts for other commits',async()=>{
      const requests:string[]=[],fetcher:typeof fetch=vi.fn(async(input,init)=>{
        expect(init?.method).not.toBe('PUT');const url=new URL(String(input));requests.push(url.toString());
        if(!url.pathname.endsWith('/commits'))return Response.json({private:true,has_pages:false});
        return Response.json([{sha,commit:{committer:{date:commit.time},message:commit.message}},{sha:'b'.repeat(40),commit:{committer:{date:commit.time},message:'Rename workbook JSON'}}],{headers:{Link:'<https://api.github.com/next>; rel="next"'}});
      });
      const page=await listComparisonCommits(config,token,2,fetcher);
      expect(page).toEqual({next:3,commits:[{...commit,changes:7},{sha:'b'.repeat(40),time:commit.time,message:'Rename workbook JSON'}]});
      expect(requests[1]).toContain('per_page=100&page=2');expect(requests[1]).toContain('sha=main');
    });
    it('reads the selected immutable revision across the recognized filename rename without writing or changing its connection',async()=>{
      const destination={owner:'wendyyuanlu',repo:'fnt-data',branch:'main',path:'fnt-data.json'},book=createDemo(),paths:string[]=[];
      const content=String(syncCodec({kind:'pack',value:{format:'fnt-sync-v1',book,operations:[]}}));
      const fetcher:typeof fetch=vi.fn(async(input,init)=>{
        expect(init?.method).not.toBe('PUT');const url=new URL(String(input));
        if(!url.pathname.includes('/contents/'))return Response.json({private:true,has_pages:false});
        expect(url.searchParams.get('ref')).toBe(sha);const path=url.pathname.split('/contents/')[1];paths.push(path);
        return path==='personal-workbook.json'?Response.json({encoding:'base64',content}):new Response(null,{status:404});
      });
      expect(await readComparisonCommit(destination,token,commit,fetcher)).toEqual({book,path:'personal-workbook.json'});
      expect(paths).toEqual(['fnt-data.json','personal-workbook.json']);expect(destination.path).toBe('fnt-data.json');
    });
    it('rejects malformed metadata and missing custom JSON versions rather than falling back to an unrelated workbook',async()=>{
      const invalid:typeof fetch=vi.fn(async input=>Response.json(String(input).includes('/commits?')?[{sha:'invalid'}]:{private:true,has_pages:false}));
      await expect(listComparisonCommits(config,token,1,invalid)).rejects.toThrow('invalid');
      const paths:string[]=[],missing:typeof fetch=vi.fn(async input=>{
        const url=new URL(String(input));if(!url.pathname.includes('/contents/'))return Response.json({private:true,has_pages:false});
        paths.push(url.pathname);return new Response(null,{status:404});
      });
      await expect(readComparisonCommit(config,token,commit,missing)).rejects.toThrow('does not contain');
      expect(paths).toHaveLength(1);expect(paths[0]).toContain('/contents/personal/workbook.json');
      await expect(readComparisonCommit(config,token,{...commit,sha:'bad'},missing)).rejects.toThrow('Invalid comparison commit');
    });
    it('reports damaged history payloads and permission failures without trying unrelated filenames',async()=>{
      for(const payload of [[null],[{...commit,sha:'a'.repeat(41)}]]){
        const fetcher:typeof fetch=vi.fn(async input=>Response.json(String(input).includes('/commits?')?payload:{private:true,has_pages:false}));
        await expect(listComparisonCommits(config,token,1,fetcher)).rejects.toThrow('invalid');
      }
      for(const status of [403,500]){
        let reads=0;const fetcher:typeof fetch=vi.fn(async input=>{
          if(!String(input).includes('/contents/'))return Response.json({private:true,has_pages:false});
          reads++;return new Response(null,{status});
        });
        await expect(readComparisonCommit(config,token,commit,fetcher)).rejects.toThrow(String(status));expect(reads).toBe(1);
      }
      const corrupt:typeof fetch=vi.fn(async input=>Response.json(String(input).includes('/contents/')?{encoding:'base64',content:encode64('null')}:{private:true,has_pages:false}));
      await expect(readComparisonCommit(config,token,commit,corrupt)).rejects.toThrow();
    });
  });
  it.each([{private:false,has_pages:false},{private:true,has_pages:true}])('refuses unsafe repository settings before creating a file: %j',async info=>{
    const fetcher:typeof fetch=vi.fn(async()=>Response.json(info));
    await expect(uploadComparisonSnapshot(config,token,createDemo(),'Phone',fetcher)).rejects.toThrow(/PRIVATE|Pages/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects the website source, invalid device names and incomplete listings explicitly',async()=>{
    const {fetcher}=server(),book=createDemo();
    await expect(uploadComparisonSnapshot({...config,owner:'wendyyuanlu',repo:'fnt'},token,book,'Phone',fetcher)).rejects.toThrow('website source');
    await expect(uploadComparisonSnapshot(config,token,book,'',fetcher)).rejects.toThrow('device name');
    expect(fetcher).not.toHaveBeenCalled();
    const truncated:typeof fetch=vi.fn(async input=>Response.json(String(input).includes('/git/trees/')?{tree:[],truncated:true}:{private:true,has_pages:false}));
    await expect(listComparisonSnapshots(config,token,book.id,truncated)).rejects.toThrow('incomplete');
  });
  it('retains the workbook on upload failure and never treats missing acknowledgment as success',async()=>{
    const book=createDemo(),before=JSON.stringify(book);
    for(const result of [new Response(null,{status:403}),Response.json({})]){
      const fetcher:typeof fetch=vi.fn(async(_input,init)=>init?.method==='PUT'?result:Response.json({private:true,has_pages:false}));
      await expect(uploadComparisonSnapshot(config,token,book,'Phone',fetcher)).rejects.toThrow(/failed|acknowledge/);
      expect(JSON.stringify(book)).toBe(before);
    }
  });
  it('validates selected metadata rather than loading a mismatched device copy',async()=>{
    const {fetcher,files}=server(),book=createDemo(),entry=await uploadComparisonSnapshot(config,token,book,'Phone',fetcher);
    const saved=files.get(entry.path)!,file=JSON.parse(decode64(saved.content));file.device='Other device';saved.content=encode64(JSON.stringify(file));
    await expect(readComparisonSnapshot(config,token,entry,fetcher)).rejects.toThrow('metadata');
  });
});
