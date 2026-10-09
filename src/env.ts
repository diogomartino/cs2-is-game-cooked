// Compiled executable: work from the executable's folder and load its .env, so .env, cache/, logs/
// and steam_appid.txt all live next to it wherever it's launched from (Bun only autoloads .env from the cwd).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Minimal .env parser: KEY=VALUE, # comments, optional quotes. Never overrides existing env vars. */
export function loadEnv(text: string, env: Record<string, string | undefined> = process.env) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || env[m[1]!] !== undefined) continue;
    env[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
}

export function useExeDir() {
  if (!import.meta.dir.includes("$bunfs") && !import.meta.dir.includes("~BUN")) return; // running from source
  const exeDir = dirname(process.execPath);
  process.chdir(exeDir);
  const envFile = join(exeDir, ".env");
  if (existsSync(envFile)) loadEnv(readFileSync(envFile, "utf8"));
}
