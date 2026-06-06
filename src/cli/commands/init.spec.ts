import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureAgentKitTargets,
  ensurePostinstallScript,
} from "../../config/init-package-json";
import { deriveAll } from "../../derive/derive";
import { readTextFile, writeTextFile } from "../../utils/file-io";
import { initCommand } from "./init";

/** Drive the citty command body directly (it only reads `args`). */
const runInit = (args: { cwd: string; target?: string }) =>
  (initCommand.run as (ctx: { args: typeof args }) => Promise<void>)({ args });

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

describe("ensureAgentKitTargets", () => {
  let tempRoot: string;
  const pkgPath = () => resolve(tempRoot, "package.json");
  const readPkg = async () =>
    JSON.parse(await readFile(pkgPath(), "utf8")) as Record<string, unknown> & {
      agentKit?: { targets?: string[] };
    };

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-targets-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("seeds the default [claude] when package.json has no agentKit block", async () => {
    await writeFile(pkgPath(), '{\n  "name": "demo"\n}\n', "utf8");

    const result = await ensureAgentKitTargets({ root: tempRoot });

    expect(result.action).toBe("created");
    const pkg = await readPkg();
    expect(pkg.agentKit?.targets).toEqual(["claude"]);
    // Existing fields are preserved.
    expect(pkg.name).toBe("demo");
  });

  it("writes the explicit targets passed in", async () => {
    await writeFile(pkgPath(), "{}\n", "utf8");

    const result = await ensureAgentKitTargets({
      root: tempRoot,
      targets: ["claude", "cursor"],
    });

    expect(result.action).toBe("created");
    const pkg = await readPkg();
    expect(pkg.agentKit?.targets).toEqual(["claude", "cursor"]);
  });

  it("leaves an existing agentKit.targets untouched by default", async () => {
    await writeFile(
      pkgPath(),
      JSON.stringify({ agentKit: { targets: ["cursor"] } }, null, 2),
      "utf8",
    );

    const result = await ensureAgentKitTargets({ root: tempRoot });

    expect(result.action).toBe("unchanged");
    expect(result.targets).toEqual(["cursor"]);
    const pkg = await readPkg();
    expect(pkg.agentKit?.targets).toEqual(["cursor"]);
  });

  it("overwrites an existing agentKit.targets when overwrite is true", async () => {
    await writeFile(
      pkgPath(),
      JSON.stringify({ agentKit: { targets: ["cursor"] } }, null, 2),
      "utf8",
    );

    const result = await ensureAgentKitTargets({
      root: tempRoot,
      targets: ["claude", "codex"],
      overwrite: true,
    });

    expect(result.action).toBe("updated");
    const pkg = await readPkg();
    expect(pkg.agentKit?.targets).toEqual(["claude", "codex"]);
  });

  it("adds targets to an existing agentKit block that lacks them, preserving siblings", async () => {
    await writeFile(
      pkgPath(),
      JSON.stringify(
        { agentKit: { pick: { "@warlock.js/core": true } } },
        null,
        2,
      ),
      "utf8",
    );

    const result = await ensureAgentKitTargets({ root: tempRoot });

    expect(result.action).toBe("added");
    const pkg = await readPkg();
    expect(pkg.agentKit?.targets).toEqual(["claude"]);
    expect((pkg.agentKit as Record<string, unknown>).pick).toEqual({
      "@warlock.js/core": true,
    });
  });

  it("preserves the file's existing indentation", async () => {
    // Four-space indented manifest.
    await writeFile(pkgPath(), '{\n    "name": "demo"\n}\n', "utf8");

    await ensureAgentKitTargets({ root: tempRoot });

    const raw = await readFile(pkgPath(), "utf8");
    expect(raw).toContain('\n    "agentKit": {');
    expect(raw).toContain('\n        "targets": [');
  });

  it("throws on an unknown target name", async () => {
    await writeFile(pkgPath(), "{}\n", "utf8");

    await expect(
      ensureAgentKitTargets({
        root: tempRoot,
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        targets: ["claude", "not-a-real-agent" as any],
      }),
    ).rejects.toThrow(/Unknown skill target/);
  });

  it("is a no-op when no manifest exists", async () => {
    const result = await ensureAgentKitTargets({ root: tempRoot });

    expect(result.action).toBe("unchanged");
    expect(result.manifestPath).toBeNull();
  });
});

