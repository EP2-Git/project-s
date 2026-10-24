import { z } from 'zod';

import { requestIdNode } from '../common.js';
import { contractEnum, contractNode, objectNode } from '../schema.js';
import { v2ContractVersionNode, v2DigestNode, v2InstantNode, v2RevisionNode, v2UuidNode } from './scalars.js';

// Internal, server-derived inputs from ADR 0004. Parsing an object does not
// verify an account, credential, principal, audience or current permission.
const principalShape = {
  contractVersion: v2ContractVersionNode,
  requestId: requestIdNode,
  principalId: v2UuidNode,
  subjectId: v2UuidNode,
  instanceId: v2UuidNode,
  epoch: v2RevisionNode,
  verifiedAt: v2InstantNode,
} as const;
const sameSubject = (value: { principalId: string; subjectId: string }): boolean =>
  value.subjectId === value.principalId;
const subjectBinding = {
  message: 'The initial authority subject must be the issuing principal.',
  path: ['subjectId'],
};
const bindingRefinements = [
  'subjectId equals principalId after UUID normalization; issuing for another subject is unsupported.',
  'epoch is a positive safe integer. Verify it and instanceId against live private Core configuration.',
  'Server-derived only: parsing verifiedAt or a credential fingerprint does not authenticate the caller or cache permission.',
] as const;

const principalContextBaseNode = objectNode({
  ...principalShape,
  transport: contractNode(contractEnum(['ui', 'http']), { type: 'string', enum: ['ui', 'http'] }),
}, {
  title: 'V2PrincipalContext',
  description: 'Internal verified-account context. Never accept a public body or context override as this input.',
});
export const v2PrincipalContextNode = contractNode(
  principalContextBaseNode.zod.refine(sameSubject, subjectBinding),
  {
    ...principalContextBaseNode.jsonSchema,
    'x-project-s-internal-only': true,
    'x-project-s-refinements': bindingRefinements,
  },
);
export const v2PrincipalContextSchema = v2PrincipalContextNode.zod;

const actorContextBaseNode = objectNode({
  ...principalShape,
  actorId: v2UuidNode,
  credentialId: v2UuidNode,
  credentialRevision: v2RevisionNode,
  credentialFingerprint: v2DigestNode,
  transport: contractNode(contractEnum(['http', 'stdio_mcp']), { type: 'string', enum: ['http', 'stdio_mcp'] }),
}, {
  title: 'V2ActorContext',
  description: 'Internal verified-credential context. Fingerprint and identity references stay out of public responses and logs.',
});
export const v2ActorContextNode = contractNode(
  actorContextBaseNode.zod.refine(sameSubject, subjectBinding),
  {
    ...actorContextBaseNode.jsonSchema,
    'x-project-s-internal-only': true,
    'x-project-s-refinements': bindingRefinements,
  },
);
export const v2ActorContextSchema = v2ActorContextNode.zod;

export type V2PrincipalContext = z.infer<typeof v2PrincipalContextSchema>;
export type V2ActorContext = z.infer<typeof v2ActorContextSchema>;
