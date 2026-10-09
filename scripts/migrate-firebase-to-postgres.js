import "dotenv/config";
import crypto from "node:crypto";
import { listSharedKeys, readSharedRecord } from "../server/firebase.js";
import { MIGRATION_PHASES } from "../server/migrationPhases.js";
import {
  ensurePostgresSchema,
  closePostgresPool,
  finishMigrationRun,
  getPostgresStats,
  readPostgresRecord,
  startMigrationRun,
  writePostgresRecord
} from "../server/postgres.js";

function checksum(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function getPhaseArgument() {
  const raw = process.argv.find(arg => arg.startsWith("--phase="))?.split("=")[1];
  const phase = Number(raw);
  if (!MIGRATION_PHASES[phase]) throw new Error("Usa --phase=1 hasta --phase=8.");
  return phase;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatorio.");
  const phase = getPhaseArgument();
  await ensurePostgresSchema();
  const runId = await startMigrationRun(phase);
  const report = { phase, phaseName: MIGRATION_PHASES[phase].name, status: "failed", sourceKeys: 0, copied: 0, verified: 0, failures: [] };

  try {
    const allKeys = await listSharedKeys("");
    const keys = allKeys.filter(MIGRATION_PHASES[phase].matches);
    report.sourceKeys = keys.length;
    if (!keys.length) throw new Error(`Firebase no devolvio registros para la fase ${phase}; se cancela para evitar un corte vacio.`);

    for (const key of keys) {
      try {
        const source = await readSharedRecord(key);
        if (!source) throw new Error("registro_fuente_vacio");
        const hash = checksum(source.value);
        await writePostgresRecord(key, source.value, { timestamp: source.timestamp, migratedFrom: "firebase_realtime_database", checksum: hash });
        report.copied += 1;
        const target = await readPostgresRecord(key);
        if (target && checksum(target.value) === hash) report.verified += 1;
        else report.failures.push({ key, reason: "checksum_mismatch" });
      } catch (error) {
        report.failures.push({ key, reason: error.message || String(error) });
      }
    }

    report.status = !report.failures.length && report.copied === report.verified && report.copied === report.sourceKeys ? "verified" : "failed";
  } catch (error) {
    report.failures.push({ key: "__phase__", reason: error.message || String(error) });
  }

  report.postgres = await getPostgresStats();
  await finishMigrationRun(runId, report);
  console.log(JSON.stringify(report, null, 2));
  await closePostgresPool();
  if (report.status !== "verified") process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
