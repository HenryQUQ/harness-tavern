# Development guide

## Prerequisites

- Node.js 22.19.0 or newer
- npm 10.9.3 or a compatible npm 10 release
- Git
- Docker with Compose, only for container validation

The application has no third-party runtime packages. `npm ci` still validates the lockfile and makes CI behavior reproducible.

## First checkout

```bash
nvm use
npm ci
npm run verify
npm start
```

The default server listens on `http://127.0.0.1:8787`. Runtime data is stored outside the repository by default in `~/.harness-tavern`.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Start the application |
| `npm run dev` | Start with file watching and debug logging |
| `npm run check` | Validate syntax, JSON, repository hygiene, action pinning, and obvious credential material |
| `npm test` | Run the deterministic test suite |
| `npm run test:coverage` | Run source coverage with enforced thresholds |
| `npm run verify:journey` | Exercise the fresh-user HTTP journey |
| `npm run doctor` | Check the configured database and inventory |
| `npm run verify` | Run the local merge gate |
| `npm run release` | Build and cold-test release artifacts from the current commit |

## Environment

Harness Tavern reads environment variables directly; it does not load `.env` files itself. Use a shell, process manager, container environment, or another explicit secret injection mechanism. `.env.example` documents supported operational settings.

Never place provider keys in repository files. Provider credentials entered through the application are encrypted in the configured data directory.

## Architecture boundaries

- `domain/` owns normalized Tavern concepts and persistence-facing rules.
- `runtime/` owns context construction, model envelopes, operations, and atomic turn commits.
- `providers/` translates the portable request into provider-specific protocols.
- `sharing/` owns sanitized public projections and portable content boundaries.
- `server/` is the HTTP transport; it should not become the domain layer.
- `public/` is a dependency-free browser client using friendly product concepts.

See [ARCHITECTURE.md](ARCHITECTURE.md) before changing cross-cutting contracts.

## Database changes

Schema setup and compatible migrations live in `src/storage/database.js`. A database change must:

1. preserve existing local data;
2. be idempotent on repeated startup;
3. include a test from the previous shape;
4. keep credential key material separate from the SQLite file;
5. update operations and backup documentation when required.

## Provider changes

Provider tests must capture the outbound request locally. Do not call paid APIs from automated tests. Portable parameters should be mapped only when the target protocol supports them; provider-specific overlays must not replace protected model, message, reasoning, structured-output, tool, or token-limit fields.

## Release process

1. Update `CHANGELOG.md`, package version, `src/version.js`, and lockfile together.
2. Merge a green pull request to `main`.
3. Create and push an annotated `vX.Y.Z` tag.
4. The release workflow rebuilds tests, coverage, journey evidence, source archives, checksums, and the Git bundle, then creates a GitHub Release.

Release generation reads the current commit and never commits or rewrites tags itself.
