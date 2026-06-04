import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgentKitConfig } from "./agent-kit-config";

describe("loadAgentKitConfig", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-config-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns null when there is no manifest", async () => {
    const result = await loadAgentKitConfig(tempRoot);
    expect(result).toBeNull();
  });

  it("returns null when manifest has no agentKit field", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({ name: "my-app" }),
      "utf8",
    );
    const result = await loadAgentKitConfig(tempRoot);
    expect(result).toBeNull();
  });

  it("returns null when manifest is invalid JSON", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{ not json", "utf8");
    const result = await loadAgentKitConfig(tempRoot);
    expect(result).toBeNull();
  });

  it("loads targets array from agentKit.targets", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: { targets: ["claude", "cursor"] },
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result?.targets).toEqual(["claude", "cursor"]);
  });

  it("preserves an explicit empty targets array (caller decides what to do)", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: { targets: [] },
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result?.targets).toEqual([]);
  });

  it("loads omit map with true (whole-package omit)", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: { omit: { "@warlock.js/ai": true } },
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result?.omit).toEqual({ "@warlock.js/ai": true });
  });

  it("loads omit map with string[] (per-skill omit)", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: {
          omit: { "@warlock.js/core": ["add-connector", "benchmark-code"] },
        },
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result?.omit).toEqual({
      "@warlock.js/core": ["add-connector", "benchmark-code"],
    });
  });

  it("loads both targets and omit together", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: {
          targets: ["claude"],
          omit: {
            "@warlock.js/ai": true,
            "@warlock.js/core": ["add-connector"],
          },
        },
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result?.targets).toEqual(["claude"]);
    expect(result?.omit).toEqual({
      "@warlock.js/ai": true,
      "@warlock.js/core": ["add-connector"],
    });
  });

  it("drops malformed targets entries (non-strings) instead of throwing", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: { targets: ["claude", 42, null, "cursor"] },
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result?.targets).toEqual(["claude", "cursor"]);
  });

  it("drops malformed omit values silently", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: {
          omit: {
            "@valid/ok": true,
            "@invalid/false-value": false, // not allowed
            "@invalid/object-value": { foo: "bar" }, // not allowed
            "@invalid/empty-array": [],
          },
        },
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result?.omit).toEqual({ "@valid/ok": true });
  });

  it("falls back to _package.json when package.json is missing", async () => {
    await writeFile(
      resolve(tempRoot, "_package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: { targets: ["claude"] },
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result?.targets).toEqual(["claude"]);
  });

  it("returns empty config object when agentKit is present but empty", async () => {
    await writeFile(
      resolve(tempRoot, "package.json"),
      JSON.stringify({
        name: "my-app",
        agentKit: {},
      }),
      "utf8",
    );

    const result = await loadAgentKitConfig(tempRoot);

    expect(result).toEqual({});
  });

  describe("pick (allowlist)", () => {
    it("loads pick map with true (whole-package include)", async () => {
      await writeFile(
        resolve(tempRoot, "package.json"),
        JSON.stringify({
          name: "my-app",
          agentKit: { pick: { "@warlock.js/core": true } },
        }),
        "utf8",
      );

      const result = await loadAgentKitConfig(tempRoot);

      expect(result?.pick).toEqual({ "@warlock.js/core": true });
    });

    it("loads pick map with string[] (per-skill include)", async () => {
      await writeFile(
        resolve(tempRoot, "package.json"),
        JSON.stringify({
          name: "my-app",
          agentKit: {
            pick: { "@warlock.js/core": ["use-cache", "register-route"] },
          },
        }),
        "utf8",
      );

      const result = await loadAgentKitConfig(tempRoot);

      expect(result?.pick).toEqual({
        "@warlock.js/core": ["use-cache", "register-route"],
      });
    });

    it("preserves an explicit empty pick object as {} (signals 'no packages')", async () => {
      await writeFile(
        resolve(tempRoot, "package.json"),
        JSON.stringify({
          name: "my-app",
          agentKit: { pick: {} },
        }),
        "utf8",
      );

      const result = await loadAgentKitConfig(tempRoot);

      expect(result?.pick).toEqual({});
    });

    it("loads pick and omit together", async () => {
      await writeFile(
        resolve(tempRoot, "package.json"),
        JSON.stringify({
          name: "my-app",
          agentKit: {
            pick: { "@warlock.js/core": true },
            omit: { "@warlock.js/core": ["add-connector"] },
          },
        }),
        "utf8",
      );

      const result = await loadAgentKitConfig(tempRoot);

      expect(result?.pick).toEqual({ "@warlock.js/core": true });
      expect(result?.omit).toEqual({ "@warlock.js/core": ["add-connector"] });
    });

    it("drops a pick map where every entry is malformed (treated as unset)", async () => {
      await writeFile(
        resolve(tempRoot, "package.json"),
        JSON.stringify({
          name: "my-app",
          agentKit: {
            pick: {
              "@bad/false-value": false,
              "@bad/empty-array": [],
            },
          },
        }),
        "utf8",
      );

      const result = await loadAgentKitConfig(tempRoot);

      // All entries failed validation — pick stays undefined so we don't
      // accidentally allowlist an empty set.
      expect(result?.pick).toBeUndefined();
    });
  });

  describe("monorepo.projects", () => {
    it("loads a string[] of project patterns", async () => {
      await writeFile(
        resolve(tempRoot, "package.json"),
        JSON.stringify({
          name: "my-app",
          agentKit: { monorepo: { projects: ["backend", "frontend"] } },
        }),
        "utf8",
      );

      const result = await loadAgentKitConfig(tempRoot);

      expect(result?.monorepo).toEqual({ projects: ["backend", "frontend"] });
    });

    it("drops non-string project entries", async () => {
      await writeFile(
        resolve(tempRoot, "package.json"),
        JSON.stringify({
          name: "my-app",
          agentKit: { monorepo: { projects: ["backend", 1, null, "apps/*"] } },
        }),
        "utf8",
      );

      const result = await loadAgentKitConfig(tempRoot);

      expect(result?.monorepo).toEqual({ projects: ["backend", "apps/*"] });
    });

    it("leaves monorepo unset when projects is missing or malformed", async () => {
      await writeFile(
        resolve(tempRoot, "package.json"),
        JSON.stringify({
          name: "my-app",
          agentKit: { monorepo: { projects: "not-an-array" } },
        }),
        "utf8",
      );

      const result = await loadAgentKitConfig(tempRoot);

      expect(result?.monorepo).toBeUndefined();
    });
  });
});
