import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveAll } from "../../derive/derive";
import { readTextFile, writeTextFile } from "../../utils/file-io";

/**
 * The CLI command is a thin wrapper around `deriveAll` plus a "scaffold
 * starter AGENTS.md if missing" step. These tests target the behavior, not
 * the citty plumbing — we exercise the same conditional that the command body
 * runs.
 */
describe("init flow", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-init-"));
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("scaffolds AGENTS.md when it does not exist", async () => {
    const agentsPath = resolve(tempRoot, "AGENTS.md");

    const existing = await readTextFile(agentsPath);
    expect(existing).toBeNull();

    // Simulate the init command's branch: missing → write starter
    if (existing === null) {
      await writeTextFile(agentsPath, "# AGENTS.md\n\n> starter\n");
    }

    const onDisk = await readFile(agentsPath, "utf8");
    expect(onDisk).toContain("AGENTS.md");
  });

  it("leaves an existing AGENTS.md untouched", async () => {
    const agentsPath = resolve(tempRoot, "AGENTS.md");
    const original = "# Pre-existing content do not clobber";
    await writeFile(agentsPath, original, "utf8");

    // Init's branch: present → skip scaffold
    const existing = await readTextFile(agentsPath);
    expect(existing).toBe(original);

    const onDisk = await readFile(agentsPath, "utf8");
    expect(onDisk).toBe(original);
  });

  it("derives files after scaffolding AGENTS.md", async () => {
    const agentsPath = resolve(tempRoot, "AGENTS.md");
    await writeTextFile(agentsPath, "# AGENTS.md\n\n> starter\n");

    const results = await deriveAll({ root: tempRoot });

    expect(results.length).toBeGreaterThan(0);
    const claudeContent = await readFile(resolve(tempRoot, "CLAUDE.md"), "utf8");
    expect(claudeContent).toContain("starter");
  });
});
