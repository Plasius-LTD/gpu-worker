# Multi-Package Worker Coordination

## Goal

Use `@plasius/gpu-worker` as the shared execution plane for current and future
`@plasius/gpu-*` packages that perform discrete GPU compute work.

## Why

As the stack grows beyond particles and physics into post-processing, cloth,
fluids, lighting refresh, voxel generation, and similar systems, bespoke
per-package scheduling policies become difficult to balance. A worker-job-first
pattern provides one place for queueing and one compatible actuation surface for
performance governance.

## Package Responsibilities

- `@plasius/gpu-worker`: queueing, worklist construction, job dispatch
  execution, and stable worker job identifiers.
- `@plasius/gpu-performance`: device-aware frame targets, pressure detection,
  and budget adjustment for worker jobs.
- `@plasius/gpu-debug`: optional local instrumentation for tracked allocations,
  dispatch samples, queue depths, and inferred utilization hints.
- effect packages: define worker job manifests and translate budget levels into
  real shader dispatch behavior.

## Contract Expectations

Each effect package should provide:

- stable job labels,
- a queue class for debug grouping and budget coordination,
- DAG metadata when relevant: `priority`, `dependencies`, and
  `schedulerMode: "dag"` for jobs that must run in ordered chains or join
  points,
- a bounded budget ladder for dispatch frequency and batch size,
- optional debug instrumentation hooks that are dormant unless enabled by the
  client.

## Queue Modes

`@plasius/gpu-worker` can now assemble against two queue contracts:

- `flat`: legacy FIFO-style ready work.
- `dag`: multi-root ready queues that publish newly unlocked downstream jobs as
  dependencies complete.

The worker core still only needs a dequeue entry point plus a
`complete_job(job_index)` hook after dispatch. That keeps the worker runtime
compatible with both queue shapes without taking responsibility for DAG policy
or graph construction.

## Runtime Telemetry Hooks

`createWorkerLoop` may emit local dispatch and tick summaries when the caller
passes `frameId` plus `telemetry.onDispatch` / `telemetry.onTick`.

Those hooks are intentionally:

- opt-in, so the hot path stays unchanged by default,
- local-first, so `@plasius/gpu-worker` does not take on analytics transport,
- string-contract based, so `@plasius/gpu-debug` and
  `@plasius/gpu-performance` can correlate `owner`, `queueClass`, `jobType`,
  and `frameId` without a hard package dependency.

## Future Expansion

The model should support additional effect families without changing the worker
core:

- post-processing
- cloth simulation
- fluid simulation
- lighting refresh
- voxel generation
- procedural terrain
- visibility or culling passes
- AI or navigation support jobs

The job surface expands through manifests and budgets, not through new
package-specific control loops.
