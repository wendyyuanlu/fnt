import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (!process.env.FNT_REFERENCE) throw Error('Set FNT_REFERENCE to a private local XLSX. The file is read only; only aggregate counts are printed.');
const bytes=await readFile(process.env.FNT_REFERENCE);
const digest=data=>createHash('sha256').update(data).digest('hex');
const before=digest(bytes);
const browser=await chromium.launch();
const context=await browser.newContext();
await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
const page=await context.newPage();
try {
  await page.goto('http://127.0.0.1:5173');
  const result=await page.evaluate(async data=>{
    const {importXlsx}=await import('/src/xlsx.ts');
    const {Store}=await import('/src/storage.ts');
    const {Engine,scalar,compile}=await import('/src/formula.ts');
    const {stringifyArchive,parseArchive,compressArchive}=await import('/src/archive.ts');
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    const start=performance.now();
    const {book,original}=await importXlsx(bytes.buffer,'Private compatibility reference.xlsx');
    const validationFailureShapes={};
    for(const s of book.sheets)for(const v of s.validations)if(!v.values&&!v.source.startsWith('{')){
      try{compile(v.source,book,s.id,v.rows[0],v.columns[0]);}catch(e){const shape=String(e).replace(/[\p{L}\p{N}_$.]+/gu,'x');validationFailureShapes[shape]=(validationFailureShapes[shape]??0)+1;}
    }
    const imported=performance.now();
    let persistenceError='',reloaded;
    const store=await Store.open('private-import-check');
    try { await store.save(book,0,'Private compatibility check',false,original);reloaded=await store.load(); }
    catch(e){persistenceError=String(e);}
    store.close();
    const persisted=performance.now();
    const archive=stringifyArchive(book),roundtrip=parseArchive(archive);
    const calcStart=performance.now(),engine=new Engine(book),engineReady=performance.now(),errors={},sampleTimings=[];let samples=0,calculationError='';
    try {
      for(const s of book.sheets){
        const started=performance.now();
        for(const [k,cell]of Object.entries(s.cells).filter(([,c])=>c.formula).slice(0,20)){
          const [r,c]=k.split(':'),v=scalar(engine.cell(s.id,r,c));samples++;
          if(v&&typeof v==='object'&&'error'in v)errors[v.error]=(errors[v.error]??0)+1;
        }
        sampleTimings.push(Math.round(performance.now()-started));
      }
    }catch(e){calculationError=e?.name??'Unknown error';}
    const calculated=performance.now(),compressed=compressArchive({book,originals:[original]});
    return {
      sheets:book.sheets.length,tables:book.tables.length,names:book.names.length,
      formulas:book.importReport.formulaCount,unsupported:book.importReport.unsupported,
      validationFailureShapes,
      originalByteRoundtrip:original.data===data,reloadedSheets:reloaded?.book.sheets.length,persistenceError,
      importSeconds:Math.round((imported-start)/1000),persistReloadSeconds:Math.round((persisted-imported)/1000),
      archiveMB:+(archive.length/1048576).toFixed(2),archiveRoundtripSheets:roundtrip.sheets.length,
      compressedSyncMB:+(compressed.length/1048576).toFixed(2),
      calculatedSamples:samples,sampleErrors:errors,calculationError,calculationSeconds:Math.round((calculated-calcStart)/1000),
      engineConstructionMilliseconds:Math.round(engineReady-calcStart),sampleSheetMilliseconds:sampleTimings,
    };
  },bytes.toString('base64'));
  console.log(JSON.stringify(result));
} finally {
  await context.close();await browser.close();
  console.log('Original unchanged:',before===digest(await readFile(process.env.FNT_REFERENCE)));
}
