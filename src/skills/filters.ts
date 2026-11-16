import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "pathe";
import type { AgentKitConfig } from "../config/agent-kit-config";
import { readTextFile } from "../utils/file-io";
import { logger } from "../utils/logger";
import { MANIFEST_FILENAMES, type ScannedSkillPackage } from "./scan-skills";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Read the package names a project declares in its manifest's `dependencies`,
 * `devDependencies`, `peerDependencies` and `optionalDependencies`. Returns
 * `null` when the manifest is missing or unparseable.
 */
export async function readDeclaredDependencies(
  projectDir: string,
): Promise<Set<string> | null> {
  for (const filename of MANIFEST_FILENAMES) {
    const content = await readTextFile(resolve(projectDir, filename));
    if (content === null) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;

    const names = new Set<string>();
    for (const field of DEPENDENCY_FIELDS) {
      const map = (parsed as Record<string, unknown>)[field];
      if (typeof map !== "object" || map === null || Array.isArray(map)) continue;
      for (const name of Object.keys(map)) names.add(name);
    }
    return names;
  }

  return null;
}

/**
 * The name a package is installed under: its folder below `node_modules/`
 * (`<name>` or `@scope/<name>`). This is the key the project wrote in its
 * manifest (an `npm:` alias installs under the alias), and unlike the
 * manifest `name` a package cannot choose it for itself.
 */
function installedName(pkgDir: string): string {
  const folder = pkgDir.replace(/\\/g, "/").split("/").slice(-2);
  return folder[0]?.startsWith("@") ? folder.join("/") : (folder[1] ?? "");
}

/**
 * Keep only packages the project declares as its own dependencies, matched by
 * the folder they are installed in under `node_modules/`. The manifest `name`
 * is not trusted: a hoisted transitive package could claim the name of a
 * declared one. Packages whose directory is in `localPackageDirs` (workspace
 * or `file:` packages that live inside the project) are kept too.
 */
export function applyDirectDependencyFilter(
  packages: ScannedSkillPackage[],
  declared: ReadonlySet<string>,
  localPackageDirs: ReadonlySet<string> = new Set(),
): ScannedSkillPackage[] {
  return packages.filter(
    (pkg) =>
      declared.has(installedName(pkg.pkgDir)) ||
      localPackageDirs.has(pkg.pkgDir),
  );
}

/**
 * True when `pkgDir` resolves (through symlinks) to a folder inside
 * `projectDir` that is not inside any `node_modules/`: a workspace or `file:`
 * package, which is the project's own code.
 */
async function isLocalPackage(
  pkgDir: string,
  realProjectDir: string,
): Promise<boolean> {
  let real: string;
  try {
    real = await realpath(pkgDir);
  } catch {
    return false;
  }
  const rel = relative(realProjectDir, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return false;
  return !rel.split("/").includes("node_modules");
}

/**
 * Apply the default direct-dependency restriction to the packages scanned in
 * `projectDir/node_modules`: keep the declared dependencies and the project's
 * own workspace / `file:` packages. With no readable manifest nothing is
 * declared, so only local packages survive; a warning says why.
 */
export async function filterToDirectDependencies(
  packages: ScannedSkillPackage[],
  projectDir: string,
): Promise<ScannedSkillPackage[]> {
  const declared = await readDeclaredDependencies(projectDir);

  let realProjectDir = projectDir;
  try {
    realProjectDir = await realpath(projectDir);
  } catch {
    // keep the given path
  }

  const localPackageDirs = new Set<string>();
  for (const pkg of packages) {
    if (await isLocalPackage(pkg.pkgDir, realProjectDir)) {
      localPackageDirs.add(pkg.pkgDir);
    }
  }

  const kept = applyDirectDependencyFilter(
    packages,
    declared ?? new Set(),
    localPackageDirs,
  );

  if (declared === null && kept.length < packages.length) {
    logger.warn(
      `No readable package.json in ${projectDir}, so no dependency is declared: skipped skills from ${packages.length - kept.length} package(s) in node_modules. Fix the manifest, or set "agentKit": { "includeTransitive": true }.`,
    );
  }

  return kept;
}

/**
 * True when the default direct-dependency restriction applies: no `pick`
 * allowlist is set and `includeTransitive` is not enabled.
 */
export function restrictsToDirectDependencies(
  config: AgentKitConfig | null | undefined,
): boolean {
  return config?.pick === undefined && config?.includeTransitive !== true;
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
 * Returns `packages` unchanged when `pick` is undefined (the direct-dependency
 * restriction, see {@link applyDirectDependencyFilter}, is applied separately).
 *
 * A package under `node_modules/` is matched by the folder it is installed in,
 * not by the `name` in its own manifest, so a hoisted package cannot claim a
 * picked name. Packages from `--path` roots keep matching by manifest name.
 */
export function applyPickFilter(
  packages: ScannedSkillPackage[],
  pick: AgentKitConfig["pick"],
): ScannedSkillPackage[] {
  if (!pick) return packages;

  const result: ScannedSkillPackage[] = [];
  for (const pkg of packages) {
    const key = /[\\/]node_modules[\\/]/.test(pkg.pkgDir)
      ? installedName(pkg.pkgDir)
      : pkg.pkg;
    const rule = pick[key];
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
export function applyOmitFilter(
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
