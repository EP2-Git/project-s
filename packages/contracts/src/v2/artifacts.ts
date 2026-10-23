import type { JsonSchema } from '../schema.js';
import {
  v2ProblemAlternativeNode,
  v2ProblemCodeNode,
  v2ProblemEnvelopeNode,
  v2ProblemNode,
  v2ProblemStepUpNode,
  v2StepUpReviewUrlNode,
} from './problems.js';
import { v2ActorContextNode, v2PrincipalContextNode } from './contexts.js';
import {
  v2ActorRegisterInputNode,
  v2ActorRevokeInputNode,
  v2ActorRevokedDataNode,
  v2ActorRevokedResponseNode,
  v2BookerProfileCreateInputNode,
  v2BookerProfileCreatedDataNode,
  v2BookerProfileCreatedResponseNode,
  v2BookerProfileDeleteInputNode,
  v2BookerProfileDeletedDataNode,
  v2BookerProfileDeletedResponseNode,
  v2ExpectedRevisionInputNode,
  v2MandateRevokeInputNode,
  v2MandateRevokedDataNode,
  v2MandateRevokedResponseNode,
  v2StepUpApproveInputNode,
  v2StepUpApprovedDataNode,
  v2StepUpApprovedResponseNode,
  v2StepUpRevokeInputNode,
  v2StepUpRevokedDataNode,
  v2StepUpRevokedResponseNode,
} from './controls.js';
import {
  v2ContractVersionNode,
  v2DigestNode,
  v2InstantNode,
  v2RevisionNode,
  v2UuidNode,
} from './scalars.js';
import {
  v2BookingNode,
  v2BookingReceiptDataNode,
  v2CreateBookingInputNode,
  v2CreateBookingResponseNode,
  v2MandateApproveInputNode,
  v2MandateApprovedDataNode,
  v2MandateApprovedResponseNode,
  v2MandatePolicySummaryNode,
  v2MandateReviewDataNode,
  v2MandateReviewInputNode,
  v2MandateReviewResponseNode,
  v2PrepareBookingDataNode,
  v2PrepareBookingInputNode,
  v2PrepareBookingResponseNode,
  v2PreparedBookingSummaryNode,
} from './operations.js';

export const PROJECT_S_V2_CONTRACT_VERSION = 2 as const;
export const PROJECT_S_V2_CONTRACT_MEDIA_TYPE =
  'application/vnd.project-s.v2+json' as const;
export const PROJECT_S_V2_PROBLEM_MEDIA_TYPE = 'application/problem+json' as const;

/** Structural schemas and documented runtime refinements, not API discovery. */
export const generateV2JsonSchemaBundle = () => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://project-s.example/schemas/authority-foundation-v2.json',
  title: 'Project S v2 authority contract foundation',
  description:
    'Incremental implementation of ADR 0004. Schemas alone do not verify identity, ownership, live authority or SQL correctness. No v2 endpoint or delegated booking is available.',
  'x-project-s-status': 'foundation-only-unavailable',
  'x-project-s-success-media-type': PROJECT_S_V2_CONTRACT_MEDIA_TYPE,
  'x-project-s-problem-media-type': PROJECT_S_V2_PROBLEM_MEDIA_TYPE,
  'x-project-s-runtime-validation':
    'Use the exported runtime parsers for normalization and cross-field refinements. JSON Schema extensions describe these checks; generic JSON Schema validation alone does not execute them.',
  $defs: {
    ContractVersion: v2ContractVersionNode.jsonSchema,
    Uuid: v2UuidNode.jsonSchema,
    Revision: v2RevisionNode.jsonSchema,
    Digest: v2DigestNode.jsonSchema,
    Instant: v2InstantNode.jsonSchema,
    ProblemCode: v2ProblemCodeNode.jsonSchema,
    StepUpReviewUrl: v2StepUpReviewUrlNode.jsonSchema,
    ProblemStepUp: v2ProblemStepUpNode.jsonSchema,
    ProblemAlternative: v2ProblemAlternativeNode.jsonSchema,
    Problem: v2ProblemNode.jsonSchema,
    ProblemEnvelope: v2ProblemEnvelopeNode.jsonSchema,
    PrincipalContext: v2PrincipalContextNode.jsonSchema,
    ActorContext: v2ActorContextNode.jsonSchema,
    ActorRegisterInput: v2ActorRegisterInputNode.jsonSchema,
    ExpectedRevisionInput: v2ExpectedRevisionInputNode.jsonSchema,
    ActorRevokeInput: v2ActorRevokeInputNode.jsonSchema,
    ActorRevokedData: v2ActorRevokedDataNode.jsonSchema,
    ActorRevokedResponse: v2ActorRevokedResponseNode.jsonSchema,
    BookerProfileCreateInput: v2BookerProfileCreateInputNode.jsonSchema,
    BookerProfileCreatedData: v2BookerProfileCreatedDataNode.jsonSchema,
    BookerProfileCreatedResponse: v2BookerProfileCreatedResponseNode.jsonSchema,
    BookerProfileDeleteInput: v2BookerProfileDeleteInputNode.jsonSchema,
    BookerProfileDeletedData: v2BookerProfileDeletedDataNode.jsonSchema,
    BookerProfileDeletedResponse: v2BookerProfileDeletedResponseNode.jsonSchema,
    MandateRevokeInput: v2MandateRevokeInputNode.jsonSchema,
    MandateRevokedData: v2MandateRevokedDataNode.jsonSchema,
    MandateRevokedResponse: v2MandateRevokedResponseNode.jsonSchema,
    StepUpApproveInput: v2StepUpApproveInputNode.jsonSchema,
    StepUpApprovedData: v2StepUpApprovedDataNode.jsonSchema,
    StepUpApprovedResponse: v2StepUpApprovedResponseNode.jsonSchema,
    StepUpRevokeInput: v2StepUpRevokeInputNode.jsonSchema,
    StepUpRevokedData: v2StepUpRevokedDataNode.jsonSchema,
    StepUpRevokedResponse: v2StepUpRevokedResponseNode.jsonSchema,
    MandateReviewInput: v2MandateReviewInputNode.jsonSchema,
    MandatePolicySummary: v2MandatePolicySummaryNode.jsonSchema,
    MandateReviewData: v2MandateReviewDataNode.jsonSchema,
    MandateReviewResponse: v2MandateReviewResponseNode.jsonSchema,
    MandateApproveInput: v2MandateApproveInputNode.jsonSchema,
    MandateApprovedData: v2MandateApprovedDataNode.jsonSchema,
    MandateApprovedResponse: v2MandateApprovedResponseNode.jsonSchema,
    PrepareBookingInput: v2PrepareBookingInputNode.jsonSchema,
    PreparedBookingSummary: v2PreparedBookingSummaryNode.jsonSchema,
    PrepareBookingData: v2PrepareBookingDataNode.jsonSchema,
    PrepareBookingResponse: v2PrepareBookingResponseNode.jsonSchema,
    CreateBookingInput: v2CreateBookingInputNode.jsonSchema,
    Booking: v2BookingNode.jsonSchema,
    BookingReceiptData: v2BookingReceiptDataNode.jsonSchema,
    CreateBookingResponse: v2CreateBookingResponseNode.jsonSchema,
  } satisfies Record<string, JsonSchema>,
} as const);

// Intentionally no v2 OpenAPI paths or MCP manifest before adapter implementation.
export const generateV2ContractArtifacts = () => ({
  jsonSchemaBundle: generateV2JsonSchemaBundle(),
});

export type ProjectSV2ContractArtifacts = ReturnType<typeof generateV2ContractArtifacts>;
