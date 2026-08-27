import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DEFAULT_ROUNDS = 50;
const CLIENTS = 2;
const HOST_USER_ID = "10000000-0000-4000-8000-000000000001";
const MEETING_TYPE_ID = "20000000-0000-4000-8000-000000000001";
const FIXTURE_NOTE = "Project S concurrency harness";
const HARNESS_PATH = "supabase/tests/concurrency/booking_race.pgbench";

function configuredRounds() {
  const raw = process.env.PROJECT_S_CONCURRENCY_ROUNDS;
  if (raw === undefined) return DEFAULT_ROUNDS;

  if (!/^\d+$/.test(raw)) {
    throw new Error("PROJECT_S_CONCURRENCY_ROUNDS must be an integer from 1 to 50.");
  }

  const rounds = Number(raw);
  if (rounds < 1 || rounds > DEFAULT_ROUNDS) {
    throw new Error("PROJECT_S_CONCURRENCY_ROUNDS must be an integer from 1 to 50.");
  }
  return rounds;
}

function runDocker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Unable to run Docker: ${result.error.message}`);
  }
  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(detail || `Docker exited with status ${result.status}.`);
  }

  return result;
}

let rounds;
try {
  rounds = configuredRounds();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const config = readFileSync("supabase/config.toml", "utf8");
const projectId = config.match(/^\s*project_id\s*=\s*"([a-z0-9_-]+)"\s*$/m)?.[1];

if (!projectId) {
  console.error("Unable to read a safe project_id from supabase/config.toml.");
  process.exit(1);
}

const container = `supabase_db_${projectId}`;
const running = runDocker(
  ["inspect", "--format", "{{.State.Running}}", container],
  { allowFailure: true },
);

if (running.status !== 0 || running.stdout.trim() !== "true") {
  console.error(
    "The local Supabase database container is not running. Run npm run db:start and npm run db:reset first.",
  );
  process.exit(1);
}

function runPsql(sql) {
  return runDocker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { input: sql },
  ).stdout.trim();
}

const cleanupSql = String.raw`
begin;
delete from public.bookings
where meeting_type_id = '${MEETING_TYPE_ID}'
  and booker_name = 'Concurrency Fixture'
  and booker_email like 'race-%@example.invalid';
delete from public.specific_date_availabilities
where user_id = '${HOST_USER_ID}'
  and note = '${FIXTURE_NOTE}';
commit;
`;

const setupSql = String.raw`
${cleanupSql}
begin;
with candidate as (
  select candidate_date::date as slot_date
  from generate_series(
    (statement_timestamp() at time zone 'America/Halifax')::date + 7,
    (statement_timestamp() at time zone 'America/Halifax')::date + 56,
    interval '1 day'
  ) as dates(candidate_date)
  where not exists (
    select 1
    from public.specific_date_availabilities as specific
    where specific.user_id = '${HOST_USER_ID}'
      and specific.date = candidate_date::date
  )
  and not exists (
    select 1
    from public.bookings as booking
    where booking.user_id = '${HOST_USER_ID}'
      and (booking.start_time at time zone 'America/Halifax')::date = candidate_date::date
  )
  order by candidate_date
  limit ${rounds}
)
insert into public.specific_date_availabilities (
  user_id,
  date,
  status,
  start_time,
  end_time,
  buffer_minutes,
  note
)
select
  '${HOST_USER_ID}',
  slot_date,
  'available',
  time '10:00',
  time '12:00',
  0,
  '${FIXTURE_NOTE}'
from candidate;
commit;

select
  to_char(
    ((date + start_time) at time zone 'America/Halifax') at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS'
  ) || 'Z'
from public.specific_date_availabilities
where user_id = '${HOST_USER_ID}'
  and note = '${FIXTURE_NOTE}'
order by date;
`;

let fixtureCreated = false;

try {
  fixtureCreated = true;
  const setupOutput = runPsql(setupSql);
  const slotStarts = setupOutput
    .split(/\r?\n/)
    .filter((line) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(line));

  if (slotStarts.length !== rounds) {
    throw new Error(
      `Unable to allocate ${rounds} isolated future slots; allocated ${slotStarts.length}. Reset the local database and retry.`,
    );
  }

  const harness = readFileSync(HARNESS_PATH, "utf8");

  for (const [index, slotStart] of slotStarts.entries()) {
    const race = runDocker(
      [
        "exec",
        "-i",
        container,
        "pgbench",
        "-U",
        "postgres",
        "-n",
        "-c",
        String(CLIENTS),
        "-j",
        String(CLIENTS),
        "-t",
        "1",
        "--verbose-errors",
        "--failures-detailed",
        "-r",
        "-D",
        `slot_start='${slotStart}'`,
        "-f",
        "-",
        "postgres",
      ],
      { input: harness, allowFailure: true },
    );

    const raceOutput = `${race.stdout}\n${race.stderr}`;
    const errorLines = raceOutput
      .split(/\r?\n/)
      .filter((line) => line.includes("ERROR:"));
    const expectedErrors = errorLines.filter((line) =>
      /ERROR:\s+SLOT_UNAVAILABLE\b/.test(line),
    );
    const processedMatch = raceOutput.match(
      /number of transactions actually processed:\s+(\d+)\/(\d+)/,
    );
    const exactlyOneProcessed =
      processedMatch?.[1] === "1" && processedMatch?.[2] === String(CLIENTS);

    const counts = runPsql(String.raw`
select
  count(*) filter (where status = 'confirmed')::text
  || '|'
  || count(*)::text
from public.bookings
where meeting_type_id = '${MEETING_TYPE_ID}'
  and start_time = '${slotStart}'::timestamptz;
`);
    const [confirmedCount, totalCount] = counts.split("|").map(Number);

    if (
      race.status === 0 ||
      errorLines.length !== 1 ||
      expectedErrors.length !== 1 ||
      !exactlyOneProcessed ||
      confirmedCount !== 1 ||
      totalCount !== 1
    ) {
      throw new Error(
        [
          `Booking concurrency round ${index + 1}/${rounds} failed.`,
          `pgbench exit: ${race.status}`,
          `processed: ${processedMatch ? `${processedMatch[1]}/${processedMatch[2]}` : "unknown"}`,
          `SLOT_UNAVAILABLE errors: ${expectedErrors.length}/1`,
          `unexpected SQL errors: ${errorLines.length - expectedErrors.length}`,
          `stored confirmed/total: ${confirmedCount}/${totalCount}`,
        ].join(" "),
      );
    }
  }

  const aggregateCounts = runPsql(String.raw`
select
  count(*) filter (where status = 'confirmed')::text
  || '|'
  || count(*)::text
from public.bookings
where meeting_type_id = '${MEETING_TYPE_ID}'
  and booker_name = 'Concurrency Fixture'
  and booker_email like 'race-%@example.invalid';
`);
  const [confirmedTotal, bookingTotal] = aggregateCounts.split("|").map(Number);

  if (confirmedTotal !== rounds || bookingTotal !== rounds) {
    throw new Error(
      `Concurrency aggregate failed: expected ${rounds} confirmed fixture rows, found ${confirmedTotal}/${bookingTotal} confirmed/total.`,
    );
  }

  console.log(
    `Booking concurrency check passed: ${rounds}/${rounds} isolated two-client races each produced 1 success, 1 SLOT_UNAVAILABLE conflict, and exactly 1 confirmed row.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (fixtureCreated) {
    try {
      runPsql(cleanupSql);
    } catch (error) {
      console.error(
        `Concurrency fixture cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}
