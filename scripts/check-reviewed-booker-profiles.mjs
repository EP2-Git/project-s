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
  stage = 'owned local stack doctor';
  const doctor = await collectDoctor();
  if (!doctor.ok) {
    // Only fixed doctor identifiers, never messages, paths or configuration.
    const failed = doctor.checks.filter((item) => item.status === 'FAIL')
      .map((item) => item.id).filter((id) => /^[a-z0-9-]+$/.test(id));
    stage = `owned local stack doctor (${failed.join(',')})`;
    check(false);
  }
  stage = 'bootstrap container identity';
  check(doctor.state.markerMatches);
  stage = 'disposable project identifier';
  const config = readFileSync('supabase/config.toml', 'utf8');
  check(/^project_id\s*=\s*"project-s-local"\s*$/m.test(config));
  stage = 'local CLI status';
  const status = spawnSync(process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 256 * 1024 });
  check(!status.error && status.status === 0);
  const values = parseEnv(status.stdout);
  stage = 'local API origin';
  const origin = new URL(values.API_URL);
  check(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' &&
    origin.port === '54321' && origin.pathname === '/' && !origin.search &&
    !origin.hash && !origin.username && !origin.password);
  stage = 'local API key availability';
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
    authenticatePrincipal, authenticateActor, createActorCredential, registerActorCredential,
  } = await import('../supabase/functions/_shared/actorCredentials.ts');
  const {
    createReviewedBookerProfile, deleteReviewedBookerProfile,
  } = await import('../supabase/functions/_shared/reviewedBookerProfiles.ts');
  const {
    createMandateReview, approveMandate, getMandate, revokeMandate,
  } = await import('../supabase/functions/_shared/mandateControls.ts');
  const binding = { instanceId: randomUUID(), epoch: 1, audience: origin.origin };
  const users = [];
  const clients = [];
  let configured = false;
  let failed = false;
  const profile = { name: '  Synthetic Booker  ', email: '  BOOKER@EXAMPLE.INVALID  ', guestTimeZone: 'America/Halifax' };
  let passed = 0;
  const record = () => { passed += 1; };
  const reauthenticate = (user) => authenticatePrincipal({ authorization: user.authorization,
    requestId: `profile-proof-${randomUUID()}`, transport: 'http', binding, auth: user.browser.auth });
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

    stage = 'real authenticated host creates its own synthetic meeting type';
    const host = await b.browser.from('profiles').select('username,full_name')
      .eq('id', b.context.principalId).single();
    check(!host.error && typeof host.data?.username === 'string');
    const meeting = await b.browser.from('meeting_types').insert({
      user_id: b.context.principalId, title: 'Synthetic authority meeting', duration_minutes: 30,
      active: true, minimum_notice_minutes: 0,
    }).select('id').single();
    check(!meeting.error && uuid(meeting.data?.id));
    record();

    stage = 'principal registers an owned live actor credential';
    const clock = Date.now();
    const instantAfter = (minutes) => new Date(clock + minutes * 60_000).toISOString().replace('Z', '000Z');
    const registered = await registerActorCredential({ context: await reauthenticate(a),
      label: 'Synthetic mandate actor', expiresAt: instantAfter(120), binding, rpc });
    const actorContext = await authenticateActor({ authorization: `Bearer ${registered.credential}`,
      requestId: `profile-proof-${randomUUID()}`, transport: 'http', binding, rpc });
    check(actorContext.principalId === a.context.principalId && actorContext.actorId === registered.actorId);
    const policy = {
      actorId: registered.actorId, profileId: created.profileId, profileRevision: 1,
      username: host.data.username, meetingTypeId: meeting.data.id,
      meetingWindowStart: instantAfter(15), meetingWindowEnd: instantAfter(45), maxDurationMinutes: 30,
      notBefore: instantAfter(10), expiresAt: instantAfter(60),
    };
    record();

    stage = 'owner receives an exact normalized policy review and bounded deadline';
    const reviewStarted = Date.now();
    const reviewed = await createMandateReview({ context: await reauthenticate(a), input: policy, binding, rpc });
    check(uuid(reviewed.reviewId) && reviewed.revision === 1 && /^[a-f0-9]{64}$/.test(reviewed.summaryDigest));
    check(Object.keys(reviewed).sort().join(',') === 'expiresAt,policySummary,reviewId,revision,summaryDigest');
    check(Object.keys(reviewed.policySummary).sort().join(',') ===
      [...Object.keys(policy), 'name', 'email', 'guestTimeZone', 'hostDisplayName', 'meetingTypeTitle'].sort().join(','));
    for (const key of Object.keys(policy)) check(reviewed.policySummary[key] === policy[key]);
    check(reviewed.policySummary.name === 'Synthetic Booker' && reviewed.policySummary.email === 'booker@example.invalid' &&
      reviewed.policySummary.guestTimeZone === 'America/Halifax' &&
      reviewed.policySummary.hostDisplayName === host.data.full_name &&
      reviewed.policySummary.meetingTypeTitle === 'Synthetic authority meeting');
    check(Date.parse(reviewed.expiresAt) > reviewStarted && Date.parse(reviewed.expiresAt) <= Date.now() + 5 * 60_000);
    const approval = { expectedRevision: reviewed.revision, summaryDigest: reviewed.summaryDigest };
    record();

    stage = 'digest mismatch cannot approve a different policy';
    const alteredDigest = `${reviewed.summaryDigest[0] === '0' ? '1' : '0'}${reviewed.summaryDigest.slice(1)}`;
    await refusal(() => approveMandate({ context: a.context, reviewId: reviewed.reviewId,
      input: { ...approval, summaryDigest: alteredDigest }, binding, rpc }), 'VERSION_CONFLICT', 409);
    record();

    stage = 'other principal cannot review or approve owned supporting state';
    await refusal(() => createMandateReview({ context: b.context, input: policy, binding, rpc }), 'FORBIDDEN', 403);
    const foreignReview = await refusal(() => approveMandate({ context: b.context, reviewId: reviewed.reviewId,
      input: approval, binding, rpc }), 'FORBIDDEN', 403);
    const missingReview = await refusal(() => approveMandate({ context: b.context, reviewId: randomUUID(),
      input: approval, binding, rpc }), 'FORBIDDEN', 403);
    check(JSON.stringify(foreignReview) === JSON.stringify(missingReview));
    record();

    stage = 'exact owner approval and retry issue one minimal mandate';
    const approved = await approveMandate({ context: await reauthenticate(a), reviewId: reviewed.reviewId,
      input: approval, binding, rpc });
    const approvedRetry = await approveMandate({ context: await reauthenticate(a), reviewId: reviewed.reviewId,
      input: approval, binding, rpc });
    check(uuid(approved.mandateId) && approved.state === 'active' && approved.revision === 1 &&
      approved.expiresAt === policy.expiresAt && JSON.stringify(approved) === JSON.stringify(approvedRetry));
    check(Object.keys(approved).sort().join(',') === 'expiresAt,issuedAt,mandateId,revision,state');
    const active = await getMandate({ context: await reauthenticate(a), mandateId: approved.mandateId, binding, rpc });
    check(active.mandateId === approved.mandateId && active.state === 'active' && active.revision === 1 && active.remainingUses === 1);
    check(Object.keys(active).sort().join(',') === 'expiresAt,issuedAt,mandateId,remainingUses,revision,state');
    check(sql(`select count(*) from private.v2_mandate_reviews where review_id=${literal(reviewed.reviewId)}
      and instance_id=${literal(binding.instanceId)} and epoch=1 and principal_id=${literal(a.context.principalId)}
      and state='approved' and approved_mandate_id=${literal(approved.mandateId)} and policy_summary is null;`) === '1');
    record();

    stage = 'foreign and unknown mandate controls share one minimal refusal';
    for (const mandateId of [approved.mandateId, randomUUID()]) {
      const invisible = await refusal(() => getMandate({ context: b.context, mandateId, binding, rpc }), 'FORBIDDEN', 403);
      const immutable = await refusal(() => revokeMandate({ context: b.context, mandateId,
        input: { expectedRevision: 1 }, binding, rpc }), 'FORBIDDEN', 403);
      check(JSON.stringify(invisible) === JSON.stringify(foreignReview) && JSON.stringify(immutable) === JSON.stringify(foreignReview));
    }
    record();

    stage = 'authenticated actor cannot act as its principal for any mandate control';
    calls = 0;
    await refusal(() => createMandateReview({ context: actorContext, input: policy, binding, rpc: observedRpc }), 'AUTHENTICATION_REQUIRED', 401);
    await refusal(() => approveMandate({ context: actorContext, reviewId: reviewed.reviewId,
      input: approval, binding, rpc: observedRpc }), 'AUTHENTICATION_REQUIRED', 401);
    await refusal(() => getMandate({ context: actorContext, mandateId: approved.mandateId,
      binding, rpc: observedRpc }), 'AUTHENTICATION_REQUIRED', 401);
    await refusal(() => revokeMandate({ context: actorContext, mandateId: approved.mandateId,
      input: { expectedRevision: 1 }, binding, rpc: observedRpc }), 'AUTHENTICATION_REQUIRED', 401);
    check(calls === 0);
    record();

    stage = 'real anonymous and authenticated clients cannot invoke four mandate RPCs directly';
    for (const caller of untrusted) {
      const direct = [
        ['project_s_create_mandate_review_v2', { p_context: a.context, p_review_id: randomUUID(), p_policy: policy }],
        ['project_s_approve_mandate_v2', { p_context: a.context, p_review_id: reviewed.reviewId,
          p_mandate_id: randomUUID(), p_expected_revision: 1, p_summary_digest: reviewed.summaryDigest }],
        ['project_s_get_mandate_v2', { p_context: a.context, p_mandate_id: approved.mandateId }],
        ['project_s_revoke_mandate_v2', { p_context: a.context, p_mandate_id: approved.mandateId, p_expected_revision: 1 }],
      ];
      for (const [name, args] of direct) {
        const denied = await caller.rpc(name, args);
        check(denied.error?.code === '42501');
      }
    }
    record();

    stage = 'owner revocation and exact retry consume no additional authority or audit';
    await refusal(() => revokeMandate({ context: a.context, mandateId: approved.mandateId,
      input: { expectedRevision: 2 }, binding, rpc }), 'VERSION_CONFLICT', 409);
    const revoked = await revokeMandate({ context: await reauthenticate(a), mandateId: approved.mandateId,
      input: { expectedRevision: 1 }, binding, rpc });
    const revokedRetry = await revokeMandate({ context: await reauthenticate(a), mandateId: approved.mandateId,
      input: { expectedRevision: 1 }, binding, rpc });
    const revokedRead = await getMandate({ context: await reauthenticate(a), mandateId: approved.mandateId, binding, rpc });
    check(revoked.mandateId === approved.mandateId && revoked.state === 'revoked' && revoked.revision === 2 &&
      JSON.stringify(revoked) === JSON.stringify(revokedRetry) && revokedRead.state === 'revoked' && revokedRead.remainingUses === 0);
    record();

    stage = 'owned profile has a second active mandate and a pending private review';
    const secondReview = await createMandateReview({ context: await reauthenticate(a), input: policy, binding, rpc });
    const secondMandate = await approveMandate({ context: await reauthenticate(a), reviewId: secondReview.reviewId,
      input: { expectedRevision: secondReview.revision, summaryDigest: secondReview.summaryDigest }, binding, rpc });
    const pendingReview = await createMandateReview({ context: await reauthenticate(a), input: policy, binding, rpc });
    check(secondMandate.mandateId !== approved.mandateId && pendingReview.reviewId !== secondReview.reviewId);
    check(sql(`select count(*) from private.v2_mandate_reviews where review_id=${literal(pendingReview.reviewId)}
      and instance_id=${literal(binding.instanceId)} and epoch=1 and principal_id=${literal(a.context.principalId)}
      and policy_summary ->> 'email'='booker@example.invalid';`) === '1');
    record();

    stage = 'own deletion and exact retry remove PII without a second event';
    const deleted = await deleteReviewedBookerProfile({ context: await reauthenticate(a),
      profileId: created.profileId, input: { expectedRevision: 1 }, binding, rpc });
    const retry = await deleteReviewedBookerProfile({ context: await reauthenticate(a),
      profileId: created.profileId, input: { expectedRevision: 1 }, binding, rpc });
    check(deleted.profileId === created.profileId && deleted.state === 'deleted' &&
      JSON.stringify(deleted) === JSON.stringify(retry));
    check(sql(`select count(*) from private.v2_booker_profiles where profile_id=${literal(created.profileId)}
      and state='deleted' and name is null and email is null and guest_time_zone is null and deleted_at is not null;`) === '1');
    check(sql(`select count(*) from private.v2_authority_events where instance_id=${literal(binding.instanceId)}
      and epoch=1 and principal_id=${literal(a.context.principalId)} and action='profile_deleted';`) === '1');
    record();

    stage = 'profile deletion atomically invalidates its mandate and clears pending review PII';
    const invalidated = await getMandate({ context: await reauthenticate(a), mandateId: secondMandate.mandateId, binding, rpc });
    check(invalidated.state === 'revoked' && invalidated.revision === 2 && invalidated.remainingUses === 0);
    check(sql(`select count(*) from private.v2_mandates m join private.v2_booker_profiles p
      on (p.instance_id,p.epoch,p.principal_id,p.profile_id)=(m.instance_id,m.epoch,m.principal_id,m.profile_id)
      where m.mandate_id=${literal(secondMandate.mandateId)} and m.instance_id=${literal(binding.instanceId)}
      and m.epoch=1 and m.principal_id=${literal(a.context.principalId)} and m.state='revoked'
      and m.revoked_at=p.deleted_at and m.revoked_sequence=p.deleted_sequence;`) === '1');
    check(sql(`select count(*) from private.v2_mandate_reviews r join private.v2_booker_profiles p
      on (p.instance_id,p.epoch,p.principal_id,p.profile_id)=(r.instance_id,r.epoch,r.principal_id,r.profile_id)
      where r.review_id=${literal(pendingReview.reviewId)} and r.instance_id=${literal(binding.instanceId)}
      and r.epoch=1 and r.principal_id=${literal(a.context.principalId)} and r.state='invalidated'
      and r.policy_summary is null and r.invalidated_at=p.deleted_at and r.invalidated_sequence=p.deleted_sequence;`) === '1');
    await refusal(async () => approveMandate({ context: await reauthenticate(a), reviewId: pendingReview.reviewId,
      input: { expectedRevision: pendingReview.revision, summaryDigest: pendingReview.summaryDigest }, binding, rpc }), 'VERSION_CONFLICT', 409);
    await refusal(() => createMandateReview({ context: a.context, input: policy, binding, rpc }), 'VERSION_CONFLICT', 409);
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
    const auditCounts = JSON.parse(sql(`select jsonb_object_agg(action,n) from
      (select action,count(*) as n from private.v2_authority_events
        where instance_id=${literal(binding.instanceId)} and epoch=1 group by action) as counts;`));
    const expectedAuditCounts = { actor_registered: 1, profile_reviewed: 2, profile_deleted: 1,
      mandate_reviewed: 3, mandate_approved: 2, mandate_revoked: 1 };
    check(Object.keys(auditCounts).sort().join(',') === Object.keys(expectedAuditCounts).sort().join(','));
    for (const action of Object.keys(expectedAuditCounts)) check(auditCounts[action] === expectedAuditCounts[action]);
    check(sql(`select count(*) from (select sequence,
      row_number() over(partition by principal_id order by sequence) as expected_sequence
      from private.v2_authority_events where instance_id=${literal(binding.instanceId)} and epoch=1) as sequenced
      where sequence<>expected_sequence;`) === '0');
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
          delete from private.v2_mandates where instance_id=${literal(binding.instanceId)} and epoch=1 and ${ownerClause};
          delete from private.v2_mandate_reviews where instance_id=${literal(binding.instanceId)} and epoch=1 and ${ownerClause};
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
  console.log(`Reviewed profiles and mandate controls: ${passed} live Auth/RPC checks passed; synthetic fixtures removed; routes remain disabled.`);
}

try { await main(); }
catch {
  console.error(`Reviewed profile and mandate proof failed at: ${stage}. Diagnostics withheld to protect local credentials and private data.`);
  process.exitCode = 1;
}
