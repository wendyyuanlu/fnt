import {expect,it} from 'vitest';
import {createDemo} from '../src/model';
import {loadPublishedTesting,publishedTestingId,untouchedStarter} from '../src/published';
import type {LocalState} from '../src/storage';

const starter=():LocalState=>({book:createDemo(),version:1,pending:[{id:'first',label:'Create starter workbook',time:''}],updated:''});
it('only upgrades untouched starters, never user edits, sync copies, empty journals or original archives',()=>{
  const state=starter();expect(untouchedStarter(state,0)).toBe(true);
  expect(untouchedStarter({...state,pending:[...state.pending,{id:'edit',label:'Edit workbook',time:''}]},0)).toBe(false);
  expect(untouchedStarter({...state,pending:[]},0)).toBe(false);
  expect(untouchedStarter({...state,sync:{owner:'example',repo:'data',branch:'main',path:'book.json'}},0)).toBe(false);
  expect(untouchedStarter(state,1)).toBe(false);
  const migrated={...state,pending:[...state.pending,{id:'migration',label:'Move dropdown records into DD storage',time:''},{id:'visit',label:'Visit table',time:''},{id:'page-init',label:'Initialize Master date pages',time:''}]};
  expect(untouchedStarter(migrated,0)).toBe(true);
  expect(untouchedStarter({...migrated,pending:[...migrated.pending,{id:'edit',label:'Edit cell',time:''}]},0)).toBe(false);
});
it('loads complete identity-backed testing data but rejects snapshots requiring private originals',async()=>{
  const book=createDemo(),snapshot={format:'fnt-published-testing',version:1,id:'testing',book};
  const fetcher=(async()=>new Response(JSON.stringify(snapshot))) as typeof fetch;
  expect((await loadPublishedTesting(fetcher)).book).toEqual(book);
  book.importReport={originalId:'private',entries:[],formulaCount:0,unsupported:{}};
  await expect(loadPublishedTesting(fetcher)).rejects.toThrow('private original');
});
it('reports unavailable and invalid snapshots instead of silently creating an empty demo',async()=>{
  await expect(loadPublishedTesting((async()=>new Response('',{status:404})) as typeof fetch)).rejects.toThrow('404');
  await expect(loadPublishedTesting((async()=>new Response('{}')) as typeof fetch)).rejects.toThrow('Invalid published');
});
it('checks a small published version without downloading or parsing workbook data',async()=>{
  const paths:string[]=[];
  const fetcher=(async path=>{paths.push(String(path));return new Response(JSON.stringify({format:'fnt-published-version',version:1,id:'current'}));}) as typeof fetch;
  expect(await publishedTestingId(fetcher)).toBe('current');
  expect(paths).toEqual(['./testing-workbook-version.json']);
});
it('rejects invalid version checks and publication changes rather than replacing local data',async()=>{
  await expect(publishedTestingId((async()=>new Response('',{status:503})) as typeof fetch)).rejects.toThrow('503');
  await expect(publishedTestingId((async()=>new Response('{}')) as typeof fetch)).rejects.toThrow('Invalid published testing version');
  await expect(loadPublishedTesting((async()=>new Response(JSON.stringify({format:'fnt-published-testing',version:1,id:'changed',book:createDemo()}))) as typeof fetch,'expected')).rejects.toThrow('changed while loading');
});
it('bypasses HTTP cache and refuses to treat an offline cached manifest as a verified latest revision',async()=>{
  await expect(publishedTestingId(async(_url,init)=>{
    expect(init?.cache).toBe('no-store');
    return new Response(JSON.stringify({format:'fnt-published-version',version:1,id:'old'}),{headers:{'X-Fnt-Offline-Cache':'1'}});
  })).rejects.toThrow('not a verified latest version');
});
