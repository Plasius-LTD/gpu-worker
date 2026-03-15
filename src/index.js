import {
  loadSchedulerWgsl as loadSchedulerWgslRaw,
  schedulerModes as workerSchedulerModes,
} from "@plasius/gpu-lock-free-queue";

export const workerWgslUrl = (() => {
  if (typeof __IMPORT_META_URL__ !== "undefined") {
    return new URL("./worker.wgsl", __IMPORT_META_URL__);
  }
  if (typeof __filename !== "undefined" && typeof require !== "undefined") {
    const { pathToFileURL } = require("node:url");
    return new URL("./worker.wgsl", pathToFileURL(__filename));
  }
  const base =
    typeof process !== "undefined" && process.cwd
      ? `file://${process.cwd()}/`
      : "file:///";
  return new URL("./worker.wgsl", base);
})();

const jobRegistry = [];
let nextJobType = 0;

async function loadWgslSource(options = {}) {
  const { wgsl, url, fetcher = globalThis.fetch, baseUrl } = options ?? {};
  if (typeof wgsl === "string") {
    assertNotHtmlWgsl(wgsl, "inline WGSL");
    return wgsl;
  }
  if (!url) {
    return null;
  }
  const resolved = url instanceof URL ? url : new URL(url, baseUrl);
  if (!fetcher) {
    if (resolved.protocol !== "file:") {
      throw new Error("No fetcher available for non-file WGSL URL.");
    }
    const { readFile } = await import("fs/promises");
    const { fileURLToPath } = await import("url");
    const source = await readFile(fileURLToPath(resolved), "utf8");
    assertNotHtmlWgsl(source, resolved.href);
    return source;
  }
  const response = await fetcher(resolved);
  if (!response.ok) {
    const status = "status" in response ? response.status : "unknown";
    const statusText = "statusText" in response ? response.statusText : "";
    const detail = statusText ? `${status} ${statusText}` : `${status}`;
    throw new Error(`Failed to load WGSL (${detail})`);
  }
  const source = await response.text();
  assertNotHtmlWgsl(source, resolved.href);
  return source;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function tokenize(source) {
  return source.match(/[A-Za-z_][A-Za-z0-9_]*|[{}();<>,:=]/g) ?? [];
}

function isIdentifier(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(token);
}

function readNameAfterType(tokens, startIndex) {
  let i = startIndex;
  if (tokens[i] === "<") {
    let depth = 1;
    i += 1;
    while (i < tokens.length && depth > 0) {
      if (tokens[i] === "<") {
        depth += 1;
      } else if (tokens[i] === ">") {
        depth -= 1;
      }
      i += 1;
    }
  }
  return tokens[i];
}

function scanModuleNames(source) {
  const cleaned = stripComments(source);
  const tokens = tokenize(cleaned);
  const names = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "{") {
      depth += 1;
      continue;
    }
    if (token === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    if (token === "fn") {
      const name = tokens[i + 1];
      if (isIdentifier(name)) {
        names.push({ kind: "fn", name });
      }
      continue;
    }
    if (token === "struct") {
      const name = tokens[i + 1];
      if (isIdentifier(name)) {
        names.push({ kind: "struct", name });
      }
      continue;
    }
    if (token === "alias") {
      const name = tokens[i + 1];
      if (isIdentifier(name)) {
        names.push({ kind: "alias", name });
      }
      continue;
    }
    if (token === "var" || token === "let" || token === "const" || token === "override") {
      const name = readNameAfterType(tokens, i + 1);
      if (isIdentifier(name)) {
        names.push({ kind: token, name });
      }
    }
  }
  return names;
}

function buildNameIndex(modules) {
  const index = new Map();
  for (const module of modules) {
    for (const item of scanModuleNames(module.source)) {
      const bucket = index.get(item.name) ?? [];
      bucket.push({ kind: item.kind, module: module.name });
      index.set(item.name, bucket);
    }
  }
  return index;
}

