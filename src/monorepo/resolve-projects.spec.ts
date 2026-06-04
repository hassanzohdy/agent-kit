import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMonorepoProjects } from "./resolve-projects";

describe("resolveMonorepoProjects", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-projects-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function mkdirs(...rels: string[]): Promise<void> {
    for (const rel of rels) {
      await mkdir(resolve(tempRoot, rel), { recursive: true });
    }
  }

  it("returns [] for undefined / empty patterns", async () => {
    expect(await resolveMonorepoProjects(tempRoot, undefined)).toEqual([]);
    expect(await resolveMonorepoProjects(tempRoot, [])).toEqual([]);
  });

  it("resolves a literal directory with a flat slug", async () => {
    await mkdirs("backend");

    const result = await resolveMonorepoProjects(tempRoot, ["backend"]);

    expect(result).toEqual([
      { dir: resolve(tempRoot, "backend"), slug: "backend" },
    ]);
  });

  it("slugifies a nested literal path with '-'", async () => {
    await mkdirs("apps/admin");

    const result = await resolveMonorepoProjects(tempRoot, ["apps/admin"]);

    expect(result).toEqual([
      { dir: resolve(tempRoot, "apps/admin"), slug: "apps-admin" },
    ]);
  });

  it("skips a literal path that does not exist", async () => {
    const result = await resolveMonorepoProjects(tempRoot, ["nope"]);
    expect(result).toEqual([]);
  });

  it("expands a one-level glob into each immediate subdirectory", async () => {
    await mkdirs("apps/admin", "apps/storefront", "apps/.hidden");
    await mkdir(resolve(tempRoot, "apps/node_modules"), { recursive: true });

    const result = await resolveMonorepoProjects(tempRoot, ["apps/*"]);

    expect(result.map((p) => p.slug)).toEqual(["apps-admin", "apps-storefront"]);
  });

  it("expands a bare '*' against the root", async () => {
    await mkdirs("backend", "frontend");
    await mkdir(resolve(tempRoot, "node_modules"), { recursive: true });

    const result = await resolveMonorepoProjects(tempRoot, ["*"]);

    expect(result.map((p) => p.slug)).toEqual(["backend", "frontend"]);
  });

  it("de-duplicates the same project reached via two patterns", async () => {
    await mkdirs("apps/admin");

    const result = await resolveMonorepoProjects(tempRoot, [
      "apps/admin",
      "apps/*",
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("apps-admin");
  });

  it("never returns root itself", async () => {
    const result = await resolveMonorepoProjects(tempRoot, ["."]);
    expect(result).toEqual([]);
  });

  it("yields no matches for unsupported multi-level / mid-path globs", async () => {
    await mkdirs("apps/admin/web");

    expect(await resolveMonorepoProjects(tempRoot, ["apps/*/web"])).toEqual([]);
    expect(await resolveMonorepoProjects(tempRoot, ["apps/**"])).toEqual([]);
  });
});
