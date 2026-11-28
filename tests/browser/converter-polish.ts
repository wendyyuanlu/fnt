import '../../src/style.css';
import '../../src/meal-log.css';
import {clone,type Workbook} from '../../src/model';
import {newConverterState,validateConverterState,type ConverterState} from '../../src/nutrition-converter';
import {converterSignature,prepareNutritionApply,type ConverterReceipt} from '../../src/nutrition-apply';
import {converterReview} from '../../src/nutrition-converter';
import {prepareStandaloneImport,standaloneReview,standaloneSignature,type StandaloneReceipt} from '../../src/nutrition-converter-import';
import {mountConverterPanel} from '../../src/nutrition-converter-ui';
import {syntheticConverterBook} from '../converter-polish-fixture';
interface Saved{book:Workbook;converter:ConverterState;receipts:ConverterReceipt[];imports:StandaloneReceipt[]}
const storageKey='fnt-converter-polish-synthetic-v1',saved=localStorage.getItem(storageKey);
const fresh=():Saved=>{const book=syntheticConverterBook(new URLSearchParams(location.search).has('linked-only'));return{book,converter:newConverterState(book.foodCapture!.builder!.id),receipts:[],imports:[]};};
let current:Saved=saved?JSON.parse(saved):fresh(),undo:Saved|undefined;
let fail=false,stagedFailure=false,delay=0,stagedApply=false,applyCalls=0,importCalls=0;
const durable=async()=>{
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  if(fail)throw Error('Synthetic persistence failure');
  localStorage.setItem(storageKey,JSON.stringify(current));
};
const tracked=(state:ConverterState)=>{const{mode,standalone,...payload}=state;return payload;};
const panel=mountConverterPanel({
  book:()=>current.book,state:()=>current.converter,receipts:()=>current.receipts,imports:()=>current.imports,sourceVersion:()=>current.book.revision,
  stage:next=>{
    validateConverterState(next);
    if(stagedFailure)throw Error('Synthetic staging failure');
    if(next.batch!==current.converter.batch)throw Error('Stale synthetic batch');
    if(current.converter.status==='applied'&&JSON.stringify(tracked(next))!==JSON.stringify(tracked(current.converter)))throw Error('Tracked review is already applied.');
    current.converter=clone(next);
  },
  change:async()=>{await durable();},
  apply:async review=>{
    applyCalls++;
    if(converterSignature(converterReview(current.converter))!==converterSignature(review))throw Error('Saved synthetic review changed');
    const prepared=prepareNutritionApply(current.book,current.book.foodCapture!.builder!,review,current.receipts);
    if(prepared.alreadyApplied)return prepared.receipt;
    const before=clone(current),next={...current,book:prepared.book,converter:{...clone(current.converter),status:'applied' as const},receipts:[...current.receipts,prepared.receipt]};
    next.book.revision++;
    if(!stagedApply&&fail)throw Error('Synthetic persistence failure before publish');
    current=next;undo=before;await durable();return prepared.receipt;
  },
  applyImport:async review=>{
    importCalls++;
    if(standaloneSignature(standaloneReview(current.converter.standalone!))!==standaloneSignature(review))throw Error('Saved synthetic standalone review changed');
    const prepared=prepareStandaloneImport(current.book,review,current.imports);
    if(prepared.alreadyApplied)return prepared.receipt;
    const before=clone(current),next={...current,book:prepared.book,converter:{...clone(current.converter),standalone:{...clone(current.converter.standalone!),status:'applied' as const}},imports:[...current.imports,prepared.receipt]};
    next.book.revision++;
    if(!stagedApply&&fail)throw Error('Synthetic persistence failure before publish');
    current=next;undo=before;await durable();return prepared.receipt;
  },error:()=>{},
});
const root=document.querySelector<HTMLElement>('#converter-root')!;
const touch=new URLSearchParams(location.search).get('touch');
document.documentElement.classList.toggle('touch-input-device',touch===null?navigator.maxTouchPoints>0:touch==='1');
const heading=document.createElement('header');heading.style.cssText='padding:10px 12px;border-bottom:1px solid var(--line);font-size:12px';
heading.textContent='Converter polish - work in progress. Disposable synthetic data only; shared panel shell is integrated separately.';
heading.hidden=new URLSearchParams(location.search).get('embedded')==='1';
root.append(heading,panel.element);
declare global{interface Window{converterPolish:{
  read:()=>Saved;reset:()=>Promise<void>;fail:(value:boolean)=>void;stageFailure:(value:boolean)=>void;
  delay:(value:number)=>void;stagedApply:(value:boolean)=>void;counts:()=>{applyCalls:number;importCalls:number};undo:()=>Promise<void>;sourceChanged:()=>void;
}}}
window.converterPolish={read:()=>clone(current),reset:async()=>{current=fresh();undo=undefined;fail=false;stagedFailure=false;stagedApply=false;delay=0;applyCalls=0;importCalls=0;await durable();panel.refresh();},
  fail:value=>{fail=value;},stageFailure:value=>{stagedFailure=value;},delay:value=>{delay=value;},stagedApply:value=>{stagedApply=value;},counts:()=>({applyCalls,importCalls}),
  undo:async()=>{if(!undo)throw Error('No synthetic operation to undo');current=undo;undo=undefined;await durable();panel.refresh();},sourceChanged:()=>{current.book.revision++;panel.refresh();}};
await durable();
