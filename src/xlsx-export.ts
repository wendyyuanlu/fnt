import { strToU8,zipSync } from 'fflate';
import { displayFormula,type Ast } from './formula';
import { allTables,allSheets, columnIndex,isFault,key,letters,mapAst,outlineMembers,type Cell,type Format } from './model';
import { validateBook,type Backup } from './storage';
import { addNativeArchive,type PackageParts } from './xlsx-native';

const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const x=(v:unknown)=>{
  const text=String(v??'');
  if(/[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]|\p{Surrogate}/u.test(text))throw Error('This value cannot be represented as Excel XML without loss. Use the native archive.');
  return text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
};
const cellString=(v:string)=>{
  if(v.length>32767)throw Error('An Excel text value exceeds the 32,767-character limit. Use the native archive; text was not truncated.');
  return x(v.replace(/_x[0-9a-f]{4}_/gi,match=>'_x005F'+match).replace(/[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]/g,c=>'_x'+c.charCodeAt(0).toString(16).padStart(4,'0')+'_'));
};
const excelName=(name:string)=>{
  const cell=name.match(/^([A-Z]{1,3})([1-9]\d{0,6})$/i);
  return /^[\p{L}_\\][\p{L}\p{N}_.\\]*$/u.test(name)&&name.length<=255&&!/^[RC]$|^R\d+C\d+$/i.test(name)&&!(cell&&columnIndex(cell[1])<16384&&Number(cell[2])<=1048576);
};
const doc=(body:string)=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+body;
const rectangle=(rows:number[],cols:number[])=>{
  const rr=[...new Set(rows)].sort((a,b)=>a-b),cc=[...new Set(cols)].sort((a,b)=>a-b);
  if(!rr.length||!cc.length||rr[0]<0||cc[0]<0||rr.at(-1)!-rr[0]+1!==rr.length||cc.at(-1)!-cc[0]+1!==cc.length)throw Error('Excel requires contiguous table/merge ranges. Use the native backup for this layout or make its range rectangular.');
  return `${letters(cc[0])}${rr[0]+1}:${letters(cc.at(-1)!)}${rr.at(-1)!+1}`;
};
function groups(values:number[]):number[][] {
  const sorted=[...new Set(values)].sort((a,b)=>a-b),out:number[][]=[];
  for(const v of sorted){if(v<0)throw Error('A dropdown points to a deleted row/column. Repair its location before exporting.');const last=out.at(-1);if(last&&last.at(-1)===v-1)last.push(v);else out.push([v]);}
  return out;
}
export async function exportXlsx(backup:Backup):Promise<Uint8Array> {
  const book=backup.state.book;validateBook(book);
  const tableNames=new Set<string>(),definedNames=new Set<string>();
  for(const t of allTables(book)){if(!excelName(t.name)||tableNames.has(t.name.toLowerCase()))throw Error('Excel table names must be valid and unique. Rename the affected table or use the native archive.');tableNames.add(t.name.toLowerCase());}
  for(const n of book.names){const id=(n.sheet??'')+':'+n.name.toLowerCase();if(!excelName(n.name)||definedNames.has(id)||(!n.sheet&&tableNames.has(n.name.toLowerCase())))throw Error('An Excel defined name is invalid or collides in its scope. Rename it or use the native archive.');definedNames.add(id);}
  if(book.importReport&&!backup.originals.some(o=>o.id===book.importReport!.originalId))throw Error('The original imported workbook is missing. A full-fidelity export requires it; restore a complete native backup.');
  const entries:PackageParts={},put=(name:string,body:string)=>{entries[name]=strToU8(doc(body));};
  const overrides:{path:string;type:string}[]=[],rootRels=[{id:'rWorkbook',type:'officeDocument',target:'xl/workbook.xml'},{id:'rCustom',type:'custom-properties',target:'docProps/custom.xml'}];
  const relationXml=(items:{id:string;type:string;target:string;external?:boolean}[])=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(item=>`<Relationship Id="${x(item.id)}" Type="${item.type.startsWith('urn:')?item.type:rel+'/'+item.type}" Target="${x(item.target)}"${item.external?' TargetMode="External"':''}/>`).join('')}</Relationships>`;
  const workbookRels=[{id:'rStyles',type:'styles',target:'styles.xml'},{id:'rNative',type:'urn:fnt:native-archive',target:'../fnt/backup.json.gz'},{id:'rManifest',type:'urn:fnt:archive-integrity',target:'../fnt/manifest.json'}];
  const formats:Format[]=[{}],styleIds=new Map<string,number>([[JSON.stringify({}),0]]),styles=(format?:Format)=>{
    if(!format)return 0;const signature=JSON.stringify(format);let id=styleIds.get(signature);
    if(id===undefined){id=formats.length;formats.push(format);styleIds.set(signature,id);}return id;
  };
  const newer=new Set(['XLOOKUP','XMATCH','LET','FILTER','VSTACK','ANCHORARRAY']),formatted=new WeakMap<Ast,string>();
  const formula=(ast:Ast):string=>{
    let out=formatted.get(ast);if(out!==undefined)return out;
    const converted=mapAst(ast,node=>{
      if(node.kind==='error'&&!/^#(?:REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|SPILL!|CALC!|NULL!)$/.test(node.value.error))throw Error('An unparsed/Fnt-only formula error cannot be faithfully exported as an Excel formula. Its original expression remains in the native backup.');
      if(node.kind==='spill')return {kind:'call',name:'_xlfn.ANCHORARRAY',args:[node.child]};
      if(node.kind==='variable')return {...node,name:node.name.startsWith('_XLPM.')?node.name:'_xlpm.'+node.name};
      if(node.kind==='call'&&newer.has(node.name))return {...node,name:(node.name==='FILTER'?'_xlfn._xlws.':'_xlfn.')+node.name};
      return node;
    });
    out=displayFormula(converted,book).replace(/^=/,'');formatted.set(ast,out);return out;
  };
  let dynamic=false,tableNumber=0,commentsNumber=0,listNumber=0;
  const helperColumns:string[][]=[],helperNames:{name:string;formula:string;scope?:number}[]=[],validationSources=new Map<string,string>();
  const reservedNames=new Set([...book.names.map(n=>n.name),...allTables(book).map(t=>t.name)].map(n=>n.toLowerCase()));
  const helperId=(prefix:string)=>{let name=prefix+(++listNumber);while(reservedNames.has(name.toLowerCase()))name=prefix+(++listNumber);reservedNames.add(name.toLowerCase());return name;};
  let helperName='Fnt validation lists',suffix=2;
  while(allSheets(book).some(s=>s.name.toLowerCase()===helperName.toLowerCase()))helperName='Fnt validation lists '+suffix++;
  const sheetXml:string[]=[],seenNames=new Set<string>();
  for(let index=0;index<allSheets(book).length;index++){
    const s=allSheets(book)[index],number=index+1;
    if(!s.name.trim()||s.name.length>31||s.name.startsWith("'")||s.name.endsWith("'")||/[\\/?*[\]:]/.test(s.name)||seenNames.has(s.name.toLowerCase()))throw Error('Excel sheet names must be unique, at most 31 characters, contain no \\ / ? * [ ] : characters, and not begin/end with an apostrophe. Rename the affected tab or use the native backup.');
    seenNames.add(s.name.toLowerCase());
    if(s.rows.length>100000||s.columns.length>512)throw Error('Workbook exceeds this review build\'s safe XLSX dimensions.');
    const rows=new Map(s.rows.map((r,i)=>[r.id,i])),cols=new Map(s.columns.map((c,i)=>[c.id,i]));
    for(const g of s.groups.filter(g=>!g.table))rectangle(g.members.map(id=>(g.axis==='row'?rows:cols).get(id)??-1),[0]);
    const relationships:{id:string;type:string;target:string;external?:boolean}[]=[],tableParts:string[]=[],hyperlinks:string[]=[],comments:{r:number;c:number;text:string}[]=[];
    const rowCells=new Map<number,{c:number;cell:Cell}[]>();
    for(const [address,cell]of Object.entries(s.cells)){const [rid,cid]=address.split(':'),r=rows.get(rid)!,c=cols.get(cid)!;const list=rowCells.get(r)??[];list.push({c,cell});rowCells.set(r,list);}
    const sheetGroups=s.groups.filter(g=>!g.table);
    const summaryBefore=(axis:'row'|'column')=>sheetGroups.some(g=>g.axis===axis&&g.kind==='summary');
    const outlines=new Map(sheetGroups.map(g=>[g.id,new Set(outlineMembers(g,sheetGroups))]));
    const level=(axis:'row'|'column',id:string)=>sheetGroups.filter(g=>g.axis===axis&&outlines.get(g.id)!.has(id)).length;
    const collapsed=(axis:'row'|'column',id:string)=>sheetGroups.some(g=>g.axis===axis&&g.collapsed&&outlines.get(g.id)!.has(id));
    const summary=(axis:'row'|'column',position:number)=>sheetGroups.some(g=>{
      if(g.axis!==axis||!g.collapsed)return false;
      const positions=g.members.map(id=>(axis==='row'?rows:cols).get(id)!);
      return(g.kind==='summary'?positions[0]:summaryBefore(axis)?Math.min(...positions)-1:Math.max(...positions)+1)===position;
    });
    const data=s.rows.map((row,r)=>{
      const outline=level('row',row.id);if(outline>7)throw Error('Excel supports at most seven outline levels. Use the native archive for deeper groups.');
      const cells=(rowCells.get(r)??[]).sort((a,b)=>a.c-b.c).map(({c,cell})=>{
        const address=letters(c)+(r+1),style=styles(cell.format);
        if(cell.note)comments.push({r,c,text:cell.note});
        if(cell.link){
          if(cell.link.startsWith('#'))hyperlinks.push(`<hyperlink ref="${address}" location="${x(cell.link.slice(1))}"/>`);
          else if(/^https?:\/\//i.test(cell.link)){const id='rLink'+relationships.length;relationships.push({id,type:'hyperlink',target:cell.link,external:true});hyperlinks.push(`<hyperlink ref="${address}" r:id="${id}"/>`);}
          else throw Error('An unsupported hyperlink scheme cannot be projected safely. The native backup retains it.');
        }
        let expression=cell.formula?formula(cell.formula):undefined;
        if(cell.binding){
          const t=allTables(book).find(t=>t.id===cell.binding!.table),source=t&&allSheets(book).find(s=>s.id===t.sheet),column=t?.columns.find(c=>c.id===cell.binding!.column);
          const sr=source?.rows.findIndex(r=>r.id===cell.binding!.row)??-1,sc=source?.columns.findIndex(c=>c.id===column?.column)??-1;
          expression=source&&sr>=0&&sc>=0&&t?.rows.includes(cell.binding.row)?`'${source.name.replace(/'/g,"''")}'!$${letters(sc)}$${sr+1}`:'#REF!';
        }
        if(expression!==undefined){const spill=!!cell.spillHint;if(spill)dynamic=true;return `<c r="${address}" s="${style}"${spill?' cm="1"':''}><f${spill?` t="array" ref="${address}"`:''}>${x(expression)}</f></c>`;}
        if(cell.value===undefined||cell.value===null)return `<c r="${address}" s="${style}"/>`;
        if(isFault(cell.value)){if(!/^#(?:REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|SPILL!|CALC!|NULL!)$/.test(cell.value.error))throw Error('A Fnt-only error value cannot be faithfully represented in Excel. Use the native backup.');return `<c r="${address}" s="${style}" t="e"><v>${x(cell.value.error)}</v></c>`;}
        if(typeof cell.value==='number'){if(!Number.isFinite(cell.value))throw Error('Non-finite numeric value cannot be exported.');return `<c r="${address}" s="${style}"><v>${cell.value}</v></c>`;}
        if(typeof cell.value==='boolean')return `<c r="${address}" s="${style}" t="b"><v>${cell.value?1:0}</v></c>`;
        if(cell.value.length>32767)throw Error('An Excel cell exceeds the 32,767-character text limit. Use the native archive; text was not truncated.');
        return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${cellString(cell.value)}</t></is></c>`;
      }).join('');
      if(!cells&&!row.hidden&&!row.height&&!collapsed('row',row.id)&&!outline&&!summary('row',r))return '';
      return `<row r="${r+1}"${row.height?` ht="${row.height}" customHeight="1"`:''}${row.hidden||collapsed('row',row.id)?' hidden="1"':''}${outline?` outlineLevel="${outline}"`:''}${summary('row',r)?' collapsed="1"':''}>${cells}</row>`;
    }).join('');
    for(const t of allTables(book).filter(t=>t.sheet===s.id)){
      const header=rows.get(t.header)!,positions=t.rows.map(r=>rows.get(r)!),columns=[...t.columns].sort((a,b)=>cols.get(a.column)!-cols.get(b.column)!);
      if(positions.some(r=>r<=header))throw Error('Excel table records must be below their header. Move the records below the table header or use a native backup.');
      if(new Set(columns.map(c=>c.name.toLowerCase())).size!==columns.length||columns.some(c=>!c.name||c.name.length>255))throw Error('Excel table columns must have distinct nonempty names of at most 255 characters.');
      if(columns.some(c=>{const header=s.cells[key(t.header,c.column)];return header?.formula||header?.binding||header?.value!==c.name;}))throw Error('Excel table headers must be literal labels matching their column names. Rename/repair the header or use the native archive.');
      const ref=rectangle([header,...positions],columns.map(c=>cols.get(c.column)!)),tn=++tableNumber,id='rTable'+tn;
      relationships.push({id,type:'table',target:`../tables/table${tn}.xml`});tableParts.push(`<tablePart r:id="${id}"/>`);
      put(`xl/tables/table${tn}.xml`,`<table xmlns="${main}" id="${tn}" name="${x(t.name)}" displayName="${x(t.name)}" ref="${ref}" totalsRowShown="0"><autoFilter ref="${ref}"/><tableColumns count="${columns.length}">${columns.map((c,i)=>`<tableColumn id="${i+1}" name="${x(c.name)}"/>`).join('')}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/></table>`);
      overrides.push({path:`xl/tables/table${tn}.xml`,type:'table'});
    }
    const validations=s.validations.map(v=>{
      let source:string;
      if(v.values){
        if(v.values.every(value=>!/[,"\r\n]/.test(value))&&v.values.join(',').length<=253)source='"'+v.values.join(',')+'"';
        else {
          const column=helperColumns.length;helperColumns.push(v.values);const name=helperId('_FntList');
          helperNames.push({name,formula:`'${helperName}'!$${letters(column)}$1:$${letters(column)}$${Math.max(1,v.values.length)}`});source=name;
        }
      }else {
        const ast=v.source.startsWith('{')?JSON.parse(v.source) as Ast:(()=>{throw Error('An unbound dropdown source must be edited and compiled before Excel export.');})(),signature=s.id+':'+JSON.stringify(ast);
        const existing=validationSources.get(signature);
        if(existing)source=existing;
        else{
          source=helperId('_FntSource');validationSources.set(signature,source);
          // Excel list validation rejects direct cross-sheet and table references.
          const fixed=mapAst(ast,node=>node.kind==='ref'?{...node,explicit:true,absRow:true,absCol:true}:node);
          helperNames.push({name:source,formula:formula(fixed),scope:index});
        }
      }
      const ranges=groups(v.rows.map(r=>rows.get(r)??-1)).flatMap(rr=>groups(v.columns.map(c=>cols.get(c)??-1)).map(cc=>rectangle(rr,cc))).join(' ');
      if(!ranges)return '';
      if(ranges.length>32767)throw Error('A dropdown location exceeds Excel range limits. Use a native backup or simplify its selection.');
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${ranges}"><formula1>${x(source)}</formula1></dataValidation>`;
    }).filter(Boolean);
    if(comments.length){
      const cn=++commentsNumber,commentId='rComments'+cn,vmlId='rNotes'+cn;
      relationships.push({id:commentId,type:'comments',target:`../comments${cn}.xml`},{id:vmlId,type:'vmlDrawing',target:`../drawings/notes${cn}.vml`});
      put(`xl/comments${cn}.xml`,`<comments xmlns="${main}"><authors><author>Fnt</author></authors><commentList>${comments.map(c=>`<comment ref="${letters(c.c)}${c.r+1}" authorId="0"><text><t xml:space="preserve">${cellString(c.text)}</t></text></comment>`).join('')}</commentList></comments>`);
      put(`xl/drawings/notes${cn}.vml`,`<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:z="urn:schemas-microsoft-com:office:excel"><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${comments.map((c,i)=>`<v:shape id="_x0000_s${1025+i}" type="#_x0000_t202" style="position:absolute;width:144pt;height:72pt;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><z:ClientData ObjectType="Note"><z:MoveWithCells/><z:SizeWithCells/><z:AutoFill>False</z:AutoFill><z:Row>${c.r}</z:Row><z:Column>${c.c}</z:Column></z:ClientData></v:shape>`).join('')}</xml>`);
      overrides.push({path:`xl/comments${cn}.xml`,type:'comments'});
    }
    const columnXml=s.columns.map((column,i)=>{
      const outline=level('column',column.id);if(outline>7)throw Error('Excel supports at most seven outline levels.');
      return `<col min="${i+1}" max="${i+1}" width="${(column.width??145)/7}" customWidth="1"${column.hidden||collapsed('column',column.id)?' hidden="1"':''}${outline?` outlineLevel="${outline}"`:''}${summary('column',i)?' collapsed="1"':''}/>`;
    }).join('');
    put(`xl/worksheets/sheet${number}.xml`,`<worksheet xmlns="${main}" xmlns:r="${rel}"><sheetPr><tabColor rgb="FF${s.color.slice(1)}"/><outlinePr summaryBelow="${summaryBefore('row')?0:1}" summaryRight="${summaryBefore('column')?0:1}"/></sheetPr><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columnXml}</cols><sheetData>${data}</sheetData>${validations.length?`<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>`:''}${hyperlinks.length?`<hyperlinks>${hyperlinks.join('')}</hyperlinks>`:''}${comments.length?`<legacyDrawing r:id="rNotes${commentsNumber}"/>`:''}${tableParts.length?`<tableParts count="${tableParts.length}">${tableParts.join('')}</tableParts>`:''}</worksheet>`);
    if(relationships.length)put(`xl/worksheets/_rels/sheet${number}.xml.rels`,relationXml(relationships));
    workbookRels.push({id:'rSheet'+number,type:'worksheet',target:`worksheets/sheet${number}.xml`});
    sheetXml.push(`<sheet name="${x(s.name)}" sheetId="${number}" r:id="rSheet${number}"/>`);overrides.push({path:`xl/worksheets/sheet${number}.xml`,type:'worksheet'});
  }
  if(helperColumns.length){
    const number=allSheets(book).length+1,length=Math.max(...helperColumns.map(c=>c.length));
    if(helperColumns.length>512||length>100000)throw Error('Validation helper lists exceed the safe Excel reimport dimensions. Use the native archive.');
    put(`xl/worksheets/sheet${number}.xml`,`<worksheet xmlns="${main}"><sheetData>${Array.from({length},(_,r)=>`<row r="${r+1}">${helperColumns.map((column,c)=>column[r]===undefined?'':`<c r="${letters(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${cellString(column[r])}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`);
    workbookRels.push({id:'rSheet'+number,type:'worksheet',target:`worksheets/sheet${number}.xml`});sheetXml.push(`<sheet name="${x(helperName)}" sheetId="${number}" state="veryHidden" r:id="rSheet${number}"/>`);overrides.push({path:`xl/worksheets/sheet${number}.xml`,type:'worksheet'});
  }
  const numFormats=formats.map((f,i)=>({id:164+i,code:x(f.excelNumberFormat??(f.number==='date'?'yyyy-mm-dd':f.number==='percent'?'0.00%':f.number==='decimal'?'0.00':'General'))}));
  put('xl/styles.xml',`<styleSheet xmlns="${main}"><numFmts count="${numFormats.length}">${numFormats.map(f=>`<numFmt numFmtId="${f.id}" formatCode="${f.code}"/>`).join('')}</numFmts><fonts count="${formats.length}">${formats.map(f=>`<font><sz val="11"/><name val="Calibri"/>${f.bold?'<b/>':''}${f.italic?'<i/>':''}${f.underline?'<u/>':''}${f.strikethrough?'<strike/>':''}${f.color?`<color rgb="FF${f.color.slice(1)}"/>`:''}</font>`).join('')}</fonts><fills count="${formats.length+2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${formats.map(f=>`<fill><patternFill patternType="${f.background?'solid':'none'}">${f.background?`<fgColor rgb="FF${f.background.slice(1)}"/><bgColor indexed="64"/>`:''}</patternFill></fill>`).join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${formats.length}">${formats.map((f,i)=>`<xf numFmtId="${164+i}" fontId="${i}" fillId="${i+2}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="${f.wrap?1:0}"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  if(dynamic){
    put('xl/metadata.xml',`<metadata xmlns="${main}" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`);
    workbookRels.push({id:'rMetadata',type:'sheetMetadata',target:'metadata.xml'});overrides.push({path:'xl/metadata.xml',type:'sheetMetadata'});
  }
  const names=[...book.names.map(n=>{
    const scope=n.sheet?allSheets(book).findIndex(s=>s.id===n.sheet):-1;
    if(n.sheet&&scope<0)throw Error('A named expression belongs to a missing sheet. Repair it or use the native archive.');
    return `<definedName name="${x(n.name)}"${n.sheet?` localSheetId="${scope}"`:''}>${x(formula(n.formula))}</definedName>`;
  }),...helperNames.map(n=>`<definedName name="${n.name}"${n.scope!==undefined?` localSheetId="${n.scope}"`:''}>${x(n.formula)}</definedName>`)];
  put('xl/workbook.xml',`<workbook xmlns="${main}" xmlns:r="${rel}"><workbookPr date1904="0"/><bookViews><workbookView/></bookViews><sheets>${sheetXml.join('')}</sheets>${names.length?`<definedNames>${names.join('')}</definedNames>`:''}<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
  put('xl/_rels/workbook.xml.rels',relationXml(workbookRels));put('_rels/.rels',relationXml(rootRels));
  put('docProps/custom.xml','<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="FntNativeArchive"><vt:bool>true</vt:bool></property></Properties>');
  put('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Default Extension="gz" ContentType="application/gzip"/><Default Extension="json" ContentType="application/json"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>${overrides.map(o=>`<Override PartName="/${o.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${o.type}+xml"/>`).join('')}</Types>`);
  await addNativeArchive(entries,backup);
  const bytes=zipSync(entries,{level:6});if(bytes.length>30*1048576)throw Error('XLSX export exceeds the safe 30 MB reimport limit. Download the native backup instead.');
  return bytes;
}
