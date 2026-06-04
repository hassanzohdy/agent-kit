import type { AgentKitConfig } from "../config/agent-kit-config";
import type { ScannedSkillPackage } from "./scan-skills";

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
export function applyPickFilter(
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
