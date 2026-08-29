# HTTP API

All endpoints return JSON unless otherwise noted. When `HT_ACCESS_TOKEN` is configured, private `/api/*` routes require `Authorization: Bearer …` or `X-Harness-Tavern-Token`. Public share routes are intentionally separate.

## Bootstrap and profile

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness, version, database integrity |
| GET | `/api/bootstrap` | Player/creator bootstrap data |
| GET | `/api/home` | Continue, characters, stories, drafts |
| GET | `/api/user-profile` | Local owner profile and onboarding state |
| PATCH | `/api/user-profile` | Name, locale, default Persona, onboarding |

## Characters and Personas

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/characters/:id` | Character detail and related chats/stories |
| POST | `/api/characters` | Create Character |
| PATCH | `/api/characters/:id` | Update Character |
| DELETE | `/api/characters/:id` | Delete unused Character |
| POST | `/api/personas` | Create Persona |
| PATCH | `/api/personas/:id` | Update Persona |
| POST | `/api/favorites/:type/:id` | Favorite/unfavorite Character or Story |

## Stories and Playthroughs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/stories/:id` | Story detail and Playthrough list |
| POST | `/api/stories` | Create Story |
| PATCH | `/api/stories/:id` | Update Story and Cast |
| DELETE | `/api/stories/:id` | Delete Story |
| POST | `/api/playthroughs` | Select Persona/player role and begin Story |
| GET | `/api/playthroughs/:id` | Playthrough detail |

## Conversations and Timelines

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/conversations` | Start Character chat or general chat |
| GET | `/api/conversations/:id` | Conversation, Cast, Journal, projection, branches |
| PATCH | `/api/conversations/:id` | Title, Persona, AI engine, response settings |
| DELETE | `/api/conversations/:id` | Permanently delete Conversation, timelines, events, usage, and an orphaned Playthrough |
| POST | `/api/conversations/:id/turn` | Complete one turn |
| POST | `/api/conversations/:id/turn/stream` | SSE character response stream |
| POST | `/api/conversations/:id/cancel` | Cancel current provider request |
| PATCH | `/api/conversations/:id/cast/:characterId` | Quiet/spotlight Cast member |
| POST | `/api/conversations/:id/branches` | Create What-if Timeline |
| POST | `/api/conversations/:id/branches/:branchId/switch` | Switch Timeline |

## Guided creator

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/creator/character-drafts` | Plain-language Character draft |
| POST | `/api/creator/story-drafts` | Plain-language Story and Cast draft |
| PATCH | `/api/creator/drafts/:id` | Edit/save Draft |
| DELETE | `/api/creator/drafts/:id` | Delete Draft |
| POST | `/api/creator/drafts/:id/publish-character` | Publish Character |
| POST | `/api/creator/drafts/:id/publish-story` | Publish Story, optionally start Playthrough |
| POST | `/api/stories/:id/save-as-template` | Create declarative template extension |

## Portable import and sharing

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/exports/characters/:id` | Download Character Tavern pack |
| GET | `/api/exports/stories/:id` | Download playable Story Tavern pack |
| POST | `/api/imports/preview` | Validate and preview pack/Character Card |
| POST | `/api/imports/apply` | Transactional Copy/Replace/Skip import |
| POST | `/api/share-links` | Create compressed portable link |
| POST | `/api/share-links/decode` | Decode link for preview |
| POST | `/api/shares` | Create revocable public snapshot |
| GET | `/api/shares` | List owner’s public shares |
| DELETE | `/api/shares/:id` | Revoke public share |
| GET | `/api/public/shares/:token` | Public safe snapshot |
| GET | `/api/public/shares/:token/download` | Public pack download when allowed |

The standalone public page is `/share.html?token=…`.

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
/api/provider-connections/:id/openrouter/providers
/api/account-connections/:connector/begin
/api/account-connections/:connector/complete
/api/account-connections/openrouter/callback
```

They are an advanced Settings surface rather than part of the primary player journey.

Each Conversation persists `connection_id`, `account_connection_id`, and `model_id`. Its `generation` object accepts `temperature` (0–2), `top_p` (0.01–1), `frequency_penalty` and `presence_penalty` (-2–2), `top_k` (0–500), `min_p` (0–1), `repetition_penalty` (0.01–2), nullable `seed`, up to 16 `stop_sequences`, bounded `provider_options`, plus `response_length`, `initiative`, and `pacing`. `provider_options` is a provider-specific JSON body overlay; it cannot override model/messages, reasoning, sampling controls, structured-output fields, tools, or output-token limits. `response_length` guides prose style; the turn runtime does not translate it into `max_tokens` or another application-imposed output ceiling. Its `prompt` object accepts `custom_instructions` (up to 20,000 characters) and `history_messages` (0–200). Conversation-specific instructions refine the model input without replacing the fixed autonomy, privacy, causal-state, or JSON-envelope contracts.

Provider finish reasons that indicate a length limit fail with `model_output_truncated`. Invalid structured envelopes fail with `invalid_model_output`. In both cases, the user message is not committed and is safe to retry; any usage returned by the provider is still recorded for accounting.

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
