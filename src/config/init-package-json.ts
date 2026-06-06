import { resolve } from "pathe";
import { MANIFEST_FILENAMES } from "../skills/scan-skills";
import { SKILLS_TARGET_PATHS } from "../skills/target-paths";
import type { SkillsTargetName } from "../types";
import { readTextFile, writeTextFile } from "../utils/file-io";

/**
 * Mutations `agent-kit init` makes to the project root's `package.json`:
 * seeding `agentKit.targets` and (conditionally) wiring a `postinstall` sync.
 *
 * Both operations are intentionally non-destructive — they round-trip the
 * existing manifest (preserving indentation, trailing newline, and every
 * untouched field) and only write when the content actually changes. A missing
 * or unparseable manifest is a no-op, never a crash: we don't risk mangling a
 * file we can't safely re-serialize.
 */

/** The npm package name whose binary the wired postinstall invokes. */
const AGENT_KIT_PACKAGE = "@mongez/agent-kit";

/** The command written into `scripts.postinstall`. */
const POSTINSTALL_COMMAND = "agent-kit sync";

/** Canonical list of valid skill-sync target names. */
const VALID_TARGETS = Object.keys(SKILLS_TARGET_PATHS) as SkillsTargetName[];

/** What `ensureAgentKitTargets` did to the manifest. */
export type EnsureAgentKitTargetsAction =
  /** No `agentKit` block existed — created one with `targets`. */
  | "created"
  /** `agentKit` existed without `targets` — added `targets` to it. */
  | "added"
  /** `agentKit.targets` existed and was replaced (only with `overwrite`). */
  | "updated"
  /** Nothing was written (targets already present, or manifest unwritable). */
  | "unchanged";

export type EnsureAgentKitTargetsResult = {
  /** Absolute path of the manifest we wrote to, or `null` if none was found. */
  manifestPath: string | null;
  /** The targets now recorded under `agentKit.targets`. */
  targets: SkillsTargetName[];
  /** What happened — drives the CLI log line. */
  action: EnsureAgentKitTargetsAction;
};

export type EnsureAgentKitTargetsOptions = {
  /** Absolute path to the project root (the dir holding `package.json`). */
  root: string;
  /**
   * Targets to record. Defaults to `["claude"]` — the same value as the
   * built-in skills-sync default, made explicit so users can see and edit it.
   */
  targets?: SkillsTargetName[];
  /**
   * Replace an existing `agentKit.targets`. Default `false` — a value the user
   * already set is never clobbered. The CLI sets this to `true` only when the
   * caller passed an explicit `--target`, treating that as deliberate intent.
   */
  overwrite?: boolean;
};

/**
 * Seed (or update) the `agentKit.targets` field in the project root's
 * `package.json`.
 *
 * The skills-sync default has always been `["claude"]`, but it was *implicit* —
 * you had to read the docs to know it, and to know the exact `agentKit` syntax
 * for changing it. Writing the block on `init` makes both visible: the default
 * is on disk, and adding `"cursor"`/`"codex"`/… is a one-line edit.
 *
 * Non-destructive by default:
 * - If `agentKit.targets` is already present and `overwrite` is false, the file
 *   is left exactly as-is (mirrors how `init` never clobbers an existing
 *   `AGENTS.md`).
 * - An existing `agentKit` block with other fields (`pick`, `omit`, …) is
 *   preserved; only `targets` is added.
 */
export async function ensureAgentKitTargets(
  options: EnsureAgentKitTargetsOptions,
): Promise<EnsureAgentKitTargetsResult> {
  const targets =
    options.targets && options.targets.length > 0
      ? options.targets
      : (["claude"] as SkillsTargetName[]);
  validateTargets(targets);

  const manifest = await readManifest(options.root);
  if (manifest === null) {
    return { manifestPath: null, targets, action: "unchanged" };
  }

  const parsed = parseManifest(manifest.raw);
  if (parsed === null) {
    return { manifestPath: manifest.path, targets, action: "unchanged" };
  }

  const existingBlock = isRecord(parsed.agentKit) ? parsed.agentKit : null;
  const hasTargets =
    existingBlock !== null && Array.isArray(existingBlock.targets);

  // Non-clobbering: a target list the user already chose stays put.
  if (hasTargets && !options.overwrite) {
    return {
      manifestPath: manifest.path,
      targets: existingBlock.targets as SkillsTargetName[],
      action: "unchanged",
    };
  }

  const action: EnsureAgentKitTargetsAction =
    existingBlock === null ? "created" : hasTargets ? "updated" : "added";

  const agentKit = existingBlock === null ? {} : { ...existingBlock };
  agentKit.targets = targets;
  parsed.agentKit = agentKit;

  const changed = await writeTextFile(
    manifest.path,
    serializeLike(parsed, manifest.raw),
  );

  return {
    manifestPath: manifest.path,
    targets,
    action: changed ? action : "unchanged",
  };
}

