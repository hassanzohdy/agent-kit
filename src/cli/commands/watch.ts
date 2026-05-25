import { defineCommand } from "citty";
import chokidar from "chokidar";
import { resolve } from "pathe";
import { deriveAll } from "../../derive/derive";
import { syncSkills } from "../../skills/sync-skills";
import { logger } from "../../utils/logger";
import { findProjectRoot } from "../../utils/project-root";

const DEPS_SKILLS_GLOB = "node_modules/**/skills/**/SKILL.md";
const LOCAL_SKILLS_GLOB = "skills/**/SKILL.md";
const DEBOUNCE_MS = 150;

/**
 * \`agent-kit watch\` — keep derived files and exported skills up to date while
 * editing AGENTS.md or any locally-linked package's skill files.
 *
 * Intended for monorepo / path-linked dev loops where postinstall does not
 * re-fire on every change.
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
    const override = Boolean(args.override);

    // First pass so the working tree is consistent before we start listening.
    await runFullSync(root, scanPaths, override);

    const agentsPath = resolve(root, "AGENTS.md");
    const watchTargets = [
      agentsPath,
      resolve(root, LOCAL_SKILLS_GLOB),
      resolve(root, DEPS_SKILLS_GLOB),
      ...(scanPaths ?? []).map((p) =>
        resolve(root, p, "**/skills/**/SKILL.md"),
      ),
    ];

    logger.info(`Watching: AGENTS.md + ${watchTargets.length - 1} skill glob(s)`);
    if (scanPaths && scanPaths.length > 0) {
      logger.info(`Extra scan paths: ${scanPaths.join(", ")}`);
    }

    const watcher = chokidar.watch(watchTargets, {
      ignoreInitial: true,
      cwd: root,
    });

    let timer: NodeJS.Timeout | null = null;
    const scheduleSync = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        runFullSync(root, scanPaths, override).catch((error) => {
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
  override: boolean,
): Promise<void> {
  const derived = await deriveAll({ root });
  const changedCount = derived.filter((r) => r.changed).length;
  if (changedCount > 0) {
    logger.success(`Re-derived ${changedCount} file(s)`);
  }
  const skills = await syncSkills({ root, scanPaths, override });
  logger.success(
    `Re-synced ${skills.exported} skill(s) from ${skills.packages.length} package(s) to ${skills.targets.join(", ")}`,
  );
  if (skills.skipped > 0) {
    logger.info(
      `Skipped ${skills.skipped} user-authored folder(s). Pass --override to replace them.`,
    );
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
