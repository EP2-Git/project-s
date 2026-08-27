import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const generated = spawnSync(
  process.execPath,
  [
    "node_modules/supabase/dist/supabase.js",
    "gen",
    "types",
    "typescript",
    "--local",
  ],
  { encoding: "utf8" },
);

if (generated.status !== 0) {
  console.error(
    generated.error?.message ||
      generated.stderr?.trim() ||
      "Supabase type generation failed.",
  );
  process.exit(1);
}

const normalize = (value) => value.replaceAll("\r\n", "\n").trim();
const committed = readFileSync(
  "src/integrations/supabase/types.ts",
  "utf8",
);

if (normalize(generated.stdout) !== normalize(committed)) {
  console.error(
    "Generated Supabase types differ from src/integrations/supabase/types.ts. " +
      "Regenerate them from the local migration stack and commit the result.",
  );
  process.exit(1);
}

console.log("Generated Supabase types match the local database schema.");
