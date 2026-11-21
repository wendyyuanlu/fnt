import {expect,it} from 'vitest';
import {createDemo} from '../src/model';
import {loadPublishedTesting,untouchedStarter} from '../src/published';
import type {LocalState} from '../src/storage';

const starter=():LocalState=>({book:createDemo(),version:1,pending:[{id:'first',label:'Create starter workbook',time:''}],updated:''});
it('only upgrades untouched starters, never user edits, sync copies, empty journals or original archives',()=>{
  const state=starter();expect(untouchedStarter(state,0)).toBe(true);
  expect(untouchedStarter({...state,pending:[...state.pending,{id:'edit',label:'Edit workbook',time:''}]},0)).toBe(false);
  expect(untouchedStarter({...state,pending:[]},0)).toBe(false);
  expect(untouchedStarter({...state,sync:{owner:'example',repo:'data',branch:'main',path:'book.json'}},0)).toBe(false);
  expect(untouchedStarter(state,1)).toBe(false);
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
