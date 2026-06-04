import { resolve } from "pathe";
import { loadAgentKitConfig } from "../config/agent-kit-config";
import { applyOmitFilter, applyPickFilter } from "../skills/filters";
import {
  type ScannedSkillPackage,
  autoDiscoverSkills,
  scanForSkillPackages,
} from "../skills/scan-skills";
import type { ResolvedProject } from "./resolve-projects";

/**
 * The skill contribution of a single monorepo project, split into the two
 * kinds that merge differently up at the root:
 *
 * - `authored` — the project's own `skills/` folder, keyed by the project
 *   directory slug (e.g. `backend`) so two projects never collide. Always
 *   included (a project's own skills are never filtered out by `pick`/`omit`).
 * - `dependencies` — packages from the project's `node_modules/`, already
 *   filtered by **that project's** `agentKit.pick`/`omit`. These dedupe by
 *   package name across projects at the root (shared deps → one copy).
 */
export type ProjectScanResult = {
  project: ResolvedProject;
  authored: ScannedSkillPackage | null;
  dependencies: ScannedSkillPackage[];
};

/**
 * Scan one monorepo project *as its own project*: discover its authored
 * `skills/` and its `node_modules/` dependency skills, applying the project's
 * own `agentKit` config to the latter.
 *
 * The project's `targets` and `monorepo` config are intentionally ignored —
 * only `pick`/`omit` shape what this project contributes. Aggregation never
 * recurses into a project's own `monorepo.projects`.
 */
export async function scanProject(
  project: ResolvedProject,
): Promise<ProjectScanResult> {
  const config = await loadAgentKitConfig(project.dir);

  // Authored skills: the project's own skills/ folder, prefixed by the project
  // directory slug. We reuse autoDiscoverSkills with the slug as the "package
  // name" so root/flat/nested layouts all derive the right destination
  // (`backend`, `backend-code-standards`, `backend-backend-auth`, …).
  const authoredSkills = await autoDiscoverSkills(project.dir, project.slug);
  const authored: ScannedSkillPackage | null =
    authoredSkills.length > 0
      ? { pkg: project.slug, pkgDir: project.dir, skills: authoredSkills }
      : null;

  // Dependency skills: scan the project's own node_modules, then apply the
  // project's own pick (allowlist) and omit (denylist).
  const nodeModules = resolve(project.dir, "node_modules");
  const scanned = await scanForSkillPackages(nodeModules);
  const dependencies = applyOmitFilter(
    applyPickFilter(scanned, config?.pick),
    config?.omit,
  );

  return { project, authored, dependencies };
}

/** Scan every resolved project in parallel. */
export async function scanProjects(
  projects: ResolvedProject[],
): Promise<ProjectScanResult[]> {
  return Promise.all(projects.map(scanProject));
}
