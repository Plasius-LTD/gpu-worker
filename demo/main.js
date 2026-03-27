import {
  assembleWorkerWgsl,
  createScenePreparationManifest,
  createWorkerLoop,
  loadJobWgsl,
  loadWorkerWgsl,
} from "../dist/index.js";
import { mountGpuShowcase } from "../node_modules/@plasius/gpu-shared/dist/index.js";

const root = globalThis.document?.getElementById("app");
if (!root) {
  throw new Error("Worker demo root element was not found.");
}

const NOOP_COMPUTE_WGSL = `
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  _ = gid;
}
`;

function countNonEmptyLines(source) {
  return String(source)
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0).length;
}

function createWorkerTelemetryStore() {
  const tickSamples = [];
  let totalTickCount = 0;
  let totalDispatchCount = 0;
  let lastDispatches = [];

  return {
    recordDispatch() {
      totalDispatchCount += 1;
    },
    recordTick(sample) {
      totalTickCount += 1;
      tickSamples.unshift(sample);
      if (tickSamples.length > 48) {
        tickSamples.length = 48;
      }
      lastDispatches = Array.isArray(sample?.dispatches) ? sample.dispatches.slice(0, 6) : [];
    },
    getSnapshot() {
      const lastTick = tickSamples[0] ?? null;
      const averageTickDurationMs =
        tickSamples.length > 0
          ? tickSamples.reduce((sum, sample) => sum + sample.tickDurationMs, 0) / tickSamples.length
          : 0;
      const averageDispatchesPerTick =
        tickSamples.length > 0
          ? tickSamples.reduce((sum, sample) => sum + sample.dispatchCount, 0) / tickSamples.length
          : 0;
      return {
        totalTickCount,
        totalDispatchCount,
        averageTickDurationMs,
        averageDispatchesPerTick,
        lastFrameId: lastTick?.frameId ?? null,
        lastDispatchCount: lastTick?.dispatchCount ?? 0,
        lastWorkerDispatchCount: lastTick?.workerDispatchCount ?? 0,
        lastJobDispatchCount: lastTick?.jobDispatchCount ?? 0,
        lastDispatchLabels: lastDispatches.map((sample) => sample.label),
      };
    },
  };
}

function buildStages({
  includeAnimation = true,
  includeProcedural = false,
  includeDeformation = false,
  includeRt = true,
} = {}) {
  const stages = ["snapshotSelection", "transformPropagation"];
  if (includeAnimation) {
    stages.push("animationPose");
  }
  if (includeProcedural) {
    stages.push("proceduralAnimation");
  }
  if (includeDeformation) {
    stages.push("skinningOrDeformation");
  }
  stages.push("boundsUpdate", "lodSelection");
  if (includeRt) {
    stages.push("rtRepresentationSelection");
  }
  stages.push("visibility", "lightAssignment", "renderProxyBuild", "rtInstancePreparation");
  return stages;
}

function buildScenePreparationChunks(scene) {
  const shipChunks = scene.ships.map((ship, index) => {
    const speed = Math.hypot(ship.velocity.x, ship.velocity.z);
    const shipUnderLoad = speed > 0.18 || scene.collisions > 0 || scene.stress;
    return {
      chunkId: `ship-${ship.id}`,
      representationBand: index === 0 ? "near" : "mid",
      gameplayImportance: index === 0 ? "critical" : "high",
      visible: true,
      playerRelevant: index === 0,
      imageCritical: true,
      stages: buildStages({
        includeAnimation: true,
        includeProcedural: shipUnderLoad,
        includeDeformation: scene.stress,
        includeRt: true,
      }),
    };
  });

  return [
    ...shipChunks,
    {
      chunkId: "wake-field",
      representationBand: "near",
      gameplayImportance: scene.collisions > 0 ? "high" : "medium",
      visible: true,
      playerRelevant: true,
      imageCritical: scene.collisions > 0,
      stages: buildStages({
        includeAnimation: false,
        includeProcedural: true,
        includeDeformation: false,
        includeRt: scene.stress || scene.collisions > 0,
      }),
    },
    {
      chunkId: "flag-and-rigging",
      representationBand: "mid",
      gameplayImportance: "medium",
      visible: true,
      playerRelevant: false,
      imageCritical: true,
      stages: buildStages({
        includeAnimation: true,
        includeProcedural: true,
        includeDeformation: true,
        includeRt: scene.stress,
      }),
    },
    {
      chunkId: "lantern-field",
      representationBand: "near",
      gameplayImportance: "high",
      visible: true,
      playerRelevant: false,
      imageCritical: true,
      stages: buildStages({
        includeAnimation: false,
        includeProcedural: scene.stress,
        includeDeformation: false,
        includeRt: true,
      }),
    },
    {
      chunkId: "harbor-architecture",
      representationBand: "far",
      gameplayImportance: "medium",
      visible: true,
      playerRelevant: false,
      imageCritical: false,
      stages: buildStages({
        includeAnimation: false,
        includeProcedural: false,
        includeDeformation: false,
        includeRt: true,
      }),
    },
    {
      chunkId: "moon-horizon",
      representationBand: "horizon",
      gameplayImportance: "medium",
      visible: true,
      playerRelevant: false,
      imageCritical: true,
      stages: buildStages({
        includeAnimation: false,
        includeProcedural: false,
        includeDeformation: false,
        includeRt: true,
      }),
    },
  ];
}

