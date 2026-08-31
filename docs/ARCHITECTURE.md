# Architecture

## Product boundary

Harness Tavern is a causal Story product. A Story is the complete playable package: Cast, prompt layers, Lore, transforms, automations, Scenes, causal definitions, and opening routes. Narrator-only, single-actor, and ensemble experiences use this same aggregate. Chat is one projection of a Playthrough event stream; it is not the state store and does not decide whether an attempted action succeeded. Its default runtime intentionally excludes coding-agent capabilities such as Bash, file editing, PTY, LSP, repository tools, and coding personas.

DeepSeek Harness is treated as an optional compositional substrate. The Tavern domain remains a separate product layer so changes in the upstream developer-preview runtime do not leak into player or creator concepts.

## Layers

```text
HTTP and browser surfaces
├── Player application
├── Content authoring workspaces
└── Public share page

Human-facing services
├── Home aggregation
├── Player Journal
├── Explicit Library content lifecycle
├── Sharing and import
├── Editable Story source workspace
└── Declarative Extension Registry

Tavern domain
├── Story
├── Story-owned Cast / Actor resources
├── Persona
├── Playthrough
├── Conversation Cast
└── Timeline / Branch

Runtime
├── Story Runtime (Lore, macros, transforms, automations)
├── Context Builder
├── Automatic reasoning-depth resolver
├── Provider Registry
├── Control-plan validator
├── Declarative Action Registry
├── Actor-scoped Observation router
├── Persistent Agenda evaluator
└── Resumable Control Loop

Persistence
├── Versioned Story source files
├── SQLite runtime projections and source bindings
├── Append-only events
├── Deterministic projection
├── Control-loop runs and state snapshots
├── encrypted provider credentials
└── audit/import/share records
```

## Turn lifecycle

```text
claim conversation lock
→ persist Command and user.message with command/correlation identifiers
→ apply Story `user_input` transforms
→ read Story, Persona, active Cast and the selected branch projection
→ activate public/director Lore, expand macros, and inject Story control automations
→ apply Story `model_input` transforms to the assembled context
→ build the Director context and request a Control Plan
→ normalize player Actions and discard unauthorised Character Actions
→ deterministically validate actor permission, JSON Schema parameters and authored preconditions
→ append Action receipt, authoritative effects and actor-scoped Observations
→ choose relevant Cast participants without creating a mandatory speaker queue
→ build one isolated Character context per participant from its own private file, visible facts, observations, memories, persistent inner state, and owned Agendas
→ request Character plans concurrently; repair malformed plans once, then use a conservative no-action/no-disclosure plan if the repaired contract is still invalid
→ persist perception/belief/emotion/relationship/intent/disclosure state, and resolve proposed Character Actions through the same deterministic registry
→ derive Agenda completion/failure/pause/resume only from authored fact conditions
→ build one player-visible Storyteller context from verified facts plus filtered Character Performance Briefs
→ render one coherent structured Scene Block beat, apply Story `model_output` transforms, reject state contradictions, unauthorized private disclosure, or unrequested player actions, retry once, and fall back to verified Observations when needed
→ append completion, usage and a deterministic state snapshot
→ release lock at quiescence
```

The configured response depth can be `auto`; the resolved depth is recorded separately. Regardless of depth, the product uses one causal pipeline rather than exposing multiple agent modes. Story-authored Agendas replace generic Character Card goal loops for the same owner; card goals remain fallback durable intent when no contextual Agenda exists. A syntactically valid but contract-invalid Character response is repaired once; if it remains invalid, the runtime records a conservative plan that observes but cannot speak, act, disclose, or mutate beliefs. Transport, authentication, rate-limit, and truncation failures still suspend the loop instead of being mistaken for a Character decision. Provider failure does not erase a received command: the loop preserves completed effects and resumes from its durable phase. Idempotency keys prevent duplicate command execution.

## Event sourcing

Messages and durable state changes are immutable events. `reduceEvents()` projects:

