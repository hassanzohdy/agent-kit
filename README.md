# agent-kit

> Write your AI agent instructions once. Every coding agent reads them.

The AI coding agent landscape fragmented into a dozen tool-specific config files. `AGENTS.md` is the open standard ([stewarded by the Linux Foundation](https://agents.md/), read natively by Codex, Cursor, Amp, Jules, Factory, Windsurf, OpenCode and others) — but Claude Code, Gemini CLI, GitHub Copilot, and Aider still want their own files at their own paths. Maintaining four copies of the same content guarantees drift.

`agent-kit` solves that. It treats your project's `AGENTS.md` as the single source of truth, derives every tool-specific file from it, and also syncs reusable skills bundled in your installed npm packages into per-agent skill directories — with collision-free flat folder names.

---

## Install

NPM

```bash
npm install -D @mongez/agent-kit
```

Yarn

```bash
yarn add -D @mongez/agent-kit
```

PNPM

```bash
pnpm add -D @mongez/agent-kit
```

> The npm package is `@mongez/agent-kit`, but the CLI binary is just `agent-kit`. You install with the scope, you invoke without it.

## Quick start

From your project root:

```bash
npx agent-kit init           # Scaffold AGENTS.md + derive all tool files
npx agent-kit sync           # Re-derive + sync skills from node_modules
npx agent-kit watch          # Re-sync on every change (dev loop)
```

Then make it automatic — add a `postinstall` hook so skills + derived files stay fresh after every `yarn install`:

```json
{
  "scripts": {
    "postinstall": "agent-kit sync"
  }
}
```

That's it. Edit `AGENTS.md`, run `npx agent-kit sync`, and every supported agent picks up the new instructions.

---

## What you get

### Derivation targets

`AGENTS.md` → derived files for the four tools that don't read root `AGENTS.md` natively:

| Tool           | Output                            | Notes                                      |
| -------------- | --------------------------------- | ------------------------------------------ |
| Claude Code    | `CLAUDE.md`                       | Anthropic's primary config file            |
| Gemini CLI     | `.gemini/GEMINI.md`               | Doesn't read root `AGENTS.md`              |
| GitHub Copilot | `.github/copilot-instructions.md` | Repository-level custom instructions       |
| Aider          | `CONVENTIONS.md`                  | Load with `/read` or via `.aider.conf.yml` |

Codex, Cursor, Amp, Jules, Factory, Kilo, Windsurf, OpenCode, and Goose all read root `AGENTS.md` directly — no derivation needed.

### Skills from installed packages

`agent-kit sync` walks `node_modules/` for any package that ships skills and copies them into per-agent skill directories. As a consumer, **you do nothing** — sync (or `postinstall`) handles it.

What you'll see in `.claude/skills/` after sync:

```
.claude/skills/
  warlock-js-ai/                          ← @warlock.js/ai (Pattern A: single-skill package)
  warlock-js-core-add-connector/          ← @warlock.js/core (Pattern B: multi-skill)
  warlock-js-core-send-response/
  mongez-agent-kit-overview/              ← @mongez/agent-kit
  ...
```

Every folder name is `<pkg-slug>[-skill-name]` — the package slug strips the `@`, replaces `/` and `.` with `-`, lowercases. Two packages can never collide on the same destination.

### Safety guarantees

- **Hand-authored skills are never clobbered.** Each synced folder gets a `.agent-kit-managed` sentinel file. On the next sync, only sentinel-marked folders are pruned and rewritten. If you've manually created `.claude/skills/my-custom-skill/`, it stays untouched.
- **User-authored collisions skip with a warning.** If a destination slug happens to match a hand-authored folder you've made, sync skips it (pass `--override` to replace).
- **Two-package collisions throw loudly.** If two packages somehow produce the same destination slug, sync errors with both package names — not a silent overwrite.

---

## Monorepos and local development

For setups where packages live outside `node_modules/` — yarn workspaces, pnpm workspaces, lerna, or local dev folders — point sync at extra dirs with `--path`:

```bash
yarn agent-kit sync --path @warlock.js
yarn agent-kit sync --path packages,vendor
```

Each path is treated like a `node_modules/` (immediate children are candidate packages; `@scope/` entries get descended one level). Packages found in `--path` dirs override same-named entries in `node_modules/` — matches typical local-dev intent.

If a package has `_package.json` instead of `package.json` (a temporary-rename convention some workspace tools use), sync falls back to it automatically.

---

## CLI reference

```bash
agent-kit init                              # Scaffold AGENTS.md (if missing) + derive
agent-kit sync                              # Derive + sync skills
agent-kit sync --derive-only                # Skip skills export
agent-kit sync --skills-only                # Skip derivation
agent-kit sync --target claude,cursor       # Comma-separated skill targets
agent-kit sync --path @warlock.js           # Add extra scan dirs
agent-kit sync --override                   # Replace user-authored dest folders
agent-kit watch                             # Re-sync on AGENTS.md / skills changes
agent-kit watch --path @warlock.js          # Watch extra dirs too
agent-kit watch --override                  # Replace user-authored dirs on each re-sync
```

**Skill targets:** `claude`, `copilot`, `cursor`, `codex`, `opencode`, `amp`, `goose` (claude only by default — pass `--target` to add more).

All commands accept `--cwd <path>` to override the working directory. All commands are **idempotent** — running twice in a row is a no-op the second time.

---

## Programmatic API

```typescript
import {
  deriveAll,
  syncSkills,
  findProjectRoot,
  scanForSkillPackages,
  deriveSlugForSkill,
} from "@mongez/agent-kit";

const root = await findProjectRoot();
if (!root) throw new Error("No project root");

const derived = await deriveAll({ root });
const skills = await syncSkills({
  root,
  targets: ["claude", "cursor"],
  scanPaths: ["@warlock.js"], // optional
  override: false, // optional
});

// skills.exported, skills.pruned, skills.skipped, skills.packages, skills.scannedPaths
```

---

## For package authors: shipping skills with your library

This section is for **library maintainers** who want to bundle skills inside their published npm package so downstream consumers receive them on `yarn install`. If you're just using `agent-kit` in an app, you can stop reading here — sync discovers skills in your installed packages automatically.

### How a library declares its skills

Two equivalent options — explicit declaration or auto-discovery.

**Explicit (recommended for non-default layouts):**

```json
{
  "agents": {
    "skills": [{ "name": "my-skill", "path": "./skills/my-skill" }]
  }
}
```

**Auto-discovery:** drop a `skills/` folder at your package root. `agent-kit` walks it recursively. Any directory containing a `SKILL.md` becomes a skill — flat (`skills/foo/`) and nested (`skills/backend/auth/`) layouts both work.

Explicit declarations take precedence over auto-discovery. An explicit empty `"skills": []` is respected as "I have no skills, don't auto-discover."

### Make sure the `skills/` folder is published

Add `skills` to your `package.json` `files` field, otherwise npm publish will omit it and downstream consumers will find nothing:

```json
{
  "files": ["dist", "skills", "README.md"]
}
```

### Folder name is the identity

Claude Code only discovers skills at the top level of `.claude/skills/` — nested folders are silently ignored, and **the folder name is the only thing it uses for routing** (per the [Claude Code Skills docs](https://code.claude.com/docs/en/skills): _"name — Display name for the skill. If omitted, uses the directory name."_).

`agent-kit` therefore derives the destination folder automatically:

- Single-skill packages (root `skills/SKILL.md`): `<pkg-slug>` — `@warlock.js/ai` → `warlock-js-ai`
- Multi-skill: `<pkg-slug>-<skill-folder-name>` — `@my-org/pkg/skills/foo` → `my-org-pkg-foo`
- Nested: `<pkg-slug>-<flattened-path>` — `skills/backend/auth` → `<pkg-slug>-backend-auth`

You don't pick a globally-unique name — agent-kit guarantees uniqueness by prefixing with your package slug. Your folder name only needs to be unique inside your own `skills/` folder.

### SKILL.md frontmatter is optional

You can omit the `name:` field entirely — Claude Code falls back to the folder name. Or set it to a custom display label (e.g. `name: Using the thing`) for a prettier label in Claude's UI. Either way, **routing happens by folder name**, and `agent-kit` never reads or rewrites your SKILL.md content during sync — your source file is copied verbatim.

A useful baseline structure:

```markdown
---
description: One sentence telling an agent when to read this skill.
---

# Skill title

## When to use

Specific situations the agent should recognize.

## How to use

Concrete steps, with code examples where it helps.

## Pitfalls

Common mistakes and how to avoid them.
```

The `description` field is the most important line — it determines whether an agent picks up the skill in the first place. Make it specific.

---

## License

MIT