function resolveManifest(state, scene) {
  const nextSnapshotId = `scene-prep-${scene.frame}`;
  if (state.manifest?.snapshotId === nextSnapshotId) {
    return state.manifest;
  }

  state.manifest = createScenePreparationManifest({
    snapshotId: nextSnapshotId,
    chunks: buildScenePreparationChunks(scene),
  });
  return state.manifest;
}

async function createComputePipeline(device, code) {
  const module = device.createShaderModule({ code });
  if (typeof device.createComputePipelineAsync === "function") {
    return device.createComputePipelineAsync({
      layout: "auto",
      compute: {
        module,
        entryPoint: "main",
      },
    });
  }

  return device.createComputePipeline({
    layout: "auto",
    compute: {
      module,
      entryPoint: "main",
    },
  });
}

function createState() {
  return {
    secureContext: window.isSecureContext,
    webGpuAvailable: Boolean(globalThis.navigator?.gpu),
    initStarted: false,
    initStatus: "Assembling scene-preparation worker",
    initError: null,
    manifest: null,
    dispatchBudget: 48,
    telemetry: createWorkerTelemetryStore(),
    assembly: {
      workerLines: 0,
      assembledLines: 0,
      assembledBytes: 0,
      jobTypes: [],
    },
    runtime: {
      workerDescriptor: null,
      jobDescriptors: [],
      loop: null,
      device: null,
    },
  };
}

function syncRuntimeDescriptors(state, scene) {
  const runtime = state.runtime;
  const manifest = state.manifest;
  if (!runtime?.workerDescriptor || !Array.isArray(runtime.jobDescriptors) || !manifest) {
    return;
  }

  runtime.workerDescriptor.label = scene.stress
    ? "scene-preparation worker · cinematic"
    : "scene-preparation worker · living painting";
  runtime.workerDescriptor.jobType = scene.stress
    ? "scene.prepare.cinematic"
    : "scene.prepare.living-painting";

  const jobsById = new Map(manifest.jobs.map((job) => [job.id, job]));
  const orderedJobs = manifest.graph.topologicalOrder
    .slice(0, runtime.jobDescriptors.length)
    .map((jobId) => jobsById.get(jobId) ?? null);

  runtime.jobDescriptors.forEach((descriptor, index) => {
    const job = orderedJobs[index];
    if (!job) {
      descriptor.label = `scene-prep-idle-${index + 1}`;
      descriptor.jobType = `scene.prepare.idle.${index + 1}`;
      descriptor.workgroups = [1, 1, 1];
      return;
    }
    descriptor.label = `${job.chunkId}:${job.stageFamily}`;
    descriptor.jobType = `${job.representationBand}.${job.stageFamily}`.slice(0, 120);
    descriptor.workgroups = [Math.max(1, Math.min(4, Math.ceil(job.priority / 180))), 1, 1];
  });
}

