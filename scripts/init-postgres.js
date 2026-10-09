import { closePostgresPool, ensurePostgresSchema, getPostgresStats } from "../server/postgres.js";

await ensurePostgresSchema();
console.log(JSON.stringify({ ok: true, stats: await getPostgresStats() }, null, 2));
await closePostgresPool();
