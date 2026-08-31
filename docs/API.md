# HTTP API

All endpoints return JSON unless otherwise noted. When `HT_ACCESS_TOKEN` is configured, private `/api/*` routes require `Authorization: Bearer …` or `X-Harness-Tavern-Token`. Public share routes are intentionally separate.

## Bootstrap and profile

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness, version, database integrity |
| GET | `/api/bootstrap` | Player/creator bootstrap data |
| GET | `/api/home` | Continue items and Stories |
| GET | `/api/usage` | Aggregate provider token/cost activity and local retrieval-index health |
| GET | `/api/user-profile` | Local owner profile and onboarding state |
| PATCH | `/api/user-profile` | Name, locale, default Persona, onboarding |

Each item in `GET /api/bootstrap` → `conversations` includes a player-safe `group` summary used by the Chats rail:

```json
{
  "kind": "story",
  "id": "story-id",
  "title": "Visible Story title",
  "subtitle": "Story playthrough",
  "cast": [{ "id": "character-id", "name": "Visible name", "avatar_url": "" }]
}
```

`kind` is always `story`. Summaries use the Story identity and may include `cover_url`; no private Cast context, private Lore, or creator-only state is included. Bootstrap and Home do not expose a top-level Character collection.

## Library content framework

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/library/content-types` | Discover core content kinds, minimum required fields, editable model, and portable formats |
| POST | `/api/library/items` | Add an explicit Story, including optional nested Cast, to the Library |

The write contract is deliberately narrow:

```json
{
  "kind": "story",
  "content": {
    "title": "The Last Night Train",
    "cast": [{
      "client_id": "iona",
      "role": "Conductor",
      "character": {
        "name": "Iona Reed",
        "first_message": "The last train is waiting."
      }
    }]
  }
}
```

`kind` and `content` are the only accepted top-level keys. `kind` must be `story`; `content.title` is the only required authored field. `content.cast` may be empty, reference an internal Actor with `character_id`, or define a new actor in `character`. `client_id` lets unsaved Cast entries be referenced by Scenes or Runtime fields in the same request. The service may add empty structural defaults required by the source schema, but it does not expand briefs, prompts, template selectors, or creative instructions.

## Internal Actor compatibility and Personas

Actor routes remain available for source mapping, old integrations, and SillyTavern compatibility. They are not advertised by Library content types or used as a top-level browser lifecycle. New clients should create and edit Cast through Story routes.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/characters/:id` | Character detail and related chats/stories |
| POST | `/api/characters` | Low-level explicit Character create compatibility route |
| PATCH | `/api/characters/:id` | Update Character |
| DELETE | `/api/characters/:id` | Delete unused Character |
| POST | `/api/personas` | Create Persona |
| PATCH | `/api/personas/:id` | Update Persona |
| POST | `/api/favorites` | Favorite/unfavorite a Story or Conversation using `entity_type`, `entity_id`, and `favorite` |

## Stories and Playthroughs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/stories/:id` | Story detail and Playthrough list |
| POST | `/api/stories` | Low-level explicit Story create compatibility route |
| PATCH | `/api/stories/:id` | Update Story and Cast |
| DELETE | `/api/stories/:id` | Delete Story |
| GET | `/api/story-sources/:id` | Resolved canonical editable source and binding metadata |
| PUT | `/api/story-sources/:id` | Validate `source`, check optional `expected_digest`, write bound files, and rebuild the runtime projection |
| POST | `/api/playthroughs` | Select Persona/player role and begin Story |

The Playthrough request accepts an optional `route.opening_greeting_index` (or per-actor `greeting_indices`) to select a Character Card alternate greeting. Openings expand supported Story, Persona, Actor, and projected-state macros before they become events.

`runtime` in the private Story model may contain `transforms` and `automations` alongside Actions, Agendas, Prompt Graph, World Schema, and State Visibility. Transforms are declarative regex replacements with an `actor`, `stages`, `pattern`, `flags`, `replacement`, and `enabled` flag. Valid stages are `user_input`, `model_input`, `model_output`, and `display`. Automations inject authored prompt text at `control`, isolated `character`, or `narration`; neither construct executes JavaScript.

