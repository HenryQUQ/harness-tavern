# Contributing to Harness Tavern

> Pull up a chair. A better Tavern can begin with a question, not only a pull request.

Thank you for helping build a roleplaying tool that is easy to enter and difficult for its own AI to gaslight: worlds remember, Characters keep private knowledge, actions leave consequences, and players retain control of themselves.

This is the quick contribution entrypoint recognized by GitHub. The complete construction philosophy, runtime lifecycle, repository map, test strategy, and change-specific checklists live in the [Developer guide](docs/DEVELOPMENT.md).

## You can contribute before you code

Useful contributions include:

- a redacted playtest where memory, agency, pacing, or secrecy worked especially well—or clearly failed;
- a Story or Character-authoring example that exposes a missing affordance;
- a UX sketch that makes a deep runtime concept feel calmer and more conversational;
- a compatibility sample from a provider or roleplaying format;
- a documentation correction, failing test, focused bug fix, or complete feature patch.

Do not publish private transcripts, Character secrets, credentials, or databases to illustrate a problem. A minimal fictional reproduction is better evidence.

## Choose the right table

- Use [GitHub Discussions](https://github.com/HenryQUQ/harness-tavern/discussions) for questions, playtest observations, early product ideas, UX sketches, architecture trade-offs, and requests for collaborators.
- Use [GitHub Issues](https://github.com/HenryQUQ/harness-tavern/issues) for reproducible defects and scoped feature outcomes.
- Report suspected vulnerabilities privately through [SECURITY.md](SECURITY.md).
- Read [Architecture](docs/ARCHITECTURE.md) before changing State, Events, Actions, Observations, Agendas, privacy projections, or provider contracts.

Every change should preserve the core boundaries: State is authoritative, prose cannot create facts, the player retains autonomy, knowledge is actor-scoped, provider failures are resumable, and portable content never contains credentials.

## Start a useful discussion

You do not need a finished design. A strong opening post usually contains:

1. the moment or workflow you observed;
2. who is affected and what they were trying to do;
3. the property that should remain true;
4. a small example, sketch, or reproduction when possible;
5. known privacy, compatibility, or migration constraints.

The questions currently most worth challenging are listed in [Open design conversations](docs/DEVELOPMENT.md#open-design-conversations). Maintainer agreement in a Discussion is useful direction, but the implementation still needs the normal tests and review.

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
