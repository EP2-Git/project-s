import { expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/integrations/supabase/types';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export interface OwnerSnapshot {
  ownerId: string;
  profiles: Pick<Row<'profiles'>, 'id' | 'username' | 'full_name' | 'timezone' | 'updated_at'>[];
  meetingTypes: Pick<Row<'meeting_types'>, 'id' | 'user_id' | 'title' | 'description' | 'duration_minutes' | 'active' | 'buffer_before_minutes' | 'buffer_after_minutes' | 'slot_interval_minutes' | 'minimum_notice_minutes' | 'maximum_advance_days' | 'updated_at'>[];
  weekly: Pick<Row<'availabilities'>, 'id' | 'user_id' | 'weekday' | 'start_time' | 'end_time' | 'buffer_minutes' | 'updated_at'>[];
  specificDates: Pick<Row<'specific_date_availabilities'>, 'id' | 'user_id' | 'date' | 'status' | 'note' | 'start_time' | 'end_time' | 'buffer_minutes' | 'updated_at'>[];
  bookings: Pick<Row<'bookings'>, 'id' | 'user_id' | 'meeting_type_id' | 'status' | 'version' | 'notes' | 'canceled_at' | 'canceled_by' | 'updated_at'>[];
}

export interface IsolationProbe {
  label: string;
  status: number;
  code: string | null;
  rowCount: number | null;
}

export interface IsolationReport {
  principalId: string;
  probes: IsolationProbe[];
  cancellationErrorsMatch: boolean;
  cancellationEnvelopeMinimal: boolean;
}

type BrowserCommand =
  | { kind: 'endpoint' }
  | { kind: 'seed-date'; marker: string }
  | { kind: 'snapshot' }
  | { kind: 'probe'; target: OwnerSnapshot };

