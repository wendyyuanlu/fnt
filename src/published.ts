import {parseArchive} from './archive';
import {validateBook,type LocalState} from './storage';
import type {Workbook} from './model';

export interface PublishedTestingWorkbook {format:'fnt-published-testing';version:1;id:string;book:Workbook}
export async function loadPublishedTesting(fetcher:typeof fetch=fetch):Promise<PublishedTestingWorkbook>{
  const response=await fetcher('./testing-workbook.json',{cache:'no-cache'});
  if(!response.ok)throw Error(`Published testing workbook could not be loaded (${response.status}).`);
  const value=parseArchive(await response.text());
  if(!value||typeof value!=='object'||!('format'in value)||value.format!=='fnt-published-testing'||!('version'in value)||value.version!==1||!('id'in value)||typeof value.id!=='string'||!value.id||!('book'in value))throw Error('Invalid published testing workbook.');
  validateBook(value.book);
  if(value.book.importReport||value.book.references?.some(source=>source.origin))throw Error('Published testing data must not require private original attachments.');
  return {format:'fnt-published-testing',version:1,id:value.id,book:value.book};
}
export function untouchedStarter(state:LocalState,originals:number):boolean{
  const labels=new Set(['Create starter workbook','Create starter workbook with original Dropdowns catalogs','Add original Dropdowns catalogs','Load published testing workbook']);
  return !state.sync&&originals===0&&state.pending.length>0&&state.pending.every(p=>labels.has(p.label));
}
