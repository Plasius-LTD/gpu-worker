import { createWorkerLoop, loadJobWgsl, assembleWorkerWgsl } from "../src/index.js";

const logEl = document.getElementById("log");
const statsEl = document.getElementById("stats");
const canvas = document.getElementById("frame");
const canvasContext = canvas.getContext("webgpu");
const countSlider = document.getElementById("countSlider");
const countValueEl = document.getElementById("countValue");
const radiusSlider = document.getElementById("radiusSlider");
const radiusValueEl = document.getElementById("radiusValue");

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

const numberFormat = new Intl.NumberFormat("en-GB");
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

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2 * far * near * nf,
    0,
  ]);
}

function mat4LookAt(eye, target, up) {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz);
  const z0 = len > 0 ? zx / len : 0;
  const z1 = len > 0 ? zy / len : 0;
  const z2 = len > 0 ? zz / len : 1;

  const xx = up[1] * z2 - up[2] * z1;
  const xy = up[2] * z0 - up[0] * z2;
  const xz = up[0] * z1 - up[1] * z0;
  len = Math.hypot(xx, xy, xz);
  const x0 = len > 0 ? xx / len : 1;
  const x1 = len > 0 ? xy / len : 0;
  const x2 = len > 0 ? xz / len : 0;

  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  return new Float32Array([
    x0,
    y0,
    z0,
    0,
    x1,
    y1,
    z1,
    0,
    x2,
    y2,
    z2,
    0,
    -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
    -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
    -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
    1,
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i += 1) {
    const ai0 = a[i];
    const ai1 = a[i + 4];
    const ai2 = a[i + 8];
    const ai3 = a[i + 12];
    out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
    out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
    out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

function cameraBasis(eye, target, up) {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz);
  const z0 = len > 0 ? zx / len : 0;
  const z1 = len > 0 ? zy / len : 0;
  const z2 = len > 0 ? zz / len : 1;

  const xx = up[1] * z2 - up[2] * z1;
  const xy = up[2] * z0 - up[0] * z2;
  const xz = up[0] * z1 - up[1] * z0;
  len = Math.hypot(xx, xy, xz);
  const x0 = len > 0 ? xx / len : 1;
  const x1 = len > 0 ? xy / len : 0;
  const x2 = len > 0 ? xz / len : 0;

  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  return {
    right: [x0, x1, x2],
    up: [y0, y1, y2],
  };
}

function buildInstances(instanceCount, boundsMin, boundsMax, emitter, emissionRadius) {
  const data = new Float32Array(instanceCount * 12);

  for (let i = 0; i < instanceCount; i += 1) {
    const radius = 0.025 + Math.random() * 0.04;
    const halfX = radius;
    const halfY = radius;
    const halfZ = radius;
    const angle = Math.random() * Math.PI * 2;
    const radial = Math.sqrt(Math.random()) * emissionRadius;
    const baseX = emitter[0] + Math.cos(angle) * radial;
    const baseZ = emitter[2] + Math.sin(angle) * radial;
    const posX = Math.min(boundsMax[0] - halfX, Math.max(boundsMin[0] + halfX, baseX));
    const posZ = Math.min(boundsMax[2] - halfZ, Math.max(boundsMin[2] + halfZ, baseZ));
    const posY = boundsMin[1] + halfY + Math.random() * 0.2;

    const lateral = 0.05 + Math.random() * 0.25;
    const upward = 2.6 + Math.random() * 3.2;
    const velX = Math.cos(angle) * lateral + (Math.random() - 0.5) * 0.08;
    const velZ = Math.sin(angle) * lateral + (Math.random() - 0.5) * 0.08;
    const velY = upward;
    const lifetime = 1.6 + Math.random() * 3.0;
    const age = Math.random() * lifetime * 0.6;

    const base = i * 12;
    data[base] = posX;
    data[base + 1] = posY;
    data[base + 2] = posZ;
    data[base + 3] = 1.0;
    data[base + 4] = halfX;
    data[base + 5] = halfY;
    data[base + 6] = halfZ;
    data[base + 7] = lifetime;
    data[base + 8] = velX;
    data[base + 9] = velY;
    data[base + 10] = velZ;
    data[base + 11] = age;
  }

  return data;
}

function buildSceneGeometry(lightPos) {
  const vertices = [];
  const boxes = [];
  const pushVertex = (x, y, z, nx, ny, nz, r, g, b, a) => {
    vertices.push(x, y, z, nx, ny, nz, r, g, b, a);
  };
  const addFace = (v0, v1, v2, v3, normal, color) => {
    pushVertex(...v0, ...normal, ...color);
    pushVertex(...v1, ...normal, ...color);
    pushVertex(...v2, ...normal, ...color);
    pushVertex(...v0, ...normal, ...color);
    pushVertex(...v2, ...normal, ...color);
    pushVertex(...v3, ...normal, ...color);
  };
  const addBox = (min, max, color, emissive = 0, castShadow = true) => {
    const [minX, minY, minZ] = min;
    const [maxX, maxY, maxZ] = max;
    const c = [color[0], color[1], color[2], emissive];
    const p000 = [minX, minY, minZ];
    const p001 = [minX, minY, maxZ];
    const p010 = [minX, maxY, minZ];
    const p011 = [minX, maxY, maxZ];
    const p100 = [maxX, minY, minZ];
    const p101 = [maxX, minY, maxZ];
    const p110 = [maxX, maxY, minZ];
    const p111 = [maxX, maxY, maxZ];

    addFace(p101, p100, p110, p111, [1, 0, 0], c);
    addFace(p000, p001, p011, p010, [-1, 0, 0], c);
    addFace(p001, p101, p111, p011, [0, 0, 1], c);
    addFace(p100, p000, p010, p110, [0, 0, -1], c);
    addFace(p010, p011, p111, p110, [0, 1, 0], c);
    addFace(p000, p100, p101, p001, [0, -1, 0], c);

    if (castShadow) {
      boxes.push({ min, max });
    }
  };

  const groundMin = [-3.2, -0.12, -3.2];
  const groundMax = [3.2, 0.0, 3.2];
  addBox(groundMin, groundMax, [0.12, 0.1, 0.08], 0, true);

  const emberMin = [-0.28, 0.0, -0.28];
  const emberMax = [0.28, 0.06, 0.28];
  addBox(emberMin, emberMax, [0.1, 0.07, 0.05], 0, false);

  addBox([-0.7, 0.0, -0.12], [0.7, 0.18, 0.12], [0.28, 0.18, 0.1], 0, true);
  addBox([-0.12, 0.06, -0.7], [0.12, 0.24, 0.7], [0.24, 0.15, 0.09], 0, true);
  addBox([-0.55, 0.14, -0.1], [0.55, 0.28, 0.1], [0.26, 0.16, 0.1], 0, true);

  const stoneRadius = 0.62;
  const stoneSize = 0.14;
  const stoneHeight = 0.18;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const sx = Math.cos(angle) * stoneRadius;
    const sz = Math.sin(angle) * stoneRadius;
    const shade = 0.18 + 0.04 * (i % 2);
    addBox(
      [sx - stoneSize * 0.5, 0.0, sz - stoneSize * 0.5],
      [sx + stoneSize * 0.5, stoneHeight, sz + stoneSize * 0.5],
      [shade, shade, shade + 0.02],
      0,
      false,
    );
  }

  const flameWidth = 0.18;
  const flameHeight = 0.45;
  const fx = lightPos[0];
  const fy = lightPos[1] - 0.06;
  const fz = lightPos[2];
  const flameMin = [fx - flameWidth * 0.5, fy, fz - 0.01];
  const flameMax = [fx + flameWidth * 0.5, fy + flameHeight, fz + 0.01];
  addBox(flameMin, flameMax, [1.0, 0.58, 0.25], 1.4, false);

  return {
    vertexData: new Float32Array(vertices),
    boxes,
  };
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
  if (!canvasContext) {
    logLine("WebGPU canvas context missing.");
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

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const depthFormat = "depth24plus";
  const gBufferFormat = "rgba16float";
  let depthTexture = null;
  let depthView = null;
  let gPositionTexture = null;
  let gPositionView = null;
  let gNormalTexture = null;
  let gNormalView = null;
  let gAlbedoTexture = null;
  let gAlbedoView = null;
  let denoiseTexture = null;
  let denoiseView = null;
  let denoiseHistoryTexture = null;
  let denoiseHistoryView = null;
  let sceneColorTexture = null;
  let sceneColorView = null;
  let denoiseJobBindGroupLayout = null;
  let denoiseJobBindGroup = null;
  let denoiseBindGroupLayout = null;
  let denoiseBindGroup = null;
  let denoiseSampler = null;
  let lightingBindGroupLayout = null;
  let lightingBindGroup = null;
  let updateLightingBindGroup = () => {};

  const configureCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvasContext.configure({
      device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });
    depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    depthView = depthTexture.createView();
    gPositionTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: gBufferFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    gPositionView = gPositionTexture.createView();
    gNormalTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: gBufferFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    gNormalView = gNormalTexture.createView();
    gAlbedoTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: gBufferFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    gAlbedoView = gAlbedoTexture.createView();
    denoiseTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: gBufferFormat,
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    denoiseView = denoiseTexture.createView();
    denoiseHistoryTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: gBufferFormat,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    denoiseHistoryView = denoiseHistoryTexture.createView();
    sceneColorTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: presentationFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    sceneColorView = sceneColorTexture.createView();
    if (denoiseJobBindGroupLayout) {
      denoiseJobBindGroup = device.createBindGroup({
        layout: denoiseJobBindGroupLayout,
        entries: [
          { binding: 0, resource: sceneColorView },
          { binding: 1, resource: denoiseView },
          { binding: 2, resource: denoiseHistoryView },
        ],
      });
    }
    if (denoiseBindGroupLayout && denoiseSampler) {
      denoiseBindGroup = device.createBindGroup({
        layout: denoiseBindGroupLayout,
        entries: [
          { binding: 3, resource: denoiseView },
          { binding: 4, resource: denoiseSampler },
        ],
      });
    }
    if (denoiseHistoryView) {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: denoiseHistoryView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
  };
  configureCanvas();
  window.addEventListener("resize", () => {
    configureCanvas();
    updateLightingBindGroup();
  });
  const queueWgslUrl = new URL(
    "../node_modules/@plasius/gpu-lock-free-queue/dist/queue.wgsl",
    import.meta.url,
  );
  const workerWgslUrl = new URL("../src/worker.wgsl", import.meta.url);
  const preludeWgslUrl = new URL("./jobs/common.wgsl", import.meta.url);
  const physicsJobUrl = new URL("./jobs/physics.job.wgsl", import.meta.url);
  const renderJobUrl = new URL("./jobs/render.job.wgsl", import.meta.url);
  const denoiseWgslUrl = new URL("./jobs/denoise.wgsl", import.meta.url);

  const workerWgsl = await fetchText(workerWgslUrl);
  const preludeWgsl = await fetchText(preludeWgslUrl);
  const physicsJobType = await loadJobWgsl({
    url: physicsJobUrl,
    fetcher: fetch,
    label: "physics",
  });
  const renderJobType = await loadJobWgsl({
    url: renderJobUrl,
    fetcher: fetch,
    label: "render",
  });
  const denoiseJobType = await loadJobWgsl({
    url: denoiseWgslUrl,
    fetcher: fetch,
    label: "denoise",
  });
  if (debugGpu && (physicsJobType !== 0 || renderJobType !== 1 || denoiseJobType !== 2)) {
    logLine(
      `Debug: job types assigned as physics=${physicsJobType}, render=${renderJobType}, denoise=${denoiseJobType}`,
    );
  }

  const shaderCode = await assembleWorkerWgsl(workerWgsl, {
    queueUrl: queueWgslUrl,
    fetcher: fetch,
    preludeWgsl,
    debug: debugGpu,
  });
  const denoiseShaderCode = await fetchText(denoiseWgslUrl);
  if (debugGpu) {
    const metaIndex = shaderCode.search(/\bmeta\b/);
    if (metaIndex >= 0) {
      logLine(`Debug: 'meta' token found in shader code near:`);
      logLine(shaderCode.slice(Math.max(0, metaIndex - 40), metaIndex + 40));
    }
    if (/\bJobMeta\b/.test(shaderCode)) {
      logLine("Debug: 'JobMeta' still present in assembled shader.");
    }
    const head = shaderCode.slice(0, 200).toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html") || head.includes("<meta")) {
      logLine("Debug: shader code looks like HTML (check WGSL URLs/server root).");
    }
  }
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
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });

  const emptyLayout = device.createBindGroupLayout({ entries: [] });

  const workerSimLayout = device.createBindGroupLayout({
    entries: [
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const simLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const enqueuePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [queueLayout] }),
    compute: { module, entryPoint: "enqueue_main" },
  });

  const workerPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [queueLayout, workerSimLayout],
    }),
    compute: { module, entryPoint: "worker_main" },
  });

  const physicsPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [emptyLayout, simLayout],
    }),
    compute: { module, entryPoint: "physics_main" },
  });

  const renderIndirectPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [emptyLayout, simLayout],
    }),
    compute: { module, entryPoint: "render_indirect_main" },
  });

  const instanceStride = 48;
  const resultStride = 64;
  const slotStride = 16;
  const storageLimit = Math.min(
    device.limits.maxStorageBufferBindingSize ?? device.limits.maxBufferSize,
    device.limits.maxBufferSize,
  );
  const requestedCount = 10_000;
  const maxByInstances = Math.floor(storageLimit / instanceStride);
  const maxByResults = Math.floor(storageLimit / resultStride);
  const maxBySlots = highestPowerOfTwo(Math.floor(storageLimit / slotStride));
  const maxDispatch = device.limits.maxComputeWorkgroupsPerDimension * 64;
  const maxByDispatch = Math.floor(maxDispatch / 2);
  const maxByQueue = Math.floor(maxBySlots / 2);
  const maxCount = Math.min(maxByInstances, maxByResults, maxByQueue, maxByDispatch);
  const instanceCount = Math.max(1, Math.min(requestedCount, maxCount));
  let activeCount = Math.min(requestedCount, instanceCount);
  let activeJobCount = activeCount * 2;
  let sizeScale = 1.0;

  if (instanceCount < requestedCount) {
    logLine(
      `Clamped instance count to ${numberFormat.format(instanceCount)} (storage limit).`,
    );
  }

  const maxJobCount = instanceCount * 2;
  const capacity = nextPowerOfTwo(maxJobCount);
  const maxPayloadWords = 1;

  const queueHeaderSize = 16;
  const slotsSize = capacity * slotStride;
  const payloadSize = maxJobCount * maxPayloadWords * 4;

  const queueBuffer = device.createBuffer({
    size: queueHeaderSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const slotsBuffer = device.createBuffer({
    size: slotsSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const inputJobsBuffer = device.createBuffer({
    size: maxJobCount * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const outputJobsBuffer = device.createBuffer({
    size: maxJobCount * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const inputPayloadBuffer = device.createBuffer({
    size: payloadSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const outputPayloadBuffer = device.createBuffer({
    size: payloadSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const queueStatusBuffer = device.createBuffer({
    size: maxJobCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    size: 16,
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

  const worklistEntries = 2 + instanceCount * 2;
  const worklistBuffer = device.createBuffer({
    size: worklistEntries * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const renderIndirectBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
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
  ]);
  device.queue.writeBuffer(queueBuffer, 0, queueHeader);

  const slotsInit = new Uint32Array(slotsSize / 4);
  for (let i = 0; i < capacity; i += 1) {
    const base = i * 4;
    slotsInit[base] = i;
  }
  device.queue.writeBuffer(slotsBuffer, 0, slotsInit);

  const inputJobs = new Uint32Array(maxJobCount * 4);
  const inputPayloads = new Uint32Array(maxJobCount * maxPayloadWords);
  const updateJobsForCount = (count) => {
    const clamped = Math.max(1, Math.min(count, instanceCount));
    const jobs = clamped * 2;
    for (let i = 0; i < jobs; i += 1) {
      const base = i * 4;
      const isRender = i >= clamped;
      const instanceIndex = isRender ? i - clamped : i;
      inputJobs[base] = isRender ? renderJobType : physicsJobType;
      inputJobs[base + 1] = i * maxPayloadWords;
      inputJobs[base + 2] = 1;
      inputJobs[base + 3] = 0;
      inputPayloads[i] = instanceIndex;
    }
    return { clamped, jobs };
  };
  const initialJobs = updateJobsForCount(activeCount);
  activeCount = initialJobs.clamped;
  activeJobCount = initialJobs.jobs;
  device.queue.writeBuffer(inputJobsBuffer, 0, inputJobs.subarray(0, activeJobCount * 4));
  device.queue.writeBuffer(
    inputPayloadBuffer,
    0,
    inputPayloads.subarray(0, activeJobCount * maxPayloadWords),
  );
  device.queue.writeBuffer(outputJobsBuffer, 0, new Uint32Array(maxJobCount * 4));

  const paramsData = new Uint32Array(4);
  paramsData[0] = activeJobCount;
  paramsData[1] = maxPayloadWords;
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);

  const worklistZero = new Uint32Array(2);
  const statusZero = new Uint32Array(maxJobCount);

  const updateCountLabel = () => {
    if (countValueEl) {
      countValueEl.textContent = numberFormat.format(activeCount);
    }
  };
  const updateRadiusLabel = () => {
    if (radiusValueEl) {
      radiusValueEl.textContent = `${(sizeScale * 100).toFixed(0)}%`;
    }
  };
  const applyCount = (count) => {
    const updated = updateJobsForCount(count);
    activeCount = updated.clamped;
    activeJobCount = updated.jobs;
    paramsData[0] = activeJobCount;
    simU32[0] = activeCount;
    device.queue.writeBuffer(paramsBuffer, 0, paramsData);
    device.queue.writeBuffer(simParamsBuffer, 0, simParamsData);
    device.queue.writeBuffer(inputJobsBuffer, 0, inputJobs.subarray(0, activeJobCount * 4));
    device.queue.writeBuffer(
      inputPayloadBuffer,
      0,
      inputPayloads.subarray(0, activeJobCount * maxPayloadWords),
    );
    device.queue.writeBuffer(queueBuffer, 0, queueHeader);
    device.queue.writeBuffer(slotsBuffer, 0, slotsInit);
    device.queue.writeBuffer(queueStatusBuffer, 0, statusZero);
    device.queue.writeBuffer(worklistBuffer, 0, worklistZero);
    updateCountLabel();
  };
  const applySizeScale = (scale) => {
    sizeScale = Math.max(0.4, Math.min(scale, 2.0));
    simF32[7] = sizeScale;
    device.queue.writeBuffer(simParamsBuffer, 0, simParamsData);
    updateRadiusLabel();
  };

  if (countSlider) {
    const step = instanceCount >= 5000 ? 500 : instanceCount >= 1000 ? 100 : 50;
    const minCount = Math.max(1, Math.min(500, instanceCount));
    countSlider.min = String(minCount);
    countSlider.max = String(instanceCount);
    countSlider.step = String(step);
    countSlider.value = String(activeCount);
    updateCountLabel();
    countSlider.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      applyCount(value);
    });
  }
  if (radiusSlider) {
    radiusSlider.min = "0.5";
    radiusSlider.max = "1.5";
    radiusSlider.step = "0.05";
    radiusSlider.value = String(sizeScale);
    updateRadiusLabel();
    radiusSlider.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      applySizeScale(value);
    });
  }

  const boundsMin = [-2.8, 0, -2.2];
  const boundsMax = [2.8, 3.8, 2.2];
  const sensor = [0, 0, 0];
  const range = 0.5;
  const stepsPerFrame = 3;
  const maxDeltaSeconds = 0.03;

  const lightBase = [sensor[0], boundsMin[1] + 0.45, sensor[2]];
  const sceneGeometry = buildSceneGeometry(lightBase);
  const meshVertexData = sceneGeometry.vertexData;
  const meshVertexBuffer = device.createBuffer({
    size: meshVertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(meshVertexBuffer, 0, meshVertexData);
  const meshVertexCount = meshVertexData.length / 10;

  const MAX_BOXES = 6;
  const baseUniformFloats = 36;
  const sceneUniformSize = (baseUniformFloats + MAX_BOXES * 8) * 4;
  const sceneUniformBuffer = device.createBuffer({
    size: sceneUniformSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sceneUniformData = new Float32Array(sceneUniformSize / 4);

  const meshShaderCode = `
    const MAX_BOXES: u32 = ${MAX_BOXES}u;

    struct SceneUniforms {
      viewProj: mat4x4<f32>,
      cameraPos: vec4<f32>,
      lightPos: vec4<f32>,
      cameraRight: vec4<f32>,
      cameraUp: vec4<f32>,
      boxCount: vec4<f32>,
      boxMin: array<vec4<f32>, MAX_BOXES>,
      boxMax: array<vec4<f32>, MAX_BOXES>,
    };

    struct VertexInput {
      @location(0) position: vec3<f32>,
      @location(1) normal: vec3<f32>,
      @location(2) color: vec4<f32>,
    };

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) worldPos: vec3<f32>,
      @location(1) normal: vec3<f32>,
      @location(2) color: vec4<f32>,
    };

    struct GBufferOut {
      @location(0) position: vec4<f32>,
      @location(1) normal: vec4<f32>,
      @location(2) albedo: vec4<f32>,
    };

    @group(0) @binding(0) var<uniform> scene: SceneUniforms;

    @vertex
    fn vs_main(input: VertexInput) -> VertexOutput {
      var out: VertexOutput;
      out.worldPos = input.position;
      out.normal = input.normal;
      out.color = input.color;
      out.position = scene.viewProj * vec4<f32>(input.position, 1.0);
      return out;
    }

    @fragment
    fn fs_main(input: VertexOutput) -> GBufferOut {
      var out: GBufferOut;
      out.position = vec4<f32>(input.worldPos, 1.0);
      out.normal = vec4<f32>(normalize(input.normal), 1.0);
      out.albedo = vec4<f32>(input.color.rgb, input.color.a);
      return out;
    }
  `;

  const lightingShaderCode = `
    const MAX_BOXES: u32 = ${MAX_BOXES}u;
    const LIGHT_SAMPLES: u32 = 24u;

    struct SceneUniforms {
      viewProj: mat4x4<f32>,
      cameraPos: vec4<f32>,
      lightPos: vec4<f32>,
      cameraRight: vec4<f32>,
      cameraUp: vec4<f32>,
      boxCount: vec4<f32>,
      boxMin: array<vec4<f32>, MAX_BOXES>,
      boxMax: array<vec4<f32>, MAX_BOXES>,
    };

    struct Result {
      aabb_min: vec4<f32>,
      aabb_max: vec4<f32>,
      sphere: vec4<f32>,
      metrics: vec4<f32>,
    };

    struct VSOut {
      @builtin(position) position: vec4<f32>,
    };

    @group(0) @binding(0) var gPosition: texture_2d<f32>;
    @group(0) @binding(1) var gNormal: texture_2d<f32>;
    @group(0) @binding(2) var gAlbedo: texture_2d<f32>;
    @group(0) @binding(3) var<uniform> scene: SceneUniforms;
    @group(0) @binding(4) var<storage, read> results: array<Result>;
    @group(0) @binding(5) var<storage, read> worklist: array<u32>;

    @vertex
    fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
      let pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
      );
      var out: VSOut;
      out.position = vec4<f32>(pos[vid], 0.0, 1.0);
      return out;
    }

    fn ray_box_intersect(origin: vec3<f32>, dir: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> f32 {
      let inv = 1.0 / dir;
      let t0 = (bmin - origin) * inv;
      let t1 = (bmax - origin) * inv;
      let tmin = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
      let tmax = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
      if (tmax >= max(tmin, 0.0)) {
        return tmin;
      }
      return -1.0;
    }

    fn is_occluded(pos: vec3<f32>, light_pos: vec3<f32>) -> bool {
      let to_light = light_pos - pos;
      let dist = length(to_light);
      if (dist < 1e-3) {
        return false;
      }
      let dir = to_light / dist;
      let origin = pos + dir * 0.02;
      let count = u32(scene.boxCount.x);
      for (var i: u32 = 0u; i < MAX_BOXES; i = i + 1u) {
        if (i >= count) {
          break;
        }
        let t = ray_box_intersect(origin, dir, scene.boxMin[i].xyz, scene.boxMax[i].xyz);
        if (t > 0.0 && t < dist) {
          return true;
        }
      }
      return false;
    }

    fn hash_u32(x: u32) -> u32 {
      var v = x;
      v = v ^ (v >> 16u);
      v = v * 0x7feb352du;
      v = v ^ (v >> 15u);
      v = v * 0x846ca68bu;
      v = v ^ (v >> 16u);
      return v;
    }

    fn hash_pixel(pixel: vec2<i32>, frame: u32, i: u32) -> u32 {
      let px = u32(pixel.x);
      let py = u32(pixel.y);
      let seed = px * 1973u + py * 9277u + frame * 26699u + i * 1013u;
      return hash_u32(seed);
    }

    fn particle_light(pos: vec3<f32>, normal: vec3<f32>, pixel: vec2<i32>) -> vec3<f32> {
      let max_count = (arrayLength(&worklist) - 2u) / 2u;
      let render_count = min(worklist[1], max_count);
      if (render_count == 0u) {
        return vec3<f32>(0.0);
      }
      let render_offset = 2u + max_count;
      let samples = max(1u, min(render_count, LIGHT_SAMPLES));
      let frame = u32(scene.cameraRight.w * 60.0);
      var accum: f32 = 0.0;
      for (var i: u32 = 0u; i < LIGHT_SAMPLES; i = i + 1u) {
        if (i >= samples) {
          break;
        }
        let pick = hash_pixel(pixel, frame, i) % render_count;
        let instance = worklist[render_offset + pick];
        let particle = results[instance];
        let to_light = particle.sphere.xyz - pos;
        let dist = length(to_light);
        if (dist < 1e-3) {
          continue;
        }
        let heat = clamp(particle.metrics.y * 0.035, 0.1, 1.0);
        let dir = to_light / dist;
        let ndotl = max(dot(normal, dir), 0.0);
        let dist2 = max(dist * dist, 0.04);
        let atten = 1.0 / dist2;
        var occ = 1.0;
        if (is_occluded(pos + normal * 0.02, particle.sphere.xyz)) {
          occ = 0.15;
        }
        accum = accum + atten * heat * occ * ndotl;
      }
      let scale = sqrt(f32(render_count) / f32(samples));
      let intensity = 1.0 - exp(-accum * scale * 0.03);
      let warm = vec3<f32>(1.0, 0.58, 0.28);
      return warm * intensity;
    }

    @fragment
    fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
      let pixel = vec2<i32>(input.position.xy);
      let world = textureLoad(gPosition, pixel, 0);
      let normalRaw = textureLoad(gNormal, pixel, 0).xyz;
      let albedo = textureLoad(gAlbedo, pixel, 0);
      if (length(normalRaw) < 1e-3) {
        return vec4<f32>(0.03, 0.025, 0.02, 1.0);
      }
      let normal = normalize(normalRaw);
      let to_light = scene.lightPos.xyz - world.xyz;
      let dist = length(to_light);
      let dir = to_light / max(dist, 1e-3);
      let diffuse = max(dot(normal, dir), 0.0);
      let dist2 = max(dist * dist, 0.04);
      let attenuation = scene.lightPos.w * 0.08 / dist2;
      var shadow = 1.0;
      if (is_occluded(world.xyz + normal * 0.02, scene.lightPos.xyz)) {
        shadow = 0.35;
      }
      let baseAmbient = 0.05;
      var color = albedo.rgb * (baseAmbient + diffuse * attenuation * shadow);
      color = color + albedo.rgb * albedo.a * 0.35;
      let particle = particle_light(world.xyz, normal, pixel);
      color = color + particle;
      let hazeStrength = scene.lightPos.w * 0.04 + length(particle) * 0.12;
      let haze = smoothstep(3.2, 0.4, dist) * hazeStrength * (0.6 + 0.4 * shadow);
      color = color + haze * vec3<f32>(0.9, 0.72, 0.55);
      color = color / (vec3<f32>(1.0) + color);
      let luma = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
      color = vec3<f32>(luma) * 0.45 + color * 0.55;
      return vec4<f32>(color, 1.0);
    }
  `;

  const spriteShaderCode = `
    const MAX_BOXES: u32 = ${MAX_BOXES}u;

    struct SceneUniforms {
      viewProj: mat4x4<f32>,
      cameraPos: vec4<f32>,
      lightPos: vec4<f32>,
      cameraRight: vec4<f32>,
      cameraUp: vec4<f32>,
      boxCount: vec4<f32>,
      boxMin: array<vec4<f32>, MAX_BOXES>,
      boxMax: array<vec4<f32>, MAX_BOXES>,
    };

    struct Result {
      aabb_min: vec4<f32>,
      aabb_max: vec4<f32>,
      sphere: vec4<f32>,
      metrics: vec4<f32>,
    };

    struct VSOut {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
      @location(1) heat: f32,
      @location(2) coreScale: f32,
      @location(3) flicker: f32,
    };

    @group(0) @binding(0) var<storage, read> results: array<Result>;
    @group(0) @binding(1) var<uniform> scene: SceneUniforms;
    @group(0) @binding(2) var<storage, read> worklist: array<u32>;

    fn hash1(p: vec3<f32>) -> f32 {
      let h = sin(dot(p, vec3<f32>(12.9898, 78.233, 37.719)));
      return fract(h * 43758.5453);
    }

    @vertex
    fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
      let quad = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, 1.0)
      );
      let corner = quad[vid];
      let max_count = (arrayLength(&worklist) - 2u) / 2u;
      let render_offset = 2u + max_count;
      let instance = worklist[render_offset + iid];
      let result = results[instance];
      let distToCamera = length(result.sphere.xyz - scene.cameraPos.xyz);
      let pixelWorld = scene.cameraUp.w * distToCamera;
      let baseRadius = max(pixelWorld * 0.7, 0.0015);
      let glowRadius = pixelWorld * 1.8;
      let radius = baseRadius + glowRadius;
      let world = result.sphere.xyz + (scene.cameraRight.xyz * corner.x + scene.cameraUp.xyz * corner.y) * radius;
      var out: VSOut;
      out.position = scene.viewProj * vec4<f32>(world, 1.0);
      out.uv = corner * 0.5 + vec2<f32>(0.5);
      out.heat = clamp(result.metrics.y * 0.06, 0.0, 1.0);
      out.coreScale = baseRadius / radius;
      let flickerSeed = hash1(result.sphere.xyz * 3.1 + vec3<f32>(result.metrics.y, result.metrics.x, result.metrics.z));
      out.flicker = 0.8 + 0.4 * flickerSeed;
      return out;
    }

    @fragment
    fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
      let dist = distance(input.uv, vec2<f32>(0.5, 0.5));
      let r = dist / 0.5;
      let edge = smoothstep(1.0, 0.8, r);
      let coreStrength = max(input.coreScale * input.coreScale * 0.02, 0.001);
      let core = exp(-r * r / coreStrength);
      let glow = exp(-r * r * 3.2);
      let base = vec3<f32>(1.0, 0.58, 0.22);
      let tip = vec3<f32>(1.0, 0.93, 0.78);
      let glowBase = vec3<f32>(0.95, 0.62, 0.35);
      let glowTip = vec3<f32>(1.0, 0.78, 0.55);
      let coreColor = base * (1.0 - input.heat) + tip * input.heat;
      let glowColor = glowBase * (1.0 - input.heat) + glowTip * input.heat;
      let coreMix = clamp(core * 1.35, 0.0, 1.0);
      var color = glowColor * (1.0 - coreMix) + coreColor * coreMix;
      let luma = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
      color = vec3<f32>(luma) * 0.55 + color * 0.45;
      let intensityRaw = (core * 1.1 + glow * 0.35) * input.flicker * edge;
      let intensity = 1.0 - exp(-intensityRaw * 1.1);
      let ember = vec3<f32>(0.95, 0.55, 0.28);
      let tint = smoothstep(0.35, 0.95, intensity);
      color = color + (ember - color) * (tint * 0.35);
      let bright = 0.7 + 0.35 * intensity;
      color = color * bright;
      let alpha = clamp(intensity * 0.32, 0.0, 0.5);
      return vec4<f32>(color * alpha, alpha);
    }
  `;

  const meshShaderModule = device.createShaderModule({ code: meshShaderCode });
  const lightingShaderModule = device.createShaderModule({ code: lightingShaderCode });
  const spriteShaderModule = device.createShaderModule({ code: spriteShaderCode });
  const denoiseShaderModule = device.createShaderModule({ code: denoiseShaderCode });
  const [meshInfo, lightingInfo, spriteInfo, denoiseInfo] = await Promise.all([
    meshShaderModule.getCompilationInfo(),
    lightingShaderModule.getCompilationInfo(),
    spriteShaderModule.getCompilationInfo(),
    denoiseShaderModule.getCompilationInfo(),
  ]);
  if (meshInfo.messages.length) {
    meshInfo.messages.forEach((msg) => {
      logLine(`Mesh WGSL ${msg.type}: ${msg.message}`);
    });
  }
  if (lightingInfo.messages.length) {
    lightingInfo.messages.forEach((msg) => {
      logLine(`Lighting WGSL ${msg.type}: ${msg.message}`);
    });
  }
  if (spriteInfo.messages.length) {
    spriteInfo.messages.forEach((msg) => {
      logLine(`Sprite WGSL ${msg.type}: ${msg.message}`);
    });
  }
  if (denoiseInfo.messages.length) {
    denoiseInfo.messages.forEach((msg) => {
      logLine(`Denoise WGSL ${msg.type}: ${msg.message}`);
    });
  }

  const meshBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  const spriteBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
    ],
  });

  const meshPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [meshBindGroupLayout] }),
    vertex: {
      module: meshShaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 40,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: {
      module: meshShaderModule,
      entryPoint: "fs_main",
      targets: [
        { format: gBufferFormat },
        { format: gBufferFormat },
        { format: gBufferFormat },
      ],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "back",
    },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  lightingBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 5,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
    ],
  });
  const lightingPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [lightingBindGroupLayout] }),
    vertex: {
      module: lightingShaderModule,
      entryPoint: "vs_main",
    },
    fragment: {
      module: lightingShaderModule,
      entryPoint: "fs_main",
      targets: [{ format: presentationFormat }],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },
  });

  const spritePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [spriteBindGroupLayout] }),
    vertex: {
      module: spriteShaderModule,
      entryPoint: "vs_main",
    },
    fragment: {
      module: spriteShaderModule,
      entryPoint: "fs_main",
      targets: [
        {
          format: presentationFormat,
          blend: {
            color: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: false,
      depthCompare: "less",
    },
  });

  const emptyBindGroupLayout = device.createBindGroupLayout({ entries: [] });

  denoiseJobBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: {},
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: "write-only",
          format: gBufferFormat,
        },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        texture: {},
      },
    ],
  });
  const denoiseJobPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [emptyBindGroupLayout, emptyBindGroupLayout, denoiseJobBindGroupLayout],
    }),
    compute: {
      module: denoiseShaderModule,
      entryPoint: "denoise_main",
    },
  });

  denoiseSampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
  denoiseBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      },
    ],
  });
  const denoisePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [emptyBindGroupLayout, emptyBindGroupLayout, denoiseBindGroupLayout],
    }),
    vertex: {
      module: denoiseShaderModule,
      entryPoint: "present_vs_main",
    },
    fragment: {
      module: denoiseShaderModule,
      entryPoint: "present_fs_main",
      targets: [{ format: presentationFormat }],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },
  });

  const meshBindGroup = device.createBindGroup({
    layout: meshBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: sceneUniformBuffer } },
    ],
  });
  const spriteBindGroup = device.createBindGroup({
    layout: spriteBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: resultBuffer } },
      { binding: 1, resource: { buffer: sceneUniformBuffer } },
      { binding: 2, resource: { buffer: worklistBuffer } },
    ],
  });
  if (sceneColorView && denoiseView && denoiseHistoryView && denoiseJobBindGroupLayout) {
    denoiseJobBindGroup = device.createBindGroup({
      layout: denoiseJobBindGroupLayout,
      entries: [
        { binding: 0, resource: sceneColorView },
        { binding: 1, resource: denoiseView },
        { binding: 2, resource: denoiseHistoryView },
      ],
    });
  }
  if (denoiseView) {
    denoiseBindGroup = device.createBindGroup({
      layout: denoiseBindGroupLayout,
      entries: [
        { binding: 3, resource: denoiseView },
        { binding: 4, resource: denoiseSampler },
      ],
    });
  }

  updateLightingBindGroup = () => {
    if (!gPositionView || !gNormalView || !gAlbedoView || !lightingBindGroupLayout) {
      return;
    }
    lightingBindGroup = device.createBindGroup({
      layout: lightingBindGroupLayout,
      entries: [
        { binding: 0, resource: gPositionView },
        { binding: 1, resource: gNormalView },
        { binding: 2, resource: gAlbedoView },
        { binding: 3, resource: { buffer: sceneUniformBuffer } },
        { binding: 4, resource: { buffer: resultBuffer } },
        { binding: 5, resource: { buffer: worklistBuffer } },
      ],
    });
  };
  updateLightingBindGroup();

  const cameraPos = [0, 1.6, 4.6];
  const cameraTarget = [0, 0.7, 0];
  const cameraUp = [0, 1, 0];
  const boxCount = Math.min(sceneGeometry.boxes.length, MAX_BOXES);
  const boxMinOffset = baseUniformFloats;
  const boxMaxOffset = baseUniformFloats + MAX_BOXES * 4;

  const simParamsData = new ArrayBuffer(96);
  const simU32 = new Uint32Array(simParamsData);
  const simF32 = new Float32Array(simParamsData);
  simU32[0] = activeCount;
  simU32[1] = stepsPerFrame;
  simF32[4] = 0.016;
  simF32[5] = range;
  simF32[6] = 0.0;
  simF32[7] = sizeScale;
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

  const instances = buildInstances(instanceCount, boundsMin, boundsMax, sensor, range);
  device.queue.writeBuffer(instanceBuffer, 0, instances);
  device.queue.writeBuffer(statsBuffer, 0, new Uint32Array(statsCount));

  const queueBindGroup = device.createBindGroup({
    layout: queueLayout,
    entries: [
      { binding: 0, resource: { buffer: queueBuffer } },
      { binding: 1, resource: { buffer: slotsBuffer } },
      { binding: 2, resource: { buffer: inputJobsBuffer } },
      { binding: 3, resource: { buffer: outputJobsBuffer } },
      { binding: 4, resource: { buffer: inputPayloadBuffer } },
      { binding: 5, resource: { buffer: outputPayloadBuffer } },
      { binding: 6, resource: { buffer: queueStatusBuffer } },
      { binding: 7, resource: { buffer: paramsBuffer } },
    ],
  });

  const emptyBindGroup = device.createBindGroup({
    layout: emptyLayout,
    entries: [],
  });

  const workerBindGroup = device.createBindGroup({
    layout: workerSimLayout,
    entries: [
      { binding: 2, resource: { buffer: simParamsBuffer } },
      { binding: 4, resource: { buffer: worklistBuffer } },
    ],
  });

  const simBindGroup = device.createBindGroup({
    layout: simLayout,
    entries: [
      { binding: 0, resource: { buffer: instanceBuffer } },
      { binding: 1, resource: { buffer: resultBuffer } },
      { binding: 2, resource: { buffer: simParamsBuffer } },
      { binding: 3, resource: { buffer: statsBuffer } },
      { binding: 4, resource: { buffer: worklistBuffer } },
      { binding: 7, resource: { buffer: renderIndirectBuffer } },
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
  const workgroupCountFor = () => Math.ceil(activeJobCount / 64);
  const physicsWorkgroupCountFor = () => Math.ceil(activeCount / 64);
  const floatsPerResult = resultStride / 4;
  const statsZero = new Uint32Array(statsCount);
  let frameCounter = 0;
  let stagnantFrames = 0;
  let lastSamplePos = null;
  let lastFrameTime = performance.now();

  logLine(`Jobs dispatched per frame: ${numberFormat.format(activeJobCount)}`);
  logLine(`Results sampled per frame: ${numberFormat.format(sampleCount)}`);
  logLine("Simulation running.");

  const workerLoop = createWorkerLoop({
    device,
    label: "gpu-worker loop",
    worker: {
      pipeline: workerPipeline,
      bindGroups: [queueBindGroup, workerBindGroup],
      workgroups: () => workgroupCountFor(),
    },
    jobs: [
      {
        pipeline: physicsPipeline,
        bindGroups: [emptyBindGroup, simBindGroup],
        workgroups: () => physicsWorkgroupCountFor(),
      },
      {
        pipeline: renderIndirectPipeline,
        bindGroups: [emptyBindGroup, simBindGroup],
        workgroups: 1,
      },
    ],
  });

  const enqueueJobs = () => {
    const encoder = device.createCommandEncoder();
    const enqueueGroups = workgroupCountFor();
    for (let i = 0; i < enqueuePasses; i += 1) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(enqueuePipeline);
      pass.setBindGroup(0, queueBindGroup);
      pass.dispatchWorkgroups(enqueueGroups);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
  };

  async function renderFrame() {
    const now = performance.now();
    const timeSeconds = now / 1000;
    const deltaSeconds = Math.min(maxDeltaSeconds, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    const stepDt = deltaSeconds / stepsPerFrame;

    const aspect = canvas.width / canvas.height;
    const fovRadians = (50 * Math.PI) / 180;
    const projection = mat4Perspective(fovRadians, aspect, 0.1, 50);
    const view = mat4LookAt(cameraPos, cameraTarget, cameraUp);
    const viewProj = mat4Multiply(projection, view);
    const basis = cameraBasis(cameraPos, cameraTarget, cameraUp);
    const pixelWorldScale = (2 * Math.tan(fovRadians * 0.5)) / canvas.height;
    const flicker =
      0.85 +
      0.12 * Math.sin(timeSeconds * 6.1) +
      0.08 * Math.sin(timeSeconds * 12.4 + 1.1);
    const lightPos = [
      lightBase[0],
      lightBase[1] + Math.sin(timeSeconds * 8.0) * 0.03,
      lightBase[2],
    ];
    const lightIntensity = 0.65 * flicker;

    sceneUniformData.set(viewProj, 0);
    sceneUniformData.set([cameraPos[0], cameraPos[1], cameraPos[2], 1], 16);
    sceneUniformData.set([lightPos[0], lightPos[1], lightPos[2], lightIntensity], 20);
    sceneUniformData.set([basis.right[0], basis.right[1], basis.right[2], timeSeconds], 24);
    sceneUniformData.set([basis.up[0], basis.up[1], basis.up[2], pixelWorldScale], 28);
    sceneUniformData.set([boxCount, 0, 0, 0], 32);
    for (let i = 0; i < MAX_BOXES; i += 1) {
      const minIndex = boxMinOffset + i * 4;
      const maxIndex = boxMaxOffset + i * 4;
      if (i < boxCount) {
        const box = sceneGeometry.boxes[i];
        sceneUniformData.set([box.min[0], box.min[1], box.min[2], 0], minIndex);
        sceneUniformData.set([box.max[0], box.max[1], box.max[2], 0], maxIndex);
      } else {
        sceneUniformData.set([9999, 9999, 9999, 0], minIndex);
        sceneUniformData.set([-9999, -9999, -9999, 0], maxIndex);
      }
    }
    device.queue.writeBuffer(sceneUniformBuffer, 0, sceneUniformData);

    frameCounter += 1;

    simU32[0] = activeCount;
    simU32[1] = stepsPerFrame;
    simF32[4] = stepDt;
    simF32[6] = timeSeconds;
    simF32[7] = sizeScale;
    device.queue.writeBuffer(simParamsBuffer, 0, simParamsData);
    device.queue.writeBuffer(statsBuffer, 0, statsZero);
    device.queue.writeBuffer(worklistBuffer, 0, worklistZero);
    device.queue.writeBuffer(queueStatusBuffer, 0, statusZero);

    if (debugGpu) {
      device.pushErrorScope("validation");
    }

    enqueueJobs();
    workerLoop.tick();

    const encoder = device.createCommandEncoder();

    const gBufferPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gPositionView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
        {
          view: gNormalView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
        {
          view: gAlbedoView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    gBufferPass.setPipeline(meshPipeline);
    gBufferPass.setBindGroup(0, meshBindGroup);
    gBufferPass.setVertexBuffer(0, meshVertexBuffer);
    gBufferPass.draw(meshVertexCount, 1, 0, 0);
    gBufferPass.end();

    const lightingPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: sceneColorView,
          clearValue: { r: 0.03, g: 0.025, b: 0.02, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    lightingPass.setPipeline(lightingPipeline);
    lightingPass.setBindGroup(0, lightingBindGroup);
    lightingPass.draw(3, 1, 0, 0);
    lightingPass.end();

    const denoiseCompute = encoder.beginComputePass();
    denoiseCompute.setPipeline(denoiseJobPipeline);
    denoiseCompute.setBindGroup(2, denoiseJobBindGroup);
    const denoiseGroupsX = Math.ceil(canvas.width / 8);
    const denoiseGroupsY = Math.ceil(canvas.height / 8);
    denoiseCompute.dispatchWorkgroups(denoiseGroupsX, denoiseGroupsY);
    denoiseCompute.end();
    if (denoiseHistoryTexture) {
      encoder.copyTextureToTexture(
        { texture: denoiseTexture },
        { texture: denoiseHistoryTexture },
        [canvas.width, canvas.height],
      );
    }

    const colorView = canvasContext.getCurrentTexture().createView();
    const denoisePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.03, g: 0.025, b: 0.02, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    denoisePass.setPipeline(denoisePipeline);
    denoisePass.setBindGroup(2, denoiseBindGroup);
    denoisePass.draw(3, 1, 0, 0);
    denoisePass.end();

    const spritePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          loadOp: "load",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });
    spritePass.setPipeline(spritePipeline);
    spritePass.setBindGroup(0, spriteBindGroup);
    spritePass.drawIndirect(renderIndirectBuffer, 0);
    spritePass.end();

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

      samples.push({ pos, radius, speed, faceMask });
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

    const statsLines = [
      `Frame: ${numberFormat.format(frameCounter)} (delta ${sampleDelta.toFixed(5)})`,
      `Stagnant frames: ${numberFormat.format(stagnantFrames)}`,
      `Instances: ${numberFormat.format(activeCount)}`,
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
