import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  generateContractArtifacts,
  operationRegistry,
  stableStringify,
} from '../src/index.js';
import {
  PROJECT_S_V2_CONTRACT_MEDIA_TYPE,
  PROJECT_S_V2_CONTRACT_VERSION,
  PROJECT_S_V2_PROBLEM_MEDIA_TYPE,
  generateV2ContractArtifacts,
  generateV2JsonSchemaBundle,
} from '../src/v2/index.js';

const digest = (value: unknown) => createHash('sha256').update(stableStringify(value, 0)).digest('hex');

describe('isolated v2 contract artifacts, not operation discovery', () => {
  it('preserves the exact v1 artifact digest and four-operation registry', () => {
    expect(digest(generateContractArtifacts())).toBe('827656a8a8748d1d58afa9042daae09fa3be586d274d86308e09ae8ace3f57be');
    expect(operationRegistry).toHaveLength(4);
    expect(generateContractArtifacts().mcpManifest.tools).toHaveLength(4);
    expect(stableStringify(generateContractArtifacts())).not.toContain('authority-foundation-v2');
  });

  it('generates a distinct deterministic v2 schema bundle without routes or tool discovery', () => {
    const artifacts = generateV2ContractArtifacts();
    expect(artifacts).toEqual({ jsonSchemaBundle: generateV2JsonSchemaBundle() });
    expect(stableStringify(artifacts)).toBe(stableStringify(generateV2ContractArtifacts()));
    expect(Object.keys(artifacts)).toEqual(['jsonSchemaBundle']);
    expect(artifacts.jsonSchemaBundle.$id).toBe('https://project-s.example/schemas/authority-foundation-v2.json');
    expect(artifacts.jsonSchemaBundle['x-project-s-status']).toBe('foundation-only-unavailable');
    expect(PROJECT_S_V2_CONTRACT_VERSION).toBe(2);
    expect(PROJECT_S_V2_CONTRACT_MEDIA_TYPE).toBe('application/vnd.project-s.v2+json');
    expect(PROJECT_S_V2_PROBLEM_MEDIA_TYPE).toBe('application/problem+json');
    expect(artifacts.jsonSchemaBundle.$defs.ContractVersion).toMatchObject({ const: 2 });
    expect(Object.keys(artifacts.jsonSchemaBundle.$defs)).toHaveLength(48);
    expect(JSON.parse(stableStringify(artifacts))).toEqual(artifacts);
    // Pin this separate reviewed surface without changing the existing v1 pin.
    expect(digest(artifacts)).toBe('66977092b59068359dce6eb48fbf2c226f3f6f8a78ab1c6587ef39499e8fa813');
  });

  it('keeps every nested object strict and exposes the additional runtime requirements', () => {
    const bundle = generateV2JsonSchemaBundle();
    let objectCount = 0;
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const node = value as Record<string, unknown>;
      if (node.type === 'object') {
        objectCount += 1;
        expect(node.additionalProperties).toBe(false);
      }
      Object.values(node).forEach(visit);
    };
    visit(bundle);
    expect(objectCount).toBeGreaterThan(20);
    expect(bundle['x-project-s-runtime-validation']).toContain('generic JSON Schema validation alone does not execute');
    expect(bundle.$defs.MandateReviewInput['x-project-s-refinements']).toEqual(expect.arrayContaining([
      expect.stringContaining('meetingWindowEnd > meetingWindowStart'),
      expect.stringContaining('issuedAt'),
    ]));
    expect(bundle.$defs.Instant['x-project-s-normalization']).toBeDefined();
    expect(bundle.$defs.ActorContext['x-project-s-internal-only']).toBe(true);
    expect(bundle.$defs.PrincipalContext['x-project-s-internal-only']).toBe(true);
    expect(bundle.$defs.ProblemCode.enum).toContain('STEP_UP_REQUIRED');
    expect(bundle.$defs.ActorRegisterInput).toMatchObject({ required: ['label'] });
  });

  it('ships the new schemas only through the separate package export', async () => {
    const v1 = await import('@project-s/contracts');
    const v2 = await import('@project-s/contracts/v2');
    expect(v1).not.toHaveProperty('v2PrepareBookingInputSchema');
    expect(v1).not.toHaveProperty('generateV2JsonSchemaBundle');
    expect(v1).not.toHaveProperty('v2ActorContextSchema');
    expect(v1).not.toHaveProperty('v2ProblemEnvelopeSchema');
    expect(v2.PROJECT_S_V2_CONTRACT_VERSION).toBe(2);
    expect(v2.v2PrepareBookingInputSchema).toBeDefined();
    expect(v2.v2ActorContextSchema).toBeDefined();
    expect(v2.v2ActorRevokeInputSchema).toBeDefined();
    expect(v2.v2ProblemEnvelopeSchema).toBeDefined();
    expect(v2.generateV2ContractArtifacts()).toEqual(generateV2ContractArtifacts());
  });
});
