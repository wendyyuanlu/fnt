import 'fake-indexeddb/auto';
import {describe,expect,it} from 'vitest';
import {captureData} from '../src/food-capture';
import {decodePhotoArchives,inspectPhoto,photoByteLimit,validatePhotoArchives} from '../src/food-photos';
import {createDemo,uid} from '../src/model';
import {Store,validateBackup} from '../src/storage';
import {capturePatch} from '../src/undo-history';
import {parseArchive} from '../src/archive';
import type {Backup} from '../src/storage';

const image=(last=0)=>new Blob([new Uint8Array([137,80,78,71,13,10,26,10,last])],{type:'image/png'});
describe.each([1,2,3])('independent photo persistence, repetition %i',()=>{
  it('commits photo originals atomically with a replacement or journal and independent Undo',async()=>{
    const store=await Store.open(uid());
    try{
      const book=createDemo(),first=await inspectPhoto(uid(),image()),second=await inspectPhoto(uid(),image(1));
      const metadata=(photo:typeof first)=>({id:photo.id,name:'Invented.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      captureData(book).photos.push(metadata(first));
      const saved=await store.save(book,0,'Add first photo',false,undefined,{photos:[first]});
      expect(await store.photo(first.id,first)).toEqual(first);
      const inverse=capturePatch(book,[['foodCapture','photos']]);
      captureData(book).photos.push(metadata(second));book.revision++;
      const history={undo:[inverse],redo:[]},receipt=await store.saveChanges(book.id,book.revision,saved.version,'Attach second photo',[capturePatch(book,[['foodCapture','photos']])],history,[second]);
      expect((await store.load())!.book).toEqual(book);expect(await store.photo(second.id,second)).toEqual(second);
      expect(await store.undoHistory(receipt.version,book.id)).toEqual(history);
      expect(JSON.stringify(await store.undoHistory(receipt.version,book.id))).not.toContain('"blob"');
    }finally{store.close();}
  });
  it('inserts neither a stale photo nor its metadata and preserves both on an identity collision',async()=>{
    const store=await Store.open(uid());
    try{
      const book=createDemo(),initial=await store.save(book,0,'Initial'),photo=await inspectPhoto(uid(),image());
      const incoming=structuredClone(book);
      captureData(incoming).photos.push({id:photo.id,name:'Synthetic.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      const history={undo:[],redo:[]},forward=[capturePatch(incoming,[['foodCapture']])];
      await expect(store.saveChanges(book.id,book.revision,0,'Stale journal',forward,history,[photo])).rejects.toThrow('Another tab');
      await expect(store.photo(photo.id)).rejects.toThrow('not stored');
      await expect(store.save(incoming,0,'Stale replacement',false,undefined,{photos:[photo]})).rejects.toThrow('Another tab');
      await expect(store.photo(photo.id)).rejects.toThrow('not stored');
      expect(await store.load()).toEqual(initial);
      const existing=await inspectPhoto(photo.id,image(2));await store.putPhoto(existing);
      await expect(store.saveChanges(book.id,book.revision,initial.version,'Collision journal',forward,history,[photo])).rejects.toThrow('different photo');
      await expect(store.save(incoming,initial.version,'Collision replacement',false,undefined,{photos:[photo]})).rejects.toThrow('different photo');
      expect(await store.load()).toEqual(initial);expect(await store.photo(photo.id,existing)).toEqual(existing);
      expect(await store.history()).toEqual([]);expect(await store.undoHistory(initial.version,book.id)).toBeUndefined();
    }finally{store.close();}
  });
  it('includes queued unsaved originals in an emergency backup without claiming they are durable',async()=>{
    const store=await Store.open(uid());
    try{
      const state=await store.save(createDemo(),0,'Initial'),photo=await inspectPhoto(uid(),image());
      captureData(state.book).photos.push({id:photo.id,name:'Pending camera.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      const backup=await store.backup(state,[photo]);
      expect(backup.photos).toHaveLength(1);expect(backup.missingPhotos).toEqual([]);
      expect(await decodePhotoArchives(backup.photos!)).toEqual([photo]);
      await expect(store.photo(photo.id)).rejects.toThrow('not stored');
      expect((await store.load())!.book.foodCapture?.photos??[]).toEqual([]);
    }finally{store.close();}
  });
  it('restores referenced originals atomically at the exact saved version without changing workbook or Undo',async()=>{
    const store=await Store.open(uid());
    try{
      const book=createDemo(),first=await inspectPhoto(uid(),image()),second=await inspectPhoto(uid(),image(1));
      captureData(book).photos.push(...[first,second].map(photo=>({id:photo.id,name:'Remote.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes})));
      const state=await store.save(book,0,'Remote references',false,undefined,{undoHistory:{undo:[],redo:[]}});
      await expect(store.restorePhotoOriginals(book.id,0,[first,second])).rejects.toThrow('Another tab');
      await expect(store.photo(first.id)).rejects.toThrow('not stored');
      const unknown=await inspectPhoto(uid(),image(2));
      await expect(store.restorePhotoOriginals(book.id,state.version,[first,unknown])).rejects.toThrow('reference changed');
      await expect(store.photo(first.id)).rejects.toThrow('not stored');
      await store.restorePhotoOriginals(book.id,state.version,[first,second]);
      expect(await store.photo(first.id,first)).toEqual(first);expect(await store.photo(second.id,second)).toEqual(second);
      expect(await store.load()).toEqual(state);expect(await store.undoHistory(state.version,book.id)).toEqual({undo:[],redo:[]});expect(await store.history()).toEqual([]);
    }finally{store.close();}
  });
  it('backs up and restores bytes outside workbook/journal data with verified metadata',async()=>{
    const source=await Store.open(uid()),destination=await Store.open(uid());
    try{
      const book=createDemo(),photo=await inspectPhoto(uid(),image());
      captureData(book).photos.push({id:photo.id,name:'Invented label.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      await source.putPhoto(photo);const state=await source.save(book,0,'Add synthetic photo');
      const backup=await source.backup(state);expect(backup.photos).toHaveLength(1);expect(backup.missingPhotos).toEqual([]);
      expect(()=>validateBackup(backup)).not.toThrow();expect(JSON.stringify(state.book)).not.toContain(backup.photos![0].data);
      expect(await source.photo(photo.id,photo)).toEqual(photo);
      const initial=await destination.save(createDemo(),0,'Initial'),restored=await destination.restore(backup,initial.version);
      expect(restored.book).toEqual(book);expect(await destination.photo(photo.id,photo)).toEqual(photo);
      expect(await source.undoHistory(state.version,book.id)).toBeUndefined();
    }finally{source.close();destination.close();}
  });
  it('validates a maximum-size archive without recursive regular-expression backtracking',()=>{
    expect(()=>validatePhotoArchives([{id:uid(),mime:'image/png',bytes:photoByteLimit,digest:'a'.repeat(64),data:'A'.repeat(4*Math.ceil(photoByteLimit/3))}])).not.toThrow();
  });
  it('includes previous originals in the independently downloadable pre-restore archive',async()=>{
    const source=await Store.open(uid()),destination=await Store.open(uid());
    try{
      const photo=await inspectPhoto(uid(),image()),book=createDemo();
      captureData(book).photos.push({id:photo.id,name:'Before restore.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      const state=await destination.save(book,0,'Previous photo',false,undefined,{photos:[photo]});
      const incoming=await source.save(createDemo(),0,'Incoming workbook');
      await destination.restore(await source.backup(incoming),state.version);
      const checkpoint=(await destination.history()).find(entry=>entry.label==='Before backup restore')!;
      const recovery=parseArchive(checkpoint.backup!) as Backup;
      expect(()=>validateBackup(recovery)).not.toThrow();expect(recovery.state.book).toEqual(book);
      expect(await decodePhotoArchives(recovery.photos!)).toEqual([photo]);expect(recovery.missingPhotos).toEqual([]);
    }finally{source.close();destination.close();}
  });
  it('preserves state and recovery blobs when a restore has corrupt bytes or a conflicting identity',async()=>{
    const source=await Store.open(uid()),destination=await Store.open(uid());
    try{
      const id=uid(),original=await inspectPhoto(id,image()),other=await inspectPhoto(id,image(1));
      const book=createDemo();captureData(book).photos.push({id,name:'Synthetic.png',date:45000,digest:other.digest,mime:other.mime,bytes:other.bytes});
      await source.putPhoto(other);const saved=await source.save(book,0,'Incoming'),backup=await source.backup(saved);
      const before=await destination.save(createDemo(),0,'Keep local');await destination.putPhoto(original);
      await expect(destination.restore(backup,before.version)).rejects.toThrow('identity conflicts');
      expect(await destination.load()).toEqual(before);expect(await destination.photo(id,original)).toEqual(original);
      const damaged=structuredClone(backup);damaged.photos![0].digest=original.digest;damaged.state.book.foodCapture!.photos[0].digest=original.digest;
      await expect(destination.restore(damaged,before.version)).rejects.toThrow('checksum mismatch');
      expect(await destination.load()).toEqual(before);expect(await destination.history()).toEqual([]);
      await expect(destination.putPhoto(other)).rejects.toThrow('different photo');
    }finally{source.close();destination.close();}
  });
  it('records unavailable remote references explicitly and refuses stale restores without inserting photos',async()=>{
    const source=await Store.open(uid()),destination=await Store.open(uid());
    try{
      const photo=await inspectPhoto(uid(),image()),book=createDemo();
      captureData(book).photos.push({id:photo.id,name:'Remote.png',date:45000,digest:photo.digest,mime:photo.mime,bytes:photo.bytes});
      let state=await source.save(book,0,'Remote metadata only');const incomplete=await source.backup(state);
      expect(incomplete.photos).toEqual([]);expect(incomplete.missingPhotos).toEqual([photo.id]);
      await expect(source.photo(photo.id,photo)).rejects.toThrow('not stored on this device');
      await source.putPhoto(photo);const complete=await source.backup(state),initial=await destination.save(createDemo(),0,'Initial');
      await destination.save(initial.book,initial.version,'Other tab changed');
      await expect(destination.restore(complete,initial.version)).rejects.toThrow('Another tab');
      await expect(destination.photo(photo.id)).rejects.toThrow('not stored');
      state=(await source.load())!;expect(state.book.foodCapture!.photos[0].digest).toBe(photo.digest);
    }finally{source.close();destination.close();}
  });
  it('rejects unsupported, empty, mislabeled and damaged photo archive content before publication',async()=>{
    await expect(inspectPhoto(uid(),new Blob(['not a photo'],{type:'image/svg+xml'}))).rejects.toThrow('JPEG');
    await expect(inspectPhoto(uid(),new Blob([],{type:'image/png'}))).rejects.toThrow('nonempty');
    await expect(inspectPhoto(uid(),new Blob(['not a PNG'],{type:'image/png'}))).rejects.toThrow('contents');
    expect(()=>validatePhotoArchives([{id:uid(),mime:'image/png',bytes:1,digest:'a'.repeat(64),data:'!!!!'}])).toThrow('archive entry');
    await expect(decodePhotoArchives([{id:uid(),mime:'image/png',bytes:1,digest:'a'.repeat(64),data:'YQ=='}])).rejects.toThrow('contents');
  });
});