## Conversations and Timelines

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/conversations` | Retired public direct-chat route; returns 410 `story_playthrough_required` |
| GET | `/api/conversations/:id` | Conversation, Cast, Journal, projection, branches |
| PATCH | `/api/conversations/:id` | Title, Persona, AI engine, response settings |
| DELETE | `/api/conversations/:id` | Permanently delete Conversation, timelines, events, usage, and an orphaned Playthrough |
| POST | `/api/conversations/:id/turn` | Complete one turn |
| POST | `/api/conversations/:id/turn/stream` | SSE stream for one complete Storyteller beat |
| POST | `/api/conversations/:id/cancel` | Cancel current provider request |
| GET | `/api/conversations/:id/control-loops` | Sanitized durable loop history |
| GET | `/api/control-loops/:id` | Sanitized loop status and context counts |
| POST | `/api/control-loops/:id/resume` | Resume a suspended loop from its persisted phase |
| PATCH | `/api/conversations/:id/cast/:characterId` | Quiet/spotlight Cast member |
| POST | `/api/conversations/:id/branches` | Create What-if Timeline |
| POST | `/api/conversations/:id/branches/:branchId/switch` | Switch Timeline |

Both turn routes accept `{ "content": "...", "attachment_ids": ["asset-id"], "idempotency_key": "..." }`. `content` may be empty only when at least one attachment is present. One accepted turn produces exactly one narrator-authored message. The Director selects relevant `participants`; each selected Character then plans independently, may act, speak, react, observe, or remain silent, and cannot see another Character's private file. The message includes `scene_blocks` with `narration`, `action`, and authorized `dialogue` blocks. `GET /api/conversations/:id` exposes sanitized `character_runtime` presence and public cues but omits beliefs, private intent, and disclosure contents.

### Conversation attachments

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/conversations/:id/assets` | Upload one allowlisted base64 attachment before sending a turn |
| GET | `/api/assets/:id` | Read safe attachment metadata and immutable-association status |
| GET | `/api/assets/:id/content` | Stream attachment bytes with private no-store headers |
| DELETE | `/api/assets/:id` | Delete an unsent attachment; sent history is immutable |

The upload body is `{ "filename": "clue.md", "mime_type": "text/markdown", "data_base64": "..." }`. Files are limited to 4 MB each; a turn accepts at most four files and 6 MB combined. Images, plain text, Markdown, JSON, PDF, and common browser audio types are allowlisted. Only plain text, Markdown, and JSON are text-extracted. Provider delivery is capability-gated; metadata-only images are never represented to the model as visible pixels.

## Complete content editors

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/creator/characters/:id` | Internal compatibility editor model, source bindings, and optimistic edit token |
| PUT | `/api/creator/characters/:id` | Internal compatibility save; update bound Story sources when present |
| GET | `/api/creator/stories/:id` | Complete private Story authoring model and canonical source digest |
| PUT | `/api/creator/stories/:id` | Validate and save Story overview, Cast, Lore, Scenes, causal runtime, metadata, and source files |
| POST | `/api/creator/stories/:id/runtime-debug` | Explain transformed input, Lore decisions, ranked Actions, context blocks, participants, and retrieval without calling a model |

The Story editor uses `{ "story": { ... }, "expected_digest": "..." }`. It can update existing actors through nested `cast[].character` data and add new ones with `client_id`. `cast[].metadata.actor_runtime` accepts `initiative`, `initial_presence`, `drives`, `fears`, `values`, `mannerisms`, and `reveal_policy`. A stale digest returns `story_source_conflict`, preventing an open browser editor from overwriting newer changes made in another tab or directly in a bound source file. The Actor compatibility editor retains `{ "character": { ... }, "expected_token": "..." }` for old integrations. Public routes omit creator notes, secrets, private Cast context, private Character state, initial State, and other author-only fields.

### Retired guided-creation compatibility

The core no longer owns plain-language creative generation or Story-to-template authoring. These retired paths return HTTP 410 with `guided_creation_removed` or `core_template_authoring_removed`:

```text
/api/creator/character-drafts
/api/creator/story-drafts
/api/creator/drafts
/api/creator/drafts/:id
/api/creator/drafts/:id/publish
/api/extensions/from-story/:storyId
```

Existing draft rows are preserved rather than deleted. They are available read-only through `GET /api/legacy/drafts` and `GET /api/legacy/drafts/:id` for manual migration into explicit standard content.

## Portable import and sharing

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/exports/characters/:id` | Compatibility export normalized as a single-cast Story pack |
| GET | `/api/exports/characters/:id?format=sillytavern-v2` | Download Character Card V2 JSON |
| GET | `/api/exports/characters/:id?format=sillytavern-v3` | Download Character Card V3 JSON |
| GET | `/api/exports/stories/:id` | Download playable Story Tavern pack |
| GET | `/api/exports/stories/:id?format=source` | Download self-contained editable Story source |
| GET | `/api/exports/conversations/:id` | Download a portable playthrough with its causal event stream |
| GET | `/api/exports/backup` | Download a credential-free library, playthrough, profile and preset backup |
| POST | `/api/import/preview` | Validate and preview Story source/project, pack, or Character Card |
| POST | `/api/import/apply` | Transactional Copy/Replace/Skip import |
| POST | `/api/share-links` | Legacy share-link compatibility alias |
| POST | `/api/shares` | Create revocable public snapshot |
| GET | `/api/shares` | List owner’s public shares |
| DELETE | `/api/shares/:tokenHash` | Revoke public share |
| GET | `/api/public/shares/:token` | Public safe snapshot |
| GET | `/api/public/shares/:token/download` | Public pack download when allowed |

