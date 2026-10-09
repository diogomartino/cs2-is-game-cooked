// All Steamworks FFI lives here. The rest of the app only sees the `Steam` interface,
// so this can later be swapped for a direct steamclient64.dll implementation.
// Signatures verified against Steamworks SDK steam_api_flat.h (SteamFriends018 / SteamUser023).
import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const CS2_APPID = 730;
const HOST_APPID = "480"; // Spacewar; Steam needs *some* AppID to init.
const k_EFriendFlagImmediate = 4;

export interface CoplayEntry { id: string; name: string; appId: number; time: number }
export interface FriendInGame {
  id: string; name: string; appId: number;
  gameIP: number; gamePort: number; queryPort: number; lobby: string;
  richPresence: Record<string, string>;
}
export interface Steam {
  mySteamId(): string;
  runCallbacks(): void;
  coplay(): CoplayEntry[];
  /** Immediate friends currently in a game (any app); filter by appId yourself. */
  friendsInGame(): FriendInGame[];
  /** Asks Steam to fetch a friend's rich presence; arrives after later runCallbacks(). */
  requestRichPresence(id: string): void;
  shutdown(): void;
}

// Only ever loaded from ./vendor (copied from the Steamworks SDK) — never from a game folder.
// `bun build --compile` embeds the file; dlopen needs a real file, so it's extracted to the temp dir.
export async function steamLibPath(): Promise<string> {
  const lib: string = process.platform === "win32"
    ? (await import("../../vendor/steam_api64.dll", { with: { type: "file" } })).default
    : (await import("../../vendor/libsteam_api.so", { with: { type: "file" } })).default;
  if (!lib.includes("$bunfs") && !lib.includes("~BUN")) return lib; // running from source
  const dir = join(tmpdir(), "cs2-live-roster");
  const out = join(dir, basename(lib));
  const embedded = Bun.file(lib);
  // Same size → already extracted (and maybe loaded by another instance, so don't rewrite).
  if (!existsSync(out) || statSync(out).size !== embedded.size) { mkdirSync(dir, { recursive: true }); await Bun.write(out, embedded); }
  return out;
}

const { ptr: P, i32, u32, u64, cstring, bool, void: V } = FFIType;
const SYMBOLS = {
  SteamAPI_RunCallbacks: { args: [], returns: V },
  SteamAPI_Shutdown: { args: [], returns: V },
  SteamAPI_ISteamUser_GetSteamID: { args: [P], returns: u64 },
  SteamAPI_ISteamFriends_GetCoplayFriendCount: { args: [P], returns: i32 },
  SteamAPI_ISteamFriends_GetCoplayFriend: { args: [P, i32], returns: u64 },
  SteamAPI_ISteamFriends_GetFriendCoplayTime: { args: [P, u64], returns: i32 },
  SteamAPI_ISteamFriends_GetFriendCoplayGame: { args: [P, u64], returns: u32 },
  SteamAPI_ISteamFriends_GetFriendPersonaName: { args: [P, u64], returns: cstring },
  SteamAPI_ISteamFriends_GetFriendCount: { args: [P, i32], returns: i32 },
  SteamAPI_ISteamFriends_GetFriendByIndex: { args: [P, i32, i32], returns: u64 },
  SteamAPI_ISteamFriends_GetFriendGamePlayed: { args: [P, u64, P], returns: bool },
  SteamAPI_ISteamFriends_GetFriendRichPresence: { args: [P, u64, cstring], returns: cstring },
  SteamAPI_ISteamFriends_GetFriendRichPresenceKeyCount: { args: [P, u64], returns: i32 },
  SteamAPI_ISteamFriends_GetFriendRichPresenceKeyByIndex: { args: [P, u64, i32], returns: cstring },
  SteamAPI_ISteamFriends_RequestFriendRichPresence: { args: [P, u64], returns: V },
} as const;

/** dlopen a single optional symbol; null if this DLL doesn't export it. */
function optional(lib: string, name: string, def: { args: FFIType[]; returns: FFIType }) {
  try { return dlopen(lib, { [name]: def }).symbols[name] as (...a: unknown[]) => unknown; } catch { return null; }
}

const str = (s: unknown) => (s == null ? "" : String(s));
const cbuf = (s: string) => Buffer.from(s + "\0");

// FriendGameInfo_t: CGameID u64 @0, u32 ip @8, u16 port @12, u16 qport @14, CSteamID lobby @16 → 24 bytes.
// Fields are naturally aligned, so pack(4) (Linux) and pack(8) (Windows) give the same layout.
const FGI_SIZE = 24;

