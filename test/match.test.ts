import { test, expect } from "bun:test";
import { applyGsi, type GsiState } from "../src/gsi/match";

const ME = "76561198000000001";
const menu = { provider: { steamid: ME } };
const map = (name: string, phase = "warmup") => ({ provider: { steamid: ME }, map: { name, mode: "competitive", phase } });

test("menu → map starts match, phase updates keep startedAt, menu ends it", () => {
  let s: GsiState = {};
  let r = applyGsi(s, menu, 100);
  expect(r.event).toBeNull();
  expect(r.state.me).toBe(ME);

  r = applyGsi(r.state, map("de_mirage"), 110);
  expect(r.event).toMatchObject({ type: "start", match: { map: "de_mirage", startedAt: 110 } });

  r = applyGsi(r.state, map("de_mirage", "live"), 200);
  expect(r.event).toBeNull();
  expect(r.state.match).toMatchObject({ phase: "live", startedAt: 110 });

  r = applyGsi(r.state, menu, 3000);
  expect(r.event).toMatchObject({ type: "end", match: { map: "de_mirage" } });
  expect(r.state.match).toBeUndefined();
});

test("map name change restarts the match and reports the ended one", () => {
  const a = applyGsi({}, map("de_mirage"), 10);
  const b = applyGsi(a.state, map("de_inferno"), 20);
  expect(b.event).toMatchObject({ type: "start", match: { map: "de_inferno", startedAt: 20 } });
  expect(b.ended?.map).toBe("de_mirage");
});

test("me survives payloads without provider", () => {
  const a = applyGsi({}, map("de_mirage"), 10);
  expect(applyGsi(a.state, { map: { name: "de_mirage" } }, 11).state.me).toBe(ME);
});

test("spectated players (not me) accumulate per match and reset on a new map", () => {
  const spec = (id: string, map = "de_mirage") => ({ provider: { steamid: ME }, map: { name: map }, player: { steamid: id, name: "n" + id } });
  let r = applyGsi({}, spec(ME), 1);
  expect(r.state.match?.seen).toEqual({});
  r = applyGsi(r.state, spec("76561198000000002"), 2);
  r = applyGsi(r.state, spec("76561198000000003"), 3);
  expect(Object.keys(r.state.match!.seen)).toEqual(["76561198000000002", "76561198000000003"]);
  r = applyGsi(r.state, spec(ME, "de_inferno"), 4);
  expect(r.state.match?.seen).toEqual({});
});

test("score comes from team_ct/team_t", () => {
  const r = applyGsi({}, { map: { name: "de_mirage", team_ct: { score: 5 }, team_t: { score: 3 } } }, 1);
  expect(r.state.match?.score).toEqual([5, 3]);
});
