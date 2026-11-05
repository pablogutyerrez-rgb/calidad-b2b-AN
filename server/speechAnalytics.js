import '../public/speech-model.js';
import {randomUUID} from 'node:crypto';
import {getPostgresPool,ensurePostgresSchema} from './postgres.js';
import {getDatabaseBackend} from './database.js';
import {buildSpeechEvaluation,speechEvaluationId,resolveSpeechAdvisor} from './speechEvaluations.js';
import {buildEvaluationIndexRecord,invalidateFirebaseCache,withSpeechEvaluationWriteLock} from './gasHandlers.js';

const model=globalThis.SpeechModel;
const dataKey='speech_analytic_entel_no_venta_v1';
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function authorize(user,write=false){if(!(write?model.canImport(user):model.canRead(user)))fail('No tienes acceso a Speech analytic de Entel.',403);if(getDatabaseBackend(dataKey)!=='postgres')fail('Speech analytic requiere PostgreSQL.',503);}
function decode(row){if(!row)return {records:[],imports:[]};const value=JSON.parse(row.value);if(!Array.isArray(value.records)||!Array.isArray(value.imports))fail('Datos de Speech analytic invalidos.',500);return value;}
export async function listSpeech(user){
  authorize(user);await ensurePostgresSchema();
  const result=await getPostgresPool().query('SELECT value FROM shared_records WHERE key=$1',[dataKey]);
  return decode(result.rows[0]);
}
export async function importSpeech(user,payload){
  return withSpeechEvaluationWriteLock(()=>importSpeechTransaction(user,payload));
}
async function importSpeechTransaction(user,payload){
  authorize(user,true);
  if(payload?.kind!=='no_venta')fail('La plantilla de Validacion de venta aun no esta configurada.');
  const parsed=model.parseRows(payload.rows);
  await ensurePostgresSchema();
  const db=await getPostgresPool().connect();
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(782632)');
    const current=decode((await db.query('SELECT value FROM shared_records WHERE key=$1 FOR UPDATE',[dataKey])).rows[0]);
    const plan=model.planImport(parsed.rows,current.records);
    const read=async key=>{const result=await db.query('SELECT value FROM shared_records WHERE key=$1 FOR UPDATE',[key]);return result.rows[0]?JSON.parse(result.rows[0].value):[];};
    const staffing=await read('staffing'),users=await read('users_v1');
    const evaluations=await read('evaluations_v1'),feedbacks=await read('feedback_records_v2'),deleted=await read('deleted_evaluations_v1');
    const occupied=new Set([...evaluations,...deleted].map(e=>String(e?.id||e?.idEvaluacion||e)));
    const candidates=model.uniqueCalls(parsed.rows).filter(r=>!occupied.has(speechEvaluationId(r)));
    const unmatched=[...new Set(candidates.filter(r=>resolveSpeechAdvisor(r,staffing,users).pending).map(r=>r.advisor))];
    const batch={id:randomUUID(),file:String(payload.file||'Importacion Excel').slice(0,250),createdAt:new Date().toISOString(),createdBy:user.usuario,count:plan.added.length,duplicates:plan.duplicates.length};
    const generated=candidates.map(row=>buildSpeechEvaluation({row,user,staffing,users,batch,now:batch.createdAt}));
    const feedbackIds=new Set(feedbacks.map(f=>String(f.id)));
    for(const {feedback} of generated)if(feedback){if(feedbackIds.has(String(feedback.id)))fail('Conflicto de identificador de feedback; no se guardo la carga.');feedbackIds.add(String(feedback.id));}
    const report={total:payload.rows.length,valid:parsed.rows.length,newCount:plan.added.length,duplicates:plan.duplicates.length,conflicts:plan.conflicts,errors:parsed.errors,unmatched,warnings:parsed.rows.flatMap(r=>r.warnings.map(message=>({row:r.row,message}))),sample:plan.added.slice(0,5)};
    Object.assign(report,{evaluationCount:generated.length,feedbackCount:generated.filter(g=>g.feedback).length,pendingCriteria:[...new Set(generated.flatMap(g=>g.evaluation.saPendingCriteria))]});
    if(payload.commit!==true){await db.query('ROLLBACK');return {...report,committed:false};}
    if(parsed.errors.length||plan.conflicts.length)fail('Corrige filas invalidas o conflictos antes de importar.');
    if(unmatched.length&&!payload.allowUnmatched)fail('Confirma los asesores sin coincidencia en Dotacion.');
    if(!plan.added.length&&!generated.length){await db.query('ROLLBACK');return {...report,committed:true};}
    batch.evaluationCount=generated.length;batch.feedbackCount=report.feedbackCount;
    const next={records:[...current.records,...plan.added.map(r=>({...r,importId:batch.id,importedAt:batch.createdAt,importedBy:user.usuario,clientId:'entel_b2b'}))],imports:[batch,...current.imports]};
    const write=async(key,value)=>db.query('INSERT INTO shared_records(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',[key,JSON.stringify(value)]);
    if(generated.length){
      for(const {evaluation} of generated)await write('evaluation_record_'+evaluation.id,evaluation);
      await write('evaluations_v1',[...generated.map(g=>buildEvaluationIndexRecord(g.evaluation)),...evaluations]);
      if(report.feedbackCount)await write('feedback_records_v2',[...generated.map(g=>g.feedback).filter(Boolean),...feedbacks]);
    }
    await db.query('INSERT INTO shared_records(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',[dataKey,JSON.stringify(next)]);
    await db.query('COMMIT');invalidateFirebaseCache('evaluations_v1','feedback_records_v2',...generated.map(g=>'evaluation_record_'+g.evaluation.id));return {...report,committed:true};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export function installSpeechRoutes(app){
  app.get('/api/speech-analytics',async(req,res,next)=>{try{res.json({ok:true,...await listSpeech(req.authUser)});}catch(e){next(e);}});
  app.post('/api/speech-analytics/import',async(req,res,next)=>{try{res.json({ok:true,...await importSpeech(req.authUser,req.body)});}catch(e){next(e);}});
}
