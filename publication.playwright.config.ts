import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser',testMatch:'workbook-copy.spec.ts',workers:1,fullyParallel:false,timeout:45000,maxFailures:1,
  use:{baseURL:process.env.FNT_WORKBOOK_COPY_URL,headless:true,screenshot:'only-on-failure',serviceWorkers:'block'},
  projects:[{name:'desktop',use:{viewport:{width:1280,height:770}}},{name:'touch',use:{viewport:{width:390,height:770},isMobile:true,hasTouch:true}}],
  reporter:[['json',{outputFile:`publication-native-${process.env.FNT_PUBLICATION_RUN}.json`}]],outputDir:`publication-results-${process.env.FNT_PUBLICATION_RUN}`,
});
