import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser',fullyParallel:false,workers:1,timeout:60000,
  use:{baseURL:'http://127.0.0.1:5174',headless:true,screenshot:'only-on-failure'},
  projects:[{name:'desktop',use:{viewport:{width:1365,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
  webServer:[
    {command:'npm run dev -- --port 5174 --strictPort',url:'http://127.0.0.1:5174',env:{VITE_FNT_SYNTHETIC_STARTER:'true'},reuseExistingServer:!process.env.CI},
    {command:'npm run dev -- --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
    {command:'npm run preview',url:'http://127.0.0.1:4173',reuseExistingServer:true},
  ],
});
