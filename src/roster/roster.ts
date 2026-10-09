// Pure roster logic: which coplay entries belong to the current match, plus friend top-up.
import { CS2_APPID, type CoplayEntry, type FriendInGame } from "../steam";

export const SLOTS = 9;
const COPLAY_SLACK_S = 60;

export type Source = "coplay" | "friend" | "friend?";
export interface Player { id: string; name: string; source: Source; seenAt: number }

/** Individual-account SteamID64s have account type 1 in bits 52–55 (filters "anonymous" ids). */
export const isIndividual = (id: string) => ((BigInt(id) >> 52n) & 0xfn) === 1n;

export function coplayForMatch(entries: CoplayEntry[], me: string | undefined, startedAt: number): CoplayEntry[] {
  return entries
    .filter((e) => e.appId === CS2_APPID && e.time >= startedAt - COPLAY_SLACK_S && e.id !== me && isIndividual(e.id))
    .sort((a, b) => a.time - b.time);
}

/**
 * Steam's coplay list excludes friends, so top up the missing slots from friends in CS2.
 * Rich presence from another AppID is usually unreadable from 480, so a friend is "friend"
 * (confident) only if their rich presence mentions the current map; otherwise "friend?".
 */
export function buildRoster(coplay: CoplayEntry[], friends: FriendInGame[], map: string, now: number): Player[] {
  const roster: Player[] = coplay.slice(0, SLOTS).map((c) => ({ id: c.id, name: c.name, source: "coplay", seenAt: c.time }));
  const missing = SLOTS - roster.length;
  if (missing <= 0) return roster;

  const taken = new Set(roster.map((p) => p.id));
  const mapKey = map.toLowerCase();
  const candidates = friends
    .filter((f) => f.appId === CS2_APPID && !taken.has(f.id))
    .map((f): Player => ({
      id: f.id, name: f.name, seenAt: now,
      source: mapKey && Object.values(f.richPresence).some((v) => v.toLowerCase().includes(mapKey)) ? "friend" : "friend?",
    }))
    .sort((a, b) => Number(a.source === "friend?") - Number(b.source === "friend?"));
  return roster.concat(candidates.slice(0, missing));
}
