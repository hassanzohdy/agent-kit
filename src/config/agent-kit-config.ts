import { resolve } from "pathe";
import { MANIFEST_FILENAMES } from "../skills/scan-skills";
import type { SkillsTargetName } from "../types";
import { readTextFile } from "../utils/file-io";

/**
 * Project-level configuration for agent-kit, read from the `agentKit` field
 * of the project root's `package.json` (or `_package.json` fallback).
 *
 * @example
 * ```json
 * {
 *   "agentKit": {
 *     "targets": ["claude", "cursor"],
 *     "pick": {
 *       "@warlock.js/core": true,
 *       "@my-org/lib": ["only-this-skill"]
 *     },
 *     "omit": {
 *       "@warlock.js/core": ["add-connector"]
 *     },
 *     "monorepo": {
 *       "projects": ["backend", "frontend"]
 *     }
 *   }
 * }
 * ```
 */
export type AgentKitConfig = {
  /**
   * Default skill-sync targets. When set, becomes the default for `agent-kit
   * sync` (the CLI `--target` flag still overrides). When set to an empty
   * array, `agent-kit` warns the user and syncs zero targets — that's
   * almost certainly a misconfiguration, but we respect the explicit intent.
   */
  targets?: SkillsTargetName[];
  /**
   * Per-package skill **allowlist** (opposite of {@link omit}). Map keys are
   * package names (exact match).
   *
   * When set, ONLY packages keyed in `pick` are included. Packages not listed
   * are excluded from sync entirely.
   *
   * - `true` → include the whole package's skills.
   * - `string[]` → include only specific skills by their **source folder
   *   name** (e.g. `"add-connector"` to include just that one from
   *   `@warlock.js/core`).
   *
   * If both `pick` and `omit` are set, `pick` runs first to allowlist
   * packages, then `omit` removes specific skills from what survived.
   */
  pick?: Record<string, true | string[]>;
  /**
   * Per-package skill exclusions (denylist). Map keys are package names
   * (exact match).
   *
   * - `true` → omit the entire package (none of its skills are synced).
   * - `string[]` → omit specific skills by their **source folder name**
   *   (e.g. `"add-connector"` to exclude `@warlock.js/core/skills/add-connector/`).
   *   Other skills from the same package still sync normally.
   *
   * Runs AFTER {@link pick} when both are set.
   */
  omit?: Record<string, true | string[]>;
  /**
   * Monorepo aggregation. When `projects` is set, `agent-kit sync` (run at the
   * repo root) also scans each listed project *as its own project* and merges
   * the results up into the root's skill directories:
   *
   * - Each project's `node_modules/` dependency skills are filtered by **that
   *   project's own** `agentKit.pick`/`omit` (read from its `package.json`).
   * - Each project's authored `skills/` folder is exported with the **project
   *   directory name** as the slug prefix (`backend/skills/code-standards` →
   *   `backend-code-standards`), so two projects can ship a same-named skill
   *   without colliding.
   *
   * Entries are paths relative to the repo root (or absolute), and may be a
   * one-level glob — `apps/*` expands to every immediate subdirectory of
   * `apps/`. Shared dependencies across projects are deduped to one copy
   * (skill content is the same documentation regardless of which project
   * pulled it in); the root's own `agentKit.omit` applies as a final global
   * veto over everything aggregated.
   *
   * `targets` and `monorepo` from a *project's* config are ignored during
   * aggregation — only its `pick`/`omit` matter. Aggregation does not recurse:
   * a project's own `monorepo.projects` is not followed.
   */
  monorepo?: {
    projects?: string[];
  };
};

/** Sentinel value distinguishing "config field missing" from "field is null". */
type ConfigResolution =
  | { kind: "missing" }
  | { kind: "found"; config: AgentKitConfig };

/**
 * Read the `agentKit` field from the project root's manifest.
 *
 * Returns `null` when no manifest exists, when the manifest is unparseable,
 * or when no `agentKit` field is present. Invalid sub-fields (wrong types)
 * are silently dropped so a malformed value doesn't crash the sync.
 */
export async function loadAgentKitConfig(
  projectRoot: string,
): Promise<AgentKitConfig | null> {
  const resolution = await readManifestAgentKitField(projectRoot);
  if (resolution.kind === "missing") return null;
  return resolution.config;
}

async function readManifestAgentKitField(
  projectRoot: string,
): Promise<ConfigResolution> {
  for (const filename of MANIFEST_FILENAMES) {
    const content = await readTextFile(resolve(projectRoot, filename));
    if (content === null) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { kind: "missing" };
    }

    if (!isRecord(parsed)) return { kind: "missing" };
    const raw = parsed.agentKit;
    if (!isRecord(raw)) return { kind: "missing" };

    return { kind: "found", config: normalizeAgentKitConfig(raw) };
  }
  return { kind: "missing" };
}

/**
 * Coerce a raw record from package.json into a typed `AgentKitConfig`,
 * dropping any fields that fail validation rather than throwing. This keeps
 * a malformed config from blocking the entire sync.
 */
function normalizeAgentKitConfig(raw: Record<string, unknown>): AgentKitConfig {
  const config: AgentKitConfig = {};

  const targets = raw.targets;
  if (Array.isArray(targets)) {
    config.targets = targets.filter(
      (entry): entry is SkillsTargetName => typeof entry === "string",
    );
  }

  const pick = normalizePackageRuleMap(raw.pick);
  if (pick !== null) config.pick = pick;

  const omit = normalizePackageRuleMap(raw.omit);
  if (omit !== null) config.omit = omit;

  const monorepo = normalizeMonorepo(raw.monorepo);
  if (monorepo !== null) config.monorepo = monorepo;

  return config;
}

/**
 * Validate the `agentKit.monorepo` block. Currently the only field is
 * `projects` (a `string[]` of project paths / one-level globs). Non-string
 * entries are dropped; a missing or malformed block yields `null` so the
 * property stays unset on the result.
 */
function normalizeMonorepo(
  raw: unknown,
): AgentKitConfig["monorepo"] | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.projects)) return null;
  const projects = raw.projects.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return { projects };
}

/**
 * Validate a `Record<string, true | string[]>` field (`pick` or `omit`).
 *
 * Returns the normalized map when the field is present and non-empty after
 * filtering. Returns `null` when the field is absent or every entry was
 * malformed (so callers know to leave the property unset on the result).
 *
 * Special case: an empty object literal `{}` is preserved as `{}` rather than
 * dropped — that signals "user explicitly opted out of everything" and gets
 * handled (with a warning) downstream in the sync flow.
 */
function normalizePackageRuleMap(
  raw: unknown,
): Record<string, true | string[]> | null {
  if (!isRecord(raw)) return null;

  const normalized: Record<string, true | string[]> = {};
  for (const [pkg, value] of Object.entries(raw)) {
    if (value === true) {
      normalized[pkg] = true;
    } else if (Array.isArray(value)) {
      const names = value.filter(
        (entry): entry is string => typeof entry === "string",
      );
      if (names.length > 0) normalized[pkg] = names;
    }
  }

  // Distinguish "explicitly empty {}" (user opted out) from "all entries
  // were malformed" (we should treat as unset).
  if (Object.keys(normalized).length === 0 && Object.keys(raw).length > 0) {
    return null;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
