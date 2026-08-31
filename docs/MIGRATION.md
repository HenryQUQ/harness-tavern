# Migration

Always copy the complete `HT_DATA_DIR` before an application upgrade. The SQLite database, `credentials.key`, Story source directory, and uploaded assets are one recoverable unit.

## Upgrade to 0.16.0

No database migration is required. Existing Stories receive conservative Character Runtime defaults at read time: balanced initiative, present initial presence, and no authored drives, fears, values, mannerisms, or reveal policy.

New turns now add event-sourced Character inner state and structured Scene Blocks. Older message events remain readable as plain narration. Existing `metadata` objects are preserved; creators can opt into richer behavior by adding `cast[].metadata.actor_runtime` in the Story editor or source file.

The control model now selects relevant participants but cannot speak or decide agendas for them. Each selected Character receives an isolated model call with only its own private context, and the Storyteller receives filtered performance briefs after Character decisions. This can increase provider calls per turn for ensemble scenes; reactive Characters and relevance selection keep ordinary turns bounded.

## Upgrade to 0.15.0

Database migrations 10–12 are automatic and idempotent:

- migration 10 removes the retired built-in model connection and transfers affected Conversations to the earliest enabled real provider when one exists;
- migration 11 creates the deterministic local retrieval index used for Story source and long-history recall; source content is rebuilt at startup rather than trusting imported vector artifacts;
- migration 12 adds Conversation-scoped attachment metadata. Attachment bytes live under `HT_DATA_DIR/assets` and are part of the same backup unit as SQLite.

Existing multi-Character turns remain readable. Persisted legacy `speakers`/`speaker_plan` fields are accepted as participant hints, but every new turn renders one coherent Storyteller message rather than one response per Character.

## Upgrade to 0.14.0

Database migration 9 moves older content into the Story-only product model without deleting compatibility records:

- every Conversation without a Story receives a recovered Story built from its Conversation Cast;
- every Story Conversation without a Playthrough receives one;
- every Character Card not referenced by a Story becomes a single-cast Story;
- embedded World Info and compatible Character Card regex scripts become Story Lore and declarative Runtime transforms;
- repeated startup is idempotent and does not create duplicate Stories or Playthroughs.

Existing Story sources remain valid. Actor rows and Character compatibility endpoints remain internally available for source bindings and old integrations, but Home, Library, Chats, creation, and sharing expose Stories rather than a separate Character product.

Migration 8 from 0.13.0 remains responsible for versioned Story Runtime definitions, causal event metadata, durable Control Loop runs, deterministic snapshots, and preview/apply migration sessions. A database-only Story is materialized as an editable Story v2 source when its creator workspace opens.

## From SillyTavern

Open **Settings → Import from SillyTavern**. Choose:

- an individual Character Card JSON/PNG/CHARX;
- a SillyTavern backup ZIP;
- the active user data directory (normally `data/<user-handle>`) with the browser folder picker.

Preview is read-only. It reports counts, file-level warnings, conflicts, and passive content before any Library mutation. Apply uses the selected Copy/Replace/Skip strategy once. Story, Actor dependency, Persona, preset, Playthrough event, and import-receipt database writes commit atomically; a later failure rolls them all back. Canonical Story files synchronize after the database commit, and any filesystem failure remains visible as a repair warning.

| SillyTavern content | Harness Tavern destination |
|---|---|
| Character Card V2/V3, PNG, CHARX | Single-cast Story with a Story-owned Actor resource |
| Embedded Character Book | Actor-scoped Lore inside that Story |
| Character regex scripts | Safe actor-scoped Story Runtime transforms |
| World Info | Narrator-only Story with Lorebook entries |
| Group | Ensemble Story with ordered Cast and member settings |
| Chat / Group Chat | Conversation events inside a mapped Story Playthrough |
| Swipes and selected swipe | Message event metadata |
| Persona in `settings.json` | Persona |
| Compatible Chat/Text preset | Generation preset after normalization |
| Vector index | Not copied; rebuild from source content |
| Plain manual Quick Replies | Declarative composer actions when they contain no slash command, script, auto trigger, or condition |
| Scripted/automatic Quick Replies, executable extensions, themes, Moving UI | Inventoried, never executed |
| `secrets.json` | Always excluded |

The importer preserves descriptions, personality, scenario, first message, alternate greetings, example dialogue, system prompt, depth prompt, talkativeness, compatible embedded Lore, regex rules, timestamps, and unrecognized non-executable extension fields where practical. Imported chats begin without an artificial opening message. Text history cannot retroactively establish authoritative causal facts; new turns use the causal runtime from the imported boundary onward.

The HTTP transport defaults to a 128 MB migration-body limit (`HT_MIGRATION_BODY_LIMIT`). Expanded archives also have bounded total and per-file limits. For larger libraries, migrate one user or archive at a time.

## Portable backup and restore

Use **Download full backup** to export Stories with their Cast dependencies, Personas, Playthrough Conversations and causal event streams, the local profile, and custom generation presets. Provider connections and credential ciphertext are absent. Import uses the same preview and Copy/Replace/Skip flow as other Tavern packs.

Back up both SQLite and editable Story sources even when portable backups are enabled: the data-directory copy is the authoritative disaster-recovery artifact, while a portable pack is the interoperable content artifact.

## From the invalid 0.11.0 artifact

A previously produced standalone 0.11.0 source ZIP was empty and did not contain a runnable product. If that is the only artifact available, there is no application state inside it to migrate; install a current source package directly.