function assertNoNameClashes(modules) {
  const index = buildNameIndex(modules);
  const clashes = [];
  for (const [name, entries] of index.entries()) {
    if (entries.length > 1) {
      clashes.push({ name, entries });
    }
  }
  if (clashes.length === 0) {
    return;
  }
  const lines = ["WGSL debug: identifier clashes detected:"];
  for (const clash of clashes) {
    const locations = clash.entries
      .map((entry) => `${entry.module} (${entry.kind})`)
      .join(", ");
    lines.push(`- ${clash.name}: ${locations}`);
  }
  throw new Error(lines.join("\n"));
}

function assertNotHtmlWgsl(source, context) {
  const sample = source.slice(0, 200).toLowerCase();
  if (
    sample.includes("<!doctype") ||
    sample.includes("<html") ||
    sample.includes("<meta")
  ) {
    const label = context ? ` for ${context}` : "";
    throw new Error(
      `Expected WGSL${label} but received HTML. Check the URL or server root.`
    );
  }
}

function renameProcessJob(source, name) {
  return source.replace(/\bprocess_job\b/g, name);
}

function getQueueCompatMap(source) {
  if (!/\bJobMeta\b/.test(source)) {
    return null;
  }
  return [{ from: /\bJobMeta\b/g, to: "JobDesc" }];
}

function normalizeQueueMode(mode) {
  const resolved = mode ?? "flat";
  if (!workerSchedulerModes.includes(resolved)) {
    throw new Error(
      `queueMode must be one of: ${workerSchedulerModes.join(", ")}.`
    );
  }
  return resolved;
}

function applyCompatMap(source, map) {
  if (!map || map.length === 0) {
    return source;
  }
  let next = source;
  for (const entry of map) {
    next = next.replace(entry.from, entry.to);
  }
  return next;
}

function normalizeJobs(jobs) {
  const normalized = jobs.map((job, index) => {
    if (typeof job === "string") {
      return {
        jobType: index,
        wgsl: job,
        label: `job_${index}`,
        sourceName: `job-${index}`,
      };
    }
    if (!job || typeof job.wgsl !== "string") {
      throw new Error("Job entries must provide WGSL source strings.");
    }
    const jobType = job.jobType ?? index;
    const label = job.label ?? `job_${jobType}`;
    return {
      jobType,
      wgsl: job.wgsl,
      label,
      sourceName: job.sourceName ?? job.label ?? `job-${jobType}`,
    };
  });
  const seen = new Set();
  for (const job of normalized) {
    if (seen.has(job.jobType)) {
      throw new Error(`Duplicate job_type detected: ${job.jobType}`);
    }
    seen.add(job.jobType);
  }
  return normalized;
}

function buildProcessJobDispatch(jobs) {
  const lines = [
    "fn process_job(job_index: u32, job_type: u32, payload_words: u32) {",
  ];
  if (jobs.length === 0) {
    lines.push("  return;");
    lines.push("}");
    return lines.join("\n");
  }
  jobs.forEach((job, idx) => {
    const clause = idx === 0 ? "if" : "else if";
    lines.push(`  ${clause} (job_type == ${job.jobType}u) {`);
    lines.push(
      `    ${job.entryName}(job_index, job_type, payload_words);`
    );
    lines.push("  }");
  });
  lines.push("}");
  return lines.join("\n");
}

export async function loadWorkerWgsl(options = {}) {
  const { url = workerWgslUrl, fetcher } = options ?? {};
  const source = await loadWgslSource({
    url,
    fetcher,
    baseUrl: workerWgslUrl,
  });
  if (typeof source !== "string") {
    throw new Error("Failed to load worker WGSL source.");
  }
  return source;
}

