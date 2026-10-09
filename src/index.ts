// Entry: GSI listener + UI/WebSocket server + Steam coplay poller.
import { appendFileSync, mkdirSync } from "node:fs";
import { applyGsi, type GsiPayload, type GsiState } from "./gsi/match";
import { openSteam, steamLibPath, type Steam, type CoplayEntry, type FriendInGame } from "./steam";
import { buildRoster, coplayForMatch, SLOTS, type Player } from "./roster/roster";
import { enrich, profile, hasWebApiKey } from "./enrich";
import { csStats, fetchCsStats } from "./cstracker";
import page from "./ui/index.html";

const PORT = 3000;
const POLL_MS = 2500;
const GSI_TOKEN = process.env.GSI_TOKEN; // written by `bun run setup`
const now = () => Math.floor(Date.now() / 1000);

// --record: JSONL of GSI payloads, coplay/friend snapshots (on change) and first-seen timings.
const recordFile = process.argv.includes("--record") ? `logs/${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl` : null;
if (recordFile) { mkdirSync("logs", { recursive: true }); console.log(`[record] ${recordFile}`); }
const record = (kind: string, data: unknown) => recordFile && appendFileSync(recordFile, JSON.stringify({ t: Date.now() / 1000, kind, data }) + "\n");

let gsi: GsiState = {};
let steam: Steam | null = null;
let steamError = "";
let lastPollAt = 0;
let roster: Player[] = [];
let firstSeen = new Map<string, number>(); // id → seconds after match start (wall clock of our poll)
let rpRequested = new Set<string>();
let lastSnap = "";

async function connectSteam() {
  try { steam = openSteam(await steamLibPath()); steamError = ""; console.log(`[steam] connected as ${steam.mySteamId()}`); }
  catch (e) { steamError = (e as Error).message; console.warn(`[steam] ${steamError} — retrying in 10s`); setTimeout(connectSteam, 10_000); }
}

function snapshot() {
  return {
    status: { steam: !!steam, steamError, gsiAt: gsi.lastGsiAt ?? 0, pollAt: lastPollAt, me: gsi.me ?? steam?.mySteamId() ?? "", recording: !!recordFile, webApi: hasWebApiKey },
    match: gsi.match ?? null,
    slots: SLOTS,
    players: roster.map((p) => ({ ...p, ...profile(p.id), cs: csStats(p.id), firstSeen: firstSeen.get(p.id) })),
  };
}
const broadcast = () => server.publish("roster", JSON.stringify(snapshot()));

function resetMatch() { roster = []; firstSeen = new Map(); rpRequested = new Set(); lastSnap = ""; }

function poll() {
  if (!steam) return;
  try {
    steam.runCallbacks();
    const m = gsi.match;
    if (!m) return;
    lastPollAt = now();
    const me = gsi.me ?? steam.mySteamId();
    const all: CoplayEntry[] = steam.coplay();
    const ours = coplayForMatch(all, me, m.startedAt);
    // Friends only matter while slots are missing (names for spectated friends, RP check); RP needs an explicit request.
    const friends: FriendInGame[] = ours.length < SLOTS ? steam.friendsInGame() : [];
    for (const f of friends) if (f.appId === 730 && !rpRequested.has(f.id)) { rpRequested.add(f.id); steam.requestRichPresence(f.id); }

    const snap = JSON.stringify({ ours, friends });
    if (snap !== lastSnap) { lastSnap = snap; record("snapshot", { matchStartedAt: m.startedAt, coplay: ours, friends }); }

    const next = buildRoster(ours, friends, m, lastPollAt);
    for (const p of next) if (!firstSeen.has(p.id)) {
      const dt = lastPollAt - m.startedAt;
      firstSeen.set(p.id, dt);
      console.log(`  +${String(dt).padStart(4)}s  [${p.source.padEnd(7)}] ${p.id}  ${p.name}  (coplay time ${p.source === "coplay" ? p.seenAt - m.startedAt + "s" : "-"})`);
      record("first_seen", { id: p.id, name: p.name, source: p.source, afterStart: dt, coplayTime: p.seenAt, phase: m.phase });
    }
    const key = (r: Player[]) => r.map((p) => p.id + p.source).join();
    const changed = key(next) !== key(roster);
    roster = next;
    if (changed) console.log(`[roster] ${roster.length}/${SLOTS} on ${m.map} (${m.phase})`);
    enrich(roster.map((p) => p.id)).then((got) => got && broadcast());
    fetchCsStats(roster.map((p) => p.id), broadcast);
  } catch (e) {
    console.error("[poll]", e);
  } finally {
    broadcast();
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  routes: {
    "/": page,
    "/gsi": {
      POST: async (req) => {
        const payload = (await req.json()) as GsiPayload;
        if (GSI_TOKEN && payload.auth?.token !== GSI_TOKEN) return new Response("bad token", { status: 403 });
        record("gsi", payload);
        const { state, event, ended } = applyGsi(gsi, payload, now());
        if (!gsi.me && state.me) console.log(`[gsi] first payload, me = ${state.me}`);
        gsi = state;
        if (ended) console.log(`[gsi] match ended: ${ended.map}`);
        if (event?.type === "end") { console.log(`[gsi] match ended: ${event.match.map}`); record("match_end", event.match); resetMatch(); }
        if (event?.type === "start") { console.log(`[gsi] match started: ${event.match.map} ${event.match.mode} (${event.match.phase})`); record("match_start", event.match); resetMatch(); poll(); }
        broadcast();
        return new Response("ok");
      },
    },
    "/ws": (req, srv) => (srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 })),
  },
  websocket: {
    open(ws) { ws.subscribe("roster"); ws.send(JSON.stringify(snapshot())); },
    message() {},
  },
});

connectSteam();
setInterval(poll, POLL_MS);
console.log(`[ui] http://127.0.0.1:${PORT}/  (GSI → POST /gsi${GSI_TOKEN ? ", token required" : ", NO token set — run setup first"})`);

const quit = () => { steam?.shutdown(); process.exit(0); };
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
