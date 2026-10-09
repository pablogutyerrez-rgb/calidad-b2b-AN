import "dotenv/config";
import { closePostgresPool, getPostgresStats, listMigrationRuns } from "../server/postgres.js";

console.log(JSON.stringify({
  postgres: await getPostgresStats(),
  runs: await listMigrationRuns()
}, null, 2));
await closePostgresPool();
