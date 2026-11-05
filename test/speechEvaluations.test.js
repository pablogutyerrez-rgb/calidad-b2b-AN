import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSpeechEvaluation,speechEvaluationId} from '../server/speechEvaluations.js';
import {buildEvaluationIndexRecord,completeAutomaticFeedback,calculateEvaluationScore} from '../server/gasHandlers.js';

const row={id:'a1',file:'call.mp3',advisor:'Ana Perez',version:'V2',callDate:'2026-10-19',score:99,critical:false,source:{
  'NV-1.1 Saludo':'Si','NV-1.2 Validacion':'No','NV-2.1 Sondeo':'No aplica','NV-3.1 Oferta':'Si','NV-3.2 Plan':'No','NV-3.3 Entrega':'No aplica',
  'NV-4.1 Objeciones':'Si','NV-5.1 Cierre':'Si','NV-5.2 Siguiente paso':'Si','NV-6.1 Escucha':'Si','NV-6.2 Tono':'Si',
  'NV-3.2 Plan — por qu\u00e9':'No menciona IGV','NV-3.2 Plan — minuto':'01:42'}};
const user={usuario:'Monitor.Uno',nombre:'Monitor Uno',rol:'analista',platformAccess:['entel_b2b']};
const advisor={usuario:'Ana.Perez',nombre:'Ana Perez',rol:'asesor',platformAccess:['entel_b2b']};
const opts={row,user,staffing:[{asesor:'ANA PEREZ',usuarioAsignado:'Ana.Perez',clientId:'entel_b2b'}],users:[user,advisor],batch:{id:'batch1',createdAt:'2026-11-04T20:00:00Z'},now:'2026-11-04T20:00:00Z'};
test('SA maps only equivalent PUE criteria and preserves original score and evidence',()=>{
 const {evaluation:e,feedback:f}=buildSpeechEvaluation(opts);
 assert.equal(e.source,'speech_analytic');assert.equal(e.auditorId,user.usuario);assert.equal(e.advisorUser,advisor.usuario);assert.equal(e.pendingAdvisorCreation,false);
 assert.deepEqual(e.saPendingCriteria,['6.2 Tipificacion y sistemas']);
 assert.equal(e.secciones.find(s=>s.nombreSeccion.startsWith('6.2')).resultado,'');
 assert.match(e.secciones.find(s=>s.nombreSeccion.startsWith('3.2')).evidencia,/01:42/);
 assert.equal(e.saOriginalScore,99);assert.equal(e.puntajeLogrado,calculateEvaluationScore(e.secciones,'no_venta').pct);
 assert.equal(f.managementStatus,'pending_feedback');assert.equal(f.sourceEvaluationId,e.id);assert.equal(f.authorUser,user.usuario);assert.ok(Number.isSafeInteger(f.id));assert.equal(e.feedbackId,f.id);
 const index=buildEvaluationIndexRecord(e);assert.equal(index.saImportId,'batch1');assert.equal(index.source,'speech_analytic');assert.equal(index.pendingAdvisorCreation,false);
 assert.throws(()=>completeAutomaticFeedback(f,user));assert.equal(completeAutomaticFeedback({...f,managementStatus:'advisor_accepted'},user).managementStatus,'feedback_completed');
});
test('missing and ambiguous advisors remain unassigned; no cross-client or fuzzy matches',()=>{
 for(const users of [[],[{...advisor,platformAccess:['culqi_bcp']}],[advisor,{...advisor,usuario:'another'}]]){
  const {evaluation:e,feedback:f}=buildSpeechEvaluation({...opts,staffing:[],users});assert.equal(e.pendingAdvisorCreation,true);assert.equal(e.advisorUser,'');assert.equal(f.advisorUser,'');assert.equal(f.pendingAdvisorCreation,true);
 }
});
test('SA feedback follows role and per-importer blocking, not advisor blocking',()=>{
 for(const rol of ['admin','analista','monitor','supervisor','coordinador'])assert.ok(buildSpeechEvaluation({...opts,user:{...user,rol}}).feedback);
 assert.equal(buildSpeechEvaluation({...opts,users:[{...user,feedbacksBlocked:true},advisor]}).feedback,null);
 assert.ok(buildSpeechEvaluation({...opts,users:[user,{...advisor,feedbacksBlocked:true}]}).feedback);
});
test('critical source zeros the PUE grade; call identity ignores SA version and row ID',()=>{
 const {evaluation:e}=buildSpeechEvaluation({...opts,row:{...row,critical:true,codes:'ZT-02'}});assert.equal(e.puntajeLogrado,0);assert.equal(e.appliesCeroTolerancia,true);assert.ok(e.zeroToleranceItems.some(z=>z.resultado==='Cumple'));
 assert.equal(speechEvaluationId(row),speechEvaluationId({...row,id:'new',version:'V1'}));assert.notEqual(speechEvaluationId(row),speechEvaluationId({...row,file:'another.mp3'}));
});
