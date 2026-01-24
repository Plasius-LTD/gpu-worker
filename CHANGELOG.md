# Changelog

All notable changes to this project will be documented in this file.

The format is based on **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)**, and this project adheres to **[Semantic Versioning](https://semver.org/spec/v2.0.0.html)**.

---

## [Unreleased]

- **Added**
  - `loadJobWgsl` to register multiple job WGSL modules and receive `job_type` ids.
  - Job-aware `assembleWorkerWgsl` that appends registered jobs and generates a dispatch wrapper.
  - Optional debug mode for WGSL identifier clash detection during assembly.
  - `loadQueueWgsl` helper that can apply queue compatibility renames during load.
  - `createWorkerLoop` helper to drive worker/job compute dispatch at max or throttled rates.
  - Demo denoise job WGSL (`demo/jobs/denoise.wgsl`) with a compute pass + present shader.
  - Temporal denoise history buffer in the demo to stabilize jittered lighting.

- **Changed**
  - Demo visuals now render a campfire scene with deferred lighting (G-buffer + fullscreen lighting pass).
  - Demo now builds per-type worklists from queue jobs and uses indirect draws for render jobs alongside physics jobs.
  - `src/worker.wgsl` is now a minimal worker template; demo kernels live in `demo/jobs/*.wgsl`.
  - Demo job shaders are split into `demo/jobs/common.wgsl`, `demo/jobs/physics.job.wgsl`, and `demo/jobs/render.job.wgsl`.
  - Demo lighting sampling now uses screen-space jitter to avoid world-space banding artifacts.
  - `assembleWorkerWgsl` can now consume a registry or explicit job list and emit a dispatching `process_job`.
  - `assembleWorkerWgsl` now applies queue compatibility renames (e.g., `JobMeta` -> `JobDesc`) by default.

- **Fixed**
  - Reduced diagonal banding artifacts in the demo lighting pass.

- **Security**
  - (placeholder)

## [0.1.1] - 2026-01-23

- **Added**
  - `assembleWorkerWgsl` now accepts optional queue WGSL overrides for local demos.

- **Changed**
  - Demo now simulates millions of instanced objects with range checks, bounding spheres/AABBs, and face contact stats.
  - **Breaking:** Queue bindings updated to remove the payload arena and use payload offsets into caller-managed buffers.
  - Demo updated to match the new payload-handle layout.
  - **Breaking:** Queue bindings now use job metadata and a variable-size payload arena.
  - Worker job payloads are read from the output payload buffer using `output_stride`.
  - Demo updated to emit job metadata and payload buffers.

- **Fixed**
  - Demo can load a local queue WGSL to avoid mismatched dependency versions.

- **Security**
  - (placeholder)

## [0.1.0] - 2026-01-22

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [0.1.0-beta.1] - 2026-01-22

- **Added**
  - Unit tests for WGSL loading/assembly with coverage output for CI.

- **Changed**
  - Build outputs now ship as ESM and CJS bundles with the WGSL asset in `dist/`.

- **Fixed**
  - CJS builds no longer warn on `import.meta` when resolving `worker.wgsl`.

- **Security**
  - (placeholder)

## [0.1.0-beta.1]

- **Added**
  - Initial beta release with lock-free GPU job queue integration.
  - WGSL worker module and helper utilities.
  - Ray tracing demo.

---

## Release process (maintainers)

1. Update `CHANGELOG.md` under **Unreleased** with user-visible changes.
2. Bump version in `package.json` following SemVer (major/minor/patch).
3. Move entries from **Unreleased** to a new version section with the current date.
4. Tag the release in Git (`vX.Y.Z`) and push tags.
5. Publish to npm (via CI/CD or `npm publish`).

> Tip: Use Conventional Commits in PR titles/bodies to make changelog updates easier.

---

[Unreleased]: https://github.com/Plasius-LTD/gpu-worker/compare/v0.1.1...HEAD
[0.1.0-beta.1]: https://github.com/Plasius-LTD/gpu-worker/releases/tag/v0.1.0-beta.1
[0.1.0]: https://github.com/Plasius-LTD/gpu-worker/releases/tag/v0.1.0
