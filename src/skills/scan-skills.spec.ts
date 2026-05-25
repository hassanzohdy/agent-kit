import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  autoDiscoverSkills,
  scanForSkillPackages,
  scanLocalPackage,
  scanPackageDir,
} from "./scan-skills";

/**
 * Helper to drop a SKILL.md file inside a package's auto-discoverable skill folder.
 */
async function writeSkillMd(
  pkgDir: string,
  skillName: string,
  body = "# skill",
): Promise<void> {
  const skillDir = resolve(pkgDir, "skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(resolve(skillDir, "SKILL.md"), body, "utf8");
}

/**
 * Helper to drop a package.json inside a fake package dir.
 */
async function writePkg(
  dir: string,
  body: Record<string, unknown>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "package.json"),
    JSON.stringify(body, null, 2),
    "utf8",
  );
}

describe("scanPackageDir", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-scan-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns null when package.json is missing", async () => {
    const result = await scanPackageDir(tempRoot);
    expect(result).toBeNull();
  });

  it("returns null when package.json is invalid JSON", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{ not json", "utf8");
    const result = await scanPackageDir(tempRoot);
    expect(result).toBeNull();
  });

  it("returns null when the package has no skills/ folder", async () => {
    await writePkg(tempRoot, { name: "no-skills" });
    const result = await scanPackageDir(tempRoot);
    expect(result).toBeNull();
  });

  it("discovers skills from the package's skills/ folder", async () => {
    await writePkg(tempRoot, { name: "@scope/pkg" });
    await writeSkillMd(tempRoot, "discovered");

    const result = await scanPackageDir(tempRoot);

    expect(result).not.toBeNull();
    expect(result?.pkg).toBe("@scope/pkg");
    expect(result?.pkgDir).toBe(tempRoot);
    expect(result?.skills).toEqual([
      { name: "discovered", path: "./skills/discovered" },
    ]);
  });

  it("falls back to _package.json when package.json is absent", async () => {
    // Warlock dev-server convention: temporarily renamed manifest.
    await mkdir(tempRoot, { recursive: true });
    await writeFile(
      resolve(tempRoot, "_package.json"),
      JSON.stringify({ name: "@scope/renamed" }),
      "utf8",
    );
    await writeSkillMd(tempRoot, "x");

    const result = await scanPackageDir(tempRoot);

    expect(result?.pkg).toBe("@scope/renamed");
    expect(result?.skills).toHaveLength(1);
  });

  it("prefers package.json over _package.json when both exist", async () => {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({ name: "from-real-pkg" }),
      "utf8",
    );
    await writeFile(
      resolve(tempRoot, "_package.json"),
      JSON.stringify({ name: "from-underscore" }),
      "utf8",
    );
    await writeSkillMd(tempRoot, "a");

    const result = await scanPackageDir(tempRoot);

    expect(result?.pkg).toBe("from-real-pkg");
  });

  it("ignores any agents.skills field in package.json (declaration not supported)", async () => {
    // Even if a package author tries to declare skills the old way, agent-kit
    // only looks at the filesystem `skills/` folder. The declaration is silently
    // ignored — the package will only show up if it has a real skills/ folder.
    await writePkg(tempRoot, {
      name: "has-declaration",
      agents: {
        skills: [{ name: "declared-only", path: "./elsewhere/declared-only" }],
      },
    });
    // No actual skills/ folder, no SKILL.md anywhere.

    const result = await scanPackageDir(tempRoot);

    expect(result).toBeNull();
  });
});

