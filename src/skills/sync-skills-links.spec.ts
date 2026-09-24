import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncSkills } from "./sync-skills";

describe("syncSkills directory and package-specifier links", () => {
  let root: string;
  let nodeModules: string;

  const put = async (path: string, content: string) => {
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
  };

  const skill = (name: string, body = "# Body\n") =>
    `---\nname: ${name}\ndescription: ${name} things\n---\n${body}`;

  const writePkg = async (name: string, topics: Record<string, string>) => {
    const dir = resolve(nodeModules, ...name.split("/"));
    await put(resolve(dir, "package.json"), JSON.stringify({ name }));
    for (const [topic, md] of Object.entries(topics)) {
      await put(resolve(dir, "skills", topic, "SKILL.md"), md);
    }
  };

  const out = (...parts: string[]) => resolve(root, ".claude/skills", ...parts);
  const read = (...parts: string[]) => readFile(out(...parts), "utf8");

  const links = [
    "[a](../overview/)",
    "[b](../overview)",
    "[c](../overview/#deep)",
    "[d](@warlock.js/cache/use-cache-tags/SKILL.md)",
    "[e](@warlock.js/cache/use-cache-tags/)",
    "[f](@warlock.js/cache/use-cache-tags#top)",
    "[g](@warlock.js/http/routes/SKILL.md)",
    "[h](@warlock.js/missing/routes/SKILL.md)",
    "Prose @warlock.js/cache/use-cache-tags/SKILL.md and `[i](@warlock.js/cache/use-cache-tags/SKILL.md)`",
  ].join("\n");

  const setup = async () => {
    await writePkg("@warlock.js/cache", {
      overview: skill("overview"),
      "use-cache-tags": skill("use-cache-tags"),
      "agent-integrations": skill("agent-integrations", `${links}\n`),
    });
    await writePkg("@warlock.js/http", {
      routes: skill("routes"),
      other: skill("other"),
    });
  };

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "agent-kit-links-"));
    nodeModules = resolve(root, "node_modules");
    await mkdir(nodeModules, { recursive: true });
    await writeFile(resolve(root, "package.json"), "{}", "utf8");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("grouped: maps directory and specifier links to topic files", async () => {
    await setup();
    await syncSkills({ root, targets: ["claude"], layout: "grouped" });
    const text = await read("warlock-js-cache", "agent-integrations.md");

    expect(text).toContain("[a](./overview.md)");
    expect(text).toContain("[b](./overview.md)");
    expect(text).toContain("[c](./overview.md#deep)");
    expect(text).toContain("[d](./use-cache-tags.md)");
    expect(text).toContain("[e](./use-cache-tags.md)");
    expect(text).toContain("[f](./use-cache-tags.md#top)");
    expect(text).toContain("[g](../warlock-js-http/routes.md)");
    expect(text).toContain("[h](@warlock.js/missing/routes/SKILL.md)");
    expect(text).toContain(
      "Prose @warlock.js/cache/use-cache-tags/SKILL.md and `[i](@warlock.js/cache/use-cache-tags/SKILL.md)`",
    );
  });

  it("flat: maps directory and specifier links to sibling SKILL.md files", async () => {
    await setup();
    await syncSkills({ root, targets: ["claude"], layout: "flat" });
    const text = await read("warlock-js-cache-agent-integrations", "SKILL.md");

    expect(text).toContain("[a](../warlock-js-cache-overview/SKILL.md)");
    expect(text).toContain("[b](../warlock-js-cache-overview/SKILL.md)");
    expect(text).toContain("[c](../warlock-js-cache-overview/SKILL.md#deep)");
    expect(text).toContain("[d](../warlock-js-cache-use-cache-tags/SKILL.md)");
    expect(text).toContain("[e](../warlock-js-cache-use-cache-tags/SKILL.md)");
    expect(text).toContain("[f](../warlock-js-cache-use-cache-tags/SKILL.md#top)");
    expect(text).toContain("[g](../warlock-js-http-routes/SKILL.md)");
    expect(text).toContain("[h](@warlock.js/missing/routes/SKILL.md)");
    expect(text).toContain(
      "Prose @warlock.js/cache/use-cache-tags/SKILL.md and `[i](@warlock.js/cache/use-cache-tags/SKILL.md)`",
    );
  });
});
