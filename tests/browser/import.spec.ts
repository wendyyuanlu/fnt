import { expect,test } from '@playwright/test';
import { zipSync,strToU8 } from 'fflate';

const xml=(body:string)=>strToU8(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relns='http://schemas.openxmlformats.org/package/2006/relationships';
function syntheticXlsx():Buffer {
  return Buffer.from(zipSync({
    'xl/workbook.xml':xml(`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pantry" sheetId="1" r:id="r1"/><sheet name="Lists" sheetId="2" r:id="r2"/></sheets><definedNames><definedName name="ItemList">Pantry!$A$2:$A$3</definedName><definedName name="ItemList" localSheetId="1">Lists!$A$1#</definedName></definedNames></workbook>`),
    'xl/_rels/workbook.xml.rels':xml(`<Relationships xmlns="${relns}"><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml':xml(`<worksheet xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x="urn:synthetic-extended"><cols><col min="1" max="3" width="22"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Energy</t></is></c><c r="C1" t="inlineStr"><is><t>Double</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Sample apple</t></is></c><c r="B2"><v>50</v></c><c r="C2"><f t="shared" si="0" ref="C2:C3">B2*2</f><v>999</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Sample pear</t></is></c><c r="B3"><v>60</v></c><c r="C3"><f t="shared" si="0"/><v>999</v></c></row></sheetData><tableParts><tablePart r:id="t1"/></tableParts><extLst><ext><x:col>0</x:col><x:dataValidation type="list"><x:formula1><x:f>ItemList</x:f></x:formula1><x:sqref>A4:A8</x:sqref></x:dataValidation></ext></extLst></worksheet>`),
    'xl/worksheets/_rels/sheet1.xml.rels':xml(`<Relationships xmlns="${relns}"><Relationship Id="t1" Target="../tables/table1.xml"/></Relationships>`),
    'xl/tables/table1.xml':xml(`<table xmlns="${ns}" name="PantryData" displayName="PantryData" ref="A1:C3"><tableColumns><tableColumn id="1" name="Item"/><tableColumn id="2" name="Energy"/><tableColumn id="3" name="Double"/></tableColumns></table>`),
    'xl/worksheets/sheet2.xml':xml(`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="str"><f t="array" ref="A1:A2">_xlfn._xlws.FILTER(PantryData[Item],PantryData[Energy]&gt;0)</f><v>Sample apple</v></c></row><row r="2"><c r="A2" t="str"><v>Sample pear</v></c></row></sheetData></worksheet>`),
  }));
}
test('imports shared formulas and cached spills without stale results, retains scoped names and x14 validation',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Workbook and backups'}).click();
  await page.locator('#import').setInputFiles({name:'Synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:syntheticXlsx()});
  await expect(page.getByRole('grid',{name:'Pantry',exact:true})).toBeVisible();
  await expect(page.locator('td[data-r="1"][data-c="2"]')).toHaveText('100');
  await expect(page.locator('td[data-r="2"][data-c="2"]')).toHaveText('120');
  await page.getByRole('button',{name:'Lists',exact:true}).click();
  await expect(page.locator('td[data-r="0"][data-c="0"]')).toHaveText('Sample apple');
  await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Sample pear');
  await page.getByRole('button',{name:'Pantry',exact:true}).click();
  await page.locator('td[data-r="3"][data-c="0"]').click();await page.getByRole('button',{name:'Choose source',exact:true}).click();
  await expect(page.locator('.validation-values')).toContainText('Sample apple');
  await expect(page.locator('.validation-values')).toContainText('Sample pear');
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Workbook and backups'}).click();await page.getByRole('button',{name:'Compatibility report'}).click();await expect(page.getByRole('dialog')).toContainText('"formulaCount": 3');
});
