import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDerivedContent, deriveAll } from "./derive";
import { getDeriveTarget } from "./targets";

const SAMPLE_AGENTS_MD = `# AGENTS.md

## Commands
- yarn dev

## Code style
- two-space indent
`;

describe("buildDerivedContent", () => {
  it("prepends a comment header that names the source file", () => {
    const target = getDeriveTarget("claude");

    const result = buildDerivedContent(target, "AGENTS.md", "BODY");

    expect(result.startsWith("<!--")).toBe(true);
    expect(result).toContain("auto-generated from AGENTS.md");
    expect(result).toContain("for Claude Code");
    expect(result).toContain("BODY");
  });

  it("preserves the original source content verbatim after the header", () => {
    const target = getDeriveTarget("gemini");

    const result = buildDerivedContent(target, "AGENTS.md", SAMPLE_AGENTS_MD);

    expect(result.endsWith(SAMPLE_AGENTS_MD)).toBe(true);
  });

  it("includes a do-not-edit warning", () => {
    const target = getDeriveTarget("copilot");

    const result = buildDerivedContent(target, "AGENTS.md", "x");

    expect(result.toLowerCase()).toContain("do not edit");
  });

  it("references a custom source file name when provided", () => {
    const target = getDeriveTarget("aider");

    const result = buildDerivedContent(target, "MY-AGENTS.md", "x");

    expect(result).toContain("from MY-AGENTS.md");
    expect(result).toContain("./MY-AGENTS.md");
  });
});

describe("deriveAll", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-derive-"));
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("throws a helpful error when AGENTS.md is missing", async () => {
    await expect(deriveAll({ root: tempRoot })).rejects.toThrow(
      /Source file not found/,
    );
    await expect(deriveAll({ root: tempRoot })).rejects.toThrow(/agent-kit init/);
  });

  it("writes one file per default target on a fresh project", async () => {
    await writeFile(resolve(tempRoot, "AGENTS.md"), SAMPLE_AGENTS_MD, "utf8");

    const results = await deriveAll({ root: tempRoot });

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.changed)).toBe(true);

    const claudeContent = await readFile(resolve(tempRoot, "CLAUDE.md"), "utf8");
    const geminiContent = await readFile(
      resolve(tempRoot, ".gemini/GEMINI.md"),
      "utf8",
    );
    const copilotContent = await readFile(
      resolve(tempRoot, ".github/copilot-instructions.md"),
      "utf8",
    );
    const aiderContent = await readFile(
      resolve(tempRoot, "CONVENTIONS.md"),
      "utf8",
    );

    expect(claudeContent).toContain(SAMPLE_AGENTS_MD);
    expect(geminiContent).toContain(SAMPLE_AGENTS_MD);
    expect(copilotContent).toContain(SAMPLE_AGENTS_MD);
    expect(aiderContent).toContain(SAMPLE_AGENTS_MD);
  });

  it("creates nested parent directories for deep targets", async () => {
    await writeFile(resolve(tempRoot, "AGENTS.md"), SAMPLE_AGENTS_MD, "utf8");

    await deriveAll({ root: tempRoot });

    // .gemini/ and .github/ both need mkdir -p
    const gemini = await readFile(
      resolve(tempRoot, ".gemini/GEMINI.md"),
      "utf8",
    );
    expect(gemini).toBeTruthy();
  });

  it("is idempotent — second run reports no changes", async () => {
    await writeFile(resolve(tempRoot, "AGENTS.md"), SAMPLE_AGENTS_MD, "utf8");

    await deriveAll({ root: tempRoot });
    const second = await deriveAll({ root: tempRoot });

    expect(second.every((r) => !r.changed)).toBe(true);
  });

  it("detects changes when AGENTS.md is updated between runs", async () => {
    await writeFile(resolve(tempRoot, "AGENTS.md"), SAMPLE_AGENTS_MD, "utf8");
    await deriveAll({ root: tempRoot });

    await writeFile(resolve(tempRoot, "AGENTS.md"), `${SAMPLE_AGENTS_MD}\n## New section\n`, "utf8");
    const second = await deriveAll({ root: tempRoot });

    expect(second.every((r) => r.changed)).toBe(true);
  });

  it("derives only the requested subset when targets is provided", async () => {
    await writeFile(resolve(tempRoot, "AGENTS.md"), SAMPLE_AGENTS_MD, "utf8");

    const results = await deriveAll({
      root: tempRoot,
      targets: ["claude"],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.target).toBe("claude");
  });

  it("supports a custom source file name", async () => {
    await writeFile(
      resolve(tempRoot, "AGENTS.custom.md"),
      SAMPLE_AGENTS_MD,
      "utf8",
    );

    const results = await deriveAll({
      root: tempRoot,
      sourceFile: "AGENTS.custom.md",
      targets: ["claude"],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.changed).toBe(true);
    const claudeContent = await readFile(resolve(tempRoot, "CLAUDE.md"), "utf8");
    expect(claudeContent).toContain("AGENTS.custom.md");
  });

  it("returns absolute paths in results", async () => {
    await writeFile(resolve(tempRoot, "AGENTS.md"), SAMPLE_AGENTS_MD, "utf8");

    const results = await deriveAll({ root: tempRoot, targets: ["claude"] });

    expect(results[0]?.outputPath).toBe(resolve(tempRoot, "CLAUDE.md"));
  });
});
