import { describe, expect, it } from "vitest";
import {
  MANAGED_SENTINEL,
  SKILLS_TARGET_PATHS,
  getSkillsTargetPath,
} from "./target-paths";

describe("SKILLS_TARGET_PATHS", () => {
  it("covers all nine supported agents", () => {
    expect(Object.keys(SKILLS_TARGET_PATHS).sort()).toEqual([
      "amp",
      "antigravity",
      "claude",
      "codex",
      "copilot",
      "cursor",
      "goose",
      "kiro",
      "opencode",
    ]);
  });

  it("uses the canonical path for each agent", () => {
    expect(SKILLS_TARGET_PATHS.claude).toBe(".claude/skills");
    expect(SKILLS_TARGET_PATHS.cursor).toBe(".cursor/skills");
    expect(SKILLS_TARGET_PATHS.copilot).toBe(".github/skills");
    expect(SKILLS_TARGET_PATHS.codex).toBe(".codex/skills");
    expect(SKILLS_TARGET_PATHS.opencode).toBe(".opencode/skill");
    expect(SKILLS_TARGET_PATHS.amp).toBe(".agents/skills");
    expect(SKILLS_TARGET_PATHS.goose).toBe(".goose/skills");
    expect(SKILLS_TARGET_PATHS.kiro).toBe(".kiro/skills");
    expect(SKILLS_TARGET_PATHS.antigravity).toBe(".agent/skills");
  });

  it("distinguishes Amp (plural 'agents') from Antigravity (singular 'agent')", () => {
    // Two characters apart, two completely different tools. This test exists
    // to lock the distinction so a future typo cleanup doesn't accidentally
    // collapse them.
    expect(SKILLS_TARGET_PATHS.amp).toBe(".agents/skills");
    expect(SKILLS_TARGET_PATHS.antigravity).toBe(".agent/skills");
    expect(SKILLS_TARGET_PATHS.amp).not.toBe(SKILLS_TARGET_PATHS.antigravity);
  });

  it("paths do not contain trailing slashes (we use pathe.resolve to join)", () => {
    for (const path of Object.values(SKILLS_TARGET_PATHS)) {
      expect(path.endsWith("/")).toBe(false);
    }
  });
});

describe("MANAGED_SENTINEL", () => {
  it("is a stable dotfile name", () => {
    expect(MANAGED_SENTINEL).toBe(".agent-kit-managed");
  });

  it("starts with a dot so it sorts to the top in dir listings", () => {
    expect(MANAGED_SENTINEL.startsWith(".")).toBe(true);
  });
});

describe("getSkillsTargetPath", () => {
  it("returns the path for known targets", () => {
    expect(getSkillsTargetPath("claude")).toBe(".claude/skills");
    expect(getSkillsTargetPath("cursor")).toBe(".cursor/skills");
  });

  it("throws for unknown targets", () => {
    // @ts-expect-error — intentionally invalid input
    expect(() => getSkillsTargetPath("nope")).toThrow(/Unknown skills target/);
  });
});
