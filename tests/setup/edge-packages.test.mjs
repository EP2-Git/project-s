import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { prepareEdgePackages } from '../../scripts/prepare-edge-packages.mjs';

const roots = [];
const fixture = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-s-edge-packages-')));
  roots.push(root);
  const write = async (name, content) => {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  };
  for (const name of ['contracts', 'application']) {
    await write(`packages/${name}/dist/index.js`, '// @ts-self-types="./index.d.ts"\r\nexport const value = 1;\r\n');
    await write(`packages/${name}/dist/index.d.ts`, 'export declare const value = 1;\n');
    await write(`packages/${name}/dist/index.js.map`, Buffer.from([0, 127, 128, 255]));
    await write(`packages/${name}/src/index.ts`, 'export const value = 1; // synthetic café\r\n');
    await write(`packages/${name}/src/nested/scalar.ts`, 'export const scalar = "fixture";\n');
    await write(`packages/${name}/.env`, 'synthetic-do-not-copy');
  }
  return { root, write, generated: join(root, 'supabase/functions/_shared/.generated') };
};

afterEach(async () => {
  const temporaryRoot = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    assert.ok(root.startsWith(`${temporaryRoot}${sep}`));
    assert.ok(root.includes('project-s-edge-packages-'));
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  }
});

test('fresh generation preserves complete source bytes and verifies its file manifest', async () => {
  const f = await fixture();
  const result = await prepareEdgePackages({ root: f.root });
  assert.equal(result.directory, f.generated);
  assert.equal(result.files.length, 10);
  for (const file of result.files) {
    const original = await readFile(join(f.root, 'packages', file.path));
    assert.deepEqual(await readFile(join(f.generated, file.path)), original);
    assert.equal(file.bytes, original.length);
    assert.equal(file.sha256, createHash('sha256').update(original).digest('hex'));
    assert.match(file.path, /^(contracts|application)\/(dist|src)\//);
  }
  assert.ok(!result.files.some((file) => file.path.includes('.env')));
});

test('rebuilding removes stale generated files without changing source or neighboring files', async () => {
  const f = await fixture();
  await prepareEdgePackages({ root: f.root });
  await f.write('supabase/functions/_shared/.generated/contracts/dist/stale.js', 'stale');
  await f.write('supabase/functions/_shared/.generated/sdk/stale.js', 'stale');
  await f.write('supabase/functions/_shared/.generated-neighbor/keep.txt', 'keep');
  await f.write('packages/application/src/index.ts', 'export const value = 2;\n');
  const result = await prepareEdgePackages({ root: f.root });
  assert.equal(result.files.length, 10);
  await assert.rejects(lstat(join(f.generated, 'contracts/dist/stale.js')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(f.generated, 'sdk')), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.root, 'supabase/functions/_shared/.generated-neighbor/keep.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(join(f.generated, 'application/src/index.ts'), 'utf8'), 'export const value = 2;\n');
  assert.equal(await readFile(join(f.root, 'packages/application/src/index.ts'), 'utf8'), 'export const value = 2;\n');
});

test('missing source tree or declaration fails before replacing existing generated output', async () => {
  for (const missing of ['packages/application/dist', 'packages/contracts/src', 'packages/contracts/dist/index.d.ts']) {
    const f = await fixture();
    await f.write('supabase/functions/_shared/.generated/keep.txt', 'previous');
    const path = join(f.root, missing);
    assert.ok(path.startsWith(`${f.root}${sep}packages${sep}`));
    await rm(path, { recursive: true, force: true });
    await assert.rejects(prepareEdgePackages({ root: f.root }), /Missing (built package tree|package entry)/);
    assert.equal(await readFile(join(f.generated, 'keep.txt'), 'utf8'), 'previous');
  }
});

test('linked source trees are refused before existing generated output changes', async () => {
  const f = await fixture();
  await f.write('supabase/functions/_shared/.generated/keep.txt', 'previous');
  const source = join(f.root, 'packages/contracts/src');
  const target = join(f.root, 'linked-source');
  await rename(source, target);
  await symlink(target, source, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareEdgePackages({ root: f.root }), /Refusing linked package path/);
  assert.equal(await readFile(join(f.generated, 'keep.txt'), 'utf8'), 'previous');
  assert.equal(await readFile(join(target, 'index.ts'), 'utf8'), 'export const value = 1; // synthetic café\r\n');
});

test('linked generated ancestors cannot redirect cleanup outside the fixed output directory', async () => {
  const f = await fixture();
  const outside = await fixture();
  await outside.write('.generated/keep.txt', 'outside');
  await mkdir(join(f.root, 'supabase/functions'), { recursive: true });
  await symlink(outside.root, join(f.root, 'supabase/functions/_shared'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareEdgePackages({ root: f.root }), /Refusing linked package path/);
  assert.equal(await readFile(join(outside.root, '.generated/keep.txt'), 'utf8'), 'outside');
});

test('links within previous generated output are refused before any cleanup', async () => {
  const f = await fixture();
  const outside = await fixture();
  await f.write('supabase/functions/_shared/.generated/keep.txt', 'previous');
  await outside.write('keep.txt', 'outside');
  await symlink(outside.root, join(f.generated, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareEdgePackages({ root: f.root }), /Refusing linked package entry/);
  assert.equal(await readFile(join(f.generated, 'keep.txt'), 'utf8'), 'previous');
  assert.equal(await readFile(join(outside.root, 'keep.txt'), 'utf8'), 'outside');
});
