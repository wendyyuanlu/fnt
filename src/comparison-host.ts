import type {Workbook} from './model';
import type {ComparisonSnapshot} from './github-snapshots';
import type {ComparisonChoice} from './comparison-merge';

export interface ComparisonSource {
  book:Workbook;
  kind:string;
  label:string;
  freshness?:string;
  revision?:string;
}
export interface ComparisonHost {
  local:ComparisonSource;
  remote?:ComparisonSource;
  readRemote?:()=>Promise<ComparisonSource>;
  uploads?:{
    list:(workbook:string)=>Promise<ComparisonSnapshot[]>;
    read:(entry:ComparisonSnapshot)=>Promise<ComparisonSource>;
  };
  syncDestination?:()=>string|undefined;
  apply?:(request:{left:Workbook;right:Workbook;choices:ComparisonChoice[];sync:boolean;progress?:(message:string,completed:number,total:number)=>void})=>Promise<void>;
  close:()=>void;
}
export interface ComparisonFrame extends HTMLIFrameElement {
  comparisonHost?:ComparisonHost;
}
