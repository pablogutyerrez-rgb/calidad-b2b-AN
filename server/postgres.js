import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
let pool;
let schemaPromise;

function getConnectionString() {
  return String(process.env.DATABASE_URL || "")
    .trim()
    .replace(/^postgresql:\/+/, "postgresql://");
}

export function isPostgresConfigured() {
  return Boolean(getConnectionString());
}

export function getPostgresPool() {
  if (!pool) {
    const connectionString = getConnectionString();
    if (!connectionString) throw new Error("Falta configurar DATABASE_URL.");
    pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: /railway\.app/i.test(connectionString) ? { rejectUnauthorized: false } : undefined
    });
  }
  return pool;
}

export async function closePostgresPool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  schemaPromise = undefined;
  await current.end();
}

export async function ensurePostgresSchema() {
  if (!schemaPromise) {
    schemaPromise = getPostgresPool().query(`
      CREATE TABLE IF NOT EXISTS shared_records (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        migrated_from TEXT,
        checksum TEXT
      );
      CREATE INDEX IF NOT EXISTS shared_records_updated_at_idx
        ON shared_records (updated_at DESC);
      CREATE TABLE IF NOT EXISTS migration_runs (
        id BIGSERIAL PRIMARY KEY,
        phase INTEGER NOT NULL,
        status TEXT NOT NULL,
        source_keys INTEGER NOT NULL DEFAULT 0,
        copied_keys INTEGER NOT NULL DEFAULT 0,
        verified_keys INTEGER NOT NULL DEFAULT 0,
        failures JSONB NOT NULL DEFAULT '[]'::jsonb,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS migration_runs_phase_idx
        ON migration_runs (phase, started_at DESC);
    `).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function readPostgresRecord(key) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return null;
  await ensurePostgresSchema();
  const result = await getPostgresPool().query(
    "SELECT value, updated_at FROM shared_records WHERE key = $1",
    [cleanKey]
  );
  const row = result.rows[0];
  return row ? { value: String(row.value || ""), timestamp: row.updated_at?.toISOString?.() || String(row.updated_at || "") } : null;
}

export async function writePostgresRecord(key, value, metadata = {}) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) throw new Error("No se puede guardar una clave PostgreSQL vacia.");
  const serializedValue = typeof value === "string" ? value : JSON.stringify(value);
  if (serializedValue === undefined) throw new Error(`No se pudo serializar el valor PostgreSQL para ${cleanKey}.`);
  await ensurePostgresSchema();
  const updatedAt = metadata.timestamp ? new Date(metadata.timestamp) : new Date();
  await getPostgresPool().query(`
    INSERT INTO shared_records (key, value, updated_at, migrated_from, checksum)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = EXCLUDED.updated_at,
      migrated_from = COALESCE(EXCLUDED.migrated_from, shared_records.migrated_from),
      checksum = COALESCE(EXCLUDED.checksum, shared_records.checksum)
  `, [cleanKey, serializedValue, updatedAt, metadata.migratedFrom || null, metadata.checksum || null]);
  return { value: serializedValue, timestamp: updatedAt.toISOString() };
}

export async function deletePostgresRecord(key) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return false;
  await ensurePostgresSchema();
  const result = await getPostgresPool().query("DELETE FROM shared_records WHERE key = $1", [cleanKey]);
  return result.rowCount > 0;
}

export async function listPostgresKeys(prefix = "") {
  await ensurePostgresSchema();
  const cleanPrefix = String(prefix || "");
  const result = await getPostgresPool().query(
    "SELECT key FROM shared_records WHERE starts_with(key, $1) ORDER BY key",
    [cleanPrefix]
  );
  return result.rows.map(row => row.key);
}

export async function getPostgresStats() {
  await ensurePostgresSchema();
  const result = await getPostgresPool().query(`
    SELECT COUNT(*)::int AS records,
           COALESCE(SUM(OCTET_LENGTH(value)), 0)::bigint AS bytes,
           MAX(updated_at) AS last_updated_at
    FROM shared_records
  `);
  return result.rows[0];
}

export async function validatePostgresConnection() {
  const status = { ok: false, configured: isPostgresConfigured(), stats: null, error: "" };
  if (!status.configured) return status;
  try {
    status.stats = await getPostgresStats();
    status.ok = true;
  } catch (error) {
    status.error = error.message || String(error);
  }
  return status;
}

export async function startMigrationRun(phase) {
  await ensurePostgresSchema();
  const result = await getPostgresPool().query(
    "INSERT INTO migration_runs (phase, status) VALUES ($1, 'running') RETURNING id",
    [Number(phase)]
  );
  return Number(result.rows[0].id);
}

export async function finishMigrationRun(id, report) {
  await ensurePostgresSchema();
  await getPostgresPool().query(`
    UPDATE migration_runs SET
      status = $2, source_keys = $3, copied_keys = $4, verified_keys = $5,
      failures = $6::jsonb, finished_at = NOW()
    WHERE id = $1
  `, [Number(id), report.status, Number(report.sourceKeys || 0), Number(report.copied || 0), Number(report.verified || 0), JSON.stringify(report.failures || [])]);
}

export async function listMigrationRuns(limit = 20) {
  await ensurePostgresSchema();
  const result = await getPostgresPool().query(`
    SELECT id, phase, status, source_keys, copied_keys, verified_keys, failures, started_at, finished_at
    FROM migration_runs
    ORDER BY started_at DESC
    LIMIT $1
  `, [Math.max(1, Math.min(Number(limit) || 20, 100))]);
  return result.rows;
}
