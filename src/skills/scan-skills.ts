import type { Dirent } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { resolve } from "pathe";
import { readTextFile } from "../utils/file-io";

/** Default directory name searched during auto-discovery. */
export const DEFAULT_SKILLS_DIRNAME = "skills";

/**
 * Manifest files tried, in order. The first one that exists wins.
 *
 * `_package.json` support is a convenience for monorepo dev workflows that
 * temporarily rename `package.json` → `_package.json` to disable a workspace
 * during development. Published packages always use `package.json`, so the
 * fallback is invisible in real npm scenarios.
 */
export const MANIFEST_FILENAMES = ["package.json", "_package.json"] as const;

/**
 * Single skill entry discovered inside a package.
 */
export type SkillEntry = {
  /** Name relative to the package's `skills/` folder (may include `/` for nested). */
  name: string;
  /** Path to the skill directory, relative to the package root. */
  path: string;
};

/**
 * Result of scanning a single package directory for skills.
 */
export type ScannedSkillPackage = {
  /** The fully-qualified package name (e.g. "@warlock.js/cascade"). */
  pkg: string;
  /** Absolute path to the package directory inside node_modules. */
  pkgDir: string;
  /** Skill entries auto-discovered inside `<pkgDir>/skills/`. */
  skills: SkillEntry[];
};

/**
 * Walk `node_modules/` (top-level + every `@scope/`) and return every package
 * whose `skills/` folder contains discoverable skills.
 *
 * Returns an empty array when `node_modules/` does not exist — callers can
 * treat that as "fresh project, nothing to sync".
 *
 * @example
 * ```typescript
 * const packages = await scanForSkillPackages("/project/node_modules");
 * for (const pkg of packages) {
 *   console.log(`${pkg.pkg} ships ${pkg.skills.length} skill(s)`);
 * }
 * ```
 */
export async function scanForSkillPackages(
  nodeModulesPath: string,
): Promise<ScannedSkillPackage[]> {
  const entries = await safeReaddir(nodeModulesPath);
  const results: ScannedSkillPackage[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const entryPath = resolve(nodeModulesPath, entry);

    if (entry.startsWith("@")) {
      // Scoped — descend one level
      const scoped = await safeReaddir(entryPath);
      for (const scopedEntry of scoped) {
        if (scopedEntry.startsWith(".")) continue;
        const pkgDir = resolve(entryPath, scopedEntry);
        const scanned = await scanPackageDir(pkgDir);
        if (scanned) results.push(scanned);
      }
    } else {
      const scanned = await scanPackageDir(entryPath);
      if (scanned) results.push(scanned);
    }
  }

  return results;
}

/**
 * Scan a single package directory for skills via auto-discovery of
 * `<pkgDir>/skills/`.
 *
 * Skills are discovered by walking `skills/` for any directory containing a
 * `SKILL.md` file. See {@link autoDiscoverSkills} for layout details.
 *
 * Returns `null` when the package has no valid `name`, no readable manifest,
 * or no discoverable skills.
 */
