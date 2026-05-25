import { describe, expect, it } from "vitest";
import {
  deriveSlugForSkill,
  slugifyPackageName,
} from "./resolve-flat-name";

describe("slugifyPackageName", () => {
  it("drops the leading @ from scoped names", () => {
    expect(slugifyPackageName("@scope/pkg")).toBe("scope-pkg");
  });

  it("replaces dots with hyphens (scopes like @warlock.js)", () => {
    expect(slugifyPackageName("@warlock.js/ai")).toBe("warlock-js-ai");
  });

  it("lowercases mixed-case names", () => {
    expect(slugifyPackageName("@MyOrg/MyPkg")).toBe("myorg-mypkg");
  });

  it("leaves plain (non-scoped) names unchanged structurally", () => {
    expect(slugifyPackageName("plain-name")).toBe("plain-name");
  });

  it("handles a name with multiple dotted segments", () => {
    expect(slugifyPackageName("@a.b.c/d.e")).toBe("a-b-c-d-e");
  });
});

describe("deriveSlugForSkill", () => {
  it("returns just the pkg slug for Pattern A (root layout)", () => {
    const result = deriveSlugForSkill("@warlock.js/ai", {
      name: "ai",
      path: "./skills",
    });
    expect(result).toBe("warlock-js-ai");
  });

  it("returns pkg-slug + skill-name for Pattern B (subdir layout)", () => {
    const result = deriveSlugForSkill("@warlock.js/core", {
      name: "send-response",
      path: "./skills/send-response",
    });
    expect(result).toBe("warlock-js-core-send-response");
  });

  it("handles plain (non-scoped) package names", () => {
    const result = deriveSlugForSkill("agent-kit", {
      name: "overview",
      path: "./skills/overview",
    });
    expect(result).toBe("agent-kit-overview");
  });

  it("slugifies non-kebab characters in the skill name", () => {
    const result = deriveSlugForSkill("pkg", {
      name: "My_Skill.Name",
      path: "./skills/My_Skill.Name",
    });
    expect(result).toBe("pkg-my-skill-name");
  });

  it("recognizes a path of 'skills' (no leading ./) as root layout", () => {
    const result = deriveSlugForSkill("foo", { name: "x", path: "skills" });
    expect(result).toBe("foo");
  });

  it("flattens nested paths in the skill name to kebab segments", () => {
    // Recursive auto-discovery returns name="backend/auth" for skills nested
    // under a category — the slugifier flattens the `/` into `-`.
    const result = deriveSlugForSkill("my-app", {
      name: "backend/auth",
      path: "./skills/backend/auth",
    });
    expect(result).toBe("my-app-backend-auth");
  });

  it("flattens deeply nested paths", () => {
    const result = deriveSlugForSkill("@warlock.js/core", {
      name: "a/b/c/deep",
      path: "./skills/a/b/c/deep",
    });
    expect(result).toBe("warlock-js-core-a-b-c-deep");
  });
});
