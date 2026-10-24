import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  v2ActorContextSchema, v2ActorRegisterInputSchema, v2ActorRevokedDataSchema,
  v2DigestNode, v2InstantNode, v2InstantToEpochMicroseconds,
  v2PrincipalContextSchema, v2RevisionNode, v2UuidNode,
} from './.generated/contracts/dist/v2/index.js';

// Internal server adapter only. There is deliberately no route or browser/MCP
// wiring. Context parsing is not authentication; every future kernel operation
// must re-read live state under its principal fence, even after verification.
export interface AuthorityBinding { instanceId: string; epoch: number; audience: string }
export interface AuthorityRpcResult { data: unknown; error: { code?: string; message?: string } | null }
export type AuthorityRpc = (name: string, args: Record<string, unknown>) => PromiseLike<AuthorityRpcResult>;
export interface PrincipalAuth {
  getUser(jwt: string): PromiseLike<{
    data: { user: { id: string; is_anonymous?: boolean } | null };
    error: unknown;
  }>;
}
type PrincipalContext = z.infer<typeof v2PrincipalContextSchema>;
type Clock = () => Date;

export class ActorCredentialError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ActorCredentialError';
    this.code = code;
    this.status = status;
  }
}
const denied = () => new ActorCredentialError('AUTHENTICATION_REQUIRED', 401, 'Authentication is required.');
const internal = () => new ActorCredentialError('INTERNAL_ERROR', 500, 'The authority service could not complete the request.');
const busy = () => new ActorCredentialError('AUTHORITY_BUSY', 503, 'The authority service is busy. Retry the same request.');
const bindingSchema = z.object({
  instanceId: v2UuidNode.zod, epoch: v2RevisionNode.zod, audience: z.string(),
}).strict();
const metadataShape = {
  actorId: v2UuidNode.zod, credentialId: v2UuidNode.zod, revision: v2RevisionNode.zod,
  issuedAt: v2InstantNode.zod, expiresAt: v2InstantNode.zod,
  instanceId: v2UuidNode.zod, epoch: v2RevisionNode.zod, audience: z.string(),
};
const registeredSchema = z.object(metadataShape).strict();
const lookupSchema = z.object({
  ...metadataShape, principalId: v2UuidNode.zod, subjectId: v2UuidNode.zod,
  verifier: v2DigestNode.zod,
}).strict();

const checkedBinding = (input: AuthorityBinding): AuthorityBinding => {
  const parsed = bindingSchema.safeParse(input);
  if (!parsed.success) throw denied();
  try {
    const url = new URL(parsed.data.audience);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.origin !== parsed.data.audience || url.username || url.password ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw denied();
  } catch { throw denied(); }
  return parsed.data;
};
const bearer = (authorization: string | null): string => {
  if (typeof authorization !== 'string' || !/^Bearer [^\s]+$/.test(authorization)) throw denied();
  return authorization.slice(7);
};
const currentTime = (now: Clock): string => {
  try { return v2InstantNode.zod.parse(now().toISOString()); } catch { throw internal(); }
};
const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/../g) ?? [], (part) => Number.parseInt(part, 16));
const digest = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
const tokenParts = (credential: string): { credentialId: string; secret: Uint8Array } => {
  // Exact grammar bounds the decode/hash work. Reject noncanonical pad bits,
  // uppercase aliases, whitespace, extra segments and padding before any RPC.
  if (credential.length !== 85) throw denied();
  const parts = /^psa2\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(credential);
  if (!parts || !v2UuidNode.zod.safeParse(parts[1]).success) throw denied();
  let secret: Uint8Array;
  try { secret = Uint8Array.from(atob(parts[2].replaceAll('-', '+').replaceAll('_', '/') + '='), (c) => c.charCodeAt(0)); }
  catch { throw denied(); }
  if (secret.length !== 32 || base64url(secret) !== parts[2]) throw denied();
  return { credentialId: parts[1], secret };
};

export const createActorCredential = async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  try {
    const actorId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    return { actorId, credentialId, credential: `psa2.${credentialId}.${base64url(secret)}`, verifier: toHex(await digest(secret)) };
  } finally { secret.fill(0); }
};

const invoke = async (rpc: AuthorityRpc, name: string, args: Record<string, unknown>): Promise<unknown> => {
  let result: AuthorityRpcResult;
  try { result = await rpc(name, args); } catch { throw internal(); }
  if (!result || result.error) {
    const code = result?.error?.code;
    if (['PT503', '55P03', '57014', '40P01', '40001'].includes(code ?? '')) throw busy();
    if (code === 'PT400') throw new ActorCredentialError('VALIDATION_ERROR', 400, 'The credential request is invalid.');
    if (code === 'PT401') throw denied();
    if (code === 'PT403') throw new ActorCredentialError('FORBIDDEN', 403, 'This operation is not permitted.');
    if (code === 'PT409') throw new ActorCredentialError('VERSION_CONFLICT', 409, 'The authority state has changed.');
    throw internal();
  }
  return result.data;
};
const contextForBinding = (context: PrincipalContext, binding: AuthorityBinding): PrincipalContext => {
  const parsed = v2PrincipalContextSchema.safeParse(context);
  if (!parsed.success || parsed.data.instanceId !== binding.instanceId || parsed.data.epoch !== binding.epoch) throw denied();
  return parsed.data;
};

