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
import { assembleWorkerWgsl, loadWorkerWgsl } from "@plasius/gpu-worker";

const workerWgsl = await loadWorkerWgsl();
const shaderCode = await assembleWorkerWgsl(workerWgsl);
// Pass shaderCode to device.createShaderModule({ code: shaderCode })
```

`assembleWorkerWgsl` also accepts an optional second argument to override the queue WGSL source:
`assembleWorkerWgsl(workerWgsl, { queueWgsl, queueUrl, fetcher })`.

## What this is
- A minimal GPU worker layer that combines a lock-free queue with user WGSL jobs.
- A helper to assemble WGSL modules with queue helpers included.
- A reference job format for fixed-size job dispatch (u32 indices).

## Demo
The demo enqueues ray tracing tile jobs on the GPU and renders a simple scene. Install
dependencies first so the lock-free queue package is available for the browser import map.

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
- `demo/index.html`: Loads the ray tracing demo.
- `demo/main.js`: WebGPU setup, enqueue, and ray tracing kernel.
- `src/worker.wgsl`: Worker entry points that dequeue jobs and run a ray tracer.
- `src/index.js`: Helper functions to load/assemble WGSL.

## Job shape
Jobs are variable-length payloads stored in a caller-managed buffer. Each job supplies `job_type`, `payload_offset`, and `payload_words` metadata plus a payload stored in the input payload buffer. For simple cases, use a single-word payload containing an index into your workload array.

Set `output_stride` in queue params to the maximum payload size you want copied out for a job; `job_type` can be used by schedulers to route work to different kernels. The queue mirrors input metadata into `output_jobs` and optionally copies payloads into `output_payloads`.
