import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT AND ISC",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
]);

export function isAllowedLicense(license) {
  return allowedLicenses.has(license);
}

export function runLicenseCheck(lockPath = "package-lock.json") {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const results = [];

  for (const [packagePath, entry] of Object.entries(lock.packages)) {
    if (!packagePath) continue;

    const manifestPath = `${packagePath}/package.json`;
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf8"))
      : entry;
    const license =
      typeof manifest.license === "string"
        ? manifest.license
        : manifest.license?.type;

    results.push({
      name: manifest.name ?? packagePath,
      version: manifest.version ?? entry.version ?? "unknown",
      license: license ?? "missing",
    });
  }

  const rejected = results.filter(({ license }) => !isAllowedLicense(license));
  if (rejected.length > 0) {
    console.error("Dependency license review failed:");
    for (const dependency of rejected) {
      console.error(
        `${dependency.name}@${dependency.version}: ${dependency.license}`,
      );
    }
    return false;
  }

  const counts = new Map();
  for (const { license } of results) {
    counts.set(license, (counts.get(license) ?? 0) + 1);
  }

  console.log(`Reviewed ${results.length} installed package entries.`);
  for (const [license, count] of [...counts].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`${license}: ${count}`);
  }

  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runLicenseCheck() ? 0 : 1;
}
