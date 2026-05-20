import { createClient, type SupabaseClient } from "@supabase/supabase-js";
/** Baked into the JS bundle — works on GitHub Pages without fetching a separate JSON file. Keep in sync with `public/supabase-config.json`. */
import runtimeDefaults from "./supabase-runtime.json";

function credentialsFromRecord(r: { url?: string; anonKey?: string }): { url: string; anonKey: string } | null {
  const url = r.url?.trim();
  const anonKey = r.anonKey?.trim();
  if (!url || !anonKey) return null;
  if (!url.startsWith("http") || anonKey.length < 12) return null;
  if (url.includes("YOUR_PROJECT") || /your_|placeholder/i.test(anonKey)) return null;
  return { url, anonKey };
}

function credentialsFromEnv(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const anonKey = (
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
  )?.trim();
  return credentialsFromRecord({ url, anonKey });
}

async function credentialsFromPublicConfig(): Promise<{ url: string; anonKey: string } | null> {
  if (typeof window === "undefined") return null;
  try {
    const configUrl = new URL("supabase-config.json", window.location.href).href;
    const res = await fetch(configUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { url?: string; anonKey?: string };
    return credentialsFromRecord(json);
  } catch {
    return null;
  }
}

let cachedClient: SupabaseClient | null = null;
let inflight: Promise<SupabaseClient | null> | null = null;

/**
 * Resolves a Supabase client from:
 * 1. `VITE_SUPABASE_URL` + key env vars at build time
 * 2. Bundled `src/supabase-runtime.json`
 * 3. Runtime fetch of `public/supabase-config.json` (GitHub Pages / static hosts)
 */
export async function resolveSupabaseClient(): Promise<SupabaseClient | null> {
  if (cachedClient) return cachedClient;

  inflight ??= (async (): Promise<SupabaseClient | null> => {
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

    const fetched = await credentialsFromPublicConfig();
    if (fetched) {
      cachedClient = createClient(fetched.url, fetched.anonKey);
      return cachedClient;
    }

    return null;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
