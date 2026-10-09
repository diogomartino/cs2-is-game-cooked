// scope.gg: current Premier rating + last-20-match form from the JSON endpoint its public profile
// page (app.scope.gg/en/profile/<accountId>) calls. Undocumented — may change without notice.
import type { CsStats, Stat } from "./cstracker";

const UA = "cs2-is-game-cooked (personal tool; 1 req/s, 24h cache)";
const LIMIT = 20;
export const accountId = (steamId64: string) => Number(BigInt(steamId64) - 76561197960265728n);
export const scopeUrl = (id: string) => `https://app.scope.gg/en/profile/${accountId(id)}`;

interface ScopeMatch {
  MatchTime: number; Gamemode: string;
  TeamInfos: { Won: boolean; IsUserTeam: boolean }[];
  UserStats?: { PremierRating?: number; Kills?: number; Deaths?: number; ADR?: number; Rating2?: number };
}

/** Pure: match list (any order) → stats, or null if empty. */
export function parseScope(matches: ScopeMatch[]): Partial<CsStats> | null {
  if (!Array.isArray(matches) || !matches.length) return null;
  const ms = [...matches].sort((a, b) => b.MatchTime - a.MatchTime);
  const res = ms.map((m) => {
    const mine = m.TeamInfos.find((t) => t.IsUserTeam), theirs = m.TeamInfos.find((t) => !t.IsUserTeam);
    return mine?.Won ? "W" : theirs?.Won ? "L" : "T";
  });
  const n = (c: string) => res.filter((r) => r === c).length;
  const sum = (k: "Kills" | "Deaths" | "ADR" | "Rating2") => ms.reduce((s, m) => s + (m.UserStats?.[k] ?? 0), 0);
  const stats: Stat[] = [];
  if (sum("Deaths")) stats.push({ label: "K/D", value: (sum("Kills") / sum("Deaths")).toFixed(2) });
  if (sum("ADR")) stats.push({ label: "ADR", value: (sum("ADR") / ms.length).toFixed(1) });
  if (sum("Rating2")) stats.push({ label: "Rating 2.0", value: (sum("Rating2") / ms.length).toFixed(2) });
  return {
    premier: ms.find((m) => m.UserStats?.PremierRating)?.UserStats!.PremierRating,
    winRate: `${((n("W") / ms.length) * 100).toFixed(0)}%`,
    wlt: `${n("W")}/${n("L")}/${n("T")} last ${ms.length}`,
    matches: null, // wlt already carries the count; don't let a lower-priority total sit next to it
    recent: res.slice(0, 9).join(""),
    stats,
  };
}

/** null = no matches on scope.gg. Throws on transient errors so they aren't cached. */
export async function fetchScope(id: string): Promise<Partial<CsStats> | null> {
  const res = await fetch("https://app.scope.gg/api/dashboard/public/getMatchList", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ steamAccountId: accountId(id), sources: ["shareCode"], limit: LIMIT }),
  });
  if (res.status === 400 || res.status === 404) return null; // invalid / unknown account
  if (!res.ok) throw new Error(`scope ${res.status}`);
  return parseScope((await res.json()) as ScopeMatch[]);
}
