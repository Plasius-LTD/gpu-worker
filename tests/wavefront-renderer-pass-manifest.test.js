import assert from "node:assert/strict";
import test from "node:test";

const originalImportMetaUrl = globalThis.__IMPORT_META_URL__;
globalThis.__IMPORT_META_URL__ = new URL("../src/index.js", import.meta.url);
const {
  createWavefrontRendererPassManifest,
  wavefrontRendererStageFamilies,
} = await import("../src/index.js");
if (typeof originalImportMetaUrl === "undefined") {
  delete globalThis.__IMPORT_META_URL__;
} else {
  globalThis.__IMPORT_META_URL__ = originalImportMetaUrl;
}

test("wavefront renderer manifest models BVH levels before primary rays", () => {
  const manifest = createWavefrontRendererPassManifest({
    frameId: "frame-200",
    queueClass: "render",
    tileCount: 1,
    maxDepth: 2,
    tilePixelCapacity: 256,
    triangleCount: 7,
    bvhLeafSortCapacity: 8,
    bvhSortStages: [
      { compareDistance: 1, sequenceSize: 2 },
      { compareDistance: 2, sequenceSize: 4 },
    ],
    bvhBuildLevels: [
      { start: 3, count: 3 },
      { start: 1, count: 2 },
      { start: 0, count: 1 },
    ],
  });
  const primary = manifest.jobs.find(
    (job) => job.stageFamily === "primaryRayGeneration"
  );
  const firstLevel = manifest.jobs.find(
    (job) => job.id === "frame-200:bvh:level-0"
  );
  const firstSort = manifest.jobs.find(
    (job) => job.id === "frame-200:bvh:sort-0"
  );
  const materialization = manifest.jobs.find(
    (job) => job.id === "frame-200:bvh:leafMaterialization"
  );
  const lastLevel = manifest.jobs.find(
    (job) => job.id === "frame-200:bvh:level-2"
  );

  assert.deepEqual(wavefrontRendererStageFamilies.slice(0, 6), [
    "bvhTriangleAssembly",
    "bvhLeafSort",
    "bvhLeafMaterialization",
    "bvhLevelBuild",
    "primaryRayGeneration",
    "intersection",
  ]);
  assert.deepEqual(manifest.graph.roots, ["frame-200:bvh:triangleAssembly"]);
  assert.deepEqual(firstSort.dependencies, ["frame-200:bvh:triangleAssembly"]);
  assert.deepEqual(materialization.dependencies, ["frame-200:bvh:sort-1"]);
  assert.deepEqual(firstLevel.dependencies, ["frame-200:bvh:leafMaterialization"]);
  assert.deepEqual(lastLevel.dependencies, ["frame-200:bvh:level-1"]);
  assert.deepEqual(primary.dependencies, ["frame-200:bvh:level-2"]);
  assert.equal(firstSort.workItemCount, 8);
  assert.equal(firstSort.bvhCompareDistance, 1);
  assert.equal(firstLevel.workItemCount, 3);
  assert.equal(lastLevel.bvhNodeStart, 0);
  assert.equal(manifest.graph.bvhSortStageCount, 2);
  assert.equal(manifest.graph.bvhBuildLevelCount, 3);
});

test("wavefront renderer manifest preserves breadth-first bounce dependencies", () => {
  const manifest = createWavefrontRendererPassManifest({
    frameId: "frame-201",
    tileCount: 2,
    maxDepth: 2,
    tilePixelCapacity: 128,
  });
  const intersection0 = manifest.jobs.find(
    (job) => job.id === "frame-201:tile-0:bounce-0:intersection"
  );
  const surface0 = manifest.jobs.find(
    (job) => job.id === "frame-201:tile-0:bounce-0:surfaceResolution"
  );
  const compaction0 = manifest.jobs.find(
    (job) => job.id === "frame-201:tile-0:bounce-0:compaction"
  );
  const intersection1 = manifest.jobs.find(
    (job) => job.id === "frame-201:tile-0:bounce-1:intersection"
  );
  const denoise = manifest.jobs.find((job) => job.stageFamily === "denoise");

  assert.deepEqual(intersection0.dependencies, [
    "frame-201:tile-0:primaryRayGeneration",
  ]);
  assert.deepEqual(surface0.dependencies, [intersection0.id]);
  assert.deepEqual(compaction0.dependencies, [
    "frame-201:tile-0:bounce-0:contribution",
    "frame-201:tile-0:bounce-0:continuation",
  ]);
  assert.deepEqual(intersection1.dependencies, [compaction0.id]);
  assert.equal(compaction0.localJoin, true);
  assert.deepEqual(denoise.dependencies, [
    "frame-201:tile-0:accumulation",
    "frame-201:tile-1:accumulation",
  ]);
  assert.equal(manifest.graph.queueClasses.includes("render"), true);
  assert.equal(manifest.graph.topologicalOrder.indexOf(intersection0.id) < manifest.graph.topologicalOrder.indexOf(surface0.id), true);
});

test("wavefront renderer manifest rejects cyclic pass dependencies", () => {
  assert.throws(
    () =>
      createWavefrontRendererPassManifest({
        frameId: "frame-cycle",
        tileCount: 1,
        maxDepth: 1,
        extraDependencies: {
          "frame-cycle:tile-0:primaryRayGeneration": ["frame-cycle:denoise"],
        },
      }),
    /contains a cycle/
  );
});
