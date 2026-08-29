# Governance

Harness Tavern currently uses a maintainer-led model. The repository owner is the final decision maker for product direction, security response, releases, and compatibility policy.

## Decision principles

Changes are evaluated against:

1. player autonomy and privacy;
2. continuity and deterministic state behavior;
3. a nontechnical Tavern-first experience;
4. provider portability and local ownership;
5. operational simplicity and maintainability.

Material architectural decisions should be recorded in `docs/adr/`. Breaking changes require an explicit migration path, tests, and release notes.

Routine changes use pull requests and the automated quality gate. Security fixes may be prepared privately and released before full public discussion.
