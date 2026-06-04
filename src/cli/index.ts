import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import { dirname, resolve } from "pathe";
import { initCommand } from "./commands/init";
import { syncCommand } from "./commands/sync";
import { watchCommand } from "./commands/watch";

/**
 * Read agent-kit's own version from its package.json at runtime, rather than
 * hardcoding it (which silently drifts from the published version on every
 * release). Resolved relative to this module so it works from both the source
 * tree (`src/cli/index.ts` → `../../package.json`) and the compiled CLI
 * (`cjs/cli/index.cjs` → `../../package.json`). Mirrors the convention used by
 * `@mongez/pkgist`'s CLI. Falls back to `0.0.0` if the file can't be read.
 */
function readCliVersion(): string {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(moduleDir, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const main = defineCommand({
  meta: {
    name: "agent-kit",
    version: readCliVersion(),
    description:
      "Author and distribute AI coding agent artifacts: AGENTS.md derivation + skills sync.",
  },
  subCommands: {
    init: initCommand,
    sync: syncCommand,
    watch: watchCommand,
  },
});

runMain(main);
