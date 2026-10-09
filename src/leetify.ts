// Leetify public API fallback for players not on cstracker.gg (no trust rating / percentiles there).
// Docs: https://api-public-docs.cs-prod.leetify.com/  — key optional (higher rate limits with it).
import type { CsStats, Stat } from "./cstracker";

const KEY = process.env.LEETIFY_API_KEY;
export const leetifyUrl = (id: string) => `https://leetify.com/app/profile/${id}`;

const pct = (v: unknown) => (typeof v === "number" ? `${v.toFixed(1)}%` : undefined);
const fix = (v: unknown, d = 1, unit = "") => (typeof v === "number" ? `${v.toFixed(d)}${unit}` : undefined);

/** Pure: /v3/profile JSON → stats. Missing fields (private profiles) are simply omitted. */
export function parseLeetify(p: any): CsStats {
  const recent: any[] = p.recent_matches ?? [];
  const count = (o: string) => recent.filter((m) => m.outcome === o).length;
  const stats: Stat[] = [
    ["Aim", fix(p.rating?.aim, 0)], ["Positioning", fix(p.rating?.positioning, 0)], ["Utility", fix(p.rating?.utility, 0)],
    ["Reaction", fix(p.stats?.reaction_time_ms, 0, "ms")], ["Preaim", fix(p.stats?.preaim, 1, "°")],
    ["HS acc", pct(p.stats?.accuracy_head)], ["Spray acc", pct(p.stats?.spray_accuracy)],
    ["Counter-strafe", pct(p.stats?.counter_strafing_good_shots_ratio)],
  ].filter((s): s is [string, string] => !!s[1]).map(([label, value]) => ({ label, value }));
  return {
    sources: ["leetify"],
    premier: p.ranks?.premier || undefined,
    faceitLevel: p.ranks?.faceit || undefined,
    faceitElo: p.ranks?.faceit_elo || undefined,
    winRate: pct(typeof p.winrate === "number" ? p.winrate * 100 : undefined),
    wlt: recent.length ? `${count("win")}/${count("loss")}/${count("tie")} last ${recent.length}` : undefined,
    matches: p.total_matches,
    recent: recent.slice(0, 9).map((m) => (m.outcome === "win" ? "W" : m.outcome === "loss" ? "L" : "T")).join("") || undefined,
    stats,
  };
}

/** null = player not on Leetify. Throws on transient errors so they aren't cached. */
export async function fetchLeetify(id: string): Promise<CsStats | null> {
  const res = await fetch(`https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${id}`, {
    headers: KEY ? { Authorization: `Bearer ${KEY}` } : {},
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`leetify ${res.status}`);
  return parseLeetify(await res.json());
}
