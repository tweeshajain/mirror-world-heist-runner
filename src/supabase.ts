import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when env vars are missing (local dev without Supabase). */
export const supabase: SupabaseClient | null =
  url && anonKey && url.length > 8 && anonKey.length > 20 ? createClient(url, anonKey) : null;

export function isLeaderboardConfigured(): boolean {
  return supabase !== null;
}
