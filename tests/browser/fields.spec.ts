import {expect,test,type Locator} from '@playwright/test';

async function fieldAppearance(field:Locator,purple=false){
  await expect(field).toBeVisible();
  const before=await field.boundingBox();await field.focus();
  const style=await field.evaluate(element=>{
    const s=getComputedStyle(element);
    return{border:s.borderTopWidth,radius:s.borderTopLeftRadius,padding:s.padding,fontSize:s.fontSize,lineHeight:s.lineHeight,outline:s.outlineWidth,offset:s.outlineOffset,shadow:s.boxShadow,focus:s.borderTopColor,background:s.backgroundColor};
  });
  expect(style).toEqual({border:'1px',radius:'5px',padding:'5px 8px',fontSize:'12px',lineHeight:'18px',outline:'0px',offset:'0px',shadow:'none',focus:purple?'rgb(150, 112, 178)':'rgb(120, 149, 131)',background:purple?'rgb(246, 242, 249)':'rgb(237, 241, 232)'});
  const after=await field.boundingBox();expect(after!.width).toBe(before!.width);expect(after!.height).toBe(before!.height);
}

test('text, search, numeric, password, multiline and select-like fields share border-based focus styling',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Notebook',exact:true}).click();
  await fieldAppearance(page.locator('#formula'));await fieldAppearance(page.locator('#row-jump'));
  await page.locator('td[data-r="1"][data-c="1"]').click();await page.keyboard.press('Control+t');
  await fieldAppearance(page.locator('#table-name'));await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Find / replace',exact:true}).click();
  await fieldAppearance(page.locator('#find-text'));await fieldAppearance(page.locator('.find-selectors .dropdown-field').first());
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Assign DD',exact:true}).click();await fieldAppearance(page.getByRole('searchbox',{name:'Search dropdown sources',exact:true}));
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Hypo tag styling',exact:true}).click();
  await fieldAppearance(page.locator('#hyp-label'));await fieldAppearance(page.locator('#hyp-strokeWidth'));
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();await page.locator('#sync').click();
  for(const id of ['sync-owner','sync-repo','sync-branch','sync-path','sync-token'])await fieldAppearance(page.locator('#'+id));
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('td[data-r="1"][data-c="1"]').dblclick();await fieldAppearance(page.locator('#cell-editor'));await page.locator('#cell-editor').press('Escape');
  await page.locator('#grid-scroll').focus();await page.keyboard.press('F2');await fieldAppearance(page.getByRole('textbox',{name:'Edit selected cell',exact:true}));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Notebook',exact:true}).dblclick();await fieldAppearance(page.getByRole('textbox',{name:'Rename sheet',exact:true}));await page.keyboard.press('Escape');
});

test('DD fields, group picker, category creator and option drafts share the purple field treatment',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Open DD',exact:true}).click();await expect(page.locator('body')).toHaveClass(/dd-mode/);
  await fieldAppearance(page.locator('#formula'),true);
  await fieldAppearance(page.locator('.reference-append-row input').first(),true);
  await page.getByRole('button',{name:'DD settings',exact:true}).click();
  await fieldAppearance(page.locator('#reference-label'),true);await fieldAppearance(page.locator('.reference-group-picker'),true);
  await page.locator('.reference-group-picker').click();await fieldAppearance(page.getByRole('searchbox',{name:'Search groups',exact:true}),true);
  await page.getByRole('button',{name:'New category',exact:true}).click();await fieldAppearance(page.getByRole('textbox',{name:'New category path',exact:true}),true);
});
