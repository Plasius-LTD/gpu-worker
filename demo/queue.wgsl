struct Queue {
  head: atomic<u32>,
  tail: atomic<u32>,
  capacity: u32,
  mask: u32,
};

struct Slot {
  seq: atomic<u32>,
  job_type: u32,
  payload_offset: u32,
  payload_words: u32,
};

struct JobMeta {
  job_type: u32,
  payload_offset: u32,
  payload_words: u32,
  _pad: u32,
};

struct Params {
  job_count: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<storage, read_write> queue: Queue;
@group(0) @binding(1) var<storage, read_write> slots: array<Slot>;
@group(0) @binding(2) var<storage, read_write> input_jobs: array<JobMeta>;
@group(0) @binding(3) var<storage, read_write> output_jobs: array<JobMeta>;
@group(0) @binding(4) var<storage, read> input_payloads: array<u32>;
@group(0) @binding(5) var<uniform> params: Params;

const MAX_RETRIES: u32 = 512u;

fn queue_config_valid() -> bool {
  if (queue.capacity == 0u) {
    return false;
  }
  if ((queue.capacity & (queue.capacity - 1u)) != 0u) {
    return false;
  }
  if (queue.mask != queue.capacity - 1u) {
    return false;
  }
  if (queue.capacity > arrayLength(&slots)) {
    return false;
  }
  return true;
}

fn enqueue_job_count() -> u32 {
  return min(params.job_count, arrayLength(&input_jobs));
}

fn dequeue_job_count() -> u32 {
  return min(params.job_count, arrayLength(&output_jobs));
}

fn queue_len() -> u32 {
  let h = atomicLoad(&queue.head);
  let t = atomicLoad(&queue.tail);
  return t - h;
}

fn enqueue(idx: u32) -> u32 {
  let job = input_jobs[idx];
  let payload_words = job.payload_words;
  let input_offset = job.payload_offset;
  if (input_offset + payload_words > arrayLength(&input_payloads)) {
    return 0u;
  }
  for (var attempt: u32 = 0u; attempt < MAX_RETRIES; attempt++) {
    let t = atomicLoad(&queue.tail);
    let slot_index = t & queue.mask;
    let seq = atomicLoad(&slots[slot_index].seq);
    let diff = i32(seq) - i32(t);

    if (diff == 0) {
      let res = atomicCompareExchangeWeak(&queue.tail, t, t + 1u);
      if (res.exchanged) {
        slots[slot_index].job_type = job.job_type;
        slots[slot_index].payload_offset = input_offset;
        slots[slot_index].payload_words = payload_words;
        atomicStore(&slots[slot_index].seq, t + 1u);
        return 1u;
      }
    } else if (diff < 0) {
      return 0u;
    }
  }

  return 0u;
}

fn dequeue(idx: u32) -> u32 {
  for (var attempt: u32 = 0u; attempt < MAX_RETRIES; attempt++) {
    let h = atomicLoad(&queue.head);
    let slot_index = h & queue.mask;
    let seq = atomicLoad(&slots[slot_index].seq);
    let diff = i32(seq) - i32(h + 1u);

    if (diff == 0) {
      let res = atomicCompareExchangeWeak(&queue.head, h, h + 1u);
      if (res.exchanged) {
        let payload_offset = slots[slot_index].payload_offset;
        let payload_words = slots[slot_index].payload_words;
        let job_type = slots[slot_index].job_type;
        output_jobs[idx].job_type = job_type;
        output_jobs[idx].payload_offset = payload_offset;
        output_jobs[idx].payload_words = payload_words;
        output_jobs[idx]._pad = 0u;
        atomicStore(&slots[slot_index].seq, h + queue.capacity);
        return 1u;
      }
    } else if (diff < 0) {
      return 0u;
    }
  }

  return 0u;
}

@compute @workgroup_size(64)
fn enqueue_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let job_count = enqueue_job_count();
  if (idx >= job_count) {
    return;
  }
  if (!queue_config_valid()) {
    return;
  }
  if (input_jobs[idx]._pad == 1u) {
    return;
  }

  let ok = enqueue(idx);
  if (ok == 1u) {
    input_jobs[idx]._pad = 1u;
  }
}

@compute @workgroup_size(64)
fn dequeue_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let job_count = dequeue_job_count();
  if (idx >= job_count) {
    return;
  }
  if (!queue_config_valid()) {
    return;
  }
  let _ok = dequeue(idx);
}
