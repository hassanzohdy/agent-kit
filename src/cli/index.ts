import { defineCommand, runMain } from "citty";
import { initCommand } from "./commands/init";
import { syncCommand } from "./commands/sync";
import { watchCommand } from "./commands/watch";

const main = defineCommand({
  meta: {
    name: "agent-kit",
    version: "0.1.0",
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
