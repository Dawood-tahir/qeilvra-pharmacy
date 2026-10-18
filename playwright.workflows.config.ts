import { defineConfig } from "@playwright/test";
export default defineConfig({
 testDir:"./tests/workflows",fullyParallel:true,workers:3,reporter:[["list"],["html",{outputFolder:"playwright-report/workflows",open:"never"}]],
 use:{baseURL:"http://127.0.0.1:4173",trace:"retain-on-failure"},
 webServer:{command:"node scripts/ui-test-server.mjs",url:"http://127.0.0.1:4173",reuseExistingServer:!process.env.CI,timeout:60000},
 projects:[320,360,390,430,768,1024,1440].map(width=>({name:"width-"+width,use:{viewport:{width,height:width<768?844:1000},hasTouch:width<1024}})),
});
