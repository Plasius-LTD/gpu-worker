struct RenderParams {
  width: u32,
  height: u32,
  tile_size: u32,
  _pad0: u32,
  camera_pos: vec4<f32>,
  camera_target: vec4<f32>,
  fov_y: f32,
  aspect: f32,
  time: f32,
  _pad1: f32,
};

@group(1) @binding(0) var<storage, read_write> framebuffer: array<u32>;
@group(1) @binding(1) var<uniform> render: RenderParams;

fn hit_sphere(center: vec3<f32>, radius: f32, origin: vec3<f32>, dir: vec3<f32>) -> f32 {
  let oc = origin - center;
  let a = dot(dir, dir);
  let b = 2.0 * dot(oc, dir);
  let c = dot(oc, oc) - radius * radius;
  let disc = b * b - 4.0 * a * c;
  if (disc < 0.0) {
    return -1.0;
  }
  let sq = sqrt(disc);
  let t0 = (-b - sq) / (2.0 * a);
  if (t0 > 0.001) {
    return t0;
  }
  let t1 = (-b + sq) / (2.0 * a);
  if (t1 > 0.001) {
    return t1;
  }
  return -1.0;
}

fn background(dir: vec3<f32>) -> vec3<f32> {
  let t = 0.5 * (dir.y + 1.0);
  return mix(vec3<f32>(0.04, 0.05, 0.08), vec3<f32>(0.65, 0.78, 0.92), t);
}

fn shade_point(pos: vec3<f32>, normal: vec3<f32>, base: vec3<f32>) -> vec3<f32> {
  let light_dir = normalize(vec3<f32>(0.6 + 0.2 * sin(render.time), 0.9, 0.3));
  let diff = max(dot(normal, light_dir), 0.0);
  let ambient = 0.2;
  return base * (ambient + diff * 0.8);
}

fn pack_color(color: vec3<f32>) -> u32 {
  let c = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  let r = u32(round(c.x * 255.0));
  let g = u32(round(c.y * 255.0));
  let b = u32(round(c.z * 255.0));
  return (255u << 24) | (b << 16) | (g << 8) | r;
}

@compute @workgroup_size(64)
fn raytrace_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.job_count) {
    return;
  }

  let ok = dequeue(idx);
  if (ok == 0u) {
    return;
  }

  let job = output_jobs[idx];
  let tiles_x = (render.width + render.tile_size - 1u) / render.tile_size;
  let tile_x = job % tiles_x;
  let tile_y = job / tiles_x;
  let start_x = tile_x * render.tile_size;
  let start_y = tile_y * render.tile_size;

  let forward = normalize(render.camera_target.xyz - render.camera_pos.xyz);
  let right = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
  let up = normalize(cross(right, forward));
  let tan_half = tan(0.5 * render.fov_y);

  for (var y: u32 = 0u; y < render.tile_size; y = y + 1u) {
    let py = start_y + y;
    if (py >= render.height) {
      continue;
    }
    for (var x: u32 = 0u; x < render.tile_size; x = x + 1u) {
      let px = start_x + x;
      if (px >= render.width) {
        continue;
      }

      let u = (f32(px) + 0.5) / f32(render.width);
      let v = (f32(py) + 0.5) / f32(render.height);
      let ndc = vec2<f32>(u * 2.0 - 1.0, 1.0 - v * 2.0);
      let dir = normalize(forward + ndc.x * render.aspect * tan_half * right + ndc.y * tan_half * up);

      let origin = render.camera_pos.xyz;
      var color = background(dir);

      let t1 = hit_sphere(vec3<f32>(0.0, 1.0, 0.0), 1.0, origin, dir);
      let t2 = hit_sphere(vec3<f32>(-1.6, 0.6, -0.5), 0.6, origin, dir);
      let t3 = hit_sphere(vec3<f32>(0.0, -1000.0, 0.0), 999.0, origin, dir);

      var t_hit = -1.0;
      var base = vec3<f32>(0.0);
      var center = vec3<f32>(0.0);
      if (t1 > 0.0) {
        t_hit = t1;
        base = vec3<f32>(0.86, 0.42, 0.32);
        center = vec3<f32>(0.0, 1.0, 0.0);
      }
      if (t2 > 0.0 && (t_hit < 0.0 || t2 < t_hit)) {
        t_hit = t2;
        base = vec3<f32>(0.2, 0.7, 0.9);
        center = vec3<f32>(-1.6, 0.6, -0.5);
      }
      if (t3 > 0.0 && (t_hit < 0.0 || t3 < t_hit)) {
        t_hit = t3;
        base = vec3<f32>(0.32, 0.3, 0.26);
        center = vec3<f32>(0.0, -1000.0, 0.0);
      }

      if (t_hit > 0.0) {
        let pos = origin + t_hit * dir;
        let normal = normalize(pos - center);
        color = shade_point(pos, normal, base);
      }

      let pixel_index = py * render.width + px;
      framebuffer[pixel_index] = pack_color(color);
    }
  }
}
