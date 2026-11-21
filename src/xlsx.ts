import { strFromU8, unzipSync } from 'fflate';
import { compile, maySpill, supportedFunctions } from './formula';
import { blankSheet, columnIndex, fault, key, translate, uid, type Format, type Sheet, type Workbook } from './model';
import { inspectNative,readNativeBackup } from './xlsx-native';
import type { Backup } from './storage';

const elements = (node: Document | Element, name: string) => [...node.getElementsByTagNameNS('*',name)];
const first = (node: Document | Element, name: string) => elements(node,name)[0];
const value = (node: Document | Element, name: string) => first(node,name)?.textContent ?? '';
const attr = (node: Element, name: string) => node.getAttribute(name) ?? '';
const builtInFormats:Record<number,string>={1:'0',2:'0.00',3:'#,##0',4:'#,##0.00',9:'0%',10:'0.00%',11:'0.00E+00',12:'# ?/?',13:'# ??/??',14:'mm-dd-yy',15:'d-mmm-yy',16:'d-mmm',17:'mmm-yy',18:'h:mm AM/PM',19:'h:mm:ss AM/PM',20:'h:mm',21:'h:mm:ss',22:'m/d/yy h:mm',37:'#,##0 ;(#,##0)',38:'#,##0 ;[Red](#,##0)',39:'#,##0.00;(#,##0.00)',40:'#,##0.00;[Red](#,##0.00)',45:'mm:ss',46:'[h]:mm:ss',47:'mmss.0',48:'##0.0E+0',49:'@'};
export const decodeExcelText=(text:string):string=>text.replace(/_x([0-9a-f]{4})_/gi,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)));
function address(text: string): {r:number;c:number} {
  const m=text.replace(/\$/g,'').match(/^([A-Z]+)(\d+)$/i);
  if(!m)throw Error('Invalid XLSX cell address.');
  return {r:Number(m[2])-1,c:columnIndex(m[1])};
}
function range(text:string):{r1:number;r2:number;c1:number;c2:number} {
  const [a,b]=text.split(':'),start=address(a),end=address(b??a);
  return{r1:start.r,r2:end.r,c1:start.c,c2:end.c};
}
function resolve(base:string,target:string):string {
  const parts=(target.startsWith('/')?target.slice(1):base.slice(0,base.lastIndexOf('/')+1)+target).split('/'),out:string[]=[];
  for(const p of parts){if(p==='..')out.pop();else if(p&&p!=='.')out.push(p);}return out.join('/');
}
function base64(bytes:Uint8Array):string {
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);
}
function unpack(buffer:ArrayBuffer) {
  if(buffer.byteLength>30*1048576)throw Error('Review-build import limit is 30 MB. Original file was not changed.');
  let inflated=0;
  const entries=unzipSync(new Uint8Array(buffer),{filter:file=>{
    inflated+=file.originalSize;
    if(inflated>180*1048576)throw Error('Uncompressed workbook exceeds the safe import limit.');
    return true;
  }});
  return {entries,remaining:180*1048576-inflated};
}
export async function recoverXlsxBackup(buffer:ArrayBuffer):Promise<Backup> {
  const {entries,remaining}=unpack(buffer);return readNativeBackup(entries,remaining);
}
export async function importXlsx(buffer:ArrayBuffer,name:string,options?:{sheets:string[]}):Promise<{book:Workbook;original:{id:string;name:string;data:string};nativeBackup?:Backup}> {
  const {entries,remaining}=unpack(buffer),native=await inspectNative(entries,remaining);
  if(native.backup){
    const original=native.backup.originals.find(o=>o.id===native.backup!.state.book.importReport?.originalId)??{id:uid(),name,data:base64(new Uint8Array(buffer))};
    return {book:native.backup.state.book,original,nativeBackup:native.backup};
  }
  const xml=(path:string):Document=>{
    const raw=entries[path];if(!raw)throw Error(`Missing XLSX package part: ${path}`);
    const doc=new DOMParser().parseFromString(strFromU8(raw),'application/xml');
    if(elements(doc,'parsererror').length)throw Error(`Invalid XML in ${path}`);return doc;
  };
  const rels=(path:string):Map<string,{target:string;external:boolean}>=>{
    const relPath=path.slice(0,path.lastIndexOf('/')+1)+'_rels/'+path.slice(path.lastIndexOf('/')+1)+'.rels';
    if(!entries[relPath])return new Map();
    return new Map(elements(xml(relPath),'Relationship').map(r=>[attr(r,'Id'),{target:attr(r,'TargetMode')==='External'?attr(r,'Target'):resolve(path,attr(r,'Target')),external:attr(r,'TargetMode')==='External'}]));
  };
  const wbPath='xl/workbook.xml',wb=xml(wbPath),wbRels=rels(wbPath);
  const shared=entries['xl/sharedStrings.xml']?elements(xml('xl/sharedStrings.xml'),'si').map(si=>decodeExcelText(elements(si,'t').map(t=>t.textContent??'').join(''))):[];
  const formats:Format[]=[];
  if(entries['xl/styles.xml']){
    const styles=xml('xl/styles.xml'),fonts=first(styles,'fonts')?.children??[],fills=first(styles,'fills')?.children??[];
    const custom=new Map(elements(styles,'numFmt').map(n=>[Number(attr(n,'numFmtId')),attr(n,'formatCode')]));
    for(const xf of first(styles,'cellXfs')?.children??[]){
      const font=fonts[Number(attr(xf,'fontId'))],fill=fills[Number(attr(xf,'fillId'))],num=Number(attr(xf,'numFmtId')),code=custom.get(num)??builtInFormats[num]??'';
      const tokens=code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g,'');
      const rgb=font?first(font,'color')?.getAttribute('rgb'):null,bg=fill?first(fill,'fgColor')?.getAttribute('rgb'):null;
      formats.push({bold:font?elements(font,'b').length>0:false,underline:font?elements(font,'u').length>0:false,wrap:first(xf,'alignment')?.getAttribute('wrapText')==='1',
        ...(font&&first(font,'i')&&!['0','false'].includes(first(font,'i')!.getAttribute('val')??'')?{italic:true}:{}),
        ...(font&&first(font,'strike')&&!['0','false'].includes(first(font,'strike')!.getAttribute('val')??'')?{strikethrough:true}:{}),
        ...(rgb?{color:'#'+rgb.slice(-6)}:{}),...(bg?{background:'#'+bg.slice(-6)}:{}),
        ...(code?{excelNumberFormat:code}:{}),
        number:([14,15,16,17,18,19,20,21,22].includes(num)||/[ydhs]/i.test(tokens))?'date':[9,10].includes(num)||tokens.includes('%')?'percent':[2,4].includes(num)||/^0\.00$/.test(tokens)?'decimal':''});
    }
  }
  const book:Workbook={schema:1,id:uid(),title:name.replace(/\.xlsx$/i,''),revision:0,sheets:[],tables:[],names:[],pickerSources:{}};
  const originalId=uid(),report={entries:[] as string[],formulaCount:0,unsupported:{} as Record<string,number>,originalId};
  report.entries.push('No intact native archive was restored. Excel projection import assigns new identities. Exact record bindings, pending edits and app-only metadata require the embedded snapshot or an independent native backup.');
  if(native.status==='changed')report.entries.push('External Excel/package edits detected. The edited Excel projection was imported with new identities, not overwritten by its stale embedded Fnt snapshot. To deliberately recover the older snapshot, use File > Recover embedded Fnt snapshot with the exported file. This discards external Excel edits, and creates a pre-restore recovery copy.');
  if(native.status==='missing')report.entries.push('An exported Fnt recovery archive was removed by another application. Only the Excel projection can be imported; app-only IDs/bindings require an independent native backup.');
  const definitions:{sheet:Sheet;doc:Document;path:string}[]=[],formulas:{sheet:Sheet;row:number;col:number;source:string;shared?:string}[]=[],arrayRanges:{sheet:Sheet;ref:string;row:number;col:number}[]=[];
  const sheetNodes=elements(wb,'sheet');
  if(!sheetNodes.length)throw Error('Workbook has no worksheets.');
  if(first(wb,'workbookPr')?.getAttribute('date1904')==='1')throw Error('1904 date-system workbooks are not supported yet. Import cancelled without changing the current workbook.');
  for(const node of sheetNodes){
    const rel=wbRels.get(attr(node,'r:id')),path=rel?.target;if(!path)throw Error('Worksheet relationship is missing.');
    const doc=xml(path),cells=elements(doc,'c'),included=!options||options.sheets.some(name=>name.toLowerCase()===attr(node,'name').toLowerCase());let maxRow=99,maxCol=19;
    for(const cell of cells){const a=address(attr(cell,'r'));maxRow=Math.max(maxRow,a.r);maxCol=Math.max(maxCol,a.c);}
    for(const tp of elements(doc,'tablePart')){
      const target=rels(path).get(attr(tp,'r:id'))?.target;
      if(target){const t=first(xml(target),'table');if(t){const b=range(attr(t,'ref'));maxRow=Math.max(maxRow,b.r2);maxCol=Math.max(maxCol,b.c2);}}
    }
    if(maxRow>=100000||maxCol>511)throw Error('Sheet exceeds review-build safety limits (100,000 rows, 512 columns). Import cancelled; original remains intact.');
    const s=blankSheet(attr(node,'name'),Math.min(100000,maxRow+101),maxCol+1);book.sheets.push(s);definitions.push({sheet:s,doc,path});
    const tabColor=first(doc,'tabColor')?.getAttribute('rgb');if(tabColor)s.color='#'+tabColor.slice(-6);
    if(attr(node,'state'))report.entries.push(`Hidden worksheet visibility preserved in original package; imported tabs are visible.`);
    for(const c of [...first(doc,'cols')?.children??[]].filter(c=>c.localName==='col')){
      const min=Number(attr(c,'min'))-1,max=Number(attr(c,'max'))-1;
      for(let i=min;i<=Math.min(max,s.columns.length-1);i++){s.columns[i].hidden=attr(c,'hidden')==='1';s.columns[i].width=Math.max(60,Math.min(800,Number(attr(c,'width')||20)*7));}
    }
    for(let level=1;level<=7;level++){
      const outlined=new Set<number>();
      for(const c of [...first(doc,'cols')?.children??[]].filter(c=>c.localName==='col'))if(Number(attr(c,'outlineLevel'))>=level)
        for(let i=Number(attr(c,'min'))-1;i<=Math.min(Number(attr(c,'max'))-1,s.columns.length-1);i++)outlined.add(i);
      let members:string[]=[];
      const finish=()=>{if(members.length){s.groups.push({id:uid(),axis:'column',members,collapsed:false,label:`Imported column outline ${level}`});members=[];}};
      for(let i=0;i<s.columns.length;i++){if(outlined.has(i))members.push(s.columns[i].id);else finish();}finish();
    }
    const levels=new Map<number,string[]>();
    for(const r of elements(doc,'row')){
      const index=Number(attr(r,'r'))-1;if(!s.rows[index])continue;s.rows[index].hidden=attr(r,'hidden')==='1';
      if(r.hasAttribute('ht')){
        const height=Number(attr(r,'ht'));if(!Number.isFinite(height)||height<=0||height>409.5)throw Error('Invalid Excel row height. Import cancelled.');
        s.rows[index].height=height;
      }
      const level=Number(attr(r,'outlineLevel'));for(let l=1;l<=level;l++)levels.set(l,[...levels.get(l)??[],s.rows[index].id]);
    }
    for(const [level,members]of levels){
      let group:string[]=[];let previous=-2;
      for(const id of members){const i=s.rows.findIndex(r=>r.id===id);if(i!==previous+1&&group.length){s.groups.push({id:uid(),axis:'row',members:group,collapsed:false,label:`Imported outline ${level}`});group=[];}group.push(id);previous=i;}
      if(group.length)s.groups.push({id:uid(),axis:'row',members:group,collapsed:false,label:`Imported outline ${level}`});
    }
    const outline=first(doc,'outlinePr'),rawRows=new Map(elements(doc,'row').map(r=>[Number(attr(r,'r'))-1,r]));
    const rawCols=[...first(doc,'cols')?.children??[]].filter(c=>c.localName==='col');
    for(const g of s.groups){
      const axis=g.axis==='row'?s.rows:s.columns,positions=g.members.map(id=>axis.findIndex(item=>item.id===id)),level=Number(g.label.match(/\d+$/)?.[0]);
      const below=g.axis==='row'?outline?.getAttribute('summaryBelow')!=='0':outline?.getAttribute('summaryRight')!=='0';
      const summary=below?Math.max(...positions)+1:Math.min(...positions)-1;
      const node=g.axis==='row'?rawRows.get(summary):rawCols.find(c=>Number(attr(c,'min'))-1<=summary&&Number(attr(c,'max'))-1>=summary);
      g.collapsed=!!node&&attr(node,'collapsed')==='1'&&Number(attr(node,'outlineLevel')||0)===level-1;
    }
    for(const row of s.rows)if(s.groups.some(g=>g.axis==='row'&&g.collapsed&&g.members.includes(row.id)))row.hidden=false;
    for(const column of s.columns)if(s.groups.some(g=>g.axis==='column'&&g.collapsed&&g.members.includes(column.id)))column.hidden=false;
    for(const cell of included?cells:[]){
      const a=address(attr(cell,'r')),r=s.rows[a.r].id,c=s.columns[a.c].id,t=attr(cell,'t'),raw=value(cell,'v'),f=first(cell,'f');
      let v:string|number|boolean|null|{error:string}=null;
      if(t==='s')v=shared[Number(raw)]??'';else if(t==='inlineStr')v=decodeExcelText(elements(cell,'t').map(t=>t.textContent??'').join(''));
      else if(t==='b')v=raw==='1';else if(t==='e')v={error:raw};else if(t==='str'||t==='d')v=raw;else if(raw!=='')v=Number.isFinite(Number(raw))?Number(raw):raw;
      const arrayRef=f&&attr(f,'t')==='array'&&attr(f,'ref')?range(attr(f,'ref')):undefined;
      s.cells[key(r,c)]={value:f?undefined:v,format:formats[Number(attr(cell,'s'))],...(arrayRef?{spillHint:arrayRef.r1!==arrayRef.r2||arrayRef.c1!==arrayRef.c2}:{})};
      if(f){report.formulaCount++;formulas.push({sheet:s,row:a.r,col:a.c,source:f.textContent??'',shared:attr(f,'t')==='shared'?attr(f,'si'):undefined});}
      if(f&&attr(f,'t')==='array'&&attr(f,'ref'))arrayRanges.push({sheet:s,ref:attr(f,'ref'),row:a.r,col:a.c});
    }
    const relationships=rels(path);
    for(const tp of elements(doc,'tablePart')){
      const target=relationships.get(attr(tp,'r:id'))?.target;if(!target)throw Error('Table relationship is missing.');
      const table=first(xml(target),'table')!,b=range(attr(table,'ref'));
      const totals=Number(attr(table,'totalsRowCount')||0);
      book.tables.push({id:uid(),name:attr(table,'displayName')||attr(table,'name'),sheet:s.id,header:s.rows[b.r1].id,
        rows:s.rows.slice(b.r1+1,b.r2+1-totals).map(r=>r.id),
        columns:elements(table,'tableColumn').map((c,i)=>({id:uid(),column:s.columns[b.c1+i].id,name:attr(c,'name')}))});
      if(totals)report.entries.push('Table totals rows preserved as cells; structured #Totals references are not yet calculated.');
    }
    for(const hl of included?elements(doc,'hyperlink'):[]){
      const link=relationships.get(attr(hl,'r:id'))?.target??(attr(hl,'location')?'#'+attr(hl,'location'):'');
      const b=range(attr(hl,'ref'));
      if(s.rows[b.r1]&&s.columns[b.c1]){const k=key(s.rows[b.r1].id,s.columns[b.c1].id);s.cells[k]={...s.cells[k],link};}
    }
    for(const rel of included?relationships.values():[])if(/comments\d*\.xml$/.test(rel.target)&&entries[rel.target]){
      for(const comment of elements(xml(rel.target),'comment')){const a=address(attr(comment,'ref'));if(s.rows[a.r]&&s.columns[a.c]){const k=key(s.rows[a.r].id,s.columns[a.c].id);s.cells[k]={...s.cells[k],note:decodeExcelText(elements(comment,'t').map(t=>t.textContent??'').join(''))};}}
    }
    for(const validation of included?elements(doc,'dataValidation'):[]){
      const sqref=attr(validation,'sqref')||value(validation,'sqref'),formula=value(validation,'formula1'),formulaText=formula||value(validation,'f');
      if(!sqref)continue;
      if(!formulaText&&(!attr(validation,'type')||attr(validation,'type')==='none'))continue;
      for(const item of sqref.trim().split(/\s+/)){
        const b=range(item);if(b.r2>=s.rows.length||b.c2>=s.columns.length){report.entries.push('Validation outside materialized sheet bounds retained in original package only.');continue;}
        s.validations.push({id:uid(),rows:s.rows.slice(b.r1,b.r2+1).map(r=>r.id),columns:s.columns.slice(b.c1,b.c2+1).map(c=>c.id),sheet:s.id,source:formulaText.startsWith('=')?formulaText:'='+formulaText,
          ...(formulaText.startsWith('"')&&formulaText.endsWith('"')?{values:formulaText.slice(1,-1).split(',')}:{})});
      }
    }
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const formulaAddresses=new Set(formulas.map(f=>`${f.sheet.id}:${f.row}:${f.col}`));
  for(const entry of arrayRanges){
    const b=range(entry.ref),s=entry.sheet;
    for(let r=b.r1;r<=Math.min(b.r2,s.rows.length-1);r++)for(let c=b.c1;c<=Math.min(b.c2,s.columns.length-1);c++){
      if(r===entry.row&&c===entry.col)continue;
      const k=key(s.rows[r].id,s.columns[c].id),cell=s.cells[k];
      if(cell&&!formulaAddresses.has(`${s.id}:${r}:${c}`))cell.value=undefined;
    }
  }
  for(const n of elements(wb,'definedName')){
    const scope=n.hasAttribute('localSheetId')?book.sheets[Number(attr(n,'localSheetId'))]?.id:undefined;
    book.names.push({id:uid(),name:attr(n,'name'),sheet:scope,context:scope??book.sheets[0].id,original:n.textContent??'',formula:{kind:'literal',value:null}});
  }
  for(const n of book.names){
    const s=book.sheets.find(s=>s.id===n.context)!;
    try{n.formula=compile(n.original,book,s.id,s.rows[0].id,s.columns[0].id);}catch{n.formula={kind:'error',value:fault('#UNSUPPORTED!','Named expression could not be parsed; original expression preserved.')};report.unsupported['Named expressions']=(report.unsupported['Named expressions']??0)+1;}
  }
  const sharedBases=new Map<string,typeof formulas[number]>();
  for(const f of formulas)if(f.shared!==undefined&&f.source)sharedBases.set(`${f.sheet.id}:${f.shared}`,f);
  const ordered=[...formulas.filter(f=>f.source),...formulas.filter(f=>!f.source)];
  for(let i=0;i<ordered.length;i++){
    const f=ordered[i],s=f.sheet,cell=s.cells[key(s.rows[f.row].id,s.columns[f.col].id)];
    try{
      if(f.source){
        cell.original='='+f.source;cell.formula=compile(f.source,book,s.id,s.rows[f.row].id,s.columns[f.col].id);
        for(const m of f.source.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\(/g)){
          const fn=m[1].replace(/_xlfn\.|_xlws\./gi,'').toUpperCase();if(!supportedFunctions.has(fn))report.unsupported[fn]=(report.unsupported[fn]??0)+1;
        }
      }else if(f.shared!==undefined){
        const base=sharedBases.get(`${s.id}:${f.shared}`);
        const ast=base?s.cells[key(s.rows[base.row].id,s.columns[base.col].id)].formula:undefined;
        if(!base||!ast)throw Error('Shared formula base missing.');
        cell.formula=translate(ast,book,s.id,s.rows[base.row].id,s.columns[base.col].id,s.rows[f.row].id,s.columns[f.col].id);cell.original='[Expanded shared formula; original XML preserved]';
      }else throw Error('Empty formula.');
      cell.spillHint=cell.spillHint||maySpill(cell.formula);
    }catch{
      cell.original='='+f.source;cell.formula={kind:'error',value:fault('#UNSUPPORTED!','Formula could not be parsed; original formula and XLSX package preserved.')};
      report.unsupported['Unparsed formulas']=(report.unsupported['Unparsed formulas']??0)+1;
    }
    if(i%2000===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  for(const s of book.sheets)for(const v of s.validations)if(!v.values)try{v.source=JSON.stringify(compile(v.source,book,s.id,v.rows[0],v.columns[0]));}catch{report.unsupported['Validation source']=(report.unsupported['Validation source']??0)+1;}
  const features:Record<string,string>={mergeCell:'Merged cell layout',conditionalFormatting:'Conditional formatting',drawing:'Drawings/charts/images',sheetProtection:'Sheet protection',autoFilter:'Excel filter UI',extLst:'Extended Excel metadata'};
  for(const [tag,label]of Object.entries(features))if(definitions.some(d=>elements(d.doc,tag).length))report.entries.push(`${label}: preserved in original XLSX package, not rendered/enforced in the grid.`);
  report.entries.push('All original package bytes are preserved locally and included in independent backups. Excel export creates a new supported-feature projection plus an exact native archive; it does not rewrite the preserved original or recreate all Excel presentation. Native backups remain authoritative.');
  report.entries.push('Imported cached formula values are never used as calculated results. Existing formula errors are preserved. No automatic date or chronology repairs are made.');
  if(options)report.entries.push('Targeted source read: unselected sheets retain only layout/table identities for reference binding. Their cells were deliberately not imported. Merge the selected supporting sources, not this partial workbook.');
  if(arrayRanges.length)report.entries.push('Cached array/spill follower values are not imported as manual overrides. Their original bytes remain in the preserved XLSX.');
  report.entries.push('Calculation compatibility is a review implementation, not Excel certification: approximate/wildcard lookup edge cases, date-system boundary behavior, array/lazy evaluation edge cases, and formatting need comparison before migration.');
  report.entries.push('Row/column outlines, row heights, number-format codes, supported styles, validations, notes, and external hyperlinks are retained. Print layout, themes, rich text styling, internal hyperlink navigation, and totals metadata remain in the original package only. The grid uses simplified number/date display; original format codes are retained for export.');
  report.entries=[...new Set(report.entries)];book.importReport=report;
  return{book,original:{id:originalId,name,data:base64(new Uint8Array(buffer))}};
}
