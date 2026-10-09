// Optional Steam Web API enrichment when STEAM_WEB_API_KEY is set:
// avatar, visibility, account age (summaries, batched), bans (batched), level + friend count (per id).
// Cached forever per process, one round in flight at a time.
// Stats providers can plug in the same way: SteamID64 in, extra fields out.

export interface Profile {
  avatar?: string; visibility?: "public" | "private"; createdAt?: number;
  level?: number; friends?: number | "private";
  vacBans?: number; gameBans?: number; daysSinceLastBan?: number;
}

const KEY = process.env.STEAM_WEB_API_KEY;
export const hasWebApiKey = !!KEY;
const API = "https://api.steampowered.com";
const cache = new Map<string, Profile>();
let inflight = false;
let retryAt = 0;

export const profile = (id: string) => cache.get(id);

const get = (path: string) => fetch(`${API}/${path}${path.includes("?") ? "&" : "?"}key=${KEY}`);

async function perId(id: string, p: Profile) {
  const [lvl, fr] = await Promise.all([
    get(`IPlayerService/GetSteamLevel/v1/?steamid=${id}`).then((r) => r.json() as Promise<any>).catch(() => null),
    get(`ISteamUser/GetFriendList/v1/?steamid=${id}&relationship=friend`).catch(() => null),
  ]);
  if (typeof lvl?.response?.player_level === "number") p.level = lvl.response.player_level;
  if (fr?.status === 401) p.friends = "private"; // friend list hidden
  else if (fr?.ok) p.friends = ((await fr.json()) as any)?.friendslist?.friends?.length ?? 0;
}

/** Fetches unknown ids; resolves true if anything new was cached. Safe to call every poll. */
export async function enrich(ids: string[]): Promise<boolean> {
  const todo = ids.filter((id) => !cache.has(id)).slice(0, 20); // ≤ 1 summaries + 1 bans + 40 per-id calls per round
  if (!KEY || inflight || !todo.length || Date.now() < retryAt) return false;
  inflight = true;
  try {
    const list = `steamids=${todo.join(",")}`;
    const [sum, bans] = await Promise.all([
      get(`ISteamUser/GetPlayerSummaries/v2/?${list}`).then((r) => r.json()) as Promise<any>,
      get(`ISteamUser/GetPlayerBans/v1/?${list}`).then((r) => r.json()) as Promise<any>,
    ]);
    const fresh = new Map(todo.map((id) => [id, {} as Profile]));
    for (const p of sum?.response?.players ?? [])
      Object.assign(fresh.get(p.steamid) ?? {}, {
        avatar: p.avatarfull ?? p.avatarmedium,
        visibility: p.communityvisibilitystate === 3 ? "public" : "private",
        createdAt: p.timecreated, // absent on private profiles
      });
    for (const b of bans?.players ?? [])
      Object.assign(fresh.get(b.SteamId) ?? {}, { vacBans: b.NumberOfVACBans, gameBans: b.NumberOfGameBans, daysSinceLastBan: b.DaysSinceLastBan });
    await Promise.all([...fresh].map(([id, p]) => perId(id, p)));
    for (const [id, p] of fresh) cache.set(id, p);
    return true;
  } catch (e) {
    retryAt = Date.now() + 30_000;
    console.warn("[enrich] Web API failed, retrying in 30s:", (e as Error).message);
    return false;
  } finally {
    inflight = false;
  }
}
