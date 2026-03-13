# Architecture Decision Record

## Title

ADR-0005: Optional Worker Loop Telemetry Hooks

## Status

- Accepted
- Date: 2026-03-13

## Context

`@plasius/gpu-worker` is now the preferred execution plane for multiple
`@plasius/gpu-*` packages. Those packages need a low-friction way to emit local
debug samples with stable worker metadata and frame correlation ids, but the
worker runtime should not take on a hard dependency on `@plasius/gpu-debug`.

## Decision

`createWorkerLoop` will expose opt-in local telemetry hooks:

- `frameId`: current frame correlation id for the loop tick,
- `telemetry.onDispatch(sample)`: one callback per submitted worker/job
  dispatch,
- `telemetry.onTick(summary)`: one callback per submitted loop tick.

Worker and job descriptors may also expose `owner`, `queueClass`, `jobType`,
`label`, and `workgroupSize` metadata so emitted samples are directly usable by
`@plasius/gpu-debug`.

## Consequences

- `@plasius/gpu-worker` stays decoupled from `@plasius/gpu-debug`.
- Adopting packages can reuse one stable metadata contract across worker,
  performance, and debug integrations.
- Telemetry failures are isolated through the existing `onError` path and do
  not block dispatch submission.
