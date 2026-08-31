# Changelog

All notable changes are documented here. The format follows Keep a Changelog, and releases use Semantic Versioning.

## [Unreleased]

## [0.16.0] - 2026-08-31

### Added

- An isolated Character Runtime phase between player Action resolution and Storyteller composition. Each selected Character now receives only its own private file, actor-visible state, observations, memories, and Agendas.
- Event-sourced Character state for perceived events, beliefs, emotion, relationship stances, current intent, disclosure history, public cues, and participation; state follows timeline forks and resumes safely after partial model failure.
- Authorable Character mind profiles for initiative, initial presence, drives, fears, values, mannerisms, and secret-reveal policy, stored in portable Story Cast metadata.
- Structured Scene Blocks for narration, Character action, and Character dialogue, with speaker authorization and a player-facing living-stage Cast presence line.
- Runtime and API diagnostics for isolated actor plans, plus tests for private-context separation, invalid speaker rejection, resumable parallel planning, public-state sanitization, and branch isolation.
- Contract repair for malformed Character plans and Storyteller Scene Blocks. One corrective provider call is attempted before a conservative no-action Character plan or verified-Observation narration is persisted.

### Changed

- The Director now interprets only player Actions and identifies relevant Cast candidates; it no longer reads private Character files or decides Character Agendas.
- Character runtimes, rather than the Director or Storyteller, decide whether each selected Character acts, speaks, reacts, observes, or deliberately remains silent.
- The Storyteller receives filtered Character Performance Briefs instead of complete private Character files and produces one coherent JSON Scene Block beat.
- Narration safety now also rejects verbatim disclosure of private Character source text that the Character did not authorize.
- DeepSeek narration retries disable strict response formatting after an empty JSON response while Character and control phases keep their structured-output contract.

## [0.15.0] - 2026-08-30

### Added

- One coherent Storyteller narration pass per player input, with Cast members treated as optional scene participants instead of a mandatory reply queue.
- Player-autonomy validation discards narration that invents unrequested player movement, interaction, speech, thoughts, feelings, memories, or decisions; one corrected retry is allowed before a verified-observation fallback.
- Rolling continuity summaries, calibrated token estimates, bounded recent history, and a persisted deterministic multilingual retrieval index for Story source and older-message recall.
- Advanced SillyTavern World Info semantics including recursion, selective matching, groups, probability, timing, insertion, and Character filters; safe Regex placement/depth/edit behavior; and declarative import of plain manual Quick Replies.
- Visual Runtime editors for Lore activation, causality, transforms, and prompt layers, plus a no-model runtime debugger, connection diagnostics, aggregate usage, and retrieval health.
- Conversation-scoped attachments with strict type/size limits, immutable sent history, extracted text, provider capability gating, and native OpenAI-compatible/OpenRouter, Anthropic, and Gemini image payloads.
- Browser voice dictation and Storyteller read-aloud controls.
- Automated 2,000-message context performance/recall coverage and attachment/provider protocol tests.

### Changed

- Starting a Playthrough now requires an explicitly configured AI service; content authoring, import, and library management remain provider-independent.
- Database migration 10 transfers Conversations using the retired built-in model to the earliest enabled real connection when available.
- Database migration 13 removes legacy zero-cost mock usage rows so diagnostics no longer advertise a retired built-in model.
- Default history is bounded to recent messages plus relevant recall and durable continuity; explicit whole-block context budgets remain available.

### Removed

- The built-in demo model, its product adapter, seeded connection, model-list entries, and UI-specific Demo state.

## [0.14.0] - 2026-08-30

### Added

- A Story-only product model: every playable experience is a Story that can be narrator-only, single-cast, or multi-cast.
- Inline Cast authoring for complete Character Card fields, prompt layers, example dialogue, alternate greetings, private context, goals, boundaries, metadata, and ecosystem extensions.
- A safe declarative Story Runtime with actor-scoped transforms across user input, model input, model output, and display; macro expansion; selective World Info activation; and prompt automations.
- Database migration 9, which wraps storyless Conversations and orphan Character Cards in Stories, creates missing Playthroughs, and preserves imported Lore and regex rules idempotently.
- Story schemas, runtime tests, migration tests, and a Story-only executable user journey covering creation, play, portability, and sharing.

### Changed

- Library, Home, Chats, onboarding, sharing, import, and creation now expose Stories and Personas instead of a separate Character product.
- Direct SillyTavern Character Cards become single-cast Stories; Groups become ensemble Stories; World Info becomes narrator-only Stories; imported chats attach to Story Playthroughs.
- Character Card system prompts, depth prompts, examples, alternate greetings, embedded World Info, talkativeness, and extension payloads are preserved and used by runtime context assembly.
- Tavern packs and old Harness Tavern data normalize to Story-owned Cast while retaining Actor resources as an internal compatibility and serialization detail.
- Story Runtime is part of canonical source comparison, import/export, public summaries, and the complete Story workspace.

### Removed

- Top-level Character browsing, creation, profiles, favorites, sharing, editing, and direct-chat entry points from the browser and public bootstrap.
- Public direct Conversation creation; clients now start a Story Playthrough.

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

[Unreleased]: https://github.com/HenryQUQ/harness-tavern/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/HenryQUQ/harness-tavern/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/HenryQUQ/harness-tavern/releases/tag/v0.15.0
[0.14.0]: https://github.com/HenryQUQ/harness-tavern/releases/tag/v0.14.0
[0.13.0]: https://github.com/HenryQUQ/harness-tavern/releases/tag/v0.13.0
[0.12.0]: https://github.com/HenryQUQ/harness-tavern/releases/tag/v0.12.0
