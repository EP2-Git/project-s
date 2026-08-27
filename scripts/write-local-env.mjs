import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const status = spawnSync(
  process.execPath,
  ["node_modules/supabase/dist/supabase.js", "status", "-o", "env"],
  { encoding: "utf8" },
);

if (status.status !== 0) {
  console.error(
    status.error?.message ||
      status.stderr?.trim() ||
      "Local Supabase is not running. Start Docker, then run npm run db:start.",
  );
  process.exit(1);
}

const values = Object.fromEntries(
  status.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/"$/, "")]),
);

if (!values.API_URL || !values.ANON_KEY) {
  console.error("Supabase status did not return API_URL and ANON_KEY.");
  process.exit(1);
}

writeFileSync(
  ".env.local",
  [
    "# Generated from the local Supabase stack by npm run db:env.",
    `VITE_SUPABASE_URL=${values.API_URL}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${values.ANON_KEY}`,
    "",
  ].join("\n"),
  { encoding: "utf8", mode: 0o600 },
);

console.log("Wrote local public Supabase configuration to .env.local.");
