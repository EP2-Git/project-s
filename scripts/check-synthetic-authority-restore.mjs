import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { collectDoctor } from './lib/local-setup.mjs';

const source = 'postgres';
const admin = 'supabase_admin';
const audience = 'http://127.0.0.1:54321';
const scratchName = /^project_s_restore_[a-f0-9]{16}$/;
const script = 'scripts/check-synthetic-authority-restore.mjs';
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
let stage = 'explicit disposable stack opt-in';
let docker;

function run(command, args, input) {
  return spawnSync(command, args, { input, encoding: 'utf8', timeout: 60_000,
    maxBuffer: 256 * 1024, windowsHide: true });
}

function checked(result) {
  if (result.error || result.status !== 0) {
    const sqlState = /^ERROR:\s+([0-9A-Z]{5})\s*$/m.exec(result.stderr ?? '')?.[1];
    if (sqlState) throw Object.assign(new Error('SQL command refused'), { code: sqlState });
    throw new Error('Disposable command failed');
  }
  return result.stdout.trim();
}

function adminCommand(name, args) {
  // The disposable container already holds its own bootstrap password.
  return docker(['sh', '-c', 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'project-s-restore',
    name, '-h', '127.0.0.1', '--no-password', '-U', admin, ...args]);
}

function sql(database, query) {
  assert(database === source || scratchName.test(database));
  return checked(docker(['psql', '--no-password', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
    '\\set VERBOSITY sqlstate\n' + query));
}

// The internal verifier talks to the same SQL RPCs through a role-scoped
// test adapter. This does not require a public route or configure PostgREST.
function rpc(database) {
  return async (name, args) => {
    const id = (value) => literal(value) + '::uuid';
    let query;
    switch (name) {
      case 'project_s_get_actor_credential_v2':
        query = id(args.p_credential_id) + ',' + id(args.p_instance_id) + ',' + literal(args.p_epoch) + '::bigint';
        break;
      case 'project_s_register_actor_v2':
        query = [
          literal(JSON.stringify(args.p_context)) + '::jsonb', id(args.p_actor_id), id(args.p_credential_id),
          literal(args.p_verifier) + '::bytea', literal(args.p_label), literal(args.p_expires_at) + '::timestamptz',
        ].join(',');
        break;
      default:
        throw new Error('Unexpected verifier RPC');
    }
    try {
      const result = sql(database, 'set role service_role; select public.' + name + '(' + query + ');');
      return { data: result ? JSON.parse(result) : null, error: null };
    } catch (error) {
      return { data: null, error: { code: error.code } };
    }
  };
}

async function worker(authenticateActor) {
  stage = 'worker verification and booking';
  const { database, binding, credential, hour } = JSON.parse(readFileSync(0, 'utf8'));
  assert.equal(binding.audience, audience);
  let actor;
  try {
    actor = await authenticateActor({ authorization: 'Bearer ' + credential,
      requestId: randomUUID(), transport: 'http', binding, rpc: rpc(database) });
  } catch (error) {
    if (error.code !== 'AUTHENTICATION_REQUIRED' || error.status !== 401) throw error;
    console.log('refused');
    return;
  }
  assert.equal(actor.epoch, binding.epoch);
  if (hour !== undefined) {
    assert(hour === 10 || hour === 11);
    const saved = JSON.parse(sql(database, 'select recovery_rehearsal.book(' +
      [actor.epoch, literal(actor.actorId), literal(actor.credentialId), literal(actor.credentialFingerprint), hour]
        .join(',') + ');'));
    assert(saved.receiptId);
  }
  console.log(hour === undefined ? 'authenticated' : 'booked');
}

async function rehearse(registerActorCredential) {
  const runId = randomUUID().replaceAll('-', '').slice(0, 16);
  const target = 'project_s_restore_' + runId;
  const directory = '/tmp/' + target;
  const archive = directory + '/authority.dump';
  let ownsTarget = false;
  let ownsArchive = false;

  const launchWorker = (database, binding, registered, result, hour) => {
    const child = run(process.execPath, ['--experimental-strip-types', script, '--worker'],
      JSON.stringify({ database, binding, credential: registered.credential, hour }));
    const workerFailure = /^Synthetic restore rehearsal failed at [a-z ]+(?: \([0-9A-Z]{5}\))?\.$/m.exec(child.stderr ?? '');
    if (child.status !== 0 && workerFailure) console.error(workerFailure[0]);
    const output = checked(child);
    assert.equal(output, result);
  };

  const register = (database, binding) => registerActorCredential({
    context: JSON.parse(sql(database, 'select recovery_rehearsal.issuer(' + binding.epoch + ');')),
    label: 'Synthetic restore worker', expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    binding, rpc: rpc(database),
  });

  const history = (database) => sql(database, `
    select md5(jsonb_build_object(
      'bookings', (select jsonb_agg(to_jsonb(b) order by b.id) from public.bookings b
        join private.v2_booking_receipts r on r.booking_id = b.id where r.epoch = 1),
      'receipts', (select jsonb_agg(to_jsonb(r) order by r.receipt_id)
        from private.v2_booking_receipts r where r.epoch = 1))::text)
    where (select count(*) from private.v2_booking_receipts where epoch = 1) = 1;`);
  const epoch = (database) => sql(database, 'select epoch from private.v2_authority_instance;');
  const rehearsalBookings = (database) => sql(database,
    "select count(*) from public.bookings where user_id = recovery_rehearsal.id('host');");
  const advance = (database, expected, next) => sql(database,
    'select private.v2_rotate_synthetic_authority_epoch(recovery_rehearsal.id(\'instance\'), ' + expected + ', ' + next + ');');

  try {
    stage = 'seed a booking in the clean synthetic source';
    sql(source, readFileSync('supabase/tests/recovery/rehearsal-fixture.sql', 'utf8'));
    const instanceId = sql(source, "select recovery_rehearsal.id('instance');");
    const initialBinding = { instanceId, epoch: 1, audience };
    const initial = await register(source, initialBinding);
    launchWorker(source, initialBinding, initial, 'booked', 10);
    const before = history(source);
    assert.match(before, /^[a-f0-9]{32}$/);

    stage = 'create the logical backup';
    checked(docker(['mkdir', '-m', '700', directory]));
    ownsArchive = true;
    // Realtime is disabled in the disposable stack. Its managed publication
    // is outside the authority restore and needs a separate service rehearsal.
    checked(adminCommand('pg_dump', ['--format=custom', '--no-publications', '--file', archive, source]));

    stage = 'issue authority after the backup';
    const lastIssuedEpoch = 2; // Operator record outside the archive.
    advance(source, 1, lastIssuedEpoch);
    const laterBinding = { ...initialBinding, epoch: lastIssuedEpoch };
    const later = await register(source, laterBinding);
    launchWorker(source, laterBinding, later, 'authenticated');

    stage = 'restore into a separate empty database';
    checked(adminCommand('createdb', ['--template=template0', target]));
    ownsTarget = true;
    stage = 'replay the logical backup';
    const restored = adminCommand('pg_restore', [
      '--verbose', '--single-transaction', '--exit-on-error', '-d', target, archive,
    ]);
    if (restored.status !== 0) {
      const diagnostics = restored.stderr ?? '';
      const object = [...diagnostics.matchAll(/^pg_restore: (?:creating|processing data for) ([A-Z ]+ "[A-Za-z0-9_.-]+")\s*$/gm)].at(-1)?.[1];
      const reason = /(?:ERROR:\s+|pg_restore: error: )((?:schema|extension|relation|role|function|table) "[A-Za-z0-9_.-]+" (?:already exists|does not exist)|(?:permission denied|could not access file|cannot create extension|can only create extension|must be superuser|can only create extension in database)[^.:\r\n]*)/.exec(diagnostics)?.[1];
      console.error('PostgreSQL restore failed' + (object ? ' while restoring ' + object : '') + '.');
      if (reason && /^[ A-Za-z0-9_."-]+$/.test(reason)) console.error('PostgreSQL diagnostic: ' + reason);
    }
    checked(restored);
    assert.equal(epoch(target), '1');
    assert.equal(history(target), before);
    assert.equal(sql(target, 'select count(*) from private.v2_booking_epoch_keys where epoch > 1;'), '0');

    stage = 'verify the restored credential before rotation on the isolated target';
    launchWorker(target, initialBinding, initial, 'authenticated');

    stage = 'advance the restored instance using the external record';
    // Model reserving the replacement epoch externally before activating it.
    const replacementBinding = { ...initialBinding, epoch: lastIssuedEpoch + 1 };
    advance(target, 1, replacementBinding.epoch);
    assert.equal(epoch(target), '3');
    assert.equal(epoch(source), '2');

    stage = 'verify retired and replacement worker bindings';
    launchWorker(target, initialBinding, initial, 'refused');
    launchWorker(target, laterBinding, later, 'refused');
    launchWorker(target, replacementBinding, initial, 'refused');
    launchWorker(target, replacementBinding, later, 'refused');
    assert.equal(rehearsalBookings(target), '1');

    stage = 'explicitly reissue authority and verify a new booking';
    const replacement = await register(target, replacementBinding);
    launchWorker(target, replacementBinding, replacement, 'booked', 11);
    assert.equal(rehearsalBookings(target), '2');
    assert.equal(sql(target, 'select count(*) from private.v2_booking_receipts where epoch = 3;'), '1');
    assert.equal(history(target), before);
    assert.equal(history(source), before);
  } finally {
    const drop = ownsTarget && adminCommand('dropdb', [target]);
    const remove = ownsArchive && docker(['rm', '-f', archive]);
    const directoryCleanup = ownsArchive && docker(['rmdir', directory]);
    if ([drop, remove, directoryCleanup].some((result) => result && (result.error || result.status !== 0))) {
      console.error('Synthetic restore rehearsal could not remove its disposable database or archive.');
      process.exitCode = 1;
    }
  }
  console.log('Synthetic logical restore preserved history, refused retired worker credentials, and booked after explicit reissue.');
}

async function main() {
  assert.equal(process.env.PROJECT_S_DISPOSABLE_AUTHORITY_TEST, '1');
  stage = 'verify the owned local stack';
  const doctor = await collectDoctor();
  if (!doctor.ok) {
    const failed = doctor.checks.filter((check) => check.status === 'FAIL').map((check) => check.id);
    console.error('Disposable stack checks failed: ' + failed.join(', '));
  }
  assert(doctor.ok);
  stage = 'verify the bootstrap ownership marker';
  assert(doctor.state.markerMatches);
  assert.match(doctor.state.dbId, /^[a-f0-9]{64}$/);
  docker = (args, input) => run('docker', ['exec', '-i', doctor.state.dbId, ...args], input);
  const authority = await import('../supabase/functions/_shared/actorCredentials.ts');
  if (process.argv[2] === '--worker') await worker(authority.authenticateActor);
  else await rehearse(authority.registerActorCredential);
}

main().catch((error) => {
  const code = /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? ' (' + error.code + ')' : '';
  console.error('Synthetic restore rehearsal failed at ' + stage + code + '.');
  process.exitCode = 1;
});
