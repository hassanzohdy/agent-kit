import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../utils/logger";
import { syncSkills } from "./sync-skills";
import { fileExists, writePackage } from "./sync-skills-naming.helpers";

describe("syncSkills naming", () => {
  let root: string;
  let nodeModules: string;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "agent-kit-naming-"));
    nodeModules = resolve(root, "node_modules");
    await mkdir(nodeModules, { recursive: true });
    await writeFile(resolve(root, "package.json"), "{}", "utf8");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("rewrites the exported name to the folder slug and leaves the body and source untouched", async () => {
    const body = "# Query\r\n\r\nBody text\r\n";
    const source = `---\r\nname: query-data\r\ndescription: Query things\r\n---\r\n${body}`;
    await writePackage(nodeModules, "@warlock.js/cascade", "query-data", source);

    await syncSkills({ root, targets: ["claude"] });

    const exported = await readFile(
      resolve(root, ".claude/skills/warlock-js-cascade-query-data/SKILL.md"),
      "utf8",
    );
    expect(exported).toBe(
      `---\r\nname: warlock-js-cascade-query-data\r\ndescription: Query things\r\n---\r\n${body}`,
    );
    const original = await readFile(
      resolve(nodeModules, "@warlock.js/cascade/skills/query-data/SKILL.md"),
      "utf8",
    );
    expect(original).toBe(source);
  });

  it("inserts a name line when the frontmatter has none", async () => {
    await writePackage(
      nodeModules,
      "foo",
      "agent",
      "---\ndescription: x\n---\n# body\n",
    );

    await syncSkills({ root, targets: ["claude"] });

    const exported = await readFile(
      resolve(root, ".claude/skills/foo-agent/SKILL.md"),
      "utf8",
    );
    expect(exported).toBe("---\nname: foo-agent\ndescription: x\n---\n# body\n");
  });

  it("warns naming both sources and the slug when two skills share a slug", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const pkgDir = resolve(nodeModules, "foo");
    await mkdir(resolve(pkgDir, "skills/a/b"), { recursive: true });
    await mkdir(resolve(pkgDir, "skills/a-b"), { recursive: true });
    await writeFile(resolve(pkgDir, "package.json"), '{"name":"foo"}', "utf8");
    await writeFile(resolve(pkgDir, "skills/a/b/SKILL.md"), "# one", "utf8");
    await writeFile(resolve(pkgDir, "skills/a-b/SKILL.md"), "# two", "utf8");

    await syncSkills({ root, targets: ["claude"] });

    const message = warn.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("collision"));
    expect(message).toBeDefined();
    expect(message).toContain("foo-a-b");
    expect(message).toContain("a/b");
    expect(message).toContain("a-b");
  });

  describe("project prefix", () => {
    async function writeProject(
      pkg: Record<string, unknown>,
    ): Promise<void> {
      await writeFile(resolve(root, "package.json"), JSON.stringify(pkg), "utf8");
      await mkdir(resolve(root, "skills/code-style"), { recursive: true });
      await writeFile(
        resolve(root, "skills/code-style/SKILL.md"),
        "---\nname: code-style\n---\n# style\n",
        "utf8",
      );
    }

    it("uses a project- prefix when the package name slug does not start with a letter", async () => {
      await writeProject({ name: "5.7" });

      await syncSkills({ root, targets: ["claude"] });

      const file = resolve(root, ".claude/skills/project-code-style/SKILL.md");
      expect(await readFile(file, "utf8")).toContain("name: project-code-style");
    });

    it("prefixes with the package name slug by default", async () => {
      await writeProject({ name: "@acme/my.app" });

      await syncSkills({ root, targets: ["claude"] });

      expect(
        await fileExists(resolve(root, ".claude/skills/acme-my-app-code-style/SKILL.md")),
      ).toBe(true);
    });

    it("lets agentKit.projectPrefix override the prefix", async () => {
      await writeProject({ name: "5.7", agentKit: { projectPrefix: "shop" } });

      await syncSkills({ root, targets: ["claude"] });

      expect(
        await fileExists(resolve(root, ".claude/skills/shop-code-style/SKILL.md")),
      ).toBe(true);
      expect(
        await fileExists(resolve(root, ".claude/skills/project-code-style")),
      ).toBe(false);
    });

    it("prunes the old-prefix managed folders after a prefix change", async () => {
      await writeProject({ name: "5.7" });
      await syncSkills({ root, targets: ["claude"] });
      const oldDir = resolve(root, ".claude/skills/project-code-style");
      expect(await fileExists(oldDir)).toBe(true);

      await writeProject({ name: "5.7", agentKit: { projectPrefix: "shop" } });
      const result = await syncSkills({ root, targets: ["claude"] });

      expect(result.pruned).toBe(1);
      expect(await fileExists(oldDir)).toBe(false);
      expect(
        await fileExists(resolve(root, ".claude/skills/shop-code-style")),
      ).toBe(true);
    });
  });
});
