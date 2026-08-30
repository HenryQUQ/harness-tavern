# Changelog

All notable changes are documented here. The format follows Keep a Changelog, and releases use Semantic Versioning.

## [Unreleased]

### Added

- A discoverable Library content-type contract and strict `/api/library/items` endpoint for explicit Character and Story structures.
- Read-only compatibility access for legacy generated drafts and an ADR defining the framework-first authoring boundary.
- Complete Character and Story workbenches covering authored identity, voice, private intent, Cast, Lore, Markdown Scenes, causal State, Actions, Agendas, visibility, compatibility data, and raw canonical source access.
- Source-aware optimistic conflict protection so browser edits cannot silently overwrite newer Character resources or Story files.
- A documentation home, ordinary-user getting-started guide, and comprehensive developer guide covering the project's causal construction principles, repository structure, contribution workflow, and change-specific validation expectations.
- Repository checks for broken local links in Markdown documentation.

### Changed

- Library-first **New** and **Import** actions now replace the separate creative dashboard. Blank Character/Story flows add only the minimum valid structure and immediately open the complete editor.
- Built-in extensions provide presentation foundations but no creative templates or fixed composer prompts; optional extension blueprints never drive core creation implicitly.
- Story Cast editing and persistence no longer applies the former arbitrary 20-member storage ceiling.
- Rebuilt the English and Chinese READMEs as approachable product introductions with a guided first-run path, migration and ownership explanations, honest deployment boundaries, and audience-based documentation navigation.
- Expanded the GitHub contribution entrypoint to connect architectural invariants with practical branch, test, security, and pull-request requirements.

### Removed

- The opinionated brief-to-draft generator, generated draft publish state machine, and built-in Story-to-template workflow. Retired HTTP routes return 410 without deleting existing draft rows.

## [0.13.0] - 2026-08-30

### Added

- Durable causal runtime with Commands, typed Actions, preconditions/effects, actor-scoped Observations, persistent Agendas, resumable Control Loops, idempotency and state snapshots.
- Canonical `harness-tavern-story/v2` authoring sources with single-file and multi-file projects, Action/Agenda resources, state visibility, JSON Schema validation, browser/CLI editing and SQLite compilation.
- Preview-first SillyTavern cards, backup and user-directory migration for Characters, Worlds, Groups, Chats, Personas and compatible presets.
- Portable causal playthroughs, credential-free full backups and Character Card V3 export.
- A responsive Story workspace with a player-safe causal inspector.

### Changed

- Automatic generation has no optional Tavern-imposed token ceiling, default context ceiling, or post-response character slice; explicit context budgets omit only whole blocks.
- Model failure preserves the received command and resumes without replaying already committed effects.
- Pack and SillyTavern database imports are atomic; compressed migrations are rejected from declared expanded sizes before extraction.
- Player endpoints sanitize private effect paths, Control Plans, Agenda decisions and context block identifiers.
- Character Actions require an active owned Agenda, Agenda lifecycle changes require authored fact conditions, and contradictory narration is discarded, retried once, then safely rendered from verified Observations.
- Story-authored Agendas supersede generic card-goal loops for the same owner, reducing repeated control work while retaining fallback intent in ordinary character chats.
- Story v2 and ensemble speaker planning no longer impose arbitrary 20-character and six-speaker ceilings.

## [0.12.0] - 2026-08-29

### Added

- Tavern-first character chat, ensemble stories, timelines, creator workflows, portable sharing, declarative extensions, provider adapters, encrypted credentials, and local SQLite persistence.

[Unreleased]: https://github.com/HenryQUQ/harness-tavern/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/HenryQUQ/harness-tavern/releases/tag/v0.13.0
[0.12.0]: https://github.com/HenryQUQ/harness-tavern/releases/tag/v0.12.0
