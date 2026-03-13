# ADR-0004: Multi-Package Worker Coordination

## Status

- Proposed -> Accepted
- Date: 2026-03-13
- Version: 1.0
- Supersedes: N/A
- Superseded by: N/A

## Context

`@plasius/gpu-worker` already supports per-type scheduling and worklists, but
the surrounding `@plasius/gpu-*` package ecosystem is expanding. New systems
such as post-processing, cloth, fluids, lighting refresh, and voxel generation
need a common way to express discrete GPU work without fragmenting scheduling
policy across packages.

## Decision

We will treat `@plasius/gpu-worker` as the preferred execution plane for
discrete GPU jobs across current and future `@plasius/gpu-*` packages.

- Packages should expose stable worker job identifiers and bounded worker job
  budgets.
- Per-package GPU work should flow through worker queues and worklists rather
  than bespoke compute schedulers where practical.
- Performance adaptation remains the responsibility of
  `@plasius/gpu-performance`, which will adjust worker job budgets instead of
  taking ownership of queue internals.
- Optional local instrumentation should be routed through
  `@plasius/gpu-debug` when clients enable it.

## Consequences

- Positive: cross-package compute work can be balanced through a shared runtime
  model.
- Positive: new effect packages can plug into existing queue/worklist mechanics.
- Negative: package authors must define explicit worker job manifests and
  budgets.
- Neutral: packages that are not yet worker-based can migrate incrementally.

## Alternatives Considered

- Keep each package responsible for its own scheduling: rejected because it
  undermines cross-package balancing.
- Move budget logic into `@plasius/gpu-worker`: rejected because the worker
  runtime should stay focused on execution, not policy.
- Introduce one queue per package: rejected because a shared queue/worklist
  model is more composable and easier to balance.
