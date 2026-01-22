import { assembleWorkerWgsl, loadWorkerWgsl } from "../src/index.js";

const logEl = document.getElementById("log");
const canvas = document.getElementById("frame");
const ctx = canvas.getContext("2d");

function logLine(line) {
  logEl.textContent += `\n${line}`;
}

function nextPowerOfTwo(value) {
  let v = 1;
  while (v < value) {
    v <<= 1;
  }
  return v;
}

async function init() {
  if (!navigator.gpu) {
    logLine("WebGPU not available in this browser.");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    logLine("No suitable GPU adapter found.");
    return;
  }

  const device = await adapter.requestDevice();
  const workerWgsl = await loadWorkerWgsl();
  const shaderCode = await assembleWorkerWgsl(workerWgsl);
  const module = device.createShaderModule({ code: shaderCode });
  const info = await module.getCompilationInfo();
  if (info.messages.length) {
    info.messages.forEach((msg) => {
      logLine(`WGSL ${msg.type}: ${msg.message}`);
    });
  }

  const queueLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });

  const renderLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [queueLayout, renderLayout],
  });

  const enqueuePipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module, entryPoint: "enqueue_main" },
  });

  const raytracePipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module, entryPoint: "raytrace_main" },
  });

  const width = canvas.width;
  const height = canvas.height;
  const tileSize = 8;
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  const jobCount = tilesX * tilesY;
  const capacity = nextPowerOfTwo(jobCount);

  const queueHeaderSize = 32;
  const slotSize = 16;
  const slotsSize = capacity * slotSize;

  const queueBuffer = device.createBuffer({
    size: queueHeaderSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const slotsBuffer = device.createBuffer({
    size: slotsSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const inputBuffer = device.createBuffer({
    size: jobCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const outputBuffer = device.createBuffer({
    size: jobCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const statusBuffer = device.createBuffer({
    size: jobCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const pixelCount = width * height;
  const framebuffer = device.createBuffer({
    size: pixelCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: pixelCount * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const renderParamsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const queueHeader = new Uint32Array([
    0,
    0,
    capacity,
    capacity - 1,
    0,
    0,
    0,
    0,
  ]);
  device.queue.writeBuffer(queueBuffer, 0, queueHeader);

  const slotsInit = new Uint32Array(slotsSize / 4);
  for (let i = 0; i < capacity; i += 1) {
    const base = i * 4;
    slotsInit[base] = i;
  }
  device.queue.writeBuffer(slotsBuffer, 0, slotsInit);

  const inputJobs = new Uint32Array(jobCount);
  for (let i = 0; i < jobCount; i += 1) {
    inputJobs[i] = i;
  }
  device.queue.writeBuffer(inputBuffer, 0, inputJobs);
  device.queue.writeBuffer(statusBuffer, 0, new Uint32Array(jobCount));

  const paramsData = new Uint32Array([jobCount, 0, 0, 0, 0, 0, 0, 0]);
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);

  const renderParams = new ArrayBuffer(64);
  const renderU32 = new Uint32Array(renderParams);
  const renderF32 = new Float32Array(renderParams);
  renderU32[0] = width;
  renderU32[1] = height;
  renderU32[2] = tileSize;
  renderF32[4] = 0.0;
  renderF32[5] = 1.5;
  renderF32[6] = 5.0;
  renderF32[8] = 0.0;
  renderF32[9] = 1.0;
  renderF32[10] = 0.0;
  renderF32[12] = (45 * Math.PI) / 180;
  renderF32[13] = width / height;
  renderF32[14] = performance.now() * 0.001;
  device.queue.writeBuffer(renderParamsBuffer, 0, renderParams);

  const queueBindGroup = device.createBindGroup({
    layout: queueLayout,
    entries: [
      { binding: 0, resource: { buffer: queueBuffer } },
      { binding: 1, resource: { buffer: slotsBuffer } },
      { binding: 2, resource: { buffer: inputBuffer } },
      { binding: 3, resource: { buffer: outputBuffer } },
      { binding: 4, resource: { buffer: statusBuffer } },
      { binding: 5, resource: { buffer: paramsBuffer } },
    ],
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderLayout,
    entries: [
      { binding: 0, resource: { buffer: framebuffer } },
      { binding: 1, resource: { buffer: renderParamsBuffer } },
    ],
  });

  const encoder = device.createCommandEncoder();

  for (let i = 0; i < 4; i += 1) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(enqueuePipeline);
    pass.setBindGroup(0, queueBindGroup);
    pass.dispatchWorkgroups(Math.ceil(jobCount / 64));
    pass.end();
  }

  const rayPass = encoder.beginComputePass();
  rayPass.setPipeline(raytracePipeline);
  rayPass.setBindGroup(0, queueBindGroup);
  rayPass.setBindGroup(1, renderBindGroup);
  rayPass.dispatchWorkgroups(Math.ceil(jobCount / 64));
  rayPass.end();

  encoder.copyBufferToBuffer(framebuffer, 0, readback, 0, pixelCount * 4);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint32Array(readback.getMappedRange());
  const imageData = ctx.createImageData(width, height);
  const view = new Uint32Array(imageData.data.buffer);
  view.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  readback.unmap();

  logLine(`Queue capacity: ${capacity}`);
  logLine(`Jobs dispatched: ${jobCount}`);
  logLine("Ray tracing complete.");
}

init().catch((err) => {
  logLine(`Error: ${err.message}`);
  console.error(err);
});
