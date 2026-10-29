# ADR-0011: Approved Self-Hosted Trusted Branch CI

- Status: Accepted
- Date: 2026-10-29
- Work: Story1626 / Feature1597 / gpu-worker43
- Remote flag: `platform.public-artifact-integrity.enabled`

## Context

The recovery task requires explicit approved self-hosted CI, but the current
workflow and its tests require hosted runners. Moving the old pull-request
trigger onto self-hosted capacity would expose a broader execution boundary
than the Story's trusted-push policy permits.

## Decision

Both CI jobs use literal `[self-hosted, Linux, X64]` labels in
`Public CI - Quarantined`. An exact repository, branch-ref and event guard
allows only branch pushes and manual branch validation. There is no PR,
privileged PR, fork or tag execution, runner input or hosted fallback.
Checkout does not persist credentials, package-manager caches remain disabled,
and per-ref concurrency and job timeouts bound resource use.

Runner-group policy independently restricts admitted workflow revisions.
Reviewed branch validation may temporarily admit the immutable workflow SHA
and locked branch ref. Operators must verify all other group policies and
selected repository IDs immediately after admission, then remove only their
own workflow entries after CI. Normal main admission remains independently
governed; this change does not broaden runner-group access.

ADR-0010's hosted publication decision is retained. Only its CI scheduling
statement is superseded. Publication still requires successful exact-main
push CI, hosted `cd.yml`, the `production` environment and npm OIDC. Task52
requires a maintainer's current trusted-publisher readback and reconciled
never-used version before CD is enabled or dispatched. No version is allocated
by this decision.

The inherited remote flag controls staged distribution restoration. It cannot
disable mandatory source, package, CI or publication checks. There is no
user-visible entitlement and no new capability or package is required.

## Alternatives

Hosted CI violates the tracked acceptance criteria. Retaining same-repository
PR execution on self-hosted capacity exceeds the trusted-push boundary.
Dynamic runner selection and hosted fallback make that boundary ambiguous.

## Consequences and validation

Contract tests and guard truth tables cover trusted push/manual events and
rejected PR/fork/tag events. Frozen installation, unit tests, coverage above
80%, lint, types, build, metadata-only artifact and package checks, full audit,
dependency-tree validation, pack dry-run and actionlint verify the source.
No runtime API, shader, demo or browser behavior changes; browser E2E,
accessibility and SEO checks do not apply to this scheduling patch.

The baseline audit rejects brace-expansion5.0.9 for three denial-of-service
advisories. Updating only its compatible transitive override/resolution to
5.0.12 is required for verification; runtime dependency ranges stay stable.

Push CI must succeed for the reviewed source. Release remains incomplete until
normal review/merge, successful exact-main CI, approved CD, public artifact
provenance and installed-consumer qualification finish. Rollback disables the
workflow/channel and removes temporary admission; it never restores the
administrative path or a write-token fallback.
