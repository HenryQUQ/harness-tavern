# Security Design

## Default exposure

The server binds to `127.0.0.1` by default. Binding to a non-loopback address without `HT_ACCESS_TOKEN` is rejected during configuration.

## Credentials

Provider and account credentials are encrypted with AES-256-GCM using a local key file separate from the SQLite database. API responses expose only redacted previews.

## Player autonomy and causal authority

Only registered Actions can change authoritative state. Definitions validate actor permission, parameter schema, safe paths and preconditions before deterministic effects are committed. Top-level planned Actions must belong to the player; autonomous Character Actions require an active Agenda owned by that Character. Agenda lifecycle changes require authored projection conditions rather than model assertion. Action paths that attempt to set the user’s or Persona’s thoughts, feelings, or actions are rejected. Participant identifiers are restricted to the active Cast and never create a mandatory reply queue. Contradictory narration drafts are never persisted as messages: they are retried once and fall back to visible verified Observations.

## Private knowledge

Separate projections are maintained in code for:

- runtime Director/control context;
- one player-visible Storyteller context with participant-scoped writer files;
- player Journal;
- player causal inspector/API;
- public share snapshot.

`state_visibility` filters hidden paths before narration. Player endpoints remove internal effect paths, Control Plans, private Agenda decisions and context block names. The public snapshot omits private cast context, Character secrets, Director-only lore, Author Notes, local identifiers, sessions, and provider data. Tests cover both state visibility and player/public serialization.

## Conversation attachments and browser voice

Attachments are allowlisted, base64-validated, size-limited to 4 MB each and 6 MB/4 files per turn, stored with owner-only filesystem permissions, and scoped to one Conversation. Sent files become immutable message history; deleting a Conversation removes its stored bytes. Text extraction is limited to plain text, Markdown, and JSON. Browser responses use `nosniff` and safe `Content-Disposition` headers.

An image is sent to a provider only when the selected provider/model is declared image-capable. A capability mismatch exposes filename/type metadata—or bounded extracted text for supported document types—but not bytes, and prompts prohibit fabricated contents. Browser voice dictation and speech synthesis are optional browser facilities; Harness Tavern does not persist microphone recordings or claim server-side speech recognition.

## Share tokens

Public share bearer tokens are generated from cryptographic random bytes. Only their SHA-256 hash is stored. A share can be revoked without deleting local content.

Portable URL-fragment shares do not reach the server automatically. The receiving browser decodes and previews them before an explicit import request.

## Imported content

Pack inputs are size-limited, normalized, integrity-checked when a digest is provided, and imported transactionally. Identifiers and slugs are remapped according to the selected conflict strategy.

Editable Story manifests are validated against JSON Schema before compilation. Resource paths must be relative and remain inside the selected project directory; absolute paths and `..` traversal are rejected. Story source files contain private cast context, Character secrets, Director Lore and Author Notes, so they require the same confidentiality as a playable remix pack and must never be served as a public preview.

SillyTavern migration is preview-first and size-bounded. `secrets.json` is excluded before conversion. Extension, Quick Reply, theme, layout and vector content is never executed; only recognized data is normalized. Portable backups omit provider connections and all credential material.

## Extensions

End-user extensions are data, not code. The validator rejects executable field names and only permits known contribution types. Imported HTML and JavaScript are not mounted in the browser or server.

## Browser controls

Responses include CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy`. Private API responses use `Cache-Control: no-store`.

## Known boundary

This release has not undergone an independent penetration test and is not a multi-tenant security boundary. Operators exposing it beyond a trusted local environment should place it behind TLS, authentication, rate limiting, monitoring, and backups. Arbitrary remote users must not share one single-owner instance.
