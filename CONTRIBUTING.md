# Contributing to Harness Tavern

Thank you for improving Harness Tavern. Changes should preserve the product's local-first safety boundary, player autonomy, private character knowledge, and portable content formats.

## Development setup

Use Node.js 22.19.0 or newer. The pinned baseline is in `.nvmrc`.

```bash
nvm use
npm ci
npm run verify
```

No external AI credential is required for the automated suite. Tests use isolated temporary databases and captured provider endpoints.

## Change workflow

1. Create a short-lived branch from `main`.
2. Keep each pull request focused on one product or engineering outcome.
3. Add tests for changed behavior and update user-facing documentation when contracts change.
4. Run `npm run verify` before opening the pull request.
5. Complete the pull request template and wait for the required `Quality gate` check.

Use clear, imperative commit subjects. Conventional Commit prefixes are encouraged, for example `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, and `ci:`.

## Engineering expectations

- Keep provider-specific details behind the provider adapter seam.
- Keep credentials out of logs, API responses, fixtures, and commits.
- Treat player-visible, creator-only, and runtime-private projections as different trust boundaries.
- Never commit partial model output after a truncation or validation failure.
- Keep imported extensions declarative; imported content must not become executable code.
- Preserve backwards compatibility for persisted events and portable pack formats, or document and test an explicit migration.
- Prefer built-in Node.js capabilities unless a dependency has a clear maintenance and security benefit.

## Test layers

- Domain tests cover normalization, event reduction, validation, and privacy rules.
- Provider tests capture outbound requests without contacting paid services.
- HTTP tests cover API and browser contracts.
- Journey tests exercise a fresh user's complete create, chat, share, import, and revoke path.
- Live provider tests are manual and must never run in pull-request workflows.

Coverage thresholds are enforced against `src/**/*.js`: 85% lines, 80% functions, and 65% branches. These are minimum gates, not targets for low-value tests.

## Security and privacy

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md). Remove any local runtime database, key file, `.env`, logs, screenshots, or exported content before attaching diagnostics.

By contributing, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and license your contribution under the repository's MIT License.
