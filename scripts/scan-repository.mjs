import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

const forbiddenExtensions = new Set([
  ".7z",
  ".bak",
  ".db",
  ".dump",
  ".key",
  ".mov",
  ".mp4",
  ".p12",
  ".pem",
  ".pfx",
  ".rar",
  ".sqlite",
  ".tar",
  ".tgz",
  ".webm",
  ".zip",
]);
const allowedEmailDomains = new Set([
  "example.com",
  "example.invalid",
  "project-s.local",
  "users.noreply.github.com",
]);

const contentRules = [
  {
    label: "absolute Windows workstation path",
    pattern: /(?:\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'`<>]+|file:\/\/\/[A-Za-z]:\/(?:Users|Documents(?:%20| )and(?:%20| )Settings)\/[^/\s"'`<>]+)/i,
  },
  {
    label: "hosted Supabase project URL",
    pattern: /https:\/\/[a-z0-9]{15,}\.supabase\.co\b/i,
  },
  {
    label: "Lovable private project URL",
    pattern: /https:\/\/(?:www\.)?lovable\.dev\/projects\/[0-9a-f-]{20,}/i,
  },
  {
    label: "GPT Engineer runtime CDN",
    pattern: /https:\/\/cdn\.gpteng\.co\//i,
  },
  {
    label: "JSON web token",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    label: "private key material",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: "secret assigned to a VITE_ variable",
    pattern: /\bVITE_[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE_ROLE)[A-Z0-9_]*\s*=\s*\S+/,
  },
  {
    label: "provider credential",
    pattern: /\b(?:GOCSPX-|ghp_|github_pat_|sk-(?:live|proj)-|xox[baprs]-)[A-Za-z0-9_-]{8,}/,
  },
  {
    label: "hosted Supabase project identifier",
    pattern: /^\s*project_id\s*=\s*"[a-z0-9]{12,}"\s*$/i,
  },
];

export function isIgnoredPublicationPath(file) {
  const normalized = file.replaceAll("\\", "/");
  return normalized === "supabase/.temp" || normalized.startsWith("supabase/.temp/");
}

export function isForbiddenPath(file) {
  const normalized = file.replaceAll("\\", "/");
  const name = basename(normalized);

  if (name === ".env.example") return false;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name.toLowerCase() === "credentials.json") return true;

  return forbiddenExtensions.has(extname(name).toLowerCase());
}

export function scanText(file, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const { label, pattern } of contentRules) {
      if (pattern.test(line)) {
        findings.push({ file, line: index + 1, label });
      }
    }

    const emailMatches = file === "package-lock.json" ? [] : line.matchAll(
      /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
    );
    for (const match of emailMatches) {
      const domain = match[1].toLowerCase();
      if (!allowedEmailDomains.has(domain)) {
        findings.push({
          file,
          line: index + 1,
          label: "non-example email address",
        });
      }
    }
  }

  return findings;
}

/* v8 ignore start -- exercised by the executable repository scan in CI */
function repositoryPaths() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "buffer" },
  );

  if (result.status !== 0) {
    throw new Error("Unable to enumerate repository files with git ls-files.");
  }

  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function scanRepository() {
  const findings = [];

  for (const file of repositoryPaths()) {
    if (isIgnoredPublicationPath(file)) continue;
    if (!existsSync(file)) continue;

    if (isForbiddenPath(file)) {
      findings.push({ file, line: 1, label: "forbidden publication path" });
      continue;
    }

    const contents = readFileSync(file);
    if (contents.includes(0)) continue;

    findings.push(...scanText(file, contents.toString("utf8")));
  }

  return findings;
}

function main() {
  const findings = scanRepository();

  if (findings.length === 0) {
    console.log("Publication scan passed: no forbidden paths or identifiers found.");
    return;
  }

  console.error(`Publication scan failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.label}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
/* v8 ignore stop */