- visible messages;
- memories;
- world state;
- relationships;
- goals;
- commitments;
- Commands, proposed Actions and Action receipts;
- actor-scoped Observations;
- persistent Agendas and clocks;
- per-Character perceptions, beliefs, emotional state, relationship stances, intent, disclosure history, and public participation cues;
- current scene;
- continuity summary.

A Timeline is a branch with a parent and event boundary. Projection walks lineage and reads only parent events at or before the child boundary.

## Knowledge separation

The Story Cast stores public and private context separately. The Director sees public Cast summaries and Director Lore, but never receives Character-private files or ownership of Character Agendas. Each selected Character runtime receives its own private file, own memories and beliefs, actor-visible state and Observations, and owned Agendas; it never receives another Character's private context. The Storyteller receives player-visible state plus filtered Performance Briefs rather than raw Character files. A Character must explicitly authorize a disclosure ID before that private source text can enter its brief, and a post-generation guard rejects verbatim unauthorized disclosure. `state_visibility` removes hidden world paths before actor and narrator assembly. One completed turn persists one narrator-authored message containing typed narration, action, and dialogue Scene Blocks even when several Cast members participate. The guard also rejects prose that assigns the player unrequested movement, interaction, speech, thoughts, feelings, memories or decisions; it retries once and otherwise renders only verified Observations. Player-facing APIs expose public presence and cues, not private beliefs or intent.

## Application services

### Library content lifecycle

`LibraryService` is a small, framework-level boundary. It advertises one content kind—Story—and accepts only `{ kind: "story", content }`, where `content` is explicitly supplied by the caller. A Story is materialized immediately as a canonical `harness-tavern-story/v2` source. Its Cast may be empty, may reference an existing internal Actor, or may contain a complete nested actor definition. Blank structural defaults are added only where required by the schema.

The service does not interpret briefs, invoke a creative prompt, apply extension templates, choose a genre, synthesize Cast members, or maintain a draft/publish state machine. The Story workspace, direct files, imports, and optional extensions all converge on the same explicit standard model. Actor rows and compatibility endpoints remain internal seams for source mapping and ecosystem migration; they are not a separately browsable Library entity. Legacy generated draft rows remain read-only for recovery and are not part of current domain behavior.

### Story sources

`harness-tavern-story/v2` is the authored Story boundary. A self-contained JSON file and a project manifest with relative Actor Character Cards, Lorebooks, Markdown scenes, Actions and Agendas resolve into the same normalized model. JSON Schema validation, semantic reference validation and path containment run before compilation. Stable file keys map Story-owned Actor resources to internal identifiers through dedicated source-binding tables. Local database IDs never enter canonical source files.

### Story Runtime

`StoryRuntime` composes portable behavior without executing imported JavaScript. It activates keyword, regex, constant, selective, ordered, and audience-scoped Lore, including bounded recursive scanning, group weighting, probability, sticky/cooldown/delay timing, insertion position, and Character filters; expands supported Story, Persona, Actor, message, and projected-state macros; and applies validated regex transforms at `user_input`, `model_input`, `model_output`, `lore`, or `display`. Actor scoping is retained when rules came from a SillyTavern Character Card. Declarative automations inject authored prompt instructions at control or narration boundaries. Typed Actions and Agendas remain the only mechanisms that can mutate authoritative causal state.

Imported extension scripts are inventoried but never executed. Plain manual Quick Replies without slash commands, scripts, automatic triggers, or conditional execution can become declarative composer actions; anything executable remains inventoried and inactive. Character Card regex rules are converted to the bounded declarative transform contract; invalid patterns, flags, stages, and disabled entries fail closed or remain inactive.

Startup reloads valid bound files into SQLite. Invalid manual edits leave the last valid projection available and are surfaced as source errors. Browser saves update bound resource files before rebuilding the projection. Playthrough events and provider settings never write back into Story sources.

### Long-context continuity and attachments

Conversation context uses a bounded recent window, a persisted rolling continuity summary, and deterministic multilingual local retrieval over older messages and Story source material. Retrieval vectors are rebuilt from source rather than trusted from imported indexes. Context manifests record every included and omitted whole block, while token estimates calibrate against recent provider usage when available. A long transcript therefore does not force every historical message into every request.