export async function loadQueueWgsl(options = {}) {
  const { queueCompat = true, queueMode = "flat", ...rest } = options ?? {};
  const source = await loadSchedulerWgslRaw({
    mode: normalizeQueueMode(queueMode),
    ...rest,
  });
  if (typeof source !== "string") {
    throw new Error("Failed to load queue WGSL source.");
  }
  assertNotHtmlWgsl(source, rest?.url ? String(rest.url) : "queue WGSL");
  if (!queueCompat) {
    return source;
  }
  const compatMap = getQueueCompatMap(source);
  return applyCompatMap(source, compatMap);
}

function ensureQueueLifecycleHooks(source) {
  if (/\bfn\s+complete_job\b/.test(source)) {
    return source;
  }
  return `${source}\n\nfn complete_job(job_index: u32) {\n  _ = job_index;\n}`;
}

export async function loadJobWgsl(options = {}) {
  const { wgsl, url, fetcher, label } = options ?? {};
  const source = await loadWgslSource({
    wgsl,
    url,
    fetcher,
    baseUrl: workerWgslUrl,
  });
  if (typeof source !== "string") {
    throw new Error("loadJobWgsl requires a WGSL string or URL.");
  }
  const jobType = nextJobType;
  nextJobType += 1;
  jobRegistry.push({
    jobType,
    wgsl: source,
    label: label ?? `job_${jobType}`,
    sourceName: label ?? `job-${jobType}`,
  });
  return jobType;
}

export async function assembleWorkerWgsl(workerWgsl, options = {}) {
  const {
    queueWgsl,
    queueUrl,
    preludeWgsl,
    preludeUrl,
    fetcher,
    jobs,
    debug,
    queueCompat = true,
    queueMode = "flat",
  } = options ?? {};
  const resolvedQueueMode = normalizeQueueMode(queueMode);
  const rawQueueSource =
    queueWgsl ??
    (await loadSchedulerWgslRaw({
      mode: resolvedQueueMode,
      url: queueUrl,
      fetcher,
    }));
  const bodyRaw = workerWgsl ?? (await loadWorkerWgsl({ fetcher }));
  const compatMap = queueCompat ? getQueueCompatMap(rawQueueSource) : null;
  const queueSource = ensureQueueLifecycleHooks(
    applyCompatMap(rawQueueSource, compatMap)
  );
  const preludeRaw =
    preludeWgsl ??
    (preludeUrl
      ? await loadWgslSource({ url: preludeUrl, fetcher, baseUrl: workerWgslUrl })
      : "");
  if ((preludeWgsl || preludeUrl) && typeof preludeRaw !== "string") {
    throw new Error("Failed to load prelude WGSL source.");
  }
  const preludeSource =
    typeof preludeRaw === "string" && preludeRaw.length > 0
      ? applyCompatMap(preludeRaw, compatMap)
      : "";
  const body = applyCompatMap(bodyRaw, compatMap);
  const jobList = normalizeJobs(
    typeof jobs === "undefined" ? jobRegistry : jobs
  );
  if (!jobList || jobList.length === 0) {
    return `${queueSource}\n\n${body}`;
  }
  const rewrittenJobs = jobList.map((job) => {
    const source = applyCompatMap(job.wgsl, compatMap);
    const hasProcessJob = /\bfn\s+process_job\b/.test(source);
    if (!hasProcessJob) {
      throw new Error(
        `Job ${job.sourceName} is missing a process_job() entry function.`
      );
    }
    const entryName = `process_job__${job.jobType}`;
    const renamed = renameProcessJob(source, entryName);
    return { ...job, entryName, wgsl: renamed };
  });
  const dispatch = buildProcessJobDispatch(rewrittenJobs);
  const modulesForDebug = debug
    ? [
        { name: "queue.wgsl", source: queueSource },
        ...(preludeSource
          ? [{ name: "jobs.prelude.wgsl", source: preludeSource }]
          : []),
        ...rewrittenJobs.map((job) => ({
          name: job.sourceName,
          source: job.wgsl,
        })),
        { name: "jobs.dispatch.wgsl", source: dispatch },
        { name: "worker.wgsl", source: body },
      ]
    : null;
  if (modulesForDebug) {
    assertNoNameClashes(modulesForDebug);
  }
  const jobBlocks = rewrittenJobs
    .map((job) => `// Job ${job.jobType}: ${job.label}\n${job.wgsl}`)
    .join("\n\n");
  const preludeBlock = preludeSource ? `${preludeSource}\n\n` : "";
  return `${queueSource}\n\n${preludeBlock}${jobBlocks}\n\n${dispatch}\n\n${body}`;
}

