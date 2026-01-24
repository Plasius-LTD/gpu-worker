// Physics job: enqueue particle indices and integrate motion.

fn process_job(job_index: u32, job_type: u32, payload_words: u32) {
  if (payload_words == 0u) {
    return;
  }
  let job = payload_word(job_index, 0u);
  if (job >= sim.count) {
    return;
  }

  let max_count = worklist_max_count();
  if (max_count == 0u) {
    return;
  }

  let dst = atomicAdd(&worklist[0], 1u);
  if (dst < max_count) {
    atomicStore(&worklist[2u + dst], job);
  }
}

@compute @workgroup_size(64)
fn physics_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let max_count = worklist_max_count();
  let job_count = min(atomicLoad(&worklist[0]), max_count);
  if (idx >= job_count) {
    return;
  }
  let job = atomicLoad(&worklist[2u + idx]);
  if (job >= sim.count) {
    return;
  }

  var inst = instances[job];
  var pos = inst.pos.xyz;
  var vel = inst.vel.xyz;
  let base_half = inst.half.xyz;
  let half = base_half * sim._pad1.y;
  var age = inst.vel.w;
  var lifetime = inst.half.w;
  var face_mask: u32 = 0u;
  var body_hits: u32 = 0u;
  let self_radius = length(half);
  if (lifetime <= 0.0) {
    lifetime = LIFE_MIN;
  }
  if (pos.y < sim.bounds_min.y - 1.0) {
    let spawn = spawn_particle(job ^ 0x9e3779b9u, half);
    pos = spawn.pos;
    vel = spawn.vel;
    age = 0.0;
    lifetime = spawn.life;
    face_mask = 0u;
    body_hits = 0u;
  }

  for (var step: u32 = 0u; step < sim.steps; step = step + 1u) {
    var local_density: f32 = 0.0;
    age = age + sim.dt;
    if (age >= lifetime) {
      let spawn = spawn_particle(job ^ ((step + 3u) * 0x9e3779b9u), half);
      pos = spawn.pos;
      vel = spawn.vel;
      age = 0.0;
      lifetime = spawn.life;
      face_mask = 0u;
      body_hits = 0u;
    }
    vel = vel + GRAVITY * sim.dt;
    vel = vel * DRAG;
    pos = pos + vel * sim.dt;
    let bounce = apply_bounds(pos, vel, half);
    pos = bounce.pos;
    vel = bounce.vel;
    face_mask = face_mask | bounce.mask;
    if ((bounce.mask & 4u) != 0u) {
      let speed_now = length(vel);
      if (speed_now < SPAWN_SPEED_MIN) {
        let spawn = spawn_particle(job ^ ((step + 1u) * 0x9e3779b9u), half);
        pos = spawn.pos;
        vel = spawn.vel;
        face_mask = 0u;
        age = 0.0;
        lifetime = spawn.life;
      } else {
        vel = vec3<f32>(vel.x * 0.45, abs(vel.y) * 0.35, vel.z * 0.45);
      }
    }

    if (COLLISION_SAMPLES > 0u) {
      let influence = sim.range * 0.6;
      let influence_sq = influence * influence;
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
          if (dist_sq < influence_sq) {
            local_density = local_density + 1.0;
          }

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
          if (dist_sq < influence_sq) {
            local_density = local_density + 1.0;
          }

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
    }

    let time = sim._pad1.x;
    let rel = pos - sim.sensor.xyz;
    let dist = length(rel);
    let plume = exp(-dist * dist / max(sim.range * sim.range * 2.0, 0.0001));
    let density = clamp(local_density * 0.08, 0.0, 1.0);
    let tangent = normalize(vec3<f32>(-rel.z, 0.0, rel.x) + vec3<f32>(0.001, 0.0, 0.001));
    let gust = noise3(pos * 0.75 + vec3<f32>(0.0, time * 0.35, 0.0), time);
    let swirl = tangent * plume * (0.7 + density * 1.0);
    let updraft = vec3<f32>(0.0, 1.0, 0.0) * plume * (1.0 + density * 1.4);
    let drift = gust * 0.35;
    vel = vel + (updraft + swirl + drift) * sim.dt;

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
  inst.vel = vec4<f32>(vel, age);
  inst.half = vec4<f32>(base_half, lifetime);
  instances[job] = inst;

  results[job].aabb_min = vec4<f32>(aabb_min, 0.0);
  results[job].aabb_max = vec4<f32>(aabb_max, 0.0);
  results[job].sphere = vec4<f32>(pos, radius);
  results[job].metrics = vec4<f32>(dist, speed, in_range, f32(face_mask));
}
