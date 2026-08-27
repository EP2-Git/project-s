import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('public pre-alpha claims', () => {
  it('does not label the current contract stable or exactly-once', () => {
    const claims = [
      'README.md',
      'docs/product/project-s-north-star.md',
      'packages/contracts/src/artifacts.ts',
      'packages/sdk/README.md',
    ].map(read).join('\n');

    for (const forbidden of [
      /four stable Project S public booking operations/i,
      /stable four-operation public booking boundary/i,
      /committing exactly one valid result/i,
      /\bexact(?:ly)?[- ]once\b/i,
    ]) {
      expect(claims).not.toMatch(forbidden);
    }
  });

  it('keeps speculative product copy out of the current launch surfaces', () => {
    const claims = [
      'src/components/HeroSection.tsx',
      'src/components/FeaturesSection.tsx',
      'src/components/Footer.tsx',
      'src/components/Navbar.tsx',
      'src/pages/About.tsx',
      'src/pages/Demo.tsx',
      'src/pages/Features.tsx',
      'src/pages/Index.tsx',
      'src/pages/design-lab/AuthorityPipeline.tsx',
    ].map(read).join('\n');

    for (const forbidden of [
      /\bcomingSoon\b/,
      /AI analyzes your calendar/i,
      /An AI agent can use Project S/i,
      /Accessible by design/i,
      /Built for dependable booking/i,
      /conflict-safe/i,
      /prevent double-booking/i,
      /without guessing whether a displayed time is still valid/i,
      /Create an account/i,
      />Sign up</i,
      />Log in</i,
      /Contact Us/i,
      /Send us a message/i,
    ]) {
      expect(claims).not.toMatch(forbidden);
    }
  });
});
