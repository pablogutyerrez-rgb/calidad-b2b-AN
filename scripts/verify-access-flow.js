import assert from 'node:assert/strict';
import express from 'express';
process.env.PG_POOL_MAX='1';
const {getPostgresPool,ensurePostgresSchema,closePostgresPool}=await import('../server/postgres.js');
const {installAuth,hashPassword}=await import('../server/auth.js');
const {updateUserAccess}=await import('../server/userAccess.js');
await ensurePostgresSchema();
const pool=getPostgresPool();
// Session-local table shadows production data for this isolated integration test.
await pool.query('CREATE TEMP TABLE shared_records (key text PRIMARY KEY,value text,updated_at timestamptz DEFAULT now())');
const users=[{usuario:'test.admin',rol:'admin',passwordHash:hashPassword('test-only-password'),estado:'activo'},
 {usuario:'test.advisor',rol:'analista',passwordHash:hashPassword('test-only-password'),estado:'activo',platformAccess:['entel_b2b'],staffingAccess:false}];
await pool.query('INSERT INTO shared_records(key,value) VALUES($1,$2)',['users_v1',JSON.stringify(users)]);
const app=express();installAuth(app,express.json());app.use(express.json());
app.patch('/api/users/:username/access',async(req,res,next)=>{try{res.json({ok:true,user:await updateUserAccess(req.authUser,req.params.username,req.body)});}catch(e){next(e);}});
app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
async function login(usuario){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({usuario,password:'test-only-password'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
try{
 const cookie=await login('test.admin');
 for(const patch of [{platformAccess:['entel_b2b','culqi_bcp','desarrollo_comercial']},{staffingAccess:true}]){
  const r=await fetch(base+'/api/users/test.advisor/access',{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(patch)});
  assert.equal(r.status,200);
 }
 const advisorCookie=await login('test.advisor');
 const session=await (await fetch(base+'/api/auth/session',{headers:{cookie:advisorCookie}})).json();
 assert.equal(session.user.platformAccess.length,3);assert.equal(session.user.staffingAccess,true);assert.equal(session.user.passwordHash,undefined);
 const denied=await fetch(base+'/api/users/test.advisor/access',{method:'PATCH',headers:{cookie:advisorCookie,'content-type':'application/json'},body:JSON.stringify({staffingAccess:false})});
 assert.equal(denied.status,403);
 const saved=JSON.parse((await pool.query('SELECT value FROM shared_records WHERE key=$1',['users_v1'])).rows[0].value);
 assert.equal(saved[1].passwordHash,users[1].passwordHash);assert.deepEqual(saved[0],users[0]);
 console.log('PASS: login admin -> two access edits -> DB -> login target -> session reload; non-admin denied; credentials preserved. Production users untouched.');
}finally{await new Promise(r=>server.close(r));await closePostgresPool();}
