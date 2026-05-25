import { access, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "pathe";
import {
  type AgentKitConfig,
  loadAgentKitConfig,
} from "../config/agent-kit-config";
import type { SkillsTargetName, SyncSkillsOptions } from "../types";
import { logger } from "../utils/logger";
import { deriveSlugForSkill } from "./resolve-flat-name";
import {
  type ScannedSkillPackage,
  scanForSkillPackages,
  scanLocalPackage,
} from "./scan-skills";
import { MANAGED_SENTINEL, getSkillsTargetPath } from "./target-paths";

/**
 * Default set of skill-sync targets when the caller does not specify any.
 *
 * We deliberately do NOT default to every supported target — writing to
 * `.amp/`, `.goose/`, `.opencode/` etc. on a project that uses none of those
 * tools would litter the working tree. Callers (or the CLI's `--target` flag)
 * pick which targets to write to.
 */
export const DEFAULT_SKILLS_TARGETS: readonly SkillsTargetName[] =
  Object.freeze(["claude"]);

/**
 * Result shape from a single skills sync run.
 */
export type SkillsSyncResult = {
  /** Number of skill directories written (across all targets and packages). */
  exported: number;
  /** Number of stale managed directories pruned. */
  pruned: number;
  /** Number of user-authored destination folders skipped (without --override). */
  skipped: number;
  /** Targets that received the export. */
  targets: SkillsTargetName[];
  /** Packages whose skills were synced. */
  packages: string[];
  /** Absolute paths that were scanned for skill packages. */
  scannedPaths: string[];
};

/**
 * Walk the project's `node_modules/` (plus any extra `scanPaths`) for packages
 * that have a `skills/` folder, then mirror those skill folders into per-agent
 * skill directories using flat, collision-free names like
 * `.claude/skills/<pkg-slug>-<skill-name>/`.
 *
 * Each skill directory we create includes a `.agent-kit-managed` sentinel
 * file. On the next sync, every directory containing that sentinel is pruned
 * before re-export — so removed packages stop leaving stale skill copies
 * behind, but user-authored skills sitting alongside ours are never touched.
 *
 * Reads the project root's `agentKit` config from `package.json` to honor
 * default targets and per-package omit rules (see {@link AgentKitConfig}).
 *
 * @example
 * ```typescript
 * const result = await syncSkills({ root: process.cwd(), targets: ["claude", "cursor"] });
 * console.log(`Synced ${result.exported} skill(s), pruned ${result.pruned} stale`);
 * ```
 */
export async function syncSkills(
  options: SyncSkillsOptions,
): Promise<SkillsSyncResult> {
  const config = await loadAgentKitConfig(options.root);
  const targets = resolveTargets(options.targets, config);
  const scannedPaths = resolveScanPaths(options.root, options.scanPaths);

  // Scan every path + the project's own package.json in parallel.
  const [...scanResults] = await Promise.all([
    ...scannedPaths.map((p) => scanForSkillPackages(p)),
    scanLocalPackage(options.root),
  ]);
  const localSkills = scanResults.pop() as ScannedSkillPackage | null;

  // Flatten + dedupe by package name. Later scan-roots win, so a package
  // present in both node_modules and a user-provided scanPath gets the
  // scanPath copy (local override semantics).
  const byName = new Map<string, ScannedSkillPackage>();
  for (const scanned of scanResults as ScannedSkillPackage[][]) {
    for (const pkg of scanned) {
      byName.set(pkg.pkg, pkg);
    }
  }
  if (localSkills) byName.set(localSkills.pkg, localSkills);
  const discoveredPackages = [...byName.values()];

  // Apply pick filter (allowlist) then omit filter (denylist). pick runs first
  // so omit can further trim what pick allowed through.
  const picked = applyPickFilter(discoveredPackages, config?.pick);
  if (config?.pick !== undefined && picked.length === 0) {
    logger.warn(
      "agentKit.pick matched no installed packages. No skills will be synced. Check the package names against what's actually in node_modules.",
    );
  }
  const allPackages = applyOmitFilter(picked, config?.omit);

  let exported = 0;
  let pruned = 0;
  let skipped = 0;

  for (const target of targets) {
    const targetDir = resolve(options.root, getSkillsTargetPath(target));
    pruned += await pruneManagedDirs(targetDir);

    // Track destination slugs we've already written for this target so a
    // second package producing the same destination is detected loudly,
    // not silently clobbered.
    const writtenForTarget = new Map<string, string>(); // flatName → pkg

    for (const pkg of allPackages) {
      const result = await exportPackageSkills(pkg, targetDir, {
        writtenForTarget,
        override: options.override ?? false,
      });
      exported += result.exported;
      skipped += result.skipped;
    }
  }

  return {
    exported,
    pruned,
    skipped,
    targets,
    packages: allPackages.map((p) => p.pkg),
    scannedPaths,
  };
}

/**
 * Build the ordered list of absolute scan paths.
 *
 * Always starts with `<root>/node_modules`. User-provided paths are appended
 * in the order given and resolved relative to `root` when not absolute.
 */
function resolveScanPaths(
  root: string,
  userPaths: string[] | undefined,
): string[] {
  const paths = [resolve(root, "node_modules")];
  for (const userPath of userPaths ?? []) {
    paths.push(isAbsolute(userPath) ? userPath : resolve(root, userPath));
  }
  return paths;
}

/**
 * Resolve which skill targets to sync to. Resolution priority:
 *
 * 1. **Explicit options.targets** (passed by caller / CLI `--target` flag) wins.
 * 2. **Config's `agentKit.targets`** when present — empty array is honored
 *    but logged as a warning (user explicitly opted out of all targets).
 * 3. **Built-in default** (`["claude"]`).
 */
function resolveTargets(
  explicit: SkillsTargetName[] | undefined,
  config: AgentKitConfig | null,
): SkillsTargetName[] {
  if (explicit) return explicit;

  const configured = config?.targets;
  if (configured) {
    if (configured.length === 0) {
      logger.warn(
        "agentKit.targets is set to an empty array — no skill targets will be synced. Remove the field to fall back to the default (claude).",
      );
    }
    return configured;
  }

  return [...DEFAULT_SKILLS_TARGETS];
}

/**
 * Apply the `agentKit.pick` allowlist to a list of discovered packages.
 *
 * When `pick` is set, only packages keyed in the map are included; others
 * are dropped wholesale. Per-package rules:
 *
 * - `true` → include all of the package's skills.
 * - `string[]` → include only skills whose source folder name matches. The
 *   package is dropped if none of its skills match.
 *
 * Returns `packages` unchanged when `pick` is undefined.
 */
function applyPickFilter(
  packages: ScannedSkillPackage[],
  pick: AgentKitConfig["pick"],
): ScannedSkillPackage[] {
  if (!pick) return packages;

  const result: ScannedSkillPackage[] = [];
  for (const pkg of packages) {
    const rule = pick[pkg.pkg];
    if (rule === undefined) continue; // not picked → excluded
    if (rule === true) {
      result.push(pkg);
    } else if (Array.isArray(rule)) {
      const includedNames = new Set(rule);
      const kept = pkg.skills.filter((skill) => includedNames.has(skill.name));
      if (kept.length === 0) continue;
      result.push({ ...pkg, skills: kept });
    }
  }
  return result;
}

/**
 * Apply the `agentKit.omit` filter to a list of discovered packages.
 *
 * - Drops any package whose name is keyed to `true` in the omit map.
 * - For packages keyed to a `string[]`, filters their skills to exclude
 *   entries whose `name` matches one of the listed source skill folder
 *   names. Packages with no remaining skills after filtering are dropped.
 * - Packages not mentioned in the omit map pass through untouched.
 */
function applyOmitFilter(
  packages: ScannedSkillPackage[],
  omit: AgentKitConfig["omit"],
): ScannedSkillPackage[] {
  if (!omit) return packages;

  const result: ScannedSkillPackage[] = [];
  for (const pkg of packages) {
    const rule = omit[pkg.pkg];
    if (rule === true) continue; // whole package omitted
    if (Array.isArray(rule)) {
      const excludedNames = new Set(rule);
      const remaining = pkg.skills.filter(
        (skill) => !excludedNames.has(skill.name),
      );
      if (remaining.length === 0) continue;
      result.push({ ...pkg, skills: remaining });
    } else {
      result.push(pkg);
    }
  }
  return result;
}

type ExportContext = {
  /** Map of flatName → owning package name, mutated as we write. */
  writtenForTarget: Map<string, string>;
  /** When true, replace user-authored folders instead of skipping them. */
  override: boolean;
};

type ExportTally = {
  exported: number;
  skipped: number;
};

/**
 * Copy every skill folder from a package into the target directory, using a
 * flat folder name derived from `<pkg-slug>-<skill-path>`.
 *
 * Claude Code only discovers skills at the top level of `.claude/skills/` —
 * nested folders are silently ignored — so the destination is always flat.
 * The SKILL.md frontmatter `name:` field is **not consulted**; folder name is
 * the source of truth for invocation (see {@link deriveSlugForSkill}).
 *
 * Two collision modes are handled here:
 *
 * - **User-authored destination** (folder exists, no sentinel): skip and
 *   warn by default; with `override: true`, the folder is removed first and
 *   replaced.
 * - **Two packages producing the same destination slug**: throws — that
 *   means two distinct npm packages slugified identically, which is a real
 *   conflict the user must resolve.
 */
async function exportPackageSkills(
  pkg: ScannedSkillPackage,
  targetDir: string,
  ctx: ExportContext,
): Promise<ExportTally> {
  let exported = 0;
  let skipped = 0;

  for (const skill of pkg.skills) {
    const sourceDir = resolve(pkg.pkgDir, skill.path);
    if (!(await isDirectory(sourceDir))) continue;

    const flatName = deriveSlugForSkill(pkg.pkg, skill);

    const owner = ctx.writtenForTarget.get(flatName);
    if (owner && owner !== pkg.pkg) {
      throw new Error(
        `Skill destination collision: packages "${owner}" and "${pkg.pkg}" both produce the slug "${flatName}". Rename a skill folder in one of them.`,
      );
    }

    const destDir = resolve(targetDir, flatName);
    if (await isUserAuthored(destDir)) {
      if (!ctx.override) {
        logger.warn(
          `Skipping "${flatName}": destination exists and is not managed by agent-kit. Pass --override to replace it.`,
        );
        skipped++;
        continue;
      }
      await rm(destDir, { recursive: true, force: true });
    }

    await mkdir(destDir, { recursive: true });
    await cp(sourceDir, destDir, { recursive: true });
    await writeFile(resolve(destDir, MANAGED_SENTINEL), "", "utf8");
    ctx.writtenForTarget.set(flatName, pkg.pkg);
    exported++;
  }

  return { exported, skipped };
}

/**
 * Returns `true` if the destination directory exists but is NOT one of ours
 * (no `.agent-kit-managed` sentinel inside). Such directories are presumed
 * user-authored and protected from accidental overwrite.
 */
async function isUserAuthored(destDir: string): Promise<boolean> {
  if (!(await isDirectory(destDir))) return false;
  try {
    await access(resolve(destDir, MANAGED_SENTINEL));
    return false; // sentinel present → we own this dir
  } catch {
    return true;
  }
}

/**
 * Recursively walk `targetDir` and delete every directory that contains the
 * managed sentinel. Returns the count of directories pruned. Skips silently
 * when `targetDir` does not exist.
 */
async function pruneManagedDirs(targetDir: string): Promise<number> {
  if (!(await isDirectory(targetDir))) return 0;

  let pruned = 0;
  const stack: string[] = [targetDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true });

    let isManaged = false;
    for (const entry of entries) {
      if (entry.isFile() && entry.name === MANAGED_SENTINEL) {
        isManaged = true;
        break;
      }
    }

    if (isManaged) {
      await rm(current, { recursive: true, force: true });
      pruned++;
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(resolve(current, entry.name));
      }
    }
  }

  return pruned;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
