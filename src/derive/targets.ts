import type { DeriveTarget, DeriveTargetName } from "../types";

/**
 * Built-in derive targets. Each entry describes one AI coding agent that
 * requires its own instructions file at a specific path.
 *
 * Tools that read root `AGENTS.md` natively (Codex, Cursor, Amp, Jules,
 * Factory, Kilo, Windsurf, OpenCode, Goose) are intentionally absent — they
 * use the source file directly and need no derived copy.
 */
export const DERIVE_TARGETS: readonly DeriveTarget[] = Object.freeze([
  {
    name: "claude",
    outputPath: "CLAUDE.md",
    label: "Claude Code",
    enabledByDefault: true,
  },
  {
    name: "gemini",
    outputPath: ".gemini/GEMINI.md",
    label: "Gemini CLI",
    enabledByDefault: true,
  },
  {
    name: "copilot",
    outputPath: ".github/copilot-instructions.md",
    label: "GitHub Copilot",
    enabledByDefault: true,
  },
  {
    name: "aider",
    outputPath: "CONVENTIONS.md",
    label: "Aider",
    enabledByDefault: true,
  },
]);

/**
 * Look up a derive target by name. Throws on unknown names so typos surface
 * early at the CLI boundary rather than silently no-op'ing.
 */
export function getDeriveTarget(name: DeriveTargetName): DeriveTarget {
  const target = DERIVE_TARGETS.find((entry) => entry.name === name);
  if (!target) {
    throw new Error(
      `Unknown derive target "${name}". Known targets: ${DERIVE_TARGETS.map(
        (entry) => entry.name,
      ).join(", ")}`,
    );
  }
  return target;
}

/**
 * Resolve a list of target names — defaults to every target with
 * `enabledByDefault: true` when no explicit subset is provided.
 */
export function resolveDeriveTargets(
  names?: DeriveTargetName[],
): DeriveTarget[] {
  if (!names || names.length === 0) {
    return DERIVE_TARGETS.filter((target) => target.enabledByDefault);
  }
  return names.map(getDeriveTarget);
}
