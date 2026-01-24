# @plasius/gpu-worker

[![npm version](https://img.shields.io/npm/v/@plasius/gpu-worker)](https://www.npmjs.com/package/@plasius/gpu-worker)
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

## What this is
- A minimal GPU worker layer that combines a lock-free queue with user WGSL jobs.
- A helper to assemble WGSL modules with queue helpers included.
- A reference job format for fixed-size job dispatch (u32 indices).

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

## Files
- `demo/index.html`: Loads the WebGPU demo.
- `demo/main.js`: WebGPU setup, queue jobs, physics worklists, and indirect draw.
- `demo/jobs/common.wgsl`: Shared WGSL definitions for demo jobs.
- `demo/jobs/physics.job.wgsl`: Physics job kernel (worklist + integration).
- `demo/jobs/render.job.wgsl`: Render job kernel (worklist + indirect args).
- `src/worker.wgsl`: Minimal worker entry point template (dequeue + `process_job` hook).
- `src/index.js`: Helper functions to load/assemble WGSL.

## Job shape
Jobs are variable-length payloads stored in a caller-managed buffer. Each job supplies `job_type`, `payload_offset`, and `payload_words` metadata plus a payload stored in the input payload buffer. For simple cases, use a single-word payload containing an index into your workload array.

Set `output_stride` in queue params to the maximum payload size you want copied out for a job; `job_type` can be used by schedulers to route work to different kernels. The queue mirrors input metadata into `output_jobs` and optionally copies payloads into `output_payloads`.