/** Verify against Auth; never decode a JWT or trust getSession/user metadata. */
export const authenticatePrincipal = async ({ authorization, requestId, transport, binding: input, auth, now = () => new Date() }: {
  authorization: string | null; requestId: string; transport: 'ui' | 'http';
  binding: AuthorityBinding; auth: PrincipalAuth; now?: Clock;
}) => {
  const binding = checkedBinding(input);
  const jwt = bearer(authorization);
  if (jwt.startsWith('psa2.')) throw denied();
  let user: { id: string; is_anonymous?: boolean } | null;
  try {
    const response = await auth.getUser(jwt);
    if (response.error) throw denied();
    user = response.data.user;
  } catch { throw denied(); }
  if (!user || user.is_anonymous !== false) throw denied();
  const parsed = v2PrincipalContextSchema.safeParse({
    contractVersion: 2, requestId, transport, principalId: user.id, subjectId: user.id,
    instanceId: binding.instanceId, epoch: binding.epoch, verifiedAt: currentTime(now),
  });
  if (!parsed.success) throw denied();
  return parsed.data;
};

/** Returns evidence of authentication, never a booking permission or cached grant. */
export const authenticateActor = async ({ authorization, requestId, transport, binding: input, rpc, now = () => new Date() }: {
  authorization: string | null; requestId: string; transport: 'http' | 'stdio_mcp';
  binding: AuthorityBinding; rpc: AuthorityRpc; now?: Clock;
}) => {
  const binding = checkedBinding(input);
  const { credentialId, secret } = tokenParts(bearer(authorization));
  let supplied: Uint8Array;
  try { supplied = await digest(secret); } finally { secret.fill(0); }
  const raw = await invoke(rpc, 'project_s_get_actor_credential_v2', {
    p_credential_id: credentialId, p_instance_id: binding.instanceId, p_epoch: binding.epoch,
  });
  const parsed = lookupSchema.safeParse(raw);
  // Native fixed-size comparison also runs for missing/malformed lookup data.
  // This does not claim identical network/database timings for every denial.
  const matched = timingSafeEqual(supplied, parsed.success ? fromHex(parsed.data.verifier) : new Uint8Array(32));
  supplied.fill(0);
  if (!parsed.success || !matched) throw denied();
  const row = parsed.data;
  const verifiedAt = currentTime(now);
  const issued = v2InstantToEpochMicroseconds(row.issuedAt);
  const expires = v2InstantToEpochMicroseconds(row.expiresAt);
  const fresh = v2InstantToEpochMicroseconds(verifiedAt);
  if (row.credentialId !== credentialId || row.instanceId !== binding.instanceId || row.epoch !== binding.epoch ||
      row.audience !== binding.audience || row.subjectId !== row.principalId ||
      issued > fresh || expires <= fresh || expires <= issued || expires - issued > 7n * 86_400_000_000n) throw denied();
  const context = v2ActorContextSchema.safeParse({
    contractVersion: 2, requestId, transport, principalId: row.principalId, subjectId: row.subjectId,
    actorId: row.actorId, credentialId, credentialRevision: row.revision, credentialFingerprint: row.verifier,
    instanceId: binding.instanceId, epoch: binding.epoch, verifiedAt,
  });
  if (!context.success) throw denied();
  return context.data;
};

/** Caller must freshly authenticate the issuer; no public route is wired here. */
export const registerActorCredential = async ({ context, label, expiresAt, binding: input, rpc }: {
  context: PrincipalContext; label: unknown; expiresAt: string; binding: AuthorityBinding; rpc: AuthorityRpc;
}) => {
  const binding = checkedBinding(input);
  const principal = contextForBinding(context, binding);
  const parsedLabel = v2ActorRegisterInputSchema.safeParse({ label });
  const deadline = v2InstantNode.zod.safeParse(expiresAt);
  if (!parsedLabel.success || !deadline.success) throw new ActorCredentialError('VALIDATION_ERROR', 400, 'The credential request is invalid.');
  const created = await createActorCredential();
  const raw = await invoke(rpc, 'project_s_register_actor_v2', {
    p_context: principal, p_actor_id: created.actorId, p_credential_id: created.credentialId,
    p_verifier: `\\x${created.verifier}`, p_label: parsedLabel.data.label, p_expires_at: deadline.data,
  });
  const parsed = registeredSchema.safeParse(raw);
  if (!parsed.success) throw internal();
  const row = parsed.data;
  const issued = v2InstantToEpochMicroseconds(row.issuedAt);
  const expires = v2InstantToEpochMicroseconds(row.expiresAt);
  if (row.actorId !== created.actorId || row.credentialId !== created.credentialId ||
      row.instanceId !== binding.instanceId || row.epoch !== binding.epoch || row.audience !== binding.audience ||
      row.revision !== 1 || row.expiresAt !== deadline.data || expires <= issued || expires - issued > 7n * 86_400_000_000n) throw internal();
  // Only this successful call returns the raw value. No read/retry recovery API
  // can retrieve it; an uncertain outcome must be reconciled before reissuing.
  return { actorId: row.actorId, credentialId: row.credentialId, revision: row.revision,
    credential: created.credential, expiresAt: row.expiresAt, audience: row.audience };
};

export const revokeActorCredential = async ({ context, actorId, expectedRevision, binding: input, rpc }: {
  context: PrincipalContext; actorId: string; expectedRevision: number; binding: AuthorityBinding; rpc: AuthorityRpc;
}) => {
  const binding = checkedBinding(input);
  const principal = contextForBinding(context, binding);
  const actor = v2UuidNode.zod.safeParse(actorId);
  const revision = v2RevisionNode.zod.safeParse(expectedRevision);
  if (!actor.success || !revision.success) throw new ActorCredentialError('VALIDATION_ERROR', 400, 'The credential request is invalid.');
  const raw = await invoke(rpc, 'project_s_revoke_actor_v2', {
    p_context: principal, p_actor_id: actor.data, p_expected_revision: revision.data,
  });
  const parsed = v2ActorRevokedDataSchema.safeParse(raw);
  if (!parsed.success || parsed.data.actorId !== actor.data || parsed.data.revision !== revision.data + 1) throw internal();
  return parsed.data;
};
