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
export function slugifySegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
}

/**
 * Pattern A detection: skill path points at the `skills/` folder itself
 * (single-skill layout) rather than a subdirectory.
 */
export function isRootLayout(skill: SkillEntry): boolean {
  return (
    skill.path === `./${DEFAULT_SKILLS_DIRNAME}` ||
    skill.path === DEFAULT_SKILLS_DIRNAME
  );
}

/** Slug prefix used for project-authored skills when the package name has no usable slug. */
export const FALLBACK_PROJECT_PREFIX = "project";

/**
 * Resolve the slug prefix for the project's own authored skills.
 *
 * An explicit `agentKit.projectPrefix` wins (slugified). Otherwise the
 * package.json name is slugified; a slug that does not start with a letter
 * (e.g. `"5.7"` → `"5-7"`) falls back to {@link FALLBACK_PROJECT_PREFIX}.
 */
export function resolveProjectPrefix(
  pkgName: string,
  override?: string,
): string {
  if (override) {
    const slug = slugifyPackageName(override).replace(/^-+|-+$/g, "");
    if (slug) return slug;
  }
  const slug = slugifyPackageName(pkgName);
  return /^[a-z]/.test(slug) ? slug : FALLBACK_PROJECT_PREFIX;
}

/**
 * Rewrite the `name:` line of a SKILL.md YAML frontmatter to `name`.
 *
 * Every other line and its line ending is preserved. When the frontmatter has
 * no `name:` line one is inserted as its first line. Content without a
 * frontmatter block is returned unchanged.
 */
export function rewriteSkillName(content: string, name: string): string {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const fence = /^---[ \t]*\r?\n?$/;
  if (lines.length === 0 || !fence.test(lines[0] ?? "")) return content;

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (fence.test(lines[i] ?? "")) {
      close = i;
      break;
    }
  }
  if (close === -1) return content;

  const eolOf = (line: string) => line.match(/\r?\n$/)?.[0] ?? "";
  for (let i = 1; i < close; i++) {
    if (/^name[ \t]*:/.test(lines[i])) {
      lines[i] = `name: ${name}${eolOf(lines[i] ?? "")}`;
      return lines.join("");
    }
  }

  lines.splice(1, 0, `name: ${name}${eolOf(lines[0] ?? "") || "\n"}`);
  return lines.join("");
}

/**
 * Remove the `name:` line from a SKILL.md YAML frontmatter. Everything else,
 * including line endings, is preserved byte-for-byte.
 */
export function removeSkillName(content: string): string {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const fence = /^---[ \t]*\r?\n?$/;
  if (lines.length === 0 || !fence.test(lines[0] ?? "")) return content;

  for (let i = 1; i < lines.length; i++) {
    if (fence.test(lines[i] ?? "")) return content;
    if (/^name[ \t]*:/.test(lines[i])) {
      lines.splice(i, 1);
      return lines.join("");
    }
  }
  return content;
}
