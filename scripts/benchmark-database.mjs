import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
// Fixed loopback address and a unique disposable database: never reads production credentials.
const bin=process.env.PG_BIN ?? (process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':''),data=path.resolve('.local-test-db');
const executable=name=>bin?path.join(bin,name+(process.platform==='win32'?'.exe':'')):name;
fs.mkdirSync('.private',{recursive:true});
const run=(name,args,input)=>execFileSync(executable(name),args,{encoding:'utf8',input,windowsHide:true,stdio:['pipe','pipe','pipe']});
const base=['-h','127.0.0.1','-p','55439','-U','postgres'];
const db='qeilvra_perf_'+process.pid;let started=false,created=false;
const sql=text=>run('psql',[...base,'-d',db,'-v','ON_ERROR_STOP=1','-Atq'],text);
const file=name=>sql(fs.readFileSync(name,'utf8'));
const stats=a=>({n:a.length,median:a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)],p95:a.toSorted((a,b)=>a-b)[Math.ceil(a.length*.95)-1]});
try{
 if(!fs.existsSync(path.join(data,'PG_VERSION')))run('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);
 try{run('pg_ctl',['-D',data,'status'])}catch{execFileSync(executable('pg_ctl'),['-D',data,'-l',path.resolve('.local-test-db.log'),'-o','-p 55439 -h 127.0.0.1','start'],{windowsHide:true,stdio:'ignore'});started=true}
 run('createdb',[...base,db]);created=true;file('tests/database/bootstrap.sql');
 const migrations=fs.readdirSync('supabase/migrations').sort();
 for(const name of migrations)if(name<'202610190010')file('supabase/migrations/'+name);
 file('tests/database/contracts.sql');
 sql(`reset role;
 insert into public.medicines(id,name,sku,selling_price,base_unit,dosage_form,packaging_status,created_by)
 select md5('perf-medicine-'||g)::uuid,'Perf Medicine '||lpad(g::text,5,'0'),'PERF-'||g,7,'tablet','Tablet','confirmed','10000000-0000-0000-0000-000000000001' from generate_series(1,10000)g;
 insert into public.medicine_units(medicine_id,unit_key,label,base_quantity,selling_price)
 select id,'base','tablet',1,7 from public.medicines where sku like 'PERF-%';
 insert into public.medicine_batches(medicine_id,batch_number,expiry_date,quantity_on_hand,purchase_cost)
 select m.id,'PERF-'||g,current_date+g*90,100,2 from public.medicines m cross join generate_series(1,5)g where m.sku like 'PERF-%';
 insert into public.sales(id,invoice_number,idempotency_key,subtotal,net_total,created_by,completed_at)
 select md5('perf-sale-'||g)::uuid,'PERF-'||g,md5('perf-key-'||g)::uuid,7,7,'20000000-0000-0000-0000-000000000002',now()-g*interval '2 minutes' from generate_series(1,5000)g;
 insert into public.sale_items(sale_id,medicine_id,medicine_name,medicine_sku,quantity,unit_price,line_total,selling_unit,unit_label,base_units_per_sale_unit,base_quantity,net_line_total)
 select s.id,m.id,m.name,m.sku,1,7,7,'base','tablet',1,1,7 from public.sales s cross join lateral(select id,name,sku from public.medicines where sku='PERF-1')m where s.invoice_number like 'PERF-%';
 insert into public.sale_item_costs(sale_item_id,batch_id,quantity,unit_cost)
 select si.id,b.id,1,2 from public.sale_items si join public.sales s on s.id=si.sale_id cross join lateral(select id from public.medicine_batches where medicine_id=si.medicine_id order by id limit 1)b where s.invoice_number like 'PERF-%';
 analyze;`);
 const auth="set role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);";
 const queries={inventory:"select * from public.inventory_search('',30)",medicine_search:"select * from public.inventory_search('Perf Medicine 099',30)",metrics:"select public.owner_dashboard_metrics(current_date-30,current_date)",trend:"select * from public.owner_sales_trend(current_date-30,current_date)",returns:"select * from public.return_sales('',null,0,11,null)"};
 const report={dataset:{medicines:10000,batches:50000,sales:5000,costAllocations:5000},conditions:'Disposable PostgreSQL 18; execution time from EXPLAIN ANALYZE, no network',before:{},after:{}};
 for(const phase of ['before','after']){
  if(process.env.ANALYTICS_ONLY==='1'&&phase==='before')continue;
  if(phase==='after')for(const name of fs.readdirSync('supabase/migrations').sort())if(name>='202610190010')file('supabase/migrations/'+name);
  if(phase==='after'){
   const today="(now() at time zone 'Asia/Karachi')::date";
   queries.financial_today="select public.owner_financial_analytics("+today+","+today+",'hour')";
   queries.financial_week="select public.owner_financial_analytics(date_trunc('week',now() at time zone 'Asia/Karachi')::date,"+today+")";
   queries.financial_month="select public.owner_financial_analytics(date_trunc('month',now() at time zone 'Asia/Karachi')::date,"+today+")";
   queries.financial_year="select public.owner_financial_analytics("+today+"-365,"+today+")";
  }
  for(const [key,query]of Object.entries(queries)){
   if(process.env.ANALYTICS_ONLY==='1'&&!key.startsWith('financial_'))continue;
   const values=[];
   for(let i=0;i<21;i++){const out=sql(auth+'explain (analyze,format json) '+query);const start=out.indexOf('[');const plan=JSON.parse(out.slice(start));if(i)values.push(plan[0]['Execution Time']);}
   report[phase][key]=stats(values);console.log(phase+' '+key+' '+JSON.stringify(report[phase][key]));
   fs.writeFileSync('.private/performance-database.json',JSON.stringify(report,null,2));
  }
  if(phase==='before' && process.env.AUDIT_BASELINE_ONLY==='1')break;
 }
}finally{try{if(created)run('dropdb',[...base,'--force',db])}finally{if(started)run('pg_ctl',['-D',data,'stop','-m','fast'])}}
