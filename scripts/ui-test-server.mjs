import { createServer } from "vite";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root=process.cwd();
const baseline=process.argv.includes("--baseline");
const port=baseline?4174:4173;
const server=await createServer({
 configFile:false, root:path.join(root,"tests/ui"), logLevel:"warn",
 plugins:baseline?[{name:"original-tracked-source",enforce:"pre",load(id){
  const relative=path.relative(root,id.split("?")[0]).replaceAll("\\","/");
  if(!/^(app|components|lib)\//.test(relative)||!/\.(tsx?|css)$/.test(relative))return;
  try{return execFileSync("git",["show","HEAD:"+relative],{cwd:root,encoding:"utf8",windowsHide:true});}catch{return;}
 }}]:[],
 resolve:{ alias:[
  { find:"@/app/(app)/medicines/actions",replacement:path.join(root,"tests/ui/actions.ts") },
  ...["purchases", "returns", "expenses", "suppliers", "settings", "users", "stock"].map((name) => ({ find: "@/app/(app)/" + name + "/actions", replacement: path.join(root, "tests/ui/actions.ts") })),
  { find:"@/lib/auth",replacement:path.join(root,"tests/ui/auth.ts") },
  { find:"@/lib/supabase/server",replacement:path.join(root,"tests/ui/supabase.ts") },
  { find:"next/link",replacement:path.join(root,"tests/ui/link.tsx") },
  { find:"next/dynamic",replacement:path.join(root,"tests/ui/dynamic.tsx") },
  { find:"next/form",replacement:path.join(root,"tests/ui/form.tsx") },
  { find:"next/navigation",replacement:path.join(root,"tests/ui/navigation.ts") },
  { find:"@",replacement:root },
 ] },
 esbuild:{jsx:"automatic"},
 server:{host:"127.0.0.1",port,strictPort:true,fs:{allow:[root]}},
});
await server.listen();
console.log(`Isolated ${baseline?"original HEAD ":""}UI test harness: http://127.0.0.1:${port}`);
