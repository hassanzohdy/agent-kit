import { stat } from "node:fs/promises";
import { defineCommand } from "citty";
import chokidar from "chokidar";
import { isAbsolute, resolve } from "pathe";
import { loadAgentKitConfig } from "../../config/agent-kit-config";
import { deriveAll } from "../../derive/derive";
import { resolveMonorepoProjects } from "../../monorepo/resolve-projects";
import { scanForSkillPackages } from "../../skills/scan-skills";
import { syncSkills } from "../../skills/sync-skills";
import { logger } from "../../utils/logger";
import { findProjectRoot } from "../../utils/project-root";

const DEBOUNCE_MS = 150;

/**
 * \`agent-kit watch\` — keep derived files and exported skills up to date while
 * editing AGENTS.md or any locally-edited skill files.
 *
 * Intended for monorepo / path-linked dev loops where postinstall does not
 * re-fire on every change.
 *
 * We watch concrete **directories**, not globs: chokidar v4+ dropped glob
 * support, so a pattern like `skills/**\/SKILL.md` would be treated as a literal
 * path and silently match nothing. Instead we resolve the real skill-source
 * directories up front (root `skills/`, each `--path` package's `skills/`, and
 * each `--projects` project's `skills/` + `package.json`) and watch those
 * recursively. `node_modules/` dependency skills are intentionally not watched
 * — they only change on (re)install, which fires `postinstall` → `sync`.
 */
export const watchCommand = defineCommand({
  meta: {
    name: "watch",
    description:
      "Watch AGENTS.md and skill files; re-derive and re-sync on change.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Working directory (defaults to process.cwd())",
    },
    path: {
      type: "string",
      alias: "p",
      description:
        "Comma-separated extra dirs to scan + watch (each treated like a node_modules/). Example: --path @warlock.js",
    },
    projects: {
      type: "string",
      description:
        "Comma-separated monorepo project dirs (or one-level globs like apps/*) to aggregate + watch. Example: --projects backend,frontend",
    },
    override: {
      type: "boolean",
      description:
        "Replace user-authored destination folders on each re-sync (skipped by default).",
    },
  },
  async run({ args }) {
    const startDir = args.cwd ? resolve(args.cwd) : process.cwd();
    const root = await findProjectRoot(startDir);
    if (!root) {
      throw new Error(
        `No package.json found at or above ${startDir}. Run watch from inside a project.`,
      );
    }

    const scanPaths = parseCsvList(args.path);
    const projects = parseCsvList(args.projects);
    const override = Boolean(args.override);

    // First pass so the working tree is consistent before we start listening.
    await runFullSync(root, scanPaths, projects, override);

    const watchTargets = await collectWatchTargets(root, scanPaths, projects);

    logger.info(
      `Watching ${watchTargets.length} path(s): AGENTS.md + skill dirs`,
    );
    if (scanPaths && scanPaths.length > 0) {
      logger.info(`Extra scan paths: ${scanPaths.join(", ")}`);
    }
    if (projects && projects.length > 0) {
      logger.info(`Monorepo projects: ${projects.join(", ")}`);
    }
    logger.info(
      "Claude Code picks up changes on the next prompt. Other agents may need a window/session reload after each re-sync.",
    );

    const watcher = chokidar.watch(watchTargets, { ignoreInitial: true });

    let timer: NodeJS.Timeout | null = null;
    const scheduleSync = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        runFullSync(root, scanPaths, projects, override).catch((error) => {
          logger.error(error);
        });
      }, DEBOUNCE_MS);
    };

    watcher.on("add", scheduleSync);
    watcher.on("change", scheduleSync);
    watcher.on("unlink", scheduleSync);
  },
});

async function runFullSync(
  root: string,
  scanPaths: string[] | undefined,
  projects: string[] | undefined,
  override: boolean,
): Promise<void> {
  const derived = await deriveAll({ root });
  const changedCount = derived.filter((r) => r.changed).length;
  if (changedCount > 0) {
    logger.success(`Re-derived ${changedCount} file(s)`);
  }
  const skills = await syncSkills({ root, scanPaths, projects, override });
  logger.success(
    `Re-synced ${skills.exported} skill(s) from ${skills.packages.length} package(s) to ${skills.targets.join(", ")}`,
  );
  if (skills.skipped > 0) {
    logger.info(
      `Skipped ${skills.skipped} user-authored folder(s). Pass --override to replace them.`,
    );
  }
}

/**
 * Resolve the concrete set of files/dirs to watch. Returns absolute paths that
 * exist on disk (chokidar fires reliably on existing targets); newly-created
 * top-level skill folders are picked up on the next `watch` restart.
 */
async function collectWatchTargets(
  root: string,
  scanPaths: string[] | undefined,
  projects: string[] | undefined,
): Promise<string[]> {
  const targets = new Set<string>();

  // AGENTS.md is always watched (added even if missing so its creation fires).
  targets.add(resolve(root, "AGENTS.md"));

  // Root authored skills.
  await addIfExists(targets, resolve(root, "skills"));

  // Each --path scan root: watch the `skills/` of every package it ships, so
  // a locally-linked dev package's skill edits re-sync live.
  for (const userPath of scanPaths ?? []) {
    const abs = isAbsolute(userPath) ? userPath : resolve(root, userPath);
    const packages = await scanForSkillPackages(abs);
    for (const pkg of packages) {
      await addIfExists(targets, resolve(pkg.pkgDir, "skills"));
    }
  }

  // Each monorepo project: watch its authored `skills/` and its `package.json`
  // (so config edits — pick/omit changes — re-sync too). Patterns come from
  // the flag or, when absent, from the root config.
  const config = await loadAgentKitConfig(root);
  const patterns = projects ?? config?.monorepo?.projects;
  const resolvedProjects = await resolveMonorepoProjects(root, patterns);
  for (const project of resolvedProjects) {
    await addIfExists(targets, resolve(project.dir, "skills"));
    await addIfExists(targets, resolve(project.dir, "package.json"));
  }

  return [...targets];
}

async function addIfExists(set: Set<string>, path: string): Promise<void> {
  try {
    await stat(path);
    set.add(path);
  } catch {
    // Missing — don't watch a non-existent path.
  }
}

function parseCsvList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}