`AssetService` stores bounded per-Conversation attachments in a private local directory and records their immutable association with the user event that sent them. Plain text, Markdown, and JSON may contribute extracted text. Images are delivered inline only when the selected provider/model capability is known; otherwise the runtime exposes metadata only and explicitly forbids invented visual details. OpenAI-compatible, OpenRouter, Anthropic, and Gemini adapters translate inline images to their native formats. Audio attachment transport is retained for playback, but no provider is currently declared audio-capable. Browser speech dictation and read-aloud use browser APIs and do not become authoritative Story state.

### Sharing

The Sharing service owns pack creation, integrity checks, preview, conflict planning, identifier remapping, portable playthroughs and credential-free full backups. Packs are distribution snapshots. The Story source service owns editable authoring files and converts imported packs into canonical sources after import. The SillyTavern migration service is a separate preview/apply boundary for cards, backups and user-data directories; it never imports secrets or executes extension content.

### Public shares

Public shares persist a sanitized snapshot and token hash. They do not read the mutable Story at request time, which prevents later private edits from accidentally expanding an already shared page.

### Extensions

The Extension Registry accepts a strict declarative schema and inventories enabled data blueprints, composer actions, and presentation themes. It never imports executable code. Core Library creation does not automatically consume blueprint defaults; an extension that provides opinionated assistance must own that visible behavior and submit explicit standard content through the normal validation boundary.

## Provider abstraction

Provider-specific adapters implement the same completion/catalog seam. OpenRouter routing, Anthropic thinking, Gemini thinking configuration, Azure deployment URLs, DeepSeek's explicit thinking toggle, and generic OpenAI-compatible fallbacks are translated behind this boundary. Request configuration follows a deterministic overlay order: connection defaults, preset provider options, then Tavern's protected model/messages/reasoning/sampling/structured-output contract. Provider-specific options cannot replace protected fields or restore an application output cap. Protocols where the output-limit field is optional receive no Tavern-imposed output-token ceiling; Anthropic's required `max_tokens` field uses a protocol fallback, and its length/context-window stop reasons still suspend instead of exposing partial prose. Accepted narration is persisted whole without a character-count slice. Context history and token budgets are nullable; the default delegates capacity to the provider, while an explicit budget selects whole blocks and records every omission with `truncated_blocks: 0`.

Malformed or provider-truncated Control Plans suspend before any proposed player Action is resolved. Top-level Control Plan Actions are player-owned. Character plans are identity-bound to their server-selected Actor; owned Agenda Actions and bounded spontaneous Actions still pass through actor permission, parameter Schema, precondition, effect, and Observation resolution. A Character can choose `act` or `defer`, but cannot assert that persistent Intent completed, failed, paused, or resumed: authored `*_when` conditions derive lifecycle transitions from projected facts. Control, Character, and Storyteller outputs use structured JSON. Successful parallel Character plans are retained if another Character fails, so resume reruns only the missing mind. A Storyteller failure suspends after resolved facts and Character state without replaying them. Invalid speakers, contradictory facts, unauthorized private disclosure, and player-agency conflicts are discarded, retried once where safe, and replaced with exact visible Observations if necessary. Raw plans, conflicting drafts, and partial output never masquerade as a Character response.

Generation preset import is a preview-first compatibility boundary. Native Tavern presets round-trip directly. SillyTavern Chat/Text Completion samplers and reasoning effort are normalized into portable settings; enabled non-marker prompt blocks become lower-priority conversation instructions. Connection data, model selection, token caps, prompt markers, and unsupported fields remain visible in the preview but are not silently applied.

## Operational model

The current release is single-process and local-first:

- SQLite WAL;
- one in-process turn lock per Conversation;
- explicit access token required for non-loopback binding;
- encrypted credentials stored separately from the database key;
- immutable static browser assets;
- health and diagnostic commands.

Horizontal scale requires an external lock, shared event store, object storage for assets, and tenant-aware authorization. Those are not implied by the local beta architecture.
