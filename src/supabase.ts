import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
/** Supabase “anon” or newer publishable default key (either name works). */
const anonKey = (
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
)?.trim();

/** Null when env vars are missing (local dev without Supabase). */
export const supabase: SupabaseClient | null =
  url && anonKey && url.startsWith("http") && anonKey.length >= 12
    ? createClient(url, anonKey)
    : null;

export function isLeaderboardConfigured(): boolean {
  return supabase !== null;
}
