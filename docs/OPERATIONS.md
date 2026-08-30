# Operations guide

## Intended topology

Harness Tavern is a local-first, single-owner service. The supported production-like topology is one application process with one writable data volume. Horizontal scaling, shared multi-user tenancy, and active-active SQLite access are outside the current contract.

## Container start

Generate an access token and keep it outside the repository:

```bash
export HT_ACCESS_TOKEN="$(openssl rand -hex 32)"
docker compose up --build -d
```

The Compose configuration binds to `127.0.0.1` by default, runs as the unprivileged Node user, mounts only `/data` as writable storage, enables `no-new-privileges`, and includes a health check.

To expose the service through a reverse proxy, set `HT_PUBLIC_URL` to the external HTTPS origin and `HT_TRUST_PROXY=true`. Keep the application port private and enforce TLS, request limits, and authentication at the proxy as well as the Tavern access token.

## Health and diagnosis

`GET /api/health` reports process health and SQLite integrity. It does not call external model providers.

```bash
curl --fail http://127.0.0.1:8787/api/health
npm run doctor
```

Investigate provider failures using redacted status, request identifiers, finish reasons, and usage metadata. Never log authorization headers, request prompts, decrypted credentials, or private character context.

## Persistent data

The data directory contains:

- `tavern.sqlite3`, including content, events, settings, and encrypted credential envelopes;
- `credentials.key`, required to decrypt provider credentials;
- `stories/`, containing canonical editable Story files and recoverable `.trash` entries;
- SQLite journal files while the process is active.

The database, key file and Story source workspace are all required for a complete backup. If `HT_STORY_SOURCE_DIR` points outside `HT_DATA_DIR`, back up that directory separately. Store them together in an encrypted backup system, but keep access controls separate from application operators where practical.

## Backup

For a simple offline backup:

1. stop the process cleanly;
2. copy the entire data directory to encrypted storage;
3. restart the process;
4. periodically restore the copy in an isolated environment and run `npm run doctor`.

For online backups, use SQLite's supported backup mechanism rather than copying only the main database while it is being written.

## Restore

1. stop the application;
2. preserve the failed data directory for investigation;
3. restore the database, matching `credentials.key`, and Story source workspace with owner-only permissions;
4. point `HT_DATA_DIR` at the restored directory;
5. run `npm run doctor` before accepting traffic.

## Upgrades and rollback

Read `CHANGELOG.md` and take a verified backup before upgrading. Rollback is safe only when the older application understands the upgraded schema. When that is not explicitly documented, restore the pre-upgrade backup instead of starting an older binary against the newer database.

## Monitoring

Monitor process restarts, health failures, filesystem capacity, backup age, suspended Control Loops, provider latency/error rates, and model finish reasons. Treat repeated `length` finishes as a provider/model capacity issue. The received command remains durable while malformed or incomplete model output is excluded from character prose; resume after correcting the connection does not replay committed effects.
