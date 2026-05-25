import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTextFile, writeTextFile } from "./file-io";

describe("readTextFile", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-io-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns null when the file does not exist", async () => {
    const result = await readTextFile(resolve(tempRoot, "missing.txt"));

    expect(result).toBeNull();
  });

  it("returns file contents as a UTF-8 string when the file exists", async () => {
    const filePath = resolve(tempRoot, "hello.txt");
    await writeFile(filePath, "hello world", "utf8");

    const result = await readTextFile(filePath);

    expect(result).toBe("hello world");
  });

  it("preserves multiline content including a trailing newline", async () => {
    const filePath = resolve(tempRoot, "multi.txt");
    const content = "line one\nline two\nline three\n";
    await writeFile(filePath, content, "utf8");

    const result = await readTextFile(filePath);

    expect(result).toBe(content);
  });
});

describe("writeTextFile", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(resolve(tmpdir(), "agent-kit-io-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("creates a new file and reports changed: true", async () => {
    const filePath = resolve(tempRoot, "new.txt");

    const changed = await writeTextFile(filePath, "new content");

    expect(changed).toBe(true);
    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).toBe("new content");
  });

  it("creates missing parent directories", async () => {
    const filePath = resolve(tempRoot, "a", "b", "c", "deep.txt");

    const changed = await writeTextFile(filePath, "deep");

    expect(changed).toBe(true);
    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).toBe("deep");
  });

  it("returns changed: false and does not rewrite when content matches", async () => {
    const filePath = resolve(tempRoot, "same.txt");
    await writeFile(filePath, "identical", "utf8");
    const statBefore = await stat(filePath);

    // Small delay so an mtime change would be observable
    await new Promise((r) => setTimeout(r, 10));

    const changed = await writeTextFile(filePath, "identical");

    expect(changed).toBe(false);
    const statAfter = await stat(filePath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it("returns changed: true and rewrites when content differs", async () => {
    const filePath = resolve(tempRoot, "differ.txt");
    await writeFile(filePath, "old", "utf8");

    const changed = await writeTextFile(filePath, "new");

    expect(changed).toBe(true);
    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).toBe("new");
  });
});
