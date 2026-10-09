import { test, expect } from "bun:test";
import { coplayForMatch, buildRoster, isIndividual } from "../src/roster/roster";
import raw from "./fixtures/coplay.json";
import type { CoplayEntry, FriendInGame } from "../src/steam";

const fx = raw as { me: string; matchStartedAt: number; coplay: CoplayEntry[]; friends: FriendInGame[] };

test("isIndividual rejects non-individual ids", () => {
  expect(isIndividual("76561198000000011")).toBe(true);
  expect(isIndividual("189429989741627465")).toBe(false);
});

test("coplay filter: CS2 only, within window, not me, not anonymous, oldest first", () => {
  const got = coplayForMatch(fx.coplay, fx.me, fx.matchStartedAt);
  expect(got.map((c) => c.name)).toEqual(["Redkit", "Walkthrough", "Ghosty", "glyph", "HARVEY SPECTER", "bruxo.", "ghst", "Fer1t"]);
});

const M = (map: string, score: [number, number] = [0, 0], seen: Record<string, string> = {}) => ({ map, score, seen });

test("friends merely in CS2 are never shown", () => {
  const coplay = coplayForMatch(fx.coplay, fx.me, fx.matchStartedAt);
  expect(buildRoster(coplay, fx.friends, M("de_inferno", [3, 5]), 1)).toHaveLength(8);
  expect(buildRoster(coplay, fx.friends, M("de_mirage"), 1)).toHaveLength(8); // 0:0 → RP check skipped
});

test("friend confirmed by rich presence map + exact score", () => {
  const coplay = coplayForMatch(fx.coplay, fx.me, fx.matchStartedAt);
  const r = buildRoster(coplay, fx.friends, M("de_mirage", [5, 3]), 1);
  expect(r).toHaveLength(9);
  expect(r[8]).toMatchObject({ name: "pal-on-mirage", source: "friend" });
  expect(buildRoster(coplay, fx.friends, M("de_mirage", [4, 3]), 1)).toHaveLength(8); // wrong score
});

test("spectated players are confirmed: friend label if on friends list, else teammate", () => {
  const coplay = coplayForMatch(fx.coplay, fx.me, fx.matchStartedAt).slice(0, 7);
  const r = buildRoster(coplay, fx.friends, M("de_inferno", [1, 1], { "76561198000000021": "gsi-name", "76561198000000077": "rando" }), 1);
  expect(r.slice(7)).toMatchObject([{ name: "pal-in-cs2", source: "friend" }, { name: "rando", source: "teammate" }]);
});

test("cap at 9; spectated coplay player isn't duplicated", () => {
  const full = Array.from({ length: 10 }, (_, i) => ({ id: `7656119800000010${i}`, name: `p${i}`, appId: 730, time: i }));
  expect(buildRoster(full, fx.friends, M("de_mirage", [5, 3], { "76561198000000021": "x" }), 1)).toHaveLength(9);
  expect(buildRoster(full.slice(0, 3), [], M("x", [0, 0], { [full[0]!.id]: "p0" }), 1)).toHaveLength(3);
});
