# Sharing and Extensions

Harness Tavern treats portability as part of the product rather than an export afterthought.

## Editable Story source

The authoring boundary is `harness-tavern-story/v2`, not a distribution pack. It contains one stable `story_key`, Character resources keyed independently from SQLite, Cast references, Lorebooks, scenes, Actions, Agendas and state rules. It can be one JSON file or a project manifest with relative files. See [STORY_SOURCES.md](STORY_SOURCES.md).

## Tavern pack

The integrity-protected distribution format is JSON:

```json
{
  "format": "harness-tavern-pack",
  "format_version": 1,
  "exported_at": "...",
  "producer": {
    "name": "Harness Tavern",
    "version": "..."
  },
  "kind": "character | story | collection | playthrough | backup",
  "title": "...",
  "items": {
    "characters": [],
    "stories": [],
    "personas": []
  },
  "integrity": {
    "algorithm": "sha256",
    "digest": "..."
  }
}
```

A Story pack includes the Character dependencies referenced by its cast. Import remaps identifiers, Cast references, scene presence lists and causal Agenda owners, preventing collisions with local content.

The SHA-256 digest detects accidental or deliberate modification but is not a cryptographic signature and does not establish an author’s identity. Use an editable Story source for authoring and Git workflows; generate or download a pack for distribution compatibility.

A `playthrough` pack carries the Story, Cast, selected Persona and append-only causal event stream, allowing another instance to continue from the same facts. A full `backup` adds the library, Conversations, profile and custom generation presets. Both formats explicitly exclude API credentials and provider connections.

## Public preview versus playable source

These are separate data products.

### Public preview

Safe for a browser share page. Includes only:

- title, hook, summary, genre, tone, tags, content notes;
- public character descriptions and roles;
- public lore;
- creator attribution and remix policy.

Excludes:

- private cast context;
- character secrets;
- Director-only lore;
- author notes;
- local database identifiers;
- Personas, conversations, memories, provider settings, and credentials.

### Editable/playable source

Contains private runtime material necessary to preserve character behaviour and story logic, expressed as `harness-tavern-story/v2`. The receiving user sees an import preview before making it part of their editable Library and source workspace.

## Public share lifecycle

A creator can create a revocable share record:

```text
create share → receive token URL → public preview/download → revoke
```

Only a hash of the bearer token is stored. Revocation removes public access without deleting the creator’s local Story or Character.

## Portable link

Small packs can be compressed into a URL fragment. Fragments are not sent to the web server by browsers. The app decodes the payload locally, previews it, and sends the explicit import request only after user confirmation.

The receiving workflow is:

```text
open link → inspect title/author/counts/warnings/conflicts → choose Copy/Replace/Skip → import
```

## Import conflict strategy

- **Copy** creates new local identifiers and unique slugs.
- **Replace** updates local content with the same stable slug.
- **Skip** reuses the matching local entity and imports only missing dependencies.

Every import is transactional and records an import receipt.

## SillyTavern compatibility

Character Card V2/V3 JSON, PNG cards with `chara`/`ccv3` metadata and CHARX archives are normalized into Tavern Characters. Known fields, alternate greetings, tags, creator notes, embedded lore and extension data are preserved where possible. Character Card V2 and V3 JSON can be exported. Unknown executable behaviour is never run.

For a complete move, the migration workspace accepts a SillyTavern backup ZIP or browser-selected `data/<user-handle>` directory. It previews Characters, Worlds, Groups, Chats/Group Chats, Personas and compatible generation presets before a one-time apply. Message timestamps, selected swipe and alternatives are preserved as event metadata. `secrets.json` is never copied; Quick Replies, extensions and themes are inventoried but not executed; embeddings are rebuilt from source content.

## Declarative extension format

```json
{
  "format": "harness-tavern-extension",
  "version": 1,
  "manifest": {
    "id": "my-template-pack",
    "name": "My Template Pack",
    "version": "1.0.0",
    "author": "Creator",
    "capabilities": ["story_templates", "quick_actions"]
  },
  "contributions": {
    "story_templates": [],
    "character_templates": [],
    "quick_actions": [],
    "themes": []
  }
}
```

### Supported contributions

- **Character templates** — friendly defaults for relationship, voice, and energy.
- **Story templates** — friendly defaults for genre, tone, cast size, and player role.
- **Quick actions** — optional composer prompts such as “look around” or “let them continue”.
- **Themes** — restricted visual design tokens.

### Rejected content

The validator rejects executable or ambiguous fields, including:

```text
script · javascript · code · module · entrypoint · eval · function · html
```

This is intentional. Community extensions should be understandable, reviewable, reversible, and safe to disable.

## Extensibility boundary

The declarative extension registry is the stable end-user seam. Provider adapters and DeepSeek Harness/Cordis integrations are developer seams. A future code plugin system should run outside the default trust boundary and require explicit administrator installation; imported Tavern content must never silently become executable code.
