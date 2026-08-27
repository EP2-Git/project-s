import { z } from 'zod';
import { resolveDeploymentAudience } from '@/config/deploymentAudience';

const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a valid URL'),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'VITE_SUPABASE_PUBLISHABLE_KEY is required'),
  VITE_PROJECT_S_API_URL: z
    .string()
    .url('VITE_PROJECT_S_API_URL must be a valid URL')
    .optional(),
  VITE_PROJECT_S_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  VITE_PROJECT_S_DEPLOYMENT_AUDIENCE: z.string().optional(),
});

const result = publicEnvSchema.safeParse({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_PROJECT_S_API_URL: import.meta.env.VITE_PROJECT_S_API_URL || undefined,
  VITE_PROJECT_S_TURNSTILE_SITE_KEY:
    import.meta.env.VITE_PROJECT_S_TURNSTILE_SITE_KEY || undefined,
  VITE_PROJECT_S_DEPLOYMENT_AUDIENCE:
    import.meta.env.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE || undefined,
});

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid public environment configuration: ${details}`);
}

export const env = Object.freeze({
  supabaseUrl: result.data.VITE_SUPABASE_URL,
  supabasePublishableKey: result.data.VITE_SUPABASE_PUBLISHABLE_KEY,
  projectSApiUrl:
    result.data.VITE_PROJECT_S_API_URL ??
    (typeof window === 'undefined'
      ? 'http://127.0.0.1:8080'
      : window.location.origin),
  turnstileSiteKey: result.data.VITE_PROJECT_S_TURNSTILE_SITE_KEY,
  deploymentAudience: resolveDeploymentAudience(
    result.data.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE,
  ),
});
