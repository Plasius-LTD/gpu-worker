import { assembleWorkerWgsl } from "../src/index.js";

const logEl = document.getElementById("log");
const statsEl = document.getElementById("stats");
const canvas = document.getElementById("frame");
const ctx = canvas.getContext("2d");

const STAT_INDEX = {
  inRange: 0,
  faceContacts: 1,
  xNeg: 2,
  xPos: 3,
  yNeg: 4,
  yPos: 5,
  zNeg: 6,
  zPos: 7,
  bodyContacts: 8,
};

const numberFormat = new Intl.NumberFormat("en-US");
const debugGpu = true;

function logLine(line) {
  if (!logEl) {
    return;
  }
  logEl.textContent += `\n${line}`;
}

function setStats(lines) {
  if (!statsEl) {
    return;
  }
  statsEl.textContent = lines.join("\n");
}

async function fetchText(url) {
  const urlString = url instanceof URL ? url.href : String(url);
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Failed to fetch ${urlString}: ${err.message}`);
  }
  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    throw new Error(`Failed to fetch ${urlString}: ${response.status}${statusText}`);
  }
  return response.text();
}

function nextPowerOfTwo(value) {
  let v = 1;
  while (v < value) {
    v <<= 1;
  }
  return v;
}

function highestPowerOfTwo(value) {
  let v = 1;
  while (v * 2 <= value) {
    v *= 2;
  }
  return v;
}

function buildInstances(instanceCount, boundsMin, boundsMax) {
  const data = new Float32Array(instanceCount * 12);
  const rangeX = boundsMax[0] - boundsMin[0];
  const rangeY = boundsMax[1] - boundsMin[1];
  const rangeZ = boundsMax[2] - boundsMin[2];

  for (let i = 0; i < instanceCount; i += 1) {
    const halfX = 0.35 + Math.random() * 1.25;
    const halfY = 0.2 + Math.random() * 1.0;
    const halfZ = 0.35 + Math.random() * 1.25;

    const posX = boundsMin[0] + halfX + Math.random() * (rangeX - 2 * halfX);
    const posY = boundsMin[1] + halfY + Math.random() * (rangeY - 2 * halfY);
    const posZ = boundsMin[2] + halfZ + Math.random() * (rangeZ - 2 * halfZ);

    const speed = 0.6 + Math.random() * 2.4;
    const velX = (Math.random() * 2 - 1) * speed;
    const velY = (Math.random() * 2 - 1) * speed * 0.25;
    const velZ = (Math.random() * 2 - 1) * speed;

    const base = i * 12;
    data[base] = posX;
    data[base + 1] = posY;
    data[base + 2] = posZ;
    data[base + 3] = 1.0;
    data[base + 4] = halfX;
    data[base + 5] = halfY;
    data[base + 6] = halfZ;
    data[base + 7] = 0.0;
    data[base + 8] = velX;
    data[base + 9] = velY;
    data[base + 10] = velZ;
    data[base + 11] = 0.0;
  }

  return data;
}

function drawScene(samples, boundsMin, boundsMax, sensor, range) {
  if (!ctx) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#100f0d";
  ctx.fillRect(0, 0, width, height);

  const pad = 24;
  const scaleX = (width - pad * 2) / (boundsMax[0] - boundsMin[0]);
  const scaleY = (height - pad * 2) / (boundsMax[2] - boundsMin[2]);
  const toCanvasX = (x) => pad + (x - boundsMin[0]) * scaleX;
  const toCanvasY = (z) => pad + (z - boundsMin[2]) * scaleY;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  const gridSteps = 8;
  for (let i = 0; i <= gridSteps; i += 1) {
    const t = i / gridSteps;
    const x = pad + t * (width - pad * 2);
    const y = pad + t * (height - pad * 2);
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, height - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(247, 242, 233, 0.35)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2);

  const sensorX = toCanvasX(sensor[0]);
  const sensorY = toCanvasY(sensor[2]);
  const rangeRadius = range * (scaleX + scaleY) * 0.5;
  ctx.strokeStyle = "rgba(217, 137, 91, 0.5)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(sensorX, sensorY, rangeRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(217, 137, 91, 0.85)";
  ctx.beginPath();
  ctx.arc(sensorX, sensorY, 3.2, 0, Math.PI * 2);
  ctx.fill();

  for (const sample of samples) {
    const min = sample.min;
    const max = sample.max;
    const pos = sample.pos;
    const radius = sample.radius;
    const inRange = sample.inRange;
    const faceMask = sample.faceMask;

    const boxX = toCanvasX(min[0]);
    const boxY = toCanvasY(min[2]);
    const boxW = (max[0] - min[0]) * scaleX;
    const boxH = (max[2] - min[2]) * scaleY;

    const collided = faceMask !== 0;
    const stroke = collided ? "#d4573a" : inRange ? "#2a8f7b" : "rgba(255, 255, 255, 0.25)";
    const fill = inRange ? "rgba(42, 143, 123, 0.2)" : "rgba(255, 255, 255, 0.06)";

    ctx.strokeStyle = stroke;
    ctx.lineWidth = collided ? 1.4 : 0.8;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = fill;
    ctx.fillRect(boxX, boxY, boxW, boxH);

    const cx = toCanvasX(pos[0]);
    const cy = toCanvasY(pos[2]);
    ctx.strokeStyle = "rgba(217, 137, 91, 0.22)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (scaleX + scaleY) * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

async function init() {
  if (!navigator.gpu) {
    if (!window.isSecureContext) {
      logLine("WebGPU requires a secure context (HTTPS or localhost).");
    } else {
      logLine("WebGPU not available in this browser.");
    }
    return;
  }
  if (!ctx) {
    logLine("Canvas 2D context missing.");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    logLine("No suitable GPU adapter found.");
    return;
  }

  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    logLine(`WebGPU device lost: ${info.message ?? "unknown"}`);
    console.error("WebGPU device lost", info);
  });
  logLine(`Max storage buffers per stage: ${device.limits.maxStorageBuffersPerShaderStage}`);
  const workerWgslUrl = new URL("../src/worker.wgsl", import.meta.url);
  const workerWgsl = await fetchText(workerWgslUrl);
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

  const simLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [queueLayout, simLayout],
  });

  const enqueuePipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module, entryPoint: "enqueue_main" },
  });

  const simulatePipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module, entryPoint: "simulate_main" },
  });

  const instanceStride = 48;
  const resultStride = 64;
  const slotStride = 16;
  const storageLimit = Math.min(
    device.limits.maxStorageBufferBindingSize ?? device.limits.maxBufferSize,
    device.limits.maxBufferSize,
  );
  const requestedCount = 2_048;
  const maxByInstances = Math.floor(storageLimit / instanceStride);
  const maxByResults = Math.floor(storageLimit / resultStride);
  const maxBySlots = highestPowerOfTwo(Math.floor(storageLimit / slotStride));
  const maxByDispatch = device.limits.maxComputeWorkgroupsPerDimension * 64;
  const maxCount = Math.min(maxByInstances, maxByResults, maxBySlots, maxByDispatch);
  const instanceCount = Math.max(1, Math.min(requestedCount, maxCount));

  if (instanceCount < requestedCount) {
    logLine(
      `Clamped instance count to ${numberFormat.format(instanceCount)} (storage limit).`,
    );
  }

  const jobCount = instanceCount;
  const capacity = nextPowerOfTwo(jobCount);

  const queueHeaderSize = 32;
  const slotsSize = capacity * slotStride;

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

  const instanceBuffer = device.createBuffer({
    size: instanceCount * instanceStride,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const resultBuffer = device.createBuffer({
    size: instanceCount * resultStride,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const statsCount = 16;
  const statsBuffer = device.createBuffer({
    size: statsCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  const simParamsBuffer = device.createBuffer({
    size: 96,
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

  const paramsData = new Uint32Array(8);
  paramsData[0] = jobCount;
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);

  const boundsMin = [-10, -6, -10];
  const boundsMax = [10, 6, 10];
  const sensor = [0, 0, 0];
  const range = 8.5;
  const stepsPerFrame = 1;
  const maxDeltaSeconds = 0.05;

  const simParamsData = new ArrayBuffer(96);
  const simU32 = new Uint32Array(simParamsData);
  const simF32 = new Float32Array(simParamsData);
  simU32[0] = instanceCount;
  simU32[1] = stepsPerFrame;
  simF32[4] = 0.016;
  simF32[5] = range;
  simF32[8] = boundsMin[0];
  simF32[9] = boundsMin[1];
  simF32[10] = boundsMin[2];
  simF32[12] = boundsMax[0];
  simF32[13] = boundsMax[1];
  simF32[14] = boundsMax[2];
  simF32[16] = sensor[0];
  simF32[17] = sensor[1];
  simF32[18] = sensor[2];
  device.queue.writeBuffer(simParamsBuffer, 0, simParamsData);

  const instances = buildInstances(instanceCount, boundsMin, boundsMax);
  device.queue.writeBuffer(instanceBuffer, 0, instances);
  device.queue.writeBuffer(statsBuffer, 0, new Uint32Array(statsCount));

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

  const simBindGroup = device.createBindGroup({
    layout: simLayout,
    entries: [
      { binding: 0, resource: { buffer: instanceBuffer } },
      { binding: 1, resource: { buffer: resultBuffer } },
      { binding: 2, resource: { buffer: simParamsBuffer } },
      { binding: 3, resource: { buffer: statsBuffer } },
    ],
  });

  const sampleCount = Math.min(1024, instanceCount);
  const sampleBytes = sampleCount * resultStride;
  const resultsReadback = device.createBuffer({
    size: sampleBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const statsReadback = device.createBuffer({
    size: statsCount * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const enqueuePasses = 2;
  const workgroupCount = Math.ceil(jobCount / 64);
  const floatsPerResult = resultStride / 4;
  const statsZero = new Uint32Array(statsCount);
  const statusZero = new Uint32Array(jobCount);
  let frameCounter = 0;
  let stagnantFrames = 0;
  let lastSamplePos = null;
  let lastFrameTime = performance.now();

  logLine(`Jobs dispatched per frame: ${numberFormat.format(jobCount)}`);
  logLine(`Results sampled per frame: ${numberFormat.format(sampleCount)}`);
  logLine("Simulation running.");

  async function renderFrame() {
    const now = performance.now();
    const deltaSeconds = Math.min(maxDeltaSeconds, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    const stepDt = deltaSeconds / stepsPerFrame;

    frameCounter += 1;

    simU32[1] = stepsPerFrame;
    simF32[4] = stepDt;
    device.queue.writeBuffer(simParamsBuffer, 0, simParamsData);
    device.queue.writeBuffer(statsBuffer, 0, statsZero);
    device.queue.writeBuffer(statusBuffer, 0, statusZero);

    if (debugGpu) {
      device.pushErrorScope("validation");
    }
    const encoder = device.createCommandEncoder();

    for (let i = 0; i < enqueuePasses; i += 1) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(enqueuePipeline);
      pass.setBindGroup(0, queueBindGroup);
      pass.setBindGroup(1, simBindGroup);
      pass.dispatchWorkgroups(workgroupCount);
      pass.end();
    }

    const simPass = encoder.beginComputePass();
    simPass.setPipeline(simulatePipeline);
    simPass.setBindGroup(0, queueBindGroup);
    simPass.setBindGroup(1, simBindGroup);
    simPass.dispatchWorkgroups(workgroupCount);
    simPass.end();

    encoder.copyBufferToBuffer(resultBuffer, 0, resultsReadback, 0, sampleBytes);
    encoder.copyBufferToBuffer(statsBuffer, 0, statsReadback, 0, statsCount * 4);

    const frameStart = performance.now();
    device.queue.submit([encoder.finish()]);

    await Promise.all([
      resultsReadback.mapAsync(GPUMapMode.READ),
      statsReadback.mapAsync(GPUMapMode.READ),
    ]);
    const elapsed = performance.now() - frameStart;

    if (debugGpu) {
      const error = await device.popErrorScope();
      if (error) {
        logLine(`WebGPU validation error: ${error.message}`);
        console.error("WebGPU validation error", error);
      }
    }

    const resultsData = new Float32Array(resultsReadback.getMappedRange());
    const statsData = new Uint32Array(statsReadback.getMappedRange());
    const statsSnapshot = statsData.slice();

    const samples = [];
    let minDist = Number.POSITIVE_INFINITY;
    let maxDist = 0;
    let maxSpeed = 0;
    let inRangeSample = 0;

    for (let i = 0; i < sampleCount; i += 1) {
      const base = i * floatsPerResult;
      const min = [
        resultsData[base],
        resultsData[base + 1],
        resultsData[base + 2],
      ];
      const max = [
        resultsData[base + 4],
        resultsData[base + 5],
        resultsData[base + 6],
      ];
      const pos = [
        resultsData[base + 8],
        resultsData[base + 9],
        resultsData[base + 10],
      ];
      const radius = resultsData[base + 11];
      const dist = resultsData[base + 12];
      const speed = resultsData[base + 13];
      const inRange = resultsData[base + 14] > 0.5;
      const faceMask = Math.round(resultsData[base + 15]);

      minDist = Math.min(minDist, dist);
      maxDist = Math.max(maxDist, dist);
      maxSpeed = Math.max(maxSpeed, speed);
      if (inRange) {
        inRangeSample += 1;
      }

      samples.push({ min, max, pos, radius, inRange, faceMask });
    }

    resultsReadback.unmap();
    statsReadback.unmap();

    let sampleDelta = 0;
    if (samples.length > 0) {
      const first = samples[0].pos;
      if (lastSamplePos) {
        const dx = first[0] - lastSamplePos[0];
        const dy = first[1] - lastSamplePos[1];
        const dz = first[2] - lastSamplePos[2];
        sampleDelta = Math.hypot(dx, dy, dz);
        if (sampleDelta < 1e-4) {
          stagnantFrames += 1;
        } else {
          stagnantFrames = 0;
        }
      }
      lastSamplePos = [...first];
    }

    drawScene(samples, boundsMin, boundsMax, sensor, range);

    const statsLines = [
      `Frame: ${numberFormat.format(frameCounter)} (delta ${sampleDelta.toFixed(5)})`,
      `Stagnant frames: ${numberFormat.format(stagnantFrames)}`,
      `Instances: ${numberFormat.format(instanceCount)}`,
      `Queue capacity: ${numberFormat.format(capacity)}`,
      `Sim steps: ${stepsPerFrame} @ ${stepDt.toFixed(3)}s`,
      `Range hits: ${numberFormat.format(statsSnapshot[STAT_INDEX.inRange])}`,
      `Face contacts: ${numberFormat.format(statsSnapshot[STAT_INDEX.faceContacts])}`,
      `Body contacts: ${numberFormat.format(statsSnapshot[STAT_INDEX.bodyContacts])}`,
      `Face hits (-X/+X/-Y/+Y/-Z/+Z): ${[
        statsSnapshot[STAT_INDEX.xNeg],
        statsSnapshot[STAT_INDEX.xPos],
        statsSnapshot[STAT_INDEX.yNeg],
        statsSnapshot[STAT_INDEX.yPos],
        statsSnapshot[STAT_INDEX.zNeg],
        statsSnapshot[STAT_INDEX.zPos],
      ]
        .map((value) => numberFormat.format(value))
        .join(" / ")}`,
      `Sample in range: ${numberFormat.format(inRangeSample)} / ${numberFormat.format(sampleCount)}`,
      `Sample min/max distance: ${minDist.toFixed(2)} / ${maxDist.toFixed(2)}`,
      `Sample max speed: ${maxSpeed.toFixed(2)}`,
      `Frame time: ${elapsed.toFixed(1)} ms`,
    ];

    setStats(statsLines);

    requestAnimationFrame(() => {
      renderFrame().catch((err) => {
        logLine(`Error: ${err.message}`);
        console.error(err);
      });
    });
  }

  requestAnimationFrame(() => {
    renderFrame().catch((err) => {
      logLine(`Error: ${err.message}`);
      console.error(err);
    });
  });
}

init().catch((err) => {
  logLine(`Error: ${err.message}`);
  console.error(err);
});
