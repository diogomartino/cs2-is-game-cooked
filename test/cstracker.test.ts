import { test, expect } from "bun:test";
import { parseCsTracker, mergeSources } from "../src/cstracker";
import { parseScope, accountId } from "../src/scope";
import { parseCsWatch } from "../src/cswatch";
import { parseLeetify } from "../src/leetify";

test("parses headline + stats from a saved player page", async () => {
  const s = parseCsTracker(await Bun.file(`${import.meta.dir}/fixtures/cstracker.html`).text());
  expect(s).toMatchObject({ premier: 24658, faceitLevel: 1, faceitElo: 0, winRate: "78.0%", wlt: "68/19/3", matches: 94, trust: 70.5, recent: "LWWLWWWWW" });
  expect(s.stats.find((x) => x.label === "K/D")).toEqual({ label: "K/D", value: "2.10", top: "1.7%" });
  expect(s.stats.find((x) => x.label === "HS")?.value).toBe("51.7%");
});

test("parses FACEIT elo with thousands separator", async () => {
  const s = parseCsTracker(await Bun.file(`${import.meta.dir}/fixtures/cstracker-pro.html`).text());
  expect(s).toMatchObject({ faceitLevel: 10, faceitElo: 3518, trust: 100 });
});

test("empty page yields no fields, no crash", () => {
  expect(parseCsTracker("<html></html>")).toEqual({ sources: ["cstracker"], stats: [] } as never);
});

test("leetify fallback maps ranks, winrate and recent results", async () => {
  const s = parseLeetify(await Bun.file(`${import.meta.dir}/fixtures/leetify.json`).json());
  expect(s).toMatchObject({ sources: ["leetify"], premier: 22398, faceitLevel: 8, faceitElo: undefined, winRate: "40.7%", matches: 1175, wlt: "52/42/6 last 100" });
  expect(s.trust).toBeUndefined();
  expect(s.recent).toHaveLength(9);
  expect(s.stats.find((x) => x.label === "Aim")?.value).toBe("68");
});

test("leetify private/empty profile doesn't crash", () => {
  expect(parseLeetify({ privacy_mode: "private" })).toMatchObject({ sources: ["leetify"], stats: [] });
});

test("cswat.ch: FACEIT from RSC payload, history reversed (1=W, 2=L)", async () => {
  const cw = parseCsWatch(await Bun.file(`${import.meta.dir}/fixtures/cswatch.html`).text());
  expect(cw).toMatchObject({ faceitLevel: 8, faceitElo: 1730, faceitGame: "cs2", winRate: "52%", matches: 519, recent: "LLWLLWWWLL" });
});

test("cswat.ch: unknown player → null", async () => {
  expect(parseCsWatch(await Bun.file(`${import.meta.dir}/fixtures/cswatch-unknown.html`).text())).toBeNull();
});

test("merge: cswat.ch overrides Leetify, keeps Leetify-only fields", async () => {
  const cw = parseCsWatch(await Bun.file(`${import.meta.dir}/fixtures/cswatch.html`).text());
  const lt = parseLeetify(await Bun.file(`${import.meta.dir}/fixtures/leetify.json`).json());
  const m = mergeSources([["cswatch", cw], ["leetify", lt]])!;
  expect(m).toMatchObject({ sources: ["cswatch", "leetify"], faceitElo: 1730, winRate: "52%", premier: 22398 });
  expect(m.stats[0]!.label).toBe("FACEIT K/D");
  expect(m.stats.some((s) => s.label === "Aim")).toBe(true);
  expect(mergeSources([["cswatch", null], ["leetify", null]])).toBeNull();
  expect(mergeSources([["cswatch", cw], ["leetify", null]])?.sources).toEqual(["cswatch"]);
});

test("scope.gg: account id, latest premier, W/L/T from user team, averages", async () => {
  expect(accountId("76561198032964582")).toBe(72698854);
  const sc = parseScope(await Bun.file(`${import.meta.dir}/fixtures/scope.json`).json())!;
  expect(sc).toMatchObject({ premier: 24619, matches: null });
  expect(sc.wlt).toMatch(/^\d+\/\d+\/\d+ last \d+$/);
  expect(sc.recent?.[0]).toBe("T"); // latest: 15-15 Anubis
  expect(sc.stats?.map((s) => s.label)).toEqual(["K/D", "ADR", "Rating 2.0"]);
  expect(parseScope([])).toBeNull();
});

test("merge priority: scope.gg > cswat.ch > Leetify; scope hides FACEIT match total", async () => {
  const sc = parseScope(await Bun.file(`${import.meta.dir}/fixtures/scope.json`).json());
  const cw = parseCsWatch(await Bun.file(`${import.meta.dir}/fixtures/cswatch.html`).text());
  const lt = parseLeetify(await Bun.file(`${import.meta.dir}/fixtures/leetify.json`).json());
  const m = mergeSources([["scope", sc], ["cswatch", cw], ["leetify", lt]])!;
  expect(m).toMatchObject({ sources: ["scope", "cswatch", "leetify"], premier: 24619, faceitElo: 1730, matches: null, winRate: sc!.winRate });
  expect(m.stats.find((s) => s.label === "FACEIT WR")?.value).toBe("52%");
});
