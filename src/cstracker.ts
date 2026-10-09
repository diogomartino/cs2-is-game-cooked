// cstracker.gg player stats (Premier, FACEIT, win rate, trust rating, aim stats), scraped from the
// public server-rendered player page. Not on cstracker → scope.gg > cswat.ch (FACEIT) > Leetify API, merged by priority.
// Disk cache valid 24h per player (404s cached too);
// requests are serialized at ≥1.1s apart to respect robots.txt `Crawl-delay: 1`.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchLeetify } from "./leetify";
import { fetchCsWatch } from "./cswatch";
import { fetchScope } from "./scope";

export type Source = "cstracker" | "scope" | "cswatch" | "leetify";
export interface Stat { label: string; value: string; top?: string }
export interface CsStats {
  sources: Source[];
  premier?: number; faceitLevel?: number; faceitElo?: number; faceitGame?: string;
  winRate?: string; wlt?: string; matches?: number | null; trust?: number; recent?: string;
  stats: Stat[];
}

const TTL_MS = 24 * 3600_000;
const GAP_MS = 1100;
const DIR = join(process.cwd(), "cache/cstracker"); // cwd, not import.meta.dir: works in the compiled exe
mkdirSync(DIR, { recursive: true });

const mem = new Map<string, CsStats | null>(); // null = on neither cstracker nor Leetify
const queue: string[] = [];
let running = false;

export const csStats = (id: string) => mem.get(id);
export const csUrl = (id: string) => `https://cstracker.gg/players/${id}`;

const num = (s?: string) => (s == null ? undefined : Number(s.replace(/[^\d.]/g, "")) || undefined);

/** Pure HTML → stats. Text-based so small markup changes don't break it. */
export function parseCsTracker(html: string): CsStats {
  const faceit = html.match(/title="FACEIT level (\d+) · ([\d,]+) ELO"/);
  const premier = html.match(/class="cs2rating[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, "");
  const lines = html
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .split("\n").map((l) => l.trim()).filter(Boolean);
  const after = (label: string, n = 1) => { const i = lines.indexOf(label); return i < 0 ? undefined : lines[i + n]; };

  // "// recent" is followed by W/L/T letters.
  const r = lines.indexOf("// recent");
  let recent = "";
  for (let i = r + 1; r >= 0 && /^[WLT]$/.test(lines[i] ?? ""); i++) recent += lines[i];

  const w = lines.indexOf("win/loss/tie");
  const stats: Stat[] = [];
  for (const [key, label] of [["ttd", "TTD"], ["preaim", "Preaim"], ["aim offset", "Aim offset"], ["k/d ratio", "K/D"],
                              ["hltv rating", "HLTV"], ["kast", "KAST"], ["adr", "ADR"], ["accuracy", "Accuracy"]] as const) {
    const top = after(`// ${key}`), value = after(`// ${key}`, 2);
    if (value && top?.startsWith("top ")) stats.push({ label, value, top: top.slice(4) });
  }
  const hs = after("HS kills")?.match(/\(([\d.]+%)\)/)?.[1];
  if (hs) stats.push({ label: "HS", value: hs });

  return {
    sources: ["cstracker"],
    premier: num(premier),
    faceitLevel: num(faceit?.[1]), faceitElo: faceit ? Number(faceit[2]!.replace(/,/g, "")) : undefined,
    winRate: after("Win rate"),
    wlt: w >= 0 ? lines.slice(w + 1, w + 6).filter((l) => l !== "·").join("/") : undefined,
    matches: num(after("matches")),
    trust: num(after("// trust rating")),
    recent: recent || undefined,
    stats,
  };
}

/** `parts` in priority order: earlier sources' fields win; stats lists are concatenated. null if none has the player. */
export function mergeSources(parts: [Source, Partial<CsStats> | null][]): CsStats | null {
  const found = parts.filter((p): p is [Source, Partial<CsStats>] => !!p[1]);
  if (!found.length) return null;
  const out: CsStats = { sources: found.map(([s]) => s), stats: [] };
  for (const [, p] of [...found].reverse())
    for (const [k, v] of Object.entries(p)) if (v !== undefined && k !== "stats" && k !== "sources") (out as any)[k] = v;
  out.stats = found.flatMap(([, p]) => p.stats ?? []);
  return out;
}

// Different hosts, so they can run in parallel without breaking per-host crawl delays.
const fallback = async (id: string) => {
  const [sc, cw, lt] = await Promise.all([fetchScope(id), fetchCsWatch(id), fetchLeetify(id)]);
  return mergeSources([["scope", sc], ["cswatch", cw], ["leetify", lt]]);
};

async function load(id: string): Promise<boolean> {
  const file = Bun.file(join(DIR, `${id}.json`));
  if (await file.exists()) {
    const c = (await file.json()) as { fetchedAt: number; data: CsStats | null };
    // Entries without `sources` predate the current format → refetch.
    if (Date.now() - c.fetchedAt < TTL_MS && (c.data === null || c.data.sources)) { mem.set(id, c.data); return false; }
  }
  const res = await fetch(csUrl(id), { headers: { "user-agent": "cs2-live-roster (personal tool; 1 req/s, 24h cache)" } });
  let data: CsStats | null = null;
  if (res.ok) data = parseCsTracker(await res.text());
  else if (res.status === 404) data = await fallback(id);
  else throw new Error(`cstracker ${res.status}`); // don't cache transient errors
  mem.set(id, data);
  await Bun.write(file, JSON.stringify({ fetchedAt: Date.now(), data }));
  return true;
}

/** Queue unknown ids; `onUpdate` fires after each player resolves. */
export function fetchCsStats(ids: string[], onUpdate: () => void) {
  for (const id of ids) if (!mem.has(id) && !queue.includes(id)) queue.push(id);
  if (running) return;
  running = true;
  (async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        const fetched = await load(id);
        onUpdate();
        if (fetched) await Bun.sleep(GAP_MS);
      } catch (e) {
        console.warn(`[cstracker] ${id}: ${(e as Error).message}`);
        await Bun.sleep(GAP_MS * 5);
      }
    }
    running = false;
  })();
}
