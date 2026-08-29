# Architecture

## Product boundary

Harness Tavern is a chat-first character and story product. Its default runtime intentionally excludes coding-agent capabilities such as Bash, file editing, PTY, LSP, repository tools, and coding personas.

DeepSeek Harness is treated as an optional compositional substrate. The Tavern domain remains a separate product layer so changes in the upstream developer-preview runtime do not leak into player or creator concepts.

## Layers

```text
HTTP and browser surfaces
├── Player application
├── Creator application
└── Public share page

Human-facing services
├── Home aggregation
├── Player Journal
├── Guided Creator
├── Sharing and import
└── Declarative Extension Registry

Tavern domain
├── Character
├── Persona
├── Story
├── Story Cast
├── Playthrough
├── Conversation Cast
├── Timeline / Branch
└── Creator Draft

Runtime
├── Context Builder
├── Automatic reasoning-depth resolver
├── Provider Registry
├── Response-envelope validator
├── State-operation policy
└── Transactional event commit

Persistence
├── SQLite
├── Append-only events
├── Deterministic projection
├── encrypted provider credentials
└── audit/import/share records
```

## Turn lifecycle

```text
claim conversation lock
→ read Story, Persona, active Cast and visible branch history
→ resolve effective reasoning depth
→ append turn.started and user.message
→ build roleplay context
→ call selected provider
→ parse and normalize structured envelope
→ validate speaker ids and state operations
→ append character messages, state events, usage and turn.completed in one transaction
→ update Playthrough/Conversation recency
→ release lock
```

The configured response depth can be `auto`; the resolved depth is recorded separately. Regardless of depth, the product uses one runtime pipeline rather than exposing multiple agent modes.

## Event sourcing

Messages and durable state changes are immutable events. `reduceEvents()` projects:

- visible messages;
- memories;
- world state;
- relationships;
- goals;
- commitments;
- current scene;
- continuity summary.

A Timeline is a branch with a parent and event boundary. Projection walks lineage and reads only parent events at or before the child boundary.

## Knowledge separation

The Story Cast stores public and private context separately. The runtime director may see both, but the prompt explicitly scopes private knowledge to one character. The player-facing Journal and public share service use separate sanitizers and never serialize the complete creator projection.

## Application services

### Guided Creator

The default generator is deterministic and local. It converts an ordinary-language brief and friendly template into an editable draft. Publishing maps temporary cast identifiers to durable Character identifiers inside a transaction.

### Sharing

The Sharing service owns pack creation, integrity checks, SillyTavern normalization, preview, conflict planning, identifier remapping, and transactional import.

### Public shares

Public shares persist a sanitized snapshot and token hash. They do not read the mutable Story at request time, which prevents later private edits from accidentally expanding an already shared page.

### Extensions

The Extension Registry accepts a strict declarative schema and merges enabled contributions into the creator and composer experience. It never imports executable code.

## Provider abstraction

Provider-specific adapters implement the same completion/catalog seam. OpenRouter routing, Anthropic thinking, Gemini thinking configuration, Azure deployment URLs, DeepSeek's explicit thinking toggle, and generic OpenAI-compatible fallbacks are translated behind this boundary. Request configuration follows a deterministic overlay order inspired by model-variant systems: connection defaults, then preset provider options, then Tavern's protected model/messages/reasoning/sampling/output contract. Provider-specific options are recursively filtered so they cannot restore a response cap or replace protected fields. Portable sampling controls are mapped only where the adapter can represent them; a generic compatible endpoint gets one reduced-parameter retry after rejecting optional fields. Optional provider protocols receive no Tavern-imposed output-token ceiling. A turn is committed only after a complete response passes validation: valid JSON envelopes retain state operations, complete plain text is safely wrapped as visible prose, and JSON-like malformed or truncated generations fail without leaving an orphan user message or masquerading as character prose.

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
