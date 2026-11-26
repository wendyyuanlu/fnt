import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDemo} from '../src/model';
import {decode64,encode64,type SyncConfig} from '../src/storage';
import {uploadComparisonSnapshot,listComparisonSnapshots,readComparisonSnapshot,comparisonSnapshot} from '../src/github-snapshots';

const config:SyncConfig={owner:'example',repo:'private-data',branch:'main',path:'personal/workbook.json'};
const token='invented-restricted-token';
afterEach(()=>vi.useRealTimers());
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
