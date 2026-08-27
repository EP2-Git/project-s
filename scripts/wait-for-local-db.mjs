import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const config = readFileSync("supabase/config.toml", "utf8");
const projectId = config.match(/^\s*project_id\s*=\s*"([a-z0-9_-]+)"\s*$/m)?.[1];

if (!projectId) {
  console.error("Unable to read a safe project_id from supabase/config.toml.");
  process.exit(1);
}

const container = `supabase_db_${projectId}`;
const deadline = Date.now() + TIMEOUT_MS;

while (Date.now() < deadline) {
  const ready = spawnSync(
    "docker",
    [
      "exec",
      container,
      "pg_isready",
      "-q",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { encoding: "utf8" },
  );

  if (ready.error) {
    console.error(`Unable to run Docker: ${ready.error.message}`);
    process.exit(1);
  }
  if (ready.status === 0) {
    console.log("Local Supabase database is ready.");
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

console.error(
  `Local Supabase database did not become ready within ${TIMEOUT_MS / 1000} seconds.`,
);
process.exit(1);
