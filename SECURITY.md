# Security policy

## Supported versions

Security fixes are applied to `main` and the latest published release. Older local databases should be upgraded by running the latest release against a verified backup.

| Version | Supported |
|---|---:|
| `main` | Yes |
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/HenryQUQ/harness-tavern/security/advisories/new). Do not include credentials, private roleplay content, production databases, or unredacted logs in a public issue.

Include:

- the affected version or commit;
- the smallest safe reproduction;
- expected and observed impact;
- whether credentials, private character data, public shares, or host access are involved;
- any proposed mitigation.

The maintainer will acknowledge a complete report as soon as practical, validate impact, coordinate a fix and disclosure, and credit the reporter if requested. Response times are best-effort because this is an independently maintained project.

## Deployment boundary

Harness Tavern is local-first and single-owner. It is not an audited multi-tenant authorization boundary. Non-loopback binding requires `HT_ACCESS_TOKEN`; internet-facing deployments should additionally use TLS, rate limiting, monitoring, isolated storage, and tested backups.

See [docs/SECURITY.md](docs/SECURITY.md) for the implemented security model and known boundaries.
