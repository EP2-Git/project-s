/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_PROJECT_S_API_URL?: string;
  readonly VITE_PROJECT_S_TURNSTILE_SITE_KEY?: string;
  readonly VITE_PROJECT_S_DEPLOYMENT_AUDIENCE?: 'hosted' | 'self-hosted';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
