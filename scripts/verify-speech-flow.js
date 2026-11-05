import fs from 'node:fs';
import assert from 'node:assert/strict';
import express from 'express';
import 'dotenv/config';
// Temporary tables require a dedicated session, not a transaction pooler.
process.env.DATABASE_URL=process.env.DATABASE_URL?.replace('-pooler.','.');
process.env.PG_POOL_MAX='1';
process.env.DATABASE_BACKEND='postgres';
const {getPostgresPool,ensurePostgresSchema,closePostgresPool}=await import('../server/postgres.js');
const {installAuth,hashPassword}=await import('../server/auth.js');
const {installSpeechRoutes}=await import('../server/speechAnalytics.js');
const rows=JSON.parse(fs.readFileSync('reference/speech/source-rows.json','utf8').replace(/^\uFEFF/,''));
await ensurePostgresSchema();const pool=getPostgresPool();
await pool.query('CREATE TEMP TABLE shared_records(key text PRIMARY KEY,value text,updated_at timestamptz DEFAULT now())');
const password='test-speech-session-only';
const users=[['admin','admin','entel_b2b'],['analyst','analista','entel_b2b'],['reader','supervisor','entel_b2b'],['other','admin','culqi_bcp']].map(([usuario,rol,platform])=>({usuario,rol,estado:'activo',platformAccess:[platform],passwordHash:hashPassword(password)}));
await pool.query('INSERT INTO shared_records(key,value) VALUES($1,$2)',['users_v1',JSON.stringify(users)]);
for(const key of ['evaluations_v1','feedback_records_v2','sales_validations_v1','staffing'])await pool.query('INSERT INTO shared_records(key,value) VALUES($1,$2)',[key,'[]']);
const app=express();installAuth(app,express.json());app.use(express.json({limit:'20mb'}));installSpeechRoutes(app);app.use((e,req,res,next)=>res.status(e.status||500).json({ok:false,error:e.message}));
app.use(express.static('public'));
app.get('/test-speech',(req,res)=>res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/speech-analytics.css"><style>body{margin:0;background:#08080d;font-family:Arial;padding:24px;box-sizing:border-box}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script><script src="/speech-model.js"></script><script src="/speech-analytics.js"></script><script>ReactDOM.render(React.createElement(SpeechAnalytics,{currentUser:{rol:'admin',platformAccess:['entel_b2b']}}),document.getElementById('root'))</script></body></html>`));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
async function login(usuario){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({usuario,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
async function send(cookie,payload){const r=await fetch(base+'/api/speech-analytics/import',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({kind:'no_venta',file:'sample.xlsx',rows,...payload})});return {status:r.status,data:await r.json()};}
try{
 const cookie=await login('admin');
 const preview=await send(cookie,{});assert.equal(preview.data.newCount,30);assert.equal(preview.data.errors.length,0);
 assert.equal((await pool.query('SELECT key FROM shared_records WHERE key=$1',['speech_analytic_entel_no_venta_v1'])).rowCount,0);
 assert.equal((await send(cookie,{commit:true})).status,400);
 const committed=await send(cookie,{commit:true,allowUnmatched:true});assert.equal(committed.status,200);
 const duplicate=await send(cookie,{commit:true,allowUnmatched:true});assert.equal(duplicate.data.newCount,0);assert.equal(duplicate.data.duplicates,30);
 const changed=rows.map((r,i)=>i? r:{...r,Asesor:'Changed'});assert.equal((await send(cookie,{rows:changed,commit:true,allowUnmatched:true})).status,400);
 const reader=await login('reader');const data=await(await fetch(base+'/api/speech-analytics',{headers:{cookie:reader}})).json();assert.equal(data.records.length,30);
 const stats=globalThis.SpeechModel.summary(data.records);assert.equal(stats.advisors.length,18);assert.ok(Math.abs(stats.average-73.14)<0.001);assert.equal(stats.critical,2);assert.equal(stats.passed,2);
 assert.equal((await send(reader,{commit:true,allowUnmatched:true})).status,403);
 const other=await login('other');assert.equal((await fetch(base+'/api/speech-analytics',{headers:{cookie:other}})).status,403);
 for(const key of ['evaluations_v1','feedback_records_v2','sales_validations_v1','staffing'])assert.equal((await pool.query('SELECT value FROM shared_records WHERE key=$1',[key])).rows[0].value,'[]');
 console.log(JSON.stringify({ok:true,preview:30,imported:data.records.length,advisors:stats.advisors.length,average:stats.average,critical:stats.critical,duplicatesSkipped:30,operationalDataUntouched:true,permissions:'PASS'}));
 if(process.argv.includes('--browser')){
  const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
  const {chromium}=require(process.env.CODEX_NODE_MODULES+'/playwright');
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   await context.addCookies([{name:'calidad_session',value:cookie.split('=')[1],url:base}]);
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/test-speech');await page.getByText('30',{exact:true}).first().waitFor();
   assert.equal(await page.locator('.sa-kpis strong').first().innerText(),'30');
   await page.getByLabel('Desde',{exact:true}).fill('2026-10-19');
   await page.waitForFunction(()=>document.querySelector('.sa-kpis strong')?.textContent==='11');
   await page.getByRole('button',{name:'Limpiar',exact:true}).click();
   await page.getByRole('button',{name:'Llamadas',exact:true}).click();
   await page.getByRole('button',{name:'Ver analisis',exact:true}).first().click();
   await page.getByRole('dialog').waitFor();assert.ok(await page.getByText('Ficha de calidad',{exact:true}).isVisible());
   await page.screenshot({path:'reference/speech/detail-desktop.png',fullPage:false});
   await page.getByRole('button',{name:'Cerrar',exact:true}).click();
   await page.getByRole('button',{name:'Resultados globales',exact:true}).click();
   await page.screenshot({path:'reference/speech/dashboard-desktop.png',fullPage:true});
   await page.getByRole('button',{name:'Validacion de venta',exact:true}).click();
   await page.getByText('Pendiente de configurar la plantilla',{exact:false}).waitFor();
   await page.getByRole('button',{name:'No venta',exact:true}).click();
   await page.locator('input[type=file]').setInputFiles(process.env.SPEECH_SAMPLE_XLSX);
   await page.getByRole('dialog').waitFor();await page.getByText('30 filas · 0 nuevas · 30 duplicadas',{exact:false}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Confirmar importacion',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Cerrar',exact:true}).click();
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:'reference/speech/dashboard-mobile.png',fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Page overflows horizontally');
   assert.deepEqual(errors,[]);
   console.log('Browser PASS: actual Excel preview, duplicate prevention, date filter, detail, both tabs, desktop and mobile without overflow or JS errors.');
  }finally{await browser.close();}
 }
}finally{await new Promise(r=>server.close(r));await pool.query('DROP TABLE IF EXISTS pg_temp.shared_records');await closePostgresPool();}
