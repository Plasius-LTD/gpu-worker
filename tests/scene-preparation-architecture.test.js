import { describe, test } from "node:test";

describe("scene-preparation manifest contract", () => {
  test.todo(
    "will model stable world-snapshot ingestion as a root dependency before render preparation begins"
  );
  test.todo(
    "will allow multiple chunk-local roots so unrelated regions can advance without a global barrier"
  );
  test.todo(
    "will express transform, animation, deformation, bounds, LOD, visibility, light assignment, render-proxy, and RT-preparation stages as DAG jobs"
  );
});

describe("scene-preparation unit planning", () => {
  test.todo(
    "will prioritize player-near or image-critical chunks ahead of distant work in the ready queues"
  );
  test.todo(
    "will keep join points local to chunk or representation boundaries instead of serializing the whole scene"
  );
  test.todo(
    "will reject manifests that attempt to mutate authoritative simulation state during render preparation"
  );
});
