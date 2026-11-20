import { expect,test } from '@playwright/test';

test('local Excel projection roundtrips the native workbook, detects external edits and preserves supported XML metadata',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const load=(path:string)=>import(/* @vite-ignore */'/src/'+path+'.ts');
    const model=await load('model'),{Store}=await load('storage'),{exportXlsx}=await load('xlsx-export'),{importXlsx,recoverXlsxBackup}=await load('xlsx');
    const {stringifyArchive}=await load('archive'),{Engine,compile}=await load('formula');
    const dependency='/node_modules/.vite/deps/fflate.js';
    const {unzipSync,zipSync,strFromU8,strToU8}=await import(/* @vite-ignore */dependency);
    const {createDemo,key,setInput,uid}=model,book=createDemo(),notes=book.sheets.find((s:{name:string})=>s.name==='Notebook'),ingredients=book.tables.find((t:{name:string})=>t.name==='Ingredients');
    book.title='Synthetic local export';
    const store=await Store.open('xlsx-synthetic-'+uid()),first=await store.save(book,0,'Synthetic pending edit'),backup=await store.backup(first);
    backup.originals.push({id:uid(),name:'invented-source.bin',data:'aW52ZW50ZWQ='});
    const write=(r:number,c:number,v:string)=>setInput(book,notes,notes.rows[r].id,notes.columns[c].id,v);
    write(1,1,'=1+2*3');write(2,1,'=LET(Thing,4,Thing+1)');write(3,1,'=FILTER(Ingredients[Ingredient],Ingredients[Ingredient]<>"")');
    write(4,1,'=B4#');write(5,1,'=XLOOKUP("Example oats",Ingredients[Ingredient],Ingredients[Calories per g],"")');
    write(6,1,'=1e999');
    write(7,1,'Line one\r\nLiteral _x0041_ and \u0001 control');
    const styled=notes.cells[key(notes.rows[7].id,notes.columns[1].id)];
    styled.format={bold:true,underline:true,wrap:false,color:'#123456',background:'#abcdef',number:'decimal',excelNumberFormat:'0.000 "units"'};
    styled.note='Invented note\nLiteral _x000A_';styled.link='https://example.com/invented';
    notes.rows[7].height=36;
    notes.groups.push({id:uid(),axis:'column',members:notes.columns.slice(4,6).map((c:{id:string})=>c.id),collapsed:true,label:'Export outline'});
    notes.cells[key(notes.rows[8].id,notes.columns[1].id)]={binding:{table:ingredients.id,row:ingredients.rows[0],column:ingredients.columns[0].id}};
    notes.validations.push({id:uid(),sheet:notes.id,rows:[notes.rows[7].id],columns:[notes.columns[1].id],source:'',values:['A, comma','B "quote"']});
    notes.validations.push({id:uid(),sheet:notes.id,rows:[notes.rows[7].id],columns:[notes.columns[2].id],source:JSON.stringify(compile('=Ingredients[Ingredient]',book,notes.id,notes.rows[7].id,notes.columns[2].id))});
    book.names.push({id:uid(),name:'ScopedValue',context:notes.id,original:'=7',formula:{kind:'literal',value:7}},{id:uid(),name:'ScopedValue',sheet:notes.id,context:notes.id,original:'=9',formula:{kind:'literal',value:9}});
    write(9,1,'=ScopedValue');
    backup.state.book=book;
    const bytes=await exportXlsx(backup),loaded=await importXlsx(bytes.buffer,'export.xlsx');
    const parts=unzipSync(bytes),xml=strFromU8(parts['xl/worksheets/sheet4.xml']);
    const names=Object.keys(parts),parser=new DOMParser(),badXml=names.filter(name=>name.endsWith('.xml')||name.endsWith('.rels')||name.endsWith('.vml')).filter(name=>parser.parseFromString(strFromU8(parts[name]),'application/xml').querySelector('parsererror'));
    parts['xl/worksheets/sheet4.xml']=strToU8(xml.replace('<f>(1+(2*3))</f>','<f>99</f>'));
    // Alter a supported scalar independent of the exact formula renderer.
    parts['xl/worksheets/sheet4.xml']=strToU8(strFromU8(parts['xl/worksheets/sheet4.xml']).replace('Line one','Edited line one'));
    const editedBytes=zipSync(parts),edited=await importXlsx(editedBytes.buffer,'edited.xlsx'),editedNotes=edited.book.sheets.find((s:{name:string})=>s.name==='Notebook');
    const recovered=await recoverXlsxBackup(editedBytes.buffer);
    const editedText=editedNotes.cells[key(editedNotes.rows[7].id,editedNotes.columns[1].id)];
    const externalEngine=new Engine(edited.book);
    const changedStatus=edited.book.importReport.entries.some((e:string)=>e.includes('External Excel/package edits detected'));
    const corrupted={...unzipSync(bytes)};corrupted['fnt/backup.json.gz']=Uint8Array.of(1,2,3);
    let corruptionRefused=false;try{await importXlsx(zipSync(corrupted).buffer,'corrupt.xlsx');}catch(e){corruptionRefused=String(e).includes('integrity');}
    delete parts['fnt/backup.json.gz'];delete parts['fnt/manifest.json'];
    const stripped=await importXlsx(zipSync(parts).buffer,'stripped.xlsx');
    const malformed=model.clone(book),table=malformed.tables.find((t:{name:string})=>t.name==='Ingredients');
    const sheet=malformed.sheets.find((s:{id:string})=>s.id===table.sheet),row=sheet.rows.splice(2,1)[0];sheet.rows.splice(6,0,row);
    let fragmentedRefused=false;try{await exportXlsx({...backup,state:{...backup.state,book:malformed}});}catch(e){fragmentedRefused=String(e).includes('contiguous');}
    store.close();
    return {
      exactNative:stringifyArchive(loaded.nativeBackup)===stringifyArchive(backup),
      explicitRecovery:stringifyArchive(recovered)===stringifyArchive(backup),
      exactBook:stringifyArchive(loaded.book)===stringifyArchive(book),
      pending:loaded.nativeBackup.state.pending.map((p:{id:string})=>p.id).join(',')===backup.state.pending.map((p:{id:string})=>p.id).join(','),
      validXml:badXml.length===0,changedStatus,corruptionRefused,fragmentedRefused,
      editedText:editedText.value,
      editedStyle:editedText.format,editedNote:editedText.note,editedLink:editedText.link,
      editedRowHeight:editedNotes.rows[7].height,
      columnOutline:editedNotes.groups.some((g:{axis:string;collapsed:boolean})=>g.axis==='column'&&g.collapsed),
      projectedBinding:externalEngine.cell(editedNotes.id,editedNotes.rows[8].id,editedNotes.columns[1].id),
      letValue:externalEngine.cell(editedNotes.id,editedNotes.rows[2].id,editedNotes.columns[1].id),
      editedFormulaValue:externalEngine.cell(editedNotes.id,editedNotes.rows[1].id,editedNotes.columns[1].id),
      scopedValue:externalEngine.cell(editedNotes.id,editedNotes.rows[9].id,editedNotes.columns[1].id),
      safeValidation:xml.includes('<formula1>_FntSource')&&!xml.includes('<formula1>Ingredients['),
      projectedValidation:externalEngine.evaluate(JSON.parse(editedNotes.validations.find((v:{columns:string[]})=>v.columns.includes(editedNotes.columns[2].id)).source),editedNotes.id,editedNotes.rows[7].id,editedNotes.columns[2].id)[0][0],
      overflowValue:externalEngine.cell(editedNotes.id,editedNotes.rows[6].id,editedNotes.columns[1].id),
      newIdentities:edited.book.id!==book.id,
      removedNotice:stripped.book.importReport.entries.some((e:string)=>e.includes('archive was removed')),
      formulaPrefix:xml.includes('_xlfn.XLOOKUP')&&xml.includes('_xlfn.LET')&&xml.includes('_xlfn._xlws.FILTER')&&xml.includes('_xlpm.THING'),
      bindingFormula:xml.includes('$A$2'),
      dynamicMetadata:!!unzipSync(bytes)['xl/metadata.xml'],
      helperList:loaded.book.sheets.length===book.sheets.length&&edited.book.sheets.length===book.sheets.length+1,
    };
  });
  expect(result).toMatchObject({exactNative:true,explicitRecovery:true,exactBook:true,pending:true,validXml:true,changedStatus:true,corruptionRefused:true,fragmentedRefused:true,columnOutline:true,projectedBinding:'Example oats',letValue:5,editedFormulaValue:99,scopedValue:9,safeValidation:true,projectedValidation:'Example oats',newIdentities:true,removedNotice:true,formulaPrefix:true,bindingFormula:true,dynamicMetadata:true,helperList:true,editedRowHeight:36});
  expect(result.editedText).toBe('Edited line one\r\nLiteral _x0041_ and \u0001 control');
  expect(result.editedNote).toBe('Invented note\nLiteral _x000A_');
  expect(result.editedLink).toBe('https://example.com/invented');
  expect(result.editedStyle).toMatchObject({bold:true,underline:true,wrap:false,color:'#123456',background:'#abcdef',excelNumberFormat:'0.000 "units"'});
  expect(result.overflowValue).toMatchObject({error:'#NUM!'});
});

test('XLSX download control includes a native archive and restores through the real file UI',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  await page.getByRole('button',{name:'Export Excel projection + embedded Fnt archive',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Native backups remain authoritative');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download private XLSX',exact:true}).click();
  const file=await download,path=await file.path();expect(path).toBeTruthy();
  const buffer=await (await import('node:fs/promises')).readFile(path!);
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  await page.locator('#import').setInputFiles({name:'synthetic-export.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('#save-state')).toContainText('Imported locally');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Example oats');
  const {unzipSync,zipSync,strFromU8,strToU8}=await import('fflate'),parts=unzipSync(buffer);
  parts['xl/worksheets/sheet2.xml']=strToU8(strFromU8(parts['xl/worksheets/sheet2.xml']).replace('Example oats','Edited externally'));
  const edited={name:'externally-edited.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(zipSync(parts))};
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.locator('#import').setInputFiles(edited);
  await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:'Ingredients',exact:true}).click();
  await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Edited externally');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();await page.locator('#recover-xlsx').setInputFiles(edited);
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('#save-state')).toContainText('Restored locally - sync disconnected');
  await page.getByRole('button',{name:'Ingredients',exact:true}).click();await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Example oats');
});
