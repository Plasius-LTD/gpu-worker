import {
  assembleWorkerWgsl,
  createScenePreparationManifest,
  createWavefrontRendererPassManifest,
  createWorkerLoop,
  loadJobWgsl,
  loadQueueWgsl,
  loadWorkerWgsl,
  scenePreparationStageFamilies,
  wavefrontRendererStageFamilies,
  type WorkerLoopOptions,
} from "@plasius/gpu-worker";

const fetcher = async (url: URL) => {
  const response = await fetch(url);
  return response;
};

void loadWorkerWgsl({ fetcher });
void loadQueueWgsl({ queueMode: "dag", queueCompat: false, fetcher });
void loadJobWgsl({ wgsl: "fn process_job() {}", label: "physics" });
void assembleWorkerWgsl("fn main() {}", {
  jobs: [{ jobType: 1, wgsl: "fn process_job() {}", label: "physics" }],
  queueMode: "flat",
});

const loopOptions: WorkerLoopOptions = {
  device: {} as WorkerLoopOptions["device"],
  worker: { pipeline: {}, workgroups: [1, 1, 1] },
  telemetry: {
    onDispatch(sample) {
      sample.workgroups.x.toFixed();
    },
  },
};
const loop = createWorkerLoop(loopOptions);
loop.start();
loop.stop();

const wavefront = createWavefrontRendererPassManifest({
  frameId: "frame-1",
  bvhBuildLevels: [{ start: 0, count: 1 }],
  bvhSortStages: [{ compareDistance: 1, sequenceSize: 2 }],
  extraDependencies: {},
});
wavefront.jobs[0]?.stageFamily satisfies (typeof wavefrontRendererStageFamilies)[number];
wavefront.graph.priorityLanes[0]?.queueClasses[0]?.toUpperCase();

const scene = createScenePreparationManifest({
  snapshotId: "snapshot-1",
  chunks: [{ chunkId: "chunk-1", stages: ["snapshotSelection", "visibility"] }],
});
scene.jobs[0]?.stageFamily satisfies (typeof scenePreparationStageFamilies)[number];
scene.graph.priorityLanes[0]?.chunkIds[0]?.toUpperCase();

// @ts-expect-error Queue mode is a public, constrained API value.
void loadQueueWgsl({ queueMode: "queue" });
void createScenePreparationManifest({
  snapshotId: "snapshot-1",
  chunks: [
    {
      chunkId: "chunk-1",
      // @ts-expect-error Scene jobs cannot mutate authoritative simulation state.
      mutatesSimulation: true,
    },
  ],
});
