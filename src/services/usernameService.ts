import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

export const isUsernameAvailable = async (username: string): Promise<boolean> => {
  const { data, error } = await supabase.rpc('is_username_available_v1', {
    p_username: username,
  });
  if (error) throw error;
  return z.boolean().parse(data);
};
