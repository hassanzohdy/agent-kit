import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "pathe";

/**
 * Read a UTF-8 file. Returns `null` if the file does not exist (rather than
 * throwing), so callers can distinguish "missing" from "unreadable".
 */
export async function readTextFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === "ENOENT") {
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
