import { defineCommand } from "citty";
import { resolve } from "pathe";
import {
  ensureAgentKitTargets,
  ensurePostinstallScript,
} from "../../config/init-package-json";
import { deriveAll } from "../../derive/derive";
import type { SkillsTargetName } from "../../types";
import { readTextFile, writeTextFile } from "../../utils/file-io";
import { logger } from "../../utils/logger";
import { findProjectRoot } from "../../utils/project-root";

const STARTER_AGENTS_MD = `# AGENTS.md

> This file is the single source of truth for instructions given to AI coding
> agents working in this repository. Tool-specific files (\`CLAUDE.md\`,
> \`.gemini/GEMINI.md\`, \`.github/copilot-instructions.md\`, \`CONVENTIONS.md\`)
> are derived from this file by [agent-kit](https://github.com/hassanzohdy/agent-kit).

## Project overview

Describe what this project does and any context an agent needs to be useful.

## Skills

This project's dependencies may ship skills — focused, task-specific guides your
AI coding agent loads on demand (Claude Code, Cursor, Codex, Copilot, Gemini, and
others each read them from their own skills directory). Before searching the
codebase for examples, reading a package's source/types/README, or inferring an
API by hand, **first check the available skills and load any that match the
package or task**. Skills are the source of truth for how to use a package —
consult them before reverse-engineering usage from code.

## Commands

- \`yarn dev\` — start the dev server
- \`yarn test\` — run tests
- \`yarn build\` — production build

## Code style

Document conventions agents should follow (formatting, naming, imports, etc.).

## Boundaries

What agents should and should not do without checking first.
`;

/**
 * \`agent-kit init\` — scaffold a starter \`AGENTS.md\` (only if missing),
 * generate all derived files from it, and seed \`agentKit.targets\` in
 * \`package.json\`.
 *
 * If \`AGENTS.md\` already exists, it is left untouched. This is intentional —
 * the source file is the user's truth and init never clobbers it. The same
 * non-clobbering rule applies to an existing \`agentKit.targets\`: a value the
 * user already chose is only replaced when \`--target\` is passed explicitly.
 */
export const initCommand = defineCommand({
  meta: {
    name: "init",
    description:
      "Scaffold AGENTS.md (if missing), derive per-agent files, and seed agentKit.targets in package.json.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Working directory (defaults to process.cwd())",
    },
    target: {
      type: "string",
      description:
        "Comma-separated skill targets to write into package.json's agentKit.targets (claude,copilot,cursor,codex,opencode,amp,goose,kiro,antigravity). Defaults to claude. Passing this overwrites an existing agentKit.targets.",
    },
  },
  async run({ args }) {
    const root = await resolveRoot(args.cwd);
    const sourcePath = resolve(root, "AGENTS.md");

    const existing = await readTextFile(sourcePath);
    if (existing === null) {
      await writeTextFile(sourcePath, STARTER_AGENTS_MD);
      logger.success(`Created AGENTS.md`);
    } else {
      logger.info(`AGENTS.md already exists — leaving it alone`);
    }

    const results = await deriveAll({ root });
    const changed = results.filter((r) => r.changed).length;
    logger.success(
      `Derived ${results.length} file(s) (${changed} changed): ${results
        .map((r) => r.target)
        .join(", ")}`,
    );

    const explicitTargets = parseTargets(args.target);
    const seed = await ensureAgentKitTargets({
      root,
      targets: explicitTargets ?? ["claude"],
      overwrite: explicitTargets !== undefined,
    });
    logTargetsResult(seed.action, seed.targets);

    const postinstall = await ensurePostinstallScript({ root });
    logPostinstallResult(postinstall);
  },
});

/**
 * Parse the \`--target\` CSV into a target list, or \`undefined\` when the flag
 * was omitted (so the caller can fall back to the default without overwriting).
 * Validation of the names happens in {@link ensureAgentKitTargets}.
 */
function parseTargets(raw: string | undefined): SkillsTargetName[] | undefined {
  if (!raw) return undefined;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as SkillsTargetName[];
  return entries.length > 0 ? entries : undefined;
}

function logTargetsResult(
  action: Awaited<ReturnType<typeof ensureAgentKitTargets>>["action"],
  targets: SkillsTargetName[],
): void {
  const list = targets.join(", ");
  switch (action) {
    case "created":
    case "added":
      logger.success(`Seeded agentKit.targets = [${list}] in package.json`);
      break;
    case "updated":
      logger.success(`Updated agentKit.targets = [${list}] in package.json`);
      break;
    case "unchanged":
      logger.info(
        `agentKit.targets already set ([${list}]) — leaving it alone (pass --target to overwrite)`,
      );
      break;
  }
}

function logPostinstallResult(
  result: Awaited<ReturnType<typeof ensurePostinstallScript>>,
): void {
  switch (result.action) {
    case "wired":
      logger.success(
        `Wired "postinstall": "${result.command}" in package.json — skills + derived files now refresh on every install`,
      );
      break;
    case "skipped-existing":
      logger.info(
        `package.json already has a postinstall script ("${result.command}") — leaving it alone`,
      );
      break;
    case "skipped-not-a-dep":
      logger.info(
        'Tip: install @mongez/agent-kit as a dev dependency and add "postinstall": "agent-kit sync" so skills + derived files refresh on every install.',
      );
      break;
    case "unchanged":
      break;
  }
}

async function resolveRoot(cwdArg: string | undefined): Promise<string> {
  const startDir = cwdArg ? resolve(cwdArg) : process.cwd();
  const root = await findProjectRoot(startDir);
  if (!root) {
    throw new Error(
      `No package.json found at or above ${startDir}. Run init from inside a project.`,
    );
  }
  return root;
}
