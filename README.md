# @plasius/gpu-worker

[![npm version](https://img.shields.io/npm/v/@plasius/gpu-worker)](https://www.npmjs.com/package/@plasius/gpu-worker)
[![CI](https://github.com/Plasius-LTD/gpu-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Plasius-LTD/gpu-worker/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@plasius/gpu-worker)](./LICENSE)

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

## What this is
- A minimal GPU worker layer that combines a lock-free queue with user WGSL jobs.
- A helper to assemble WGSL modules with queue helpers included.
- A reference job format for fixed-size job dispatch (u32 indices).

## Demo
The demo enqueues ray tracing tile jobs on the GPU and renders a simple scene. Install
dependencies first so the lock-free queue package is available for the browser import map.

```
npm install
python3 -m http.server
```

Then open `http://localhost:8000/demo/`.

## Build Outputs

`npm run build` emits `dist/index.js`, `dist/index.cjs`, and `dist/worker.wgsl`.

## Files
- `demo/index.html`: Loads the ray tracing demo.
- `demo/main.js`: WebGPU setup, enqueue, and ray tracing kernel.
- `src/worker.wgsl`: Worker entry points that dequeue jobs and run a ray tracer.
- `src/index.js`: Helper functions to load/assemble WGSL.

## Job shape
Jobs are `u32` indices into a fixed workload array (tiles, particles, etc). Keep job data fixed-size; use indices into a separate payload buffer for variable payloads.
