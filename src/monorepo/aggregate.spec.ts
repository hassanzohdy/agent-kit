import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncSkills } from "../skills/sync-skills";

/**
 * End-to-end coverage of monorepo aggregation: each declared project is scanned
 * as its own project (its node_modules deps filtered by its own agentKit
 * config, plus its authored skills/ prefixed by the project dir slug) and
 * merged into the root's `.claude/skills/`.
 */

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Install a fake dependency (name + skill folders) under a node_modules dir. */
async function installDep(
  nodeModules: string,
  pkgName: string,
  skillNames: string[],
): Promise<void> {
  const pkgDir = pkgName.startsWith("@")
    ? resolve(nodeModules, ...pkgName.split("/"))
    : resolve(nodeModules, pkgName);
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    resolve(pkgDir, "package.json"),
    JSON.stringify({ name: pkgName }),
    "utf8",
  );
  for (const name of skillNames) {
    const dir = resolve(pkgDir, "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, "SKILL.md"), `# ${pkgName}/${name}`, "utf8");
  }
}

/** Scaffold a project dir with a package.json and nested authored skills. */
async function writeProject(
  root: string,
  rel: string,
  pkgJson: Record<string, unknown>,
  authoredSkills: string[],
): Promise<string> {
  const dir = resolve(root, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "package.json"),
    JSON.stringify(pkgJson),
    "utf8",
  );
  for (const name of authoredSkills) {
    const skillDir = resolve(dir, "skills", name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(resolve(skillDir, "SKILL.md"), `# ${rel}/${name}`, "utf8");
  }
  return dir;
}

describe("syncSkills monorepo aggregation", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-monorepo-"));
    await mkdir(resolve(tempRoot, "node_modules"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const claudeSkill = (slug: string) =>
    resolve(tempRoot, ".claude/skills", slug, "SKILL.md");

  it("prefixes authored project skills with the project dir name", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    await writeProject(tempRoot, "backend", { name: "@acme/backend" }, [
      "code-standards",
    ]);
    await writeProject(tempRoot, "frontend", { name: "@acme/frontend" }, [
      "forms",
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      projects: ["backend", "frontend"],
    });

    expect(result.projects).toEqual(["backend", "frontend"]);
    expect(await fileExists(claudeSkill("backend-code-standards"))).toBe(true);
    expect(await fileExists(claudeSkill("frontend-forms"))).toBe(true);
  });

  it("keeps same-named authored skills from different projects distinct", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    await writeProject(tempRoot, "backend", { name: "@acme/backend" }, [
      "code-standards",
    ]);
    await writeProject(tempRoot, "frontend", { name: "@acme/frontend" }, [
      "code-standards",
    ]);

    await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      projects: ["backend", "frontend"],
    });

    expect(
      await readSkill(claudeSkill("backend-code-standards")),
    ).toContain("backend/code-standards");
    expect(
      await readSkill(claudeSkill("frontend-code-standards")),
    ).toContain("frontend/code-standards");
  });

  it("honors each project's own agentKit.omit for its node_modules", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    const backend = await writeProject(
      tempRoot,
      "backend",
      { name: "@acme/backend", agentKit: { omit: { "@acme/noisy": true } } },
      ["code-standards"],
    );
    await installDep(resolve(backend, "node_modules"), "@acme/noisy", ["junk"]);
    await installDep(resolve(backend, "node_modules"), "@acme/useful", [
      "do-thing",
    ]);

    await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      projects: ["backend"],
    });

    expect(await fileExists(claudeSkill("acme-noisy-junk"))).toBe(false);
    expect(await fileExists(claudeSkill("acme-useful-do-thing"))).toBe(true);
  });

  it("dedupes a shared dependency and unions kept skills across projects", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    // backend omits the "shared" skill; frontend keeps everything.
    const backend = await writeProject(
      tempRoot,
      "backend",
      {
        name: "@acme/backend",
        agentKit: { omit: { "@warlock.js/core": ["shared"] } },
      },
      [],
    );
    const frontend = await writeProject(
      tempRoot,
      "frontend",
      { name: "@acme/frontend" },
      [],
    );
    await installDep(resolve(backend, "node_modules"), "@warlock.js/core", [
      "keep",
      "shared",
    ]);
    await installDep(resolve(frontend, "node_modules"), "@warlock.js/core", [
      "keep",
      "shared",
    ]);

    const result = await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      projects: ["backend", "frontend"],
    });

    // "shared" survives via union (frontend kept it); "keep" present once.
    expect(await fileExists(claudeSkill("warlock-js-core-keep"))).toBe(true);
    expect(await fileExists(claudeSkill("warlock-js-core-shared"))).toBe(true);
    // Deduped to one package entry, not two.
    expect(
      result.packages.filter((p) => p === "@warlock.js/core"),
    ).toHaveLength(1);
  });

  it("applies the root's omit as a global veto over project deps", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "root-app",
        agentKit: { omit: { "@acme/vetoed": true } },
      }),
      "utf8",
    );
    const frontend = await writeProject(
      tempRoot,
      "frontend",
      { name: "@acme/frontend" },
      [],
    );
    await installDep(resolve(frontend, "node_modules"), "@acme/vetoed", [
      "blocked",
    ]);
    await installDep(resolve(frontend, "node_modules"), "@acme/allowed", [
      "ok",
    ]);

    await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      projects: ["frontend"],
    });

    expect(await fileExists(claudeSkill("acme-vetoed-blocked"))).toBe(false);
    expect(await fileExists(claudeSkill("acme-allowed-ok"))).toBe(true);
  });

  it("reads projects from root agentKit.monorepo.projects when no option passed", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "root-app",
        agentKit: { monorepo: { projects: ["backend"] } },
      }),
      "utf8",
    );
    await writeProject(tempRoot, "backend", { name: "@acme/backend" }, [
      "code-standards",
    ]);

    const result = await syncSkills({ root: tempRoot, targets: ["claude"] });

    expect(result.projects).toEqual(["backend"]);
    expect(await fileExists(claudeSkill("backend-code-standards"))).toBe(true);
  });

  it("honors a project's pick allowlist for its node_modules", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    const backend = await writeProject(
      tempRoot,
      "backend",
      { name: "@acme/backend", agentKit: { pick: { "@acme/wanted": true } } },
      ["code-standards"],
    );
    await installDep(resolve(backend, "node_modules"), "@acme/wanted", ["yes"]);
    await installDep(resolve(backend, "node_modules"), "@acme/unwanted", [
      "no",
    ]);

    await syncSkills({
      root: tempRoot,
      targets: ["claude"],
      projects: ["backend"],
    });

    // pick (a dependency allowlist) never drops the project's own authored skills.
    expect(await fileExists(claudeSkill("backend-code-standards"))).toBe(true);
    expect(await fileExists(claudeSkill("acme-wanted-yes"))).toBe(true);
    expect(await fileExists(claudeSkill("acme-unwanted-no"))).toBe(false);
  });
});

async function readSkill(p: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(p, "utf8");
}
