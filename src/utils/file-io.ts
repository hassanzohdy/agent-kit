import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "pathe";

/**
 * Error codes that all mean "there is no readable regular file at this path".
 *
 * `ENOENT` — nothing exists at the path.
 * `ENOTDIR` — a parent path component is a file, not a directory (e.g. reading
 *   `package.json/package.json`). Linux raises this; Windows raises `ENOENT`
 *   for the same situation, so we treat them identically for cross-platform
 *   parity.
 * `EISDIR` — the path is a directory, not a file.
 */
const MISSING_FILE_CODES = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

/**
 * Read a UTF-8 file. Returns `null` if there is no readable file at the path
 * (rather than throwing), so callers can distinguish "missing" from
 * "unreadable". A path whose parent is a file (`ENOTDIR`) or that points at a
 * directory (`EISDIR`) is treated as missing too — this keeps discovery code
 * that probes speculative manifest paths behaving the same on Linux and
 * Windows.
 */
export async function readTextFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch (error) {
    if (isNodeErrnoException(error) && MISSING_FILE_CODES.has(error.code ?? "")) {
      return null;
    }
    throw error;
  }
}

/**
 * Write a UTF-8 file, creating parent directories as needed.
 *
 * Returns `true` if the file was created or its content changed; `false` if
 * the content on disk already matched. This lets callers report meaningful
 * "changed N files" counts without re-reading after writing.
 */
export async function writeTextFile(
  absPath: string,
  content: string,
): Promise<boolean> {
  const existing = await readTextFile(absPath);
  if (existing === content) {
    return false;
  }
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, "utf8");
  return true;
}

function isNodeErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return (
    value instanceof Error &&
    typeof (value as NodeJS.ErrnoException).code === "string"
  );
}
