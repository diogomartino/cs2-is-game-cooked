// Pure roster logic: which coplay entries belong to the current match, plus confirmed friends.
import { CS2_APPID, type CoplayEntry, type FriendInGame } from "../steam";
import type { Match } from "../gsi/match";

export const SLOTS = 9;
const COPLAY_SLACK_S = 60;

/** coplay = Steam's recent-players list; friend/teammate = confirmed in-match (friends never appear in coplay). */
export type Source = "coplay" | "friend" | "teammate";
export interface Player { id: string; name: string; source: Source; seenAt: number }

/** Individual-account SteamID64s have account type 1 in bits 52–55 (filters "anonymous" ids). */
export const isIndividual = (id: string) => ((BigInt(id) >> 52n) & 0xfn) === 1n;

export function coplayForMatch(entries: CoplayEntry[], me: string | undefined, startedAt: number): CoplayEntry[] {
  return entries
    .filter((e) => e.appId === CS2_APPID && e.time >= startedAt - COPLAY_SLACK_S && e.id !== me && isIndividual(e.id))
    .sort((a, b) => a.time - b.time);
}

/**
 * Rich presence (if Steam exposes it to AppID 480 at all) must name our map AND show our exact
 * score. Skipped at 0:0, where any warm-up on the same map would match.
 */
function richPresenceMatches(f: FriendInGame, m: Pick<Match, "map" | "score">): boolean {
  const [ct, t] = m.score;
  if (ct + t === 0) return false;
  const values = Object.values(f.richPresence).join(" ").toLowerCase();
  if (!values.includes(m.map.toLowerCase().replace(/^de_/, ""))) return false;
  return [...values.matchAll(/(\d+)\s*[:\-]\s*(\d+)/g)].some(([, a, b]) => (+a! === ct && +b! === t) || (+a! === t && +b! === ct));
}

/**
 * Only players provably in this match: coplay entries, plus players GSI reported while you spectated
 * them (labelled "friend" when they're on your friends list), plus friends whose rich presence
 * matches map + score. Friends merely in CS2 are never shown.
 */
export function buildRoster(coplay: CoplayEntry[], friends: FriendInGame[], m: Pick<Match, "map" | "score" | "seen">, now: number): Player[] {
  const roster: Player[] = coplay.slice(0, SLOTS).map((c) => ({ id: c.id, name: c.name, source: "coplay", seenAt: c.time }));
  const taken = new Set(roster.map((p) => p.id));
  const friendById = new Map(friends.map((f) => [f.id, f]));

  for (const [id, name] of Object.entries(m.seen)) {
    if (roster.length >= SLOTS || taken.has(id)) continue;
    const f = friendById.get(id);
    roster.push({ id, name: f?.name || name, source: f ? "friend" : "teammate", seenAt: now });
    taken.add(id);
  }
  for (const f of friends) {
    if (roster.length >= SLOTS || taken.has(f.id) || f.appId !== CS2_APPID || !richPresenceMatches(f, m)) continue;
    roster.push({ id: f.id, name: f.name, source: "friend", seenAt: now });
    taken.add(f.id);
  }
  return roster;
}
