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

From your project root.

**Scaffold `AGENTS.md` and derive all tool-specific files:**

```bash
npx agent-kit init
```

**Re-derive and sync skills from `node_modules`:**

```bash
npx agent-kit sync
```

**Watch and re-sync on every change (dev loop):**

```bash
npx agent-kit watch
```

Then make it automatic — add a `postinstall` hook so skills + derived files stay fresh after every install:

```json
{
  "scripts": {
    "postinstall": "agent-kit sync"
  }
}
```

That's it. Edit `AGENTS.md`, run `npx agent-kit sync`, and every supported agent picks up the new instructions.

> **Reload behavior:** Claude Code reads new and updated skills **live** — they show up on your next prompt within the same session, no restart needed (per the [official docs](https://code.claude.com/docs/en/skills.md#live-change-detection)). Other agents (Cursor, GitHub Copilot, Codex IDE, Gemini, Kiro, Antigravity) typically need a window or session reload to pick up newly-synced skills. One Claude Code edge case: if `.claude/skills/` did not exist when your session started, you need to restart Claude after the first sync so it discovers the new directory; subsequent syncs into the existing directory are live.

---

## Quick recipes

Copy-paste setup for popular agents. Each recipe is self-contained — pick the one matching your editor.

### Codex (CLI + IDE)

Codex reads root `AGENTS.md` natively — no derived file needed. agent-kit just syncs your skills into `.codex/skills/`.

**One-time scaffold:**

```bash
npx agent-kit init
```

**Sync skills into `.codex/skills/`:**

```bash
npx agent-kit sync --target codex
```

**Wire it into your `package.json` so it stays current on every install:**

```json
{
  "scripts": {
    "postinstall": "agent-kit sync"
  },
  "agentKit": {
    "targets": ["codex"]
  }
}
```

### Cursor

Cursor reads root `AGENTS.md` natively. agent-kit syncs your skills into `.cursor/skills/`.

**One-time scaffold:**

```bash
npx agent-kit init
```

**Sync skills into `.cursor/skills/`:**

```bash
npx agent-kit sync --target cursor
```

**Wire it into your `package.json`:**

```json
{
  "scripts": {
    "postinstall": "agent-kit sync"
  },
  "agentKit": {
    "targets": ["cursor"]
  }
}
```

### Kiro (AWS)

Kiro reads root `AGENTS.md` natively (per the [Agent Skills open standard](https://agentskills.io/)). agent-kit syncs your skills into `.kiro/skills/`.

**One-time scaffold:**

```bash
npx agent-kit init
```

**Sync skills into `.kiro/skills/`:**

```bash
npx agent-kit sync --target kiro
```

**Wire it into your `package.json`:**

```json
{
  "scripts": {
    "postinstall": "agent-kit sync"
  },
  "agentKit": {
    "targets": ["kiro"]
  }
}
```

### Using multiple agents at once

If your team mixes agents — say Claude + Codex + Cursor — list them all in `agentKit.targets`. Each gets its own skill directory; `AGENTS.md` serves all of them.

```json
{
  "scripts": {
    "postinstall": "agent-kit sync"
  },
  "agentKit": {
    "targets": ["claude", "codex", "cursor", "kiro"]
  }
}
```

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
npx agent-kit sync --path @warlock.js
```

```bash
npx agent-kit sync --path packages,vendor
```

**`--path` is additive, not replacing.** Sync always reads from `node_modules/` first, then appends every dir you pass via `--path` in the order given. Scan order: `[node_modules, ...userPaths]`. So `--path @warlock.js` scans **both** `node_modules` and `@warlock.js` — your installed deps stay in scope, plus your local framework folder.

Each path is treated like a `node_modules/` (immediate children are candidate packages; `@scope/` entries get descended one level). Packages found later in the scan order **win on dedupe** — so a package present in both `node_modules` and `@warlock.js` will resolve to the `@warlock.js` copy. That matches typical local-dev intent: edit the local version, see your edits in `.claude/skills/` even though the same package is also installed under `node_modules`.

If you want to scan **only** a specific set of packages (not everything in `node_modules`), use the `agentKit.pick` allowlist in your `package.json` — see [Project-level config](#project-level-config-agentkit-in-packagejson).

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

## Real-world examples: the Mongez ecosystem

The `@mongez/*` family ships skills out of the box — 65 across 8 packages. Install any of them, run `npx agent-kit sync`, and every agent on your team picks up curated guidance without writing a single skill yourself.

| Package                                                                          | What it does                                                                                                       | Skills |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| [`@mongez/reinforcements`](https://github.com/hassanzohdy/reinforcements)        | Helpers for arrays, objects, strings, numbers, async (debounce/throttle), and functions (pipe/compose/memoize)     | 12     |
| [`@mongez/collection`](https://github.com/hassanzohdy/reinforcements)            | Chainable, immutable array collection — filter/where, sort, group, paginate, pluck, 100+ helpers                   | 13     |
| [`@mongez/cache`](https://github.com/hassanzohdy/mongez-cache)                   | Framework-agnostic cache facade — localStorage, sessionStorage, runtime memory, encrypted variants                 | 11     |
| [`@mongez/supportive-is`](https://github.com/hassanzohdy/supportive-is)          | Tree-shakable type predicates: `isString`, `isEmpty`, `isUrl`, `isEmail`, `isPromise`, `isMobile`, …               | 7      |
| [`@mongez/react-router`](https://github.com/hassanzohdy/react-router)            | Configuration-based React router — lazy apps, locale-aware routing, middleware, prefetch-on-hover                  | 7      |
| [`@mongez/react-form`](https://github.com/hassanzohdy/mongez-react-form)         | Powerful headless React form handler (web + React Native)                                                          | 6      |
| [`@mongez/react-atom`](https://github.com/hassanzohdy/mongez-react-atom)         | Simple state management for React — atoms, presets, SSR-friendly                                                   | 5      |
| [`@mongez/events`](https://github.com/hassanzohdy/mongez-events)                 | Simple event-driven system handler with namespaces and a global bus                                                | 4      |

### Walkthrough: `@mongez/reinforcements`

```bash
yarn add @mongez/reinforcements
npx agent-kit sync
```

After sync, your `.claude/skills/` (or whichever targets you've configured) gains 12 collision-free skill folders:

```
.claude/skills/
  mongez-reinforcements-overview/
  mongez-reinforcements-arrays/
  mongez-reinforcements-objects/
  mongez-reinforcements-strings/
  mongez-reinforcements-numbers/
  mongez-reinforcements-async/
  mongez-reinforcements-functions/
  mongez-reinforcements-lazy/
  mongez-reinforcements-random/
  mongez-reinforcements-types/
  mongez-reinforcements-mixed/
  mongez-reinforcements-recipes/
```

Repeat the same two-step install for any package in the table — every agent on your team picks them up automatically.

---

## License

MIT
