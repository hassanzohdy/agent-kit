---
name: mongez-agent-kit-configuration
description: |
  The `agentKit` config block in `package.json` for `@mongez/agent-kit` — every field and how it resolves: `targets` (default skill-sync agents), `pick` (allowlist) and `omit` (denylist) for filtering noisy dependency skills, `layout`/`layoutOverrides` for grouped vs flat export, `projectPrefix` for the project's own skill slugs, and `monorepo.projects` for aggregating sibling projects. Covers pick-then-omit ordering, per-project config in a monorepo, and the root `omit` global veto.
---

# Configuration (`agentKit` in `package.json`)

Every `agent-kit sync` invocation reads an optional `agentKit` block from the project root's `package.json`. CLI flags (`--target`, `--projects`) still override at call time, but the config is the place to pin choices so contributors don't have to remember them.

```json
{
  "scripts": { "postinstall": "agent-kit sync" },
  "agentKit": {
    "targets": ["claude", "cursor"],
    "pick": {
      "@warlock.js/core": true,
      "@my-org/lib": ["only-this-skill"]
    },
    "omit": {
      "@some-vendor/sdk": true,
      "@warlock.js/core": ["add-connector"]
    },
    "layout": "auto",
    "layoutOverrides": { "@some-vendor/sdk": "flat" },
    "projectPrefix": "my-app",
    "monorepo": {
      "projects": ["backend", "frontend"]
    }
  }
}
```

Malformed sub-fields are silently dropped — a typo in one entry never blocks the whole sync.

## `targets`

Default skill-sync targets when the CLI omits `--target`. Valid values: `claude`, `copilot`, `cursor`, `codex`, `opencode`, `amp`, `goose`, `kiro`, `antigravity`.

```json
{ "agentKit": { "targets": ["claude", "cursor"] } }
```

Resolution order: `--target` flag → `agentKit.targets` → built-in default (`["claude"]`). An explicit empty array (`"targets": []`) is honored but warns — it syncs zero targets, almost always a mistake.

`agent-kit init` **seeds this field for you** so you never have to discover the syntax by hand: it writes `"targets": ["claude"]` (the built-in default, made explicit) when none exists, or whatever you pass to `init --target a,b`. An already-set `targets` is left untouched unless you pass `--target`. See **[CLI usage](../cli-usage/)**.

`targets` gates only the **skills** export. The derive step always emits `CLAUDE.md`, `.gemini/GEMINI.md`, `.github/copilot-instructions.md`, and `CONVENTIONS.md` regardless.

## `pick` — allowlist

When `pick` is set, **only** the listed packages are synced; everything else is dropped. Keys are exact package names.

- `true` → include the whole package's skills.
- `string[]` → include only the named skills (by their **source folder name**).

```json
{ "agentKit": { "pick": { "@warlock.js/core": true, "@mongez/agent-kit": ["overview"] } } }
```

An empty `"pick": {}` means "include nothing" (it warns). A `pick` whose entries are all malformed is treated as unset.

## `omit` — denylist

Drop packages or specific skills. Keys are exact package names.

- `true` → omit the entire package.
- `string[]` → omit specific skills by **source folder name**; other skills from the package still sync.

```json
{ "agentKit": { "omit": { "@some-vendor/sdk": true, "@warlock.js/core": ["add-connector", "send-response"] } } }
```

## How `pick` and `omit` compose

`pick` runs **first** (allowlist the packages), then `omit` runs over what survived (trim specific skills). So you can say "include `@warlock.js/core` but skip its noisy `add-connector` skill" in one block:

```json
{
  "agentKit": {
    "pick": { "@warlock.js/core": true },
    "omit": { "@warlock.js/core": ["add-connector"] }
  }
}
```

## `layout` — grouped vs flat export

How a dependency package's skills are exported. Agents budget their skill listings (Claude Code keeps descriptions for only about 20k chars; Codex dropped every description at 300 skills), so many flat skills can hide each other.

- `"auto"` (default) — group a package with 2+ skills **only when it ships `skills/index.md`**; everything else is flat, as in 1.2.
- `"grouped"` — force grouping for every package with 2+ skills.
- `"flat"` — one top-level folder per skill (the 1.2 behaviour).

```json
{ "agentKit": { "layout": "grouped" } }
```

A grouped package exports `<pkgSlug>/SKILL.md` (a router: the package's `index.md` description and body plus a generated Topics table), `<pkgSlug>/<topic>.md` per topic, and `<topic>/` for its assets. Single-skill packages, root-layout skills and the project's own skills always stay flat. `SyncSkillsOptions.layout` overrides the config for one programmatic run. Each target logs `claude: N skills (G grouped packages), C description chars`.

## `layoutOverrides`

Per-package `layout`, keyed by exact package name; wins over `layout`. Invalid values are dropped.

```json
{ "agentKit": { "layout": "auto", "layoutOverrides": { "@warlock.js/core": "grouped", "@some-vendor/sdk": "flat" } } }
```

## `projectPrefix`

Slug prefix for the project's **own** authored skills (`skills/` at the project root). Defaults to the slug of the `package.json` `name`, or `project` when that slug doesn't start with a letter (`5.7` → `5-7` → `project`). Monorepo projects keep their directory-name prefix regardless.

```json
{ "agentKit": { "projectPrefix": "my-app" } }
```

## `monorepo.projects`

A list of sibling project directories to aggregate into this (root) project's skill dirs, so one session opened at the repo root sees skills from every project. Each entry is a path relative to the root (or absolute) and may be a **one-level glob** (`apps/*`).

```json
{ "agentKit": { "monorepo": { "projects": ["backend", "frontend"] } } }
```

Each listed project is scanned **as its own project**:

- Its `node_modules/` dependency skills are filtered by **that project's own** `agentKit.pick`/`omit` (read from the project's `package.json`).
- Its authored `skills/` folder is exported with the **project directory name** as the slug prefix (`backend/skills/code-standards` → `backend-code-standards`).

Two precedence rules to know:

- **Shared dependencies dedupe to one copy.** If two projects depend on the same package, its skills are exported once (the union of what each project kept) — skill content is the same documentation regardless of which project pulled it in.
- **The root's `omit` is a global veto.** After aggregation, the root `package.json`'s `omit` is applied across everything, so the root can ban a dependency repo-wide even if a project kept it.

A project's own `targets` and `monorepo` are ignored during aggregation — only its `pick`/`omit` shape what it contributes, and aggregation never recurses into a project's own `monorepo.projects`. The CLI equivalent is `--projects backend,frontend`; see **[CLI usage](../cli-usage/)** and the dedicated **[Monorepos](../monorepos/)** page.
