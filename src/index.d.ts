export type WgslFetcher = (
  url: URL,
) => Promise<Pick<Response, "ok" | "status" | "statusText" | "text">>;

export interface WgslSourceOptions {
  wgsl?: string;
  url?: string | URL;
  fetcher?: WgslFetcher;
  baseUrl?: string | URL;
}

export type QueueMode = "flat" | "dag";

export interface QueueWgslOptions extends WgslSourceOptions {
  queueCompat?: boolean;
  queueMode?: QueueMode;
}

export interface AssembleWorkerWgslOptions {
  queueWgsl?: string;
  queueUrl?: string | URL;
  preludeWgsl?: string;
  preludeUrl?: string | URL;
  fetcher?: WgslFetcher;
  jobs?: Array<
    string | { jobType?: number; wgsl: string; label?: string; sourceName?: string }
  >;
  debug?: boolean;
  queueCompat?: boolean;
  queueMode?: QueueMode;
}

export interface LoadJobWgslOptions extends WgslSourceOptions {
  label?: string;
}

export interface WorkgroupCount {
  x: number;
  y?: number;
  z?: number;
}

export interface WorkerDispatch {
  pipeline: unknown;
  label?: string;
  owner?: string;
  queueClass?: string;
  jobType?: string;
  bindGroups?: unknown[];
  workgroups?: number[] | WorkgroupCount;
  workgroupCount?: number[] | WorkgroupCount;
  dispatch?: number[] | WorkgroupCount;
  workgroupSize?: number | number[] | WorkgroupCount;
}

export interface WorkerTelemetryDispatch {
  frameId?: string;
  kind: "worker" | "job";
  index: number;
  label: string;
  owner: string;
  queueClass: string;
  jobType: string;
  workgroups: { x: number; y: number; z: number };
  workgroupSize?: { x: number; y: number; z: number };
}

export interface WorkerTelemetryTick {
  frameId?: string;
  tickDurationMs: number;
  dispatchCount: number;
  workerDispatchCount: number;
  jobDispatchCount: number;
  dispatches: WorkerTelemetryDispatch[];
}

export interface WorkerLoopOptions {
  device: {
    createCommandEncoder(): {
      beginComputePass(options?: { label?: string }): {
        setPipeline(pipeline: unknown): void;
        setBindGroup(index: number, group: unknown): void;
        dispatchWorkgroups(x: number, y?: number, z?: number): void;
        end(): void;
      };
      finish(): unknown;
    };
    queue: { submit(commands: unknown[]): void };
  };
  worker: WorkerDispatch;
  jobs?: WorkerDispatch[];
  workgroupSize?: number;
  maxJobsPerDispatch?: number | (() => number);
  rateHz?: number;
  label?: string;
  onTick?: () => void;
  onError?: (error: unknown) => void;
  frameId?: string | (() => string);
  telemetry?: {
    onDispatch?: (sample: WorkerTelemetryDispatch) => void;
    onTick?: (sample: WorkerTelemetryTick) => void;
  };
}

export interface WorkerLoop {
  start(): void;
  stop(): void;
  tick(): void;
  readonly running: boolean;
}

export declare const workerWgslUrl: URL;
export declare function loadWorkerWgsl(
  options?: Pick<WgslSourceOptions, "url" | "fetcher">,
): Promise<string>;
export declare function loadQueueWgsl(options?: QueueWgslOptions): Promise<string>;
export declare function loadJobWgsl(options?: LoadJobWgslOptions): Promise<number>;
export declare function assembleWorkerWgsl(
  workerWgsl?: string,
  options?: AssembleWorkerWgslOptions,
): Promise<string>;
export declare function createWorkerLoop(options: WorkerLoopOptions): WorkerLoop;

export type WavefrontStageFamily =
  | "bvhTriangleAssembly"
  | "bvhLeafSort"
  | "bvhLeafMaterialization"
  | "bvhLevelBuild"
  | "primaryRayGeneration"
  | "intersection"
  | "surfaceResolution"
  | "contribution"
  | "continuation"
  | "compaction"
  | "accumulation"
  | "denoise";

export declare const wavefrontRendererStageFamilies: readonly WavefrontStageFamily[];

export interface WavefrontRendererPassManifestOptions {
  frameId: string;
  queueClass?: string;
  tileCount?: number;
  maxDepth?: number;
  tilePixelCapacity?: number;
  triangleCount?: number;
  includeBvhBuild?: boolean;
  bvhBuildLevels?: Array<{ start: number; count: number }>;
  bvhSortStages?: Array<{ compareDistance: number; sequenceSize: number }>;
  bvhLeafSortCapacity?: number;
  denoise?: boolean;
  extraDependencies?: Record<string, string[]>;
}

