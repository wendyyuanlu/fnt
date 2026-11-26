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
  for(const width of [390,480,650,680,820,850,851,876,950,1099,1100,1184,1600]){
    const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390});
    const page=await context.newPage(),errors=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.method()!=='GET')writes.push(request.method());});
    await page.goto(preview.url);await page.waitForFunction(()=>document.body.dataset.loading==='false');
    assert.ok(await page.locator('#error').isHidden(),await page.locator('#error').textContent());
    assert.match(await page.locator('#totals').textContent(),/^8 differences/);
    assert.equal(await page.locator('header.top').textContent(),'Compare versions');
    assert.ok(!(await page.locator('.bulk-disclosure').getAttribute('open')));
    for(const selector of ['.source-details','.bulk-disclosure']){
      const summary=page.locator(`${selector}>summary`),chevron=summary.locator('.navigation-icon');
      assert.equal(await chevron.count(),1);
      const closed=await chevron.evaluate(icon=>getComputedStyle(icon).transform);
      await summary.press('Enter');
      assert.notEqual(await chevron.evaluate(icon=>getComputedStyle(icon).transform),closed);
      await summary.press('Space');
      assert.equal(await chevron.evaluate(icon=>getComputedStyle(icon).transform),closed);
    }
    assert.ok(await page.locator('.source-details').evaluate(details=>{
      details.open=true;
      const last=[...details.querySelectorAll('.notice>span')].filter(span=>!span.hidden).at(-1);
      const expanded=document.querySelector('.workspace').getBoundingClientRect().top-last.getBoundingClientRect().bottom;
      details.open=false;
      const collapsed=document.querySelector('.workspace').getBoundingClientRect().top-details.querySelector('summary').getBoundingClientRect().bottom;
      return collapsed>=8&&Math.abs(collapsed-expanded)<1;
    }));
    assert.ok(await page.evaluate(()=>{
      const root=getComputedStyle(document.documentElement),size=root.getPropertyValue('--scrollbar-size').trim(),native=root.getPropertyValue('--scrollbar-native-width').trim();
      return [...document.querySelectorAll('.grid-scroll,#navigation,#change-list')].every(element=>{
        const css=getComputedStyle(element);
        if(!CSS.supports('selector(::-webkit-scrollbar)'))return css.scrollbarWidth===native;
        const scrollbar=getComputedStyle(element,'::-webkit-scrollbar'),thumb=getComputedStyle(element,'::-webkit-scrollbar-thumb');
        return css.scrollbarWidth===native&&scrollbar.width===size&&scrollbar.height===size&&thumb.backgroundColor==='rgba(0, 0, 0, 0.5)';
      });
    }));
    assert.equal(await page.locator('.source-side').count(),0);
    assert.equal(await page.locator('.source-dot.left-dot,#region').count(),0);
    assert.equal(await page.locator('#left-source').textContent(),'11/20/2026 @ 11:30:00 AM MST');
    assert.equal(await page.locator('#right-source').textContent(),'Committed 11/20/2026 @ 4:00:00 PM MST');
    assert.equal(await page.locator('.source-details #right-source-commit').textContent(),'Main: abcdef0123456789abcdef0123456789abcdef01');
    assert.doesNotMatch(await page.locator('.source-details [aria-label="Left source details"]').textContent(),/abcdef0123456789abcdef0123456789abcdef01|Committed:|Fetched:/);
    assert.doesNotMatch(await page.locator('.source-details [aria-label="Right source details"]').textContent(),/Uploaded:/);
    assert.doesNotMatch(await page.locator('.source-details').textContent(),/last.edit.time|divergent|automatically authoritative/);
    assert.doesNotMatch(await page.locator('.source-details').textContent(),/fixed day dates|calculated day dates/);
    assert.ok(await page.evaluate(()=>document.querySelector('.linked').getBoundingClientRect().top>=document.querySelector('.grid-hint').getBoundingClientRect().bottom));
    assert.equal(await page.locator('#type-help,#keep-target-description').count(),0);
    assert.equal(await page.locator('[aria-describedby="keep-target-description"]').count(),0);
    assert.ok(await page.evaluate(()=>{
      const context=document.querySelector('.view-options>.context').getBoundingClientRect(),linked=document.querySelector('.view-options>.linked:not(.first-cell-option)').getBoundingClientRect(),row=document.querySelector('.view-options').getBoundingClientRect();
      return context.left<linked.left&&Math.abs(context.top+context.height/2-linked.top-linked.height/2)<1&&Math.abs(linked.right-row.right)<1&&context.right<=linked.left;
    }));
    assert.ok(await page.locator('#first-cell').isChecked());
    assert.deepEqual(await page.locator('#context option').allTextContents(),['Context: 1','Context: 2','Context: 3']);
    assert.ok(await page.locator('.view-options').evaluate(row=>{
      const controls=[...row.children].map(child=>child.getBoundingClientRect());
      return controls.every((rect,index)=>!index||rect.left>=controls[index-1].right&&Math.abs(rect.top+rect.height/2-controls[0].top-controls[0].height/2)<1);
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
    assert.ok(await page.locator('.keep-scope').evaluate(label=>{
      const range=document.createRange();range.selectNodeContents(label.firstChild);
      const text=range.getBoundingClientRect(),picker=label.querySelector('.dropdown-field').getBoundingClientRect(),bounds=label.getBoundingClientRect();
      const choice=label.closest('.individual-choice'),row=choice.getBoundingClientRect(),status=choice.querySelector('#individual-status').getBoundingClientRect(),css=getComputedStyle(choice);
      const sameRow=text.right<=picker.left&&Math.abs(text.top+text.height/2-picker.top-picker.height/2)<2;
      const leftAligned=bounds.top<status.bottom||Math.abs(bounds.left-row.left-parseFloat(css.paddingLeft)-parseFloat(css.borderLeftWidth))<1;
      return sameRow&&leftAligned;
    }));
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
    assert.equal(await page.locator('#context-options [aria-selected=true]').textContent(),'Context: 2');
    assert.ok(await page.locator('#context-options .find-pagination').isHidden());
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Context: 3');
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
    assert.ok(await page.locator('#change-list').evaluate(list=>{
      const original=list.style.maxHeight,scroll=list.scrollTop,button=list.querySelector('.change-item');
      const copies=Array.from({length:8},()=>button.cloneNode(true));
      list.append(...copies);list.style.maxHeight='60px';
      const fits=[button,...copies].every(item=>{
        const bounds=item.getBoundingClientRect(),css=getComputedStyle(item);
        return [...item.children].every(child=>{
          const rect=child.getBoundingClientRect();
          return rect.top>=bounds.top+parseFloat(css.paddingTop)-.5&&rect.bottom<=bounds.bottom-parseFloat(css.paddingBottom)+.5;
        });
      });
      const scrollable=list.scrollHeight>list.clientHeight;
      copies.forEach(copy=>copy.remove());list.style.maxHeight=original;list.scrollTop=scroll;
      return fits&&scrollable;
    }));
    assert.deepEqual(await page.locator('#all-count').evaluate(pill=>{
      const style=getComputedStyle(pill);return{padding:style.padding,font:style.fontSize,weight:style.fontWeight,lineHeight:style.lineHeight};
    }),await page.locator('.scope-button .count').first().evaluate(pill=>{
      const style=getComputedStyle(pill);return{padding:style.padding,font:style.fontSize,weight:style.fontWeight,lineHeight:style.lineHeight};
    }));
    assert.equal(await page.locator('.source-dot,.privacy-footer,#dependency-note').count(),0);
    if(width<=850){
      assert.equal(await page.locator('main').evaluate(main=>getComputedStyle(main).padding),'4px 6px 0px');
      assert.ok(await page.locator('.sources').evaluate(sources=>{
        const bounds=sources.getBoundingClientRect();return bounds.left===6&&Math.abs(bounds.right-document.documentElement.clientWidth+6)<1;
      }));
      assert.ok(await page.locator('.workspace').evaluate(workspace=>{
        const css=getComputedStyle(workspace),bounds=workspace.getBoundingClientRect();
        return [css.borderLeftWidth,css.borderRightWidth,css.borderBottomWidth,css.borderRadius].every(value=>value==='0px')&&bounds.left===0&&Math.abs(bounds.right-document.documentElement.clientWidth)<1;
      }));
      assert.deepEqual(await page.locator('.comparison').evaluate(section=>{
        const css=getComputedStyle(section);return[css.paddingLeft,css.paddingRight,css.paddingBottom];
      }),width<=650?['11px','11px','15px']:['12px','12px','17px']);
    }else assert.equal(await page.locator('.workspace').evaluate(workspace=>getComputedStyle(workspace).borderRadius),'12px');
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
    const sheetDividers=await page.locator('#navigation>div').evaluateAll(groups=>groups.map(group=>{
      const css=getComputedStyle(group,'::after');
      return{visible:css.content==='""',width:css.width,height:css.height,color:css.backgroundColor,margin:css.margin};
    }));
    assert.ok(sheetDividers.length>1);
    for(const [index,divider] of sheetDividers.entries()){
      const visible=width<=1099&&index<sheetDividers.length-1;
      assert.equal(divider.visible,visible);
      if(visible)assert.deepEqual(divider,{visible:true,width:'1px',height:'12px',color:'rgb(218, 220, 224)',margin:'0px 4px'});
    }
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
  for(const width of [320,1184]){
    const sample=comparisonSample();
    sample.left.sheets[0].cells['sample-master-r3:sample-master-c0']={value:'Invented row identity'};
    sample.left.sheets[0].cells['sample-master-r3:sample-master-c6']={value:1};
    sample.right=structuredClone(sample.left);
    sample.right.sheets[0].cells['sample-master-r3:sample-master-c6'].value=2;
    sample.right.sheets[0].columns.unshift(sample.right.sheets[0].columns.pop());
    const identityColumns=[sample.left.sheets[0].columns[0].id,sample.right.sheets[0].columns[0].id];
    const movedRows=sample.right.sheets[0].rows;
    movedRows.unshift(movedRows.splice(movedRows.findIndex(row=>row.id==='sample-master-r3'),1)[0]);
    const page=await browser.newPage({viewport:{width,height:1000}});
    await page.route('**/left.json',route=>route.fulfill({json:sample.left}));
    await page.route('**/right.json',route=>route.fulfill({json:sample.right}));
    await page.goto(preview.url);await page.waitForFunction(()=>document.body.dataset.loading==='false');
    await page.locator('.scope-button').filter({hasText:'Outside tables'}).first().click();
    await page.locator('#change-kind').evaluate(select=>{
      select.value='Value changed';select.dispatchEvent(new Event('change',{bubbles:true}));
    });
    for(const context of ['1','3']){
      await page.locator('#context').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},context);
      for(const side of ['left','right']){
        const grid=page.locator(`#${side}-grid`);
        assert.equal(await grid.locator('td[data-row="sample-master-r3"][data-column="sample-master-c0"]').textContent(),'Invented row identity');
        assert.ok(await grid.locator('thead .row-identity').count()>=2);
        await grid.evaluate(grid=>grid.scrollLeft=grid.scrollWidth);
        assert.ok(await grid.evaluate(grid=>{
          const bounds=grid.getBoundingClientRect(),identities=[...grid.querySelectorAll('tr:nth-child(1) td.row-identity')].map(cell=>cell.getBoundingClientRect());
          return identities.length===2&&identities.every(rect=>rect.left>=bounds.left&&rect.right<=bounds.left+grid.clientWidth*.7);
        }));
      }
      const progress=await page.locator('#selection-progress').textContent(),location=await page.locator('#detail-location').textContent();
      await page.locator('#first-cell').uncheck();
      for(const side of ['left','right']){
        const grid=page.locator(`#${side}-grid`);
        assert.equal(await grid.locator('.row-identity').count(),0);
        for(const column of identityColumns)assert.equal(await grid.locator(`td[data-column="${column}"]`).count(),0);
        assert.equal(await grid.locator('td[data-row="sample-master-r3"][data-column="sample-master-c6"]').count(),identityColumns.includes('sample-master-c6')?0:1);
      }
      assert.equal(await page.locator('#selection-progress').textContent(),progress);
      assert.equal(await page.locator('#detail-location').textContent(),location);
      await page.locator('#first-cell').check();
      assert.equal(await page.locator('#left-grid thead .row-identity').count(),2);
    }
    assert.ok(await page.locator('.region-toolbar').isHidden());
    await page.locator('#change-kind').evaluate(select=>{select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.locator('.change-item').filter({hasText:'Row order'}).click();
    assert.ok(await page.locator('.grid-scroll').evaluateAll(grids=>grids.every(grid=>{
      const first=grid.querySelector('tbody tr td:not(.row-identity)'),lastPinned=[...grid.querySelectorAll('tbody tr:first-child td.row-identity')].at(-1);
      return first&&lastPinned&&Math.abs(first.getBoundingClientRect().left-lastPinned.getBoundingClientRect().right)<2;
    })));
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
    assert.equal(await page.locator('[data-control-style],[data-dropdown-style]').count(),0);
    assert.ok(await page.evaluate(()=>document.querySelector('[data-filter-design="tabs"]').compareDocumentPosition(document.getElementById('mobile-mode'))&Node.DOCUMENT_POSITION_FOLLOWING));
    const paintBefore=await frame.locator('#reset-choices').evaluate(button=>({radius:getComputedStyle(button).borderRadius,font:getComputedStyle(button).fontFamily}));
    const regionBefore=await frame.locator('#region-picker').inputValue();
    for(const mobile of [false,true]){
      if(mobile)await page.locator('#mobile-mode').click();
      for(const design of ['dropdown','tabs']){
        await page.locator(`[data-filter-design="${design}"]`).click();
        assert.equal(await frame.locator('body').getAttribute('data-filter-design'),design);
        assert.equal(await frame.locator('.categories').isVisible(),design==='tabs');
        assert.equal(await frame.locator('#type-label').isVisible(),design==='tabs');
        assert.equal(await frame.locator('#change-kind-trigger').getAttribute('aria-label'),'Specific change type');
        assert.equal(await frame.locator('#type-label,#combined-type-label').evaluateAll(labels=>labels.some(label=>[...label.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim()))),false);
        assert.equal(await frame.locator('.area-changes h3').count(),0);
        if(await frame.locator('.region-toolbar').isVisible())assert.ok(await frame.evaluate(()=>{
          const previous=document.getElementById('previous').getBoundingClientRect(),next=document.getElementById('next').getBoundingClientRect(),picker=document.getElementById('region-picker-trigger'),bounds=picker.getBoundingClientRect(),style=getComputedStyle(picker),arrow=picker.querySelector('svg').getBoundingClientRect();
          const reference=document.getElementById(document.body.dataset.filterDesign==='tabs'?'change-kind-trigger':'change-filter-trigger').getBoundingClientRect().height;
          return previous.right<=next.left&&next.right<=bounds.left&&Math.abs(previous.width-previous.height)<.1&&Math.abs(next.width-next.height)<.1&&[previous.height,next.height,bounds.height].every(height=>Math.abs(height-reference)<.1)&&style.textAlign==='left'&&Math.abs(arrow.right-(bounds.right-parseFloat(style.paddingRight)-parseFloat(style.borderRightWidth)))<2;
        }));
        if(design==='tabs')assert.ok(await frame.evaluate(()=>{
          const tabs=document.querySelector('.categories').getBoundingClientRect(),picker=document.getElementById('type-label').getBoundingClientRect(),bar=document.querySelector('.filter-toolbar').getBoundingClientRect(),gap=parseFloat(getComputedStyle(document.querySelector('.filter-toolbar')).columnGap);
          return picker.left>=tabs.right&&Math.abs(picker.top-tabs.top)<2&&Math.abs(picker.right-bar.right)<1||picker.top>=tabs.bottom&&tabs.width+picker.width+gap>bar.width&&Math.abs(picker.left-tabs.left)<1;
        }));
        const sizing=await frame.locator(design==='tabs'?'#change-kind-trigger':'#change-filter-trigger').evaluate(button=>{
          const style=getComputedStyle(button),width=button.getBoundingClientRect().width;
          const range=document.createRange(),textWidth=Math.max(...[...button.querySelectorAll('.dropdown-option-size')].map(span=>{range.selectNodeContents(span);return range.getBoundingClientRect().width;}));
          const natural=textWidth+button.querySelector('svg').getBoundingClientRect().width+parseFloat(style.columnGap)+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth);
          return {width,natural,display:style.display,limit:button.closest('.filter-toolbar').getBoundingClientRect().width};
        });
        assert.equal(sizing.display,'grid');assert.ok(sizing.width>0&&sizing.width<=280&&sizing.width<=sizing.limit+.5);
        assert.ok(Math.abs(sizing.width-Math.min(sizing.natural,280,sizing.limit))<2);
        if(design==='tabs')assert.ok(await frame.evaluate(()=>{
          const height=document.getElementById('change-kind-trigger').getBoundingClientRect().height;
          return [...document.querySelectorAll('.categories button')].every(button=>Math.abs(button.getBoundingClientRect().height-height)<.1);
        }));
        assert.equal(await frame.locator('#combined-type-label').isVisible(),design==='dropdown');
        assert.deepEqual(await frame.locator('#reset-choices').evaluate(button=>({radius:getComputedStyle(button).borderRadius,font:getComputedStyle(button).fontFamily})),paintBefore);
        assert.equal(await frame.locator('#selection-progress').textContent(),choices);
        assert.equal(await frame.locator('#detail-location').textContent(),selection);
        assert.equal(await frame.locator('#region-picker').inputValue(),regionBefore);
        assert.equal(loads.length,sourcesLoaded);
        assert.ok(await frame.evaluate(()=>{
          const left=document.querySelector('.left-pane').getBoundingClientRect(),right=document.querySelector('.right-pane').getBoundingClientRect();
          return right.left>=left.right&&right.top===left.top&&document.documentElement.scrollWidth<=innerWidth;
        }));
      }
      if(mobile)await page.locator('#mobile-mode').click();
    }
    await page.locator('[data-filter-design="dropdown"]').click();
    await frame.locator('#change-filter-trigger').click();
    assert.equal(await frame.getByRole('option',{name:'All changes (5)',exact:true}).count(),1);
    assert.equal(await frame.getByRole('option',{name:'Values & formulas (3)',exact:true}).count(),1);
    assert.equal(await frame.getByRole('option',{name:'Structure (2)',exact:true}).count(),1);
    assert.equal(await frame.locator('#change-filter-options .filter-subtype').count(),3);
    assert.equal(await frame.getByRole('option',{name:'Values & formulas (3)',exact:true}).locator('.amber').count(),1);
    await frame.getByRole('option',{name:'Hypothetical tag (1)',exact:true}).click();
    assert.equal(await frame.locator('#change-kind').inputValue(),'Hypothetical tag');
    assert.ok(await frame.locator('.region-toolbar').isHidden());
    const filteredRegion=await frame.locator('#region-picker').inputValue(),filteredSelection=await frame.locator('#detail-location').textContent();
    await frame.locator('#change-filter-trigger').click();
    await page.locator('[data-filter-design="tabs"]').click();
    assert.equal(await frame.locator('#change-filter-options').count(),0);
    assert.equal(await frame.locator('[data-category="structure"]').getAttribute('aria-pressed'),'true');
    assert.equal(await frame.locator('#change-kind').inputValue(),'Hypothetical tag');
    assert.equal(await frame.locator('#region-picker').inputValue(),filteredRegion);
    assert.equal(await frame.locator('#detail-location').textContent(),filteredSelection);
    await frame.locator('[data-category="all"]').click();
    await page.locator('[data-filter-design="dropdown"]').click();
    assert.equal(await frame.locator('#change-filter').inputValue(),JSON.stringify(['all','Hypothetical tag']));
    await frame.locator('#change-filter-trigger').click();
    await frame.getByRole('option',{name:'All changes (5)',exact:true}).click();
    await page.locator('[data-filter-design="tabs"]').click();
    assert.equal(await frame.locator('#change-kind').inputValue(),'');
    assert.equal(await frame.locator('[data-category="all"]').getAttribute('aria-pressed'),'true');
    assert.ok(await frame.locator('.region-toolbar').isVisible());
    assert.equal(await frame.locator('#selection-progress').textContent(),choices);
    assert.equal(loads.length,sourcesLoaded);
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
    console.log(`${width}px: Tabs/Dropdown previews preserve choices, filters, selected area and sources; grouped options and keyboard-safe popup closure work.`);
  }
}finally{await browser?.close();await preview.close();}
