import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectDoctor, runBootstrap, runCommand } from './lib/local-setup.mjs';

// This probe writes synthetic data only to a just-bootstrapped CI database.
if (process.env.CI !== 'true') throw new Error('This disposable-database probe is CI-only.');
const report = await collectDoctor();
assert.ok(report.ok && report.state.markerMatches, 'A verified fresh CI bootstrap is required.');
const sql = (query) => {
  const result = runCommand('docker', ['exec', 'supabase_db_project-s-local', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', query]);
  assert.ok(!result.error && result.status === 0, 'Synthetic local bootstrap probe SQL failed.');
  return result.stdout.trim();
};
const paths = ['.env.local', 'supabase/functions/.env'];
const before = paths.map((path) => readFileSync(path));
sql('CREATE SCHEMA bootstrap_probe; CREATE TABLE bootstrap_probe.sentinel (value integer); INSERT INTO bootstrap_probe.sentinel VALUES (42);');
try {
  await assert.rejects(runBootstrap({ skipInstall: true, log: () => {} }), /Existing local data/);
  assert.equal(sql('SELECT value FROM bootstrap_probe.sentinel;'), '42');
  await runBootstrap({ reuse: true, skipInstall: true });
  assert.equal(sql('SELECT value FROM bootstrap_probe.sentinel;'), '42');
  paths.forEach((path, index) => assert.ok(readFileSync(path).equals(before[index]), 'Reuse changed generated environment.'));
  console.log('Default refusal and verified reuse preserve synthetic data and environment.');
} finally {
  sql('DROP SCHEMA bootstrap_probe CASCADE;');
}
