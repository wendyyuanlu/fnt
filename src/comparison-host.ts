import type {Workbook} from './model';
import type {ComparisonSnapshot} from './github-snapshots';

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
  close:()=>void;
}
export interface ComparisonFrame extends HTMLIFrameElement {
  comparisonHost?:ComparisonHost;
}
