# DAG Queue Integration

## Goal

Allow `@plasius/gpu-worker` to assemble WGSL against a dependency-aware
multi-root scheduler without changing the worker dispatch contract.

## Integration Model

1. `@plasius/gpu-lock-free-queue` publishes the scheduler asset for `flat` or
   `dag`.
2. `@plasius/gpu-worker` loads the requested asset with `queueMode`.
3. The worker template dequeues runnable jobs, dispatches `process_job(...)`,
   then calls `complete_job(job_index)`.
4. The queue asset updates readiness state and publishes newly unlocked jobs.

## Why the Completion Hook Matters

The DAG queue needs a post-dispatch callback to decrement unresolved dependency
counters and publish downstream work when a job finishes. A shared
`complete_job(job_index)` hook gives the queue asset that opportunity while
keeping the worker runtime simple.

## Package Contract

Effect packages should use:

- `queueMode: "dag"` when their manifests define dependency chains,
- stable `jobType` identifiers,
- bounded `priority` values,
- dependency ids that match manifest job labels.

Packages with flat independent jobs can keep using `queueMode: "flat"`.