export interface DagJob {
  id: string;
  dependencies: readonly string[];
  dependencyCount: number;
  dependents: readonly string[];
  dependentCount: number;
  priority: number;
  root: boolean;
  localJoin: boolean;
}

export interface WavefrontRendererPassManifest {
  schemaVersion: 1;
  owner: "wavefront-renderer";
  schedulerMode: "dag";
  frameId: string;
  queueClass: string;
  tileCount: number;
  maxDepth: number;
  tilePixelCapacity: number;
  denoise: boolean;
  bvhBuildLevels: readonly { start: number; count: number }[];
  bvhSortStages: readonly { compareDistance: number; sequenceSize: number }[];
  bvhLeafSortCapacity: number;
  jobs: readonly (DagJob & {
    frameId: string;
    stageFamily: WavefrontStageFamily;
    jobType: string;
    schedulerMode: "dag";
    workItemCount: number;
    tileIndex: number | null;
    bounce: number | null;
    bvhLevelIndex: number | null;
    bvhNodeStart: number | null;
    bvhNodeCount: number | null;
    bvhSortStageIndex: number | null;
    bvhCompareDistance: number | null;
    bvhSequenceSize: number | null;
    queueClass: string;
    authority: "visual";
    mutatesSimulation: false;
  })[];
  graph: {
    schedulerMode: "dag";
    jobCount: number;
    tileCount: number;
    maxDepth: number;
    roots: readonly string[];
    topologicalOrder: readonly string[];
    priorityLanes: readonly {
      priority: number;
      jobIds: readonly string[];
      queueClasses: readonly string[];
      jobCount: number;
    }[];
    bvhBuildLevelCount: number;
    bvhSortStageCount: number;
    denoiseJobId: string | null;
    tileAccumulationJobs: readonly string[];
    queueClasses: readonly string[];
  };
}

export declare function createWavefrontRendererPassManifest(
  options: WavefrontRendererPassManifestOptions,
): WavefrontRendererPassManifest;

export type ScenePreparationRepresentationBand = "near" | "mid" | "far" | "horizon";
export type ScenePreparationStageFamily =
  | "snapshotSelection"
  | "transformPropagation"
  | "animationPose"
  | "proceduralAnimation"
  | "skinningOrDeformation"
  | "boundsUpdate"
  | "lodSelection"
  | "rtRepresentationSelection"
  | "visibility"
  | "lightAssignment"
  | "renderProxyBuild"
  | "rtInstancePreparation";

export declare const scenePreparationRepresentationBands: readonly ScenePreparationRepresentationBand[];
export declare const scenePreparationStageFamilies: readonly ScenePreparationStageFamily[];

export interface ScenePreparationChunk {
  chunkId: string;
  representationBand?: ScenePreparationRepresentationBand;
  gameplayImportance?: "low" | "medium" | "high" | "critical";
  visible?: boolean;
  playerRelevant?: boolean;
  imageCritical?: boolean;
  stages?: ScenePreparationStageFamily[];
  mutatesSimulation?: false;
}

export interface ScenePreparationManifestOptions {
  snapshotId: string;
  chunks: ScenePreparationChunk[];
}

export interface ScenePreparationManifest {
  schemaVersion: 1;
  owner: "scene-preparation";
  schedulerMode: "dag";
  snapshotId: string;
  jobs: readonly (DagJob & {
    snapshotId: string;
    chunkId: string;
    representationBand: ScenePreparationRepresentationBand;
    stageFamily: ScenePreparationStageFamily;
    authority: "visual";
    mutatesSimulation: false;
    gameplayImportance: "low" | "medium" | "high" | "critical";
    visible: boolean;
    playerRelevant: boolean;
    imageCritical: boolean;
    unresolvedDependencyCount: number;
  })[];
  graph: {
    schedulerMode: "dag";
    jobCount: number;
    chunkCount: number;
    chunkIds: readonly string[];
    representationBands: readonly ScenePreparationRepresentationBand[];
    roots: readonly string[];
    chunkRoots: Readonly<Record<string, readonly string[]>>;
    topologicalOrder: readonly string[];
    priorityLanes: readonly {
      priority: number;
      jobIds: readonly string[];
      chunkIds: readonly string[];
      jobCount: number;
    }[];
    localJoinCount: number;
    crossChunkDependencyCount: number;
  };
}

export declare function createScenePreparationManifest(
  options: ScenePreparationManifestOptions,
): ScenePreparationManifest;
