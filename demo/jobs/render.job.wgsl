// Render job: enqueue particles for sprite draw and build indirect arguments.

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

  let dst = atomicAdd(&worklist[1], 1u);
  if (dst < max_count) {
    let render_offset = worklist_render_offset(max_count);
    atomicStore(&worklist[render_offset + dst], job);
  }
}

@compute @workgroup_size(1)
fn render_indirect_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x > 0u) {
    return;
  }
  let max_count = worklist_max_count();
  let count = min(atomicLoad(&worklist[1]), max_count);
  render_indirect[0] = 6u;
  render_indirect[1] = count;
  render_indirect[2] = 0u;
  render_indirect[3] = 0u;
}