// Only the page owns authentication. No token, request header or client instance
// crosses this serialization boundary or enters the returned evidence.
async function executeInLocalBrowser(page: Page, command: BrowserCommand): Promise<unknown> {
  return page.evaluate(async (task) => {
    const app = new URL(window.location.href);
    if (
      app.protocol !== 'http:'
      || !['localhost', '127.0.0.1', '[::1]'].includes(app.hostname)
      || app.port !== '4173' || app.username || app.password
    ) throw new Error('Account isolation proof requires the loopback test app on port 4173.');
    const clientModulePath = '/src/lib/supabaseClient.ts';
    const { supabase } = await import(clientModulePath) as { supabase: SupabaseClient<Database> };
    const rawEndpoint: unknown = Reflect.get(supabase, 'supabaseUrl');
    if (typeof rawEndpoint !== 'string') throw new Error('Local isolation API endpoint is unavailable.');
    const endpoint = new URL(rawEndpoint);
    if (
      endpoint.protocol !== 'http:'
      || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
      || endpoint.port !== '54321'
      || endpoint.username || endpoint.password
      || endpoint.pathname !== '/' || endpoint.search || endpoint.hash
    ) throw new Error('Account isolation proof requires the loopback disposable API on port 54321.');
    if (task.kind === 'endpoint') {
      return { protocol: endpoint.protocol, hostname: endpoint.hostname, port: endpoint.port };
    }

    const identity = await supabase.auth.getUser();
    if (identity.error || !identity.data.user?.id) {
      throw new Error('Account isolation proof requires a genuine signed-in fixture principal.');
    }
    const principalId = identity.data.user.id;

    if (task.kind === 'seed-date') {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 30);
      const result = await supabase.from('specific_date_availabilities').insert({
        id: crypto.randomUUID(), user_id: principalId,
        date: date.toISOString().slice(0, 10), status: 'default', note: task.marker,
      }).select('id,user_id,date,status,note').single();
      if (result.error || !result.data) throw new Error('Could not seed the signed-in fixture date.');
      return result.data;
    }

    if (task.kind === 'snapshot') {
      const [profiles, meetingTypes, weekly, specificDates, bookings] = await Promise.all([
        supabase.from('profiles').select('id,username,full_name,timezone,updated_at').eq('id', principalId).order('id'),
        supabase.from('meeting_types').select('id,user_id,title,description,duration_minutes,active,buffer_before_minutes,buffer_after_minutes,slot_interval_minutes,minimum_notice_minutes,maximum_advance_days,updated_at').eq('user_id', principalId).order('id'),
        supabase.from('availabilities').select('id,user_id,weekday,start_time,end_time,buffer_minutes,updated_at').eq('user_id', principalId).order('id'),
        supabase.from('specific_date_availabilities').select('id,user_id,date,status,note,start_time,end_time,buffer_minutes,updated_at').eq('user_id', principalId).order('id'),
        supabase.from('bookings').select('id,user_id,meeting_type_id,status,version,notes,canceled_at,canceled_by,updated_at').eq('user_id', principalId).order('id'),
      ]);
      if ([profiles, meetingTypes, weekly, specificDates, bookings].some((result) => result.error || !result.data)) {
        throw new Error('Could not read the signed-in fixture snapshot.');
      }
      return {
        ownerId: principalId, profiles: profiles.data, meetingTypes: meetingTypes.data,
        weekly: weekly.data, specificDates: specificDates.data, bookings: bookings.data,
      };
    }

    if (principalId === task.target.ownerId) throw new Error('The foreign-principal proof cannot use the owner session.');
    const target = task.target;
    const probes: IsolationProbe[] = [];
    const record = (label: string, result: {
      status: number;
      data: unknown;
      error: { code?: string; message?: string } | null;
    }) => {
      probes.push({
        label, status: result.status, code: result.error?.code ?? null,
        rowCount: Array.isArray(result.data) ? result.data.length : null,
      });
    };

    record('profiles.read', await supabase.from('profiles').select('id').eq('id', target.ownerId));
    record('meeting_types.read', await supabase.from('meeting_types').select('id').eq('user_id', target.ownerId));
    record('availabilities.read', await supabase.from('availabilities').select('id').eq('user_id', target.ownerId));
    record('specific_dates.read', await supabase.from('specific_date_availabilities').select('id').eq('user_id', target.ownerId));
    record('bookings.read', await supabase.from('bookings').select('id').eq('user_id', target.ownerId));

    record('profiles.update', await supabase.from('profiles').update({ full_name: 'Synthetic foreign profile change' }).eq('id', target.ownerId).select('id'));
    record('profiles.delete', await supabase.from('profiles').delete().eq('id', target.ownerId).select('id'));
    record('profiles.insert', await supabase.from('profiles').insert({
      id: target.ownerId, username: `probe-${crypto.randomUUID().slice(0, 18)}`, full_name: 'Synthetic forged profile',
    }).select('id'));

    record('meeting_types.update', await supabase.from('meeting_types').update({ title: 'Synthetic foreign type change' }).eq('id', target.meetingTypes[0].id).select('id'));
    record('meeting_types.delete', await supabase.from('meeting_types').delete().eq('id', target.meetingTypes[0].id).select('id'));
    record('meeting_types.insert', await supabase.from('meeting_types').insert({
      id: crypto.randomUUID(), user_id: target.ownerId, title: 'Synthetic forged type', duration_minutes: 25,
    }).select('id'));

    record('availabilities.update', await supabase.from('availabilities').update({ buffer_minutes: 1 }).eq('id', target.weekly[0].id).select('id'));
    record('availabilities.delete', await supabase.from('availabilities').delete().eq('id', target.weekly[0].id).select('id'));
    record('availabilities.insert', await supabase.from('availabilities').insert({
      id: crypto.randomUUID(), user_id: target.ownerId, weekday: 6,
      start_time: '18:00', end_time: '19:00', buffer_minutes: 0,
    }).select('id'));

    record('specific_dates.update', await supabase.from('specific_date_availabilities').update({ note: 'Synthetic foreign date change' }).eq('id', target.specificDates[0].id).select('id'));
    record('specific_dates.delete', await supabase.from('specific_date_availabilities').delete().eq('id', target.specificDates[0].id).select('id'));
    const forgedDate = new Date(`${target.specificDates[0].date}T00:00:00Z`);
    forgedDate.setUTCDate(forgedDate.getUTCDate() + 1);
    record('specific_dates.insert', await supabase.from('specific_date_availabilities').insert({
      id: crypto.randomUUID(), user_id: target.ownerId, date: forgedDate.toISOString().slice(0, 10),
      status: 'default', note: 'Synthetic forged date',
    }).select('id'));

    record('bookings.update', await supabase.from('bookings').update({ notes: 'Synthetic foreign booking change' }).eq('id', target.bookings[0].id).select('id'));
    record('bookings.delete', await supabase.from('bookings').delete().eq('id', target.bookings[0].id).select('id'));
    const foreignCancellation = await supabase.rpc('cancel_booking_v1', {
      p_booking_id: target.bookings[0].id, p_expected_version: target.bookings[0].version,
    });
    record('bookings.cancel_foreign', foreignCancellation);
    const unknownCancellation = await supabase.rpc('cancel_booking_v1', {
      p_booking_id: crypto.randomUUID(), p_expected_version: target.bookings[0].version,
    });
    record('bookings.cancel_unknown', unknownCancellation);
    // Full error comparison stays in the authenticated browser. Only verdicts
    // cross to the runner, never provider messages/details/hints or headers.
    const cancellationErrorsMatch = foreignCancellation.status === unknownCancellation.status
      && JSON.stringify(foreignCancellation.error) === JSON.stringify(unknownCancellation.error);
    const cancellationEnvelopeMinimal = [foreignCancellation, unknownCancellation].every((result) => (
      result.status === 404 && result.error?.code === 'PT404'
      && result.error.message === 'NOT_FOUND'
      && result.error.details === null && result.error.hint === null
    ));
    return { principalId, probes, cancellationErrorsMatch, cancellationEnvelopeMinimal };
  }, command);
}

