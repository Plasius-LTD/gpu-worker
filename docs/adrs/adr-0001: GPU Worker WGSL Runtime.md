# ADR-0001: GPU Worker WGSL Runtime

## Status

- Proposed -> Accepted
- Date: 2026-01-22
- Version: 1.0
- Supersedes: N/A
- Superseded by: N/A

## Context

We need a lightweight GPU worker runtime that can schedule WGSL workloads (ray tracing, physics, acoustics) on WebGPU. The runtime should integrate with the lock-free queue package and provide a simple way to assemble user-defined WGSL with queue helpers.

## Decision

We will provide `@plasius/gpu-worker` with these structural choices:

- Build on `@plasius/gpu-lock-free-queue` for MPMC scheduling.
- Provide worker WGSL entry points that dequeue jobs and run user kernels.
- Use a fixed-size job format (u32 indices) with payloads stored in separate buffers.
- Ship WGSL assets in `dist/` and provide JS helpers to load and assemble the shader module.
- Publish both ESM and CJS builds.

## Consequences

- **Positive:** Minimal integration effort for GPU jobs; deterministic scheduling; queue reuse across workloads.
- **Negative:** Job payloads must be fixed-size or referenced indirectly; more complex variable payloads require separate arenas.
- **Neutral:** Consumers can build higher-level schedulers on top without changing the core runtime.

## Alternatives Considered

- **Custom job schedulers per project:** Rejected due to duplication and inconsistent behavior.
- **CPU-only dispatch:** Rejected due to higher latency and CPU/GPU sync overhead.