export function openSteam(lib: string): Steam {
  if (!existsSync(lib)) throw new Error(`Steam API library not found: ${lib} (see README: copy it into vendor/)`);
  const appidFile = join(process.cwd(), "steam_appid.txt");
  if (!existsSync(appidFile)) writeFileSync(appidFile, HOST_APPID);

  // Init: InitFlat (SDK ≥1.59, returns ESteamAPIInitResult, 0 = OK) → InitSafe → Init (older DLLs, return bool).
  const initFlat = optional(lib, "SteamAPI_InitFlat", { args: [P], returns: i32 });
  if (initFlat) {
    const err = new Uint8Array(1024);
    const rc = initFlat(err) as number;
    if (rc !== 0) throw new Error(`SteamAPI_InitFlat failed (${rc}): ${new TextDecoder().decode(err).replace(/\0.*$/s, "")}`);
  } else {
    const init = optional(lib, "SteamAPI_InitSafe", { args: [], returns: bool }) ?? optional(lib, "SteamAPI_Init", { args: [], returns: bool });
    if (!init) throw new Error("No SteamAPI_InitFlat/InitSafe/Init export in " + lib);
    if (!init()) throw new Error("SteamAPI_Init failed — is Steam running and logged in?");
  }

  const accessor = (names: string[]) => {
    for (const n of names) {
      const f = optional(lib, n, { args: [], returns: P });
      if (f) { const p = f() as Pointer | null; if (p) return p; }
    }
    throw new Error(`None of ${names.join(", ")} exported/non-null in ${lib}`);
  };
  const friends = accessor(["SteamAPI_SteamFriends_v018", "SteamAPI_SteamFriends_v017"]);
  const user = accessor(["SteamAPI_SteamUser_v023", "SteamAPI_SteamUser_v022", "SteamAPI_SteamUser_v021"]);
  const s = dlopen(lib, SYMBOLS).symbols;
  const me = BigInt(s.SteamAPI_ISteamUser_GetSteamID(user));

  const name = (id: bigint) => str(s.SteamAPI_ISteamFriends_GetFriendPersonaName(friends, id));
  const richPresence = (id: bigint) => {
    const out: Record<string, string> = {};
    const n = s.SteamAPI_ISteamFriends_GetFriendRichPresenceKeyCount(friends, id);
    for (let i = 0; i < n; i++) {
      const k = str(s.SteamAPI_ISteamFriends_GetFriendRichPresenceKeyByIndex(friends, id, i));
      out[k] = str(s.SteamAPI_ISteamFriends_GetFriendRichPresence(friends, id, cbuf(k)));
    }
    return out;
  };

  let down = false;
  return {
    mySteamId: () => me.toString(),
    runCallbacks: () => s.SteamAPI_RunCallbacks(),
    coplay() {
      const out: CoplayEntry[] = [];
      const n = s.SteamAPI_ISteamFriends_GetCoplayFriendCount(friends);
      for (let i = 0; i < n; i++) {
        const id = BigInt(s.SteamAPI_ISteamFriends_GetCoplayFriend(friends, i));
        out.push({
          id: id.toString(), name: name(id),
          appId: s.SteamAPI_ISteamFriends_GetFriendCoplayGame(friends, id),
          time: s.SteamAPI_ISteamFriends_GetFriendCoplayTime(friends, id),
        });
      }
      return out;
    },
    friendsInGame() {
      const out: FriendInGame[] = [];
      const buf = new Uint8Array(FGI_SIZE);
      const dv = new DataView(buf.buffer);
      const n = s.SteamAPI_ISteamFriends_GetFriendCount(friends, k_EFriendFlagImmediate);
      for (let i = 0; i < n; i++) {
        const id = BigInt(s.SteamAPI_ISteamFriends_GetFriendByIndex(friends, i, k_EFriendFlagImmediate));
        buf.fill(0);
        if (!s.SteamAPI_ISteamFriends_GetFriendGamePlayed(friends, id, buf)) continue;
        out.push({
          id: id.toString(), name: name(id),
          appId: Number(dv.getBigUint64(0, true) & 0xffffffn), // CGameID: low 24 bits = AppID
          gameIP: dv.getUint32(8, true), gamePort: dv.getUint16(12, true), queryPort: dv.getUint16(14, true),
          lobby: dv.getBigUint64(16, true).toString(),
          richPresence: richPresence(id),
        });
      }
      return out;
    },
    requestRichPresence: (id) => s.SteamAPI_ISteamFriends_RequestFriendRichPresence(friends, BigInt(id)),
    shutdown() { if (!down) { down = true; s.SteamAPI_Shutdown(); } },
  };
}
