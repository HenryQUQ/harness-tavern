# ADR 0001: Preserve a local-first single-owner boundary

- Status: Accepted
- Date: 2026-08-29

## Context

Harness Tavern persists private character knowledge, provider credentials, mutable story state, and player transcripts. A hosted multi-user service would require tenant isolation, lifecycle management, authorization policy, abuse controls, distributed locking, backups, and operational ownership that are not present in the local beta.

## Decision

The supported architecture is one owner, one application process, and one SQLite data directory. Loopback is the default. Non-loopback binding requires an application access token and production-like deployments must add TLS and edge controls.

Portable sharing crosses this boundary only through explicit, sanitized snapshots or reviewed import packs. The product must not imply multi-tenant isolation from a single shared process.

## Consequences

- Local installation remains simple and data ownership remains clear.
- SQLite transactions can provide the current atomic event model without distributed coordination.
- Horizontal scaling and arbitrary shared-user hosting are unsupported.
- A future hosted edition must introduce explicit tenant, identity, storage, queue, audit, moderation, and migration contracts rather than stretching this boundary invisibly.
