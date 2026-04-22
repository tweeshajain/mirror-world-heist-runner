import { createClient, type SupabaseClient } from "@supabase/supabase-js";
/** Baked into the JS bundle — works on GitHub Pages without fetching a separate JSON file. Keep in sync with `public/supabase-config.json`. */
import runtimeDefaults from "./supabase-runtime.json";

function credentialsFromEnv(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const anonKey = (
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
  )?.trim();
  if (url && anonKey && url.startsWith("http") && anonKey.length >= 12) {
    return { url, anonKey };
  }
  return null;
}

function credentialsFromRecord(r: { url?: string; anonKey?: string }): { url: string; anonKey: string } | null {
  const url = r.url?.trim();
  const anonKey = r.anonKey?.trim();
  if (url && anonKey && url.startsWith("http") && anonKey.length >= 12) {
    return { url, anonKey };
  }
  return null;
}

let cachedClient: SupabaseClient | null = null;
let inflight: Promise<SupabaseClient | null> | null = null;

/**
 * Resolves a Supabase client from:
 * 1. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`) when set at build time, else
 * 2. Defaults from `src/supabase-runtime.json` (bundled — reliable on static hosts).
 */
export async function resolveSupabaseClient(): Promise<SupabaseClient | null> {
  if (cachedClient) return cachedClient;

  inflight ??= (async (): Promise<SupabaseClient | null> => {
    try {
      const envC = credentialsFromEnv();
      if (envC) {
        cachedClient = createClient(envC.url, envC.anonKey);
        return cachedClient;
      }

      const bundled = credentialsFromRecord(runtimeDefaults as { url?: string; anonKey?: string });
      if (bundled) {
        cachedClient = createClient(bundled.url, bundled.anonKey);
        return cachedClient;
      }

      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
