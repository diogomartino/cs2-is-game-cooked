import { test, expect } from "bun:test";
import { loadEnv } from "../src/env";

test(".env parsing: comments, quotes, export, CRLF; existing vars win", () => {
  const env: Record<string, string | undefined> = { KEEP: "shell" };
  loadEnv('# comment\nGSI_TOKEN=abc123\r\nexport A="quoted value"\nB=\'single\'\nKEEP=dotenv\n\nnot a line\nEMPTY=', env);
  expect(env).toEqual({ KEEP: "shell", GSI_TOKEN: "abc123", A: "quoted value", B: "single", EMPTY: "" });
});
