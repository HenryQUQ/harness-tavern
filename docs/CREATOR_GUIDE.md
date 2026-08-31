# Content authoring guide

Harness Tavern provides one general playable content model: the **Story**. A Story can be narrator-only, single-cast, or an ensemble, and it owns everything needed to run it. The core can create a valid blank Story, import standard content, validate it, edit every authored field, and make it playable. It does not infer personality, genre, plot, prose, or private intent from a brief.

## Create a Story

1. Open **Library** and choose **New Story**.
2. Enter a title.
3. Optionally enter the first Cast member, or leave the Story narrator-only.
4. Open the resulting Story workspace.

This creates a canonical `harness-tavern-story/v2` source with empty authored fields. It does not choose a genre, tone, premise, opening, Scene, Action, Agenda, or world fact.

There is no separate Character Library. Add, remove, reorder, and edit actors inside **Story workspace → Cast**. A Story may have zero, one, or many Cast members without changing formats.

## Story workspace

- **Story** — title, hook, summary, premise, genre, tone, player role, opening, visibility, tags, cover, and content notes.
- **Cast** — actor identity, appearance, personality, speech style, scenario, first message, alternate greetings, Character Card system/depth prompts, example dialogue, role, public/private Story context, goals, secrets, boundaries, creator notes, tags, metadata, extension data, and an isolated Character mind profile.
- **World & lore** — world rules and audience-scoped Lore with primary/secondary keys, selective activation, constant entries, ordering, and enablement.
- **Scenes** — ordered Markdown Scenes and their active Cast.
- **Causality** — Initial State, World Schema, typed Actions, durable Agendas, State Visibility, and Prompt Graph.
- **Runtime** — declarative text transforms and prompt automations.
- **Advanced** — author notes, metadata, share policy, and the complete source editor.

Every save validates and writes the canonical source before rebuilding its runtime projection. A stale browser editor receives `story_source_conflict` instead of overwriting a newer source-file change.

### Character mind profiles

Open **Cast → Intent, privacy & compatibility runtime** for a Character. `initiative` controls whether the Character is reactive, balanced, or proactive; `initial_presence` starts it present, nearby, or off-scene. Drives, fears, values, and mannerisms guide its isolated decisions. `reveal_policy` tells that Character when it may authorize one of its private disclosure IDs. These are authored behavioral constraints, not public facts.

During play, the Director only selects relevant candidates. Each selected Character sees its own file and actor-visible evidence, evaluates its own Agendas, and may choose silence. The Storyteller receives a filtered Performance Brief and turns all selected performances into one scene, so adding Cast depth does not create a one-reply-per-Character queue.

## Runtime without imported code execution

A transform describes a regex replacement and where it runs:

```json
{
  "id": "formal-address",
  "name": "Formal address",
  "pattern": "\\\\byou\\\\b",
  "flags": "gi",
  "replacement": "traveller",
  "stages": ["model_output", "display"],
  "actor": "ferry-captain",
  "enabled": true
}
```

Available stages are `user_input`, `model_input`, `model_output`, and `display`. Actor scoping lets imported Character Card rules follow the actor that owned them. Invalid regex or flags do not run.

An automation is prompt text injected at a named runtime boundary:

```json
{
  "id": "weather",
  "key": "weather",
  "name": "Keep weather present",
  "trigger": "narration",
  "prompt": "Keep the harbour weather physically present in the prose.",
  "enabled": true
}
```

Automations and transforms are declarative. They cannot execute JavaScript, access files, call the network, or mutate causal state. Use typed Actions and Agendas for authoritative world changes.

Prompt fields and Lore support common macros such as `{{char}}`, `{{user}}`, `{{scenario}}`, `{{mesExamples}}`, `{{lastMessage}}`, `{{story}}`, `{{scene}}`, and `{{getvar::world.path}}`. Unknown macros remain visible rather than being silently destroyed.

## Import existing content

Choose **Import as Story** and preview the content before applying it:

- Character Card V2/V3, PNG, or CHARX → one single-cast Story;
- SillyTavern Group → one ensemble Story;
- World Info → one narrator-only Story;
- Chat or Group Chat → a Playthrough attached to the mapped Story;
- Tavern pack or Story source → complete Story-owned Cast and Runtime.

Character Card descriptions, personality, scenario, first message, alternate greetings, example dialogue, system prompt, depth prompt, talkativeness, embedded World Info, regex scripts, and extension data are retained when present. Quick Replies and executable extension scripts are inventoried but never run.

At Playthrough start, a single-cast Story can use its primary first message or a chosen alternate greeting. Opening macros are expanded against the selected Persona and Story.

## Edit as files

A small Story can remain one self-contained JSON document. A larger project can reference separate Actor Character Cards, Lorebooks, Markdown Scenes, Actions, and Agendas. Both forms resolve to the same authored model.

```bash
npm run story:export -- <story-key> <directory> --project
npm run story:validate -- <path-to-story.tavern.json>
```

See [Editable Story sources](STORY_SOURCES.md) for schemas, project layout, bindings, and Git workflow.

## Framework boundary

Core Library creation accepts only an explicit envelope:

```json
{
  "kind": "story",
  "content": {
    "title": "A title chosen by the author",
    "cast": [{
      "client_id": "captain",
      "role": "Ferry captain",
      "character": { "name": "Mara" }
    }]
  }
}
```

Only `title` is required; `cast` may be empty. Blank structural defaults may be added to make the file valid, but authored meaning is never synthesized. Requests containing a top-level brief, prompt, template selector, or other implicit-generation instruction are rejected by `/api/library/items`.

An optional extension may expose its own opinionated assistant or blueprint. That behavior must remain visibly owned by the extension and must write an explicit standard Story through the same validation boundary.

## Playtest, share, and export

Starting a Story Playthrough does not copy authored content into chat history as its source of truth. Authored source, runtime state, and conversation events remain separate.

Use:

- **Public preview** for a revocable player-safe snapshot;
- **Editable Story source** for review, versioning, and modification;
- **Tavern pack** for a portable playable distribution snapshot;
- **Portable playthrough** when causal event history should continue elsewhere.

Provider credentials and local database identifiers are excluded from portable content.

## Legacy generated drafts

Older installations may contain drafts created by the retired guided-creation workflow. Harness Tavern preserves those rows through read-only `/api/legacy/drafts` endpoints. Move material you still need into an explicit Story source. The old generation and publish routes return HTTP 410.
