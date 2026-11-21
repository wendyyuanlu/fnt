import { expect,test } from '@playwright/test';
import { strToU8,zipSync } from 'fflate';

function sourceFile():Buffer {
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const columns=['Ingredients','Serving (g)','Calories (kcal)','Calories2','Protein (g)','Conversion Unit','Type'];
  const text=(a:string,v:string)=>`<c r="${a}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const packageParts:Record<string,string>={
    '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/><Override PartName="/xl/tables/table2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`,
    '_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${r}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="${r}"><sheets><sheet name="Ingredients" sheetId="1" r:id="r1"/><sheet name="Dropdowns" sheetId="2" r:id="r2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${r}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${r}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="${ns}" xmlns:r="${r}"><sheetData><row r="1">${columns.map((c,i)=>text(String.fromCharCode(65+i)+'1',c)).join('')}</row><row r="2">${text('A2','Invented shelf item')}<c r="B2"><v>100</v></c><c r="C2"><v>250</v></c><c r="D2"><f>[@[Calories (kcal)]]/[@[Serving (g)]]</f></c><c r="E2"><v>12</v></c>${text('F2','g')}${text('G2','Invented type')}</row></sheetData><dataValidations count="1"><dataValidation type="list" sqref="G2"><formula1>INDIRECT("IngredientType[Ingredient type]")</formula1></dataValidation></dataValidations><tableParts count="1"><tablePart r:id="rt"/></tableParts></worksheet>`,
    'xl/worksheets/sheet2.xml':`<worksheet xmlns="${ns}" xmlns:r="${r}"><sheetData><row r="1">${text('A1','Ingredient type')}</row><row r="2">${text('A2','Invented type')}</row></sheetData><tableParts count="1"><tablePart r:id="rt"/></tableParts></worksheet>`,
    'xl/worksheets/_rels/sheet1.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rt" Type="${r}/table" Target="../tables/table1.xml"/></Relationships>`,
    'xl/worksheets/_rels/sheet2.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rt" Type="${r}/table" Target="../tables/table2.xml"/></Relationships>`,
    'xl/tables/table1.xml':`<table xmlns="${ns}" id="1" name="Ingredients" displayName="Ingredients" ref="A1:G2" totalsRowShown="0"><tableColumns count="7">${columns.map((name,i)=>`<tableColumn id="${i+1}" name="${name}"/>`).join('')}</tableColumns></table>`,
    'xl/tables/table2.xml':`<table xmlns="${ns}" id="2" name="IngredientType" displayName="IngredientType" ref="A1:A2" totalsRowShown="0"><tableColumns count="1"><tableColumn id="1" name="Ingredient type"/></tableColumns></table>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(packageParts).map(([name,xml])=>[name,strToU8(xml)]))));
}
test('targeted Excel import keeps existing data, identifies browser-local state, creates recovery and refuses duplicate reimport',async({page,browser})=>{
  const buffer=sourceFile();
  await page.goto('/');await expect(page.locator('#save-state')).toContainText('Saved in this browser');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  await expect(page.locator('#browser-workbook')).toContainText('Ingredients: 3 records');
  await expect(page.locator('#browser-workbook')).toContainText('No Excel source has been imported');
  await expect(page.locator('#browser-workbook')).toContainText('http://127.0.0.1:5173');
  await expect(page.getByRole('button',{name:'Export Excel projection + embedded Fnt archive',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await page.locator('td[data-r="1"][data-c="0"]').click();await page.locator('#formula').fill('Local note kept');
  await page.locator('#formula').press('Enter');await expect(page.locator('#save-state')).toContainText('Saved');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  await page.locator('#import-ingredients').setInputFiles({name:'invented-ingredients.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.sheet-tab.current')).toHaveText('Ingredients');
  await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Invented shelf item');
  await expect(page.locator('td[data-r="1"][data-c="3"]')).toHaveText('2.5');
  await expect(page.locator('#save-state')).toContainText('3 existing records retained');
  await page.reload();await expect(page.locator('.sheet-tab.current')).toHaveText('Ingredients');
  await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Invented shelf item');
  await page.getByRole('button',{name:'Notebook',exact:true}).click();await expect(page.locator('td[data-r="1"][data-c="0"]')).toHaveText('Local note kept');
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  await page.getByRole('button',{name:'Recovery checkpoints',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download full recovery archive',exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Workbook and backups',exact:true}).click();
  await expect(page.locator('#browser-workbook')).toContainText('Ingredients: 4 records');
  await expect(page.locator('#browser-workbook')).toContainText('An Excel source is attached locally');
  const separate=await browser.newContext();
  try{
    const other=await separate.newPage();await other.goto('http://127.0.0.1:5173/');
    await other.getByRole('button',{name:'Workbook and backups',exact:true}).click();
    await expect(other.locator('#browser-workbook')).toContainText('Ingredients: 3 records');
    await expect(other.locator('#browser-workbook')).toContainText('No Excel source has been imported');
    await expect(other.getByRole('button',{name:'Export Excel projection + embedded Fnt archive',exact:true})).toBeVisible();
    await expect(page.locator('#browser-workbook')).toContainText('Ingredients: 4 records');
  }finally{await separate.close();}
  await page.locator('#import-ingredients').setInputFiles({name:'invented-ingredients.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  await expect(page.locator('#error')).toContainText('avoid duplicate records');
});
