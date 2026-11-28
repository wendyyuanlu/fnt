import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import type { Ast } from './formula';

export function stringifyArchive(value:unknown):string {
  const templates:Ast[]=[],ids=new Map<Ast,number>(),signatures=new Map<string,number>();
  const body=JSON.stringify(value,(key,v:unknown)=>{
    if(key!=='formula'||!v||typeof v!=='object')return v;
    const ast=v as Ast;let index=ids.get(ast);
    if(index===undefined){
      const signature=JSON.stringify(ast);index=signatures.get(signature);
      if(index===undefined){index=templates.length;templates.push(ast);signatures.set(signature,index);}
      ids.set(ast,index);
    }
    return{$ast:index};
  });
  return`{"format":"fnt-packed-v1","asts":${JSON.stringify(templates)},"data":${body}}`;
}
export function parseArchive(source:string):unknown {
  const parsed=JSON.parse(source);
  if(parsed?.format==='fnt-compressed-v1'){
    if(typeof parsed.payload!=='string')throw Error('Invalid compressed archive.');
    return decompressArchive(parsed.payload);
  }
  if(parsed?.format!=='fnt-packed-v1')return parsed;
  if(!Array.isArray(parsed.asts)||!('data'in parsed))throw Error('Invalid formula archive.');
  const restore=(value:unknown):unknown=>{
    if(Array.isArray(value)){for(let i=0;i<value.length;i++)value[i]=restore(value[i]);return value;}
    if(value&&typeof value==='object'){
      const object=value as Record<string,unknown>;
      if('$ast'in object){
        if(Object.keys(object).length!==1||!Number.isInteger(object.$ast)||Number(object.$ast)<0||Number(object.$ast)>=parsed.asts.length)throw Error('Missing archived formula.');
        return parsed.asts[Number(object.$ast)];
      }
      for(const key of Object.keys(object))object[key]=restore(object[key]);
      return object;
    }
    return value;
  };
  return restore(parsed.data);
}
export async function readArchive(source:string|Blob):Promise<unknown>{
  return parseArchive(typeof source==='string'?source:await source.text());
}
export function bytes64(bytes:Uint8Array):string {
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);
}
export const unbase64=(source:string):Uint8Array=>Uint8Array.from(atob(source.replace(/\s/g,'')),c=>c.charCodeAt(0));
export function compressArchive(value:unknown):string{return bytes64(gzipSync(strToU8(stringifyArchive(value))));}
export function decompressArchive(value:string):unknown{return parseArchive(strFromU8(gunzipSync(unbase64(value))));}
