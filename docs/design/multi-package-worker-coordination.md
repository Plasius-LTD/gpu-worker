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
- a bounded budget ladder for dispatch frequency and batch size,
- optional debug instrumentation hooks that are dormant unless enabled by the
  client.

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
