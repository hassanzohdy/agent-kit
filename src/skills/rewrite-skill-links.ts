import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "pathe";

export type ExportedSkill = { sourceDir: string; destDir: string };

/** Rewrites only destinations that cross from one exported skill to another. */
export async function rewriteExportedMarkdown(
  exportedSkills: ExportedSkill[], manifest: Map<string, ExportedSkill>,
): Promise<void> {
  for (const skill of exportedSkills) for (const sourceFile of await findMarkdownFiles(skill.sourceDir)) {
    const destFile = resolve(skill.destDir, relative(skill.sourceDir, sourceFile));
    const content = await readFile(sourceFile, "utf8");
    const rewritten = rewriteMarkdownLinks(content, sourceFile, destFile, manifest);
    if (rewritten !== content) await writeFile(destFile, rewritten, "utf8");
  }
}

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findMarkdownFiles(entryPath)));
    else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function rewriteMarkdownLinks(markdown: string, sourceFile: string, destFile: string, manifest: Map<string, ExportedSkill>): string {
  let fence: string | undefined;
  return markdown.split(/(\r?\n)/).map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = undefined; return line; }
    return fence ? line : rewriteDefinition(rewriteLinksInLine(line, sourceFile, destFile, manifest), sourceFile, destFile, manifest);
  }).join("");
}

function rewriteDefinition(line: string, sourceFile: string, destFile: string, manifest: Map<string, ExportedSkill>): string {
  // Definitions are parsed as Markdown structure, not searched/replaced in prose.
  const match = /^( {0,3}\[[^\]]+\]:\s+)(<[^>]*>|(?:\\.|[^\s])+)([\s\S]*)$/.exec(line);
  if (!match) return line;
  const [, prefix, raw, suffix] = match;
  const wrapped = raw.startsWith("<") && raw.endsWith(">");
  const destination = wrapped ? raw.slice(1, -1) : raw;
  const rewritten = rewriteRelativeDestination(destination, sourceFile, destFile, manifest);
  return rewritten === destination ? line : `${prefix}${wrapped ? `<${rewritten}>` : rewritten}${suffix}`;
}

function rewriteLinksInLine(line: string, sourceFile: string, destFile: string, manifest: Map<string, ExportedSkill>): string {
  let result = "", cursor = 0, ticks = 0;
  while (cursor < line.length) {
    if (line[cursor] === "`") { let end = cursor; while (line[end] === "`") end++; const count = end - cursor; ticks = ticks === count ? 0 : ticks || count; result += line.slice(cursor, end); cursor = end; continue; }
    if (!ticks && line[cursor] === "]" && line[cursor + 1] === "(") {
      const end = findLinkEnd(line, cursor + 2);
      if (end !== -1) { result += `](${rewriteLinkDestination(line.slice(cursor + 2, end), sourceFile, destFile, manifest)})`; cursor = end + 1; continue; }
    }
    result += line[cursor++];
  }
  return result;
}

function findLinkEnd(line: string, start: number): number {
  let depth = 0, escaped = false;
  for (let index = start; index < line.length; index++) {
    const char = line[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === "(") depth++;
    if (char === ")") { if (depth === 0) return index; depth--; }
  }
  return -1;
}

function rewriteLinkDestination(inside: string, sourceFile: string, destFile: string, manifest: Map<string, ExportedSkill>): string {
  const match = /^(\s*)(<[^>]*>|(?:\\.|[^\s])+)([\s\S]*)$/.exec(inside);
  if (!match) return inside;
  const [, leading, raw, trailing] = match;
  const wrapped = raw.startsWith("<") && raw.endsWith(">");
  const destination = wrapped ? raw.slice(1, -1) : raw;
  const rewritten = rewriteRelativeDestination(destination, sourceFile, destFile, manifest);
  return rewritten === destination ? inside : `${leading}${wrapped ? `<${rewritten}>` : rewritten}${trailing}`;
}

function rewriteRelativeDestination(destination: string, sourceFile: string, destFile: string, manifest: Map<string, ExportedSkill>): string {
  if (!destination || destination.startsWith("#") || destination.startsWith("//") || destination.startsWith("@") || isAbsolute(destination) || /^[a-z][a-z0-9+.-]*:/i.test(destination)) return destination;
  const suffixStart = destination.search(/[?#]/);
  const pathname = suffixStart === -1 ? destination : destination.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : destination.slice(suffixStart);
  // Markdown escaping is presentation syntax; resolve the real source path.
  const sourcePathname = pathname.replace(/\\([ !"#$%&'()*+,.:;<=>?@[\\\]^_`{|}~-])/g, "$1");
  const target = resolve(dirname(sourceFile), sourcePathname);
  const targetSkill = findOwningSkill(target, manifest);
  const sourceSkill = findOwningSkill(sourceFile, manifest);
  if (!targetSkill || !sourceSkill || targetSkill === sourceSkill) return destination;
  const outputTarget = resolve(targetSkill.destDir, relative(targetSkill.sourceDir, target));
  let outputRelative = relative(dirname(destFile), outputTarget).replaceAll("\\", "/");
  if (!outputRelative.startsWith(".")) outputRelative = `./${outputRelative}`;
  return outputRelative.replace(/([ ()])/g, (character) => `\\${character}`) + suffix;
}

function findOwningSkill(sourcePath: string, manifest: Map<string, ExportedSkill>): ExportedSkill | undefined {
  const comparable = process.platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
  let owner: ExportedSkill | undefined;
  for (const skill of manifest.values()) {
    const root = process.platform === "win32" ? skill.sourceDir.toLowerCase() : skill.sourceDir;
    if (comparable === root || comparable.startsWith(`${root}${sep}`)) if (!owner || root.length > owner.sourceDir.length) owner = skill;
  }
  return owner;
}
