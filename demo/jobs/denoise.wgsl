// Denoise job + present pass WGSL.

fn process_job(job_index: u32, job_type: u32, payload_words: u32) {
  // Denoise is dispatched explicitly as a compute job.
}

@group(2) @binding(0) var sceneTex: texture_2d<f32>;
@group(2) @binding(1) var denoiseOut: texture_storage_2d<rgba16float, write>;
@group(2) @binding(2) var historyTex: texture_2d<f32>;
@group(2) @binding(3) var denoiseTex: texture_2d<f32>;
@group(2) @binding(4) var denoiseSampler: sampler;

fn luma(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8)
fn denoise_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(sceneTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  let coord = vec2<i32>(gid.xy);
  let center = textureLoad(sceneTex, coord, 0).rgb;
  let lumaCenter = luma(center);
  var sum = vec3<f32>(0.0);
  var wsum = 0.0;
  let maxCoord = vec2<i32>(i32(dims.x) - 1, i32(dims.y) - 1);
  for (var y: i32 = -1; y <= 1; y = y + 1) {
    for (var x: i32 = -1; x <= 1; x = x + 1) {
      let offset = vec2<i32>(x, y);
      let sampleCoord = clamp(coord + offset, vec2<i32>(0, 0), maxCoord);
      let sample = textureLoad(sceneTex, sampleCoord, 0).rgb;
      let lumaSample = luma(sample);
      let dist2 = f32(x * x + y * y);
      let spatial = exp(-dist2 * 0.9);
      let range = exp(-abs(lumaSample - lumaCenter) * 14.0);
      let weight = spatial * range;
      sum = sum + sample * weight;
      wsum = wsum + weight;
    }
  }
  let color = sum / max(wsum, 1e-5);
  let history = textureLoad(historyTex, coord, 0);
  var blended = color;
  if (history.a > 0.001) {
    let mixRate = 0.12;
    blended = mix(history.rgb, color, mixRate);
  }
  textureStore(denoiseOut, coord, vec4<f32>(blended, 1.0));
}

struct PresentOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn present_vs_main(@builtin(vertex_index) vid: u32) -> PresentOut {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let uv = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(2.0, 0.0),
    vec2<f32>(0.0, 2.0)
  );
  var out: PresentOut;
  out.position = vec4<f32>(pos[vid], 0.0, 1.0);
  out.uv = uv[vid];
  return out;
}

@fragment
fn present_fs_main(input: PresentOut) -> @location(0) vec4<f32> {
  let uv = vec2<f32>(input.uv.x, 1.0 - input.uv.y);
  let color = textureSample(denoiseTex, denoiseSampler, uv).rgb;
  return vec4<f32>(color, 1.0);
}
