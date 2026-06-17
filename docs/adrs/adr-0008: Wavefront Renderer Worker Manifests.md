# ADR-0008: Wavefront Renderer Worker Manifests

## Status

Accepted

## Context

`@plasius/gpu-worker` already supports flat worker loops and DAG-oriented scene
preparation manifests. The wavefront path-tracing backlog needs one more
reusable contract layer: renderer packages must describe bounce-ordered pass
queues, BVH preparation stages, accumulation, and optional denoise without
reimplementing scheduler semantics inside each `gpu-*` package.

Without a shared manifest helper, the same orchestration rules would drift
across renderer, lighting, performance, and diagnostics packages. That would
make queue-class budgeting harder, complicate DAG validation, and make bounce
ordering less trustworthy.

## Decision

`@plasius/gpu-worker` will expose a first-class wavefront renderer manifest
helper through `createWavefrontRendererPassManifest(...)` and the
`wavefrontRendererStageFamilies` contract.

The helper standardizes the reusable worker/DAG shape for:

- BVH triangle assembly, optional leaf sorting, leaf materialization, and
  bottom-up BVH build levels
- primary ray generation
- per-bounce intersection, surface resolution, contribution, continuation, and
  compaction
- tile-local accumulation and optional frame-level denoise

The helper must:

- preserve breadth-first bounce dependencies
- keep queue-class metadata explicit so `@plasius/gpu-performance` can budget
  the work
- reject invalid extra dependencies and cycles before packages reach GPU
  execution
- stay reusable across renderer-adjacent packages instead of encoding
  renderer-private WGSL details

## Consequences

- Positive: renderer packages share one worker-manifest contract for
  bounce-ordered wavefront scheduling.
- Positive: diagnostics, budgeting, and queue instrumentation can key off the
  same stable stage-family vocabulary.
- Positive: tests can validate DAG ordering without requiring GPU execution.
- Neutral: individual packages still own shader logic and pass payload details;
  this helper standardizes orchestration only.

## Rejected Alternatives

- Keep wavefront pass manifests package-local in each renderer package:
  rejected because it would duplicate queue and dependency semantics.
- Add a separate wavefront scheduler package:
  rejected because `@plasius/gpu-worker` already owns the reusable worker/DAG
  contract surface.

## Follow-On Work

- Feed the manifest stage families into `@plasius/gpu-debug` diagnostics and
  `@plasius/gpu-performance` budget integrations.
- Reuse the helper from the remaining wavefront renderer stories and package
  tasks instead of growing repo-local DAG builders.
