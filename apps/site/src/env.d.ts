/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_APP_URL?: string;
  readonly PUBLIC_SIGNUP_URL?: string;
  readonly PUBLIC_API_URL?: string;
  readonly PUBLIC_PLAUSIBLE_DOMAIN?: string;
  readonly SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
