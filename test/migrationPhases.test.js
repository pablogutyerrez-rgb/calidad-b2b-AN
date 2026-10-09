import test from "node:test";
import assert from "node:assert/strict";
import { getMigrationPhase } from "../server/migrationPhases.js";

test("clasifica las colecciones por fase", () => {
  assert.equal(getMigrationPhase("users_v1"), 1);
  assert.equal(getMigrationPhase("evaluation_record_123"), 2);
  assert.equal(getMigrationPhase("feedback_records_v2"), 3);
  assert.equal(getMigrationPhase("sales_validations_v1"), 4);
  assert.equal(getMigrationPhase("calibration_sessions"), 5);
  assert.equal(getMigrationPhase("commercial_development_v1"), 6);
  assert.equal(getMigrationPhase("internal_chat_v1"), 7);
  assert.equal(getMigrationPhase("file_blob_audio_1"), 8);
});

test("deja sin fase una clave desconocida", () => {
  assert.equal(getMigrationPhase("coleccion_no_clasificada"), 0);
});
