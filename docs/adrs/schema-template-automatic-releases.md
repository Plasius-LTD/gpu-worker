# Schema-template automatic npm releases

Status: Accepted, 17 November 2026. Task: #43.

## Context and decision

The renewed npm connection requires a successful publication. The owner directed
automatic releases using schema's normal checks without additional manual
release-policy or historical dependency-coordination admission.

Adopt schema commit `7d57bec364c7d70d1ff12eadfc786154cb30abf6` CI, CD and release
preparation, including its common artifact policy and changelog helper. This
supersedes earlier workflow details requiring an explicit global npm install or
an additional final main check; the template retains its runtime floor, exact
main CI binding and pre-mutation main verification. Package-specific tests,
public APIs, shader assets and module contracts remain required.

## Release behavior

Same-repository PR validation runs on hosted runners; main push validation uses
trusted repository runners. Production publication uses hosted runners, OIDC,
and the immutable tarball validated without publication privileges. Repository
and tarball paths use the shared policy; the package inventory is explicit and
preserves existing public assets. Public legal documents are individually listed
instead of publishing the entire legal directory.

The release pipeline owns version bumps and changelog promotion through release
PRs. Never reuse a previously published or removed version. No local npm publish,
registry write token, alternate workflow, or manual approval gate is introduced.

## Verification

Regression tests exercise automatic phase handoff, trusted runner selection,
exact sealed inventory acceptance/rejection, and idempotent changelog promotion.
Run local privacy tests, lint, type checks, audit, build, coverage and pack checks;
then require PR/main CI and production CD success. Verify registry provenance
and npm publisher Valid status before completing this Task.