function normalizeWorkgroups(value, label) {
  if (typeof value === "number") {
    return [value, 1, 1];
  }
  if (Array.isArray(value)) {
    const [x = 0, y = 1, z = 1] = value;
    return [x, y, z];
  }
  throw new Error(`Invalid workgroup count for ${label}.`);
}

function resolveWorkgroups(value, label) {
  if (typeof value === "function") {
    return normalizeWorkgroups(value(), label);
  }
  if (value == null) {
    return null;
  }
  return normalizeWorkgroups(value, label);
}

function normalizeTelemetryText(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : fallback;
}

function resolveFrameId(value) {
  if (typeof value === "function") {
    return resolveFrameId(value());
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

function toVector(workgroups) {
  return { x: workgroups[0], y: workgroups[1], z: workgroups[2] };
}

function resolveTelemetryWorkgroupSize(descriptor, fallback, label) {
  const size =
    descriptor?.workgroupSize == null ? fallback : descriptor.workgroupSize;
  if (size == null) {
    return undefined;
  }
  const normalized =
    typeof size === "number" ? normalizeWorkgroups(size, label) : resolveWorkgroups(size, label);
  if (!normalized) {
    return undefined;
  }
  return toVector(normalized);
}

function getNow() {
  if (globalThis.performance && typeof globalThis.performance.now === "function") {
    return globalThis.performance.now();
  }
  return Date.now();
}

function reportOptionalError(error, onError) {
  if (!onError) {
    return;
  }
  if (error instanceof Error) {
    onError(error);
    return;
  }
  onError(new Error(String(error)));
}

function emitOptionalHook(callback, payload, onError) {
  if (typeof callback !== "function") {
    return;
  }
  try {
    callback(payload);
  } catch (error) {
    reportOptionalError(error, onError);
  }
}

function buildDispatchTelemetrySample({
  kind,
  descriptor,
  index,
  frameId,
  workgroups,
  workgroupSize,
}) {
  const labelFallback = kind === "worker" ? "worker" : `job_${index}`;
  const label = normalizeTelemetryText(descriptor?.label, labelFallback);
  return {
    kind,
    index,
    label,
    owner: normalizeTelemetryText(descriptor?.owner, label),
    queueClass: normalizeTelemetryText(descriptor?.queueClass, "custom"),
    jobType: normalizeTelemetryText(
      descriptor?.jobType,
      kind === "worker" ? "worker.dispatch" : label
    ),
    frameId,
    workgroups: toVector(workgroups),
    workgroupSize,
  };
}

function setBindGroups(pass, bindGroups) {
  if (!bindGroups) {
    return;
  }
  bindGroups.forEach((group, index) => {
    if (group) {
      pass.setBindGroup(index, group);
    }
  });
}

function computeWorkerWorkgroups(maxJobs, workgroupSize) {
  const jobs =
    typeof maxJobs === "function" ? Number(maxJobs()) : Number(maxJobs);
  if (!Number.isFinite(jobs) || jobs <= 0) {
    throw new Error("maxJobsPerDispatch must be a positive number.");
  }
  const size = Number(workgroupSize);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("workgroupSize must be a positive number.");
  }
  return Math.max(1, Math.ceil(jobs / size));
}

export function createWorkerLoop(options = {}) {
  const {
    device,
    worker,
    jobs = [],
    workgroupSize = 64,
    maxJobsPerDispatch,
    rateHz,
    label,
    onTick,
    onError,
    frameId,
    telemetry,
  } = options ?? {};

  if (!device) {
    throw new Error("createWorkerLoop requires a GPUDevice.");
  }
  if (!worker || !worker.pipeline) {
    throw new Error("createWorkerLoop requires a worker pipeline.");
  }

  let running = false;
  let handle = null;
  let usingRaf = false;
  const intervalMs =
    Number.isFinite(rateHz) && rateHz > 0 ? 1000 / rateHz : null;

  const tick = () => {
    try {
      const tickStartMs = getNow();
      const currentFrameId = resolveFrameId(frameId);
      const telemetryDispatches = [];
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass(
        label ? { label } : undefined
      );

      pass.setPipeline(worker.pipeline);
      setBindGroups(pass, worker.bindGroups);

      const explicitWorkerGroups =
        resolveWorkgroups(worker.workgroups, "worker") ??
        resolveWorkgroups(worker.workgroupCount, "worker") ??
        resolveWorkgroups(worker.dispatch, "worker");

      const workerGroups = explicitWorkerGroups
        ? explicitWorkerGroups
        : [computeWorkerWorkgroups(maxJobsPerDispatch, workgroupSize), 1, 1];

      if (workerGroups[0] > 0) {
        pass.dispatchWorkgroups(...workerGroups);
        telemetryDispatches.push(
          buildDispatchTelemetrySample({
            kind: "worker",
            descriptor: worker,
            index: 0,
            frameId: currentFrameId,
            workgroups: workerGroups,
            workgroupSize: resolveTelemetryWorkgroupSize(
              worker,
              workgroupSize,
              "worker workgroupSize"
            ),
          })
        );
      }

      jobs.forEach((job, index) => {
        if (!job || !job.pipeline) {
          throw new Error(`Job pipeline missing at index ${index}.`);
        }
        pass.setPipeline(job.pipeline);
        setBindGroups(pass, job.bindGroups);
        const groups = resolveWorkgroups(
          job.workgroups ?? job.workgroupCount ?? job.dispatch,
          `job ${index}`
        );
        if (!groups) {
          throw new Error(`Job ${index} requires a workgroup count.`);
        }
        if (groups[0] > 0) {
          pass.dispatchWorkgroups(...groups);
          telemetryDispatches.push(
            buildDispatchTelemetrySample({
              kind: "job",
              descriptor: job,
              index,
              frameId: currentFrameId,
              workgroups: groups,
              workgroupSize: resolveTelemetryWorkgroupSize(
                job,
                undefined,
                `job ${index} workgroupSize`
              ),
            })
          );
        }
      });

      pass.end();
      device.queue.submit([encoder.finish()]);

      telemetryDispatches.forEach((sample) => {
        emitOptionalHook(telemetry?.onDispatch, sample, onError);
      });
      emitOptionalHook(
        telemetry?.onTick,
        {
          frameId: currentFrameId,
          tickDurationMs: getNow() - tickStartMs,
          dispatchCount: telemetryDispatches.length,
          workerDispatchCount: telemetryDispatches.filter(
            (sample) => sample.kind === "worker"
          ).length,
          jobDispatchCount: telemetryDispatches.filter(
            (sample) => sample.kind === "job"
          ).length,
          dispatches: telemetryDispatches,
        },
        onError
      );

      if (onTick) {
        onTick();
      }
    } catch (err) {
      if (onError) {
        onError(err);
        return;
      }
      throw err;
    }
  };

  const scheduleNext = () => {
    if (!running) {
      return;
    }
    if (intervalMs != null) {
      tick();
      usingRaf = false;
      handle = setTimeout(scheduleNext, intervalMs);
      return;
    }
    tick();
    if (typeof requestAnimationFrame === "function") {
      usingRaf = true;
      handle = requestAnimationFrame(scheduleNext);
    } else {
      usingRaf = false;
      handle = setTimeout(scheduleNext, 0);
    }
  };

  const start = () => {
    if (running) {
      return;
    }
    running = true;
    scheduleNext();
  };

  const stop = () => {
    running = false;
    if (handle == null) {
      return;
    }
    if (usingRaf && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle);
    } else {
      clearTimeout(handle);
    }
    handle = null;
  };

  return {
    start,
    stop,
    tick,
    get running() {
      return running;
    },
  };
}

