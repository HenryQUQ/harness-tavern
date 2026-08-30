# Migration

Always copy the complete `HT_DATA_DIR` before an application upgrade. The SQLite database, `credentials.key`, Story source directory and uploaded assets are one recoverable unit.

## From Harness Tavern 0.12.x

Start the current release against the existing data directory. Database migration 8 adds:

- a versioned runtime definition on each Story;
- causal event metadata (`event_uid`, command, correlation, causation and stream version);
- durable Control Loop runs;
- deterministic state snapshots;
- preview/apply migration sessions.

Existing Characters, Stories, Playthroughs and Conversations remain readable. Existing Story v1 files remain valid. A database-only Story is materialized as an editable Story project if it has no source binding; current exports use Story v2.

## From SillyTavern

Open **Settings → Import from SillyTavern**. Choose either:

- an individual Character Card JSON/PNG/CHARX;
- a SillyTavern backup ZIP;
- the active user data directory (normally `data/<user-handle>`), using the browser folder picker.

The first step is read-only preview. It reports counts, file-level warnings and passive content before any library mutation. Apply then uses the selected conflict strategy exactly once. Character, Story, Persona, preset, chat-event and import-receipt database writes commit atomically; a later failure rolls all of them back. Canonical Story files are synchronized after that commit, with any filesystem failure retained as an explicit migration warning for repair.

| SillyTavern content | Harness Tavern destination |
|---|---|
| Character Cards V2/V3, PNG, CHARX | Characters and editable card resources |
| World Info | Narrator-only editable Stories with Lorebooks |
| Groups | Multi-character editable Stories and Cast settings |
| Chats / Group Chats | Conversations and append-only message events |
| Swipes and selected swipe | Message event metadata |
| Personas in `settings.json` | Personas |
| Compatible Chat/Text presets | Generation presets after normalization |
| Vector indexes | Not copied; rebuild from source content |
| Quick Replies, extensions, themes, Moving UI | Inventoried, never executed |
| `secrets.json` | Always excluded |

Original timestamps, chat metadata and unrecognized non-executable compatibility fields are retained where practical. Imported conversations begin without an artificial opening message. SillyTavern’s textual history is preserved, but it cannot retroactively establish authoritative causal facts; new turns use the causal runtime from their imported boundary onward.

The HTTP transport defaults to a 128 MB migration-body limit (`HT_MIGRATION_BODY_LIMIT`). Expanded archives also have bounded total and per-file limits. For larger libraries, migrate one user or archive at a time.

## Portable backup and restore

Use **Download full backup** to export Characters, Stories, Personas, Conversations with their causal event streams, the local profile and custom generation presets. Provider connections and credential ciphertext are deliberately absent. Import uses the same preview and Copy/Replace/Skip workflow as other Tavern packs.

Back up both SQLite and editable Story sources even when portable backups are enabled: the data-directory copy is the authoritative disaster-recovery artifact, while a portable pack is the interoperable content artifact.

## From the invalid 0.11.0 artifact

A previously produced standalone 0.11.0 source ZIP was empty and did not contain a runnable product. If that is the only artifact available, there is no application state inside it to migrate; install a current source package directly.
