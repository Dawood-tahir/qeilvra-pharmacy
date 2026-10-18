import { createServer } from "vite";
import path from "node:path";
const root=process.cwd();
const server=await createServer({
 configFile:false, root:path.join(root,"tests/ui"), logLevel:"warn",
 resolve:{ alias:[
  { find:"@/app/(app)/medicines/actions",replacement:path.join(root,"tests/ui/actions.ts") },
  { find:"@/lib/auth",replacement:path.join(root,"tests/ui/auth.ts") },
  { find:"@/lib/supabase/server",replacement:path.join(root,"tests/ui/supabase.ts") },
  { find:"next/link",replacement:path.join(root,"tests/ui/link.tsx") },
  { find:"@",replacement:root },
 ] },
 esbuild:{jsx:"automatic"},
 server:{host:"127.0.0.1",port:4173,strictPort:true,fs:{allow:[root]}},
});
await server.listen();
console.log("Isolated UI test harness: http://127.0.0.1:4173");
