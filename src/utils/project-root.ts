import { access } from "node:fs/promises";
import { dirname, resolve } from "pathe";

/**
 * Walk up from `startDir` looking for the nearest directory that contains a
 * `package.json`. That directory is treated as the project root.
 *
 * Returns the absolute path to the project root, or `null` if traversal hits
 * the filesystem root without finding one.
 *
 * @example
 * ```typescript
 * const root = await findProjectRoot(process.cwd());
 * if (!root) {
 *   throw new Error("No package.json found above cwd");
 * }
 * ```
 */
export async function findProjectRoot(
  startDir: string = process.cwd(),
): Promise<string | null> {
  let current = resolve(startDir);

  while (true) {
    if (await fileExists(resolve(current, "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}