export async function assertLocalIsolationStack(page: Page) {
  return executeInLocalBrowser(page, { kind: 'endpoint' }) as Promise<{
    protocol: string; hostname: string; port: string;
  }>;
}

export async function seedPrivateDate(page: Page, marker: string) {
  const row = await executeInLocalBrowser(page, { kind: 'seed-date', marker }) as {
    id: string; user_id: string; date: string; status: string; note: string;
  };
  expect(row.id).toBeTruthy();
  expect(row.status).toBe('default');
  expect(row.note).toBe(marker);
  return row;
}

export async function readOwnerSnapshot(page: Page): Promise<OwnerSnapshot> {
  const snapshot = await executeInLocalBrowser(page, { kind: 'snapshot' }) as OwnerSnapshot;
  expect(snapshot.ownerId).toBeTruthy();
  expect(snapshot.profiles).toHaveLength(1);
  expect(snapshot.profiles[0].id).toBe(snapshot.ownerId);
  for (const rows of [snapshot.meetingTypes, snapshot.weekly, snapshot.specificDates]) {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.user_id === snapshot.ownerId)).toBe(true);
  }
  expect(snapshot.bookings.every((row) => row.user_id === snapshot.ownerId)).toBe(true);
  return snapshot;
}

export async function assertOtherPrincipalDenied(page: Page, owner: OwnerSnapshot): Promise<IsolationReport> {
  // These controls prevent absent targets/constraint conflicts from masquerading
  // as authorization denials. The journey creates this known synthetic fixture.
  expect(owner.bookings).toHaveLength(1);
  expect(owner.bookings[0].status).toBe('confirmed');
  expect(owner.weekly.some((row) => row.weekday === 6)).toBe(false);
  const report = await executeInLocalBrowser(page, { kind: 'probe', target: owner }) as IsolationReport;
  expect(report.principalId).not.toBe(owner.ownerId);
  expect(report.cancellationErrorsMatch).toBe(true);
  expect(report.cancellationEnvelopeMinimal).toBe(true);

  const filtered = [
    'profiles.read', 'meeting_types.read', 'availabilities.read', 'specific_dates.read', 'bookings.read',
    'profiles.update', 'meeting_types.update', 'meeting_types.delete',
    'availabilities.update', 'availabilities.delete', 'specific_dates.update', 'specific_dates.delete',
  ];
  const forbidden = ['profiles.delete', 'profiles.insert', 'meeting_types.insert', 'availabilities.insert', 'specific_dates.insert', 'bookings.update', 'bookings.delete'];
  const cancelled = ['bookings.cancel_foreign', 'bookings.cancel_unknown'];
  expect(report.probes.map(({ label }) => label).sort()).toEqual([...filtered, ...forbidden, ...cancelled].sort());
  for (const probe of report.probes) {
    if (filtered.includes(probe.label)) {
      expect(probe.code, probe.label).toBeNull();
      expect(probe.status, probe.label).toBeGreaterThanOrEqual(200);
      expect(probe.status, probe.label).toBeLessThan(300);
      expect(probe.rowCount, probe.label).toBe(0);
    } else if (forbidden.includes(probe.label)) {
      expect(probe.status, probe.label).toBe(403);
      expect(probe.code, probe.label).toBe('42501');
      expect(probe.rowCount, probe.label).toBeNull();
    } else {
      expect(probe.status, probe.label).toBe(404);
      expect(probe.code, probe.label).toBe('PT404');
      expect(probe.rowCount, probe.label).toBeNull();
    }
  }
  return report;
}
