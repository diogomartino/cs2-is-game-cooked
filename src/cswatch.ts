// cswat.ch player page: FACEIT data (level, ELO, matches, win rate, K/D, HS, last 10) from the
// Next.js RSC payload embedded in the server-rendered HTML. Its Leetify block is unreliable
// (reports is_leetify_user:false for players the Leetify API has), so only FACEIT is used.
import type { CsStats, Stat } from "./cstracker";

export const cswatchUrl = (id: string) => `https://cswat.ch/stats/${id}`;

/** Concatenate the `self.__next_f.push([1,"..."])` string chunks. */
function rscPayload(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try { const a = JSON.parse(m[1]!); if (typeof a[1] === "string") out += a[1]; } catch {}
  }
  return out;
}

/** JSON object that starts right after `"key":` — brace-balanced, string-aware. */
function objectAfter(src: string, key: string): any {
  const k = src.indexOf(`"${key}":{`);
  if (k < 0) return undefined;
  const start = k + key.length + 3;
  let depth = 0, inStr = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(src.slice(start, i + 1)); } catch { return undefined; }
    }
  }
}

/** Pure HTML → FACEIT fields, or null when cswat.ch has no FACEIT data for the player. */
export function parseCsWatch(html: string): Partial<CsStats> | null {
  const f = objectAfter(rscPayload(html), "faceitData");
  const game = f?.resolvedGame as string | undefined;
  const g = game ? f.game?.[game] : undefined;
  if (!f?.success || !g) return null;
  const recent = f.recentStats?.[game!];
  const stats: Stat[] = [];
  if (g.average_kd_ratio) stats.push({ label: "FACEIT K/D", value: String(g.average_kd_ratio) });
  if (g.average_headshots) stats.push({ label: "FACEIT HS", value: `${g.average_headshots}%` });
  if (g.win_rate) stats.push({ label: "FACEIT WR", value: `${g.win_rate}%` });
  return {
    faceitLevel: g.level || undefined,
    faceitElo: g.elo || undefined,
    faceitGame: game,
    winRate: g.win_rate ? `${g.win_rate}%` : undefined,
    wlt: `FACEIT ${game === "csgo" ? "CS:GO" : "CS2"}`, // win rate/matches below are FACEIT, not MM
    matches: Number(g.matches) || undefined,
    // matchHistory is oldest-last: reversed, 1 = win, 2 = loss (matches the W/L shown on the page).
    recent: (recent?.matchHistory as number[] | undefined)?.slice().reverse().map((r) => (r === 1 ? "W" : r === 2 ? "L" : "T")).join("") || undefined,
    stats,
  };
}

/** Throws on transient errors so they aren't cached. Unknown players come back 200 with no FACEIT data → null. */
export async function fetchCsWatch(id: string): Promise<Partial<CsStats> | null> {
  const res = await fetch(cswatchUrl(id), { headers: { "user-agent": "cs2-live-roster (personal tool; 1 req/s, 24h cache)" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cswatch ${res.status}`);
  return parseCsWatch(await res.text());
}