export const scenePreparationRepresentationBands = Object.freeze([
  "near",
  "mid",
  "far",
  "horizon",
]);

export const scenePreparationStageFamilies = Object.freeze([
  "snapshotSelection",
  "transformPropagation",
  "animationPose",
  "proceduralAnimation",
  "skinningOrDeformation",
  "boundsUpdate",
  "lodSelection",
  "rtRepresentationSelection",
  "visibility",
  "lightAssignment",
  "renderProxyBuild",
  "rtInstancePreparation",
]);

const scenePreparationDefaultStageDependencies = Object.freeze({
  snapshotSelection: Object.freeze([]),
  transformPropagation: Object.freeze(["snapshotSelection"]),
  animationPose: Object.freeze(["transformPropagation"]),
  proceduralAnimation: Object.freeze(["animationPose"]),
  skinningOrDeformation: Object.freeze([
    "animationPose",
    "proceduralAnimation",
  ]),
  boundsUpdate: Object.freeze(["skinningOrDeformation"]),
  lodSelection: Object.freeze(["boundsUpdate"]),
  rtRepresentationSelection: Object.freeze(["lodSelection"]),
  visibility: Object.freeze(["boundsUpdate", "lodSelection"]),
  lightAssignment: Object.freeze(["visibility"]),
  renderProxyBuild: Object.freeze(["visibility", "lodSelection"]),
  rtInstancePreparation: Object.freeze([
    "visibility",
    "rtRepresentationSelection",
  ]),
});

