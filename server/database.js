import {
  deleteSharedRecord as deleteFirebaseRecord,
  listSharedKeys as listFirebaseKeys,
  readSharedRecord as readFirebaseRecord,
  writeSharedRecord as writeFirebaseRecord
} from "./firebase.js";
import {
  deletePostgresRecord,
  isPostgresConfigured,
  listPostgresKeys,
  readPostgresRecord,
  writePostgresRecord
} from "./postgres.js";
import { getEnabledPostgresPhases, getMigrationPhase } from "./migrationPhases.js";

export function getDatabaseBackend(key = "") {
  const requested = String(process.env.DATABASE_BACKEND || "firebase").trim().toLowerCase();
  if (!isPostgresConfigured()) {
    if (requested === "postgres") throw new Error("Falta DATABASE_URL para PostgreSQL.");
    return "firebase";
  }
  if (requested === "postgres") return "postgres";
  const phase = getMigrationPhase(key);
  return phase && getEnabledPostgresPhases().has(phase) ? "postgres" : "firebase";
}

export async function readSharedRecord(key) {
  return getDatabaseBackend(key) === "postgres" ? readPostgresRecord(key) : readFirebaseRecord(key);
}

export async function readSharedJson(key, fallbackValue = null) {
  const record = await readSharedRecord(key);
  if (!record || !record.value) return fallbackValue;
  try {
    return JSON.parse(record.value);
  } catch {
    return record.value;
  }
}

export async function writeSharedRecord(key, value) {
  return getDatabaseBackend(key) === "postgres" ? writePostgresRecord(key, value) : writeFirebaseRecord(key, value);
}

export async function deleteSharedRecord(key) {
  return getDatabaseBackend(key) === "postgres" ? deletePostgresRecord(key) : deleteFirebaseRecord(key);
}

export async function listSharedKeys(prefix = "") {
  return getDatabaseBackend(prefix) === "postgres" ? listPostgresKeys(prefix) : listFirebaseKeys(prefix);
}

export function normalizeId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const numeric = Number(text);
  return Number.isNaN(numeric) ? text : String(numeric);
}

export function getEvaluationRecordKey(id) {
  return `evaluation_record_${normalizeId(id)}`;
}
