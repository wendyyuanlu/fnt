import type {Workbook} from './model';
import type {ComparisonSnapshot,ComparisonCommit,ComparisonCommitPage} from './github-snapshots';
import type {ComparisonChoice} from './comparison-merge';

export interface ComparisonSource {
  book:Workbook;
  kind:string;
  label:string;
  freshness?:string;
  revision?:string;
}
export interface ComparisonReviewView {
  choices:{key:string;side:'left'|'right'}[];
  history:{key:string;side:'left'|'right'}[][];
  scope?:string;
  category:'all'|'value'|'structure';
  specific:string;
  region:number;
  selected?:string;
  focus?:{key:string;row?:string;column?:string};
  context:string;
  firstCell:boolean;
  linked:boolean;
  choiceScope:string;
  keepScope:string;
  latest:('left'|'right')[];
  uploads:Partial<Record<'left'|'right',string>>;
}
export interface ComparisonReview {
  left:ComparisonSource;
  right?:ComparisonSource;
  view?:ComparisonReviewView;
}
export interface StoredComparisonReview extends ComparisonReview {
  baseRevision:number;
  sync?:{config:import('./storage').SyncConfig;path:string;sha:string};
}
export interface ComparisonHost {
  local:ComparisonSource;
  remote?:ComparisonSource;
  readRemote?:()=>Promise<ComparisonSource>;
  connection?:{connected:()=>boolean;connect:()=>Promise<boolean>};
  uploads?:{
    list:(workbook:string)=>Promise<ComparisonSnapshot[]>;
    read:(entry:ComparisonSnapshot)=>Promise<ComparisonSource>;
    delete?:(entry:ComparisonSnapshot)=>Promise<void>;
  };
  commits?:{
    list:(page:number)=>Promise<ComparisonCommitPage>;
    read:(entry:ComparisonCommit)=>Promise<ComparisonSource>;
  };
  syncDestination?:()=>string|undefined;
  review?:{
    load:()=>Promise<ComparisonReview|undefined>;
    save:(review:ComparisonReview)=>Promise<void>;
  };
  apply?:(request:{left:Workbook;right:Workbook;choices:ComparisonChoice[];sync:boolean;progress?:(message:string,completed:number,total:number)=>void})=>Promise<void>;
  close:()=>void;
}
export interface ComparisonFrame extends HTMLIFrameElement {
  comparisonHost?:ComparisonHost;
}
