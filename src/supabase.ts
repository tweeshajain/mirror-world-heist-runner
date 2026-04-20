import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

type RuntimeJson = { url?: string; anonKey?: string };

function normalizePublicBase(): string {
  const raw = import.meta.env.BASE || "/";
  if (raw === "/" || raw === "") return "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

let cachedClient: SupabaseClient | null = null;
let inflight: Promise<SupabaseClient | null> | null = null;

/**
 * Resolves a Supabase client from, in order:
 * 1. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`) at build time, or
 * 2. `public/supabase-config.json` at runtime (copied next to `index.html` in `dist/`) — use for `vite preview`
 *    or static hosting when env vars were not available during `vite build`.
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

      try {
        const base = normalizePublicBase();
        const candidateUrls = [
          new URL("supabase-config.json", location.href).href,
          `${location.origin}${base}supabase-config.json`,
        ];
        const tried = new Set<string>();
        let res: Response | null = null;
        for (const u of candidateUrls) {
          if (tried.has(u)) continue;
          tried.add(u);
          const r = await fetch(u, { cache: "no-store" });
          if (r.ok) {
            res = r;
            break;
          }
        }
        if (!res?.ok) {
          if (import.meta.env.DEV) {
            console.info(
              "[leaderboard] No valid VITE_SUPABASE_* env; supabase-config.json not found (tried",
              [...tried].join(", "),
              ").",
            );
          }
          return null;
        }
        const j = (await res.json()) as RuntimeJson;
        const url = j.url?.trim();
        const anonKey = j.anonKey?.trim();
        if (url && anonKey && url.startsWith("http") && anonKey.length >= 12) {
          cachedClient = createClient(url, anonKey);
          return cachedClient;
        }
        if (import.meta.env.DEV) {
          console.info("[leaderboard] public/supabase-config.json needs non-empty url and anonKey.");
        }
      } catch {
        if (import.meta.env.DEV) {
          console.info("[leaderboard] Could not fetch public/supabase-config.json.");
        }
      }
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