describe("scanForSkillPackages", () => {
  let tempRoot: string;
  let nodeModules: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-scan-"));
    nodeModules = resolve(tempRoot, "node_modules");
    await mkdir(nodeModules, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns an empty array for an empty node_modules", async () => {
    const result = await scanForSkillPackages(nodeModules);
    expect(result).toEqual([]);
  });

  it("returns an empty array when node_modules does not exist", async () => {
    await rm(nodeModules, { recursive: true, force: true });
    const result = await scanForSkillPackages(nodeModules);
    expect(result).toEqual([]);
  });

  it("discovers top-level packages with a skills/ folder", async () => {
    const pkgDir = resolve(nodeModules, "foo");
    await writePkg(pkgDir, { name: "foo" });
    await writeSkillMd(pkgDir, "s1");

    const result = await scanForSkillPackages(nodeModules);

    expect(result).toHaveLength(1);
    expect(result[0]?.pkg).toBe("foo");
  });

  it("discovers scoped packages under @scope/", async () => {
    const pkgDir = resolve(nodeModules, "@warlock.js", "cascade");
    await writePkg(pkgDir, { name: "@warlock.js/cascade" });
    await writeSkillMd(pkgDir, "agent");

    const result = await scanForSkillPackages(nodeModules);

    expect(result).toHaveLength(1);
    expect(result[0]?.pkg).toBe("@warlock.js/cascade");
  });

  it("skips packages whose skills/ folder is missing or empty", async () => {
    const pkgDir = resolve(nodeModules, "skip-me");
    await writePkg(pkgDir, { name: "skip-me" });
    // No skills/ folder

    const realDir = resolve(nodeModules, "include-me");
    await writePkg(realDir, { name: "include-me" });
    await writeSkillMd(realDir, "s");

    const result = await scanForSkillPackages(nodeModules);

    expect(result).toHaveLength(1);
    expect(result[0]?.pkg).toBe("include-me");
  });

  it("ignores hidden directories like .bin and .cache", async () => {
    await mkdir(resolve(nodeModules, ".bin"), { recursive: true });

    const realDir = resolve(nodeModules, "real");
    await writePkg(realDir, { name: "real" });
    await writeSkillMd(realDir, "s");

    const result = await scanForSkillPackages(nodeModules);

    expect(result.map((p) => p.pkg)).toEqual(["real"]);
  });
});

describe("scanLocalPackage", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-scan-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns null when the project root has no skills/", async () => {
    await writePkg(tempRoot, { name: "my-app" });
    const result = await scanLocalPackage(tempRoot);
    expect(result).toBeNull();
  });

  it("returns the local package when it has a skills/ folder", async () => {
    await writePkg(tempRoot, { name: "my-app" });
    await writeSkillMd(tempRoot, "local");

    const result = await scanLocalPackage(tempRoot);

    expect(result?.pkg).toBe("my-app");
    expect(result?.skills).toHaveLength(1);
  });
});

