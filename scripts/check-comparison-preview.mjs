import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {startComparisonPreview} from './preview-comparison.mjs';
import {comparisonSample} from '../prototypes/comparison/sample.mjs';

await assert.rejects(startComparisonPreview({dataDir:process.cwd()}),/outside the repository/);
const preview=await startComparisonPreview({port:0});
let browser;
try{
  browser=await chromium.launch();
  assert.equal((await fetch(new URL('/',preview.url))).status,404);
  assert.equal((await fetch(new URL('main.ts',preview.url))).status,404);
  assert.equal((await fetch(preview.url,{method:'PUT',body:'invalid'})).status,404);
  for(const width of [390,480,650,820,850,851,950,1099,1100,1184,1600]){
    const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390});
    const page=await context.newPage(),errors=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.method()!=='GET')writes.push(request.method());});
    await page.goto(preview.url);await page.waitForFunction(()=>document.body.dataset.loading==='false');
    assert.ok(await page.locator('#error').isHidden(),await page.locator('#error').textContent());
    assert.match(await page.locator('#totals').textContent(),/^8 differences/);
    assert.equal(await page.locator('header.top').textContent(),'Compare versions');
    assert.ok(!(await page.locator('.bulk-disclosure').getAttribute('open')));
    assert.equal(await page.locator('.source-side').count(),0);
    assert.equal(await page.locator('.source-dot.left-dot,#region').count(),0);
    assert.equal(await page.locator('#left-source').textContent(),'11/20/2026 @ 11:30:00 AM MST');
    assert.equal(await page.locator('#right-source').textContent(),'Committed 11/20/2026 @ 4:00:00 PM MST');
    assert.equal(await page.locator('.source-details #source-commit').textContent(),'GitHub commit: abcdef0123456789abcdef0123456789abcdef01');
    assert.ok(await page.evaluate(()=>document.querySelector('.linked').getBoundingClientRect().top>=document.querySelector('.grid-hint').getBoundingClientRect().bottom));
    assert.equal(await page.locator('#type-help,#keep-target-description').count(),0);
    assert.equal(await page.locator('[aria-describedby="keep-target-description"]').count(),0);
    assert.ok(await page.evaluate(()=>{
      const context=document.querySelector('.view-options>.context').getBoundingClientRect(),linked=document.querySelector('.view-options>.linked').getBoundingClientRect(),row=document.querySelector('.view-options').getBoundingClientRect();
      return context.left<linked.left&&Math.abs(context.top+context.height/2-linked.top-linked.height/2)<1&&Math.abs(linked.right-row.right)<1&&context.right<=linked.left;
    }));
    assert.equal(await page.locator('.bulk-panel>.selection-progress').count(),1);
    assert.ok(await page.evaluate(()=>document.querySelector('.selection-progress').getBoundingClientRect().bottom<=document.querySelector('.bulk-summary-title').getBoundingClientRect().top));
    assert.equal(await page.locator('.selection-counts #totals').count(),1);
    assert.equal(await page.locator('.workbook-totals').count(),0);
    assert.equal(await page.locator('#totals b').count(),0);
    assert.equal(await page.locator('#detail-left').textContent(),'60');
    assert.equal(await page.locator('#detail-right').textContent(),'61');
    const detailSize=await page.locator('#detail-left').evaluate(element=>{
      const css=getComputedStyle(element);
      return{height:element.getBoundingClientRect().height,expected:parseFloat(css.lineHeight)+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom)};
    });
    assert.ok(Math.abs(detailSize.height-detailSize.expected)<1);
    await page.locator('#detail-right').evaluate(element=>{element.textContent='Synthetic first line\nSynthetic second line\nSynthetic third line';});
    const pairedDetails=await page.evaluate(()=>{
      const left=document.getElementById('detail-left'),right=document.getElementById('detail-right'),css=getComputedStyle(right);
      return{left:left.getBoundingClientRect().height,right:right.getBoundingClientRect().height,expected:3*parseFloat(css.lineHeight)+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom),
        aligned:document.getElementById('left-range').getBoundingClientRect().top===document.getElementById('right-range').getBoundingClientRect().top};
    });
    assert.ok(Math.abs(pairedDetails.left-detailSize.height)<1);
    assert.ok(Math.abs(pairedDetails.right-pairedDetails.expected)<1);
    assert.ok(pairedDetails.aligned);
    await page.locator('#detail-right').evaluate(element=>{element.textContent='61';});
    assert.equal(await page.locator('#keep-scope option[value="difference"]').textContent(),'Single cell');
    assert.doesNotMatch(await page.locator('#keep-scope').textContent(),/all conflicts|Selected conflict/);
    assert.equal(await page.locator('body').getAttribute('data-dropdown-style'),'dd');
    const categoryPaint=await page.locator('[data-category="all"]').evaluate(button=>{
      const css=getComputedStyle(button),count=getComputedStyle(button.querySelector('span'));
      return{border:css.borderTopWidth,radius:css.borderRadius,background:css.backgroundColor,countRadius:count.borderRadius,countBackground:count.backgroundColor};
    });
    assert.deepEqual(categoryPaint,{border:'0px',radius:'7px',background:'rgb(237, 243, 239)',countRadius:'10px',countBackground:'rgba(0, 0, 0, 0.14)'});
    assert.equal(await page.locator('#value-count').evaluate(element=>getComputedStyle(element).padding),'0px 5px');
    assert.deepEqual(await page.locator('#value-count').evaluate(element=>{
      const css=getComputedStyle(element);return{color:css.color,line:css.lineHeight,family:css.fontFamily.split(',')[0]};
    }),{color:'rgb(35, 60, 52)',line:width<=650?'10.8px':'12px',family:'Inter'});
    await page.locator('#context-trigger').focus();
    await page.locator('#context-trigger').press('ArrowDown');
    assert.equal(await page.locator('#context-trigger').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#context-options [aria-selected=true]').textContent(),'2 rows / columns');
    assert.ok(await page.locator('#context-options .find-pagination').isHidden());
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'3 rows / columns');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#context-trigger').getAttribute('aria-expanded'),'false');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'context-trigger');
    await page.locator('#review-choices').focus();
    await page.locator('#review-choices').press('Enter');
    assert.ok(await page.locator('#choice-review').isVisible());
    assert.ok(!(await page.locator('.bulk-disclosure').getAttribute('open')));
    await page.locator('#review-close').click();
    const geometry=await page.evaluate(()=>{
      const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
      return{width:innerWidth,scroll:document.documentElement.scrollWidth,bulk:box('.bulk-disclosure'),heading:box('#sheet-name'),main:box('.review-main'),rail:box('.decision-rail'),list:box('#change-list')};
    });
    assert.ok(geometry.scroll<=geometry.width);
    assert.deepEqual(await page.locator('#all-count').evaluate(pill=>{
      const style=getComputedStyle(pill);return{padding:style.padding,font:style.fontSize,weight:style.fontWeight,lineHeight:style.lineHeight};
    }),await page.locator('.scope-button .count').first().evaluate(pill=>{
      const style=getComputedStyle(pill);return{padding:style.padding,font:style.fontSize,weight:style.fontWeight,lineHeight:style.lineHeight};
    }));
    assert.equal(await page.locator('.source-dot,.privacy-footer').count(),0);
    if(width<=850)assert.equal(await page.locator('main').evaluate(main=>getComputedStyle(main).padding),'4px 6px 10px');
    assert.ok(geometry.bulk.bottom<geometry.heading.y);
    if(width>850){
      assert.ok(geometry.rail.x>=geometry.main.right);
      assert.ok(Math.abs(geometry.list.bottom-geometry.main.bottom)<2);
    }
    else assert.ok(geometry.rail.y>geometry.main.y);
    assert.ok(await page.locator('.workspace>aside').evaluate((aside,width)=>{
      const rect=aside.getBoundingClientRect(),comparison=document.querySelector('.comparison').getBoundingClientRect();
      return width<=1099?rect.bottom<=comparison.top:rect.right<=comparison.left;
    },width));
    assert.deepEqual(await page.evaluate(()=>({
      left:getComputedStyle(document.querySelector('.left-pane')).borderRightWidth,
      right:getComputedStyle(document.querySelector('.right-pane')).borderLeftWidth,
    })),{left:'1px',right:'1px'});
    for(const side of ['left','right']){
      assert.equal(await page.locator(`#${side}-github`).textContent(),'Browse uploads');
      assert.equal((await page.locator(`#${side}-source-card .file-action`).textContent()).trim(),'');
      assert.deepEqual(await page.locator(`#${side}-source-card .file-action svg`).evaluate(svg=>{
        const style=getComputedStyle(svg);return{width:style.width,height:style.height,color:style.color};
      }),{width:'14px',height:'14px',color:'rgb(35, 60, 52)'});
      assert.ok(await page.locator(`#${side}-source-card .file-action`).evaluate(label=>{
        const svg=label.querySelector('svg'),path=svg.querySelector('path'),bounds=path.getBBox(),view=svg.viewBox.baseVal;
        const margin=parseFloat(getComputedStyle(path).strokeWidth)*view.width/svg.getBoundingClientRect().width/2;
        return Math.abs(label.getBoundingClientRect().height-label.parentElement.querySelector('button').getBoundingClientRect().height)<1&&
          bounds.x-margin>=view.x&&bounds.x+bounds.width+margin<=view.x+view.width&&bounds.y-margin>=view.y&&bounds.y+bounds.height+margin<=view.y+view.height;
      }));
      assert.ok(await page.locator(`#${side}-source-card`).evaluate(card=>{
        const description=card.querySelector('.source-description').getBoundingClientRect(),actions=card.querySelector('.source-actions').getBoundingClientRect();
        return actions.top<description.bottom&&actions.bottom>description.top&&actions.left>=description.right;
      }));
      assert.equal(await page.locator(`.${side}-pane header b`).count(),1);
      assert.equal(await page.locator(`#keep-${side} button`).textContent(),'Keep');
      const pane=await page.locator(`.${side}-pane`).evaluate(pane=>{
        const header=pane.querySelector('header'),name=header.querySelector('b').getBoundingClientRect(),button=header.querySelector('button').getBoundingClientRect();
        return{header:getComputedStyle(header).backgroundColor,detail:getComputedStyle(pane.querySelector('.source-detail')).backgroundColor,centerDifference:Math.abs(name.y+name.height/2-button.y-button.height/2)};
      });
      assert.equal(pane.header,'rgb(255, 255, 255)');
      assert.equal(pane.detail,'rgb(255, 255, 255)');
      assert.ok(pane.centerDifference<1);
    }
    const panes=await page.evaluate(()=>[...document.querySelectorAll('#previews>.pane')].map(pane=>{const rect=pane.getBoundingClientRect();return{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom};}));
    assert.deepEqual(await page.locator('.bulk-panel').evaluate(panel=>{
      const css=getComputedStyle(panel);return{overflow:css.overflow,radius:css.borderBottomLeftRadius,border:css.borderBottomWidth};
    }),{overflow:'hidden',radius:'8px',border:'1px'});
    assert.equal(panes[0].y,panes[1].y);assert.ok(panes[1].x>=panes[0].right);
    assert.equal(await page.locator('.scope-button .count').first().evaluate(pill=>getComputedStyle(pill).borderRadius),'10px');
    assert.equal(await page.locator('.scope-button').first().evaluate(button=>getComputedStyle(button).borderWidth),'0px');
    if(width>=1100){
      assert.equal(await page.locator('.workspace>aside').evaluate(aside=>aside.getBoundingClientRect().width),215);
      assert.ok(await page.locator('.scope-button').first().evaluate(button=>{
        const label=button.firstElementChild,old=label.textContent;label.textContent='A deliberately long navigation label that must stay inside its button';
        const bounds=button.getBoundingClientRect(),aside=button.closest('aside').getBoundingClientRect(),count=button.querySelector('.count').getBoundingClientRect();
        const fits=bounds.left>=aside.left&&bounds.right<=aside.right&&label.getBoundingClientRect().right<=count.left;
        label.textContent=old;return fits;
      }));
    }
    const controlStyles=await page.evaluate(()=>['#left-github','#keep-left button','#individual-buttons button','#review-choices'].map(selector=>{
      const button=document.querySelector(selector),style=getComputedStyle(button);
      return{radius:style.borderRadius,padding:style.padding,font:style.fontSize,line:style.lineHeight,border:style.borderStyle};
    }));
    for(const style of controlStyles)assert.deepEqual(style,controlStyles[0]);
    assert.equal(await page.locator('#individual-buttons button').evaluate(button=>getComputedStyle(button).borderColor),
      await page.locator('#left-github').evaluate(button=>getComputedStyle(button).borderColor));
    await page.locator('#individual-buttons button').click();
    await page.mouse.move(0,0);
    assert.equal(await page.locator('#individual-buttons button').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#individual-buttons button').evaluate(button=>getComputedStyle(button).borderColor),
      await page.locator('#left-github').evaluate(button=>getComputedStyle(button).borderColor));
    assert.ok(await page.evaluate(()=>{
      const [previous,picker,next]=['#previous','#region-picker-trigger','#next'].map(selector=>document.querySelector(selector).getBoundingClientRect());
      return previous.width===previous.height&&next.width===next.height&&previous.height===picker.height&&picker.height===next.height&&previous.top===picker.top&&picker.top===next.top;
    }));
    assert.equal(await page.locator('#next svg').evaluate(svg=>getComputedStyle(svg).color),'rgb(35, 60, 52)');
    const widths=await page.evaluate(()=>['left','right'].map(side=>[...document.querySelectorAll(`#${side}-grid thead th`)].map(cell=>cell.getBoundingClientRect().width)));
    assert.deepEqual(widths[0],widths[1]);
    assert.ok(widths[0].every(width=>width<=160));
    assert.equal(widths[0][3],160);
    assert.ok(widths[0][4]<160);
    const activePill=await page.locator('[data-category="all"] span').evaluate(pill=>getComputedStyle(pill).backgroundColor);
    assert.match(activePill,/rgba\(0, 0, 0,/);
    const amountChange=page.locator('#change-list .change-item').nth(1);
    await amountChange.click();
    assert.ok(await page.locator('#left-grid').evaluate(grid=>{
      const selected=grid.querySelector('.selected-cell').getBoundingClientRect(),bounds=grid.getBoundingClientRect(),rowHeader=grid.querySelector('.row-number').getBoundingClientRect();
      return selected.left>=bounds.left+rowHeader.width-1&&selected.right<=bounds.left+grid.clientWidth+1;
    }));
    await page.locator('#left-grid').evaluate(grid=>grid.scrollLeft=0);
    await page.locator('#keep-left button').click();
    assert.equal(await page.locator('#left-grid').evaluate(grid=>grid.scrollLeft),0);
    await amountChange.click();
    assert.equal(await page.locator('#left-grid').evaluate(grid=>grid.scrollLeft),0);
    await page.locator('#reset-choices').click();
    await page.locator('#change-list .change-item').first().click();
    await page.locator('.bulk-summary-title').click();
    const select=page.locator('#choice-scope');
    const choose=async value=>{const label=await select.locator(`option[value="${value}"]`).textContent();await page.locator('#choice-scope-trigger').click();await page.getByRole('option',{name:label,exact:true}).click();};
    assert.match(await select.locator('option[value="sheet"]').textContent(),/Master sheet/);
    assert.match(await page.locator('#choice-target-description').textContent(),/other tables and sheets/);
    await choose('sheet');
    await page.locator('#bulk-buttons [data-pick="left"]').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^6 of 8/);
    await page.locator('#keep-right button').click();
    assert.equal(await page.locator('#keep-right button').getAttribute('aria-pressed'),'true');
    await page.locator('#undo-choice').click();
    assert.equal(await page.locator('#keep-left button').getAttribute('aria-pressed'),'true');
    await page.locator('#reset-choices').click();
    await page.locator('[data-category="value"]').click();
    assert.ok(await page.locator('.keep-scope').isHidden());
    await choose('filtered');
    assert.match(await page.locator('#choice-target-count').textContent(),/^3 changes/);
    await page.locator('#bulk-buttons [data-pick="right"]').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^3 of 8/);
    await choose('scope');assert.match(await page.locator('#choice-target-count').textContent(),/^5 changes/);
    await choose('settings');
    assert.match(await page.locator('#choice-target-description').textContent(),/Toolbar order/);
    assert.match(await page.locator('#choice-target-count').textContent(),/^1 changes/);
    await page.locator('#bulk-buttons [data-pick="left"]').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^4 of 8/);
    await page.locator('#review-choices').click();
    assert.match(await page.locator('#review-groups').textContent(),/Workbook \/ Settings/);
    await page.locator('#next-unresolved').click();
    assert.equal(await page.locator('#individual-status').textContent(),'Undecided');
    await choose('area');
    assert.match(await page.locator('#choice-target-description').textContent(),/Changes in this area/);
    await page.locator('#bulk-buttons [data-pick="left"]').click();
    await choose('workbook');
    await page.locator('#bulk-buttons [data-pick="left"]').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^8 of 8/);
    const oldSource=await page.locator('#left-source').textContent();
    await page.locator('#left-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await page.locator('#error').waitFor();
    assert.equal(await page.locator('#left-source').textContent(),oldSource);
    assert.match(await page.locator('#selection-progress').textContent(),/^8 of 8/);
    const sample=comparisonSample();
    await page.evaluate(()=>{
      const read=File.prototype.text;
      File.prototype.text=async function(){await new Promise(resolve=>globalThis.releaseFileRead=resolve);File.prototype.text=read;return read.call(this);};
    });
    await page.locator('#left-file').setInputFiles({name:'invented-local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample.left))});
    assert.ok(await page.locator('#right-file').isDisabled());
    assert.ok(await page.locator('#right-github').isDisabled());
    await page.evaluate(()=>globalThis.releaseFileRead());
    await page.waitForFunction(()=>document.getElementById('left-source').textContent==='invented-local.json'&&document.body.dataset.loading==='false');
    assert.ok(await page.locator('#right-file').isEnabled());
    assert.ok(await page.locator('#right-github').isEnabled());
    assert.match(await page.locator('#selection-progress').textContent(),/^0 of 8/);
    assert.equal(await page.locator('#left-kind').textContent(),'Local JSON');
    const rightBefore=await page.locator('#right-source').textContent();
    await page.locator('#left-github').click();
    assert.equal(await page.locator('#snapshot-owner').inputValue(),'wendyyuanlu');
    assert.equal(await page.locator('#snapshot-repo').inputValue(),'fnt-data');
    assert.equal(await page.locator('#snapshot-branch').inputValue(),'main');
    assert.equal(await page.locator('#snapshot-path').inputValue(),'fnt-data.json');
    assert.equal(await page.locator('#snapshot-title').textContent(),'Left copy · GitHub');
    assert.ok(!(await page.locator('.snapshot-target[data-side="right"]').isVisible()));
    await page.locator('#snapshot-close').click();
    assert.equal(await page.locator('#right-source').textContent(),rightBefore);
    const scroll=await page.locator('#left-grid').evaluate(grid=>{grid.scrollLeft=80;return grid.scrollLeft;});
    await page.waitForFunction(left=>document.getElementById('right-grid').scrollLeft===left,scroll);
    await page.locator('#right-file').setInputFiles({name:'invented-match.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample.left))});
    await page.waitForFunction(()=>document.getElementById('right-source').textContent==='invented-match.json'&&document.body.dataset.loading==='false');
    assert.match(await page.locator('#totals').textContent(),/^0 differences/);
    assert.equal(await page.locator('#scope-name').textContent(),'These copies match');
    assert.match(await page.locator('#selection-progress').textContent(),/^0 of 0/);
    assert.equal(await page.locator('#change-list button').count(),0);
    assert.ok(await page.locator('#keep-left button').isDisabled());
    await page.locator('#right-file').setInputFiles({name:'invented-different.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample.right))});
    await page.waitForFunction(()=>document.getElementById('right-source').textContent==='invented-different.json'&&document.body.dataset.loading==='false');
    assert.match(await page.locator('#totals').textContent(),/^8 differences/);
    assert.ok(await page.locator('#keep-left button').isEnabled());
    assert.ok(await page.locator('#error').isHidden());
    assert.deepEqual(await page.evaluate(async()=>({db:(await indexedDB.databases()).length,local:localStorage.length,session:sessionStorage.length})),{db:0,local:0,session:0});
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    await context.close();
    console.log(`${width}px: explicit bulk targets, collapsed top placement, column Keep, selections/Undo/review, safe source errors, responsive layout and no writes passed.`);
  }
  for(const width of [390,1184]){
    const sample=comparisonSample(),left=sample.left.sheets[0],right=sample.right.sheets[0];
    left.cells['sample-master-r3:sample-master-c2']={value:10};
    right.cells['sample-master-r3:sample-master-c2']={value:11};
    left.cells['sample-master-r10:sample-master-c1']={value:20};
    right.cells['sample-master-r10:sample-master-c1']={value:21};
    right.cells['sample-master-r3:sample-master-c1'].format={bold:true};
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),writes=[];
    page.on('request',request=>{if(request.method()!=='GET')writes.push(request.method());});
    await page.route('**/left.json',route=>route.fulfill({json:sample.left}));
    await page.route('**/right.json',route=>route.fulfill({json:sample.right}));
    await page.goto(preview.url);await page.waitForFunction(()=>document.body.dataset.loading==='false');
    const selectScope=async(id,value)=>{
      const name=await page.locator(`#${id} option[value="${value}"]`).textContent();
      await page.locator(`#${id}-trigger`).click();
      await page.getByRole('option',{name,exact:true}).click();
    };
    await page.locator('[data-category="value"]').click();
    await selectScope('keep-scope','row');
    assert.ok(await page.locator('.keep-scope').isVisible());
    if(width<=650)assert.ok(await page.evaluate(()=>{
      const status=document.getElementById('individual-status').getBoundingClientRect(),later=document.getElementById('individual-buttons').getBoundingClientRect(),scope=document.querySelector('.keep-scope').getBoundingClientRect();
      return status.top<later.bottom&&later.top<status.bottom&&scope.top>=Math.max(status.bottom,later.bottom);
    }));
    await page.evaluate(()=>{
      const select=document.getElementById('keep-scope');
      select.append(new Option('Synthetic longest scope option with extra display text extending past a phone viewport','width-check'));
      select.dispatchEvent(new Event('change',{bubbles:true}));
    });
    const size=await page.locator('#keep-scope-trigger').evaluate(button=>{
      const css=getComputedStyle(button),text=document.createElement('span');
      text.style.cssText=`position:fixed;visibility:hidden;white-space:nowrap;font:${css.font}`;
      text.textContent=button.querySelector('.dropdown-option-size:last-of-type').textContent;document.body.append(text);
      const required=text.getBoundingClientRect().width+parseFloat(css.paddingLeft)+parseFloat(css.paddingRight)+parseFloat(css.borderLeftWidth)+parseFloat(css.borderRightWidth)+parseFloat(css.columnGap)+button.querySelector('svg').getBoundingClientRect().width;
      text.remove();
      return{width:button.getBoundingClientRect().width,required,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(size.width>0);
    assert.equal(size.overflow,false);
    if(width===1184)assert.ok(size.width>=size.required-1,`Longest option clipped: ${JSON.stringify(size)}`);
    else assert.ok(size.width<size.required&&size.width<=width,`Phone picker did not contract: ${JSON.stringify(size)}`);
    await page.evaluate(()=>{
      const select=document.getElementById('keep-scope');select.querySelector('[value="width-check"]').remove();select.dispatchEvent(new Event('change',{bubbles:true}));
    });
    assert.match(await page.locator('#keep-scope-trigger').getAttribute('aria-description'),/All 3 row-specific/);
    assert.match(await page.locator('#keep-scope-trigger').getAttribute('title'),/1 broader structural changes excluded/);
    await page.locator('#keep-left button').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^3 of 11/);
    await page.locator('[data-category="all"]').click();
    assert.equal(await page.locator('.change-item').filter({hasText:'Cell formatting or retained calculation'}).getAttribute('data-choice'),'left');
    assert.equal(await page.locator('.change-item').filter({hasText:'Group added or removed'}).getAttribute('data-choice'),'');
    await page.locator('#keep-right button').click();
    await page.locator('#undo-choice').click();
    assert.equal(await page.locator('#keep-left button').getAttribute('aria-pressed'),'true');
    await page.locator('#reset-choices').click();
    await selectScope('keep-scope','column');
    assert.match(await page.locator('#keep-scope-trigger').getAttribute('aria-description'),/All 3 column-specific/);
    await page.locator('#keep-right button').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^3 of 11/);
    await page.locator('#review-choices').click();
    assert.equal(await page.locator('.review-row[data-choice="right"]').filter({hasText:/B11/}).count(),1);
    await page.locator('#review-close').click();
    await page.locator('#reset-choices').click();
    await page.locator('.bulk-summary-title').click();
    await selectScope('choice-scope','row');
    await page.locator('#bulk-buttons [data-pick="left"]').click();
    assert.equal(await page.locator('#individual-status').textContent(),'Mixed choices');
    await selectScope('choice-scope','column');
    await page.locator('#bulk-buttons [data-pick="right"]').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^4 of 11/);
    await page.locator('#undo-choice').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^3 of 11/);
    await selectScope('keep-scope','row');
    await page.locator('#individual-buttons button').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^0 of 11/);
    await page.locator('#undo-choice').click();
    assert.match(await page.locator('#selection-progress').textContent(),/^3 of 11/);
    await page.locator('.scope-button').filter({hasText:'Settings'}).click();
    assert.ok(await page.locator('#keep-scope option[value="row"]').isDisabled());
    assert.ok(await page.locator('#choice-scope option[value="column"]').isDisabled());
    assert.ok(await page.locator('.keep-scope').isHidden());
    assert.equal(await page.locator('#keep-scope').inputValue(),'difference');
    assert.ok(await page.locator('#keep-left button').isEnabled());
    assert.match(await page.locator('#keep-scope-trigger').getAttribute('aria-description'),/only to the selected conflict/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(writes,[]);
    await context.close();
    console.log(`${width}px: row/column scopes include hidden and offscreen cell conflicts, exclude broader changes, preserve overlaps and undo as one batch.`);
  }
  {
    const sample=comparisonSample(),key=Object.keys(sample.left.sheets[0].cells).find(key=>sample.left.sheets[0].cells[key].value===60);
    sample.left.sheets[0].cells[key]={value:0.5,format:{number:'percent'}};
    sample.right.sheets[0].cells[key]={value:0.75,format:{number:'percent'}};
    const page=await browser.newPage();
    await page.route('**/left.json',route=>route.fulfill({json:sample.left}));
    await page.route('**/right.json',route=>route.fulfill({json:sample.right}));
    await page.goto(preview.url);await page.waitForFunction(()=>document.body.dataset.loading==='false');
    assert.equal(await page.locator('#detail-left').textContent(),'Displayed: 50%\nSaved value: 0.5');
    assert.equal(await page.locator('#detail-right').textContent(),'Displayed: 75%\nSaved value: 0.75');
    await page.locator('[data-category="value"]').click();
    await page.locator('#change-kind').evaluate(select=>{select.value='Cell value or formula';select.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.ok(await page.locator('.keep-scope').isHidden());
    await page.close();
  }
  for(const width of [320,390,1184]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    const page=await context.newPage(),errors=[],writes=[],loads=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{
      if(request.method()!=='GET')writes.push(request.method());
      if(/\/(?:left|right|source-meta)\.json$/.test(request.url()))loads.push(request.url());
    });
    await page.route('**/source-meta.json',route=>route.fulfill({json:{
      left:'Demo phone upload with redundant wording',right:'GitHub main at commit abcdef0',
      leftDevice:'Demo phone',leftUploadedAt:'2025-04-01T12:00:00Z',
      rightCommit:'abcdef0123456789abcdef0123456789abcdef01',rightCommittedAt:'2025-04-01T13:00:00Z',
      retrievedAt:'2025-04-01T14:00:00Z',displayTimeZone:'UTC',
    }}));
    await page.goto(preview.reviewUrl);
    const frame=await (await page.locator('#comparison-frame').elementHandle()).contentFrame();
    await frame.waitForFunction(()=>document.body.dataset.loading==='false');
    assert.equal(await frame.locator('#left-kind').textContent(),'Demo phone upload');
    assert.doesNotMatch(await frame.locator('#left-source').textContent(),/Demo phone|upload/);
    assert.equal(await frame.locator('#right-kind').textContent(),'GitHub');
    assert.equal(await frame.locator('#left-source').textContent(),'4/1/2025 @ 12:00:00 PM UTC');
    assert.equal(await frame.locator('#right-source').textContent(),'Committed 4/1/2025 @ 1:00:00 PM UTC');
    assert.equal(await frame.locator('.left-pane header b').textContent(),'Demo phone upload');
    assert.equal(await frame.locator('.right-pane header b').textContent(),'GitHub');
    assert.equal(await frame.evaluate(()=>innerWidth),width);
    await frame.locator('#keep-left button').click();
    const choices=await frame.locator('#selection-progress').textContent();
    const sourcesLoaded=loads.length;
    const selection=await frame.locator('#detail-location').textContent();
    assert.ok(await page.evaluate(()=>document.querySelector('[data-control-style="before"]').compareDocumentPosition(document.getElementById('mobile-mode'))&Node.DOCUMENT_POSITION_FOLLOWING));
    const afterPaint=await frame.locator('#reset-choices').evaluate(button=>({radius:getComputedStyle(button).borderRadius,font:getComputedStyle(button).fontFamily}));
    for(const mobile of [false,true]){
      if(mobile)await page.locator('#mobile-mode').click();
      for(const style of ['before','after']){
        await page.locator(`[data-control-style="${style}"]`).click();
        assert.equal(await frame.locator('body').getAttribute('data-control-style'),style);
        const paint=await frame.locator('#reset-choices').evaluate(button=>({radius:getComputedStyle(button).borderRadius,font:getComputedStyle(button).fontFamily}));
        if(style==='before'){
          assert.equal(paint.radius,'7px');
          assert.notEqual(paint.font,afterPaint.font);
        }else assert.deepEqual(paint,afterPaint);
        await frame.locator('#context-trigger').click();
        for(const menu of ['previous','dd']){
          await page.locator(`[data-dropdown-style="${menu}"]`).click();
          const paint=await frame.locator('#context-options [aria-selected=true]').evaluate(button=>{
            const css=getComputedStyle(button);
            return{border:css.borderTopWidth,padding:css.padding,font:css.fontSize,background:css.backgroundColor};
          });
          const cellFont=await frame.locator('#left-grid td:not(.row-number)').first().evaluate(cell=>getComputedStyle(cell).fontSize);
          assert.deepEqual(paint,menu==='previous'?{border:'1px',padding:'7px 11px',font:'14px',background:'rgb(232, 241, 235)'}:{border:'0px',padding:'9px 8px',font:cellFont,background:'rgb(232, 239, 223)'});
          if(menu==='dd')assert.equal(await frame.locator('.cell-dropdown').evaluate(popup=>getComputedStyle(popup).padding),'6px');
          assert.equal(await frame.locator('#selection-progress').textContent(),choices);
          assert.equal(await frame.locator('#detail-location').textContent(),selection);
          assert.equal(loads.length,sourcesLoaded);
          assert.ok(await frame.evaluate(()=>{
            const left=document.querySelector('.left-pane').getBoundingClientRect(),right=document.querySelector('.right-pane').getBoundingClientRect();
            return right.left>=left.right&&right.top===left.top&&document.documentElement.scrollWidth<=innerWidth;
          }));
        }
        await frame.locator('#context-options [aria-selected=true]').press('Escape');
      }
      if(mobile)await page.locator('#mobile-mode').click();
    }
    assert.deepEqual(writes,[]);
    await page.locator('#mobile-mode').click();
    await frame.waitForFunction(expected=>innerWidth===expected,Math.min(width,390));
    assert.equal(await page.locator('#mobile-mode').getAttribute('aria-pressed'),'true');
    assert.equal(await frame.locator('#selection-progress').textContent(),choices);
    assert.ok(await frame.evaluate(()=>{
      const left=document.querySelector('.left-pane').getBoundingClientRect(),right=document.querySelector('.right-pane').getBoundingClientRect();
      return right.left>=left.right&&right.top===left.top&&document.documentElement.scrollWidth<=innerWidth;
    }));
    await frame.locator('#review-choices').click();
    assert.ok(await frame.locator('#choice-review').isVisible());
    await frame.locator('#review-close').click();
    await page.locator('#mobile-mode').click();
    await frame.waitForFunction(expected=>innerWidth===expected,width);
    assert.equal(await frame.locator('#selection-progress').textContent(),choices);
    if(width>=1100)assert.ok(await frame.evaluate(()=>{
      const left=document.querySelector('.left-pane').getBoundingClientRect(),right=document.querySelector('.right-pane').getBoundingClientRect();
      return right.left>=left.right&&right.top===left.top;
    }));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`${width}px: full-UI Before/After and Previous/DD menus preserve choices, selection, sources and side-by-side layout in both viewport modes.`);
  }
}finally{await browser?.close();await preview.close();}
