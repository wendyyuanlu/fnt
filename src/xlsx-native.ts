import { Gunzip, gzipSync, strFromU8, strToU8 } from 'fflate';
import { parseArchive, stringifyArchive } from './archive';
import { validateBackup, type Backup } from './storage';

export const nativePart='fnt/backup.json.gz',manifestPart='fnt/manifest.json';
export type PackageParts=Record<string,Uint8Array>;
export const digest=async(bytes:Uint8Array):Promise<string>=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');
interface Manifest { format:'fnt-xlsx-v1'; nativeHash:string; parts:Record<string,string> }
const limit=180*1048576;
function readManifest(entries:PackageParts):Manifest {
  const raw=entries[manifestPart];if(!raw||raw.length>1048576)throw Error('Missing or oversized XLSX recovery manifest.');
  const manifest=JSON.parse(strFromU8(raw)) as Manifest;
  if(manifest.format!=='fnt-xlsx-v1'||typeof manifest.nativeHash!=='string'||!manifest.parts||typeof manifest.parts!=='object'||Array.isArray(manifest.parts))throw Error('Invalid XLSX recovery manifest.');
  return manifest;
}
export async function readNativeBackup(entries:PackageParts,remaining=limit):Promise<Backup> {
  const manifest=readManifest(entries),bytes=entries[nativePart];
  if(!bytes||await digest(bytes)!==manifest.nativeHash)throw Error('Embedded native archive failed its integrity check.');
  const chunks:Uint8Array[]=[];let size=0;
  const stream=new Gunzip(chunk=>{size+=chunk.length;if(size>remaining)throw Error('Embedded recovery archive exceeds the safe import limit.');chunks.push(chunk);});
  for(let i=0;i<bytes.length;i+=32768)stream.push(bytes.subarray(i,i+32768),i+32768>=bytes.length);
  const decoded=new Uint8Array(size);let offset=0;for(const chunk of chunks){decoded.set(chunk,offset);offset+=chunk.length;}
  const backup=parseArchive(strFromU8(decoded)) as Backup;
  validateBackup(backup);
  return backup;
}
export async function inspectNative(entries:PackageParts,remaining:number):Promise<{status:'none'|'exact'|'changed'|'missing';backup?:Backup}> {
  const marker=entries['docProps/custom.xml']&&strFromU8(entries['docProps/custom.xml']).includes('FntNativeArchive');
  if(!entries[nativePart]&&!entries[manifestPart])return {status:marker?'missing':'none'};
  const manifest=readManifest(entries),visible=Object.keys(entries).filter(p=>p!==nativePart&&p!==manifestPart&&!p.endsWith('/')).sort(),expected=Object.keys(manifest.parts).sort();
  if(JSON.stringify(visible)!==JSON.stringify(expected))return {status:'changed'};
  for(const path of visible)if(await digest(entries[path])!==manifest.parts[path])return {status:'changed'};
  return {status:'exact',backup:await readNativeBackup(entries,remaining)};
}
export async function addNativeArchive(entries:PackageParts,backup:Backup):Promise<void> {
  validateBackup(backup);
  const bytes=strToU8(stringifyArchive(backup));
  if(bytes.length+Object.values(entries).reduce((size,part)=>size+part.length,0)>limit)throw Error('Workbook and recovery archive exceed the safe XLSX roundtrip limit. Download the native backup instead.');
  const payload=gzipSync(bytes),parts:Record<string,string>={};
  for(const [path,content]of Object.entries(entries))parts[path]=await digest(content);
  if(bytes.length+payload.length+Object.values(entries).reduce((size,part)=>size+part.length,0)+strToU8(JSON.stringify(parts)).length+512>limit)throw Error('Combined Excel projection and embedded recovery exceed the safe roundtrip limit. Use the native backup.');
  entries[nativePart]=payload;
  entries[manifestPart]=strToU8(JSON.stringify({format:'fnt-xlsx-v1',nativeHash:await digest(payload),parts} satisfies Manifest));
}