async function initializeWorkerState(state) {
  const workerSource = await loadWorkerWgsl();
  const jobTypes = await Promise.all([
    loadJobWgsl({
      url: new URL("./jobs/physics.job.wgsl", import.meta.url),
      label: "physics.job",
    }),
    loadJobWgsl({
      url: new URL("./jobs/render.job.wgsl", import.meta.url),
      label: "render.job",
    }),
    loadJobWgsl({
      url: new URL("./jobs/denoise.wgsl", import.meta.url),
      label: "denoise.job",
    }),
  ]);
  const assembledSource = await assembleWorkerWgsl(workerSource, {
    preludeUrl: new URL("./jobs/common.wgsl", import.meta.url),
    queueMode: "dag",
    debug: true,
  });

  state.assembly = {
    workerLines: countNonEmptyLines(workerSource),
    assembledLines: countNonEmptyLines(assembledSource),
    assembledBytes: assembledSource.length,
    jobTypes,
  };

  if (!state.webGpuAvailable) {
    state.initStatus = "Manifest live · WebGPU unavailable";
    return;
  }
  if (!state.secureContext) {
    state.initStatus = "Manifest live · secure context required for GPU dispatch";
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    state.initStatus = "Manifest live · no compatible GPU adapter";
    return;
  }

  const device = await adapter.requestDevice();
  const pipeline = await createComputePipeline(device, NOOP_COMPUTE_WGSL);
  const workerDescriptor = {
    pipeline,
    label: "scene-preparation worker · living painting",
    owner: "scene-preparation",
    queueClass: "dag",
    jobType: "scene.prepare.living-painting",
    workgroupSize: [64, 1, 1],
  };
  const jobDescriptors = Array.from({ length: 3 }, (_, index) => ({
    pipeline,
    label: `scene-prep-stage-${index + 1}`,
    owner: "scene-preparation",
    queueClass: "dag",
    jobType: `scene.prepare.stage.${index + 1}`,
    workgroupSize: [64, 1, 1],
    workgroups: [1, 1, 1],
  }));

  const loop = createWorkerLoop({
    device,
    worker: workerDescriptor,
    jobs: jobDescriptors,
    workgroupSize: 64,
    maxJobsPerDispatch: () => state.dispatchBudget,
    rateHz: 4,
    label: "gpu-worker demo loop",
    frameId: () => state.manifest?.snapshotId ?? "scene-prep-boot",
    telemetry: {
      onDispatch() {
        state.telemetry.recordDispatch();
      },
      onTick(sample) {
        state.telemetry.recordTick(sample);
      },
    },
    onError(error) {
      state.initError = error instanceof Error ? error.message : String(error);
      state.initStatus = "Worker loop faulted";
    },
  });

  state.runtime = {
    workerDescriptor,
    jobDescriptors,
    loop,
    device,
  };
  loop.start();
  state.initStatus = "Worker loop live";
}

function ensureWorkerState(state, scene) {
  resolveManifest(state, scene);
  if (state.initStarted) {
    syncRuntimeDescriptors(state, scene);
    return;
  }

  state.initStarted = true;
  syncRuntimeDescriptors(state, scene);
  void initializeWorkerState(state)
    .then(() => {
      syncRuntimeDescriptors(state, scene);
    })
    .catch((error) => {
      state.initError = error instanceof Error ? error.message : String(error);
      state.initStatus = "Worker assembly failed";
    });
}

function updateState(state, scene) {
  const manifest = resolveManifest(state, scene);
  state.dispatchBudget = Math.max(32, manifest.graph.jobCount * (scene.stress ? 2 : 1));
  ensureWorkerState(state, scene);
  syncRuntimeDescriptors(state, scene);
  return state;
}