const scenePreparationBandPriorityWeights = Object.freeze({
  near: 400,
  mid: 300,
  far: 200,
  horizon: 100,
});

const scenePreparationImportanceWeights = Object.freeze({
  low: 0,
  medium: 15,
  high: 30,
  critical: 60,
});

const scenePreparationStagePriorityWeights = Object.freeze({
  snapshotSelection: 60,
  transformPropagation: 54,
  animationPose: 50,
  proceduralAnimation: 46,
  skinningOrDeformation: 42,
  boundsUpdate: 38,
  lodSelection: 32,
  rtRepresentationSelection: 28,
  visibility: 34,
  lightAssignment: 24,
  renderProxyBuild: 22,
  rtInstancePreparation: 26,
});

function assertScenePreparationIdentifier(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function assertScenePreparationEnum(name, value, allowed) {
  const normalized = assertScenePreparationIdentifier(name, value);
  if (!allowed.includes(normalized)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return normalized;
}

function normalizeScenePreparationStages(stages, chunkLabel) {
  const requested =
    stages === undefined ? scenePreparationStageFamilies : stages;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error(`${chunkLabel}.stages must be a non-empty array when provided.`);
  }

  const normalized = [...new Set(
    requested.map((stage, index) =>
      assertScenePreparationEnum(
        `${chunkLabel}.stages[${index}]`,
        stage,
        scenePreparationStageFamilies
      )
    )
  )];

  return normalized.sort(
    (left, right) =>
      scenePreparationStageFamilies.indexOf(left) -
      scenePreparationStageFamilies.indexOf(right)
  );
}

function collectScenePreparationDependencies(
  stageFamily,
  includedStages,
  seen = new Set()
) {
  const dependencies =
    scenePreparationDefaultStageDependencies[stageFamily] ?? [];
  for (const dependency of dependencies) {
    if (includedStages.has(dependency)) {
      seen.add(dependency);
      continue;
    }
    collectScenePreparationDependencies(dependency, includedStages, seen);
  }
  return [...seen].sort(
    (left, right) =>
      scenePreparationStageFamilies.indexOf(left) -
      scenePreparationStageFamilies.indexOf(right)
  );
}

function buildScenePreparationPriority(chunk, stageFamily) {
  const bandWeight =
    scenePreparationBandPriorityWeights[chunk.representationBand] ?? 0;
  const importanceWeight =
    scenePreparationImportanceWeights[chunk.gameplayImportance] ?? 0;
  const stageWeight =
    scenePreparationStagePriorityWeights[stageFamily] ?? 0;

  return (
    bandWeight +
    importanceWeight +
    stageWeight +
    (chunk.visible ? 20 : 0) +
    (chunk.playerRelevant ? 20 : 0) +
    (chunk.imageCritical ? 15 : 0)
  );
}

function buildScenePreparationPriorityLanes(jobs) {
  const lanes = new Map();
  for (const job of jobs) {
    const lane = lanes.get(job.priority) ?? {
      priority: job.priority,
      jobIds: [],
      chunkIds: [],
    };
    lane.jobIds.push(job.id);
    if (!lane.chunkIds.includes(job.chunkId)) {
      lane.chunkIds.push(job.chunkId);
    }
    lanes.set(job.priority, lane);
  }

  return Object.freeze(
    [...lanes.values()]
      .sort((left, right) => right.priority - left.priority)
      .map((lane) =>
        Object.freeze({
          priority: lane.priority,
          jobIds: Object.freeze([...lane.jobIds]),
          chunkIds: Object.freeze([...lane.chunkIds]),
          jobCount: lane.jobIds.length,
        })
      )
  );
}

function buildScenePreparationTopologicalOrder(jobs) {
  const indegree = new Map(jobs.map((job) => [job.id, job.dependencies.length]));
  const dependentsById = new Map(jobs.map((job) => [job.id, []]));

  for (const job of jobs) {
    for (const dependency of job.dependencies) {
      dependentsById.get(dependency)?.push(job.id);
    }
  }

  const queue = jobs
    .filter((job) => job.dependencies.length === 0)
    .sort((left, right) => right.priority - left.priority)
    .map((job) => job.id);
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const order = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) {
      continue;
    }
    order.push(currentId);
    const unlocked = [];
    for (const dependentId of dependentsById.get(currentId) ?? []) {
      const next = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, next);
      if (next === 0) {
        unlocked.push(dependentId);
      }
    }
    unlocked
      .sort(
        (left, right) =>
          (jobById.get(right)?.priority ?? 0) -
          (jobById.get(left)?.priority ?? 0)
      )
      .forEach((jobId) => {
        queue.push(jobId);
      });
  }

  if (order.length !== jobs.length) {
    throw new Error("Scene-preparation manifest contains a cycle.");
  }

  return Object.freeze(order);
}

