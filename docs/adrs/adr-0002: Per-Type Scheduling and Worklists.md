# ADR-0002: Per-Type Scheduling and Worklists

## Status

- Proposed -> Accepted
- Date: 2026-01-23
- Version: 1.0
- Supersedes: N/A
- Superseded by: N/A

## Context

The worker must schedule multiple workload types (physics, particles, fluids, ray tracing, rendering prep) while maintaining stable frame times. We want a single queue and per-type budgets to control quality without heavy CPU involvement. Scheduling overhead must remain under 1-5%.

## Decision

We will implement per-type scheduling on top of a single queue with job types:

- Use a worklist builder pass to dequeue jobs and write compact worklists with `job_type` and payload references.
- Maintain per-type counts and offsets for worklists.
- Compute per-type dispatch counts from budgets and queue length snapshots.
- Execute per-type kernels using indirect dispatch and per-type worklist slices.
- Use GPU-produced indirect draw buffers for render-related jobs.

## Consequences

- **Positive:** Dynamic, per-type quality control with low overhead and minimal CPU coordination.
- **Negative:** Requires extra buffers for worklists and per-type counters.
- **Neutral:** Per-type kernels can evolve independently without changing queue mechanics.

## Alternatives Considered

- **Single mega-kernel with job_type switch:** Rejected due to divergence and poor cache behavior.
- **Multiple queues per task type:** Rejected to keep integration simple and minimize queue management overhead.
