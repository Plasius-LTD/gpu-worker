import assert from "node:assert/strict";
import test from "node:test";

const originalImportMetaUrl = globalThis.__IMPORT_META_URL__;
globalThis.__IMPORT_META_URL__ = new URL("../src/index.js", import.meta.url);
const {
  createScenePreparationManifest,
  scenePreparationRepresentationBands,
  scenePreparationStageFamilies,
} = await import("../src/index.js");
if (typeof originalImportMetaUrl === "undefined") {
  delete globalThis.__IMPORT_META_URL__;
} else {
  globalThis.__IMPORT_META_URL__ = originalImportMetaUrl;
}

test("scene-preparation manifests model stable snapshot selection as the root stage", () => {
  const manifest = createScenePreparationManifest({
    snapshotId: "snapshot-144",
    chunks: [
      {
        chunkId: "chunk-near-0",
        representationBand: "near",
        gameplayImportance: "critical",
        visible: true,
        playerRelevant: true,
      },
    ],
  });

  const snapshotSelection = manifest.jobs.find(
    (job) => job.stageFamily === "snapshotSelection"
  );
  const transformPropagation = manifest.jobs.find(
    (job) => job.stageFamily === "transformPropagation"
  );

  assert.equal(snapshotSelection.snapshotId, "snapshot-144");
  assert.equal(snapshotSelection.root, true);
  assert.deepEqual(snapshotSelection.dependencies, []);
  assert.deepEqual(transformPropagation.dependencies, [snapshotSelection.id]);
  assert.deepEqual(manifest.graph.roots, [snapshotSelection.id]);
});

test("scene-preparation manifests allow multiple chunk-local roots and the full stage DAG", () => {
  const manifest = createScenePreparationManifest({
    snapshotId: "snapshot-145",
    chunks: [
      {
        chunkId: "chunk-near-0",
        representationBand: "near",
        gameplayImportance: "critical",
        visible: true,
      },
      {
        chunkId: "chunk-far-9",
        representationBand: "far",
        gameplayImportance: "medium",
        visible: false,
      },
    ],
  });

  assert.deepEqual(scenePreparationRepresentationBands, [
    "near",
    "mid",
    "far",
    "horizon",
  ]);
  assert.deepEqual(
    manifest.jobs
      .filter((job) => job.chunkId === "chunk-near-0")
      .map((job) => job.stageFamily),
    [...scenePreparationStageFamilies]
  );
  assert.deepEqual(
    manifest.graph.chunkRoots,
    {
      "chunk-near-0": ["snapshot-145:chunk-near-0:near:snapshotSelection"],
      "chunk-far-9": ["snapshot-145:chunk-far-9:far:snapshotSelection"],
    }
  );
  assert.equal(manifest.graph.crossChunkDependencyCount, 0);
  assert.ok(
    manifest.graph.topologicalOrder.indexOf(
      "snapshot-145:chunk-near-0:near:snapshotSelection"
    ) <
      manifest.graph.topologicalOrder.indexOf(
        "snapshot-145:chunk-near-0:near:rtInstancePreparation"
      )
  );
});

test("scene-preparation manifests prioritize player-near work and keep joins local", () => {
  const manifest = createScenePreparationManifest({
    snapshotId: "snapshot-146",
    chunks: [
      {
        chunkId: "chunk-near-0",
        representationBand: "near",
        gameplayImportance: "critical",
        visible: true,
        playerRelevant: true,
        imageCritical: true,
      },
      {
        chunkId: "chunk-horizon-3",
        representationBand: "horizon",
        gameplayImportance: "medium",
        visible: false,
      },
    ],
  });

  const nearVisibility = manifest.jobs.find(
    (job) =>
      job.chunkId === "chunk-near-0" && job.stageFamily === "visibility"
  );
  const horizonVisibility = manifest.jobs.find(
    (job) =>
      job.chunkId === "chunk-horizon-3" && job.stageFamily === "visibility"
  );
  const rtInstancePreparation = manifest.jobs.find(
    (job) =>
      job.chunkId === "chunk-near-0" &&
      job.stageFamily === "rtInstancePreparation"
  );

  assert.ok(nearVisibility.priority > horizonVisibility.priority);
  assert.equal(manifest.graph.priorityLanes[0].chunkIds.includes("chunk-near-0"), true);
  assert.equal(rtInstancePreparation.localJoin, true);
  assert.equal(manifest.graph.localJoinCount > 0, true);
});

test("scene-preparation manifests reject attempts to mutate authoritative simulation state", () => {
  assert.throws(
    () =>
      createScenePreparationManifest({
        snapshotId: "snapshot-147",
        chunks: [
          {
            chunkId: "chunk-bad-0",
            representationBand: "near",
            mutatesSimulation: true,
          },
        ],
      }),
    /mutatesSimulation cannot be true/
  );
});