/** What `ensurePostinstallScript` did to the manifest. */
export type EnsurePostinstallAction =
  /** Wrote `scripts.postinstall = "agent-kit sync"`. */
  | "wired"
  /** A `postinstall` script already existed — left untouched. */
  | "skipped-existing"
  /** `@mongez/agent-kit` is not a declared dependency — wiring would break. */
  | "skipped-not-a-dep"
  /** No manifest / unparseable — nothing to do. */
  | "unchanged";

export type EnsurePostinstallResult = {
  manifestPath: string | null;
  action: EnsurePostinstallAction;
  /** The postinstall command — the one we wrote, or the existing one we kept. */
  command: string;
};

/**
 * Wire `"postinstall": "agent-kit sync"` into `package.json`, but only when it
 * is **safe** to do so. Two gates protect against the common footguns:
 *
 * 1. **`@mongez/agent-kit` must be a declared dependency/devDependency.** The
 *    wired command invokes the bare `agent-kit` binary, which only resolves
 *    when agent-kit is installed locally. The primary `init` path is
 *    `npx @mongez/agent-kit@latest init`, which adds *nothing* to
 *    `node_modules` — wiring a postinstall there would make the next install
 *    fail with "agent-kit: command not found". So we skip unless the project
 *    has committed to agent-kit as a dependency.
 * 2. **No existing `postinstall`.** We never clobber or string-append onto a
 *    build pipeline the user already wrote; an existing script is left intact.
 *
 * When either gate blocks, nothing is written and the caller falls back to a
 * printed hint.
 */
export async function ensurePostinstallScript(options: {
  root: string;
}): Promise<EnsurePostinstallResult> {
  const manifest = await readManifest(options.root);
  if (manifest === null) {
    return { manifestPath: null, action: "unchanged", command: POSTINSTALL_COMMAND };
  }

  const parsed = parseManifest(manifest.raw);
  if (parsed === null) {
    return {
      manifestPath: manifest.path,
      action: "unchanged",
      command: POSTINSTALL_COMMAND,
    };
  }

  // Gate 1 — the binary must actually exist at install time.
  if (!dependsOnAgentKit(parsed)) {
    return {
      manifestPath: manifest.path,
      action: "skipped-not-a-dep",
      command: POSTINSTALL_COMMAND,
    };
  }

  // Gate 2 — never clobber an existing postinstall.
  const scripts = isRecord(parsed.scripts) ? parsed.scripts : null;
  const existing =
    scripts !== null && typeof scripts.postinstall === "string"
      ? scripts.postinstall
      : null;
  if (existing !== null) {
    return {
      manifestPath: manifest.path,
      action: "skipped-existing",
      command: existing,
    };
  }

  const nextScripts = scripts === null ? {} : { ...scripts };
  nextScripts.postinstall = POSTINSTALL_COMMAND;
  parsed.scripts = nextScripts;

  const changed = await writeTextFile(
    manifest.path,
    serializeLike(parsed, manifest.raw),
  );

  return {
    manifestPath: manifest.path,
    action: changed ? "wired" : "unchanged",
    command: POSTINSTALL_COMMAND,
  };
}

/** True when `@mongez/agent-kit` is listed in `dependencies`/`devDependencies`. */
function dependsOnAgentKit(parsed: Record<string, unknown>): boolean {
  const deps = isRecord(parsed.dependencies) ? parsed.dependencies : {};
  const devDeps = isRecord(parsed.devDependencies) ? parsed.devDependencies : {};
  return AGENT_KIT_PACKAGE in deps || AGENT_KIT_PACKAGE in devDeps;
}

function validateTargets(targets: SkillsTargetName[]): void {
  const invalid = targets.filter((target) => !VALID_TARGETS.includes(target));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown skill target(s): ${invalid.join(", ")}. Valid targets: ${VALID_TARGETS.join(
        ", ",
      )}.`,
    );
  }
}

/** First existing manifest (`package.json`, then `_package.json`) under `root`. */
async function readManifest(
  root: string,
): Promise<{ path: string; raw: string } | null> {
  for (const filename of MANIFEST_FILENAMES) {
    const path = resolve(root, filename);
    const raw = await readTextFile(path);
    if (raw !== null) return { path, raw };
  }
  return null;
}

/** Parse a manifest into a plain object, or `null` if it isn't one / is invalid. */
function parseManifest(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Re-serialize a manifest object so it matches the original file's shape:
 * its detected indentation and whether it ended with a trailing newline.
 */
function serializeLike(parsed: unknown, raw: string): string {
  const indent = detectIndent(raw);
  const trailingNewline = raw.endsWith("\n");
  return JSON.stringify(parsed, null, indent) + (trailingNewline ? "\n" : "");
}

/**
 * Detect the indentation of an existing JSON file so we round-trip it without
 * reflowing every line. Looks at the first indented property; falls back to two
 * spaces (the npm default) for a compact `{}` or single-line manifest.
 */
function detectIndent(raw: string): string | number {
  const match = raw.match(/\n([ \t]+)"/);
  return match ? match[1] : 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