describe("autoDiscoverSkills", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-scan-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns an empty array when the package has no skills/ folder", async () => {
    const result = await autoDiscoverSkills(tempRoot);
    expect(result).toEqual([]);
  });

  describe("multi-skill layout (Pattern B)", () => {
    it("discovers every subdirectory that contains a SKILL.md", async () => {
      await writeSkillMd(tempRoot, "one");
      await writeSkillMd(tempRoot, "two");
      await writeSkillMd(tempRoot, "three");

      const result = await autoDiscoverSkills(tempRoot);

      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(["one", "three", "two"]);
    });

    it("uses ./skills/<name> as the relative path", async () => {
      await writeSkillMd(tempRoot, "my-skill");

      const result = await autoDiscoverSkills(tempRoot);

      expect(result[0]?.path).toBe("./skills/my-skill");
    });

    it("skips subdirectories that do NOT contain SKILL.md", async () => {
      await mkdir(resolve(tempRoot, "skills", "not-a-skill"), {
        recursive: true,
      });
      await writeFile(
        resolve(tempRoot, "skills", "not-a-skill", "README.md"),
        "not a skill",
        "utf8",
      );
      await writeSkillMd(tempRoot, "real-skill");

      const result = await autoDiscoverSkills(tempRoot);

      expect(result.map((s) => s.name)).toEqual(["real-skill"]);
    });

    it("skips files inside skills/ (only directories count)", async () => {
      await mkdir(resolve(tempRoot, "skills"), { recursive: true });
      await writeFile(
        resolve(tempRoot, "skills", "stray.md"),
        "loose file",
        "utf8",
      );

      const result = await autoDiscoverSkills(tempRoot);

      expect(result).toEqual([]);
    });

    it("skips hidden dotfile directories", async () => {
      await writeSkillMd(tempRoot, ".hidden");
      await writeSkillMd(tempRoot, "visible");

      const result = await autoDiscoverSkills(tempRoot);

      expect(result.map((s) => s.name)).toEqual(["visible"]);
    });
  });

  describe("single-skill root layout (Pattern A)", () => {
    /**
     * Helper to drop a SKILL.md directly at the root of skills/ (no subdir).
     */
    async function writeRootSkillMd(
      pkgDir: string,
      body = "# root skill",
    ): Promise<void> {
      const skillsDir = resolve(pkgDir, "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(resolve(skillsDir, "SKILL.md"), body, "utf8");
    }

    it("discovers a single skill when SKILL.md sits at skills/ root", async () => {
      await writeRootSkillMd(tempRoot);

      const result = await autoDiscoverSkills(tempRoot, "@warlock.js/ai");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "ai", path: "./skills" });
    });

    it("derives the skill name from the last segment of the package name", async () => {
      await writeRootSkillMd(tempRoot);

      const result = await autoDiscoverSkills(tempRoot, "foo-bar");

      expect(result[0]?.name).toBe("foo-bar");
    });

    it("falls back to 'default' when no package name is provided", async () => {
      await writeRootSkillMd(tempRoot);

      const result = await autoDiscoverSkills(tempRoot);

      expect(result[0]?.name).toBe("default");
    });

    it("root SKILL.md wins over subdir skills (warlock-style: root is canonical)", async () => {
      await writeRootSkillMd(tempRoot, "# root canonical");
      // Even if a subdir also has SKILL.md, root wins
      await writeSkillMd(tempRoot, "subskill-that-should-be-ignored");

      const result = await autoDiscoverSkills(tempRoot, "@scope/pkg");

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("pkg");
      expect(result[0]?.path).toBe("./skills");
    });

    it("path always points at skills/ (not skills/SKILL.md)", async () => {
      await writeRootSkillMd(tempRoot);

      const result = await autoDiscoverSkills(tempRoot, "pkg");

      expect(result[0]?.path).toBe("./skills");
    });
  });

  describe("nested multi-skill layout (Pattern B, recursive)", () => {
    /**
     * Helper to drop a SKILL.md at a nested path inside skills/.
     * `relativePath` is the sub-path under `skills/`, e.g. `backend/auth`.
     */
    async function writeNestedSkillMd(
      pkgDir: string,
      relativePath: string,
      body = "# nested skill",
    ): Promise<void> {
      const skillDir = resolve(pkgDir, "skills", ...relativePath.split("/"));
      await mkdir(skillDir, { recursive: true });
      await writeFile(resolve(skillDir, "SKILL.md"), body, "utf8");
    }

    it("discovers a skill nested one level under a category", async () => {
      await writeNestedSkillMd(tempRoot, "backend/auth");

      const result = await autoDiscoverSkills(tempRoot, "my-app");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "backend/auth",
        path: "./skills/backend/auth",
      });
    });

    it("discovers multiple nested skills under different categories", async () => {
      await writeNestedSkillMd(tempRoot, "backend/auth");
      await writeNestedSkillMd(tempRoot, "backend/db");
      await writeNestedSkillMd(tempRoot, "frontend/page");

      const result = await autoDiscoverSkills(tempRoot, "my-app");

      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(["backend/auth", "backend/db", "frontend/page"]);
    });

    it("supports deep nesting beyond one category level", async () => {
      await writeNestedSkillMd(tempRoot, "a/b/c/deep-skill");

      const result = await autoDiscoverSkills(tempRoot, "pkg");

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("a/b/c/deep-skill");
      expect(result[0]?.path).toBe("./skills/a/b/c/deep-skill");
    });

    it("mixes flat and nested skills in the same scan", async () => {
      await writeSkillMd(tempRoot, "flat-skill");
      await writeNestedSkillMd(tempRoot, "backend/auth");

      const result = await autoDiscoverSkills(tempRoot, "pkg");

      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(["backend/auth", "flat-skill"]);
    });

    it("treats a directory with SKILL.md as a leaf — does not recurse into it", async () => {
      const backendDir = resolve(tempRoot, "skills", "backend");
      await mkdir(backendDir, { recursive: true });
      await writeFile(resolve(backendDir, "SKILL.md"), "# backend leaf", "utf8");
      await writeNestedSkillMd(tempRoot, "backend/auth", "# would-be auth");

      const result = await autoDiscoverSkills(tempRoot, "pkg");

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("backend");
    });

    it("skips hidden directories at any nesting depth", async () => {
      await writeNestedSkillMd(tempRoot, ".hidden-category/skill");
      await writeNestedSkillMd(tempRoot, "backend/.hidden-skill");
      await writeNestedSkillMd(tempRoot, "backend/visible");

      const result = await autoDiscoverSkills(tempRoot, "pkg");

      expect(result.map((s) => s.name)).toEqual(["backend/visible"]);
    });

    it("skips category directories that contain no SKILL.md at any depth", async () => {
      const emptyCategory = resolve(tempRoot, "skills", "empty-category");
      await mkdir(emptyCategory, { recursive: true });
      await writeFile(
        resolve(emptyCategory, "README.md"),
        "category description",
        "utf8",
      );
      await writeNestedSkillMd(tempRoot, "real/skill");

      const result = await autoDiscoverSkills(tempRoot, "pkg");

      expect(result.map((s) => s.name)).toEqual(["real/skill"]);
    });
  });
});
