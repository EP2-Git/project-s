import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline, bounded library observations. This does not substitute the candidate
// into application imports or claim that Project S has migrated successfully.
const options = new Map();
const allowed = new Set(['--candidate-dir', '--expected-version', '--report']);
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!allowed.has(name) || !value || value.startsWith('--') || options.has(name)) {
    throw new Error('Use --candidate-dir <absolute package directory> --expected-version <version>, optionally --report <file>.');
  }
  options.set(name, value);
}
const candidateDirectory = options.get('--candidate-dir');
if (candidateDirectory && (!isAbsolute(candidateDirectory) || !options.has('--expected-version'))) {
  throw new Error('An external candidate requires an absolute directory and an exact expected version.');
}
const packageFile = candidateDirectory
  ? resolve(candidateDirectory, 'package.json')
  : createRequire(import.meta.url).resolve('zod/package.json');
const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
assert.equal(metadata.name, 'zod');
if (options.has('--expected-version')) assert.equal(metadata.version, options.get('--expected-version'));
// These are the two investigated versions; do not silently bless other releases.
assert.ok(['3.25.76', '4.6.7'].includes(metadata.version), 'Unreviewed probe version');
const { z } = await import(pathToFileURL(resolve(dirname(packageFile), 'index.js')).href);
const isV4 = metadata.version === '4.6.7';

const collection = async (kind, bound, asynchronous) => {
  let visits = 0;
  const visit = (value) => { visits++; return value; };
  const element = z.preprocess(asynchronous ? async (value) => visit(value) : visit, z.string());
  const input = kind === 'map'
    ? new Map(Array.from({ length: 32 }, (_, index) => [index, index]))
    : kind === 'set' ? new Set(Array.from({ length: 32 }, (_, index) => index))
      : Array(32).fill(0);
  let schema = kind === 'map' ? z.map(element, element) : kind === 'set' ? z.set(element) : z.array(element);
  if (kind === 'map' && !isV4 && bound !== 'none') {
    assert.equal(typeof schema.max, 'undefined');
    assert.equal(typeof schema.size, 'undefined');
    return { kind, bound, asynchronous, unsupported: 'Zod 3 map has no built-in max/size API' };
  }
  if (bound === 'maximum') schema = schema.max(2);
  if (bound === 'exact') schema = kind === 'array' ? schema.length(2) : schema.size(2);
  const parsed = asynchronous ? await schema.safeParseAsync(input) : schema.safeParse(input);
  assert.equal(parsed.success, false);
  const early = isV4 && bound !== 'none';
  assert.equal(visits, early ? 0 : kind === 'map' ? 64 : 32);
  assert.equal(parsed.error.issues.length, early ? 1 : (kind === 'map' ? 64 : 32) + (bound === 'none' ? 0 : 1));
  return { kind, bound, asynchronous, childVisits: visits, issueCount: parsed.error.issues.length,
    firstIssueCode: parsed.error.issues[0].code };
};
const collections = [];
for (const kind of ['array', 'set', 'map']) {
  for (const bound of ['maximum', 'exact', 'none']) {
    for (const asynchronous of [false, true]) collections.push(await collection(kind, bound, asynchronous));
  }
}

let nestedVisits = 0;
const nested = z.object({ rows: z.array(z.array(z.preprocess((value) => {
  nestedVisits++; return value;
}, z.string())).max(2)).max(2) }).strict();
const nestedResult = await nested.safeParseAsync({ rows: [Array(32).fill(0)] });
assert.equal(nestedResult.success, false);
assert.equal(nestedVisits, isV4 ? 0 : 32);
assert.deepEqual(nestedResult.error.issues[0].path, ['rows', 0]);
for (const kind of ['array', 'set', 'map']) {
  const schema = kind === 'map' ? (isV4 ? z.map(z.string(), z.string()).max(2) : z.map(z.string(), z.string()))
    : kind === 'set' ? z.set(z.string()).max(2) : z.array(z.string().trim()).max(2);
  const input = kind === 'map' ? new Map([['a', 'b'], ['c', 'd']])
    : kind === 'set' ? new Set(['a', 'b']) : [' a ', ' b '];
  assert.equal(schema.safeParse(input).success, true, `${kind} accepts the exact maximum`);
}

const acceptance = (schema, values) => values.map((value) => ({ value, accepted: schema.safeParse(value).success }));
const unicode = acceptance(z.string().max(1), ['a', '😀', '😀a']);
const uuid = acceptance(z.string().uuid(), [
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
]);
const instants = acceptance(z.string().datetime({ offset: true }), [
  '2026-10-24T12:00:00.123456Z', '2026-10-24T12:00:00.1234567Z',
  '2026-10-24T12:00:00+04:30', '2026-10-24T12:00:00+0430',
  '2026-10-24T12:00:00z', '0000-01-01T00:00:00Z',
]);
const integer = acceptance(z.number().int(), [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]);
const rawError = z.object({ name: z.string(), id: z.string().uuid() }).strict().safeParse({ name: 0, id: 'invalid', extra: true });
assert.equal(rawError.success, false);
const report = {
  purpose: 'Bounded raw-library observations and upstream-fix assertions only',
  applicationCompatibilityEvidence: false,
  package: { name: metadata.name, version: metadata.version, directory: dirname(packageFile) },
  collections,
  nested: { childVisits: nestedVisits, firstIssuePath: nestedResult.error.issues[0].path },
  unicode, uuid, instants, integer,
  errorIssues: rawError.error.issues,
  warning: 'A passing probe is not application compatibility, exact Supabase Edge runtime, database or hosted CI evidence.',
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (options.has('--report')) await writeFile(resolve(options.get('--report')), serialized, 'utf8');
process.stdout.write(serialized);
