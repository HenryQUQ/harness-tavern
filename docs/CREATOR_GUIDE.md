# Content authoring guide

Harness Tavern provides a general content framework, not a built-in creative method. The core can create a valid blank Character or Story structure, import a standard file, validate it, edit every authored field, and make it playable. It does not infer personality, genre, plot, prose, or private intent from a brief.

## Add a Character

1. Open **Library** and choose **New**.
2. Choose **Blank Character**.
3. Enter a name. No other field is generated.
4. Use the complete Character editor to enter only the material you want.

The editor exposes identity, description, appearance, personality, voice, scenario, first message, goals, secrets, boundaries, creator notes, Character Card metadata, tags, and extension data. Saving validates the complete model. If a Character is bound to a canonical Story source, the bound source is updated as well; a newer external file edit is never silently overwritten.

You can instead choose **Import standard content** and preview a Character Card V2/V3, PNG, CHARX, Tavern pack, or supported SillyTavern data before it changes the Library.

## Add a Story

1. Add or import at least one Character.
2. Open **Library → New → Blank Story**.
3. Enter a title and explicitly select the initial Cast.
4. Open the resulting Story workspace.

This operation creates a canonical `harness-tavern-story/v2` source with empty authored fields. It does not choose a genre, tone, premise, opening, Scene, Action, Agenda, or world fact.

The Story workspace is organized by structure:

- **Overview** — identity, player-facing summary, player role, tone, visibility, tags, cover, and content notes.
- **Cast** — Character references, order, role, and public/private Story context.
- **World & lore** — opening, world rules, and audience-scoped Lore.
- **Scenes** — ordered Markdown Scenes and their active Cast.
- **Causality** — Initial State, World Schema, typed Actions, durable Agendas, State Visibility, and Prompt Graph.
- **Advanced** — author notes, metadata, share policy, and the complete source editor.

Every save validates and writes the canonical source before rebuilding its runtime projection. A stale browser editor receives a conflict instead of overwriting a newer source-file change. Narrator-only, single-character, and multi-character Stories all use the same v2 contract; the number of Cast members does not select a different Story type.

## Edit as files

A small Story can remain one self-contained JSON document. A larger Story project can reference separate Character Cards, Lorebooks, Markdown Scenes, Actions, and Agendas. Both forms resolve to the same authored model.

Use the complete source editor for direct JSON control, or export a project for an ordinary text editor:

```bash
npm run story:export -- <story-key> <directory> --project
```

Validate a file or project before importing it:

```bash
npm run story:validate -- <path-to-story.tavern.json>
```

See [Editable Story sources](STORY_SOURCES.md) for the schema, file layout, binding behavior, and Git workflow.

## Framework boundary

Core Library creation accepts only an explicit envelope:

```json
{
  "kind": "character",
  "content": {
    "name": "A name chosen by the author"
  }
}
```

or:

```json
{
  "kind": "story",
  "content": {
    "title": "A title chosen by the author",
    "cast": [
      { "character_id": "existing-character-id" }
    ]
  }
}
```

Blank structural defaults may be added to make the file valid, but authored meaning is never synthesized. Requests containing a top-level brief, prompt, template selector, or other implicit-generation instruction are rejected by `/api/library/items`.

An optional extension may expose its own opinionated assistant or blueprint. That behavior must remain visibly owned by the extension and must write an explicit standard Character or Story back through the same validation boundary. The core does not silently consume extension blueprints as generation instructions.

## Playtest, share, and export

Starting a Character chat or Story Playthrough does not copy content into chat history as its source of truth. Authored source, runtime state, and conversation events remain separate.

Use:

- **Public preview** for a revocable player-safe snapshot;
- **Editable Story source** for review, versioning, and modification;
- **Tavern pack** for a portable playable distribution snapshot;
- **Portable playthrough** when the causal event history should continue elsewhere.

Provider credentials and local database identifiers are excluded from portable content.

## Legacy generated drafts

Older installations may contain drafts created by the retired guided-creation workflow. Harness Tavern preserves those database rows and exposes them through the read-only `/api/legacy/drafts` endpoints; it does not delete or automatically publish them. Move any material you still need into an explicit Character or Story source. The old generation and publish routes return HTTP 410.
