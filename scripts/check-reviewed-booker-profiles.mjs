import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { collectDoctor, parseEnv } from './lib/local-setup.mjs';

// This proof owns only disposable, synthetic fixtures. It never enables a route,
// resets a stack, accepts a remote endpoint or prints credentials/PII/SQL errors.
let stage = 'explicit disposable-test authorization';
const check = (condition) => {
  if (!condition) throw new Error('Synthetic authority assertion failed.');
};
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const safeError = (error) => ({ code: error?.code, status: error?.status, message: error?.message });
const refusal = async (operation, code, status) => {
  let result;
  try { await operation(); } catch (error) { result = safeError(error); }
  check(result?.code === code && result?.status === status);
  return result;
};

async function main() {
  check(process.env.PROJECT_S_DISPOSABLE_AUTHORITY_TEST === '1');
  stage = 'owned local stack preflight';
  const doctor = await collectDoctor();
  check(doctor.ok && doctor.state.markerMatches);
  const config = readFileSync('supabase/config.toml', 'utf8');
  check(/^project_id\s*=\s*"project-s-local"\s*$/m.test(config));
  const status = spawnSync(process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 256 * 1024 });
  check(!status.error && status.status === 0);
  const values = parseEnv(status.stdout);
  const origin = new URL(values.API_URL);
  check(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' &&
    origin.port === '54321' && origin.pathname === '/' && !origin.search &&
    !origin.hash && !origin.username && !origin.password);
  check(typeof values.ANON_KEY === 'string' && values.ANON_KEY.length > 0 &&
    typeof values.SERVICE_ROLE_KEY === 'string' && values.SERVICE_ROLE_KEY.length > 0);

  const sql = (query) => {
    const result = spawnSync('docker', ['exec', '-i', 'supabase_db_project-s-local',
      'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
    { encoding: 'utf8', input: query, windowsHide: true, timeout: 20_000, maxBuffer: 256 * 1024 });
    check(!result.error && result.status === 0);
    return result.stdout.trim();
  };
  const client = (key) => createClient(origin.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }) },
  });
  const server = client(values.SERVICE_ROLE_KEY);
  const rpc = (name, args) => server.rpc(name, args);
  const {
    authenticatePrincipal, createActorCredential,
  } = await import('../supabase/functions/_shared/actorCredentials.ts');
  const {
    createReviewedBookerProfile, deleteReviewedBookerProfile,
  } = await import('../supabase/functions/_shared/reviewedBookerProfiles.ts');
  const binding = { instanceId: randomUUID(), epoch: 1, audience: origin.origin };
  const users = [];
  const clients = [];
  let configured = false;
  let failed = false;
  const profile = { name: '  Synthetic Booker  ', email: '  BOOKER@EXAMPLE.INVALID  ', guestTimeZone: 'America/Halifax' };
  let passed = 0;
  const record = () => { passed += 1; };
  const signup = async () => {
    const browser = client(values.ANON_KEY);
    clients.push(browser);
    const suffix = randomUUID().replaceAll('-', '');
    const signed = await browser.auth.signUp({
      email: `profile-proof-${suffix}@example.invalid`, password: `Synthetic-${randomUUID()}-aA1!`,
      options: { data: { username: `pp-${suffix.slice(0, 20)}`, full_name: 'Synthetic authority principal', timezone: 'UTC' } },
    });
    // Register a successfully created user for cleanup even if no session was returned.
    if (uuid(signed.data.user?.id)) users.push(signed.data.user.id);
    check(!signed.error && uuid(signed.data.user?.id) && signed.data.session?.access_token);
    const authorization = `Bearer ${signed.data.session.access_token}`;
    const context = await authenticatePrincipal({ authorization, requestId: `profile-proof-${randomUUID()}`,
      transport: 'http', binding, auth: browser.auth });
    check(context.principalId === signed.data.user.id && context.subjectId === signed.data.user.id);
    return { browser, authorization, context };
  };
  try {
    stage = 'empty synthetic instance configuration';
    sql(`begin; lock table private.v2_authority_instance in exclusive mode;
      do $$begin if exists(select 1 from private.v2_authority_instance) then
        raise exception 'Disposable authority instance is not empty'; end if; end$$;
      insert into private.v2_authority_instance(instance_id,epoch,audience)
      values(${literal(binding.instanceId)},1,${literal(binding.audience)}); commit;`);
    configured = true;
    stage = 'two independent real Auth signups and principal verification';
    const a = await signup();
    const b = await signup();
    check(a.context.principalId !== b.context.principalId);
    record();

    stage = 'own profile creation and strict metadata';
    const created = await createReviewedBookerProfile({ context: a.context, input: profile, binding, rpc });
    const other = await createReviewedBookerProfile({ context: b.context, input: profile, binding, rpc });
    check(uuid(created.profileId) && created.profileId !== other.profileId && created.revision === 1);
    check(Object.keys(created).sort().join(',') === 'expiresAt,profileId,reviewedAt,revision');
    record();
    stage = 'normalized private data and exact seven-day lifetime';
    check(sql(`select count(*) from private.v2_booker_profiles where profile_id=${literal(created.profileId)}
      and principal_id=${literal(a.context.principalId)} and instance_id=${literal(binding.instanceId)}
      and epoch=1 and state='active' and name='Synthetic Booker' and email='booker@example.invalid'
      and guest_time_zone='America/Halifax' and expires_at-reviewed_at=interval '168 hours';`) === '1');
    record();

    stage = 'strict input refuses notes and caller-supplied identity before RPC';
    let calls = 0;
    const observedRpc = (name, args) => { calls += 1; return rpc(name, args); };
    await refusal(() => createReviewedBookerProfile({ context: a.context,
      input: { ...profile, notes: 'not accepted' }, binding, rpc: observedRpc }), 'VALIDATION_ERROR', 400);
    await refusal(() => createReviewedBookerProfile({ context: a.context,
      input: { ...profile, principalId: b.context.principalId }, binding, rpc: observedRpc }), 'VALIDATION_ERROR', 400);
    check(calls === 0);
    record();

    stage = 'other principal and unknown profile share one minimal refusal';
    const foreign = await refusal(() => deleteReviewedBookerProfile({ context: b.context,
      profileId: created.profileId, input: { expectedRevision: 1 }, binding, rpc }), 'FORBIDDEN', 403);
    const unknown = await refusal(() => deleteReviewedBookerProfile({ context: b.context,
      profileId: randomUUID(), input: { expectedRevision: 1 }, binding, rpc }), 'FORBIDDEN', 403);
    check(JSON.stringify(foreign) === JSON.stringify(unknown));
    record();

    stage = 'genuine authenticated and anonymous clients cannot invoke controls directly';
    const untrusted = [a.browser, client(values.ANON_KEY)];
    clients.push(untrusted[1]);
    for (const caller of untrusted) {
      const deniedCreate = await caller.rpc('project_s_create_booker_profile_v2', {
        p_context: a.context, p_profile_id: randomUUID(), p_profile: profile,
      });
      const deniedDelete = await caller.rpc('project_s_delete_booker_profile_v2', {
        p_context: a.context, p_profile_id: created.profileId, p_expected_revision: 1,
      });
      check(deniedCreate.error?.code === '42501' && deniedDelete.error?.code === '42501');
    }
    record();

    stage = 'actor opaque credentials are not principal authentication';
    const actor = await createActorCredential();
    let authCalls = 0;
    await refusal(() => authenticatePrincipal({ authorization: `Bearer ${actor.credential}`,
      requestId: 'profile-proof-actor-denial', transport: 'http', binding,
      auth: { getUser: (...args) => { authCalls += 1; return a.browser.auth.getUser(...args); } } }), 'AUTHENTICATION_REQUIRED', 401);
    check(authCalls === 0);
    record();
    stage = 'invalid account token fails real Auth verification';
    await refusal(() => authenticatePrincipal({ authorization: 'Bearer invalid-synthetic-account-token',
      requestId: 'profile-proof-invalid-auth', transport: 'http', binding, auth: a.browser.auth }), 'AUTHENTICATION_REQUIRED', 401);
    record();

    stage = 'stale instance epoch is denied by the real RPC';
    await refusal(() => createReviewedBookerProfile({ context: { ...a.context, epoch: 2 }, input: profile,
      binding: { ...binding, epoch: 2 }, rpc }), 'AUTHENTICATION_REQUIRED', 401);
    record();
    stage = 'stale delete revision does not remove private data';
    await refusal(() => deleteReviewedBookerProfile({ context: a.context,
      profileId: created.profileId, input: { expectedRevision: 2 }, binding, rpc }), 'VERSION_CONFLICT', 409);
    record();

    stage = 'own deletion and exact retry remove PII without a second event';
    const deleted = await deleteReviewedBookerProfile({ context: a.context,
      profileId: created.profileId, input: { expectedRevision: 1 }, binding, rpc });
    const retry = await deleteReviewedBookerProfile({ context: a.context,
      profileId: created.profileId, input: { expectedRevision: 1 }, binding, rpc });
    check(deleted.profileId === created.profileId && deleted.state === 'deleted' &&
      JSON.stringify(deleted) === JSON.stringify(retry));
    check(sql(`select count(*) from private.v2_booker_profiles where profile_id=${literal(created.profileId)}
      and state='deleted' and name is null and email is null and guest_time_zone is null and deleted_at is not null;`) === '1');
    check(sql(`select count(*) from private.v2_authority_events where instance_id=${literal(binding.instanceId)}
      and epoch=1 and principal_id=${literal(a.context.principalId)} and action='profile_deleted';`) === '1');
    record();

    stage = 'live account deletion invalidates an already verified context';
    sql(`delete from auth.users where id=${literal(b.context.principalId)};`);
    await refusal(() => createReviewedBookerProfile({ context: b.context, input: profile, binding, rpc }),
      'AUTHENTICATION_REQUIRED', 401);
    await refusal(() => authenticatePrincipal({ authorization: b.authorization,
      requestId: 'profile-proof-deleted-auth', transport: 'http', binding, auth: b.browser.auth }),
    'AUTHENTICATION_REQUIRED', 401);
    record();

    stage = 'minimal sequenced audit contains no profile fields';
    check(sql(`select count(*) from private.v2_authority_events e where instance_id=${literal(binding.instanceId)}
      and epoch=1 and to_jsonb(e) ?| array['name','email','guestTimeZone','guest_time_zone','profile_id','credential','token'];`) === '0');
    check(sql(`select count(*) from private.v2_authority_events where instance_id=${literal(binding.instanceId)} and epoch=1;`) === '3');
    record();
  } catch {
    failed = true;
  } finally {
    const previousStage = stage;
    stage = 'owned synthetic fixture cleanup';
    try {
      if (configured) {
        const ids = users.map(literal).join(',');
        const ownerClause = ids ? `principal_id in (${ids})` : 'false';
        sql(`begin;
          delete from private.v2_booker_profiles where instance_id=${literal(binding.instanceId)} and epoch=1 and ${ownerClause};
          delete from private.v2_actor_credentials where instance_id=${literal(binding.instanceId)} and epoch=1 and ${ownerClause};
          delete from private.v2_authority_events where instance_id=${literal(binding.instanceId)} and epoch=1 and ${ownerClause};
          delete from private.v2_authority_principals where instance_id=${literal(binding.instanceId)} and epoch=1 and ${ownerClause};
          ${ids ? `delete from auth.users where id in (${ids});` : ''}
          delete from private.v2_authority_instance where instance_id=${literal(binding.instanceId)} and epoch=1
            and not exists(select 1 from private.v2_authority_principals where instance_id=${literal(binding.instanceId)} and epoch=1);
          commit;`);
        check(sql(`select count(*) from private.v2_authority_instance where instance_id=${literal(binding.instanceId)};`) === '0');
      }
      for (const browser of clients) browser.auth.stopAutoRefresh();
      if (failed) stage = previousStage;
    } catch {
      failed = true;
    }
  }
  check(!failed);
  console.log(`Reviewed booker profiles: ${passed} live Auth/RPC checks passed; synthetic fixtures removed; routes remain disabled.`);
}

try { await main(); }
catch {
  console.error(`Reviewed booker profile proof failed at: ${stage}. Diagnostics withheld to protect local credentials and private data.`);
  process.exitCode = 1;
}
