---
description: "Authoring and distribution toolkit for AI coding-agent files: derive per-tool instruction files from one AGENTS.md and sync npm-package skills into agent skill folders. Exports `deriveAll`, `buildDerivedContent`, `syncSkills`, `scanForSkillPackages`, `autoDiscoverSkills`, `loadAgentKitConfig`, `findProjectRoot`, `resolveMonorepoProjects`, `DERIVE_TARGETS`. Use for: \"generate CLAUDE.md and copilot instructions from AGENTS.md\", \"ship skills from my npm package\", \"agent-kit sync in postinstall\", \"skills in a monorepo\", \"write a SKILL.md\". Not this package: running an agent or calling an LLM; skill content for other libraries lives in that library's own package."
---
# @mongez/agent-kit

Write project instructions once in `AGENTS.md`; agent-kit derives the tool-specific files (Claude, Cursor, Copilot, Gemini, and others). It also scans installed packages for a `skills/` folder and mirrors them into every agent's skills directory: one folder per skill (`<pkg-slug>-<skill>`), or, for a package that ships `skills/index.md`, one grouped folder per package with a router `SKILL.md` and a `<topic>.md` per skill (`agentKit.layout`, see `configuration.md`). It is a CLI first (`agent-kit sync`, `agent-kit init`) with the same functions exported for scripts.

## The 80% path
1. Orient with `overview.md`, then `cli-usage.md` for `init`, `sync` and their flags.
2. Set targets and filters in `package.json` under `agentKit` (`configuration.md`).
3. Wire `agent-kit sync` into `postinstall` so consumers stay current.
4. Publishing skills from your own package: `authoring-skills.md`.
5. Several projects or linked dev packages: `monorepos.md`; per-agent output details: `agent-integrations.md`.
6. Stale or missing output: `troubleshooting.md`; worked examples: `recipes.md`.

## Conventions and pitfalls
- Edit `AGENTS.md` and the skills source, never the derived files; they are regenerated and overwritten.
- Managed folders carry a `.agent-kit-managed` sentinel. Folders without it are treated as hand-written and left alone.
- A skill's frontmatter `description` is what an agent sees when choosing; write it as routing text, not a summary.
- Scan roots are `node_modules` by default; linked packages and monorepos need `--path` or `--projects`.
- `--derive-only` skips the skills mirror, which is useful when a repo ships no skills.
