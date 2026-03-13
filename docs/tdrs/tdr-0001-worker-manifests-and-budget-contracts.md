# Technical Design Record (TDR)

## Title

TDR-0001: Worker Manifests and Budget Contracts

## Status

- Proposed -> Accepted
- Date: 2026-03-13
- Version: 1.0
- Supersedes: N/A
- Superseded by: N/A

## Scope

Defines the package-level contract expected from `@plasius/gpu-*` packages that
schedule discrete GPU work through `@plasius/gpu-worker`.

## Context

The worker queue and worklist runtime already exists, but package authors need a
consistent way to describe future workloads so they can be governed by
`@plasius/gpu-performance` and observed by `@plasius/gpu-debug`.

## Design

Each worker-integrated package should publish a logical job manifest containing:

- stable worker `jobType` identifiers,
- a queue class used for grouping and balancing,
- optional `priority`, `dependencies`, and `schedulerMode` metadata when jobs
  form a DAG instead of a flat ready stream,
- a bounded worker budget ladder,
- package-local translation from selected budget level to real dispatch
  behavior.

`@plasius/gpu-worker` remains responsible for queueing, worklist assembly, and
dispatch mechanics. Budget selection and pressure policy remain outside the
package.

## Data Contracts

- stable `jobType` identifiers aligned with worker registration order,
- queue class labels for coordination and debug grouping,
- scheduler mode plus dependency metadata for DAG-shaped workloads,
- budget levels that bound dispatch count, batch size, cadence, and optional
  queue-depth guardrails.

## Operational Considerations

- Reliability: manifests should be deterministic and bounded.
- Observability: job labels and queue classes should be stable enough for local
  debugging and analytics correlation.
- Security: labels and budget values must be validated by consuming packages.
- Cost: the contract adds metadata and policy clarity without changing the
  worker execution hot path.

## Rollout and Migration

1. Keep existing worker packages functioning as-is.
2. Document job manifests for new effect packages first.
3. Backfill older packages with explicit manifests as they adopt worker-based
   budgeting.

## Risks and Mitigations

- Risk: registration order could drift across packages.
  Mitigation: keep job labels stable and document manifest ownership per
  package.
- Risk: queue class labels could fragment.
  Mitigation: align queue class usage with the `@plasius/gpu-performance`
  worker-budget contract.

## Open Questions

- Whether common manifest helpers should later be added to `@plasius/gpu-worker`
  itself.
