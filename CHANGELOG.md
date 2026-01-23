# Changelog

All notable changes to this project will be documented in this file.

The format is based on **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)**, and this project adheres to **[Semantic Versioning](https://semver.org/spec/v2.0.0.html)**.

---

## [Unreleased]

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

[Unreleased]: https://github.com/Plasius-LTD/gpu-worker/compare/v0.3.0...HEAD
[0.1.0-beta.1]: https://github.com/Plasius-LTD/gpu-worker/releases/tag/v0.1.0-beta.1
[0.1.0]: https://github.com/Plasius-LTD/gpu-worker/releases/tag/v0.1.0
[0.2.0]: https://github.com/Plasius-LTD/gpu-worker/releases/tag/v0.2.0
[0.3.0]: https://github.com/Plasius-LTD/gpu-worker/releases/tag/v0.3.0
