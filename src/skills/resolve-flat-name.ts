import { DEFAULT_SKILLS_DIRNAME } from "./scan-skills";
import type { SkillEntry } from "./scan-skills";

/**
 * Claude Code discovers skills by directory name only — the SKILL.md
 * frontmatter `name:` field is optional display polish, not used for routing
 * (see https://code.claude.com/docs/en/skills, "Frontmatter Reference":
 * "name — Display name for the skill. If omitted, uses the directory name.").
 *
 * agent-kit therefore derives a **flat, collision-resistant folder name**
 * from the package + skill identity alone:
 *
 *   Pattern A (single-skill, path = ./skills)  → `<pkg-slug>`
 *   Pattern B (multi-skill,  path = ./skills/X) → `<pkg-slug>-<X>`
 *
 * The slug strips the leading `@` from scopes and replaces `/` and `.` with
 * `-`, so `@warlock.js/ai` becomes `warlock-js-ai`. Path separators inside
 * nested Pattern B names (e.g. `backend/auth`) are also collapsed to `-`.
 *
 * SKILL.md content is copied verbatim — agent-kit never reads or rewrites
 * frontmatter.
 */

/**
 * Derive the flat destination folder name for a skill.
 *
 * @example
 * deriveSlugForSkill("@warlock.js/ai",   { name: "ai",            path: "./skills" });
 * // → "warlock-js-ai"
 *
 * deriveSlugForSkill("@warlock.js/core", { name: "send-response", path: "./skills/send-response" });
 * // → "warlock-js-core-send-response"
 *
 * deriveSlugForSkill("my-app",           { name: "backend/auth",  path: "./skills/backend/auth" });
 * // → "my-app-backend-auth"
 */
export function deriveSlugForSkill(
  pkgName: string,
  skill: SkillEntry,
): string {
  const pkgSlug = slugifyPackageName(pkgName);
  if (isRootLayout(skill)) return pkgSlug;
  return `${pkgSlug}-${slugifySegment(skill.name)}`;
}

/**
 * Convert a package name into a kebab-case slug suitable for a folder name.
 *
 * Drops the leading `@`, replaces `/` and `.` with `-`, and lowercases.
 *
 * @example
 * slugifyPackageName("@warlock.js/ai");  // "warlock-js-ai"
 * slugifyPackageName("plain-name");       // "plain-name"
 */
export function slugifyPackageName(pkgName: string): string {
  return pkgName
    .replace(/^@/, "")
    .replace(/[/.]/g, "-")
    .toLowerCase();
}

/**
 * Slugify a single skill identifier (Pattern B subdir path or nested path).
 *
 * Lowercases and replaces every non-kebab-safe character with `-`. Path
 * separators in nested names (`backend/auth`) collapse to `-` here.
 */
function slugifySegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
}

/**
 * Pattern A detection: skill path points at the `skills/` folder itself
 * (single-skill layout) rather than a subdirectory.
 */
function isRootLayout(skill: SkillEntry): boolean {
  return (
    skill.path === `./${DEFAULT_SKILLS_DIRNAME}` ||
    skill.path === DEFAULT_SKILLS_DIRNAME
  );
}
