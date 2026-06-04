<div align="center">

# @mongez/agent-kit

**Authoring and distribution toolkit for AI coding agent artifacts — one `AGENTS.md`, every coding agent, plus skills that travel with your npm packages.**

[![npm](https://img.shields.io/npm/v/@mongez/agent-kit.svg)](https://www.npmjs.com/package/@mongez/agent-kit)
[![license](https://img.shields.io/npm/l/@mongez/agent-kit.svg)](LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@mongez/agent-kit.svg)](https://bundlephobia.com/package/@mongez/agent-kit)
[![downloads](https://img.shields.io/npm/dw/@mongez/agent-kit.svg)](https://www.npmjs.com/package/@mongez/agent-kit)

</div>

---

## Why @mongez/agent-kit?

The AI coding agent landscape fragmented into a dozen tool-specific config files and a dozen places to drop skills. [`AGENTS.md`](https://agents.md/) is the open standard read natively by Codex, Cursor, Amp, OpenCode, Goose, and others — but Claude Code wants `CLAUDE.md`, Gemini CLI wants `.gemini/GEMINI.md`, GitHub Copilot wants `.github/copilot-instructions.md`, Aider wants `CONVENTIONS.md`. Authoring four near-identical copies guarantees drift. The "drop SKILL.md files into `skills/`" convention solves bundling, but leaves you copy-pasting them into `.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, and worrying about folder-name collisions between packages. `@mongez/agent-kit` is the smallest CLI plus library that closes both gaps: derive every per-agent instructions file from one `AGENTS.md`, and mirror skills from your installed npm packages into per-agent skill directories with flat, collision-proof folder names — with a sentinel-based prune so your hand-authored skills are never clobbered.

```ts
import { deriveAll, syncSkills, findProjectRoot } from "@mongez/agent-kit";

const root = await findProjectRoot();
if (!root) throw new Error("No project root");

await deriveAll({ root });
await syncSkills({ root, targets: ["claude", "cursor"] });
```

---

## Features

| Feature | Description |
|---|---|
| **One source of truth** | Write project instructions in `AGENTS.md` once; every tool-specific file is derived from it. |
| **Four built-in derive targets** | `CLAUDE.md`, `.gemini/GEMINI.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md` — the agents that don't read root `AGENTS.md` natively. |
| **Skills from `node_modules/`** | `sync` walks installed packages for `skills/` folders and exports them into `.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, etc. |
| **Collision-free flat naming** | Destinations are slugified as `<pkg-slug>[-skill-path]`, so two packages can never collide on the same folder. |
| **Sentinel-based prune** | Every synced folder gets a `.agent-kit-managed` marker; only marked folders are pruned on the next sync, so user-authored skills stay safe. |
| **Three CLI commands** | `init` scaffolds, `sync` regenerates, `watch` keeps a live dev loop. All idempotent. |
| **Programmatic API** | `deriveAll`, `syncSkills`, `findProjectRoot`, `scanForSkillPackages`, `deriveSlugForSkill` and friends — the CLI is a thin wrapper. |
| **Project-level config** | An optional `agentKit` block in `package.json` configures default targets, allowlist (`pick`), and denylist (`omit`). |
| **Monorepo-friendly** | `--projects` aggregates sibling projects (backend, frontend, …) into one root skills dir — each scanned with its own `node_modules/` + its own `agentKit` config. `--path` adds extra package-container dirs with local-override semantics. |
| **Stateless** | Every sync reads disk truth — no lockfile, no cache, no drift between runs. |
| **TypeScript-first** | Full type surface for derive targets, skill targets, sync options, and results. |

---

## Installation

```sh
npm install -D @mongez/agent-kit
```

```sh
yarn add -D @mongez/agent-kit
```

```sh
pnpm add -D @mongez/agent-kit
```

> The npm package is `@mongez/agent-kit`, but the CLI binary is just `agent-kit`. You install with the scope, you invoke without it.

---

## Quick start

Bootstrap a project from scratch with one command — no install needed:

```sh
npx @mongez/agent-kit@latest init
```

This runs the latest published agent-kit on the fly (nothing added to your
`node_modules`) and writes a starter `AGENTS.md` at the project root (only if one
does not already exist), then derives every per-tool file from it — `CLAUDE.md`,
`.gemini/GEMINI.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md`.

> **Use the scoped name with `npx`.** `npx @mongez/agent-kit …` resolves *this*
> package. `npx agent-kit …` (unscoped) would try to fetch a different package —
> the bare `agent-kit` binary name only works once it's installed locally (below).

For the **recurring** sync, install agent-kit as a dev dependency and wire it into
`postinstall` so every `install` re-derives the per-tool files and re-mirrors
skills — pinned and reproducible across the team and CI:

```json
{
  "scripts": {
    "postinstall": "agent-kit sync"
  }
}
```

**`init` vs `sync` — different delivery on purpose:** `init` is a one-time
scaffold, so the always-latest `npx @mongez/agent-kit@latest init` is ideal.
`sync` runs on every install (and in CI), so it belongs as a **pinned dev
dependency** — never always-latest, or a new agent-kit version could silently
change generated output. (Ad-hoc manual `npx @mongez/agent-kit@latest sync` is
fine.)

From now on, every `yarn install` re-derives the per-tool files from `AGENTS.md` and mirrors skills from installed packages into `.claude/skills/`. Edit `AGENTS.md`, run `npx agent-kit sync`, and every supported agent picks up the change.

---

## Set up with your agent

Pick your agent below for the exact `--target` flag, the files agent-kit creates, and the reload step. The full per-IDE walkthroughs (with copy-pasteable `package.json` snippets) live in the [**Agent integrations**](https://mongez.js.org/agent-kit/agent-integrations/) docs page.

| Agent | `--target` | Derived file | Skills folder | Reload |
|---|---|---|---|---|
| **Claude Code** | `claude` | `CLAUDE.md` | `.claude/skills/` | **live** — picked up next prompt |
| **Cursor** | `cursor` | — (reads `AGENTS.md` natively) | `.cursor/skills/` | window reload |
| **Codex** | `codex` | — (reads `AGENTS.md` natively) | `.codex/skills/` | next session |
| **Kiro** | `kiro` | — (reads `AGENTS.md` natively) | `.kiro/skills/` | window reload |
| **GitHub Copilot** | `copilot` | `.github/copilot-instructions.md` | `.github/skills/` | window reload |
| **Antigravity** | `antigravity` | — (reads `AGENTS.md` natively) | `.agent/skills/` | window reload |
| **Gemini CLI** | _derive-only_ | `.gemini/GEMINI.md` | _not supported_ | every invocation |
| **Aider** | _derive-only_ | `CONVENTIONS.md` | _not supported_ | every session |

```sh
# Most common case — claude is the default target
npx agent-kit sync

# Multiple agents on the same project
npx agent-kit sync --target claude,cursor,codex

# Derive-only agents (Gemini, Aider) — skip the skills export
npx agent-kit sync --derive-only
```

Or pin the choice in `package.json` so contributors don't have to remember:

```json
{
  "scripts": { "postinstall": "agent-kit sync" },
  "agentKit": { "targets": ["claude", "cursor"] }
}
```

The derive step always emits `CLAUDE.md`, `.gemini/GEMINI.md`, `.github/copilot-instructions.md`, and `CONVENTIONS.md` regardless of `targets` — the array gates only the **skills** export. So a `["claude", "cursor"]` config keeps every derived file fresh AND mirrors skills into Claude + Cursor.

> **Reload quirk shared across most agents:** if the skills directory (e.g. `.cursor/skills/`) didn't exist when your IDE session started, reload the window once after the first sync so it discovers the new directory. Claude Code is the exception — it picks up skills live.

---

## CLI

Three commands. All accept `--cwd <path>` to override the working directory, and all are idempotent — re-running is a no-op when nothing changed.

### `agent-kit init`

Scaffold `AGENTS.md` (only when missing — never clobbers an existing file) and derive every per-tool file.

```sh
npx agent-kit init
```

### `agent-kit sync`

Re-derive the per-tool files from `AGENTS.md` and export skills from installed packages.

```sh
npx agent-kit sync                          # derive + sync skills (default)
npx agent-kit sync --derive-only            # skip skills export
npx agent-kit sync --skills-only            # skip derivation
npx agent-kit sync --target claude,cursor   # comma-separated skill targets
npx agent-kit sync --path @warlock.js       # extra scan dirs (children = packages)
npx agent-kit sync --projects backend,frontend  # aggregate monorepo projects
npx agent-kit sync --override               # replace user-authored dest folders
```

`--target` accepts any of `claude`, `copilot`, `cursor`, `codex`, `opencode`, `amp`, `goose`, `kiro`, `antigravity`. The default is `claude` only — writing to every target's skills directory on a project that uses none of those tools would litter the working tree. Pick the ones you actually use.

`--path` and `--projects` both pull skills from outside the root's `node_modules/`, but treat the directory differently: `--path X` treats **X's children** as packages (a folder of linked packages); `--projects X` treats **X as one project** — scanning its own `skills/` *and* its `node_modules/` (filtered by that project's `agentKit` config). For a full-stack repo where one session at the root should see skills from `backend`, `frontend`, etc., use `--projects` (or `agentKit.monorepo.projects`). See [**Monorepos**](https://mongez.js.org/agent-kit/monorepos/).

### `agent-kit watch`

Watch `AGENTS.md` and your editable skill source directories; re-derive and re-sync on change. Intended for the active dev loop when editing skills locally and for monorepo / path-linked setups where `postinstall` does not re-fire.

```sh
npx agent-kit watch
npx agent-kit watch --path @warlock.js
npx agent-kit watch --projects backend,frontend
```

The watcher performs a full sync on startup, then watches the **real** skill-source directories — the root `skills/`, each `--path` package's `skills/`, and each `--projects` project's `skills/` + `package.json` — debouncing re-syncs by 150ms. Concrete directories are watched rather than glob patterns (chokidar v4+ dropped glob support). Dependency skills under `node_modules/` aren't watched — they change only on (re)install, which fires `postinstall` → `sync`.

---

## Programmatic API

The CLI is a thin wrapper around the same functions you can import directly.

```ts
import {
  deriveAll,
  syncSkills,
  findProjectRoot,
  scanForSkillPackages,
  deriveSlugForSkill,
} from "@mongez/agent-kit";

const root = await findProjectRoot();
if (!root) throw new Error("No package.json found");

const derived = await deriveAll({ root, targets: ["claude"] });
// derived[i] = { target, outputPath, changed }

const skills = await syncSkills({
  root,
  targets: ["claude", "cursor"],
  scanPaths: ["@warlock.js"], // optional: extra scan roots beyond node_modules
  override: false,            // optional: replace user-authored dest folders
});
// skills.exported, skills.pruned, skills.skipped,
// skills.targets, skills.packages, skills.scannedPaths
```

| Export | Purpose |
|---|---|
| `deriveAll(options)` | Read `AGENTS.md`, write one derived file per requested target. Returns one `DeriveResult` per target. |
| `syncSkills(options)` | Walk scan paths, prune old managed folders, export skill folders into each target's directory. |
| `findProjectRoot(startDir?)` | Walk up from `startDir` (or `process.cwd()`) to the nearest `package.json`. |
| `scanForSkillPackages(nodeModulesPath)` | Low-level: list every package under a `node_modules/` that ships skills. |
| `deriveSlugForSkill(pkgName, skill)` | Compute the flat destination folder name for a skill. |
| `loadAgentKitConfig(root)` | Read the `agentKit` block from the project's `package.json`. |

Types (`DeriveOptions`, `DeriveResult`, `SyncSkillsOptions`, `SkillsSyncResult`, `DeriveTargetName`, `SkillsTargetName`, `AgentKitConfig`) are all exported from the package root.

---

## Derivation targets

`AGENTS.md` → one derived file per tool that doesn't read root `AGENTS.md` natively:

| Tool | Output | Notes |
|---|---|---|
| Claude Code | `CLAUDE.md` | Anthropic's primary config file. |
| Gemini CLI | `.gemini/GEMINI.md` | Doesn't read root `AGENTS.md`. |
| GitHub Copilot | `.github/copilot-instructions.md` | Repository-level custom instructions. |
| Aider | `CONVENTIONS.md` | Load with `/read` or via `.aider.conf.yml`. |

Codex, Cursor, Amp, Jules, Factory, Kilo, Windsurf, OpenCode, and Goose all read root `AGENTS.md` directly — no derivation needed. Skills sync still applies to them via per-tool skill directories.

Every derived file is prefixed with an HTML-comment header noting the source file and the regeneration command, so the relationship is visible inline without affecting how the file renders.

---

## Skills

`syncSkills` (and `agent-kit sync`) reads `skills/` from your **project root** and from every package inside `node_modules/`, then copies each skill directory into the per-agent target paths with a flat, collision-proof folder name.

### Organize your project's own skills in one nested folder

You don't need to publish a package to use skills. Drop a single `skills/` folder at your **project root** and organize it however you think — grouped into category folders, nested as deep as you like:

```
my-app/
└── skills/
    ├── backend/
    │   ├── auth/SKILL.md
    │   └── jobs/SKILL.md
    ├── frontend/
    │   └── forms/SKILL.md
    └── deployment/SKILL.md
```

Claude Code only discovers skills at the **top level** of `.claude/skills/` — no nested folders — which normally forces everything into one flat pile. `agent-kit sync` removes that constraint: it walks your nested `skills/` recursively and flattens each path into a unique top-level name.

```
.claude/skills/
  backend-auth/
  backend-jobs/
  frontend-forms/
  deployment/
```

You keep a tidy, human-readable source tree; Claude gets the flat layout it requires. A directory containing a `SKILL.md` *is* a skill, and its path is its identity — no manifest, no registration.

### Destination layout

After sync, `.claude/skills/` (and any other target you've enabled) looks like:

```
.claude/skills/
  warlock-js-ai/                       # @warlock.js/ai (single-skill package)
  warlock-js-core-add-connector/       # @warlock.js/core (multi-skill)
  warlock-js-core-send-response/
  mongez-agent-kit-overview/           # @mongez/agent-kit
  my-app-backend-auth/                 # local skill at ./skills/backend/auth
```

The slug is `<pkg-slug>` for single-skill packages (where `skills/SKILL.md` lives at the root of `skills/`), or `<pkg-slug>-<skill-name>` for multi-skill packages. The package slug drops the leading `@`, replaces `/` and `.` with `-`, and lowercases. Two packages can never produce the same destination — `deriveSlugForSkill` guarantees uniqueness by prefixing with the package slug.

### Authoring skills inside an npm package

Drop a `skills/` folder at your package root. `agent-kit` walks it recursively — any directory containing a `SKILL.md` becomes a skill. Three layouts are supported:

- **Single-skill (`skills/SKILL.md`):** the whole `skills/` folder is one skill, named after the last segment of your package name.
- **Flat multi-skill (`skills/<name>/SKILL.md`):** each immediate subdirectory is a separate skill.
- **Nested (`skills/<category>/<name>/SKILL.md`):** path segments join with `-` for the destination slug (`backend/auth` → `<pkg-slug>-backend-auth`).

Then add `skills` to your `package.json` `files` field so it ships:

```json
{
  "files": ["dist", "skills", "README.md"]
}
```

> **Folder name is the routing identity.** Claude Code routes by folder name; SKILL.md frontmatter `name:` is purely cosmetic. `agent-kit` never reads or rewrites your SKILL.md content — your source file is copied verbatim into the destination folder.

### Safety guarantees

- **Hand-authored skills are never clobbered.** Each synced folder gets a `.agent-kit-managed` sentinel. On re-sync, only sentinel-marked folders are pruned and rewritten. If you've manually created `.claude/skills/my-custom-skill/`, it stays untouched.
- **User-authored collisions skip with a warning.** If a destination slug happens to match a hand-authored folder, sync skips it (pass `--override` to replace).
- **Two-package collisions throw loudly.** If two packages produce the same destination slug, sync errors with both package names — never a silent overwrite.

---

## Project-level config (`agentKit` in `package.json`)

An optional `agentKit` block configures defaults that apply to every `agent-kit sync` invocation. The CLI's `--target` flag still overrides at call time.

```json
{
  "agentKit": {
    "targets": ["claude", "cursor"],
    "pick": {
      "@warlock.js/core": true,
      "@my-org/lib": ["only-this-skill"]
    },
    "omit": {
      "@warlock.js/core": ["add-connector"]
    },
    "monorepo": {
      "projects": ["backend", "frontend"]
    }
  }
}
```

| Field | Effect |
|---|---|
| `targets` | Default skill-sync targets when the CLI omits `--target`. |
| `pick` | Allowlist — only listed packages are synced. `true` includes the whole package; `string[]` includes only the named skills (by source folder name). |
| `omit` | Denylist — drop entire packages (`true`) or specific skills (`string[]`). Runs after `pick`. Also acts as a global veto over monorepo-aggregated skills. |
| `monorepo.projects` | Sibling project dirs (or one-level globs like `apps/*`) to aggregate into this root's skill dirs. Each is scanned as its own project — its `node_modules/` deps (filtered by *that project's* `agentKit` config) plus its authored `skills/`, prefixed with the project dir name. Default for `--projects`. |

Malformed sub-fields are silently dropped — a typo in one entry never blocks the whole sync.

---

## Recipes

### Bootstrap skills for a new package

When starting a fresh project and you want every supported agent ready in one go — derived files plus skills from installed packages.

```sh
cd my-new-app
yarn install
npx agent-kit init
npx agent-kit sync --target claude,cursor,codex
```

Then wire it into `postinstall` so every future install re-syncs automatically:

```json
{
  "scripts": {
    "postinstall": "agent-kit sync"
  },
  "agentKit": {
    "targets": ["claude", "cursor", "codex"]
  }
}
```

### Generate a CLAUDE.md from an existing AGENTS.md

When the team already has an `AGENTS.md` but Claude Code is reading a stale `CLAUDE.md`. Skip the skill sync entirely.

```sh
npx agent-kit sync --derive-only
```

`CLAUDE.md`, `.gemini/GEMINI.md`, `.github/copilot-instructions.md`, and `CONVENTIONS.md` are all regenerated from the current `AGENTS.md`. Files that already match the would-be content on disk are not rewritten, so this is safe to run on every save.

### Develop skills locally in a monorepo

When editing skill files inside a workspace package and you want the changes mirrored to `.claude/skills/` live, without republishing to npm.

```sh
npx agent-kit watch --path packages
```

The watcher tracks `AGENTS.md`, every `packages/**/skills/**/SKILL.md`, and every `node_modules/**/skills/**/SKILL.md`. Save a SKILL.md and Claude picks it up on the next prompt — no restart, no reinstall. Packages discovered under `--path` win on dedupe over the same name in `node_modules/`, so your local edits always take precedence.

### Filter skills from a noisy dependency

When a dependency ships a bunch of skills you don't want flooding `.claude/skills/`. Use `omit` to drop the whole package or specific skills inside it.

```json
{
  "agentKit": {
    "omit": {
      "@some-vendor/sdk": true,
      "@warlock.js/core": ["add-connector", "send-response"]
    }
  }
}
```

The next `agent-kit sync` skips them entirely. To go the other way — only sync a curated allowlist — use `pick` instead:

```json
{
  "agentKit": {
    "pick": {
      "@warlock.js/core": true,
      "@mongez/agent-kit": ["overview"]
    }
  }
}
```

### Sync to a non-Claude agent

When the team uses Cursor (or Codex, Copilot, Kiro, etc.) instead of Claude Code. Override the default `claude` target.

```sh
npx agent-kit sync --target cursor
```

Or persist the choice in `package.json`:

```json
{
  "agentKit": {
    "targets": ["cursor"]
  }
}
```

Cursor reads root `AGENTS.md` natively — no derived file needed — and `.cursor/skills/` now contains every skill from your installed packages, namespaced by package slug.

---

## Related packages

Part of the broader [`@mongez/*`](https://github.com/hassanzohdy) ecosystem. Several `@mongez` packages ship their own skills out of the box — install them and `agent-kit sync` picks them up automatically.

| Package | Use when you need |
|---|---|
| [`@mongez/reinforcements`](https://github.com/hassanzohdy/reinforcements) | Helpers for arrays, objects, strings, numbers, async, and functions. Ships 12 skills. |
| [`@mongez/cache`](https://github.com/hassanzohdy/mongez-cache) | Framework-agnostic cache facade with pluggable drivers. Ships 11 skills. |
| [`@mongez/dotenv`](https://github.com/hassanzohdy/mongez-dotenv) | Small `.env` loader with type coercion and `${VAR}` interpolation. |
| [`@mongez/react-router`](https://github.com/hassanzohdy/react-router) | Configuration-based React router. Ships 7 skills. |
| [`@mongez/react-form`](https://github.com/hassanzohdy/mongez-react-form) | Headless React form handler. Ships 6 skills. |

For the full API surface in a single LLM-friendly file, see [`llms-full.txt`](./llms-full.txt). For the table-of-contents-style index, see [`llms.txt`](./llms.txt).

---

## License

MIT — see [LICENSE](./LICENSE).
