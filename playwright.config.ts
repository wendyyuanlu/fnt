import { defineConfig } from '@playwright/test';
process.env.FNT_LOCAL_URL??='http://127.0.0.1:5185/';
process.env.FNT_PUBLISHED_URL??='http://127.0.0.1:4184/';
export default defineConfig({
  testDir:'tests/browser',fullyParallel:false,workers:1,timeout:60000,
  use:{baseURL:'http://127.0.0.1:5184',headless:true,screenshot:'only-on-failure'},
  projects:[{name:'desktop',use:{viewport:{width:1365,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
  webServer:[
    {command:'npm run dev -- --port 5184 --strictPort',url:'http://127.0.0.1:5184',env:{VITE_FNT_SYNTHETIC_STARTER:'true'},reuseExistingServer:false},
    {command:'npm run dev -- --port 5185 --strictPort',url:'http://127.0.0.1:5185',reuseExistingServer:false},
    {command:'npm run preview -- --port 4184 --strictPort',url:'http://127.0.0.1:4184',reuseExistingServer:false},
  ],
});
