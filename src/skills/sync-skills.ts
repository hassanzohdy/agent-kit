import type { Dirent } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "pathe";
import {
  type AgentKitConfig,
  loadAgentKitConfig,
} from "../config/agent-kit-config";
import { resolveMonorepoProjects } from "../monorepo/resolve-projects";
import { type ProjectScanResult, scanProjects } from "../monorepo/scan-project";
import type { SkillsTargetName, SyncSkillsOptions } from "../types";
import { logger } from "../utils/logger";
import { applyOmitFilter, applyPickFilter } from "./filters";
import {
  deriveSlugForSkill,
  resolveProjectPrefix,
  rewriteSkillName,
} from "./resolve-flat-name";
import { rewriteExportedMarkdown, type ExportedSkill } from "./rewrite-skill-links";
import {
  type ScannedSkillPackage,
  type SkillEntry,
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
  /** Slugs of the monorepo projects that were aggregated (empty when none). */
  projects: string[];
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

  // Explicit option wins over config; config supplies the persistent default.
  const projectPatterns = options.projects ?? config?.monorepo?.projects;
  const resolvedProjects = await resolveMonorepoProjects(
    options.root,
    projectPatterns,
  );

  // Scan root paths + the project's own package + every monorepo project, all
  // in parallel.
  const [rootScanResults, projectScans] = await Promise.all([
    Promise.all([
      ...scannedPaths.map((p) => scanForSkillPackages(p)),
      scanLocalPackage(options.root),
    ]),
    scanProjects(resolvedProjects),
  ]);
  const localSkills = rootScanResults.pop() as ScannedSkillPackage | null;
  // The project's own skills use the project prefix, not the raw package name.
  if (localSkills) {
    localSkills.pkg = resolveProjectPrefix(
      localSkills.pkg,
      config?.projectPrefix,
    );
  }

  // Flatten + dedupe by package name. Later scan-roots win, so a package
  // present in both node_modules and a user-provided scanPath gets the
  // scanPath copy (local override semantics).
  const byName = new Map<string, ScannedSkillPackage>();
  for (const scanned of rootScanResults as ScannedSkillPackage[][]) {
    for (const pkg of scanned) {
      byName.set(pkg.pkg, pkg);
    }
  }
  if (localSkills) byName.set(localSkills.pkg, localSkills);
  const discoveredPackages = [...byName.values()];

  // Apply the ROOT pick/omit to the ROOT-discovered packages only. pick runs
  // first (allowlist) so omit can further trim what pick allowed through.
  const picked = applyPickFilter(discoveredPackages, config?.pick);
  if (
    config?.pick !== undefined &&
    picked.length === 0 &&
    resolvedProjects.length === 0
  ) {
    logger.warn(
      "agentKit.pick matched no installed packages. No skills will be synced. Check the package names against what's actually in node_modules.",
    );
  }
  const rootFiltered = applyOmitFilter(picked, config?.omit);

  // Merge root packages with every project's contribution, then apply the
  // root's omit once more as a global veto across the whole aggregate.
  const allPackages = mergeProjectContributions(
    rootFiltered,
    projectScans,
    config?.omit,
  );

  let exported = 0;
  let pruned = 0;
  let skipped = 0;

  for (const target of targets) {
    const targetDir = resolve(options.root, getSkillsTargetPath(target));
    pruned += await pruneManagedDirs(targetDir);

    // Track destination slugs we've already written for this target so a
    // second package producing the same destination is detected loudly,
    // not silently clobbered.
    const writtenForTarget = new Map<string, WrittenSkill>(); // flatName → source

    const exportedSkills: ExportedSkill[] = [];
    const manifest = new Map<string, ExportedSkill>();

    for (const pkg of allPackages) {
      const result = await exportPackageSkills(pkg, targetDir, {
        writtenForTarget,
        override: options.override ?? false,
        exportedSkills,
        manifest,
      });
      exported += result.exported;
      skipped += result.skipped;
    }

    await rewriteExportedMarkdown(exportedSkills, manifest);
  }

  return {
    exported,
    pruned,
    skipped,
    targets,
    packages: allPackages.map((p) => p.pkg),
    scannedPaths,
    projects: resolvedProjects.map((p) => p.slug),
  };
}

/**
 * Merge the root-discovered packages with every monorepo project's
 * contribution into the final export list (see {@link ProjectScanResult}).
 *
 * - **Authored** project skills are keyed uniquely (by project slug), so a
 *   project's `skills/` never dedupe-collides with a dependency that happens
 *   to share the slug — and `backend` vs `frontend` stay separate.
 * - **Dependency** skills dedupe by package name across root + all projects:
 *   a shared dependency yields **one** copy, and its skill set is the *union*
 *   of what each scope kept (a skill survives if any scope kept it). The first
 *   scope's `pkgDir` is the export source — fine because the same package is
 *   installed identically in each scope (modulo rare intra-repo version skew,
 *   where a skill missing from the chosen source is simply skipped at export).
 * - Finally the root's `omit` is re-applied as a global veto so the root can
 *   ban a dependency repo-wide regardless of what a project kept. (Re-applying
 *   to already-omitted root packages is idempotent.)
 */
