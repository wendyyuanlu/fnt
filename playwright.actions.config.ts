import {defineConfig} from '@playwright/test';

const baseline=process.env.FNT_ACTION_BASELINE_ROOT;
const port=baseline?5398:5388,publicPort=port+1,previewPort=Number(process.env.FNT_ACTION_PREVIEW_PORT??(baseline?4288:4289));
const command=(port:number)=>baseline?`npx vite "${baseline}" --host 127.0.0.1 --port ${port} --strictPort`:`npm run dev -- --port ${port} --strictPort`;
process.env.FNT_LOCAL_URL=`http://127.0.0.1:${publicPort}/`;
process.env.FNT_PUBLISHED_URL=`http://127.0.0.1:${previewPort}/`;

export default defineConfig({
  testDir:'tests/browser',testIgnore:['**/offline.spec.ts'],workers:1,timeout:120000,
  use:{baseURL:`http://127.0.0.1:${port}`,headless:true,channel:'msedge',viewport:{width:1440,height:950},screenshot:'only-on-failure'},
  webServer:[
    {command:command(port),url:`http://127.0.0.1:${port}`,env:{VITE_FNT_SYNTHETIC_STARTER:'true'},reuseExistingServer:false},
    {command:command(publicPort),url:`http://127.0.0.1:${publicPort}`,reuseExistingServer:false},
    {command:`npx vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,url:`http://127.0.0.1:${previewPort}`,reuseExistingServer:true}
  ]
});
