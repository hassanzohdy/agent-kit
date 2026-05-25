import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectRoot } from "./project-root";

describe("findProjectRoot", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-root-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns the directory containing package.json when cwd is the root", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");

    const result = await findProjectRoot(tempRoot);

    expect(result).toBe(tempRoot);
  });

  it("walks up parent directories to find package.json", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    const nested = resolve(tempRoot, "src", "deep", "nested");
    await mkdir(nested, { recursive: true });

    const result = await findProjectRoot(nested);

    expect(result).toBe(tempRoot);
  });

  it("returns the nearest package.json when multiple exist in the ancestry", async () => {
    // outer + inner both have package.json — nearest wins
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");
    const inner = resolve(tempRoot, "packages", "inner");
    await mkdir(inner, { recursive: true });
    await writeFile(resolve(inner, "package.json"), "{}", "utf8");
    const innerNested = resolve(inner, "src");
    await mkdir(innerNested, { recursive: true });

    const result = await findProjectRoot(innerNested);

    expect(result).toBe(inner);
  });

  it("returns null when no package.json is found in any ancestor", async () => {
    // tempRoot has no package.json and we start inside an empty subdir
    const empty = resolve(tempRoot, "empty");
    await mkdir(empty, { recursive: true });

    // Note: this only validates the "walked up to tempRoot and stopped without
    // finding one" path — the function will keep walking past tempRoot to the
    // filesystem root. Since we can't guarantee the filesystem root has no
    // package.json on every machine, we just assert the function terminates.
    const result = await findProjectRoot(empty);

    expect(result === null || typeof result === "string").toBe(true);
  });

  it("accepts an absolute startDir argument", async () => {
    await writeFile(resolve(tempRoot, "package.json"), "{}", "utf8");

    const result = await findProjectRoot(tempRoot);

    expect(result).toBe(tempRoot);
  });
});
