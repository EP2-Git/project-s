import { supabase } from '@/integrations/supabase/client';
import type { WeeklySchedule } from '@/lib/availability';

export type WeeklyScheduleInvoker = (
  schedule: WeeklySchedule,
) => PromiseLike<{ error: unknown | null }>;

const invokeWeeklySchedule: WeeklyScheduleInvoker = async (schedule) => {
  const { error } = await supabase.rpc('set_weekly_schedule_v1', {
    p_schedule: schedule,
  });
  return { error };
};

export const saveWeeklySchedule = async (
  schedule: WeeklySchedule,
  refetch: () => Promise<void>,
  invoke: WeeklyScheduleInvoker = invokeWeeklySchedule,
) => {
  const { error } = await invoke(schedule);
  if (error) {
    await refetch();
    throw new Error('Unable to save the weekly schedule.');
  }
};
