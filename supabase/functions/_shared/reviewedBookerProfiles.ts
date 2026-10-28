import { z } from 'zod';
import {
  v2BookerProfileCreateInputSchema, v2BookerProfileCreatedDataSchema,
  v2BookerProfileDeleteInputSchema, v2BookerProfileDeletedDataSchema,
  v2PrincipalContextSchema, v2RevisionNode, v2UuidNode,
} from './.generated/contracts/dist/v2/index.js';
import { ActorCredentialError, type AuthorityBinding, type AuthorityRpc } from './actorCredentials.ts';

// Server-only controls. A context is not authentication: the caller must use
// authenticatePrincipal immediately before this adapter, and SQL rechecks live
// account/instance/ownership state under the principal fence. No route is wired.
const bindingSchema = z.object({
  instanceId: v2UuidNode.zod, epoch: v2RevisionNode.zod, audience: z.string(),
}).strict();
const failure = (code: string, status: number, message: string) =>
  new ActorCredentialError(code, status, message);
const invalid = () => failure('VALIDATION_ERROR', 400, 'The reviewed profile request is invalid.');
const denied = () => failure('AUTHENTICATION_REQUIRED', 401, 'Authentication is required.');
const internal = () => failure('INTERNAL_ERROR', 500, 'The authority service could not complete the request.');

const principalFor = (context: unknown, binding: AuthorityBinding) => {
  const config = bindingSchema.safeParse(binding);
  const principal = v2PrincipalContextSchema.safeParse(context);
  if (!config.success || !principal.success ||
      principal.data.instanceId !== config.data.instanceId || principal.data.epoch !== config.data.epoch) throw denied();
  try {
    const origin = new URL(config.data.audience);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
    if (origin.origin !== config.data.audience || origin.username || origin.password ||
        (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) throw denied();
  } catch { throw denied(); }
  return principal.data;
};

const invoke = async (rpc: AuthorityRpc, name: string, args: Record<string, unknown>) => {
  let result;
  try { result = await rpc(name, args); } catch { throw internal(); }
  if (!result || result.error) {
    const code = result?.error?.code;
    if (['PT503', '55P03', '57014', '40P01', '40001'].includes(code ?? '')) {
      throw failure('AUTHORITY_BUSY', 503, 'The authority service is busy. Retry the same request.');
    }
    if (code === 'PT400') throw invalid();
    if (code === 'PT401') throw denied();
    if (code === 'PT403') throw failure('FORBIDDEN', 403, 'This operation is not permitted.');
    if (code === 'PT409') throw failure('VERSION_CONFLICT', 409, 'The authority state has changed.');
    throw internal();
  }
  return result.data;
};

export const createReviewedBookerProfile = async ({ context, input, binding, rpc }: {
  context: unknown; input: unknown; binding: AuthorityBinding; rpc: AuthorityRpc;
}) => {
  const principal = principalFor(context, binding);
  const parsed = v2BookerProfileCreateInputSchema.safeParse(input);
  if (!parsed.success) throw invalid();
  // Private random identity; it is never accepted from the public input. There
  // is no automatic retry or public create-idempotency promise in this unit.
  const profileId = crypto.randomUUID();
  const raw = await invoke(rpc, 'project_s_create_booker_profile_v2', {
    p_context: principal, p_profile_id: profileId, p_profile: parsed.data,
  });
  const result = v2BookerProfileCreatedDataSchema.safeParse(raw);
  if (!result.success || result.data.profileId !== profileId || result.data.revision !== 1) throw internal();
  return result.data;
};

export const deleteReviewedBookerProfile = async ({ context, profileId, input, binding, rpc }: {
  context: unknown; profileId: string; input: unknown; binding: AuthorityBinding; rpc: AuthorityRpc;
}) => {
  const principal = principalFor(context, binding);
  const profile = v2UuidNode.zod.safeParse(profileId);
  const parsed = v2BookerProfileDeleteInputSchema.safeParse(input);
  if (!profile.success || !parsed.success) throw invalid();
  const raw = await invoke(rpc, 'project_s_delete_booker_profile_v2', {
    p_context: principal, p_profile_id: profile.data, p_expected_revision: parsed.data.expectedRevision,
  });
  const result = v2BookerProfileDeletedDataSchema.safeParse(raw);
  if (!result.success || result.data.profileId !== profile.data) throw internal();
  return result.data;
};
