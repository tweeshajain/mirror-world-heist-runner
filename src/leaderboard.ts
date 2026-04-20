import { supabase } from "./supabase";

export type TopScoreRow = { player_name: string; score: number };

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
  if (!supabase) {
    return { ok: false, message: "Leaderboard not configured (add Supabase env vars)." };
  }

  const name = playerName.trim().slice(0, 24) || "Runner";

  const { error: insertError } = await supabase.from("game_scores").insert({
    player_name: name,
    score,
  });
  if (insertError) {
    return { ok: false, message: insertError.message };
  }

  const { count, error: countError } = await supabase
    .from("game_scores")
    .select("*", { count: "exact", head: true })
    .gt("score", score);

  if (countError) {
    return { ok: false, message: countError.message };
  }

  const rank = (count ?? 0) + 1;

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
