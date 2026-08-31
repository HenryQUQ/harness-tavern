# ADR 0003: Make Story the only playable content aggregate

- Status: Accepted
- Date: 2026-08-30
- Supersedes: the separate Character content-kind decision in [ADR 0002](0002-framework-first-explicit-content.md)

## Context

A traditional SillyTavern experience is not only a Character Card. Its effective behavior may depend on a World Info book, scoped regex rules, prompt extensions, alternate greetings, example dialogue, group membership, and scripts. Treating Character and Story as independent top-level products made the simplest database entity more prominent than the complete experience users actually create and play.

Harness Tavern also supports narrator-only worlds, one-actor relationships, ensembles, causal Actions, persistent Agendas, actor-scoped knowledge, and safe runtime transforms. Separate direct Character chats forced special cases through navigation, sharing, Conversation creation, context assembly, migration, and persistence.

## Decision

Story is the only playable Library content kind and the aggregate boundary for authoring, import, discovery, play, sharing, and versioning.

A Story:

- may have zero, one, or many Cast members;
- owns its Actor Character Card resources and Story-specific Cast context;
- carries Lore, prompt layers, alternate greetings, example dialogue, transforms, automations, Scenes, Actions, Agendas, and visibility rules;
- starts through a Playthrough, never a public direct-chat route;
- is stored canonically as `harness-tavern-story/v2` and compiled to internal SQLite Actor and Cast records.

Actor records and Character compatibility endpoints remain internal seams for stable source mapping, causal ownership, old integrations, and Character Card import/export. They are not advertised by Library content types or listed independently in Home, Chats, onboarding, favorites, creation, or sharing.

Imported Character Cards become single-cast Stories. Groups become ensemble Stories. World Info becomes narrator-only Stories. Existing storyless Conversations and orphan Character records are wrapped by an idempotent database migration.

Runtime portability is declarative. Character Card regex scripts become bounded, actor-scoped transforms; Lore activation and supported macros are interpreted by the Story Runtime; prompt automations inject text at named boundaries. Imported JavaScript and Quick Replies are never executed. Typed Actions and Agendas remain the only Story-authored mechanisms that can change authoritative causal state.

## Consequences

- Users manage one complete object rather than reconstructing a playable experience from several top-level items.
- Narrator-only, traditional Character Card, and ensemble use cases share one lifecycle and one Playthrough path.
- The Story workspace must support complete inline Cast editing and cannot require at least one actor.
- Packs retain internal Character dependency arrays for v1 compatibility even though their public kind is Story.
- Source files retain Character Card-compatible Actor resources for ecosystem portability.
- Old integrations may continue using compatibility routes, but new clients must use Story and Playthrough APIs.
- Tests must protect Story-only bootstrap/navigation, import normalization, migration idempotence, Runtime behavior, and absence of public direct-chat creation.

## Rejected alternatives

### Keep Character and Story as equal top-level products

Rejected because a Character Card plus World Info and runtime rules is already a composite experience, while direct chat creates a second lifecycle for the same runtime.

### Embed actors only as anonymous Story JSON

Rejected because stable Actor identities are still needed for Cast ownership, private observations, causal Agendas, source bindings, migration, and ecosystem round-tripping.

### Execute imported SillyTavern scripts for full compatibility

Rejected because imported content must not gain code execution, filesystem, or network authority. Safe declarative mappings preserve useful behavior without crossing that trust boundary.
