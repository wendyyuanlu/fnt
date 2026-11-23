import {defineConfig} from '@playwright/test';

process.env.FNT_LOCAL_URL='http://127.0.0.1:5189/';
process.env.FNT_PUBLISHED_URL='http://127.0.0.1:4187/';

export default defineConfig({
  testDir:'tests/browser',testIgnore:['**/offline.spec.ts'],fullyParallel:false,workers:1,timeout:120000,
  use:{
    baseURL:'http://127.0.0.1:5188',headless:true,
    channel:'msedge',viewport:{width:1440,height:950},
    screenshot:'only-on-failure'
  },
  webServer:[{
    command:'npm run dev -- --port 5188 --strictPort',
    url:'http://127.0.0.1:5188',
    env:{VITE_FNT_SYNTHETIC_STARTER:'true'},
    reuseExistingServer:false
  },{
    command:'npm run dev -- --port 5189 --strictPort',url:'http://127.0.0.1:5189',
    reuseExistingServer:false
  },{
    command:'npx vite preview --host 127.0.0.1 --port 4187 --strictPort',url:'http://127.0.0.1:4187',
    reuseExistingServer:true
  }]
});
