# Changelog

All notable changes are documented here. The format follows Keep a Changelog, and releases use Semantic Versioning.

## [Unreleased]

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
