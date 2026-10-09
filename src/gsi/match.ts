// CS2 Game State Integration: payload types (only what we use) + pure match state machine.

export interface GsiPayload {
  provider?: { steamid?: string; appid?: number; timestamp?: number };
  map?: { name?: string; mode?: string; phase?: string; round?: number };
  player?: { steamid?: string };
  auth?: { token?: string };
}

export interface Match { map: string; mode: string; phase: string; startedAt: number }
export interface GsiState { me?: string; match?: Match; lastGsiAt?: number }
export type MatchEvent = { type: "start"; match: Match } | { type: "end"; match: Match } | null;

/** Match starts when a map appears or its name changes; ends when `map` disappears. */
export function applyGsi(prev: GsiState, p: GsiPayload, now: number): { state: GsiState; event: MatchEvent; ended?: Match } {
  const me = p.provider?.steamid ?? prev.me;
  const name = p.map?.name;
  const old = prev.match;
  if (!name) return { state: { me, lastGsiAt: now }, event: old ? { type: "end", match: old } : null };

  const fields = { map: name, mode: p.map?.mode ?? "", phase: p.map?.phase ?? "" };
  if (old && old.map === name) return { state: { me, lastGsiAt: now, match: { ...old, ...fields } }, event: null };

  const match = { ...fields, startedAt: now };
  // Map changed without an empty payload in between: old match ended, new one started.
  return { state: { me, lastGsiAt: now, match }, event: { type: "start", match }, ended: old };
}