function mergeProjectContributions(
  rootFiltered: ScannedSkillPackage[],
  projectScans: ProjectScanResult[],
  rootOmit: AgentKitConfig["omit"],
): ScannedSkillPackage[] {
  const merged = new Map<string, ScannedSkillPackage>();
  for (const pkg of rootFiltered) merged.set(pkg.pkg, pkg);

  for (const scan of projectScans) {
    if (scan.authored) {
      // Null-prefixed key can never equal a real package name, so authored
      // skills are isolated from dependency dedupe.
      merged.set(` authored:${scan.project.slug}`, scan.authored);
    }
    for (const dep of scan.dependencies) {
      const existing = merged.get(dep.pkg);
      merged.set(
        dep.pkg,
        existing
          ? { ...existing, skills: unionSkills(existing.skills, dep.skills) }
          : dep,
      );
    }
  }

  return applyOmitFilter([...merged.values()], rootOmit);
}

/**
 * Union two skill lists by skill `name`, keeping the first occurrence (and
 * thus its source `path`/`pkgDir`) when both lists carry the same name.
 */
function unionSkills(a: SkillEntry[], b: SkillEntry[]): SkillEntry[] {
  const byName = new Map<string, SkillEntry>();
  for (const skill of a) byName.set(skill.name, skill);
  for (const skill of b) if (!byName.has(skill.name)) byName.set(skill.name, skill);
  return [...byName.values()];
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

type WrittenSkill = { pkg: string; sourceDir: string };

type ExportContext = {
  /** Map of flatName → owning package name, mutated as we write. */
  writtenForTarget: Map<string, WrittenSkill>;
  /** When true, replace user-authored folders instead of skipping them. */
  override: boolean;
  exportedSkills: ExportedSkill[];
  manifest: Map<string, ExportedSkill>;
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

    if (await containsUnsafeSymlink(sourceDir, resolve(pkg.pkgDir))) {
      logger.warn(
        `Skipping "${flatName}" from package "${pkg.pkg}": its skill source contains a symlink that resolves outside the package. Refusing to copy it (possible supply-chain tampering).`,
      );
      skipped++;
      continue;
    }

    const owner = ctx.writtenForTarget.get(flatName);
    if (owner) {
      logger.warn(
        `Skill slug collision: "${owner.pkg}" (${owner.sourceDir}) and "${pkg.pkg}" (${sourceDir}) both export as "${flatName}".`,
      );
    }
    if (owner && owner.pkg !== pkg.pkg) {
      throw new Error(
        `Skill destination collision: packages "${owner.pkg}" and "${pkg.pkg}" both produce the slug "${flatName}". Rename a skill folder in one of them.`,
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
    // Windows can create neither a symlink nor a junction in the destination
    // without extra privileges. The preceding guard rejects every link that
    // leaves the package, so copying an allowed internal link's contents is
    // safe and keeps sync usable on a normal Windows developer machine.
    await cp(sourceDir, destDir, {
      recursive: true,
      dereference: process.platform === "win32",
    });
    await writeFile(resolve(destDir, MANAGED_SENTINEL), "", "utf8");
    await rewriteExportedName(resolve(destDir, "SKILL.md"), flatName);
    ctx.writtenForTarget.set(flatName, { pkg: pkg.pkg, sourceDir });
    const exportedSkill = { sourceDir, destDir };
    ctx.exportedSkills.push(exportedSkill);
    ctx.manifest.set(sourceDir, exportedSkill);
    exported++;
  }

  return { exported, skipped };
}



/**
 * Set the exported SKILL.md frontmatter `name:` to the folder slug. Removes the
 * copied file first so a preserved symlink can never write through to the
 * source in node_modules.
 */
async function rewriteExportedName(
  skillFile: string,
  slug: string,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(skillFile, "utf8");
  } catch {
    return;
  }
  const next = rewriteSkillName(content, slug);
  if (next === content) return;
  await rm(skillFile, { force: true });
  await writeFile(skillFile, next, "utf8");
}

/**
 * Returns `true` when `entryPath` — or anything nested inside it — is a
 * symlink whose real target resolves outside `allowedRoot`.
 *
 * `fs.cp({ recursive: true })` does not dereference symlinks by default; it
 * recreates them verbatim at the destination. A malicious/compromised
 * package can ship its `skills/` folder (or a file inside it) as a symlink
 * pointing outside the package (e.g. at `.env`, SSH keys, or any other
 * reachable file). Left unchecked, that symlink would be recreated inside a
 * coding agent's auto-read skills directory (`.claude/skills/`, …), letting
 * the agent transparently read whatever the symlink targets on its next
 * session. We `lstat` every entry (never following symlinks) and reject the
 * whole export whenever one escapes the package root.
 */
async function containsUnsafeSymlink(
  entryPath: string,
  allowedRoot: string,
): Promise<boolean> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(entryPath);
  } catch {
    return true; // Unreadable entry — fail closed.
  }

  if (stats.isSymbolicLink()) {
    try {
      const real = await realpath(entryPath);
      return !isWithinRoot(real, allowedRoot);
    } catch {
      return true; // Broken/unresolvable symlink — fail closed.
    }
  }

  if (!stats.isDirectory()) return false;

  let entries: Dirent[];
  try {
    entries = await readdir(entryPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const childPath = resolve(entryPath, entry.name);
    if (await containsUnsafeSymlink(childPath, allowedRoot)) return true;
  }
  return false;
}

/** Returns `true` when `target` is `root` itself or nested inside it. */
function isWithinRoot(target: string, root: string): boolean {
  const rel = relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
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
