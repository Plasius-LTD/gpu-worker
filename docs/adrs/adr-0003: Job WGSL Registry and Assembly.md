# ADR-0003: Job WGSL Registry and Assembly

## Status

- Proposed -> Accepted
- Date: 2026-01-23
- Version: 1.0
- Supersedes: N/A
- Superseded by: N/A

## Context

We need to load multiple WGSL job modules (potentially downloaded at runtime), assign
stable `job_type` identifiers, and rebuild a combined worker shader when new jobs
arrive. Concatenating multiple job files naively causes naming collisions, and the
host needs a clean way to map job registrations back to `job_type` values.

## Decision

We will introduce a job registry and assembly glue in `@plasius/gpu-worker`:

- `loadJobWgsl` registers a job WGSL source and returns the assigned `job_type`.
- `assembleWorkerWgsl` concatenates queue WGSL, registered job WGSL, generated
  dispatch glue, and the worker template.
- Each job WGSL defines `process_job(job_index, job_type, payload_words)`; the
  assembler rewrites this function to a unique name per job and emits a dispatcher
  `process_job` that switches on `job_type`.
- A `debug` option scans the assembled WGSL for identifier clashes (functions,
  structs, globals) and errors early when conflicts are detected.

## Consequences

- **Positive:** Jobs can be loaded incrementally; `job_type` assignments are stable
  per registration order; assembly can be rebuilt deterministically; collisions are
  detected before GPU compilation in debug mode.
- **Negative:** Rebuilds are required when new jobs are appended; job WGSL must
  include a `process_job` entry function; the debug scan is a best-effort parser.
- **Neutral:** Existing workflows can still concatenate WGSL manually if desired.

## Alternatives Considered

- **Single user-provided `process_job` only:** Rejected due to manual merge burden
  and fragile job-type bookkeeping.
- **Explicit entry-point names per job:** Rejected to reduce API friction; the
  registry auto-renames `process_job` to avoid collisions.
- **Separate pipelines per job:** Rejected to keep scheduling centralized and avoid
  extra pipeline management overhead.
