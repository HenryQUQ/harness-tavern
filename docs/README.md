# Harness Tavern documentation

This directory is the maintained knowledge base for Harness Tavern. The repository root [README](../README.md) introduces the product for ordinary users; the pages here explain how to use, create for, operate, extend, and contribute to it.

## Choose a path

| You are… | Begin with… | Continue with… |
|---|---|---|
| A new player | [Getting started](GETTING_STARTED.md) | [Migration](MIGRATION.md) |
| A Character or Story author | [Content authoring guide](CREATOR_GUIDE.md) | [Editable Story sources](STORY_SOURCES.md) |
| A contributor | [Developer guide](DEVELOPMENT.md) | [Architecture](ARCHITECTURE.md) and [API](API.md) |
| An operator | [Operations](OPERATIONS.md) | [Security](SECURITY.md) |
| An integrator | [API](API.md) | [Sharing and extensions](SHARING_AND_EXTENSIONS.md) |

## User and author guides

- [Getting started](GETTING_STARTED.md) — installation, first use, AI connections, migration, backups, and common problems.
- [Content authoring guide](CREATOR_GUIDE.md) — add blank/imported standard content, edit every field, play-test, and share without a core creative generator.
- [Migration](MIGRATION.md) — upgrade an existing Harness Tavern instance or preview and migrate SillyTavern content.
- [Editable Story sources](STORY_SOURCES.md) — maintain narrator-only, single-character, and ensemble Stories as one JSON file or a multi-file project.
- [Sharing and extensions](SHARING_AND_EXTENSIONS.md) — public previews, Tavern packs, portable playthroughs, backups, and declarative extensions.

## Developer guides

- [Developer guide](DEVELOPMENT.md) — project philosophy, repository map, local setup, architectural invariants, tests, change workflows, and contribution requirements.
- [Architecture](ARCHITECTURE.md) — runtime layers, turn lifecycle, event projection, knowledge separation, provider abstraction, and deployment boundary.
- [Experience architecture](EXPERIENCE_ARCHITECTURE.md) — product language, surfaces, progressive disclosure, and player-facing invariants.
- [HTTP API](API.md) — endpoints, authentication, errors, import/export boundaries, and runtime contracts.
- [Security model](SECURITY.md) — implemented controls, trust boundaries, credential handling, and known limits.
- [Operations](OPERATIONS.md) — container topology, health checks, backup, restore, upgrades, and monitoring.
- [Architecture Decision Records](adr/README.md) — durable decisions and their trade-offs.

## Repository-level policies

GitHub recognizes several community files only at the repository root, so they deliberately remain there while the long-form technical documentation lives in this directory:

- [Contributing](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)
- [Support](../SUPPORT.md)
- [Code of conduct](../CODE_OF_CONDUCT.md)
- [Governance](../GOVERNANCE.md)
- [Changelog](../CHANGELOG.md)

## Documentation rules

Documentation changes are product changes. A pull request that changes behavior, a public contract, stored data, migration behavior, or a user workflow must update the matching page in the same pull request.

When writing documentation:

1. start with the reader's outcome, not an internal class name;
2. distinguish current behavior from future direction;
3. keep player-visible, author-private, and runtime-private concepts separate;
4. include commands that can be copied from the repository root;
5. never include real credentials, private transcripts, local databases, or unredacted provider payloads;
6. use relative links for repository content so forks and offline source archives remain navigable;
7. run `npm run check` to validate local documentation links.

If a design change creates a long-lived constraint or trade-off, add an ADR using the process in [adr/README.md](adr/README.md) instead of hiding the decision inside a pull request discussion.