export function createScenePreparationManifest(options = {}) {
  const snapshotId = assertScenePreparationIdentifier(
    "snapshotId",
    options.snapshotId
  );
  const chunkEntries = Array.isArray(options.chunks) ? options.chunks : [];
  if (chunkEntries.length === 0) {
    throw new Error("createScenePreparationManifest requires at least one chunk.");
  }

  const normalizedChunks = chunkEntries.map((chunk, index) => {
    if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) {
      throw new Error(`chunks[${index}] must be an object.`);
    }
    const chunkLabel = `chunks[${index}]`;
    if (chunk.mutatesSimulation === true) {
      throw new Error(
        `${chunkLabel}.mutatesSimulation cannot be true for render preparation.`
      );
    }

    return Object.freeze({
      chunkId: assertScenePreparationIdentifier(`${chunkLabel}.chunkId`, chunk.chunkId),
      representationBand: assertScenePreparationEnum(
        `${chunkLabel}.representationBand`,
        chunk.representationBand ?? "mid",
        scenePreparationRepresentationBands
      ),
      gameplayImportance: assertScenePreparationEnum(
        `${chunkLabel}.gameplayImportance`,
        chunk.gameplayImportance ?? "medium",
        Object.keys(scenePreparationImportanceWeights)
      ),
      visible: chunk.visible !== false,
      playerRelevant: chunk.playerRelevant === true,
      imageCritical: chunk.imageCritical === true,
      stages: normalizeScenePreparationStages(chunk.stages, chunkLabel),
    });
  });

  const chunkIds = new Set();
  for (const chunk of normalizedChunks) {
    if (chunkIds.has(chunk.chunkId)) {
      throw new Error(`Duplicate scene-preparation chunk id detected: ${chunk.chunkId}`);
    }
    chunkIds.add(chunk.chunkId);
  }

  const jobs = [];
  for (const chunk of normalizedChunks) {
    const includedStages = new Set(chunk.stages);
    for (const stageFamily of chunk.stages) {
      const dependencies = collectScenePreparationDependencies(
        stageFamily,
        includedStages
      ).map(
        (dependency) =>
          `${snapshotId}:${chunk.chunkId}:${chunk.representationBand}:${dependency}`
      );

      jobs.push(
        Object.freeze({
          id: `${snapshotId}:${chunk.chunkId}:${chunk.representationBand}:${stageFamily}`,
          snapshotId,
          chunkId: chunk.chunkId,
          representationBand: chunk.representationBand,
          stageFamily,
          priority: buildScenePreparationPriority(chunk, stageFamily),
          dependencies: Object.freeze(dependencies),
          dependencyCount: dependencies.length,
          root: dependencies.length === 0,
          authority: "visual",
          mutatesSimulation: false,
          gameplayImportance: chunk.gameplayImportance,
          visible: chunk.visible,
          playerRelevant: chunk.playerRelevant,
          imageCritical: chunk.imageCritical,
        })
      );
    }
  }

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  let crossChunkDependencyCount = 0;
  let localJoinCount = 0;

  const finalizedJobs = Object.freeze(
    jobs.map((job) => {
      const dependents = jobs
        .filter((candidate) => candidate.dependencies.includes(job.id))
        .map((candidate) => candidate.id);
      const crossChunkDependencies = job.dependencies.filter((dependency) => {
        const parent = jobById.get(dependency);
        return parent && parent.chunkId !== job.chunkId;
      });
      crossChunkDependencyCount += crossChunkDependencies.length;
      if (
        job.dependencies.length > 1 &&
        crossChunkDependencies.length === 0
      ) {
        localJoinCount += 1;
      }

      return Object.freeze({
        ...job,
        dependents: Object.freeze(dependents),
        dependentCount: dependents.length,
        unresolvedDependencyCount: job.dependencies.length,
        localJoin:
          job.dependencies.length > 1 && crossChunkDependencies.length === 0,
      });
    })
  );

  const graph = Object.freeze({
    schedulerMode: "dag",
    jobCount: finalizedJobs.length,
    chunkCount: normalizedChunks.length,
    chunkIds: Object.freeze(normalizedChunks.map((chunk) => chunk.chunkId)),
    representationBands: Object.freeze(
      [...new Set(normalizedChunks.map((chunk) => chunk.representationBand))]
    ),
    roots: Object.freeze(
      finalizedJobs.filter((job) => job.root).map((job) => job.id)
    ),
    chunkRoots: Object.freeze(
      Object.fromEntries(
        normalizedChunks.map((chunk) => [
          chunk.chunkId,
          finalizedJobs
            .filter((job) => job.chunkId === chunk.chunkId && job.root)
            .map((job) => job.id),
        ])
      )
    ),
    topologicalOrder: buildScenePreparationTopologicalOrder(finalizedJobs),
    priorityLanes: buildScenePreparationPriorityLanes(finalizedJobs),
    localJoinCount,
    crossChunkDependencyCount,
  });

  return Object.freeze({
    schemaVersion: 1,
    owner: "scene-preparation",
    schedulerMode: "dag",
    snapshotId,
    jobs: finalizedJobs,
    graph,
  });
}
