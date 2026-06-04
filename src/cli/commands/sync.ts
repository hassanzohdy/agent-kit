import { defineCommand } from "citty";
import { resolve } from "pathe";
import { deriveAll } from "../../derive/derive";
import { syncSkills } from "../../skills/sync-skills";
import type { SkillsTargetName } from "../../types";
import { logger } from "../../utils/logger";
import { findProjectRoot } from "../../utils/project-root";

/**
 * \`agent-kit sync\` — re-derive agent files from AGENTS.md and export skills
 * from installed packages into per-agent skill directories.
 *
 * Designed to be called from a project's \`postinstall\` script so skills and
 * derived files stay in sync with the lockfile.
 */
export const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description:
      "Regenerate derived agent files from AGENTS.md and sync skills from node_modules.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Working directory (defaults to process.cwd())",
    },
    "skills-only": {
      type: "boolean",
      description: "Only export skills; skip AGENTS.md derivation",
    },
    "derive-only": {
      type: "boolean",
      description: "Only derive agent files; skip skills export",
    },
    target: {
      type: "string",
      description:
        "Comma-separated skill targets (claude,copilot,cursor,codex,opencode,amp,goose,kiro,antigravity)",
    },
    path: {
      type: "string",
      alias: "p",
      description:
        "Comma-separated extra dirs to scan (each treated like a node_modules/). Useful for monorepos and local dev. Example: --path @warlock.js",
    },
    projects: {
      type: "string",
      description:
        "Comma-separated monorepo project dirs (or one-level globs like apps/*) to aggregate. Each is scanned as its own project — its node_modules (filtered by its own agentKit config) + its authored skills/, prefixed with the project dir name. Example: --projects backend,frontend",
    },
    override: {
      type: "boolean",
      description:
        "Replace user-authored destination folders (skipped by default to avoid clobbering hand-written content).",
    },
  },
  async run({ args }) {
    const startDir = args.cwd ? resolve(args.cwd) : process.cwd();
    const root = await findProjectRoot(startDir);
    if (!root) {
      throw new Error(
        `No package.json found at or above ${startDir}. Run sync from inside a project.`,
      );
    }

    if (!args["skills-only"]) {
      const derived = await deriveAll({ root });
      const changed = derived.filter((r) => r.changed).length;
      logger.success(
        `Derived ${derived.length} file(s) (${changed} changed): ${derived
          .map((r) => r.target)
          .join(", ")}`,
      );
    }

    if (!args["derive-only"]) {
      const targets = parseSkillTargets(args.target);
      const scanPaths = parseCsvList(args.path);
      const projects = parseCsvList(args.projects);
      const result = await syncSkills({
        root,
        targets,
        scanPaths,
        projects,
        override: Boolean(args.override),
      });
      logger.success(
        `Exported ${result.exported} skill(s) from ${result.packages.length} package(s) to: ${result.targets.join(", ")}`,
      );
      if (result.projects.length > 0) {
        logger.info(
          `Aggregated ${result.projects.length} project(s): ${result.projects.join(", ")}`,
        );
      }
      if (result.exported > 0) {
        logger.info(
          "Claude Code picks up new skills on the next prompt. Other agents (Cursor, Copilot, Codex, Gemini, Kiro, Antigravity) may need a window or session reload.",
        );
      }
      if (result.skipped > 0) {
        logger.info(
          `Skipped ${result.skipped} user-authored folder(s). Pass --override to replace them.`,
        );
      }
      if (scanPaths && scanPaths.length > 0) {
        logger.info(`Extra scan paths: ${scanPaths.join(", ")}`);
      }
    }
  },
});

function parseSkillTargets(raw: string | undefined): SkillsTargetName[] | undefined {
  const list = parseCsvList(raw);
  return list as SkillsTargetName[] | undefined;
}

function parseCsvList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}
