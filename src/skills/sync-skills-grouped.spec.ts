import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../utils/logger";
import { syncSkills } from "./sync-skills";
import { fileExists } from "./sync-skills-naming.helpers";

describe("syncSkills grouped layout", () => {
  let root: string;
  let nodeModules: string;

  const put = async (path: string, content: string) => {
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
  };

  /** Fake package with the given topics ({ folder: SKILL.md content }). */
  const writePkg = async (
    name: string,
    topics: Record<string, string>,
    index?: string,
  ) => {
    const dir = resolve(nodeModules, ...name.split("/"));
    await put(resolve(dir, "package.json"), JSON.stringify({ name }));
    for (const [topic, md] of Object.entries(topics)) {
      await put(resolve(dir, "skills", topic, "SKILL.md"), md);
    }
    if (index !== undefined) await put(resolve(dir, "skills/index.md"), index);
    return dir;
  };

  const skill = (name: string, description: string, body = "# Body\n") =>
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

  const out = (...parts: string[]) => resolve(root, ".claude/skills", ...parts);
  const read = (...parts: string[]) => readFile(out(...parts), "utf8");

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "agent-kit-grouped-"));
    nodeModules = resolve(root, "node_modules");
    await mkdir(nodeModules, { recursive: true });
    // These specs exercise the grouped mechanics, so opt every package in.
    // The "auto" default is covered in its own block below.
    await writeFile(
      resolve(root, "package.json"),
      JSON.stringify({ agentKit: { layout: "grouped" } }),
      "utf8",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  const threeTopics = {
    alpha: skill("alpha", "Alpha things"),
    beta: skill("beta", "Beta things"),
    gamma: skill("gamma", "Gamma things"),
  };
  const index =
    '---\ndescription: "Cascade ORM: models & queries"\n---\n# Cascade\n\nIntro text.\n';

  it("(a) writes one folder with router, topic files and sentinel", async () => {
    await writePkg("@warlock.js/cascade", threeTopics, index);
    const result = await syncSkills({ root, targets: ["claude"] });

    expect((await readdir(out())).sort()).toEqual(["warlock-js-cascade"]);
    expect((await readdir(out("warlock-js-cascade"))).sort()).toEqual([
      ".agent-kit-managed",
      "SKILL.md",
      "alpha.md",
      "beta.md",
      "gamma.md",
    ]);
    expect(result.exported).toBe(1);
  });

  it("(b) router frontmatter comes from index.md", async () => {
    await writePkg("@warlock.js/cascade", threeTopics, index);
    await syncSkills({ root, targets: ["claude"] });

    const router = await read("warlock-js-cascade", "SKILL.md");
    expect(router).toMatch(
      /^---\nname: warlock-js-cascade\ndescription: "Cascade ORM: models & queries"\n---\n/,
    );
    expect(router).toContain("# Cascade\n\nIntro text.\n\n## Topics");
  });

  it("(c) falls back and warns once when index.md is missing", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await writePkg("foo", threeTopics);
    await syncSkills({ root, targets: ["claude", "cursor"] });

    const router = await read("foo", "SKILL.md");
    expect(router).toContain('description: "foo skills: alpha, beta, gamma"');
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(
      messages.filter(
        (m) =>
          m ===
          "foo has no skills/index.md description; generated a router description",
      ),
    ).toHaveLength(1);
  });

  it("(d) lists topics alphabetically and escapes pipes", async () => {
    await writePkg("foo", {
      zed: skill("zed", "Last one"),
      alpha: skill("alpha", "Use a | b when both"),
    });
    await syncSkills({ root, targets: ["claude"] });

    const router = await read("foo", "SKILL.md");
    expect(router).toContain(
      "| File | Read it when |\n|---|---|\n| [alpha.md](./alpha.md) | Use a \\| b when both |\n| [zed.md](./zed.md) | Last one |\n",
    );
  });

  it("(e) topic file drops only the name line", async () => {
    const body = "# Alpha\r\n\r\ntext\r\n";
    const source = `---\r\nname: alpha\r\ndescription: A\r\n---\r\n${body}`;
    await writePkg("foo", { alpha: source, beta: skill("beta", "B") });
    await syncSkills({ root, targets: ["claude"] });

    expect(await read("foo", "alpha.md")).toBe(
      `---\r\ndescription: A\r\n---\r\n${body}`,
    );
  });

  it("(f) assets land in <topic>/ and in-topic links are rewritten", async () => {
    const dir = await writePkg("foo", {
      alpha: skill(
        "alpha",
        "A",
        "[ref](references/x.md) [script](./scripts/a.sh) [web](https://x.dev/a.md) [top](#top)\n",
      ),
      beta: skill("beta", "B"),
    });
    await put(resolve(dir, "skills/alpha/references/x.md"), "[back](../SKILL.md)\n");
    await put(resolve(dir, "skills/alpha/scripts/a.sh"), "echo hi\n");
    await syncSkills({ root, targets: ["claude"] });

    expect(await fileExists(out("foo", "alpha", "references", "x.md"))).toBe(true);
    expect(await fileExists(out("foo", "alpha", "scripts", "a.sh"))).toBe(true);
    expect(await fileExists(out("foo", "alpha", "SKILL.md"))).toBe(false);
    expect(await fileExists(out("foo", "beta"))).toBe(false);
    const topic = await read("foo", "alpha.md");
    expect(topic).toContain("[ref](./alpha/references/x.md)");
    expect(topic).toContain("[script](./alpha/scripts/a.sh)");
    expect(topic).toContain("[web](https://x.dev/a.md) [top](#top)");
    expect(await read("foo", "alpha", "references", "x.md")).toBe(
      "[back](../../alpha.md)\n",
    );
  });

  it("(g) rewrites sibling-topic links", async () => {
    const dir = await writePkg("foo", {
      alpha: skill(
        "alpha",
        "A",
        "[b](../beta/SKILL.md#x) [c](../beta/references/y.md)\n",
      ),
      beta: skill("beta", "B"),
    });
    await put(resolve(dir, "skills/beta/references/y.md"), "y\n");
    await syncSkills({ root, targets: ["claude"] });

    expect(await read("foo", "alpha.md")).toContain(
      "[b](./beta.md#x) [c](./beta/references/y.md)",
    );
  });

  it("(h) a single-skill package stays flat", async () => {
    await writePkg("solo", { only: skill("only", "One") });
    await syncSkills({ root, targets: ["claude"] });

    expect(await fileExists(out("solo-only", "SKILL.md"))).toBe(true);
    expect(await fileExists(out("solo"))).toBe(false);
  });

  it("(i) the project's own skills stay flat", async () => {
    await writeFile(resolve(root, "package.json"), '{"name":"my-app"}', "utf8");
    await put(resolve(root, "skills/one/SKILL.md"), skill("one", "One"));
    await put(resolve(root, "skills/two/SKILL.md"), skill("two", "Two"));
    await syncSkills({ root, targets: ["claude"] });

    expect((await readdir(out())).sort()).toEqual(["my-app-one", "my-app-two"]);
  });

  it("(j) layoutOverrides can force one package flat", async () => {
    await writeFile(
      resolve(root, "package.json"),
      JSON.stringify({
        agentKit: { layout: "grouped", layoutOverrides: { foo: "flat" } },
      }),
      "utf8",
    );
    await writePkg("foo", threeTopics);
    await writePkg("bar", threeTopics);
    await syncSkills({ root, targets: ["claude"] });

    expect(await fileExists(out("foo-alpha", "SKILL.md"))).toBe(true);
    expect(await fileExists(out("bar", "alpha.md"))).toBe(true);
    expect(await fileExists(out("foo"))).toBe(false);
  });

  it("(k) switching layouts prunes the old folders", async () => {
    await writePkg("foo", threeTopics);
    await syncSkills({ root, targets: ["claude"] });
    expect((await readdir(out())).sort()).toEqual(["foo"]);

    const flat = await syncSkills({ root, targets: ["claude"], layout: "flat" });
    expect((await readdir(out())).sort()).toEqual([
      "foo-alpha",
      "foo-beta",
      "foo-gamma",
    ]);
    expect(flat.pruned).toBe(1);

    const grouped = await syncSkills({
      root,
      targets: ["claude"],
      layout: "grouped",
    });
    expect((await readdir(out())).sort()).toEqual(["foo"]);
    expect(grouped.pruned).toBe(3);
  });

  it("(l) reports the summary numbers", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    await writePkg("foo", threeTopics, "---\ndescription: Twelve chars\n---\n");
    await writePkg("solo", { only: skill("only", "Nine char") });
    const result = await syncSkills({ root, targets: ["claude"] });

    // foo router (12) + solo-only (9)
    expect(result.summaries).toEqual([
      { target: "claude", skills: 2, groupedPackages: 1, descriptionChars: 21 },
    ]);
    expect(info).toHaveBeenCalledWith(
      "claude: 2 skills (1 grouped packages), 21 description chars",
    );
  });

  describe("auto layout (the default)", () => {
    beforeEach(async () => {
      await writeFile(resolve(root, "package.json"), "{}", "utf8");
    });

    it("(m) groups a package that ships skills/index.md", async () => {
      await writePkg("@warlock.js/cascade", threeTopics, index);
      await syncSkills({ root, targets: ["claude"] });

      expect(await fileExists(out("warlock-js-cascade", "SKILL.md"))).toBe(true);
      expect(await fileExists(out("warlock-js-cascade", "alpha.md"))).toBe(true);
    });

    it("(n) keeps a package without skills/index.md flat and silent", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      await writePkg("foo", threeTopics);
      await syncSkills({ root, targets: ["claude"] });

      expect((await readdir(out())).sort()).toEqual([
        "foo-alpha",
        "foo-beta",
        "foo-gamma",
      ]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("(o) mixes grouped and flat packages in one sync", async () => {
      await writePkg("@warlock.js/cascade", threeTopics, index);
      await writePkg("foo", threeTopics);
      const result = await syncSkills({ root, targets: ["claude"] });

      expect((await readdir(out())).sort()).toEqual([
        "foo-alpha",
        "foo-beta",
        "foo-gamma",
        "warlock-js-cascade",
      ]);
      expect(result.summaries[0]?.groupedPackages).toBe(1);
    });
  });
});
