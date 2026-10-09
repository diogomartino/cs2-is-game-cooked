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

test("friend top-up fills only the missing slot, confident friend first", () => {
  const coplay = coplayForMatch(fx.coplay, fx.me, fx.matchStartedAt);
  const r = buildRoster(coplay, fx.friends, "de_mirage", 1);
  expect(r).toHaveLength(9);
  expect(r[8]).toMatchObject({ name: "pal-on-mirage", source: "friend" });
});

test("unconfirmed friends are tagged friend? and never exceed missing count", () => {
  const coplay = coplayForMatch(fx.coplay, fx.me, fx.matchStartedAt).slice(0, 7);
  const r = buildRoster(coplay, fx.friends, "de_inferno", 1);
  expect(r).toHaveLength(9);
  expect(r.slice(7).map((p) => p.source)).toEqual(["friend?", "friend?"]);
  expect(r.some((p) => p.name === "pal-in-other-game")).toBe(false);
});

test("no top-up when 9 coplay players already found; dedupes friends already in coplay", () => {
  const full = Array.from({ length: 10 }, (_, i) => ({ id: `7656119800000010${i}`, name: `p${i}`, appId: 730, time: i }));
  expect(buildRoster(full, fx.friends, "de_mirage", 1)).toHaveLength(9);
  const dup = [{ ...fx.friends[0]!, id: full[0]!.id }];
  expect(buildRoster(full.slice(0, 3), dup, "x", 1)).toHaveLength(3);
});