export async function scanPackageDir(
  pkgDir: string,
): Promise<ScannedSkillPackage | null> {
  const content = await readPackageManifest(pkgDir);
  if (content === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  const name = parsed.name;
  if (typeof name !== "string") return null;

  const discovered = await autoDiscoverSkills(pkgDir, name);
  if (discovered.length === 0) return null;

  return { pkg: name, pkgDir, skills: discovered };
}

/**
 * Read a package's manifest file, trying each name in {@link MANIFEST_FILENAMES}.
 *
 * Returns the first manifest file content found, or `null` if no manifest
 * exists in the directory.
 */
async function readPackageManifest(pkgDir: string): Promise<string | null> {
  for (const filename of MANIFEST_FILENAMES) {
    const content = await readTextFile(resolve(pkgDir, filename));
    if (content !== null) return content;
  }
  return null;
}

/**
 * Look for skills inside `<pkgDir>/skills/`. Supports three layouts:
 *
 * **Single-skill (root layout):** `skills/SKILL.md` exists at the top of the
 * `skills/` folder. The whole `skills/` directory is treated as one skill;
 * the skill is named after the last segment of the package name. Sibling
 * content like `subskills/` is copied alongside.
 *
 * **Flat multi-skill:** each immediate subdirectory of `skills/` that contains
 * its own `SKILL.md` becomes a separate skill, named after the subdirectory.
 *
 * **Nested multi-skill:** subdirectories *of subdirectories* can also contain
 * `SKILL.md` — `skills/backend/auth/SKILL.md`, `skills/frontend/page/SKILL.md`,
 * etc. The skill name uses the path relative to `skills/` (e.g. `backend/auth`);
 * slug derivation later flattens this to `backend-auth` for Claude's flat
 * destination requirement. This unblocks teams that want to organize their
 * skills by domain (per [#10238](https://github.com/anthropics/claude-code/issues/10238)).
 *
 * A directory that contains `SKILL.md` is treated as a leaf — we don't recurse
 * into it. So `skills/backend/SKILL.md` + `skills/backend/auth/SKILL.md` would
 * yield only `backend` as a skill (with `auth/` treated as supporting content
 * inside it). This matches the warlock-style "root + subskills" convention.
 *
 * Root layout (Pattern A) wins when both root SKILL.md and subdirs exist.
 *
 * Hidden directories (dotfile names) are skipped so we don't pick up
 * `.git`-style artifacts.
 */
export async function autoDiscoverSkills(
  pkgDir: string,
  pkgName?: string,
): Promise<SkillEntry[]> {
  const skillsRoot = resolve(pkgDir, DEFAULT_SKILLS_DIRNAME);

  // Pattern A — single root skill at <skillsRoot>/SKILL.md
  if (await fileExists(resolve(skillsRoot, "SKILL.md"))) {
    return [
      {
        name: deriveRootSkillName(pkgName),
        path: `./${DEFAULT_SKILLS_DIRNAME}`,
      },
    ];
  }

  // Pattern B — recursive walk for any nested SKILL.md
  return walkForNestedSkills(skillsRoot, []);
}

/**
 * Recursively walk a directory tree looking for `SKILL.md` files.
 *
 * A directory containing `SKILL.md` is a skill leaf — we record it and stop
 * recursing into it (so nested skills don't double-count and so warlock-style
 * `subskills/` content isn't promoted to separate skills).
 *
 * Returns an `SkillEntry` for each discovered skill, where `name` is the path
 * segments joined by `/` relative to the starting directory (e.g.
 * `backend/auth`) and `path` is the relative POSIX path from the package root
 * (e.g. `./skills/backend/auth`).
 */
async function walkForNestedSkills(
  currentDir: string,
  segments: string[],
): Promise<SkillEntry[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Sort so the walk order (and resulting skill order) is stable across
  // filesystems — `readdir` order differs between Linux and Windows.
  entries.sort((a, b) => a.name.localeCompare(b.name));

  // Leaf: this directory IS a skill (has SKILL.md) and we're below the root
  const hasSkillMd = entries.some(
    (entry) => entry.isFile() && entry.name === "SKILL.md",
  );
  if (hasSkillMd && segments.length > 0) {
    const relPath = segments.join("/");
    return [
      {
        name: relPath,
        path: `./${DEFAULT_SKILLS_DIRNAME}/${relPath}`,
      },
    ];
  }

  // Not a leaf: keep walking into subdirectories
  const found: SkillEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const childDir = resolve(currentDir, entry.name);
    const childResults = await walkForNestedSkills(childDir, [
      ...segments,
      entry.name,
    ]);
    found.push(...childResults);
  }
  return found;
}

/**
 * Derive the skill name for a Pattern-A (single-root) package.
 *
 * Uses the last segment of the package name when available — `@warlock.js/ai`
 * becomes `ai`, `foo-bar` stays `foo-bar`. Falls back to `default` when no
 * package name is supplied, since we still need a directory name.
 */
function deriveRootSkillName(pkgName: string | undefined): string {
  if (!pkgName) return "default";
  const parts = pkgName.split("/");
  return parts[parts.length - 1] ?? "default";
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan the project root's own package for skills. The root project can ship
 * skills the same way a library does — drop a `skills/` folder at the root
 * and they'll be discovered.
 */
export async function scanLocalPackage(
  projectRoot: string,
): Promise<ScannedSkillPackage | null> {
  return scanPackageDir(projectRoot);
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    // Sort so discovery order is stable across filesystems — `readdir` returns
    // entries in directory order, which differs between Linux (ext4) and
    // Windows (NTFS). Sorting keeps results deterministic everywhere.
    return (await readdir(dir)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
