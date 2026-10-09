import assert from "node:assert/strict";
import test from "node:test";
import { applyAutomaticFeedbackSla, buildAutomaticFeedbackRecord, buildFeedbackVolumeRecords, completeAutomaticFeedback, gasHandlers, getAutomaticFeedbackFlowStatus, isAutomaticFeedbackBlockedForUser, shouldCreateAutomaticFeedback } from "../server/gasHandlers.js";

test("el volumen de feedbacks queda aislado del flujo operativo", () => {
  const source = {
    id: 42,
    assessor: "ASESOR DEMO",
    advisorUser: "asesor.real",
    supervisorUser: "supervisor.real",
    compromisoMejora: "Compromiso operativo",
    evaluationId: "eval-42",
    messages: [{text:"mensaje real"}],
    files: [{name:"audio.mp3"}],
    feedbackCategory: "Feedback",
    status: "pending",
    estado: "pending",
    clientId: "entel-b2b"
  };

  const records = buildFeedbackVolumeRecords({
    operationalRecords:[source],
    quantity:3,
    monitor:{nombre:"Monitor Demo"},
    monitorUser:"monitor.demo",
    feedbackDate:"2026-09-02",
    month:"2026-09",
    clientId:"entel-b2b",
    clientName:"Entel Empresas B2B",
    createdBy:"admin.demo",
    now:"2026-09-02T12:00:00.000Z",
    batchId:"volume_test"
  });

  assert.equal(records.length, 3);
  records.forEach(record => {
    assert.equal(record.recordType, "feedback_volume");
    assert.equal(record.copySchemaVersion, 2);
    assert.equal(record.statisticalOnly, true);
    assert.equal(record.operational, false);
    assert.equal(record.workflowEnabled, false);
    assert.equal(record.advisorVisible, false);
    assert.equal(record.generatesCommitments, false);
    assert.equal(record.generatesTasks, false);
    assert.equal(record.generatesAlerts, false);
    assert.equal(record.affectsEvaluations, false);
    assert.equal(record.authorUser, "monitor.demo");
    assert.equal(record.advisorUser, source.advisorUser);
    assert.equal(record.supervisorUser, source.supervisorUser);
    assert.deepEqual(record.messages, source.messages);
    assert.deepEqual(record.files, source.files);
    assert.equal(record.compromisoMejora, source.compromisoMejora);
    assert.equal(record.evaluationId, source.evaluationId);
    assert.equal(record.status, source.status);
  });
  const generatedDates = records.map(record => record.feedbackDate);
  assert.equal(new Set(generatedDates).size, records.length);
  assert.deepEqual(generatedDates, [
    "2026-09-02T13:00:00.000Z",
    "2026-09-02T17:59:00.000Z",
    "2026-09-02T22:59:00.000Z"
  ]);
  assert.equal(source.advisorUser, "asesor.real");
  assert.equal(source.compromisoMejora, "Compromiso operativo");
  assert.equal(source.recordType, undefined);
});

test("el Dashboard no repite horas usadas por lotes anteriores", () => {
  const records = buildFeedbackVolumeRecords({
    operationalRecords:[{id:7,assessor:"ASESOR DEMO",status:"pending"}],
    existingRecords:[{feedbackDate:"2026-09-02T13:00:00.000Z"}],
    quantity:2,
    monitor:{nombre:"Monitor Demo"},
    monitorUser:"monitor.demo",
    feedbackDate:"2026-09-02",
    month:"2026-09",
    clientId:"entel-b2b",
    clientName:"Entel Empresas B2B",
    createdBy:"admin.demo",
    now:"2026-09-02T12:00:00.000Z",
    batchId:"volume_second_batch"
  });

  assert.equal(records[0].feedbackDate,"2026-09-02T13:01:00.000Z");
  assert.equal(records[1].feedbackDate,"2026-09-02T22:59:00.000Z");
  assert.equal(new Set(records.map(record => record.feedbackDate)).size,records.length);
});

test("solo Administrador puede ejecutar volumen y Supervisor recibe errores controlados", async () => {
  await assert.rejects(
    gasHandlers.createFeedbackVolume({
      currentUser:{usuario:"supervisor.demo",rol:"supervisor"},
      monitorUser:"monitor.demo",
      quantity:1,
      feedbackDate:"2026-09-02",
      month:"2026-09"
    }),
    /Solo un administrador/
  );
  await assert.rejects(
    gasHandlers.updateFeedbackRecord({
      currentUser:{usuario:"supervisor.demo",rol:"supervisor"},
      id:1,
      action:"close_feedback"
    }),
    /No se encontro/
  );
});

test("el SLA cierra feedbacks automaticos pendientes al cumplir 24 horas", () => {
  const createdAt = "2026-09-10T15:00:00.000Z";
  const result = applyAutomaticFeedbackSla([
    {id:1,automaticFromEvaluation:true,managementStatus:"pending_feedback",status:"pending_feedback",estado:"pending_feedback",createdAt},
    {id:2,automaticFromEvaluation:true,managementStatus:"feedback_completed",status:"feedback_completed",estado:"feedback_completed",createdAt},
    {id:3,status:"pending",estado:"pending",createdAt}
  ], new Date("2026-09-11T15:00:01.000Z").getTime());

  assert.equal(result.changed, true);
  assert.equal(result.records[0].managementStatus, "closed_unmanaged");
  assert.equal(result.records[0].closedWithoutManagementAt, "2026-09-11T15:00:00.000Z");
  assert.equal(result.records[1].managementStatus, "feedback_completed");
  assert.equal(result.records[2].status, "pending");
});

