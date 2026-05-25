import type { SkillsTargetName } from "../types";

/**
 * Where each AI coding agent expects to find skills, relative to the project
 * root.
 *
 * These paths follow the de-facto conventions emerging across the ecosystem
 * as of 2026:
 * - Claude Code (and VSCode Copilot fallback) reads `.claude/skills/`
 * - Cursor reads `.cursor/skills/`
 * - GitHub Copilot reads `.github/skills/`
 * - Codex CLI + IDE reads `.codex/skills/`
 * - OpenCode reads `.opencode/skill/` (singular — that is their convention)
 * - Amp reads `.agents/skills/` (PLURAL "agents")
 * - Goose reads `.goose/skills/`
 * - Kiro (AWS) reads `.kiro/skills/`
 * - Antigravity (Google) reads `.agent/skills/` (SINGULAR "agent" — distinct
 *   from Amp's plural; they are two different tools with two different paths)
 */
export const SKILLS_TARGET_PATHS: Record<SkillsTargetName, string> =
  Object.freeze({
    claude: ".claude/skills",
    copilot: ".github/skills",
    cursor: ".cursor/skills",
    codex: ".codex/skills",
    opencode: ".opencode/skill",
    amp: ".agents/skills",
    goose: ".goose/skills",
    kiro: ".kiro/skills",
    antigravity: ".agent/skills",
  });

/**
 * Sentinel filename dropped inside each skill directory we create.
 *
 * On the next sync we delete every directory containing this sentinel before
 * rewriting — that gives us prune-on-update semantics without ever touching
 * user-authored skills that live alongside ours.
 */
export const MANAGED_SENTINEL = ".agent-kit-managed";

/**
 * Look up the destination directory (relative to project root) for a target.
 */
export function getSkillsTargetPath(name: SkillsTargetName): string {
  const path = SKILLS_TARGET_PATHS[name];
  if (!path) {
    throw new Error(
      `Unknown skills target "${name}". Known targets: ${Object.keys(
        SKILLS_TARGET_PATHS,
      ).join(", ")}`,
    );
  }
  return path;
}
