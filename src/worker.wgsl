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

@compute @workgroup_size(64)
fn simulate_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.job_count) {
    return;
  }

  let ok = dequeue(idx);
  if (ok == 0u) {
    return;
  }

  let job = output_jobs[idx];
  if (job >= sim.count) {
    return;
  }

  var inst = instances[job];
  var pos = inst.pos.xyz;
  var vel = inst.vel.xyz;
  let half = inst.half.xyz;
  var face_mask: u32 = 0u;
  var body_hits: u32 = 0u;
  let self_radius = length(half);

  for (var step: u32 = 0u; step < sim.steps; step = step + 1u) {
    pos = pos + vel * sim.dt;
    let bounce = apply_bounds(pos, vel, half);
    pos = bounce.pos;
    vel = bounce.vel;
    face_mask = face_mask | bounce.mask;

    if (sim.count <= COLLISION_BRUTE_FORCE_MAX) {
      for (var other_idx: u32 = 0u; other_idx < sim.count; other_idx = other_idx + 1u) {
        if (other_idx == job) {
          continue;
        }
        let other = instances[other_idx];
        let other_pos = other.pos.xyz;
        let other_vel = other.vel.xyz;
        let other_radius = length(other.half.xyz);
        let delta = pos - other_pos;
        let dist_sq = dot(delta, delta);
        let min_dist = self_radius + other_radius;

        if (dist_sq < min_dist * min_dist && dist_sq > COLLISION_EPSILON) {
          let dist = sqrt(dist_sq);
          let normal = delta / dist;
          let overlap = min_dist - dist;
          pos = pos + normal * (overlap * COLLISION_PUSH);
          let rel_vel = vel - other_vel;
          let approach = dot(rel_vel, normal);
          if (approach < 0.0) {
            vel = vel - normal * (approach * (1.0 + COLLISION_RESTITUTION)) * 0.5;
          }
          body_hits = body_hits + 1u;
        }
      }
    } else {
      let step_seed = job ^ (step * 0x9e3779b9u);
      for (var sample: u32 = 0u; sample < COLLISION_SAMPLES; sample = sample + 1u) {
        let neighbor = neighbor_index(
          step_seed,
          sample * 0x85ebca6bu + 0x27d4eb2du,
          sim.count,
        );
        if (neighbor == job) {
          continue;
        }

        let other = instances[neighbor];
        let other_pos = other.pos.xyz;
        let other_vel = other.vel.xyz;
        let other_radius = length(other.half.xyz);
        let delta = pos - other_pos;
        let dist_sq = dot(delta, delta);
        let min_dist = self_radius + other_radius;

        if (dist_sq < min_dist * min_dist && dist_sq > COLLISION_EPSILON) {
          let dist = sqrt(dist_sq);
          let normal = delta / dist;
          let overlap = min_dist - dist;
          pos = pos + normal * (overlap * COLLISION_PUSH);
          let rel_vel = vel - other_vel;
          let approach = dot(rel_vel, normal);
          if (approach < 0.0) {
            vel = vel - normal * (approach * (1.0 + COLLISION_RESTITUTION)) * 0.5;
          }
          body_hits = body_hits + 1u;
        }
      }
    }

    let bounce2 = apply_bounds(pos, vel, half);
    pos = bounce2.pos;
    vel = bounce2.vel;
    face_mask = face_mask | bounce2.mask;
  }

  let aabb_min = pos - half;
  let aabb_max = pos + half;
  let radius = length(half);
  let dist = length(pos - sim.sensor.xyz);
  var in_range: f32 = 0.0;
  if (dist <= sim.range + radius) {
    in_range = 1.0;
  }
  let speed = length(vel);

  let boundary_mask = face_mask;
  let face_hits = countOneBits(boundary_mask);
  if (in_range > 0.0) {
    atomicAdd(&stats[STAT_IN_RANGE], 1u);
  }
  if (face_hits > 0u) {
    atomicAdd(&stats[STAT_FACE_CONTACTS], face_hits);
  }
  if ((boundary_mask & 1u) != 0u) {
    atomicAdd(&stats[STAT_FACE_X_NEG], 1u);
  }
  if ((boundary_mask & 2u) != 0u) {
    atomicAdd(&stats[STAT_FACE_X_POS], 1u);
  }
  if ((boundary_mask & 4u) != 0u) {
    atomicAdd(&stats[STAT_FACE_Y_NEG], 1u);
  }
  if ((boundary_mask & 8u) != 0u) {
    atomicAdd(&stats[STAT_FACE_Y_POS], 1u);
  }
  if ((boundary_mask & 16u) != 0u) {
    atomicAdd(&stats[STAT_FACE_Z_NEG], 1u);
  }
  if ((boundary_mask & 32u) != 0u) {
    atomicAdd(&stats[STAT_FACE_Z_POS], 1u);
  }
  if (body_hits > 0u) {
    atomicAdd(&stats[STAT_BODY_CONTACTS], body_hits);
    face_mask = boundary_mask | BODY_CONTACT_FLAG;
  }

  inst.pos = vec4<f32>(pos, 1.0);
  inst.vel = vec4<f32>(vel, 0.0);
  instances[job] = inst;

  results[job].aabb_min = vec4<f32>(aabb_min, 0.0);
  results[job].aabb_max = vec4<f32>(aabb_max, 0.0);
  results[job].sphere = vec4<f32>(pos, radius);
  results[job].metrics = vec4<f32>(dist, speed, in_range, f32(face_mask));
  status[job] = 0u;
}
