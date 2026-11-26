import {parseArchive} from './archive';
import {validateBackup,type Backup} from './storage';
import type {Workbook} from './model';
import {comparisonSnapshot} from './github-snapshots';
import type {ComparisonFrame,ComparisonHost} from './comparison-host';

export function comparisonBackup(contents:string):Workbook{
  const backup=parseArchive(contents) as Backup;
  if((backup as {format:string}).format==='fnt-comparison-snapshot')return comparisonSnapshot(contents);
  validateBackup(backup);
  return backup.state.book;
}

export function mountWorkbookComparison(container:HTMLElement,host:ComparisonHost):()=>void{
  const frame=document.createElement('iframe') as ComparisonFrame;
  frame.className='comparison-frame';
  frame.title='Compare versions';
  frame.comparisonHost=host;
  frame.src=new URL('./comparison.html',document.baseURI).href;
  container.append(frame);
  return()=>{
    delete frame.comparisonHost;
    frame.remove();
  };
}
