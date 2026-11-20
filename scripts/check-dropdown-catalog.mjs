import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

if(!process.env.FNT_REFERENCE)throw Error('Set FNT_REFERENCE to the read-only local reference workbook.');
const bytes=await readFile(process.env.FNT_REFERENCE);
const browser=await chromium.launch();
try{
  const context=await browser.newContext();
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.hostname==='127.0.0.1'||url.hostname==='localhost'?route.continue():route.abort();
  });
  const page=await context.newPage();await page.goto('http://127.0.0.1:5173/');
  await page.locator('#save-state').filter({hasText:'Saved'}).waitFor();
  const result=await page.evaluate(async(base64)=>{
    const {importXlsx}=await import('/src/xlsx.ts'),{matchesDropdownCatalog,verifiedCatalogOrigins,seedDropdownCatalog}=await import('/src/dropdown-catalog.ts'),{Store}=await import('/src/storage.ts');
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),source=await importXlsx(bytes.buffer,'Local reference.xlsx',{sheets:['Dropdowns']});
    if(!matchesDropdownCatalog(source.book))throw Error('Bundled catalog differs from original Dropdowns cells or metadata.');
    const store=await Store.open();
    try{
      const state=await store.load(),refs=state.book.references.filter(r=>r.catalog),candidate=structuredClone(state.book);
      delete candidate.catalogMigrations;
      for(const r of candidate.references){r.origin={original:source.original.id,table:r.catalog.table};delete r.catalog;}
      const backup={format:'fnt-backup',version:1,state:{...state,book:candidate},originals:[source.original]};
      const verified=await verifiedCatalogOrigins(backup),migrated=seedDropdownCatalog(candidate,verified);
      if(verified.size!==1||migrated.book.references.length!==7||JSON.stringify(migrated.book.sheets)!==JSON.stringify(candidate.sheets))throw Error('Original provenance adoption did not preserve the existing catalog.');
      return{sourceCellComparison:true,originalProvenanceAdoption:true,lists:refs.length,records:refs.reduce((count,r)=>count+state.book.tables.find(t=>t.id===r.table).rows.length,0)};
    }finally{store.close();}
  },bytes.toString('base64'));
  console.log(JSON.stringify(result));
  await context.close();
}finally{await browser.close();}
