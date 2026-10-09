// Dump coplay list + friends in a game, then serve the UI with your last 20 players (Ctrl+C to quit).
import { openSteam, steamLibPath, CS2_APPID } from "../src/steam";
import { isIndividual } from "../src/roster/roster";
import { enrich, profile, hasWebApiKey } from "../src/enrich";
import { csStats, fetchCsStats } from "../src/cstracker";
import page from "../src/ui/index.html";

const lib = await steamLibPath();
console.log(`lib: ${lib}`);
const steam = openSteam(lib);
process.on("exit", () => steam.shutdown());
process.on("SIGINT", () => process.exit(0));
console.log(`me: ${steam.mySteamId()}`);

const iso = (t: number) => (t ? new Date(t * 1000).toISOString() : "-");
const coplay = steam.coplay().sort((a, b) => b.time - a.time);
console.log(`\ncoplay (${coplay.length}, newest first):`);
for (const c of coplay) console.log(`  ${c.id}  app=${String(c.appId).padEnd(7)} ${iso(c.time)}  ${c.name}`);

// Rich presence for other apps may need an explicit request + a few callback pumps.
const inGame = steam.friendsInGame();
for (const f of inGame) steam.requestRichPresence(f.id);
for (let i = 0; i < 12; i++) { steam.runCallbacks(); await Bun.sleep(250); }

const friends = steam.friendsInGame();
console.log(`\nfriends in a game (${friends.length}):`);
for (const f of friends) {
  const ip = [24, 16, 8, 0].map((s) => (f.gameIP >>> s) & 255).join(".");
  console.log(`  ${f.id}  app=${f.appId}${f.appId === CS2_APPID ? " (CS2)" : ""}  server=${ip}:${f.gamePort} q=${f.queryPort} lobby=${f.lobby}  ${f.name}`);
  console.log(`    rich presence: ${JSON.stringify(f.richPresence)}`);
}

// UI preview: same page as the app, filled with the 20 most recent coplay players (any game).
const PORT = 3001; // so it can run next to `bun run start`
const recent = () => steam.coplay().filter((c) => isIndividual(c.id)).sort((a, b) => b.time - a.time).slice(0, 20);
const snapshot = () => {
  const players = recent();
  return JSON.stringify({
    status: { steam: true, steamError: "", gsiAt: 0, pollAt: Math.floor(Date.now() / 1000), me: steam.mySteamId(), recording: false, webApi: hasWebApiKey },
    match: { map: "Recent players", mode: "probe", phase: "last 20" },
    slots: players.length,
    players: players.map((c) => ({ id: c.id, name: c.name, source: "coplay", seenAt: c.time, ...profile(c.id), cs: csStats(c.id) })),
  });
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  routes: {
    "/": page,
    "/ws": (req, srv) => (srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 })),
  },
  websocket: { open(ws) { ws.subscribe("roster"); ws.send(snapshot()); }, message() {} },
});
setInterval(() => {
  steam.runCallbacks();
  const ids = recent().map((c) => c.id);
  enrich(ids);
  fetchCsStats(ids, () => server.publish("roster", snapshot()));
  server.publish("roster", snapshot());
}, 2500);
console.log(`\n[ui] http://127.0.0.1:${PORT}/  (last 20 players, Ctrl+C to quit)`);
