# Security Design

## Default exposure

The server binds to `127.0.0.1` by default. Binding to a non-loopback address without `HT_ACCESS_TOKEN` is rejected during configuration.

## Credentials

Provider and account credentials are encrypted with AES-256-GCM using a local key file separate from the SQLite database. API responses expose only redacted previews.

## Player autonomy

State-operation validation rejects world paths that attempt to set the user’s or Persona’s thoughts, feelings, or actions. Speaker identifiers are restricted to the active Cast.

## Private knowledge

Three separate projections are maintained conceptually and in code:

- runtime director context;
- player Journal;
- public share snapshot.

The public snapshot omits private cast context, Character secrets, Director-only lore, Author Notes, local identifiers, sessions, and provider data. Tests recursively scan public snapshots for known secret markers.

## Share tokens

Public share bearer tokens are generated from cryptographic random bytes. Only their SHA-256 hash is stored. A share can be revoked without deleting local content.

Portable URL-fragment shares do not reach the server automatically. The receiving browser decodes and previews them before an explicit import request.

## Imported content

Pack inputs are size-limited, normalized, integrity-checked when a digest is provided, and imported transactionally. Identifiers and slugs are remapped according to the selected conflict strategy.

## Extensions

End-user extensions are data, not code. The validator rejects executable field names and only permits known contribution types. Imported HTML and JavaScript are not mounted in the browser or server.

## Browser controls

Responses include CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Cross-Origin-Opener-Policy`. Private API responses use `Cache-Control: no-store`.

## Known boundary

0.12.0 has not undergone an independent penetration test and is not a multi-tenant security boundary. Operators exposing it beyond a trusted local environment should place it behind TLS, authentication, rate limiting, monitoring, and backups. Arbitrary remote users must not share one single-owner instance.
