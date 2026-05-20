import { resolveSupabaseClient } from "./supabase";

export type TopScoreRow = { player_name: string; score: number };

function friendlySupabaseError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("jwt") || m.includes("apikey") || m.includes("invalid key")) {
    return "Leaderboard key rejected — check Supabase URL and anon/publishable key in config.";
  }
  if (m.includes("relation") && m.includes("does not exist")) {
    return "Leaderboard table missing — run supabase/game_scores.sql in your Supabase project.";
  }
  if (m.includes("row-level security") || m.includes("policy")) {
    return "Leaderboard blocked by database policy — enable insert/select for anon on game_scores.";
  }
  if (m.includes("fetch") || m.includes("network") || m.includes("failed to fetch")) {
    return "Could not reach the leaderboard server — check your connection or Supabase project status.";
  }
  return message;
}

/**
 * Inserts this run, then computes rank = 1 + count(rows with score > this score),
 * and loads the global top 5 by score (ties broken by earlier `created_at`).
 */
export async function saveRunAndGetLeaderboardSummary(
  playerName: string,
  score: number,
): Promise<
  | { ok: true; rank: number; top5: TopScoreRow[] }
  | { ok: false; message: string; top5?: TopScoreRow[] }
> {
  const supabase = await resolveSupabaseClient();
  if (!supabase) {
    return { ok: false, message: "Leaderboard is not connected." };
  }

  const name = playerName.trim().slice(0, 24) || "Runner";
  const safeScore = Math.max(0, Math.floor(score));

  const { error: insertError } = await supabase.from("game_scores").insert({
    player_name: name,
    score: safeScore,
  });
  if (insertError) {
    return { ok: false, message: friendlySupabaseError(insertError.message) };
  }

  const { count, error: countError } = await supabase
    .from("game_scores")
    .select("id", { count: "exact", head: true })
    .gt("score", safeScore);

  let rank = (count ?? 0) + 1;
  if (countError) {
    const { data: topRows, error: topError } = await supabase
      .from("game_scores")
      .select("player_name, score")
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(50);
    if (topError) {
      return { ok: false, message: friendlySupabaseError(countError.message) };
    }
    const rows = (topRows ?? []) as TopScoreRow[];
    const higher = rows.filter((r) => r.score > safeScore).length;
    rank = higher + 1;
    return { ok: true, rank, top5: rows.slice(0, 5) };
  }

  const { data: topRows, error: topError } = await supabase
    .from("game_scores")
    .select("player_name, score")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(5);

  if (topError) {
    return { ok: true, rank, top5: [] };
  }

  return {
    ok: true,
    rank,
    top5: (topRows ?? []) as TopScoreRow[],
  };
}
