# ADR-0006: Flat and DAG Queue Assembly Modes

## Status

- Accepted
- Date: 2026-03-13

## Context

`@plasius/gpu-lock-free-queue` now exposes both flat queue helpers and a
multi-root DAG-ready scheduler asset. `@plasius/gpu-worker` needs to assemble
WGSL for either mode without branching into separate worker runtimes or
forcing effect packages to maintain their own completion-hook conventions.

## Decision

`@plasius/gpu-worker` will support queue assembly modes:

- `queueMode: "flat"` for the existing FIFO/worklist behavior.
- `queueMode: "dag"` for dependency-aware, priority-aware ready queues.

The worker template will call `complete_job(job_index)` after
`process_job(...)`. Queue assets are responsible for implementing that hook. If
callers provide a custom queue source that omits it, the assembler appends a
no-op compatibility shim.

## Consequences

- Positive: one worker runtime can execute both flat and DAG queue contracts.
- Positive: effect packages can roll out DAG manifests without forking worker
  assembly code.
- Positive: older flat queue sources remain compatible through the no-op hook.
- Negative: package authors must align custom queue sources with the shared
  completion-hook contract over time.

## Alternatives Considered

- Split flat and DAG worker runtimes: rejected because it duplicates assembly,
  testing, and package integration.
- Put DAG graph logic inside `@plasius/gpu-worker`: rejected because queue
  shape belongs to `@plasius/gpu-lock-free-queue`, not the worker dispatcher.
