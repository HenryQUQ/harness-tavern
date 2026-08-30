# Contributing to Harness Tavern

Thank you for helping build roleplay worlds that remain coherent, portable, and owned by their users.

This file is the quick contribution entrypoint recognized by GitHub. The complete explanation of the project's construction philosophy, runtime lifecycle, repository layout, testing strategy, and change-specific checklists is in the [Developer guide](docs/DEVELOPMENT.md).

## Before opening code

- Use [GitHub Discussions](https://github.com/HenryQUQ/harness-tavern/discussions) for open-ended product and architecture ideas.
- Use [GitHub Issues](https://github.com/HenryQUQ/harness-tavern/issues) for reproducible defects and scoped feature outcomes.
- Report suspected vulnerabilities privately through [SECURITY.md](SECURITY.md).
- Read [Architecture](docs/ARCHITECTURE.md) before changing State, Events, Actions, Observations, Agendas, privacy projections, or provider contracts.

Every change should preserve the core boundaries: State is authoritative, prose cannot create facts, the player retains autonomy, knowledge is actor-scoped, provider failures are resumable, and portable content never contains credentials.

## Set up the repository

Use Node.js 22.19.0 or newer. The baseline is pinned in `.nvmrc`.

```bash
git clone https://github.com/HenryQUQ/harness-tavern.git
cd harness-tavern
nvm use
npm ci
npm run verify
```

No external AI credential is required. Automated tests use isolated temporary databases and captured provider endpoints.

## Make a focused change

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/short-outcome
```

Keep a pull request focused on one user or engineering outcome. Add a regression test that fails without the change, and update the matching documentation whenever behavior, stored data, a portable format, or a public API changes.

Conventional Commit subjects are encouraged:

```text
feat: add a player-visible timeline label
fix: preserve action effects when narration resumes
docs: clarify Story source contribution workflow
```

## Validate before pushing

```bash
npm run verify
npm audit --omit=dev --audit-level=high
git diff --check
```

Additional evidence may be needed:

- run Story validation for schema or authoring changes;
- capture responsive screenshots for visible browser changes;
- prove preview, rollback, and round trip for import/export changes;
- capture outbound requests locally for provider changes;
- run paid-provider checks only when explicitly needed, with a temporary data copy and no credential output.

Coverage gates are 85% lines, 80% functions, and 65% branches across `src/**/*.js`. These are minimum safety gates, not substitutes for meaningful behavioral assertions.

## Open the pull request

Use the pull request template and include:

- the outcome and scoped implementation;
- exact validation commands and results;
- screenshots or API examples when relevant;
- security, privacy, migration, compatibility, and rollback impact;
- limitations that remain after the change.

Wait for the required **Quality gate** to finish successfully. A queued or in-progress check is not passing. Resolve review conversations before merge.

## Engineering expectations

- Keep deterministic effects in domain/runtime code, never only in prompts or browser validation.
- Keep provider-specific behavior behind the provider adapter seam.
- Treat player-visible, creator-only, actor-private, and runtime-private projections as separate trust boundaries.
- Never accept partial model output after a truncation or validation failure.
- Keep imported extensions declarative and reject executable fields.
- Preserve persisted Event and portable-pack compatibility, or provide an explicit tested migration.
- Prefer built-in Node.js capabilities unless a dependency has a clear maintenance and security benefit.
- Never commit API keys, access tokens, runtime databases, credential key files, private transcripts, or generated release artifacts.

By contributing, you agree to follow the [Code of conduct](CODE_OF_CONDUCT.md) and license your contribution under the repository's [MIT License](LICENSE).
