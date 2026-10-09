export const MIGRATION_PHASES = {
  1: {
    name: "datos_maestros",
    matches: key => ["users_v1", "staffing", "legend_concepts_v1", "communications_v1"].includes(key) || /^(staffing|users|legend|communications?)[_-]/i.test(key)
  },
  2: {
    name: "evaluaciones",
    matches: key => ["evaluations_v1", "deleted_evaluations_v1", "evaluation_audio_index_v1"].includes(key) || /^evaluation_record_/i.test(key)
  },
  3: {
    name: "feedbacks",
    matches: key => ["feedback_records_v2", "feedback_volume_v1"].includes(key) || /^feedback[_-]/i.test(key)
  },
  4: {
    name: "operacion_calidad",
    matches: key => [
      "operational_incidents_v1", "sales_validations_v1", "notip_records_v1",
      "quality_variable_config_v1", "quality_variable_calculations_v1", "quality_variable_audit_v1"
    ].includes(key)
  },
  5: { name: "calibraciones", matches: key => /^calibration_/i.test(key) },
  6: { name: "desarrollo_comercial", matches: key => key === "commercial_development_v1" || /^commercial_development_/i.test(key) },
  7: {
    name: "datos_secundarios",
    matches: key => ["internal_chat_v1", "snapshots_shared", "notifications_v1"].includes(key) || /^(notification|audit|config)[_-]/i.test(key)
  },
  8: { name: "archivos_historicos", matches: key => /^file_blob_/i.test(key) }
};

export function getMigrationPhase(key) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return 0;
  for (const [phase, definition] of Object.entries(MIGRATION_PHASES)) {
    if (definition.matches(cleanKey)) return Number(phase);
  }
  return 0;
}

export function getEnabledPostgresPhases() {
  return new Set(
    String(process.env.POSTGRES_PHASES || "")
      .split(",")
      .map(value => Number(value.trim()))
      .filter(value => MIGRATION_PHASES[value])
  );
}
