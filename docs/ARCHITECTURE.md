# Architecture

## Product boundary

Harness Tavern is a causal character and story product. Chat is one projection of an event stream; it is not the state store and does not decide whether an attempted action succeeded. Its default runtime intentionally excludes coding-agent capabilities such as Bash, file editing, PTY, LSP, repository tools, and coding personas.

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
├── Character
├── Persona
├── Story
├── Story Cast
├── Playthrough
├── Conversation Cast
└── Timeline / Branch

Runtime
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
→ read Story, Persona, active Cast and the selected branch projection
→ build the Director context and request a Control Plan
→ normalize player Actions, discard unauthorised character Actions, and evaluate every active Agenda
→ deterministically validate actor permission, JSON Schema parameters and authored preconditions
→ append Action receipt, authoritative effects and actor-scoped Observations
→ derive Agenda completion/failure/pause/resume only from authored fact conditions
→ build a separate narration context for each selected speaker from only visible facts
→ render messages, reject state contradictions, retry once, and fall back to verified Observations when needed
→ append completion, usage and a deterministic state snapshot
→ release lock at quiescence
```

The configured response depth can be `auto`; the resolved depth is recorded separately. Regardless of depth, the product uses one causal pipeline rather than exposing multiple agent modes. Story-authored Agendas replace generic Character Card goal loops for the same owner; card goals remain fallback durable intent when no contextual Agenda exists. Provider failure does not erase a received command: the loop is marked `suspended`, preserves completed effects, and resumes from its durable phase. Idempotency keys prevent duplicate command execution.

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
- current scene;
- continuity summary.

A Timeline is a branch with a parent and event boundary. Projection walks lineage and reads only parent events at or before the child boundary.

## Knowledge separation

The Story Cast stores public and private context separately. The control planner may inspect Director information but cannot write state or player-visible prose. Each narrator receives only its own private context, visible world paths, public lore, and Observations addressed to that actor. `state_visibility` rules remove hidden world paths before narration. The player-facing Journal, causal inspector and public share service use separate sanitizers and never serialize the complete creator projection or private Agenda decisions.

## Application services

### Library content lifecycle

`LibraryService` is a small, framework-level boundary. It advertises content kinds and accepts only `{ kind, content }`, where `content` is explicitly supplied by the caller. A Character is persisted through the complete Character model. A Story is materialized immediately as a canonical `harness-tavern-story/v2` source with explicit Cast references and blank structural defaults where required by the schema.

The service does not interpret briefs, invoke a creative prompt, apply extension templates, choose a genre, synthesize Cast members, or maintain a draft/publish state machine. Complete editors, direct files, imports, and optional extensions all converge on the same explicit standard models. Legacy generated draft rows remain read-only for recovery and are not part of current domain behavior.

### Story sources

`harness-tavern-story/v2` is the authored Story boundary. A self-contained JSON file and a project manifest with relative Character, Lorebook, Markdown scene, Action and Agenda resources resolve into the same normalized model. JSON Schema validation, semantic reference validation and path containment run before compilation. Stable file keys map to local Story and Character identifiers through dedicated source-binding tables.

Startup reloads valid bound files into SQLite. Invalid manual edits leave the last valid projection available and are surfaced as source errors. Browser saves update bound resource files before rebuilding the projection. Playthrough events and provider settings never write back into Story sources.

### Sharing

The Sharing service owns pack creation, integrity checks, preview, conflict planning, identifier remapping, portable playthroughs and credential-free full backups. Packs are distribution snapshots. The Story source service owns editable authoring files and converts imported packs into canonical sources after import. The SillyTavern migration service is a separate preview/apply boundary for cards, backups and user-data directories; it never imports secrets or executes extension content.

### Public shares

Public shares persist a sanitized snapshot and token hash. They do not read the mutable Story at request time, which prevents later private edits from accidentally expanding an already shared page.

### Extensions

The Extension Registry accepts a strict declarative schema and inventories enabled data blueprints, composer actions, and presentation themes. It never imports executable code. Core Library creation does not automatically consume blueprint defaults; an extension that provides opinionated assistance must own that visible behavior and submit explicit standard content through the normal validation boundary.

## Provider abstraction

Provider-specific adapters implement the same completion/catalog seam. OpenRouter routing, Anthropic thinking, Gemini thinking configuration, Azure deployment URLs, DeepSeek's explicit thinking toggle, and generic OpenAI-compatible fallbacks are translated behind this boundary. Request configuration follows a deterministic overlay order: connection defaults, preset provider options, then Tavern's protected model/messages/reasoning/sampling/structured-output contract. Provider-specific options cannot replace protected fields or restore an application output cap. Protocols where the output-limit field is optional receive no Tavern-imposed output-token ceiling; Anthropic's required `max_tokens` field uses a protocol fallback, and its length/context-window stop reasons still suspend instead of exposing partial prose. Accepted narration is persisted whole without a character-count slice. Context history and token budgets are nullable; the default delegates capacity to the provider, while an explicit budget selects whole blocks and records every omission with `truncated_blocks: 0`.

Malformed or provider-truncated Control Plans suspend before any proposed Action is resolved. Top-level Control Plan Actions are player-owned; a Character can act only through an active Agenda it owns. A model can propose `act` or `defer`, but cannot assert that persistent Intent has completed, failed, paused or resumed: authored `*_when` conditions derive those transitions from projected facts. Control planning uses structured JSON; narration is a complete-text rendering pass because prose is not a state protocol. A narration failure suspends after already-resolved facts and resumes narration without replaying those effects. If otherwise complete prose contradicts a committed open/closed transition, the draft is recorded as discarded usage, retried once, and then replaced with exact visible Observations if necessary. Raw Control JSON, conflicting drafts and partial prose never masquerade as a character response.

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
