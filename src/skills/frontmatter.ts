/**
 * Minimal SKILL.md frontmatter reading — just enough to pull the
 * `description` and the body. Not a general YAML parser.
 */

const FENCE = /^---[ \t]*\r?\n?$/;

export type SplitMarkdown = {
  /** Frontmatter lines between the fences, or `null` when there is none. */
  frontmatter: string[] | null;
  /** Everything after the closing fence line (the whole input when none). */
  body: string;
};

export function splitFrontmatter(content: string): SplitMarkdown {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (lines.length === 0 || !FENCE.test(lines[0] ?? "")) {
    return { frontmatter: null, body: content };
  }
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i] ?? "")) {
      return {
        frontmatter: lines.slice(1, i).map((line) => line.replace(/\r?\n$/, "")),
        body: lines.slice(i + 1).join(""),
      };
    }
  }
  return { frontmatter: null, body: content };
}

/**
 * Read the `description` field as a single-line string (whitespace collapsed).
 * Supports plain, quoted, multi-line plain and `>` / `|` block scalars.
 * Returns `undefined` when absent or empty.
 */
export function readDescription(content: string): string | undefined {
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return undefined;

  const start = frontmatter.findIndex((line) => /^description[ \t]*:/.test(line));
  if (start === -1) return undefined;

  const inline = frontmatter[start].replace(/^description[ \t]*:[ \t]*/, "");
  const continuation: string[] = [];
  for (let i = start + 1; i < frontmatter.length; i++) {
    const line = frontmatter[i];
    if (line.trim() !== "" && !/^[ \t]/.test(line)) break;
    continuation.push(line.trim());
  }

  let value: string;
  if (/^[>|][+-]?[0-9]*[ \t]*$/.test(inline)) {
    value = continuation.join(" ");
  } else if (inline.startsWith('"') && continuation.length === 0) {
    try {
      value = JSON.parse(inline.trimEnd());
    } catch {
      value = inline.replace(/^"|"$/g, "");
    }
  } else if (inline.startsWith("'") && continuation.length === 0) {
    value = inline.trimEnd().replace(/^'|'$/g, "").replace(/''/g, "'");
  } else {
    value = [inline, ...continuation].join(" ");
  }

  value = value.replace(/\s+/g, " ").trim();
  return value === "" ? undefined : value;
}