The standalone public page is `/share/:token`.

Story project folder upload uses a JSON transport envelope only at the HTTP boundary:

```json
{
  "format": "harness-tavern-story-project-files",
  "manifest_path": "my-story/story.tavern.json",
  "files": {
    "my-story/story.tavern.json": "{ ... }",
    "my-story/scenes/001-opening.md": "# Opening"
  }
}
```

The envelope is not an authoring format. The files inside it are validated and persisted as an ordinary multi-file Story project.

## SillyTavern migration

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/migrations/sillytavern/preview` | Scan a card, ZIP/CHARX backup, or browser-selected data directory without mutating the library |
| GET | `/api/migrations/sillytavern/:id` | Retrieve counts, warnings, mapping and status |
| POST | `/api/migrations/sillytavern/:id/apply` | Apply a preview once with `copy`, `replace`, or `skip` |

Preview accepts `files` as an array of `{ path, text }` / `{ path, base64 }`, a path-to-text object, or a single `data_base64` upload with `filename`. The dedicated request limit defaults to 128 MB and is configurable with `HT_MIGRATION_BODY_LIMIT`. `secrets.json` is excluded. Extensions, Quick Replies, themes and layout files are inventoried but never executed; vector indexes are marked for rebuilding.

## Extensions

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/extensions` | Installed extensions and merged contributions |
| POST | `/api/extensions` | Install declarative extension pack |
| PATCH | `/api/extensions/:id` | Enable/disable extension |
| DELETE | `/api/extensions/:id` | Remove imported extension |
| GET | `/api/extensions/:id/export` | Download extension JSON |

## AI connections

Existing provider and account endpoints remain available under:

```text
/api/provider-connections
/api/provider-connections/:id/models
/api/provider-connections/:id/test
/api/provider-connections/:id/openrouter/providers
/api/account-connections/:connector/begin
/api/account-connections/:connector/complete
/api/account-connections/openrouter/callback
```

They are an advanced Settings surface rather than part of the primary player journey.

Each Conversation persists `connection_id`, `account_connection_id`, and `model_id`. Its `generation` object accepts `temperature` (0–2), `top_p` (0.01–1), `frequency_penalty` and `presence_penalty` (-2–2), `top_k` (0–500), `min_p` (0–1), `repetition_penalty` (0.01–2), nullable `seed`, up to 16 `stop_sequences`, bounded `provider_options`, plus `response_length`, `initiative`, and `pacing`. `provider_options` is a provider-specific JSON body overlay; it cannot override model/messages, reasoning, sampling controls, structured-output fields, tools, or output-token limits. `response_length` guides prose style; the runtime does not translate it into `max_tokens` or another application-imposed output ceiling.

Its `prompt` object accepts `custom_instructions` (up to 20,000 characters), nullable `history_messages` (0–10,000), and nullable `context_budget_tokens` (512–10,000,000). `null` is the default for both limits: Tavern sends all assembled whole blocks and delegates the actual context window to the provider. An explicit budget may omit complete blocks but never cuts text inside a block; the context manifest records included/omitted counts and keeps `truncated_blocks` at zero.

Provider finish reasons that indicate a length or context-window limit fail with `model_output_truncated`. Complete narration has no Tavern character-count slice. Invalid structured Control Plans fail with `invalid_model_output`. The received command and user message remain durable, the loop becomes `suspended`, and the user can resume it after fixing the model or connection. Effects already resolved before a narration failure are not replayed. Idempotency keys reject a different command reusing the same key and return the original completed result for an exact retry.

Player endpoints expose only sanitized receipts and actor-visible Observations. Effect paths, private Agenda decisions, Control Plans and context block identifiers are available only through the creator inspection boundary.

## Generation presets

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/generation-presets` | List built-in and custom response presets |
| POST | `/api/generation-presets` | Save a reusable prompt/generation setup |
| POST | `/api/generation-presets/import/preview` | Preview a native or SillyTavern preset mapping without writing it |
| POST | `/api/generation-presets/import` | Import and persist a previewed native or SillyTavern preset |
| PATCH | `/api/generation-presets/:id` | Update a custom preset |
| DELETE | `/api/generation-presets/:id` | Remove a custom preset |

Built-in presets are immutable. Applying a preset is explicit: clients copy its `settings` into a Conversation with `PATCH /api/conversations/:id`. SillyTavern import accepts Chat Completion and Text Completion JSON aliases for common samplers, reasoning effort, stop strings, enabled prompt blocks, and JSON `custom_include_body`. It previews ignored connection/model fields, incompatible context-token settings, and intentionally discarded output-token caps before creation.
