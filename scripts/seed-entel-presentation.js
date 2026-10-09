import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {getDatabaseBackend} from '../server/database.js';
import {getPostgresPool,ensurePostgresSchema,closePostgresPool} from '../server/postgres.js';
import {hashPassword,verifyPassword} from '../server/auth.js';
import {normalizeEvaluationSections,calculateEvaluationScore,applyRedistributedSectionScores,buildEvaluationIndexRecord,buildAutomaticFeedbackRecord} from '../server/gasHandlers.js';

const batch='entel-presentation-apr-sep-2026-v1';
const input=process.argv[2];
const commit=process.argv.includes('--commit');
assert.ok(input,'Indica el archivo Excel');
assert.equal(getDatabaseBackend(),'postgres');
const source=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',path.resolve('scripts/read-staffing-excel.ps1'),'-Path',input],{encoding:'utf8'}).replace(/^\uFEFF/,''));
const clean=value=>String(value??'').trim();
const key=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const tag={clientId:'entel_b2b',platformId:'entel_b2b',clientName:'Entel Empresas B2B',platformName:'Entel Empresas B2B'};
const demo={...tag,isDemo:true,demoBatch:batch};
await ensurePostgresSchema();
const db=await getPostgresPool().connect();
try {
 await db.query('BEGIN');
 await db.query("SELECT pg_advisory_xact_lock(782631)");
 const original=await db.query('SELECT key,value FROM shared_records ORDER BY key FOR UPDATE');
 const records=new Map(original.rows.map(row=>[row.key,JSON.parse(row.value)]));
 if(records.has(batch)){console.log(JSON.stringify({alreadyLoaded:true,...records.get(batch)}));await db.query('ROLLBACK');}
 else {
  const users=structuredClone(records.get('users_v1')||[]);
  const staffing=structuredClone(records.get('staffing')||[]);
  const evaluations=structuredClone(records.get('evaluations_v1')||[]);
  const feedbacks=structuredClone(records.get('feedback_records_v2')||[]);
  const advisors=[];const usernames=new Set();const documents=new Set();
  for(const row of source){
   const dni=clean(row.Dni).padStart(8,'0');const usuario=clean(row['Usuario Calidad']);const password=clean(row.Clave);const nombre=clean(row.Ejecutivo);
   assert.match(dni,/^\d{8}$/,'DNI invalido');assert.ok(nombre,`Falta nombre en fila ${advisors.length+2}`);
   assert.equal(Boolean(usuario),Boolean(password),'Credenciales incompletas');
   assert.ok(!documents.has(dni),'DNI repetido');if(usuario)assert.ok(!usernames.has(key(usuario)),'Usuario repetido');
   documents.add(dni);if(usuario)usernames.add(key(usuario));
   const campaign=clean(row.Ruc).toUpperCase().replace(/RUC\s*/, 'RUC ');assert.ok(['RUC 10','RUC 20'].includes(campaign),`Campana invalida: ${campaign}`);
   const previous=users.find(user=>key(user.usuario)===key(usuario));
   if(previous){assert.equal(previous.rol,'asesor');assert.ok(!previous.dni||previous.dni===dni);assert.ok(verifyPassword(password,previous),'La contrasena existente difiere del Excel; no se sobrescribe.');}
   else if(usuario) users.push({...tag,id:usuario,usuario,nombre,assessorName:nombre.toUpperCase(),dni,rol:'asesor',estado:'activo',platformAccess:['entel_b2b'],passwordHash:hashPassword(password),mustChangePassword:true,correo:clean(row['Correo Coorp']||row['Correo P']),createdAt:new Date().toISOString()});
   const advisor={...tag,asesor:nombre.toUpperCase(),dni,usuarioAsignado:usuario,supervisor:clean(row['Lider']||row['Líder']),coordinador:clean(row.Coodinador),antiguedad:parseInt(row['Antigüedad'])||0,tipoGestionRuc:campaign,campaign,estado:'activo',celular:clean(row.Celular),correoPersonal:clean(row['Correo P']),correoCorporativo:clean(row['Correo Coorp']),createdAt:new Date().toISOString()};
   const old=staffing.find(item=>(item.clientId||'entel_b2b')==='entel_b2b'&&(item.dni===dni||key(item.asesor)===key(advisor.asesor)));
   if(old){assert.equal(old.dni,dni);assert.equal(key(old.asesor),key(advisor.asesor));advisors.push(old);}else{staffing.push(advisor);advisors.push(advisor);}
  }
  const credentials=[];
  const monitors=[['Adrian.Chero','Adrian Chero'],['Milagros.Flores','Milagros Flores']].map(([usuario,nombre])=>{
   const existing=users.find(user=>key(user.usuario)===key(usuario));
   if(existing){assert.ok(['analista','monitor'].includes(existing.rol));assert.ok((existing.platformAccess||[existing.clientId]).includes('entel_b2b'));return existing;}
   const password=randomBytes(12).toString('base64url');
   const user={...tag,id:usuario,usuario,nombre,rol:'analista',cargo:'Monitor de calidad',area:'Monitor de calidad',estado:'activo',platformAccess:['entel_b2b'],mustChangePassword:true,passwordHash:hashPassword(password),createdAt:new Date().toISOString()};
   users.push(user);credentials.push({usuario,password});return user;
  });
  let randomState=20260401;
  const rand=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  const generated=[];const generatedFeedbacks=[];
  const feedbackIndices=new Set();
  for(let j=0;j<212;j++)feedbackIndices.add(2*Math.floor(j*311/212));
  for(let j=0;j<211;j++)feedbackIndices.add(2*Math.floor(j*310/211)+1);
  for(let i=0;i<621;i++){
   const month=3+Math.floor(i*6/621);const days=new Date(Date.UTC(2026,month+1,0)).getUTCDate();
   const date=new Date(Date.UTC(2026,month,1+Math.floor(rand()*days),14+Math.floor(rand()*8),Math.floor(rand()*60),i%60)).toISOString();
   const advisor=advisors[i%advisors.length];const monitor=monitors[i%2];const type=i%4===0?'no_venta':'venta';
   const sections=normalizeEvaluationSections([],type).map(section=>({...section,resultado:section.pesoSub===0?'No aplica':rand()<0.04?'No aplica':rand()<0.8?'Cumple':'No cumple',detalleAuditado:'Escenario simulado para demostracion comercial.',oportunidadMejora:'Practicar el criterio de calidad en sesiones de entrenamiento.'}));
   const score=calculateEvaluationScore(sections,type);
   const id=`DEMO-ENTEL-2026-${String(i+1).padStart(4,'0')}`;
   const evaluation={...demo,id,idEvaluacion:id,asesorId:advisor.usuarioAsignado,advisorUser:advisor.usuarioAsignado,asesorNombre:advisor.asesor,auditorId:monitor.usuario,auditorNombre:monitor.nombre,supervisor:advisor.supervisor,coordinador:advisor.coordinador,campaign:advisor.campaign,tipoGestionRuc:advisor.campaign,evaluationFormType:type,tipoFicha:type==='venta'?'Venta':'No venta',evaluationMode:'operacion',fechaEvaluacion:date,createdAt:date,updatedAt:date,estadoEvaluacion:'closed',estadoAdjuntos:'sin_adjuntos',files:[],zeroToleranceItems:[],secciones:applyRedistributedSectionScores(sections,score.applicableWeight),pesoAplicable:score.applicableWeight,puntajeLogrado:score.achievedWeight,puntajeLogradoBruto:score.rawAchievedWeight,resultadoGeneral:score.text,detalleAuditadoGeneral:'DATOS DE DEMOSTRACION. Caso simulado; no corresponde a una llamada real.',oportunidadMejoraGeneral:'Reforzar los criterios no cumplidos mediante practica guiada.',observacionGeneral:'Evaluacion simulada para presentacion comercial.'};
   if(feedbackIndices.has(i)){
    const feedbackId=`DEMO-FB-2026-${String(i+1).padStart(4,'0')}`;
    const acceptedAt=new Date(Date.parse(date)+3600000).toISOString();
    const managedAt=new Date(Date.parse(date)+(2+Math.floor(rand()*19))*3600000).toISOString();
    const feedback={...buildAutomaticFeedbackRecord({evaluation,currentUser:monitor,role:'analista',clientId:'entel_b2b',evaluationId:id,now:date,id:feedbackId}),...demo,managementStatus:'feedback_completed',status:'feedback_completed',estado:'feedback_completed',advisorAcceptedAt:acceptedAt,advisorValidationStatus:'accepted',advisorAcceptedBy:advisor.usuarioAsignado,managedAt,managedBy:monitor.usuario,managedByName:monitor.nombre,updatedAt:managedAt,compromisoMejora:'Compromiso SIMULADO para demostracion; no registrado por el asesor.',files:[],messages:[]};
    evaluation.feedbackId=feedbackId;generatedFeedbacks.push(feedback);
   }
   assert.ok(score.pct>=0&&score.pct<=100.000001);generated.push(evaluation);
  }
  assert.equal(generated.length,621);assert.equal(generatedFeedbacks.length,423);
  assert.equal(new Set(generated.map(e=>e.id)).size,621);
  assert.ok(!generated.some(e=>evaluations.some(old=>String(old.id)===e.id)),'IDs existentes: no se sobrescriben');
  assert.ok(!generatedFeedbacks.some(e=>feedbacks.some(old=>String(old.id)===e.id)),'Feedback existente');
  const report={batch,advisors:advisors.length,evaluations:generated.length,feedbacks:generatedFeedbacks.length,byMonitor:monitors.map(m=>({usuario:m.usuario,evaluations:generated.filter(e=>e.auditorId===m.usuario).length,feedbacks:generatedFeedbacks.filter(f=>f.auditorId===m.usuario).length})),months:Object.fromEntries([4,5,6,7,8,9].map(m=>[m,generated.filter(e=>new Date(e.fechaEvaluacion).getUTCMonth()+1===m).length]))};
  if(commit){
   const backup=path.resolve('reference',batch);await fs.mkdir(backup,{recursive:true});
   await fs.writeFile(path.join(backup,'database-before.json'),JSON.stringify(original.rows),{flag:'wx'});
   await fs.writeFile(path.join(backup,'monitor-access.json'),JSON.stringify(credentials,null,2),{flag:'wx'});
   const entries=[['staffing',staffing],['users_v1',users],['evaluations_v1',[...evaluations,...generated.map(buildEvaluationIndexRecord)]],['feedback_records_v2',[...feedbacks,...generatedFeedbacks]],[batch,report],...generated.map(e=>['evaluation_record_'+e.id,e])];
   for(const [name,value] of entries)await db.query('INSERT INTO shared_records(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',[name,JSON.stringify(value)]);
   await db.query('COMMIT');console.log(JSON.stringify({committed:true,...report}));
  }else{await db.query('ROLLBACK');console.log(JSON.stringify({dryRun:true,...report}));}
 }
}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();await closePostgresPool();}
