import { describe, expect, it } from "vitest";
import {
  DERIVE_TARGETS,
  getDeriveTarget,
  resolveDeriveTargets,
} from "./targets";

describe("DERIVE_TARGETS registry", () => {
  it("contains exactly the four expected agents", () => {
    const names = DERIVE_TARGETS.map((t) => t.name).sort();

    expect(names).toEqual(["aider", "claude", "copilot", "gemini"]);
  });

  it("every target has the required shape", () => {
    for (const target of DERIVE_TARGETS) {
      expect(target.name).toBeTypeOf("string");
      expect(target.outputPath).toBeTypeOf("string");
      expect(target.label).toBeTypeOf("string");
      expect(target.enabledByDefault).toBeTypeOf("boolean");
    }
  });

  it("output paths are unique across targets", () => {
    const paths = DERIVE_TARGETS.map((t) => t.outputPath);
    const unique = new Set(paths);

    expect(unique.size).toBe(paths.length);
  });

  it("uses the canonical path for each tool", () => {
    const byName = Object.fromEntries(
      DERIVE_TARGETS.map((t) => [t.name, t.outputPath]),
    );

    expect(byName.claude).toBe("CLAUDE.md");
    expect(byName.gemini).toBe(".gemini/GEMINI.md");
    expect(byName.copilot).toBe(".github/copilot-instructions.md");
    expect(byName.aider).toBe("CONVENTIONS.md");
  });
});

describe("getDeriveTarget", () => {
  it("returns the target when given a known name", () => {
    const result = getDeriveTarget("claude");

    expect(result.name).toBe("claude");
    expect(result.outputPath).toBe("CLAUDE.md");
  });

  it("throws when given an unknown name", () => {
    // @ts-expect-error — intentionally invalid input
    expect(() => getDeriveTarget("bogus")).toThrow(/Unknown derive target/);
  });

  it("error message lists the known targets", () => {
    // @ts-expect-error — intentionally invalid input
    expect(() => getDeriveTarget("bogus")).toThrow(/claude.*gemini.*copilot.*aider/);
  });
});

describe("resolveDeriveTargets", () => {
  it("returns all enabled-by-default targets when called with no args", () => {
    const result = resolveDeriveTargets();

    expect(result).toHaveLength(4);
    expect(result.every((t) => t.enabledByDefault)).toBe(true);
  });

  it("returns all enabled-by-default targets when called with empty array", () => {
    const result = resolveDeriveTargets([]);

    expect(result).toHaveLength(4);
  });

  it("returns only the requested subset, in order", () => {
    const result = resolveDeriveTargets(["gemini", "claude"]);

    expect(result.map((t) => t.name)).toEqual(["gemini", "claude"]);
  });

  it("throws when an unknown target name is requested", () => {
    expect(() =>
      // @ts-expect-error — intentionally invalid input
      resolveDeriveTargets(["claude", "bogus"]),
    ).toThrow(/Unknown derive target/);
  });
});