function describeState(state, scene) {
  ensureWorkerState(state, scene);

  const manifest = resolveManifest(state, scene);
  const telemetry = state.telemetry.getSnapshot();
  const topLane = manifest.graph.priorityLanes[0] ?? null;
  const status = state.initError
    ? `Worker assembly failed · ${state.initError}`
    : state.runtime.loop?.running
      ? `Worker loop live · ${manifest.graph.jobCount} DAG jobs · ${telemetry.totalTickCount} ticks`
      : state.initStatus;

  const details = state.initError
    ? "The harbor remains visible, but gpu-worker could not finish its WGSL assembly or GPU loop bootstrap."
    : state.runtime.loop?.running
      ? "The harbor scene-preparation DAG is rebuilt from live ship, wake, lantern, and horizon chunks while gpu-worker runs a real dispatch loop whose labels mirror the top stages in the current manifest."
      : "The harbor is already using a live scene-preparation manifest; gpu-worker is still finishing WGSL assembly or waiting on WebGPU before it starts its live loop.";

  return {
    status,
    details,
    sceneMetrics: [
      `chunks: ${manifest.graph.chunkCount}`,
      `jobs: ${manifest.graph.jobCount}`,
      `roots: ${manifest.graph.roots.length}`,
      `priority lanes: ${manifest.graph.priorityLanes.length}`,
      `cross-chunk deps: ${manifest.graph.crossChunkDependencyCount}`,
    ],
    qualityMetrics: [
      `worker WGSL lines: ${state.assembly.workerLines}`,
      `assembled WGSL lines: ${state.assembly.assembledLines}`,
      `assembled source: ${(state.assembly.assembledBytes / 1024).toFixed(1)} KB`,
      `registered jobs: ${state.assembly.jobTypes.length}`,
      `dispatch budget: ${state.dispatchBudget}`,
    ],
    debugMetrics: [
      `total ticks: ${telemetry.totalTickCount}`,
      `total dispatches: ${telemetry.totalDispatchCount}`,
      `avg tick: ${telemetry.averageTickDurationMs.toFixed(2)} ms`,
      `avg dispatches/tick: ${telemetry.averageDispatchesPerTick.toFixed(2)}`,
      `lead lane: ${topLane ? `${topLane.priority} (${topLane.jobCount} jobs)` : "pending"}`,
    ],
    notes: [
      "gpu-worker now uses the same moonlit harbor as the rest of the family instead of a separate particle-lab scene.",
      "The demo exercises gpu-worker public APIs directly: createScenePreparationManifest, loadWorkerWgsl, loadJobWgsl, assembleWorkerWgsl, and createWorkerLoop.",
      "Ship hulls, wakes, lanterns, and the moon horizon are all converted into a live scene-preparation DAG so the worker metrics now describe the painterly harbor instead of an unrelated benchmark.",
    ],
    textState: {
      snapshotId: manifest.snapshotId,
      graph: manifest.graph,
      assembly: state.assembly,
      telemetry,
      sampleJobs: manifest.jobs.slice(0, 8).map((job) => ({
        id: job.id,
        priority: job.priority,
        stageFamily: job.stageFamily,
      })),
    },
    visuals: {
      waveAmplitude: scene.stress ? 1.02 : 0.9,
      wakeStrength: scene.stress ? 0.42 : 0.34,
      lanternReflectionStrength: state.runtime.loop?.running ? 0.6 : 0.46,
      reflectionStrength: state.runtime.loop?.running ? 0.24 : 0.16,
      shadowAccent: scene.stress ? 0.13 : 0.08,
      ambientMist: scene.stress ? "rgba(61, 80, 119, 0.22)" : "rgba(44, 64, 99, 0.17)",
      moonHalo: scene.stress ? "rgba(192, 208, 255, 0.3)" : "rgba(168, 188, 242, 0.24)",
      waterNear: scene.stress ? { r: 0.1, g: 0.27, b: 0.38 } : { r: 0.08, g: 0.24, b: 0.34 },
      waterFar: { r: 0.18, g: 0.36, b: 0.49 },
      collisionFlash: "rgba(255, 206, 152, 0.18)",
    },
  };
}

function destroyState(state) {
  if (state?.runtime?.loop && typeof state.runtime.loop.stop === "function") {
    state.runtime.loop.stop();
  }
  if (state?.runtime?.device && typeof state.runtime.device.destroy === "function") {
    state.runtime.device.destroy();
  }
}

const showcase = await mountGpuShowcase({
  root,
  focus: "debug",
  packageName: "@plasius/gpu-worker",
  title: "Scene-Preparation Worker Harbor",
  subtitle:
    "Moonlit harbor staging driven by gpu-worker DAG manifests, assembled WGSL jobs, and a live compute dispatch loop that tracks the painterly scene.",
  createState,
  updateState,
  describeState,
  destroyState,
});

window.addEventListener("pagehide", () => showcase.destroy(), { once: true });
