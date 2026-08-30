# ADR 0002: Keep core content authoring framework-first and explicit

- Status: Accepted
- Date: 2026-08-30

## Context

Harness Tavern needs enough flexibility to support very different Character and Story authoring practices. The earlier core workflow accepted a short brief, applied built-in assumptions about relationship, tone, genre, Cast composition, prose, and plot, stored a generated draft, and then published it. Although convenient for one workflow, that made a particular creative method part of the system boundary.

Fixed prompts and product-owned templates change artistic meaning, age quickly, complicate portability, and make extensions compete with hidden core policy. They are not required for the causal runtime, standard content model, editing, sharing, or SillyTavern migration.

## Decision

Core authoring owns universal structure and lifecycle only:

- discover supported standard content kinds;
- create a blank Character from an explicit name;
- create a blank Story from an explicit title and existing Character references;
- import, validate, edit, bind, version, export, share, and run those objects;
- keep authored content, Playthrough state, and Conversation events separate.

The core Library write contract accepts only `{ kind, content }`. It may fill empty schema-level structural fields, but it cannot infer authored meaning from a brief, prompt, template selector, or recommendation. There is no generated-draft or publish phase for new content.

Opinionated creative assistance may be implemented by an optional extension. It must be visibly extension-owned and must submit an explicit standard Character or Story through the same validation boundary. Merely installing declarative blueprint data does not alter core creation behavior.

Existing generated draft rows are preserved read-only for recovery. Retired generation and publish endpoints return HTTP 410 rather than silently changing semantics or deleting user data.

## Consequences

- The default product is neutral about genre, prose, relationships, and creative process.
- Blank creation is simpler and produces immediately editable portable content.
- Every authoring surface converges on the same Character and Story contracts.
- Optional assistants can evolve independently without becoming a compatibility requirement.
- Users who preferred one-click brief generation need an extension or external tool, and older drafts require manual migration.
- Tests must assert that creative fields remain empty and retired fixed-brief routes stay unavailable.

## Rejected alternatives

### Keep the generator but label it optional

Rejected because a built-in primary surface still makes its prompt assumptions de facto core policy and increases the contracts every implementation must preserve.

### Replace the fixed prompt with a more configurable core prompt

Rejected because configurability does not make creative generation universal. It also duplicates the existing model-preset and extension boundaries.

### Delete the draft tables and data immediately

Rejected because an architectural cleanup must not destroy content created by an earlier release. Compatibility remains read-only until a future explicit data migration can be designed.
