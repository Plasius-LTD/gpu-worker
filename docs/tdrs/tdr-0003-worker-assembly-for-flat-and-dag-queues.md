# Technical Design Record (TDR)

## Title

TDR-0003: Worker Assembly for Flat and DAG Queues

## Status

- Proposed -> Accepted
- Date: 2026-03-13
- Version: 1.0
- Supersedes: N/A
- Superseded by: N/A

## Scope

Defines how `@plasius/gpu-worker` loads and assembles WGSL when the underlying
queue contract is either the original flat lock-free queue or the newer
multi-root DAG-ready scheduler.

## Context

Effect packages now need to express dependency chains and join points without
losing the shared worker runtime. The queue asset owns enqueue/dequeue and
dependency-unlock behavior, while the worker package owns job dispatch
assembly.

## Design

- `loadQueueWgsl({ queueMode })` accepts `flat` or `dag`.
- `assembleWorkerWgsl(workerWgsl, { queueMode })` resolves the same scheduler
  mode when no explicit `queueWgsl` is provided.
- The worker template invokes `complete_job(job_index)` after job execution.
- Queue assets from `@plasius/gpu-lock-free-queue` provide the hook directly.
- Custom queue sources that omit the hook receive an injected no-op shim for
  compatibility.

## Data Contracts

- `queueMode: "flat" | "dag"`
- `complete_job(job_index: u32)` queue lifecycle hook
- stable `jobType` values supplied by package manifests
- optional manifest metadata for `priority` and `dependencies`

## Operational Considerations

- Reliability: invalid queue modes fail fast.
- Maintainability: one worker assembly path covers both queue families.
- Performance: queue mode selection happens at assembly/load time, not in the
  worker hot path.
- Compatibility: flat queue sources continue to work while DAG queue assets
  adopt the shared completion hook.
