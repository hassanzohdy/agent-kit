/**
 * agent-kit
 *
 * Authoring and distribution toolkit for AI coding agent artifacts.
 *
 * - {@link deriveAll} — derive tool-specific instruction files from `AGENTS.md`
 * - {@link syncSkills} — export skills from installed packages into per-agent skill dirs
 * - {@link findProjectRoot} — locate the nearest ancestor with a `package.json`
 *
 * @example
 * ```typescript
 * import { deriveAll, syncSkills, findProjectRoot } from "@mongez/agent-kit";
 *
 * const root = await findProjectRoot();
 * if (!root) throw new Error("No project root");
 *
 * await deriveAll({ root });
 * await syncSkills({ root, targets: ["claude", "cursor"] });
 * ```
 *
 * @packageDocumentation
 */

export {
  buildDerivedContent,
  deriveAll,
} from "./derive/derive";
export {
  DERIVE_TARGETS,
  getDeriveTarget,
  resolveDeriveTargets,
} from "./derive/targets";
export {
  DEFAULT_SKILLS_TARGETS,
  syncSkills,
} from "./skills/sync-skills";
export type { SkillsSyncResult } from "./skills/sync-skills";
export {
  DEFAULT_SKILLS_DIRNAME,
  MANIFEST_FILENAMES,
  autoDiscoverSkills,
  scanForSkillPackages,
  scanLocalPackage,
  scanPackageDir,
} from "./skills/scan-skills";
export type {
  ScannedSkillPackage,
  SkillEntry,
} from "./skills/scan-skills";
export {
  deriveSlugForSkill,
  slugifyPackageName,
} from "./skills/resolve-flat-name";
export { applyOmitFilter, applyPickFilter } from "./skills/filters";
export { resolveMonorepoProjects } from "./monorepo/resolve-projects";
export type { ResolvedProject } from "./monorepo/resolve-projects";
export { scanProject, scanProjects } from "./monorepo/scan-project";
export type { ProjectScanResult } from "./monorepo/scan-project";
export {
  MANAGED_SENTINEL,
  SKILLS_TARGET_PATHS,
  getSkillsTargetPath,
} from "./skills/target-paths";
export { loadAgentKitConfig } from "./config/agent-kit-config";
export type { AgentKitConfig } from "./config/agent-kit-config";
export { findProjectRoot } from "./utils/project-root";
export { readTextFile, writeTextFile } from "./utils/file-io";
export type {
  DeriveOptions,
  DeriveResult,
  DeriveTarget,
  DeriveTargetName,
  SkillsTargetName,
  SyncSkillsOptions,
} from "./types";
