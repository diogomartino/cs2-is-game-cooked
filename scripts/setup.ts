// Locate CS2, write the GSI cfg (with a random auth token mirrored into .env), write steam_appid.txt.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function steamRoot(): string {
  if (process.platform === "win32") {
    const out = Bun.spawnSync(["reg", "query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"]).stdout.toString();
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) return m[1]!.trim();
    return "C:/Program Files (x86)/Steam";
  }
  return [join(homedir(), ".steam/steam"), join(homedir(), ".local/share/Steam")].find(existsSync) ?? "";
}

function cs2Dir(root: string): string | null {
  const vdf = join(root, "steamapps/libraryfolders.vdf");
  const libs = existsSync(vdf)
    ? [...readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"([\s\S]*?)(?="path"|$)/g)]
        .sort((a, b) => Number(/"730"\s/.test(b[2]!)) - Number(/"730"\s/.test(a[2]!))) // library listing 730 first
        .map((m) => m[1]!.replace(/\\\\/g, "\\"))
    : [root];
  for (const lib of libs) {
    const dir = join(lib, "steamapps/common/Counter-Strike Global Offensive");
    if (existsSync(join(dir, "game/csgo"))) return dir;
  }
  return null;
}

const root = steamRoot();
console.log(`Steam: ${root || "NOT FOUND"}`);
const cs2 = cs2Dir(root);
if (!cs2) { console.error("CS2 install not found. Is it installed via Steam?"); process.exit(1); }
console.log(`CS2:   ${cs2}`);

// Reuse an existing token so re-running setup doesn't break a running server.
const envText = existsSync(".env") ? readFileSync(".env", "utf8") : "";
let token = envText.match(/^GSI_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) {
  token = crypto.randomUUID().replace(/-/g, "");
  writeFileSync(".env", envText + (envText && !envText.endsWith("\n") ? "\n" : "") + `GSI_TOKEN=${token}\n`);
}

const cfg = `"CS2 Live Roster"
{
  "uri"       "http://127.0.0.1:3000/gsi"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.5"
  "heartbeat" "10.0"
  "auth"      { "token" "${token}" }
  "data"
  {
    "provider"  "1"
    "map"       "1"
    "player_id" "1"
  }
}
`;
const cfgPath = join(cs2, "game/csgo/cfg/gamestate_integration_roster.cfg");
writeFileSync(cfgPath, cfg);
console.log(`wrote ${cfgPath}  (restart CS2 if it's running)`);

writeFileSync("steam_appid.txt", "480");
console.log("wrote steam_appid.txt (480 = Spacewar)");

