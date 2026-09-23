import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Standalone release definition for @mongez/agent-kit. */
const cacheRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".agent-kit-release-cache");

export default {
  settings: {
    buildDir: resolve(cacheRoot, "builds"),
    sourcesDir: resolve(cacheRoot, "sources"),
  },
  standalone: [{
    name: "@mongez/agent-kit",
    root: ".",
    type: "typescript",
    mainType: "cjs",
    entries: ["index.ts", "cli/index.ts"],
    clone: ["README.md", "LICENSE", "CHANGELOG.md", "bin", "skills", "llms.txt", "llms-full.txt"],
  }],
  families: [],
};
