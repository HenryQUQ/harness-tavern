# Migration

## From 0.10.x

Start 0.12.0 against the existing data directory. SQLite migrations add:

- Character/Persona/Story slugs and presentation metadata;
- Story hooks, player roles, scenes, tags, content notes, visibility, and share policy;
- Playthroughs;
- Conversation Cast state;
- Creator drafts and favorites;
- declarative extensions;
- import receipts;
- portable and public share records.

Existing Conversations remain readable. Legacy runtime mode values are mapped to response depth and are no longer exposed in the interface.

Before upgrading, copy the entire `HT_DATA_DIR`, including the credential key file.

## From the invalid 0.11.0 artifact

A previously produced standalone 0.11.0 source ZIP was empty and did not contain a runnable product. 0.12.0 is rebuilt from the verified 0.10.0 codebase and includes release gates that reject empty archives and cold-test extracted artifacts.

If you only downloaded that empty archive, there is no application state inside it to migrate. Use the 0.12.0 source package directly.

## Content migration

Characters and Stories can be migrated between instances through Tavern packs. The import preview identifies conflicts before any mutation. Use **Copy** when the destination should preserve both variants.
