#!/usr/bin/env node
/**
 * Cross-platform clean-install smoke (no Docker).
 * Assumes `npm ci` already completed in a fresh checkout.
 *
 * Verifies the non-database install path used by evaluators on Windows,
 * macOS, and Linux before they start the local Supabase stack.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import process from "node:process";

const require = createRequire(import.meta.url);
const started = Date.now();

function section(title) {
  console.log(`\n==> ${title}`);
}

function fail(message) {
  console.error(`install-smoke: ${message}`);
  process.exit(1);
}

function run(label, command, args) {
  section(`${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.error) {
    fail(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${label} exited with code ${result.status ?? "unknown"}`);
  }
}

function npmCommand() {
  // On Windows the npm shim is npm.cmd; spawn without shell needs the .cmd form.
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function parseEngines() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  return pkg.engines ?? {};
}

function majorMinorPatch(version) {
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function meetsMinimum(actual, minimumSpec) {
  const minMatch = String(minimumSpec).match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  if (!minMatch) return true;
  const actualParts = majorMinorPatch(actual);
  if (!actualParts) return false;
  const min = {
    major: Number(minMatch[1]),
    minor: Number(minMatch[2]),
    patch: Number(minMatch[3]),
  };
  if (actualParts.major !== min.major) return actualParts.major > min.major;
  if (actualParts.minor !== min.minor) return actualParts.minor > min.minor;
  return actualParts.patch >= min.patch;
}

section("Environment");
const npm = npmCommand();
const npmVersion = spawnSync(npm, ["-v"], { encoding: "utf8" });
if (npmVersion.error || npmVersion.status !== 0) {
  fail(`unable to read npm version via ${npm}`);
}
const reportedNpm = npmVersion.stdout.trim();

const envLines = [
  `os: ${process.platform} ${os.release()} (${os.type()})`,
  `arch: ${process.arch}`,
  `node: ${process.version}`,
  `npm: ${reportedNpm}`,
  `cwd: ${process.cwd()}`,
  `ci: ${process.env.CI ? "true" : "false"}`,
];
for (const line of envLines) console.log(line);

section("Engine floor");
const engines = parseEngines();
if (engines.node && !meetsMinimum(process.version, engines.node)) {
  fail(`Node ${process.version} does not satisfy engines.node ${engines.node}`);
}
if (engines.npm && !meetsMinimum(reportedNpm, engines.npm)) {
  fail(`npm ${reportedNpm} does not satisfy engines.npm ${engines.npm}`);
}
console.log(`engines.node ${engines.node ?? "(none)"} ok`);
console.log(`engines.npm ${engines.npm ?? "(none)"} ok`);

section("Install presence");
const requiredPaths = [
  "node_modules",
  "package-lock.json",
  "packages/contracts/package.json",
  "packages/application/package.json",
  "packages/sdk/package.json",
  "packages/mcp-server/package.json",
];
for (const path of requiredPaths) {
  if (!existsSync(path)) fail(`missing required path after install: ${path}`);
  console.log(`ok ${path}`);
}

// Prefer resolving a workspace package to catch broken workspace links.
try {
  require.resolve("@project-s/contracts/package.json");
  console.log("ok workspace resolve @project-s/contracts");
} catch (error) {
  fail(`workspace package @project-s/contracts is not resolvable: ${error.message}`);
}

run("build packages", npm, ["run", "build:packages"]);
run("typecheck", npm, ["run", "typecheck"]);
run("production build", npm, ["run", "build"]);
run("edge env writer", npm, ["run", "db:edge-env"]);

if (!existsSync("supabase/functions/.env")) {
  fail("db:edge-env did not write supabase/functions/.env");
}
console.log("ok supabase/functions/.env");

const seconds = ((Date.now() - started) / 1000).toFixed(1);
section("Result");
console.log(`install-smoke passed on ${process.platform}/${process.arch} in ${seconds}s`);
console.log(
  "Docker-backed steps (db:start, db:reset, db:env, demo:authority) remain a separate local/CI gate.",
);
