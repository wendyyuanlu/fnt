import {describe,expect,it,vi} from 'vitest';
import {bytes64} from '../src/archive';
import {inspectPhoto} from '../src/food-photos';
import {downloadPrivatePhoto,listPrivatePhotos,PhotoGalleryConflict,uploadPrivatePhoto} from '../src/github-photos';
import {uid} from '../src/model';
import type {SyncConfig} from '../src/storage';

const config:SyncConfig={owner:'synthetic',repo:'private-photo-data',branch:'main',path:'gallery/index.json'},token='invented-token';
async function photo(last=0){
  const blob=new Blob([new Uint8Array([137,80,78,71,13,10,26,10,last])],{type:'image/png'}),file=await inspectPhoto(uid(),blob);
  return{file,metadata:{id:file.id,digest:file.digest,mime:file.mime,bytes:file.bytes,name:'Synthetic photo.png',date:45000}};
}
function server(){
  const files=new Map<string,{sha:string;content:string}>(),writes:string[]=[];let revision=0;
  const settings={private:true,pages:false,conflict:false,unconfirmed:false};
  const fetcher:typeof fetch=vi.fn(async(input,init)=>{
    const url=new URL(String(input)),path=decodeURIComponent(url.pathname.split('/contents/')[1]??'');
    if(!url.pathname.includes('/contents/'))return Response.json({private:settings.private,has_pages:settings.pages});
    if(init?.method==='PUT'){
      const body=JSON.parse(String(init.body)) as {content:string;sha?:string};
      writes.push(path);
      if(path===config.path&&settings.conflict){settings.conflict=false;return new Response(null,{status:409});}
      if(files.get(path)?.sha!==body.sha)return new Response(null,{status:409});
      const sha=(++revision).toString(16).padStart(40,'0');files.set(path,{sha,content:body.content});
      if(path===config.path&&settings.unconfirmed){settings.unconfirmed=false;return Response.json({});}
      return Response.json({content:{sha}});
    }
    const file=files.get(path);return file?Response.json({...file,encoding:'base64',size:Buffer.from(file.content,'base64').length}):new Response(null,{status:404});
  });
  return{files,writes,fetcher,settings};
}
describe.each([1,2,3])('private gallery transfers, repetition %i',()=>{
  it('uploads originals separately from metadata and verifies download and idempotent retry',async()=>{
    const remote=server(),{file,metadata}=await photo();
    remote.files.set('workbook.json',{sha:'a'.repeat(40),content:'untouched'});
    const saved=await uploadPrivatePhoto(config,token,metadata,file.blob,remote.fetcher);
    expect(saved.photos).toHaveLength(1);expect(remote.writes).toHaveLength(2);
    expect(saved.photos[0].path).toBe(`gallery/fnt-photos/${file.digest}.png`);
    expect((await downloadPrivatePhoto(config,token,saved.photos[0],remote.fetcher)).blob).toEqual(file.blob);
    expect(await listPrivatePhotos(config,token,remote.fetcher)).toEqual(saved);
    expect(await uploadPrivatePhoto(config,token,metadata,file.blob,remote.fetcher)).toEqual(saved);
    expect(remote.writes).toHaveLength(2);expect(remote.files.get('workbook.json')!.content).toBe('untouched');
    const manifest=Buffer.from(remote.files.get(config.path)!.content,'base64').toString();
    expect(manifest).not.toContain(token);expect(manifest).not.toContain(bytes64(new Uint8Array(await file.blob.arrayBuffer())));
  });
  it('preserves uploaded originals after index conflicts and verifies uncertain acknowledgments before retry',async()=>{
    for(const kind of ['conflict','unconfirmed'] as const){
      const remote=server(),{file,metadata}=await photo();remote.settings[kind]=true;
      await expect(uploadPrivatePhoto(config,token,metadata,file.blob,remote.fetcher)).rejects.toThrow(kind==='conflict'?'changed during transfer':'did not confirm');
      expect(remote.files.has(`gallery/fnt-photos/${file.digest}.png`)).toBe(true);
      const confirmed=await uploadPrivatePhoto(config,token,metadata,file.blob,remote.fetcher);
      expect(confirmed.photos).toHaveLength(1);
      expect(remote.writes.filter(path=>path.endsWith('.png'))).toHaveLength(1);
      expect(remote.writes.filter(path=>path===config.path)).toHaveLength(kind==='conflict'?2:1);
    }
  });
  it('requires explicit matching metadata replacement and never overwrites a conflicting identity',async()=>{
    const remote=server(),{file,metadata}=await photo();
    await uploadPrivatePhoto(config,token,metadata,file.blob,remote.fetcher);
    await expect(uploadPrivatePhoto(config,token,{...metadata,name:'Renamed locally.png'},file.blob,remote.fetcher)).rejects.toBeInstanceOf(PhotoGalleryConflict);
    expect(remote.writes).toHaveLength(2);
    await expect(uploadPrivatePhoto(config,token,{...metadata,name:'Renamed locally.png'},file.blob,remote.fetcher,{name:'Stale other name',date:metadata.date})).rejects.toBeInstanceOf(PhotoGalleryConflict);
    const next=await uploadPrivatePhoto(config,token,{...metadata,name:'Renamed locally.png'},file.blob,remote.fetcher,metadata);
    expect(next.photos[0].name).toBe('Renamed locally.png');expect(remote.writes).toHaveLength(3);
    const other=await photo(1);
    await expect(uploadPrivatePhoto(config,token,{...other.metadata,id:metadata.id},other.file.blob,remote.fetcher)).rejects.toThrow('different photo');
    expect(remote.writes).toHaveLength(3);
  });
  it('blocks public, Pages and source repositories and refuses unrelated or corrupt destination files',async()=>{
    const {file,metadata}=await photo();
    for(const unsafe of ['public','pages','source']){
      const remote=server();if(unsafe==='public')remote.settings.private=false;if(unsafe==='pages')remote.settings.pages=true;
      await expect(uploadPrivatePhoto(unsafe==='source'?{...config,owner:'wendyyuanlu',repo:'fnt'}:config,token,metadata,file.blob,remote.fetcher)).rejects.toThrow(/PRIVATE|Pages|source/);
      expect(remote.writes).toEqual([]);
    }
    const remote=server();remote.files.set(config.path,{sha:'b'.repeat(40),content:Buffer.from('{"format":"fnt-sync-v1","book":{"private":"unchanged"}}').toString('base64')});
    await expect(uploadPrivatePhoto(config,token,metadata,file.blob,remote.fetcher)).rejects.toThrow('not a supported');
    expect(remote.writes).toEqual([]);
    remote.files.delete(config.path);
    const other=await photo(2);remote.files.set(`gallery/fnt-photos/${file.digest}.png`,{sha:'c'.repeat(40),content:bytes64(new Uint8Array(await other.file.blob.arrayBuffer()))});
    await expect(uploadPrivatePhoto(config,token,metadata,file.blob,remote.fetcher)).rejects.toThrow('checksum mismatch');
    expect(remote.writes).toEqual([]);
  });
});
