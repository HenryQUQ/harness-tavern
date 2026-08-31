# Harness Tavern documentation

> Simple conversation on the surface. Durable memory, private knowledge, and causal consequences underneath.

This directory is the maintained knowledge base for Harness Tavern. The repository root [README](../README.md) tells the short story; the pages here help players enter, authors create, contributors reason about the runtime, and operators understand its trust boundary.

You do not need to read the documentation in order. Choose the outcome closest to yours and follow links only when the work crosses a contract.

## The idea beneath the interface

| Promise | Where it becomes concrete |
|---|---|
| Stories remember | [Architecture](ARCHITECTURE.md) explains Events, State, projection, retrieval, resume, and branch boundaries. |
| Characters keep secrets | [Security](SECURITY.md) explains actor-scoped context, player/creator/public projections, credentials, and known limits. |
| Choices have consequences | [Developer guide](DEVELOPMENT.md) traces a turn from Command through Action resolution to one Storyteller beat. |
| The Tavern stays approachable | [Experience architecture](EXPERIENCE_ARCHITECTURE.md) defines product language, progressive disclosure, and player agency. |
| Stories remain yours | [Editable Story sources](STORY_SOURCES.md) and [Sharing](SHARING_AND_EXTENSIONS.md) define portable authoring and distribution boundaries. |

## Choose a path

| You are… | Begin with… | Continue with… |
|---|---|---|
| A new player | [Getting started](GETTING_STARTED.md) | [Migration](MIGRATION.md) |
| A Story author | [Content authoring guide](CREATOR_GUIDE.md) | [Editable Story sources](STORY_SOURCES.md) |
| A contributor | [Developer guide](DEVELOPMENT.md) | [Architecture](ARCHITECTURE.md) and [API](API.md) |
| An operator | [Operations](OPERATIONS.md) | [Security](SECURITY.md) |
| An integrator | [API](API.md) | [Sharing and extensions](SHARING_AND_EXTENSIONS.md) |

## User and author guides

- [Getting started](GETTING_STARTED.md) — installation, first use, AI connections, migration, backups, and common problems.
- [Content authoring guide](CREATOR_GUIDE.md) — create or import a complete Story, edit its owned Cast and Runtime, play-test, and share without a core creative generator.
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

## Join the conversation

The documentation describes current behavior; it does not pretend every design question is settled.

- Bring questions, redacted playtest observations, UX sketches, competing designs, and early ideas to [GitHub Discussions](https://github.com/HenryQUQ/harness-tavern/discussions).
- Use [GitHub Issues](https://github.com/HenryQUQ/harness-tavern/issues) when a defect is reproducible or a feature already has a clear acceptance boundary.
- Read [Contributing](../CONTRIBUTING.md) for the shortest path into the repository, or [Open design conversations](DEVELOPMENT.md#open-design-conversations) for questions where the project actively welcomes more perspectives.

A useful contribution can be a clarified sentence, a safer example, a failing scene, a focused test, or a patch. Never post credentials, databases, private transcripts, or Character secrets as evidence.

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
