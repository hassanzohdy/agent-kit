/**
 * Public type surface for agent-kit.
 */

/**
 * Identifier for a built-in derive target. Each maps to a concrete file path
 * that the corresponding AI coding agent reads at project scope.
 */
export type DeriveTargetName = "claude" | "gemini" | "copilot" | "aider";

/**
 * Identifier for a built-in skills-sync target. Each maps to a concrete
 * directory inside the project root that the corresponding AI coding agent
 * scans for skills.
 *
 * `amp` and `antigravity` look almost identical but use **different** dirs:
 * - `amp` → `.agents/skills/` (plural "agents")
 * - `antigravity` → `.agent/skills/` (singular "agent")
 *
 * They are distinct tools with distinct conventions; do not conflate them.
 */
export type SkillsTargetName =
  | "claude"
  | "copilot"
  | "cursor"
  | "codex"
  | "opencode"
  | "amp"
  | "goose"
  | "kiro"
  | "antigravity";

/**
 * A single derive target — describes where one agent's instructions file lives
 * relative to the project root.
 */
export type DeriveTarget = {
  name: DeriveTargetName;
  /** Path relative to project root, using forward slashes. */
  outputPath: string;
  /** Human-readable label used in headers and logs. */
  label: string;
  /** Whether to derive this target by default in `agent-kit sync`. */
  enabledByDefault: boolean;
};

/**
 * Options for the core derive operation.
 */
export type DeriveOptions = {
  /** Absolute path to the project root. */
  root: string;
  /** Subset of targets to derive. Defaults to all enabled-by-default targets. */
  targets?: DeriveTargetName[];
  /** Override the source file name. Defaults to `AGENTS.md`. */
  sourceFile?: string;
};

/**
 * Result of deriving a single target.
 */
export type DeriveResult = {
  target: DeriveTargetName;
  /** Absolute path of the file written. */
  outputPath: string;
  /** True if the file was created or its content changed; false if unchanged. */
  changed: boolean;
};

/**
 * Options for skills sync.
 */
export type SyncSkillsOptions = {
  root: string;
  /** Subset of targets. Defaults to all detected installed-agent targets. */
  targets?: SkillsTargetName[];
  /**
   * Additional directories to scan, each treated like a `node_modules/`
   * (immediate children are candidate packages; `@scope/` entries get
   * descended one level). Resolved relative to `root` when not absolute.
   *
   * Useful for monorepos (yarn workspaces, pnpm workspaces) and local dev
   * setups where framework packages are not under `node_modules/`.
   *
   * A package discovered in `scanPaths` wins over one with the same name in
   * `node_modules/` — local override semantics, matches typical dev intent.
   */
  scanPaths?: string[];
  /**
   * When a destination folder in `.claude/skills/` (or another target's skills
   * dir) already exists *without* the `.agent-kit-managed` sentinel — i.e. a
   * user-authored folder, not something we created — the default behavior is
   * to **skip with a warning** so we never silently clobber the user's work.
   *
   * Set `override: true` to remove the user folder and replace it with the
   * synced version anyway. Use with care.
   */
  override?: boolean;
  /**
   * Monorepo project roots to aggregate into this project's skill dirs. Each
   * entry is a path relative to `root` (or absolute), and may be a one-level
   * glob (`apps/*`). Every resolved project is scanned *as its own project* —
   * its `node_modules/` dependency skills (filtered by that project's own
   * `agentKit` config) plus its authored `skills/` (prefixed with the project
   * directory name) — and merged up into `root`'s skill directories.
   *
   * Distinct from {@link scanPaths}: a `scanPath` is treated like a
   * `node_modules/` (its children are packages); a `project` is treated as a
   * single project (its own `skills/` + its own `node_modules/`).
   *
   * Defaults to `agentKit.monorepo.projects` from `root`'s `package.json` when
   * omitted.
   */
  projects?: string[];
};
