// Shared WGSL definitions for demo jobs.

struct SimParams {
  count: u32,
  steps: u32,
  _pad0: vec2<u32>,
  dt: f32,
  range: f32,
  _pad1: vec2<f32>,
  bounds_min: vec4<f32>,
  bounds_max: vec4<f32>,
  sensor: vec4<f32>,
};

struct Instance {
  pos: vec4<f32>,
  half: vec4<f32>,
  vel: vec4<f32>,
};

struct Result {
  aabb_min: vec4<f32>,
  aabb_max: vec4<f32>,
  sphere: vec4<f32>,
  metrics: vec4<f32>,
};

struct BounceResult {
  pos: vec3<f32>,
  vel: vec3<f32>,
  mask: u32,
};

@group(1) @binding(0) var<storage, read_write> instances: array<Instance>;
@group(1) @binding(1) var<storage, read_write> results: array<Result>;
@group(1) @binding(2) var<uniform> sim: SimParams;
@group(1) @binding(3) var<storage, read_write> stats: array<atomic<u32>>;
@group(1) @binding(4) var<storage, read_write> worklist: array<atomic<u32>>;
@group(1) @binding(7) var<storage, read_write> render_indirect: array<u32>;

const STAT_IN_RANGE: u32 = 0u;
const STAT_FACE_CONTACTS: u32 = 1u;
const STAT_FACE_X_NEG: u32 = 2u;
const STAT_FACE_X_POS: u32 = 3u;
const STAT_FACE_Y_NEG: u32 = 4u;
const STAT_FACE_Y_POS: u32 = 5u;
const STAT_FACE_Z_NEG: u32 = 6u;
const STAT_FACE_Z_POS: u32 = 7u;
const STAT_BODY_CONTACTS: u32 = 8u;

const BODY_CONTACT_FLAG: u32 = 64u;
const COLLISION_SAMPLES: u32 = 24u;
const COLLISION_BRUTE_FORCE_MAX: u32 = 2048u;
const COLLISION_RESTITUTION: f32 = 0.65;
const COLLISION_PUSH: f32 = 0.5;
const COLLISION_EPSILON: f32 = 1e-5;
const TWO_PI: f32 = 6.2831853;
const GRAVITY: vec3<f32> = vec3<f32>(0.0, -3.4, 0.0);
const DRAG: f32 = 0.972;
const SPAWN_SPEED_MIN: f32 = 0.65;
const EMIT_LATERAL_MIN: f32 = 0.1;
const EMIT_LATERAL_MAX: f32 = 0.4;
const EMIT_UP_MIN: f32 = 2.6;
const EMIT_UP_MAX: f32 = 5.4;
const LIFE_MIN: f32 = 1.6;
const LIFE_MAX: f32 = 4.6;

fn worklist_max_count() -> u32 {
  let len = arrayLength(&worklist);
  if (len <= 2u) {
    return 0u;
  }
  return (len - 2u) / 2u;
}

fn worklist_render_offset(max_count: u32) -> u32 {
  return 2u + max_count;
}

fn apply_bounds(pos: vec3<f32>, vel: vec3<f32>, half: vec3<f32>) -> BounceResult {
  let min_bound = sim.bounds_min.xyz + half;
  let max_bound = sim.bounds_max.xyz - half;
  var p = pos;
  var v = vel;
  var mask: u32 = 0u;

  if (p.x < min_bound.x) {
    p.x = min_bound.x;
    v.x = abs(v.x);
    mask = mask | 1u;
  }
  if (p.x > max_bound.x) {
    p.x = max_bound.x;
    v.x = -abs(v.x);
    mask = mask | 2u;
  }
  if (p.y < min_bound.y) {
    p.y = min_bound.y;
    v.y = abs(v.y);
    mask = mask | 4u;
  }
  if (p.y > max_bound.y) {
    p.y = max_bound.y;
    v.y = -abs(v.y);
    mask = mask | 8u;
  }
  if (p.z < min_bound.z) {
    p.z = min_bound.z;
    v.z = abs(v.z);
    mask = mask | 16u;
  }
  if (p.z > max_bound.z) {
    p.z = max_bound.z;
    v.z = -abs(v.z);
    mask = mask | 32u;
  }

  return BounceResult(p, v, mask);
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

fn neighbor_index(seed: u32, salt: u32, count: u32) -> u32 {
  return hash_u32(seed ^ salt) % count;
}

fn rand01(seed: u32) -> f32 {
  let v = hash_u32(seed) & 0x00ffffffu;
  return f32(v) / 16777216.0;
}

fn noise3(p: vec3<f32>, time: f32) -> vec3<f32> {
  let n1 = sin(dot(p, vec3<f32>(12.9898, 78.233, 37.719)) + time * 1.3);
  let n2 = sin(dot(p, vec3<f32>(45.164, 12.345, 98.321)) + time * 1.7);
  let n3 = sin(dot(p, vec3<f32>(67.891, 25.173, 11.975)) + time * 2.1);
  return vec3<f32>(n1, n2, n3);
}

struct SpawnState {
  pos: vec3<f32>,
  vel: vec3<f32>,
  life: f32,
};

fn spawn_particle(seed: u32, half: vec3<f32>) -> SpawnState {
  let r1 = rand01(seed);
  let r2 = rand01(seed ^ 0x9e3779b9u);
  let r3 = rand01(seed ^ 0x85ebca6bu);
  let r4 = rand01(seed ^ 0xc2b2ae35u);
  let r5 = rand01(seed ^ 0x27d4eb2du);
  let angle = r1 * TWO_PI;
  let radius = sim.range * sqrt(r2);
  let offset = vec3<f32>(cos(angle), 0.0, sin(angle)) * radius;
  let base = vec3<f32>(sim.sensor.x, sim.bounds_min.y + half.y + 0.02, sim.sensor.z);
  var lateral = EMIT_LATERAL_MIN + (EMIT_LATERAL_MAX - EMIT_LATERAL_MIN) * r2;
  var up = EMIT_UP_MIN + (EMIT_UP_MAX - EMIT_UP_MIN) * r3;
  if (r4 > 0.96) {
    lateral = lateral * (1.6 + r4);
    up = up * (1.35 + r4 * 0.4);
  }
  let vel = vec3<f32>(cos(angle) * lateral, up, sin(angle) * lateral);
  let life = LIFE_MIN + (LIFE_MAX - LIFE_MIN) * r5;
  return SpawnState(base + offset, vel, life);
}
