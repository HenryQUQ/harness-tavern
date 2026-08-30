# Harness Tavern

[![CI](https://github.com/HenryQUQ/harness-tavern/actions/workflows/ci.yml/badge.svg)](https://github.com/HenryQUQ/harness-tavern/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-6f5bd3.svg)](LICENSE)

[中文说明](README.zh-CN.md)

Harness Tavern is a **Tavern-first causal story engine** for persistent character roleplay. Chat is a narrative view, not the system of record: durable State, a resumable Control Loop, declarative Actions, actor-scoped Observations, persistent Intent, and replayable Events determine what actually happened.

Version: **0.13.0**

## Start in one command

Requirements: Node.js 22.19 or newer.

```bash
npm start
```

Open `http://127.0.0.1:8787`.

A built-in offline demo model, a default player Persona, three characters, and the multi-character story **Midnight at the Glass Observatory** are seeded automatically. A new user can receive a first roleplay response without understanding API keys, providers, prompts, or agent modes.

## Product principles

- **Tavern language, not infrastructure language.** Primary navigation is Home, Chats, Library, Create, and Settings.
- **Progressive disclosure.** AI connections, routing, response depth, usage, and creator-only state are available, but never block the first experience.
- **The player owns the player.** The runtime does not invent the user’s dialogue, thoughts, feelings, identity, or successful actions.
- **Prose does not create facts.** Models propose intent; authored Action rules validate preconditions and commit effects before narration is rendered. Contradictory drafts are discarded, corrected, or replaced by verified Observations.
- **Intent persists until facts end it.** Character Actions require an owned active Agenda, and only authored state conditions can complete, fail, pause, or resume one.
- **Private knowledge stays private.** Player Journal, public share previews, and creator inspection use separate projections.
- **Share before platform lock-in.** Characters and stories can move as versioned Tavern packs or portable share links.
- **Extend without executing strangers’ code.** Imported extensions are declarative templates, quick actions, and themes.

## Player journey

### First visit

The onboarding flow asks only:

1. What should the Tavern call you?
2. Would you like to meet a character, enter a story, or create something?

It does not ask for a provider or model. The built-in model is selected automatically.

### Home

Home shows:

- recent conversations and playthroughs with a readable recap;
- characters ready to meet;
- stories ready to enter;
- unfinished creator drafts;
- direct entry to the sample ensemble story.

### Character chat

Open a Character Profile, select the Persona you want to use, then start or continue a conversation. The character’s identity, voice, goals, boundaries, memories, and relationship state persist independently from the selected model.

### Story playthrough

A Story is reusable content. Starting it creates a Playthrough, and each Playthrough can contain multiple named Timelines. “What if?” branches do not overwrite the original history.

### Player Journal

The Journal and Story Engine inspector translate runtime state into player language:

- current scene;
- recap;
- unresolved threads;
- known facts;
- relationship descriptions;
- visible world state;
- timelines.
- resolved or rejected Action receipts;
- public persistent character Intent;
- context assembly policy and state revision.

It deliberately omits Director-only lore and private character knowledge.

## Creator journey

Creators do not need to write JSON, prompts, schemas, or Harness configuration.

### Quick Character

Describe the person you want to meet in ordinary language. Harness Tavern produces an editable draft containing voice, relationship premise, first message, goals, secrets, and boundaries. Advanced fields remain optional.

### Quick Story

Describe the desired experience, choose a friendly template, cast size, genre, tone, and player role. The guided creator produces:

- a hook and premise;
- distinct character drafts;
- public and private cast knowledge;
- world rules;
- opening scene and scene outline;
- content notes;
- remix policy.

The result remains a draft until the creator reviews and publishes it. It can then be play-tested immediately.

### Reusable templates

A creator can save an existing Story as a declarative Story Template. The template becomes available in Create without adding executable code.

## Sharing

Harness Tavern separates editable source from distribution and public preview.

### Editable Story source

Every published single-character, multi-character, or narrator-only Story has a canonical `harness-tavern-story/v2` source. A compact Story is one self-contained `*.story.tavern.json` file. A larger Story can use `story.tavern.json` plus relative Character Card, Lorebook, Markdown scene, declarative Action, and persistent Agenda files. These files use stable keys rather than database IDs and can be edited directly, validated, versioned in Git and recompiled into SQLite.

See [Editable Story sources](docs/STORY_SOURCES.md) and the [checked-in project example](examples/stories/midnight-at-the-glass-observatory/story.tavern.json).

### Public preview

A revocable browser page containing only player-safe material: title, hook, public cast descriptions, tags, content notes, and public lore. It excludes private cast context, secrets, Director-only lore, author notes, provider settings, and local IDs.

### Playable Tavern pack

A versioned `.tavernpack.json` distribution snapshot containing the Story and required Characters. Its SHA-256 integrity digest detects accidental or deliberate modification; it is not a creator identity signature. Portable playthrough packs also preserve the causal event stream, while a full backup includes the local library and conversations but never credentials.

### Portable link

Small packs can be compressed into a URL fragment. The receiving Tavern previews the contents and conflicts before import. Larger content falls back to the downloadable pack.

Import always supports a preview step and explicit conflict strategy:

- **Copy**: keep existing content and create a separate copy;
- **Replace**: update matching local content;
- **Skip**: reuse matching local content.

SillyTavern Character Card V2/V3 JSON, PNG and CHARX are accepted. A preview-first full migration can scan a SillyTavern user-data folder or ZIP and migrate Characters, Chats, Group Chats, Groups, World Info, Personas and compatible generation presets. `secrets.json` is always excluded; extensions, Quick Replies and vector indexes are inventoried but never executed or trusted as portable state.

## Safe extensions

The extension format is deliberately declarative. An imported extension can contribute:

- character templates;
- story templates;
- composer quick actions;
- theme tokens.

Executable fields such as scripts, JavaScript, modules, entrypoints, or eval are rejected. This makes community content easy to share while keeping the trust boundary understandable.

## AI connections

The application works without an external provider. Under **Settings → AI Connections**, advanced users can add:

- OpenRouter, including OAuth/PKCE account authorization and routing preferences;
- OpenAI-compatible providers;
- Anthropic;
- Gemini;
- Azure OpenAI;
- local Ollama, LM Studio, vLLM, llama.cpp, and LocalAI connections;
- more than thirty provider presets.

The chat header shows the active AI service and model. Open it to switch connected APIs, refresh or type a model ID, apply the built-in Balanced, Cinematic, or Focused response preset, edit conversation-specific AI instructions and context history, tune reasoning strength, response behaviour, temperature, Top P, Top K, Min P, frequency/presence/repetition penalties, seed and stop sequences, or add bounded provider-specific JSON options. Every setting—including reasoning strength—can be saved in or used to update a reusable custom preset. History and context-budget fields are nullable: by default Tavern imposes no context ceiling; an explicitly chosen budget omits only complete context blocks and never cuts text mid-block.

SillyTavern Chat Completion and Text Completion preset JSON files can be imported from the same preset section. Tavern previews the exact mapping first, translates enabled prompt blocks into conversation instructions, preserves compatible samplers and reasoning effort, and identifies fields it will not import. API/model credentials and output-token caps are intentionally excluded. Response length remains a writing-style instruction rather than an artificial token ceiling: Harness Tavern leaves output capacity to the selected provider, persists complete narration without a character-count slice, and suspends incomplete replies instead of displaying truncated data.

Characters, stories, and the offline demo connection are seeded, but a demo conversation is no longer created automatically. Once a real API is connected, new conversations prefer it; the built-in Mock remains an offline fallback only when no other enabled connection exists.

API keys are encrypted at rest. Consumer website subscriptions are not treated as API credentials unless the provider offers an official authorization flow.

## Architecture

```text
Player / Creator surfaces
        ↓
Human-facing application services
(Home, Journal, Story Engine inspector, Guided Creator, Sharing, Migration)
        ↓
Tavern domain
(Character, Persona, Story, Playthrough, Timeline, Cast)
        ↓
Durable causal runtime
(Command → Control Plan → Action resolution → Observation → Narration)
        ↓
Append-only events + deterministic projections + SQLite
```

The default product has no Bash, repository editing, PTY, LSP, or coding-agent prompt. DeepSeek Harness remains an optional downstream integration target, not the visible product model.

See:

- [Experience architecture](docs/EXPERIENCE_ARCHITECTURE.md)
- [Sharing and extensions](docs/SHARING_AND_EXTENSIONS.md)
- [Creator guide](docs/CREATOR_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Editable Story sources](docs/STORY_SOURCES.md)
- [API](docs/API.md)
- [Security](docs/SECURITY.md)
- [Migration](docs/MIGRATION.md)
- [Development](docs/DEVELOPMENT.md)
- [Operations](docs/OPERATIONS.md)
- [Architecture decisions](docs/adr/README.md)

## Validation

```bash
npm run check
npm run test:coverage
npm run verify:journey
npm run doctor
npm run story:validate -- examples/stories/midnight-at-the-glass-observatory
npm run release
```

`npm run verify` is the local merge gate. GitHub Actions runs the same source checks, coverage thresholds, fresh-user journey, isolated database diagnosis, and dependency audit. The release command performs cold extraction tests, Git bundle verification, checksums, and optional full DeepSeek Harness snapshot assembly without modifying Git history or tags.

## Container

The supplied container runs as an unprivileged user with a persistent `/data` volume. Non-loopback startup requires an access token.

```bash
export HT_ACCESS_TOKEN="$(openssl rand -hex 32)"
docker compose up --build -d
```

See [Operations](docs/OPERATIONS.md) before exposing the service through a reverse proxy.

## Deployment boundary

This release is a local-first, single-owner beta suitable for real roleplay, story creation, sharing, migration, evaluation, and continued product development. It is not presented as an independently security-audited, multi-tenant hosted service. Multi-user RBAC, billing, central moderation, distributed persistence, native mobile clients, and a hosted marketplace remain outside this release.
