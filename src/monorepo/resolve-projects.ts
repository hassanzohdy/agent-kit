import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "pathe";

/**
 * A monorepo project resolved from a config pattern into a concrete directory
 * plus the slug used to prefix that project's authored skills.
 */
export type ResolvedProject = {
  /** Absolute path to the project directory. */
  dir: string;
  /**
   * Slug prefix for the project's **authored** `skills/` folder, derived from
   * the project's path relative to the repo root (`backend` → `backend`,
   * `apps/admin` → `apps-admin`). Two projects can therefore ship a same-named
   * skill (`code-standards`) without colliding — they become
   * `backend-code-standards` and `apps-admin-code-standards`.
   */
  slug: string;
};

/**
 * Expand a list of monorepo project patterns into concrete project
 * directories.
 *
 * Each pattern is one of:
 * - **A literal path** (`backend`, `apps/admin`) — resolved relative to `root`
 *   (absolute paths are used as-is) and kept only if it is an existing
 *   directory.
 * - **A one-level glob** (`apps/*`, `packages/*`, or bare `*`) — the segment
 *   before the trailing `*` is read, and every immediate subdirectory becomes
 *   a project. Hidden dirs and `node_modules` are skipped.
 *
 * Multi-level or mid-path globs (deep `apps` stars, `a/<x>/b`) are
 * intentionally unsupported — they invite surprise scope on large repos. A
 * pattern with a `*` anywhere other than a single trailing segment yields no
 * matches.
 *
 * Results are de-duplicated by absolute path and never include `root` itself.
 */
export async function resolveMonorepoProjects(
  root: string,
  patterns: string[] | undefined,
): Promise<ResolvedProject[]> {
  if (!patterns || patterns.length === 0) return [];

  const seen = new Set<string>();
  const projects: ResolvedProject[] = [];

  for (const pattern of patterns) {
    for (const dir of await expandPattern(root, pattern)) {
      if (dir === root || seen.has(dir)) continue;
      seen.add(dir);
      projects.push({ dir, slug: slugForProject(root, dir) });
    }
  }

  return projects;
}

/** Resolve one pattern (literal or trailing-`*` glob) to absolute dirs. */
async function expandPattern(root: string, pattern: string): Promise<string[]> {
  if (!pattern.includes("*")) {
    const abs = isAbsolute(pattern) ? pattern : resolve(root, pattern);
    return (await isDirectory(abs)) ? [abs] : [];
  }

  // Only a single trailing `*` is supported (`apps/*`, `*`). Anything else is
  // an unsupported multi-level / mid-path glob → no matches.
  const segments = pattern.split("/");
  const last = segments.pop();
  if (last !== "*" || segments.some((s) => s.includes("*"))) return [];

  const baseRel = segments.join("/");
  const baseDir = baseRel
    ? isAbsolute(baseRel)
      ? baseRel
      : resolve(root, baseRel)
    : root;

  return listChildDirectories(baseDir);
}

/** List immediate subdirectories of `dir`, skipping hidden + `node_modules`. */
async function listChildDirectories(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    dirs.push(resolve(dir, entry.name));
  }
  return dirs;
}

/**
 * Derive the project slug from its path relative to the repo root. Path
 * separators and any non-kebab-safe characters collapse to `-`; the result is
 * lowercased with leading/trailing/repeated dashes trimmed.
 */
function slugForProject(root: string, projectDir: string): string {
  const rel = relative(root, projectDir);
  return rel
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
