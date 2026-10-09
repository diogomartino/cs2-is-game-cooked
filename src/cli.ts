// Single entry for the compiled executable: `cs2-live-roster [setup|probe] [--record]`.
import { version } from "../package.json";

const cmd = process.argv[2];
if (cmd === "--version" || cmd === "-v") { console.log(version); process.exit(0); }
console.log(`cs2-live-roster v${version}`);
if (cmd === "setup") await import("../scripts/setup");
else if (cmd === "probe") await import("../scripts/probe");
else if (cmd && !cmd.startsWith("-")) { console.log("usage: cs2-live-roster [setup|probe] [--record] [--version]"); process.exit(1); }
else await import("./index");
