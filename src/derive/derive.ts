import { resolve } from "pathe";
import { readTextFile, writeTextFile } from "../utils/file-io";
import type {
  DeriveOptions,
  DeriveResult,
  DeriveTarget,
} from "../types";
import { resolveDeriveTargets } from "./targets";

const DEFAULT_SOURCE_FILE = "AGENTS.md";

/**
 * Wrap derived content with a header that identifies the source file and the
 * tool the file is generated for. The header is HTML-comment markdown so it
 * stays invisible when rendered.
 */
export function buildDerivedContent(
  target: DeriveTarget,
  sourceFile: string,
  sourceContent: string,
): string {
  const header = [
    "<!--",
    `  This file is auto-generated from ${sourceFile} by agent-kit for ${target.label}.`,
    "  Do not edit directly — your changes will be overwritten on the next sync.",
    `  Source: ./${sourceFile}`,
    "  Regenerate: npx agent-kit sync",
    "-->",
    "",
    "",
  ].join("\n");
  return header + sourceContent;
}

/**
 * Read the source `AGENTS.md` (or alternative source file) and emit one derived
 * file per requested target. Files unchanged on disk are not rewritten — see
 * {@link writeTextFile} — so this is safe to call from watchers.
 *
 * @example
 * ```typescript
 * const results = await deriveAll({ root: "/path/to/project" });
 * for (const r of results) {
 *   if (r.changed) console.log(`Updated ${r.outputPath}`);
 * }
 * ```
 */
export async function deriveAll(
  options: DeriveOptions,
): Promise<DeriveResult[]> {
  const sourceFile = options.sourceFile ?? DEFAULT_SOURCE_FILE;
  const sourceAbsPath = resolve(options.root, sourceFile);
  const sourceContent = await readTextFile(sourceAbsPath);

  if (sourceContent === null) {
    throw new Error(
      `Source file not found: ${sourceAbsPath}. Run \`agent-kit init\` to scaffold an ${sourceFile} starter.`,
    );
  }

  const targets = resolveDeriveTargets(options.targets);
  const results: DeriveResult[] = [];

  for (const target of targets) {
    const outputAbsPath = resolve(options.root, target.outputPath);
    const content = buildDerivedContent(target, sourceFile, sourceContent);
    const changed = await writeTextFile(outputAbsPath, content);
    results.push({
      target: target.name,
      outputPath: outputAbsPath,
      changed,
    });
  }

  return results;
}
