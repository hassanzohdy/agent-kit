import { defineCommand } from "citty";
import { resolve } from "pathe";
import { deriveAll } from "../../derive/derive";
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
 * \`agent-kit init\` — scaffold a starter \`AGENTS.md\` (only if missing) and
 * generate all derived files from it.
 *
 * If \`AGENTS.md\` already exists, it is left untouched. This is intentional —
 * the source file is the user's truth and init never clobbers it.
 */
export const initCommand = defineCommand({
  meta: {
    name: "init",
    description:
      "Scaffold AGENTS.md (if missing) and generate derived files for each AI agent.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Working directory (defaults to process.cwd())",
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
  },
});

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
