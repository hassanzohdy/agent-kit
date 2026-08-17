import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SKILLS_TARGETS, syncSkills } from "./sync-skills";
import { MANAGED_SENTINEL } from "./target-paths";

/**
 * Helper: drop a fake package inside node_modules with one or more skill dirs.
 */
async function installFakePackage(
  nodeModules: string,
  pkgName: string,
  skills: Array<{ name: string; body: string }>,
): Promise<void> {
  const pkgDir = pkgName.startsWith("@")
    ? resolve(nodeModules, ...pkgName.split("/"))
    : resolve(nodeModules, pkgName);

  await mkdir(pkgDir, { recursive: true });
  const skillEntries = skills.map((s) => ({
    name: s.name,
    path: `./skills/${s.name}`,
  }));

  await writeFile(
    resolve(pkgDir, "package.json"),
    JSON.stringify({ name: pkgName, agents: { skills: skillEntries } }, null, 2),
    "utf8",
  );

  for (const skill of skills) {
    const skillDir = resolve(pkgDir, "skills", skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(resolve(skillDir, "SKILL.md"), skill.body, "utf8");
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("DEFAULT_SKILLS_TARGETS", () => {
  it("defaults to claude only — additional targets are opt-in", () => {
    expect([...DEFAULT_SKILLS_TARGETS]).toEqual(["claude"]);
  });

  it("is a frozen array — callers cannot mutate the default", () => {
    expect(Object.isFrozen(DEFAULT_SKILLS_TARGETS)).toBe(true);
  });
});

describe("syncSkills", () => {
  let tempRoot: string;
  let nodeModules: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-skills-"));
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    nodeModules = resolve(tempRoot, "node_modules");
    await mkdir(nodeModules, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns zero exported when node_modules has no skill-shipping packages", async () => {
    const result = await syncSkills({ root: tempRoot });

    expect(result.exported).toBe(0);
    expect(result.packages).toEqual([]);
  });

  it("exports one skill per package per target with a flat folder name", async () => {
    // Flat name for declared Pattern B = `<pkg-slug>-<skill-name>` → `foo-agent`
    await installFakePackage(nodeModules, "foo", [
      { name: "agent", body: "# foo agent skill" },
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude", "cursor"],
    });

    expect(result.exported).toBe(2); // 1 skill × 2 targets

    const claudePath = resolve(
      tempRoot,
      ".claude/skills/foo-agent/SKILL.md",
    );
    const cursorPath = resolve(
      tempRoot,
      ".cursor/skills/foo-agent/SKILL.md",
    );

    const claudeContent = await readFile(claudePath, "utf8");
    const cursorContent = await readFile(cursorPath, "utf8");
    expect(claudeContent).toBe("# foo agent skill");
    expect(cursorContent).toBe("# foo agent skill");
  });

  it("slugifies scoped package names in the flat folder (@scope/.dotted → kebab)", async () => {
    // @warlock.js/cascade + agent → warlock-js-cascade-agent
    await installFakePackage(nodeModules, "@warlock.js/cascade", [
      { name: "agent", body: "# cascade agent" },
    ]);

    await syncSkills({ root: tempRoot, targets: ["claude"] });

    const expectedPath = resolve(
      tempRoot,
      ".claude/skills/warlock-js-cascade-agent/SKILL.md",
    );
    expect(await fileExists(expectedPath)).toBe(true);

    // And it does NOT create a nested @warlock.js/cascade/agent/ path
    const nestedPath = resolve(
      tempRoot,
      ".claude/skills/@warlock.js/cascade/agent/SKILL.md",
    );
    expect(await fileExists(nestedPath)).toBe(false);
  });

  it("drops a managed sentinel inside every exported skill dir", async () => {
    await installFakePackage(nodeModules, "foo", [
      { name: "agent", body: "x" },
    ]);

    await syncSkills({ root: tempRoot, targets: ["claude"] });

    const sentinelPath = resolve(
      tempRoot,
      ".claude/skills/foo-agent",
      MANAGED_SENTINEL,
    );
    expect(await fileExists(sentinelPath)).toBe(true);
  });

  it("prunes stale managed dirs from removed packages on re-sync", async () => {
    await installFakePackage(nodeModules, "stays", [
      { name: "agent", body: "stays" },
    ]);
    await installFakePackage(nodeModules, "goes", [
      { name: "agent", body: "goes" },
    ]);

    // First sync: both packages exported as flat names
    await syncSkills({ root: tempRoot, targets: ["claude"] });
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/goes-agent/SKILL.md")),
    ).toBe(true);

    // Remove the "goes" package from node_modules
    await rm(resolve(nodeModules, "goes"), { recursive: true, force: true });

    const second = await syncSkills({ root: tempRoot, targets: ["claude"] });

    // Stale managed dir removed; survivor still present
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/goes-agent/SKILL.md")),
    ).toBe(false);
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/stays-agent/SKILL.md")),
    ).toBe(true);
    expect(second.pruned).toBeGreaterThan(0);
  });

  it("does NOT touch user-authored skill dirs without the sentinel", async () => {
    // User-authored skill, no sentinel
    const userSkillDir = resolve(tempRoot, ".claude/skills/my-own/SKILL.md");
    await mkdir(resolve(tempRoot, ".claude/skills/my-own"), { recursive: true });
    await writeFile(userSkillDir, "# user skill, hands off", "utf8");

    await installFakePackage(nodeModules, "foo", [
      { name: "agent", body: "managed" },
    ]);

    await syncSkills({ root: tempRoot, targets: ["claude"] });

    // User skill preserved
    const userContent = await readFile(userSkillDir, "utf8");
    expect(userContent).toBe("# user skill, hands off");

    // Managed skill also written (flat name)
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/foo-agent/SKILL.md")),
    ).toBe(true);
  });

  it("includes the project's own local skills via auto-discovery", async () => {
    // Drop a skills/ folder at project root — picked up via auto-discovery.
    const localSkillDir = resolve(tempRoot, "skills/local");
    await mkdir(localSkillDir, { recursive: true });
    await writeFile(
      resolve(localSkillDir, "SKILL.md"),
      "# local project skill",
      "utf8",
    );
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({ name: "my-app" }),
      "utf8",
    );

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toContain("my-app");
    const exportedPath = resolve(
      tempRoot,
      ".claude/skills/my-app-local/SKILL.md",
    );
    expect(await fileExists(exportedPath)).toBe(true);
  });

  it("end-to-end: nested local skills land flat in .claude/skills/", async () => {
    // Project root has skills/backend/auth/SKILL.md (no agents.skills declared).
    // Auto-discovery finds it via recursive walk; flat name becomes
    // <pkg-slug>-backend-auth.
    const skillDir = resolve(tempRoot, "skills/backend/auth");
    await mkdir(skillDir, { recursive: true });
    await writeFile(resolve(skillDir, "SKILL.md"), "# auth skill", "utf8");
    // Need a package.json with a name so scanLocalPackage picks it up
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({ name: "my-app" }),
      "utf8",
    );

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toContain("my-app");
    const flatPath = resolve(
      tempRoot,
      ".claude/skills/my-app-backend-auth/SKILL.md",
    );
    const content = await readFile(flatPath, "utf8");
    expect(content).toBe("# auth skill");
  });

  it("ignores SKILL.md frontmatter name — folder identity is always derived", async () => {
    // Even if the SKILL.md declares a custom `name:`, agent-kit ignores it
    // for routing. The destination folder is always <pkg-slug>-<skill-name>.
    await installFakePackage(nodeModules, "foo", [
      {
        name: "bar",
        body: "---\nname: custom-name\ndescription: x\n---\n\n# body\n",
      },
    ]);

    await syncSkills({ root: tempRoot, targets: ["claude"] });

    // Folder is foo-bar (derived), NOT custom-name (frontmatter)
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/foo-bar/SKILL.md")),
    ).toBe(true);
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/custom-name/SKILL.md")),
    ).toBe(false);
  });

  it("copies SKILL.md content verbatim — frontmatter is not rewritten", async () => {
    const originalBody =
      "---\nname: custom-display-name\ndescription: original\n---\n\n# original content\n";
    await installFakePackage(nodeModules, "foo", [
      { name: "bar", body: originalBody },
    ]);

    await syncSkills({ root: tempRoot, targets: ["claude"] });

    const synced = await readFile(
      resolve(tempRoot, ".claude/skills/foo-bar/SKILL.md"),
      "utf8",
    );
    expect(synced).toBe(originalBody);
  });

  it("skips a user-authored destination folder (no sentinel) by default", async () => {
    // Pre-existing user folder at the exact destination slug
    const userDir = resolve(tempRoot, ".claude/skills/foo-bar");
    await mkdir(userDir, { recursive: true });
    await writeFile(
      resolve(userDir, "SKILL.md"),
      "# user-authored, hands off",
      "utf8",
    );

    await installFakePackage(nodeModules, "foo", [
      { name: "bar", body: "# managed version" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    // User content preserved
    const content = await readFile(resolve(userDir, "SKILL.md"), "utf8");
    expect(content).toBe("# user-authored, hands off");

    // Sentinel not added to user folder
    expect(
      await fileExists(resolve(userDir, ".agent-kit-managed")),
    ).toBe(false);

    expect(result.skipped).toBe(1);
    expect(result.exported).toBe(0);
  });

  it("replaces a user-authored destination folder when override is true", async () => {
    const userDir = resolve(tempRoot, ".claude/skills/foo-bar");
    await mkdir(userDir, { recursive: true });
    await writeFile(
      resolve(userDir, "SKILL.md"),
      "# old user content",
      "utf8",
    );

    await installFakePackage(nodeModules, "foo", [
      { name: "bar", body: "# managed wins" },
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      override: true,
    });

    const content = await readFile(resolve(userDir, "SKILL.md"), "utf8");
    expect(content).toBe("# managed wins");
    expect(
      await fileExists(resolve(userDir, ".agent-kit-managed")),
    ).toBe(true);
    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("throws when two packages produce the same destination slug", async () => {
    // Two packages whose slug + skill happen to collide. Contrived because npm
    // prevents same-name packages, but we still defend against it.
    await installFakePackage(nodeModules, "foo-bar", [
      { name: "skill", body: "from foo-bar" },
    ]);
    await installFakePackage(nodeModules, "foo", [
      { name: "bar-skill", body: "from foo" },
    ]);

    // foo-bar + skill        → "foo-bar-skill"
    // foo + bar-skill        → "foo-bar-skill"  ← collision
    await expect(
      syncSkills({ root: tempRoot, targets: ["claude"] }),
    ).rejects.toThrow(/destination collision/);
  });

  it("skips a skill whose entire skills/ dir is a symlink pointing outside the package", async () => {
    // Secret directory living outside node_modules entirely — the attack target.
    const secretDir = resolve(tempRoot, "outside-package");
    await mkdir(secretDir, { recursive: true });
    await writeFile(resolve(secretDir, "SKILL.md"), "# leaked secret", "utf8");

    // Malicious package ships `skills/` itself as a symlink escaping the
    // package directory instead of a real folder (single-skill/root layout).
    const pkgDir = resolve(nodeModules, "evil");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      resolve(pkgDir, "package.json"),
      JSON.stringify({ name: "evil" }),
      "utf8",
    );
    await symlink(secretDir, resolve(pkgDir, "skills"), "dir");

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.skipped).toBe(1);
    expect(result.exported).toBe(0);
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/evil/SKILL.md")),
    ).toBe(false);
    // Nothing outside the package should have leaked into any managed dir.
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/outside-package/SKILL.md"),
      ),
    ).toBe(false);
  });

  it("skips a skill that contains a nested symlink escaping the package", async () => {
    const secretFile = resolve(tempRoot, "secret.txt");
    await writeFile(secretFile, "top secret contents", "utf8");

    await installFakePackage(nodeModules, "sneaky", [
      { name: "agent", body: "# looks legit" },
    ]);
    // Plant a symlink *inside* an otherwise-normal skill folder, pointing at
    // a file outside the package. fs.cp would otherwise recreate this
    // symlink verbatim at the destination.
    await symlink(
      secretFile,
      resolve(nodeModules, "sneaky", "skills", "agent", "leak.txt"),
      "file",
    );

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.skipped).toBe(1);
    expect(result.exported).toBe(0);
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/sneaky-agent/SKILL.md"),
      ),
    ).toBe(false);
  });

  it("still syncs a skill whose symlink resolves inside the package itself", async () => {
    await installFakePackage(nodeModules, "internal-link", [
      { name: "agent", body: "# real content" },
    ]);
    const pkgDir = resolve(nodeModules, "internal-link");
    // A symlink that points at another file within the SAME package is not
    // a supply-chain escape — it should be treated as safe.
    await writeFile(resolve(pkgDir, "notes.txt"), "internal notes", "utf8");
    await symlink(
      resolve(pkgDir, "notes.txt"),
      resolve(pkgDir, "skills", "agent", "notes-link.txt"),
      "file",
    );

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/internal-link-agent/SKILL.md"),
      ),
    ).toBe(true);
  });

  it("still syncs normal skill files with no symlinks involved", async () => {
    await installFakePackage(nodeModules, "clean", [
      { name: "agent", body: "# plain skill, no symlinks" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(0);
    const content = await readFile(
      resolve(tempRoot, ".claude/skills/clean-agent/SKILL.md"),
      "utf8",
    );
    expect(content).toBe("# plain skill, no symlinks");
  });
});

describe("syncSkills with agentKit config", () => {
  let tempRoot: string;
  let nodeModules: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-config-sync-"));
    nodeModules = resolve(tempRoot, "node_modules");
    await mkdir(nodeModules, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function writeRootPkg(body: Record<string, unknown>): Promise<void> {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify(body),
      "utf8",
    );
  }

  it("uses agentKit.targets as default when --target is not passed", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { targets: ["claude", "cursor"] },
    });
    await installFakePackage(nodeModules, "foo", [
      { name: "s", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot });

    expect(result.targets).toEqual(["claude", "cursor"]);
  });

  it("CLI-provided targets override agentKit.targets completely", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { targets: ["claude"] },
    });
    await installFakePackage(nodeModules, "foo", [
      { name: "s", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["cursor"] });

    expect(result.targets).toEqual(["cursor"]);
  });

  it("falls back to built-in default when no config and no CLI targets", async () => {
    await writeRootPkg({ name: "my-app" });
    await installFakePackage(nodeModules, "foo", [
      { name: "s", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot });

    expect(result.targets).toEqual([...DEFAULT_SKILLS_TARGETS]);
  });

  it("respects an empty agentKit.targets array (and warns)", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { targets: [] },
    });
    await installFakePackage(nodeModules, "foo", [
      { name: "s", body: "x" },
    ]);

    // The warning is logged via consola; we don't capture it here, but we
    // verify the empty array IS respected (no sync targets exercised).
    const result = await syncSkills({ root: tempRoot });

    expect(result.targets).toEqual([]);
    expect(result.exported).toBe(0);
  });

  it("omits an entire package when agentKit.omit[pkg] is true", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { omit: { excluded: true } },
    });
    await installFakePackage(nodeModules, "excluded", [
      { name: "s", body: "should not appear" },
    ]);
    await installFakePackage(nodeModules, "included", [
      { name: "s", body: "should appear" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual(["included"]);
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/excluded-s/SKILL.md")),
    ).toBe(false);
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/included-s/SKILL.md")),
    ).toBe(true);
  });

  it("omits specific skills when agentKit.omit[pkg] is a string[]", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { omit: { "@warlock.js/core": ["add-connector"] } },
    });
    await installFakePackage(nodeModules, "@warlock.js/core", [
      { name: "add-connector", body: "skip me" },
      { name: "keep-me", body: "keep" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual(["@warlock.js/core"]);
    expect(
      await fileExists(
        resolve(
          tempRoot,
          ".claude/skills/warlock-js-core-add-connector/SKILL.md",
        ),
      ),
    ).toBe(false);
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/warlock-js-core-keep-me/SKILL.md"),
      ),
    ).toBe(true);
  });

  it("drops a package whose only skills are all omitted", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { omit: { "@warlock.js/core": ["only-skill"] } },
    });
    await installFakePackage(nodeModules, "@warlock.js/core", [
      { name: "only-skill", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual([]);
  });

  it("silently ignores omit entries for packages that are not installed", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { omit: { "never-installed": true } },
    });
    await installFakePackage(nodeModules, "real", [
      { name: "s", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual(["real"]);
  });

  it("pick: includes only listed packages (true = whole package)", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { pick: { wanted: true } },
    });
    await installFakePackage(nodeModules, "wanted", [
      { name: "s", body: "wanted" },
    ]);
    await installFakePackage(nodeModules, "unwanted", [
      { name: "s", body: "should not appear" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual(["wanted"]);
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/wanted-s/SKILL.md")),
    ).toBe(true);
    expect(
      await fileExists(resolve(tempRoot, ".claude/skills/unwanted-s/SKILL.md")),
    ).toBe(false);
  });

  it("pick: includes only specific skills when value is a string[]", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { pick: { "@warlock.js/core": ["keep"] } },
    });
    await installFakePackage(nodeModules, "@warlock.js/core", [
      { name: "keep", body: "kept" },
      { name: "drop", body: "dropped" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual(["@warlock.js/core"]);
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/warlock-js-core-keep/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/warlock-js-core-drop/SKILL.md"),
      ),
    ).toBe(false);
  });

  it("pick + omit compose: pick allowlists package, omit removes specific skills", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: {
        pick: { "@warlock.js/core": true },
        omit: { "@warlock.js/core": ["unwanted"] },
      },
    });
    await installFakePackage(nodeModules, "@warlock.js/core", [
      { name: "keep", body: "kept" },
      { name: "unwanted", body: "removed" },
    ]);
    await installFakePackage(nodeModules, "@warlock.js/other", [
      { name: "ignored", body: "not picked" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual(["@warlock.js/core"]);
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/warlock-js-core-keep/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/warlock-js-core-unwanted/SKILL.md"),
      ),
    ).toBe(false);
    expect(
      await fileExists(
        resolve(tempRoot, ".claude/skills/warlock-js-other-ignored/SKILL.md"),
      ),
    ).toBe(false);
  });

  it("pick: drops a package whose every-skill subset doesn't match", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { pick: { foo: ["nonexistent"] } },
    });
    await installFakePackage(nodeModules, "foo", [
      { name: "real-skill", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual([]);
  });

  it("pick: empty {} excludes everything (warns)", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { pick: {} },
    });
    await installFakePackage(nodeModules, "foo", [
      { name: "s", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual([]);
    expect(result.exported).toBe(0);
  });

  it("pick: warns and exports nothing when pick names a package that isn't installed", async () => {
    await writeRootPkg({
      name: "my-app",
      agentKit: { pick: { "ghost-package": true } },
    });
    await installFakePackage(nodeModules, "real", [
      { name: "s", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages).toEqual([]);
  });

  it("falls back to the default targets when none are provided", async () => {
    const result = await syncSkills({ root: tempRoot });

    expect(result.targets).toEqual([...DEFAULT_SKILLS_TARGETS]);
  });

  it("returns the list of synced package names", async () => {
    await installFakePackage(nodeModules, "alpha", [
      { name: "a", body: "x" },
    ]);
    await installFakePackage(nodeModules, "beta", [
      { name: "b", body: "x" },
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.packages.sort()).toEqual(["alpha", "beta"]);
  });
});

describe("syncSkills with scanPaths", () => {
  let tempRoot: string;
  let nodeModules: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-scanpaths-"));
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    nodeModules = resolve(tempRoot, "node_modules");
    await mkdir(nodeModules, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("discovers packages from a single user-provided scan path", async () => {
    // Mimic the dev-server layout: framework folder at project root.
    const frameworkDir = resolve(tempRoot, "@warlock.js");
    await installFakePackage(frameworkDir, "cascade", [
      { name: "agent", body: "# cascade agent skill" },
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      scanPaths: ["@warlock.js"],
    });

    expect(result.packages).toContain("cascade");
    const skillPath = resolve(
      tempRoot,
      ".claude/skills/cascade-agent/SKILL.md",
    );
    expect(await fileExists(skillPath)).toBe(true);
  });

  it("discovers scoped packages when scanPath is the project root (dev-server layout)", async () => {
    // Mimics the warlock dev-server: framework packages live as
    // <projectRoot>/@warlock.js/<pkg>/ rather than under node_modules/.
    // Pointing scanPath at "." treats projectRoot itself as a node_modules,
    // so the @-scope descent logic picks up @warlock.js/core.
    await installFakePackage(tempRoot, "@warlock.js/core", [
      { name: "send-response", body: "# core skill" },
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      scanPaths: ["."],
    });

    expect(result.packages).toContain("@warlock.js/core");
    const skillPath = resolve(
      tempRoot,
      ".claude/skills/warlock-js-core-send-response/SKILL.md",
    );
    expect(await fileExists(skillPath)).toBe(true);
  });

  it("merges packages from node_modules and scanPaths", async () => {
    await installFakePackage(nodeModules, "from-node-modules", [
      { name: "n", body: "x" },
    ]);
    await installFakePackage(resolve(tempRoot, "workspace"), "from-workspace", [
      { name: "w", body: "x" },
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      scanPaths: ["workspace"],
    });

    expect(result.packages.sort()).toEqual([
      "from-node-modules",
      "from-workspace",
    ]);
  });

  it("scanPath package wins when the same name appears in node_modules (local override)", async () => {
    // The same package exists in both — workspace version should win.
    // Flat name: dual + v → dual-v
    await installFakePackage(nodeModules, "dual", [
      { name: "v", body: "# node_modules version" },
    ]);
    await installFakePackage(resolve(tempRoot, "workspace"), "dual", [
      { name: "v", body: "# workspace version" },
    ]);

    await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      scanPaths: ["workspace"],
    });

    const synced = await readFile(
      resolve(tempRoot, ".claude/skills/dual-v/SKILL.md"),
      "utf8",
    );
    expect(synced).toBe("# workspace version");
  });

  it("silently skips a scan path that does not exist", async () => {
    await installFakePackage(nodeModules, "real", [
      { name: "r", body: "x" },
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      scanPaths: ["nonexistent-dir"],
    });

    expect(result.packages).toEqual(["real"]);
  });

  it("supports multiple comma-separated scan paths", async () => {
    await installFakePackage(resolve(tempRoot, "a"), "a-pkg", [
      { name: "a", body: "x" },
    ]);
    await installFakePackage(resolve(tempRoot, "b"), "b-pkg", [
      { name: "b", body: "x" },
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      scanPaths: ["a", "b"],
    });

    expect(result.packages.sort()).toEqual(["a-pkg", "b-pkg"]);
  });

  it("resolves absolute scan paths as-is", async () => {
    const absDir = resolve(tempRoot, "absolute-workspace");
    await installFakePackage(absDir, "abs-pkg", [
      { name: "s", body: "x" },
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      scanPaths: [absDir],
    });

    expect(result.packages).toContain("abs-pkg");
  });

  it("reports scannedPaths in the result, with node_modules first", async () => {
    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      scanPaths: ["custom-a", "custom-b"],
    });

    expect(result.scannedPaths).toEqual([
      resolve(tempRoot, "node_modules"),
      resolve(tempRoot, "custom-a"),
      resolve(tempRoot, "custom-b"),
    ]);
  });
});
