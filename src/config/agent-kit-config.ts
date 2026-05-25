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

  return config;
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
