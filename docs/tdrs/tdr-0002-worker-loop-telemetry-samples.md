# Technical Design Record (TDR)

## Title

TDR-0002: Worker Loop Telemetry Samples

## Status

- Proposed -> Accepted
- Date: 2026-03-13
- Version: 1.0
- Supersedes: N/A
- Superseded by: N/A

## Scope

Defines the local telemetry sample contract emitted by `createWorkerLoop`.

## Context

Effect packages need direct, low-overhead instrumentation hooks that can feed
`@plasius/gpu-debug` while staying aligned with worker job manifests and
`@plasius/gpu-performance` frame correlation.

## Design

`createWorkerLoop` emits two optional local callbacks:

- `telemetry.onDispatch(sample)` with:
  - `kind`: `worker` or `job`
  - `index`: dispatch index within the tick
  - `label`
  - `owner`
  - `queueClass`
  - `jobType`
  - `frameId`
  - `workgroups`
  - `workgroupSize` when provided
- `telemetry.onTick(summary)` with:
  - `frameId`
  - `tickDurationMs`
  - `dispatchCount`
  - `workerDispatchCount`
  - `jobDispatchCount`
  - `dispatches`

The hooks are invoked only after command submission succeeds. Hook failures are
isolated and forwarded to `onError` when provided.

## Operational Considerations

- Reliability: optional hooks remain dormant unless enabled.
- Observability: stable `owner`, `queueClass`, `jobType`, and `frameId` make
  samples directly correlatable across packages.
- Performance: no worker-loop branching is added for consumers that do not
  provide telemetry callbacks.
- Security: hooks stay local; export remains outside this package.
