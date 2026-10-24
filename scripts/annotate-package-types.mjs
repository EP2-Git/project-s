import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

// Deno needs explicit declaration linkage for local compiled JavaScript. Keep
// the normal runtime files and TypeScript declarations; link each emitted pair.
const directory = resolve(process.argv[2] ?? 'dist');
let annotated = 0;
const visit = async (path) => {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) { await visit(target); continue; }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const declaration = target.slice(0, -3) + '.d.ts';
    await access(declaration);
    const header = `// @ts-self-types="./${basename(declaration)}"\n`;
    const source = await readFile(target, 'utf8');
    if (source.startsWith(header)) continue;
    assert.ok(!source.startsWith('// @ts-self-types='), 'Unexpected declaration annotation');
    const mapFile = `${target}.map`;
    const map = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.equal(typeof map.mappings, 'string');
    assert.equal(map.file, basename(target));
    // One empty generated mapping line accounts for the new header; existing
    // source locations and declaration maps retain their original meaning.
    map.mappings = ';' + map.mappings;
    await writeFile(mapFile, JSON.stringify(map), 'utf8');
    await writeFile(target, header + source, 'utf8');
    annotated++;
  }
};
await visit(directory);
process.stdout.write(`Linked ${annotated} compiled modules to their Deno declarations.\n`);
