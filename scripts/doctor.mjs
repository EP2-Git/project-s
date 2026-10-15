#!/usr/bin/env node
import { collectDoctor, reportDoctor } from './lib/local-setup.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--json')) {
  console.error('Usage: npm run doctor -- [--json]');
  process.exitCode = 1;
} else {
  const report = await collectDoctor();
  const result = { version: report.version, ok: report.ok, checks: report.checks };
  if (args.includes('--json')) console.log(JSON.stringify(result));
  else reportDoctor(result);
  process.exitCode = result.ok ? 0 : 1;
}
