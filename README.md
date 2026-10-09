# CS2 Is Game Cooked

Shows the Steam profiles of the other 9 players in your current CS2 match, live, in a browser tab. Then shows additional stats from cstracker.gg, scope.gg, cswat.ch, and Leetify. Check in real time if your game is cooked.

Uses only CS2 Game State Integration (official) and the Steamworks API via your local Steam client.
No game memory reading, injection, or network sniffing.

## Download (standalone)

Grab `cs2-is-game-cooked-windows-x64.exe` or `cs2-is-game-cooked-linux-x64` from the latest GitHub release.
The Steam API library is embedded, so you don't need Bun or the Steamworks SDK. Put the executable in its own folder and run:

| Command                        | What it does                                  |
| ------------------------------ | --------------------------------------------- |
| `cs2-is-game-cooked setup`     | Same as `bun run setup`                       |
| `cs2-is-game-cooked`           | Starts the app (`--record` to log to `logs/`) |
| `cs2-is-game-cooked probe`     | Same as `bun run probe`                       |
| `cs2-is-game-cooked --version` | Prints the version                            |

`.env`, `cache/`, `logs/` and `steam_appid.txt` live next to the executable, wherever you launch it from. To set `STEAM_WEB_API_KEY` or `LEETIFY_API_KEY`, create a `.env` file in that folder, one `KEY=value` per line. `setup` adds `GSI_TOKEN` itself. Variables already set in your shell take priority.

## Setup (from source)

1. Install [Bun](https://bun.sh), then run `bun install`.
2. Download the Steamworks SDK (partner.steamgames.com) and copy into `vendor/`:
   - Windows: `sdk/redistributable_bin/win64/steam_api64.dll`
   - Linux: `sdk/redistributable_bin/linux64/libsteam_api.so`
3. Run `bun run setup`, then restart CS2.
4. Add `STEAM_WEB_API_KEY=...` to `.env` (get one at steamcommunity.com/dev/apikey). Needed for avatar, account age, level, friend count and bans; without it cards show name + SteamID only.

## Scripts

| Command             | What it does                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run setup`     | Writes the GSI cfg into CS2's `cfg/` folder, creates `GSI_TOKEN` in `.env`, and writes `steam_appid.txt`.                                                                          |
| `bun run probe`     | Prints your Steam coplay list and the friends who are in a game, then serves the UI with your last 20 players at http://127.0.0.1:3001/. Run this first to check that Steam works. |
| `bun run start`     | Starts the app. Open http://127.0.0.1:3000/ on your second monitor.                                                                                                                |
| `bun run record`    | Same as `start`, and also writes GSI payloads, roster snapshots, and first-seen timings to `logs/`.                                                                                |
| `bun run test`      | Runs the unit tests.                                                                                                                                                               |
| `bun run typecheck` | Runs the TypeScript type check.                                                                                                                                                    |
| `bun run build`     | Compiles standalone Linux and Windows executables into `dist/`.                                                                                                                    |

Start the app **before** loading into a map.

## Notes

- Each card also shows Premier rating, FACEIT level/ELO, win rate, trust rating and aim stats from [cstracker.gg](https://cstracker.gg). The app reads the public player page, caches it in `cache/cstracker/` for 24 h per player, and sends at most 1 request per second. Players not on cstracker fall back to [scope.gg](https://scope.gg) (Premier rating, last 20 matches), [cswat.ch](https://cswat.ch) (FACEIT) and the [Leetify public API](https://api-public-docs.cs-prod.leetify.com/), merged in that priority order. None of them has a trust rating or percentiles. Set `LEETIFY_API_KEY` in `.env` for higher Leetify rate limits.
- The UI loads Tailwind from a CDN, so the browser needs internet.

- While the app runs, Steam shows you as playing **Spacewar** (AppID 480, needed to start the Steam API).
- Friends don't appear in Steam's coplay list, so a friend is only shown once they're confirmed in your match. That happens when you spectate them while dead (GSI reports who you're watching), or when their rich presence shows your map and exact score. Friends who are merely playing CS2 are never shown.
- Every push to `main` bumps the patch version, builds both executables, tags `vX.Y.Z`, and publishes a GitHub release (`.github/workflows/release.yml`).
- `vendor/libsteam_api.so` and `vendor/steam_api64.dll` must be committed, because CI embeds them in the executables. Releases therefore redistribute Valve's Steamworks library.
