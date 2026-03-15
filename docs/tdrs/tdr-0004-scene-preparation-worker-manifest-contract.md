# TDR-0004: Scene Preparation Worker Manifest Contract

## Status

Accepted

## Goal

Define the worker-manifest contract that renderer and world packages will use
for snapshot-driven scene preparation before implementation starts.

## Required Contract Shape

Scene-preparation manifests should be able to describe:

- the snapshot identifier or world-state epoch being consumed
- the chunk, cluster, or region the work belongs to
- the representation band being prepared:
  - `near`
  - `mid`
  - `far`
  - `horizon`
- the preparation stage family:
  - `snapshotSelection`
  - `transformPropagation`
  - `animationPose`
  - `proceduralAnimation`
  - `skinningOrDeformation`
  - `boundsUpdate`
  - `lodSelection`
  - `rtRepresentationSelection`
  - `visibility`
  - `lightAssignment`
  - `renderProxyBuild`
  - `rtInstancePreparation`
- DAG dependencies between those stage families
- priority cues derived from distance, visibility, and gameplay importance

## Scheduling Rules

- roots should correspond to work that can begin once a stable snapshot exists
- joins should remain local to stage transitions such as:
  - pose + procedural layers -> skinning
  - geometry LOD + bounds -> visibility
  - visibility + representation selection -> render or RT proxy generation
- manifests should avoid package-wide barriers when only chunk-local joins are
  required

## Planned Tests

Contract tests should prove that:

- manifests can express multiple independent chunk roots
- stage families can join without global serialization
- player-near chunks can outrank distant chunks on the same queue class

Unit tests should prove that:

- snapshot ids remain stable across all jobs in the same preparation batch
- representation-band metadata survives manifest normalization
- stage ordering rejects invalid cycles such as proxy generation preceding
  bounds or visibility inputs

## Implementation Notes

The initial public helper now ships as
`createScenePreparationManifest(...)` in `@plasius/gpu-worker`. It models
snapshot selection as the root stage for each chunk, preserves chunk-local DAG
joins, publishes priority lanes for ready-queue planning, and rejects
authoritative simulation mutation during render preparation.
