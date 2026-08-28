#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = process.cwd();
const expectedLabels = new Set([
  'type: bug',
  'type: feature',
  'type: docs',
  'type: rfc',
  'type: test',
  'type: chore',
  'type: feedback',
  'type: research',
  'area: authority',
  'area: scheduling',
  'area: database',
  'area: api',
  'area: sdk',
  'area: mcp',
  'area: web',
  'area: accessibility',
  'area: dx',
  'area: security',
  'area: docs',
  'area: release',
  'area: community',
  'priority: p0',
  'priority: p1',
  'priority: p2',
  'priority: p3',
  'good first issue',
  'help wanted',
  'blocked',
  'needs decision',
  'needs reproduction',
  'breaking change',
  'security sensitive',
  'dependencies',
]);

const listRepositoryFiles = () => {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: repositoryRoot, encoding: 'buffer' },
  );
  if (result.status !== 0) {
    throw new Error('Unable to enumerate repository files.');
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
};

const stripMarkdownDestination = (destination) => {
  const trimmed = destination.trim().replace(/^<|>$/g, '');
  const withoutTitle = trimmed.replace(/\s+["'][^"']*["']$/, '');
  return withoutTitle.split('#', 1)[0].split('?', 1)[0];
};

const localMarkdownTargets = (text) => {
  const targets = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    const destination = match[1].trim();
    if (
      destination.startsWith('#') ||
      /^[a-z][a-z0-9+.-]*:/i.test(destination)
    ) {
      continue;
    }
    const target = stripMarkdownDestination(destination);
    if (target) targets.push(target);
  }
  return targets;
};

const resolveLocalTarget = (sourceFile, target) => {
  const decoded = decodeURIComponent(target);
  const candidate = resolve(repositoryRoot, dirname(sourceFile), decoded);
  if (!existsSync(candidate)) return candidate;
  if (statSync(candidate).isDirectory()) return resolve(candidate, 'README.md');
  return candidate;
};

const parseInlineLabels = (text) => {
  const match = text.match(/^labels:\s*\[([^\]]*)\]/m);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"|'([^']+)'|([^,\s][^,]*)/g)]
    .map((entry) => (entry[1] ?? entry[2] ?? entry[3]).trim())
    .filter(Boolean);
};

const findings = [];
const files = listRepositoryFiles();

for (const file of files.filter((entry) => extname(entry).toLowerCase() === '.md')) {
  const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
  for (const target of localMarkdownTargets(text)) {
    const resolved = resolveLocalTarget(file, target);
    if (!existsSync(resolved)) {
      findings.push(`${file}: broken local Markdown target ${target}`);
    }
  }
}

const readme = readFileSync(resolve(repositoryRoot, 'README.md'), 'utf8');
const proofImage = readme.match(/!\[([^\]]*)\]\(docs\/assets\/authority-boundary-overview\.webp\)/);
if (!proofImage || proofImage[1].trim().length < 40) {
  findings.push('README.md: Authority Boundary proof image needs meaningful alt text.');
}

const formFiles = files.filter(
  (file) => file.startsWith('.github/ISSUE_TEMPLATE/') && file.endsWith('.yml') && !file.endsWith('/config.yml'),
);
for (const file of formFiles) {
  const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
  const labels = parseInlineLabels(text);
  const typeLabels = labels.filter((label) => label.startsWith('type: '));
  const priorityLabels = labels.filter((label) => label.startsWith('priority: '));
  const areaLabels = labels.filter((label) => label.startsWith('area: '));
  if (typeLabels.length !== 1) findings.push(`${file}: expected exactly one type label.`);
  if (priorityLabels.length !== 1) findings.push(`${file}: expected exactly one priority label.`);
  if (areaLabels.length === 0 && !/id:\s*area\b/.test(text)) {
    findings.push(`${file}: expected an area label or a required area triage field.`);
  }
  for (const label of labels) {
    if (!expectedLabels.has(label)) findings.push(`${file}: unknown label ${label}.`);
  }
}

const issueConfig = readFileSync(
  resolve(repositoryRoot, '.github', 'ISSUE_TEMPLATE', 'config.yml'),
  'utf8',
);
for (const expected of [
  'blank_issues_enabled: false',
  '/discussions/categories/q-a',
  '/discussions/categories/ideas',
  '/security/advisories/new',
]) {
  if (!issueConfig.includes(expected)) {
    findings.push(`.github/ISSUE_TEMPLATE/config.yml: missing ${expected}.`);
  }
}

if (findings.length > 0) {
  console.error(`Repository documentation check failed with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(
    `Repository documentation check passed: ${files.filter((file) => file.endsWith('.md')).length} Markdown files and ${formFiles.length} issue forms.`,
  );
}
