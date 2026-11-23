import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('the actual review client imports in the existing live-proof Node runtime without a transformed copy', () => {
  const moduleUrl = new URL('../../src/services/stepUpReviewClient.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    const { createStepUpReviewClient, StepUpReviewClientError } = await import(${JSON.stringify(moduleUrl)});
    if (typeof createStepUpReviewClient !== 'function' ||
        new StepUpReviewClientError('uncertain').kind !== 'uncertain') {
      throw new Error('Unexpected review client runtime.');
    }
    process.stdout.write('review-client-runtime-ok');
  `], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, 'The source client must run with the existing strip-types flag.');
  assert.equal(result.stdout, 'review-client-runtime-ok');
});
