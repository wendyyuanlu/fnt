import {chromium} from '@playwright/test';

const url=process.argv[2]??'http://127.0.0.1:4186';
const browser=await chromium.launch({channel:process.env.FNT_BROWSER_CHANNEL??'msedge',headless:true});
try{
  const context=await browser.newContext({viewport:{width:1440,height:950},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  const cpuRate=Number(process.env.FNT_CPU_RATE??1);
  if(cpuRate!==1){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});}
  page.on('pageerror',error=>errors.push(error.message));
  const start=Date.now();
  await page.goto(url);await page.locator('.grid').waitFor({timeout:120000});
  const startup=Date.now()-start;
  await page.waitForTimeout(2000);
  const paint=async action=>{
    return page.evaluate(async action=>{
      const start=performance.now();
      if(action.sheet){
        const button=[...document.querySelectorAll('[data-sheet]')].find(button=>button.textContent===action.sheet);
        if(!button)throw Error(`Missing sheet ${action.sheet}`);
        button.click();
      }else document.querySelector('#grid-scroll').scrollTop=action.top;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return performance.now()-start;
    },action);
  };
  const firstMeals=await paint({sheet:'Meals'});
  await page.waitForTimeout(1500);
  const firstScroll=await paint({top:3300});
  const firstScrollCells=await page.locator('td[data-r]').evaluateAll(cells=>cells.map(cell=>({r:cell.dataset.r,c:cell.dataset.c,text:cell.textContent})));
  const adjacentScroll=await paint({top:3000}),cachedScroll=[];
  for(let i=0;i<20;i++)cachedScroll.push(await paint({top:i%2?3000:3300}));
  const switches=[];
  await paint({top:0});
  for(let i=0;i<3;i++){await paint({sheet:'Ingredients'});switches.push(await paint({sheet:'Meals'}));}
  await page.waitForTimeout(1500);
  const snapshot=await page.evaluate(()=>({
    rows:document.querySelectorAll('tbody tr[data-row]').length,
    cells:[...document.querySelectorAll('td[data-r]')].slice(0,30).map(cell=>({r:cell.dataset.r,c:cell.dataset.c,text:cell.textContent})),
    formula:document.querySelector('#formula').value,
    status:document.querySelector('#save-state').textContent
  }));
  const reloadStart=Date.now();await page.reload();await page.locator('.grid').waitFor({timeout:120000});
  console.log(JSON.stringify({url,cpuRate,startup,firstMeals,firstScroll,adjacentScroll,cachedScroll,switches,reload:Date.now()-reloadStart,errors,firstScrollCells,snapshot},null,2));
  await context.close();
}finally{await browser.close();}
