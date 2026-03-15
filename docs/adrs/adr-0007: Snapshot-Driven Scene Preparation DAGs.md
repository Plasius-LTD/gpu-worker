# ADR-0007: Snapshot-Driven Scene Preparation DAGs

## Status

Accepted

## Context

The Plasius rendering architecture is moving toward a ray-tracing-first,
chunked world pipeline. That architecture depends on a strict separation
between authoritative simulation truth and the derived visual state used to
prepare a frame.

`@plasius/gpu-worker` already exposes a DAG-ready execution plane, but the next
wave of renderer and world packages needs a more explicit contract for
snapshot-driven scene-preparation work. The preparation pipeline should be able
to fan out by chunk, process independent regions in parallel, and join only
where stage-local dependencies require it.

## Decision

`@plasius/gpu-worker` will treat scene preparation as a first-class DAG use
case with the following expectations:

- scene-preparation jobs consume stable world snapshots rather than mutating
  in-flight simulation state
- manifests may publish multiple roots per chunk or region when unrelated work
  can start immediately
- joins stay local to chunk or representation-stage boundaries rather than
  forcing global barriers
- priority lanes should favor player-near, visible, or otherwise image-critical
  chunks first
- worker manifests should be able to represent the common preparation families:
  transform propagation, animation, deformation, bounds, LOD selection,
  visibility, light assignment, render-proxy generation, and ray-tracing update
  preparation

## Consequences

- Positive: renderer and world packages gain one shared execution model for
  multicore scene preparation.
- Positive: the worker runtime stays aligned with the lock-free DAG scheduler
  instead of drifting toward package-local orchestration rules.
- Positive: future packages such as cloth, fluids, or post-processing can
  describe preparation work through the same snapshot-driven manifest contract.
- Neutral: package authors still own the semantics of each job family; this ADR
  standardizes orchestration expectations, not package-specific shader logic.

## Rejected Alternatives

- Keep scene preparation as an implicit sequence in each consumer package:
  rejected because that would duplicate scheduling policy and make cross-package
  budgeting inconsistent.
- Add a separate scene-preparation scheduler package now: rejected because the
  existing worker and DAG queue packages already cover the execution primitive.

## Follow-On Work

- Add a technical decision record for the scene-preparation worker-manifest
  contract.
- Add test-first contract and unit specs covering snapshot roots, chunk-local
  joins, and priority-driven chunk scheduling.
