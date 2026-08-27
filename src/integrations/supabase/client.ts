import { createClient } from '@supabase/supabase-js';
import { env } from '@/config/env';
import type { Database } from './types';

export const supabase = createClient<Database>(
  env.supabaseUrl,
  env.supabasePublishableKey,
);
