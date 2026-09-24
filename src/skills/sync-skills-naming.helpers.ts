import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "pathe";

/** Drop a fake package into node_modules with a single skill and raw SKILL.md content. */
export async function writePackage(
  nodeModules: string,
  pkgName: string,
  skillName: string,
  skillMarkdown: string,
): Promise<void> {
  const pkgDir = resolve(nodeModules, ...pkgName.split("/"));
  const skillDir = resolve(pkgDir, "skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    resolve(pkgDir, "package.json"),
    JSON.stringify({ name: pkgName }),
    "utf8",
  );
  await writeFile(resolve(skillDir, "SKILL.md"), skillMarkdown, "utf8");
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
