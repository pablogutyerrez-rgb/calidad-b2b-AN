import "dotenv/config";
import { hashPassword } from "../server/auth.js";
import { closePostgresPool, readPostgresRecord, writePostgresRecord } from "../server/postgres.js";

const username = process.env.ADMIN_USERNAME?.trim();
const password = process.env.ADMIN_PASSWORD;
if (!username || !password || password.length < 12) {
  throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters) before seeding.");
}
const now = new Date().toISOString();
const admin = {
  id: username,
  nombre: process.env.ADMIN_NAME?.trim() || username,
  usuario: username,
  passwordHash: hashPassword(password),
  rol: "admin",
  estado: "activo",
  mustChangePassword: false,
  passwordChangedAt: now,
  staffingAccess: true,
  feedbacksBlocked: false,
  platformAccess: ["entel_b2b", "culqi_bcp", "desarrollo_comercial"],
  clientId: "entel_b2b",
  platformId: "entel_b2b",
  createdAt: now,
  updatedAt: now
};

const existingRecord = await readPostgresRecord("users_v1");
let users = [];
if (existingRecord?.value) {
  users = JSON.parse(existingRecord.value);
  if (!Array.isArray(users)) throw new Error("Existing users_v1 is not an array; seed aborted.");
}
const index = users.findIndex(user => String(user?.usuario || "").trim().toLowerCase() === admin.usuario.toLowerCase());
if (index >= 0) throw new Error("User already exists; seed will not overwrite credentials.");
users.push(admin);
await writePostgresRecord("users_v1", users, { migratedFrom: "local_postgres_seed" });

const emptyCollections = [
  "staffing", "snapshots_shared", "feedback_records_v2", "feedback_volume_v1",
  "evaluations_v1", "deleted_evaluations_v1", "notip_records_v1",
  "operational_incidents_v1", "communications_v1", "legend_concepts_v1",
  "internal_chat_v1", "sales_validations_v1", "commercial_development_v1",
  "calibration_sessions", "calibration_participants", "calibration_evaluations",
  "calibration_evaluation_items", "calibration_results",
  "calibration_response_comparison", "calibration_activity_logs",
  "quality_variable_calculations_v1", "quality_variable_audit_v1"
];
for (const key of emptyCollections) {
  if (!await readPostgresRecord(key)) await writePostgresRecord(key, [], { migratedFrom: "local_postgres_seed" });
}

console.log(JSON.stringify({ ok: true, admin: admin.usuario, users: users.length, initializedCollections: emptyCollections.length }, null, 2));
await closePostgresPool();
