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

// When left at the default 0, each invocation keeps draining the queue until
// dequeue() reports no immediately runnable work. Callers can set a positive
// pipeline override constant to bound per-invocation work when fairness or
// watchdog constraints matter more than maximum drain throughput.
override WORKER_MAX_JOBS_PER_INVOCATION: u32 = 0u;

@compute @workgroup_size(64)
fn worker_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let max_output_jobs = dequeue_job_count();
  if (idx >= max_output_jobs) {
    return;
  }
  if (!queue_config_valid()) {
    return;
  }
  var processed_jobs: u32 = 0u;
  loop {
    if (
      WORKER_MAX_JOBS_PER_INVOCATION != 0u &&
      processed_jobs >= WORKER_MAX_JOBS_PER_INVOCATION
    ) {
      break;
    }
    let ok = dequeue(idx);
    if (ok == 0u) {
      break;
    }

    let job_info = output_jobs[idx];
    process_job(idx, job_info.job_type, job_info.payload_words);
    complete_job(idx);
    processed_jobs = processed_jobs + 1u;
  }
}