test("el SLA conserva pendientes automaticos antes de 24 horas", () => {
  const record = {id:1,automaticFromEvaluation:true,managementStatus:"pending_feedback",createdAt:"2026-09-10T15:00:00.000Z"};
  const result = applyAutomaticFeedbackSla([record], new Date("2026-09-11T14:59:59.000Z").getTime());
  assert.equal(result.changed, false);
  assert.equal(result.records[0], record);
});

test("editar una evaluacion actualiza el mismo feedback sin reiniciar su gestion", () => {
  const existing = {id:77,automaticFromEvaluation:true,sourceEvaluationId:"eval-1",managementStatus:"feedback_completed",status:"feedback_completed",estado:"feedback_completed",createdAt:"2026-09-10T10:00:00.000Z",managedAt:"2026-09-10T11:00:00.000Z"};
  const record = buildAutomaticFeedbackRecord({
    evaluation:{id:"eval-1",asesorNombre:"Asesor Uno",auditorId:"supervisor.demo",auditorNombre:"Supervisor Demo",resultadoGeneral:"95%",fechaEvaluacion:"2026-09-10T09:00:00.000Z"},
    currentUser:{usuario:"supervisor.demo",nombre:"Supervisor Demo"},
    role:"supervisor",
    clientId:"entel_b2b",
    evaluationId:"eval-1",
    existing,
    now:"2026-09-10T12:00:00.000Z",
    id:999
  });
  assert.equal(record.id,77);
  assert.equal(record.managementStatus,"feedback_completed");
  assert.equal(record.managedAt,existing.managedAt);
  assert.equal(record.resultadoGeneral,"95%");
});

test("normaliza el flujo automatico nuevo y conserva compatibilidad historica", () => {
  assert.equal(getAutomaticFeedbackFlowStatus({automaticFromEvaluation:true,managementStatus:"pending_feedback"}),"pending_feedback");
  assert.equal(getAutomaticFeedbackFlowStatus({automaticFromEvaluation:true,managementStatus:"pending",estado:"advisor_accepted",advisorValidationStatus:"accepted"}),"advisor_accepted");
  assert.equal(getAutomaticFeedbackFlowStatus({automaticFromEvaluation:true,managementStatus:"realized"}),"feedback_completed");
});

test("genera feedback automatico para todos los perfiles autorizados de Entel", () => {
  const evaluation = {clientId:"entel_b2b"};
  ["admin","analista","monitor","supervisor","coordinador"].forEach(rol => {
    assert.equal(shouldCreateAutomaticFeedback(evaluation,{usuario:`${rol}.demo`,rol}),true,rol);
  });
  assert.equal(shouldCreateAutomaticFeedback(evaluation,{usuario:"formador.demo",rol:"formador"}),false);
  assert.equal(shouldCreateAutomaticFeedback({clientId:"culqi_bcp"},{usuario:"admin.demo",rol:"admin"}),false);
});

test("bloquea el feedback automatico solo para el usuario seleccionado", () => {
  const users = [
    {usuario:"monitor.bloqueado",rol:"monitor",feedbacksBlocked:true},
    {usuario:"monitor.habilitado",rol:"monitor",feedbacksBlocked:false}
  ];
  assert.equal(isAutomaticFeedbackBlockedForUser({usuario:"monitor.bloqueado",rol:"monitor"},users),true);
  assert.equal(isAutomaticFeedbackBlockedForUser({usuario:"monitor.habilitado",rol:"monitor"},users),false);
  assert.equal(isAutomaticFeedbackBlockedForUser({usuario:"monitor.inexistente",rol:"monitor"},users),false);
});

test("el bloqueo sigue al usuario evaluador sin depender de su rol", () => {
  const users = [
    {usuario:"evaluador.demo",clientId:"entel_b2b",feedbacksBlocked:"true"},
    {usuario:"evaluador.demo",clientId:"culqi_bcp",feedbacksBlocked:false}
  ];
  ["admin","analista","monitor","supervisor","coordinador"].forEach(rol => {
    assert.equal(isAutomaticFeedbackBlockedForUser({usuario:"evaluador.demo",rol},users),true,rol);
  });
});

test("solo permite terminar el feedback despues de la aceptacion del asesor", () => {
  const pending = {id:1,automaticFromEvaluation:true,managementStatus:"pending_feedback",estado:"pending_feedback"};
  assert.throws(
    () => completeAutomaticFeedback(pending,{usuario:"admin.demo",nombre:"Admin Demo"},"2026-09-13T12:00:00.000Z"),
    /debe registrar y aceptar su compromiso/
  );
  const accepted = {...pending,managementStatus:"advisor_accepted",estado:"advisor_accepted",compromisoMejora:"Me comprometo a mejorar"};
  const completed = completeAutomaticFeedback(accepted,{usuario:"admin.demo",nombre:"Admin Demo"},"2026-09-13T12:00:00.000Z");
  assert.equal(completed.managementStatus,"feedback_completed");
  assert.equal(completed.estado,"feedback_completed");
  assert.equal(completed.managedBy,"admin.demo");
  assert.equal(completed.managedAt,"2026-09-13T12:00:00.000Z");
  assert.equal(completed.compromisoMejora,"Me comprometo a mejorar");
});
