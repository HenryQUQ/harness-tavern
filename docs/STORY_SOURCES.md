# Editable Story sources

`harness-tavern-story/v2` is the canonical authoring format for narrator-only, single-cast, and ensemble Stories. Cast size does not select a different schema, and the schema does not impose an arbitrary cast-count ceiling. A Story is the complete playable aggregate: Cast, Lore, prompt layers, transforms, automations, causal definitions, and opening routes travel together. Authors choose one file or a project directory according to the amount of material they want to manage; actual request capacity still depends on the selected model and provider.

SQLite is a validated runtime projection. It supplies fast queries, conversations and event state, but it is not the only copy of authored Story content. Conversation events, Playthrough state and provider configuration are never written into Story source files.

## Self-contained file

A compact Story can live in one file:

```text
quiet-crossing.story.tavern.json
```

The file embeds Story-owned Actor Character Cards, Lorebooks, scenes, typed Actions, persistent Agendas, safe transforms, prompt automations, world schema, initial state, and visibility rules. It contains stable keys such as `quiet-crossing` and `ferry-captain`, not local SQLite identifiers, export timestamps, or integrity digests.

## Project directory

A larger Story can keep the same model while moving resources into relative files:

```text
quiet-crossing/
├── story.tavern.json
├── characters/
│   └── ferry-captain.character.json
├── lore/
│   └── river.lorebook.json
├── actions/
│   ├── board-ferry.action.json
│   └── lower-rope.action.json
├── agendas/
│   └── captain-cross-river.agenda.json
└── scenes/
    ├── 001-landing.md
    └── 002-crossing.md
```

The manifest uses `source` paths relative to `story.tavern.json`. Absolute paths and paths that leave the project directory are rejected. The `characters/` resource name and Character Card V2-compatible JSON shape are retained for ecosystem portability; these files are Story-owned Actors, not a separate Library product. Lorebooks use the Harness Tavern v1 shape; common SillyTavern World Info entry collections are normalized when loaded. Markdown scene content is included in model context when its scene is active.

Character Cards inside a Story source are Story-owned authoring resources. Importing a new Story creates its own runtime character mapping even when another Story uses the same character key, so editing one project cannot capture or overwrite an unrelated Story. Compatibility edits to a mapped runtime Character are written back to every source that explicitly maps that Character. The active Markdown scene is passed to the model input without an additional Tavern hard truncation.

## Causal resources in v2

- `story.initial_state` contains authored facts, not prose that asks a model to remember facts.
- `world_schema` documents the intended state shape.
- `actions` define parameter JSON Schema, actor permission, preconditions, deterministic effects and actor-scoped Observations.
- `agendas` persist an owner, objective, priority, triggers, constraints, visibility, optional next Action, and fact-based lifecycle conditions.
- `state_visibility` maps world paths to audiences such as `user`, `public`, `director`, or a Character key.
- `prompt_graph` is portable prompt-assembly metadata; the protected causal and autonomy contracts remain runtime-owned.
- `transforms` are bounded regex replacements scoped to an Actor or Story and to `user_input`, `model_input`, `model_output`, or `display`.
- `automations` inject declarative authored instructions at control, isolated Character, or narration boundaries; they cannot execute code or mutate state.
- `cast[].metadata.actor_runtime` configures an Actor's `initiative`, `initial_presence`, `drives`, `fears`, `values`, `mannerisms`, and `reveal_policy` without creating a separate Character product.

Lore entries may define primary and secondary keywords, selective activation, `constant`, `enabled`, `order`, and audience visibility. Supported Story/Actor/Persona/message/state macros are expanded at context or opening time. Imported JavaScript, Quick Replies, and executable extension payloads are never evaluated.

The Director may propose player Actions, and an isolated Character runtime may propose Actions for its assigned Actor, but only registered definitions can resolve and write facts. Character belief and emotion updates are separately event-sourced inner state, never physical-world effects. Narration is generated after receipts and cannot create state.

An Agenda remains active by default. Its owning Character runtime can choose `act` or `defer`, and an Agenda Action is identity-bound to that owner. Only deterministic `complete_when`, `fail_when`, `pause_when`, and `resume_when` conditions may change lifecycle status. Conditions use authoritative projection paths and the same comparison vocabulary as Action preconditions:

A Character Card's goals become fallback Agendas when its Actor has no Story-authored Agenda. Once a Story defines an Agenda for an owner, that contextual Agenda replaces the same owner's generic card-goal loops for that Playthrough. This keeps durable intent without asking the control model to evaluate several competing copies of one actor's motivation on every turn.

```json
{
  "owner": "ferry-captain",
  "objective": "Carry the player safely across the river.",
  "complete_when": [
    { "path": "world.player.location", "operator": "eq", "value": "far-bank" }
  ],
  "fail_when": [
    { "path": "world.ferry.sunk", "operator": "eq", "value": true }
  ]
}
```

Supported operators are `exists`, `absent`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `includes`, `truthy`, and `falsy`. If no lifecycle condition is authored, model prose or JSON cannot silently end the durable Intent.

See the complete [multi-file example](../examples/stories/midnight-at-the-glass-observatory/story.tavern.json) and the schemas in [`schemas/`](../schemas).

## Source lifecycle

```text
editable files
→ JSON Schema and reference validation
→ Actor Character Card / Lorebook / Runtime normalization
→ stable-key resolution
→ transactional SQLite projection
→ Story runtime and AI context
```

Harness Tavern stores source bindings in SQLite, including the source key, path, format version and content digest. Browser saves use that digest for optimistic concurrency and return `story_source_conflict` instead of overwriting a file changed by another editor. On startup it reloads valid bound files. A malformed edit does not erase the last valid runtime projection; the reload error is reported by `npm run doctor` and can be corrected in the source file.

Existing database-only Stories are materialized non-destructively under:

```text
${HT_STORY_SOURCE_DIR:-${HT_DATA_DIR:-~/.harness-tavern}/stories}/<story-key>/story.tavern.json
```

Deleting an unused locally managed Story moves its source into `.trash` before removing the runtime projection. A source linked from outside the managed directory is retained.

## Commands

```bash
npm run story:validate -- path/to/story.tavern.json
npm run story:validate -- path/to/story-project
npm run story:import -- path/to/story-project
npm run story:export -- story-key ./story.story.tavern.json
npm run story:export -- story-key ./story-project --project
```

`story:import` links the selected source in place. Edit it with any text editor, then run the command again to validate and rebuild the runtime projection. The browser supports a self-contained JSON editor and complete folder import; saving a normalized project through the browser preserves existing relative resource files.

## Source versus Tavern pack

These formats have different responsibilities:

| Format | Responsibility |
|---|---|
| `harness-tavern-story/v2` | Editable, deterministic, Git-friendly authoring source |
| `harness-tavern-pack/v1` | Integrity-protected distribution snapshot and instance-to-instance import |
| SQLite | Local compiled projection, conversations, events and indexes |

Tavern packs remain supported. They may contain database identifiers, `exported_at` and an integrity digest, so they are not rewritten or presented as canonical source files.

## Compatibility and evolution

- `format_version` is required and validated.
- Unknown root and Story fields are rejected instead of silently ignored.
- Open-ended ecosystem metadata belongs in `extensions` or `metadata`.
- Character Card V2 remains the portable baseline; Character Card V3 JSON is accepted and can be exported.
- v1 Story sources remain readable. Loading and saving through the current compiler upgrades generated output to v2 without changing v1 files in place behind the author’s back.
- Future source versions use explicit migrations rather than changing v2 semantics in place.
