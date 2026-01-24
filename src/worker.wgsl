// Minimal GPU worker entry point.
//
// This file is intended to be concatenated with the lock-free queue WGSL
// via assembleWorkerWgsl(). It only handles dequeue and dispatches to a
// user hook. Replace this file (or provide your own WGSL) to implement
// real workloads.

fn payload_word(job_index: u32, word_index: u32) -> u32 {
  let stride = params.output_stride;
  if (stride == 0u || word_index >= stride) {
    return 0u;
  }
  let base = job_index * stride;
  return output_payloads[base + word_index];
}

// process_job(job_index, job_type, payload_words) must be defined by the
// job WGSL that you concatenate before this file.

@compute @workgroup_size(64)
fn worker_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let job_count = dequeue_job_count();
  if (idx >= job_count) {
    return;
  }
  if (!queue_config_valid()) {
    return;
  }
  let ok = dequeue(idx);
  if (ok == 0u) {
    return;
  }

  let job_info = output_jobs[idx];
  process_job(idx, job_info.job_type, job_info.payload_words);
}
