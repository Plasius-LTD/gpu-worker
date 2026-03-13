# @plasius/gpu-worker

[![npm version](https://img.shields.io/npm/v/@plasius/gpu-worker.svg)](https://www.npmjs.com/package/@plasius/gpu-worker)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Plasius-LTD/gpu-worker/ci.yml?branch=main&label=build&style=flat)](https://github.com/Plasius-LTD/gpu-worker/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/Plasius-LTD/gpu-worker)](https://codecov.io/gh/Plasius-LTD/gpu-worker)
[![License](https://img.shields.io/github/license/Plasius-LTD/gpu-worker)](./LICENSE)
[![Code of Conduct](https://img.shields.io/badge/code%20of%20conduct-yes-blue.svg)](./CODE_OF_CONDUCT.md)
[![Security Policy](https://img.shields.io/badge/security%20policy-yes-orange.svg)](./SECURITY.md)
[![Changelog](https://img.shields.io/badge/changelog-md-blue.svg)](./CHANGELOG.md)

[![CI](https://github.com/Plasius-LTD/gpu-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Plasius-LTD/gpu-worker/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/Plasius-LTD/gpu-worker)](./LICENSE)

A WebGPU worker runtime that builds on `@plasius/gpu-lock-free-queue` to schedule WGSL workloads like ray tracing, physics, and acoustics.

Apache-2.0. ESM + CJS builds. WGSL assets are published in `dist/`.

## Install
```
npm install @plasius/gpu-worker
```

## Usage
```js
import {
  assembleWorkerWgsl,
  createWorkerLoop,
  loadJobWgsl,
  loadWorkerWgsl,
} from "@plasius/gpu-worker";

const workerWgsl = await loadWorkerWgsl();
const jobType = await loadJobWgsl({
  wgsl: `
fn process_job(job_index: u32, job_type: u32, payload_words: u32) {
  // job logic here
}
`,
  label: "physics",
});

const shaderCode = await assembleWorkerWgsl(workerWgsl, { debug: true });
// Pass shaderCode to device.createShaderModule({ code: shaderCode })
```

`loadJobWgsl` registers job WGSL and returns the assigned `job_type` index.
Call `assembleWorkerWgsl` again after registering new jobs to rebuild the
combined WGSL. Job types are assigned in registration order, so keep the
registration order stable across rebuilds if you need deterministic ids.

`assembleWorkerWgsl` also accepts an optional second argument to override the
queue WGSL source: `assembleWorkerWgsl(workerWgsl, { queueWgsl, queueUrl, fetcher })`.
By default it applies queue compatibility renames (for example `JobMeta` -> `JobDesc`);
set `queueCompat: false` to disable that behavior.
If you are concatenating WGSL manually, `loadQueueWgsl` provides the same
compatibility renames by default: `loadQueueWgsl({ url, fetcher, queueCompat: false })`.
Set `queueMode: "dag"` on `loadQueueWgsl(...)` or `assembleWorkerWgsl(...)`
to assemble against the multi-root DAG-ready queue helpers from
`@plasius/gpu-lock-free-queue`.

```js
const shaderCode = await assembleWorkerWgsl(workerWgsl, {
  preludeWgsl,
  jobs,
  queueMode: "dag",
});
```

Worker WGSL now calls `complete_job(job_index)` after `process_job(...)`.
Queue assets from `@plasius/gpu-lock-free-queue` already provide that hook. If
you pass a custom queue source without it, the assembler appends a no-op shim so
existing flat queue integrations keep working.

To bypass the registry, pass jobs directly:
```js
const shaderCode = await assembleWorkerWgsl(workerWgsl, {
  jobs: [{ wgsl: jobA }, { wgsl: jobB, label: "lighting" }],
  debug: true,
});
```

When assembling jobs, each job WGSL must define
`process_job(job_index, job_type, payload_words)`. The assembler rewrites each
job's `process_job` to a unique name and generates a dispatcher based on
`job_type`. Set `debug: true` to detect identifier clashes across appended WGSL.

To run the worker loop at the highest practical rate (or a target rate), use the
helper:
```js
const loop = createWorkerLoop({
  device,
  worker: { pipeline: workerPipeline, bindGroups: [queueBindGroup, simBindGroup] },
  jobs: [
    { pipeline: physicsPipeline, bindGroups: [queueBindGroup, simBindGroup], workgroups: physicsWorkgroups },
    { pipeline: renderIndirectPipeline, bindGroups: [queueBindGroup, simBindGroup], workgroups: 1 },
  ],
  workgroupSize: 64,
  maxJobsPerDispatch: queueCapacity,
  // rateHz: 120, // optional throttle; omit for animation-frame cadence
});
loop.start();
```

For opt-in local instrumentation, `createWorkerLoop` also accepts:

- `frameId`: a string or function returning the current frame correlation id.
- `worker.owner`, `worker.queueClass`, `worker.jobType`, `worker.label`,
  `worker.workgroupSize`: optional metadata for the dequeue pass.
- the same metadata fields on each job descriptor.
- `telemetry.onDispatch(sample)`: called after submit for each worker/job
  dispatch.
- `telemetry.onTick(summary)`: called after submit with the per-tick dispatch
  summary.

That allows direct integration with `@plasius/gpu-debug` without coupling the
runtime to the package:

```js
import { createGpuDebugSession } from "@plasius/gpu-debug";

const debug = createGpuDebugSession({ enabled: true });

const loop = createWorkerLoop({
  device,
  frameId: () => `frame-${frameNumber}`,
  worker: {
    pipeline: workerPipeline,
    bindGroups: [queueBindGroup],
    workgroups: [2, 1, 1],
    workgroupSize: 64,
    owner: "lighting",
    queueClass: "lighting",
    jobType: "worker.dequeue",
  },
  jobs: [
    {
      pipeline: directLightingPipeline,
      bindGroups: [queueBindGroup, lightingBindGroup],
      workgroupCount: [32, 18, 1],
      workgroupSize: [8, 8, 1],
      owner: "lighting",
      queueClass: "lighting",
      jobType: "lighting.direct",
    },
  ],
  telemetry: {
    onDispatch(sample) {
      debug.recordDispatch({
        owner: sample.owner,
        queueClass: sample.queueClass,
        jobType: sample.jobType,
        frameId: sample.frameId,
        workgroups: sample.workgroups,
        workgroupSize: sample.workgroupSize,
      });
    },
  },
});
```

## What this is
- A minimal GPU worker layer that combines a lock-free queue with user WGSL jobs.
- A helper to assemble WGSL modules with queue helpers included.
- A reference job format for fixed-size job dispatch (u32 indices).

## DAG Queue Modes

`@plasius/gpu-worker` now supports two scheduler assembly modes:

- `flat`: the original lock-free FIFO/worklist execution flow.
- `dag`: a multi-root, priority-aware ready-queue flow where jobs can declare
  dependencies and join points through their package-owned manifests.

The worker runtime still stays lock-free and policy-light. It does not resolve
budgets or decide priorities itself. Instead it exposes the queue mode and the
completion hook needed by package manifests and `@plasius/gpu-performance` to
coordinate DAG-shaped workloads.

Package manifests should be treated as explicit DAG node definitions, not just
loose hints. In practice that means:

- multiple roots are allowed and expected,
- manifest labels act as dependency ids,
- priorities map to ready-queue lanes,
- downstream jobs are unlocked only when every upstream dependency completes.

## Package Integration Model

`@plasius/gpu-worker` is the preferred execution plane for discrete GPU work
across current and future `@plasius/gpu-*` compute packages.

Package authors should:

- register stable worker job types for each effect family,
- keep scheduling in terms of compact worklists and bounded dispatches,
- expose `priority`, `dependencies`, and `schedulerMode` metadata in manifests
  when jobs form ordered DAG stages instead of a flat queue,
- let `@plasius/gpu-performance` adjust worker budgets instead of building
  separate package-local governors,
- expose optional local instrumentation through `createWorkerLoop(..., {
  telemetry })` and route that into `@plasius/gpu-debug` when clients enable
  it.

This pattern is intended to scale across post-processing, cloth, fluids,
lighting refresh, voxel generation, and additional GPU job families without
splitting scheduling policy across packages.

## Demo
The demo enqueues physics and render jobs on the GPU, builds per-type worklists, runs the
physics kernel, and uses an indirect draw for the particle pass. Install dependencies first
so the lock-free queue package is available for the browser import map.

```
npm install
npm run demo
```

Then open `http://localhost:8000/demo/`.

### HTTPS demo
WebGPU requires a secure context. For non-localhost access, run the HTTPS demo server.

```
mkdir -p demo/certs
mkcert -key-file demo/certs/localhost-key.pem -cert-file demo/certs/localhost.pem localhost 127.0.0.1 ::1
# or
openssl req -x509 -newkey rsa:2048 -nodes -keyout demo/certs/localhost-key.pem -out demo/certs/localhost.pem -days 365 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
npm run demo:https
```

Then open `https://localhost:8443/demo/`. If you use a different hostname/IP, generate a
certificate for that name and set `DEMO_HOST`, `DEMO_PORT`, `DEMO_TLS_CERT`, and
`DEMO_TLS_KEY` as needed.

## Build Outputs

`npm run build` emits `dist/index.js`, `dist/index.cjs`, and `dist/worker.wgsl`.

## Development Checks

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run pack:check
```

## Files
- `demo/index.html`: Loads the WebGPU demo.
- `demo/main.js`: WebGPU setup, queue jobs, physics worklists, and indirect draw.
- `demo/jobs/common.wgsl`: Shared WGSL definitions for demo jobs.
- `demo/jobs/physics.job.wgsl`: Physics job kernel (worklist + integration).
- `demo/jobs/render.job.wgsl`: Render job kernel (worklist + indirect args).
- `src/worker.wgsl`: Minimal worker entry point template (dequeue + `process_job` hook).
- `src/index.js`: Helper functions to load/assemble WGSL.
- `docs/adrs/*`: architectural decisions for worker runtime and scheduling.
- `docs/tdrs/*`: technical design records for multi-package worker integration.
- `docs/design/*`: design notes for package integration, DAG queue modes, and future expansion.

## Job shape
Jobs are variable-length payloads stored in a caller-managed buffer. Each job supplies `job_type`, `payload_offset`, and `payload_words` metadata plus a payload stored in the input payload buffer. For simple cases, use a single-word payload containing an index into your workload array.

Set `output_stride` in queue params to the maximum payload size you want copied out for a job; `job_type` can be used by schedulers to route work to different kernels. The queue mirrors input metadata into `output_jobs` and optionally copies payloads into `output_payloads`.