describe("ensurePostinstallScript", () => {
  let tempRoot: string;
  const pkgPath = () => resolve(tempRoot, "package.json");
  const readPkg = async () =>
    JSON.parse(await readFile(pkgPath(), "utf8")) as {
      scripts?: Record<string, string>;
    };

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-postinstall-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("wires postinstall when @mongez/agent-kit is a devDependency and none exists", async () => {
    await writeFile(
      pkgPath(),
      JSON.stringify(
        { devDependencies: { "@mongez/agent-kit": "^1.2.0" } },
        null,
        2,
      ),
      "utf8",
    );

    const result = await ensurePostinstallScript({ root: tempRoot });

    expect(result.action).toBe("wired");
    const pkg = await readPkg();
    expect(pkg.scripts?.postinstall).toBe("agent-kit sync");
  });

  it("wires postinstall when agent-kit is a regular dependency", async () => {
    await writeFile(
      pkgPath(),
      JSON.stringify({ dependencies: { "@mongez/agent-kit": "1.2.0" } }, null, 2),
      "utf8",
    );

    const result = await ensurePostinstallScript({ root: tempRoot });

    expect(result.action).toBe("wired");
    expect((await readPkg()).scripts?.postinstall).toBe("agent-kit sync");
  });

  it("skips (not-a-dep) when agent-kit is not a declared dependency", async () => {
    await writeFile(pkgPath(), JSON.stringify({ name: "demo" }, null, 2), "utf8");

    const result = await ensurePostinstallScript({ root: tempRoot });

    expect(result.action).toBe("skipped-not-a-dep");
    expect((await readPkg()).scripts).toBeUndefined();
  });

  it("skips (existing) and preserves a postinstall the user already wrote", async () => {
    await writeFile(
      pkgPath(),
      JSON.stringify(
        {
          devDependencies: { "@mongez/agent-kit": "^1.2.0" },
          scripts: { postinstall: "husky install", build: "tsc" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await ensurePostinstallScript({ root: tempRoot });

    expect(result.action).toBe("skipped-existing");
    expect(result.command).toBe("husky install");
    const pkg = await readPkg();
    expect(pkg.scripts?.postinstall).toBe("husky install");
    expect(pkg.scripts?.build).toBe("tsc");
  });

  it("preserves sibling scripts when wiring postinstall", async () => {
    await writeFile(
      pkgPath(),
      JSON.stringify(
        {
          devDependencies: { "@mongez/agent-kit": "^1.2.0" },
          scripts: { build: "tsc", test: "vitest run" },
        },
        null,
        2,
      ),
      "utf8",
    );

    await ensurePostinstallScript({ root: tempRoot });

    const pkg = await readPkg();
    expect(pkg.scripts?.postinstall).toBe("agent-kit sync");
    expect(pkg.scripts?.build).toBe("tsc");
    expect(pkg.scripts?.test).toBe("vitest run");
  });

  it("is a no-op when no manifest exists", async () => {
    const result = await ensurePostinstallScript({ root: tempRoot });

    expect(result.action).toBe("unchanged");
    expect(result.manifestPath).toBeNull();
  });
});

describe("init command (end-to-end)", () => {
  let tempRoot: string;
  const readPkg = async () =>
    JSON.parse(
      await readFile(resolve(tempRoot, "package.json"), "utf8"),
    ) as {
      agentKit?: { targets?: string[] };
      scripts?: Record<string, string>;
    };

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-init-e2e-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("scaffolds, derives, seeds default targets, and wires postinstall when agent-kit is a dep", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify(
        { name: "demo", devDependencies: { "@mongez/agent-kit": "^1.2.0" } },
        null,
        2,
      ),
      "utf8",
    );

    await runInit({ cwd: tempRoot });

    // AGENTS.md scaffolded + CLAUDE.md derived from it.
    expect(await readTextFile(resolve(tempRoot, "AGENTS.md"))).toContain(
      "AGENTS.md",
    );
    expect(await readTextFile(resolve(tempRoot, "CLAUDE.md"))).not.toBeNull();

    const pkg = await readPkg();
    expect(pkg.agentKit?.targets).toEqual(["claude"]);
    // agent-kit is a devDependency → postinstall wired.
    expect(pkg.scripts?.postinstall).toBe("agent-kit sync");
  });

  it("seeds the chosen --target list and skips postinstall when agent-kit is not a dep", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}\n", "utf8");

    await runInit({ cwd: tempRoot, target: "claude,cursor" });

    const pkg = await readPkg();
    expect(pkg.agentKit?.targets).toEqual(["claude", "cursor"]);
    // Not a dependency → no postinstall wired (avoids a broken install step).
    expect(pkg.scripts).toBeUndefined();
  });
});
