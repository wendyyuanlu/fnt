import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser',testMatch:process.env.FNT_COPY_UI_DRAFT_FOCUS==='true'?['meal-log.spec.ts']:['private-startup.spec.ts','workbook-copy-ui.spec.ts','workbook-copy.spec.ts'],workers:1,fullyParallel:false,timeout:45000,maxFailures:1,
  use:{baseURL:process.env.FNT_COPY_UI_URL,headless:true,screenshot:'only-on-failure'},
  projects:[{name:'desktop',use:{viewport:{width:1280,height:900}}},{name:'touch',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
  reporter:[['json',{outputFile:`copy-ui-native-${process.env.FNT_COPY_UI_RUN}.json`}]],outputDir:`copy-ui-results-${process.env.FNT_COPY_UI_RUN}`,
});
