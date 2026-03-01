import { test } from "node:test";
import assert from "node:assert/strict";
import { loadQueueWgsl } from "@plasius/gpu-lock-free-queue";

const originalImportMetaUrl = globalThis.__IMPORT_META_URL__;
globalThis.__IMPORT_META_URL__ = new URL("../src/index.js", import.meta.url);
const {
  workerWgslUrl,
  loadWorkerWgsl,
  loadQueueWgsl: loadQueueWgslApi,
  loadJobWgsl,
  assembleWorkerWgsl,
  createWorkerLoop,
} = await import("../src/index.js");
if (typeof originalImportMetaUrl === "undefined") {
  delete globalThis.__IMPORT_META_URL__;
} else {
  globalThis.__IMPORT_META_URL__ = originalImportMetaUrl;
}

async function importWorkerModuleFresh(querySuffix) {
  const previous = globalThis.__IMPORT_META_URL__;
  globalThis.__IMPORT_META_URL__ = new URL("../src/index.js", import.meta.url);
  try {
    return await import(`../src/index.js?${querySuffix}`);
  } finally {
    if (typeof previous === "undefined") {
      delete globalThis.__IMPORT_META_URL__;
    } else {
      globalThis.__IMPORT_META_URL__ = previous;
    }
  }
}

class FakeComputePass {
  constructor() {
    this.pipelines = [];
    this.bindGroups = [];
    this.dispatches = [];
    this.ended = false;
  }

  setPipeline(pipeline) {
    this.pipelines.push(pipeline);
  }

  setBindGroup(index, group) {
    this.bindGroups.push({ index, group });
  }

  dispatchWorkgroups(x, y, z) {
    this.dispatches.push([x, y, z]);
  }

  end() {
    this.ended = true;
  }
}

class FakeCommandEncoder {
  constructor() {
    this.pass = new FakeComputePass();
    this.label = null;
  }

  beginComputePass(descriptor) {
    this.label = descriptor?.label ?? null;
    return this.pass;
  }

  finish() {
    return { type: "command-buffer" };
  }
}

class FakeDevice {
  constructor() {
    this.encoders = [];
    this.submissions = 0;
    this.queue = {
      submit: (buffers) => {
        this.submissions += buffers.length;
      },
    };
  }

  createCommandEncoder() {
    const encoder = new FakeCommandEncoder();
    this.encoders.push(encoder);
    return encoder;
  }
}

const BASE_JOB_WGSL = `
fn process_job(job_index: u32, job_type: u32, payload_words: u32) {
  let _a = job_index + job_type + payload_words;
}
`;

test("workerWgslUrl points at worker.wgsl", () => {
  assert.ok(workerWgslUrl instanceof URL);
  assert.ok(workerWgslUrl.pathname.endsWith("/worker.wgsl"));
});

test("loadWorkerWgsl uses fetch for the WGSL body", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl;
  globalThis.fetch = async (url) => {
    seenUrl = url;
    return {
      ok: true,
      text: async () => "wgsl-body",
    };
  };

  try {
    const body = await loadWorkerWgsl();
    assert.strictEqual(body, "wgsl-body");
    assert.strictEqual(seenUrl?.toString(), workerWgslUrl.toString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assembleWorkerWgsl concatenates queue and worker sources", async () => {
  const queueWgsl = await loadQueueWgsl();
  const workerWgsl = "worker-main";
  const assembled = await assembleWorkerWgsl(workerWgsl);
  const expectedQueue = queueWgsl.replace(/\bJobMeta\b/g, "JobDesc");
  assert.strictEqual(assembled, `${expectedQueue}\n\n${workerWgsl}`);
});

test("loadWorkerWgsl rejects HTML payloads", async () => {
  await assert.rejects(
    () =>
      loadWorkerWgsl({
        fetcher: async () => ({
          ok: true,
          async text() {
            return "<!doctype html><html><body>bad wgsl</body></html>";
          },
        }),
      }),
    /Expected WGSL/
  );
});

test("loadQueueWgsl supports compat toggle", async () => {
  const queueRaw = await loadQueueWgsl();
  const queueCompat = await loadQueueWgslApi();
  const queueNoCompat = await loadQueueWgslApi({ queueCompat: false });

  assert.equal(queueNoCompat, queueRaw);
  assert.equal(queueCompat, queueRaw.replace(/\bJobMeta\b/g, "JobDesc"));
});

test("loadJobWgsl registers sequential job ids and labels", async () => {
  const module = await importWorkerModuleFresh("job-registry");
  const job0 = await module.loadJobWgsl({ wgsl: BASE_JOB_WGSL });
  const job1 = await module.loadJobWgsl({
    wgsl: BASE_JOB_WGSL.replace("let _a", "let _b"),
    label: "custom-job",
  });

  const assembled = await module.assembleWorkerWgsl("worker-main", {
    queueWgsl: "struct JobMeta { value: u32; };",
  });

  assert.equal(job0, 0);
  assert.equal(job1, 1);
  assert.match(assembled, /JobDesc/);
  assert.match(assembled, /Job 0: job_0/);
  assert.match(assembled, /Job 1: custom-job/);
  assert.match(assembled, /process_job__0/);
  assert.match(assembled, /process_job__1/);
});

test("loadJobWgsl requires wgsl source and rejects HTML strings", async () => {
  const module = await importWorkerModuleFresh("job-errors");

  await assert.rejects(
    () => module.loadJobWgsl(),
    /requires a WGSL string or URL/
  );
  await assert.rejects(
    () => module.loadJobWgsl({ wgsl: "<html>bad</html>" }),
    /Expected WGSL/
  );
});

test("assembleWorkerWgsl supports empty jobs and explicit prelude", async () => {
  const module = await importWorkerModuleFresh("assemble-options");
  const noJobs = await module.assembleWorkerWgsl("worker-main", {
    queueWgsl: "queue-main",
    jobs: [],
  });
  assert.equal(noJobs, "queue-main\n\nworker-main");

  const withPrelude = await module.assembleWorkerWgsl("worker-main", {
    queueWgsl: "struct JobMeta { value: u32; };",
    preludeWgsl: "const PRELUDE_OK: u32 = 1u;",
    jobs: [BASE_JOB_WGSL],
    queueCompat: false,
  });

  assert.match(withPrelude, /const PRELUDE_OK: u32 = 1u;/);
  assert.match(withPrelude, /struct JobMeta/);
  assert.match(withPrelude, /process_job__0/);
});

test("assembleWorkerWgsl rejects jobs without process_job", async () => {
  const module = await importWorkerModuleFresh("missing-process");
  await assert.rejects(
    () =>
      module.assembleWorkerWgsl("worker-main", {
        queueWgsl: "queue-main",
        jobs: [{ jobType: 5, wgsl: "fn nope() {}", sourceName: "broken-job" }],
      }),
    /missing a process_job/
  );
});

test("assembleWorkerWgsl debug mode detects identifier clashes", async () => {
  const module = await importWorkerModuleFresh("debug-clash");
  await assert.rejects(
    () =>
      module.assembleWorkerWgsl("fn clash() {}", {
        queueWgsl: "fn clash() {}",
        jobs: [BASE_JOB_WGSL],
        debug: true,
      }),
    /identifier clashes detected/
  );
});

test("createWorkerLoop validates required inputs", () => {
  assert.throws(
    () => createWorkerLoop({ worker: { pipeline: {} } }),
    /requires a GPUDevice/
  );
  assert.throws(
    () => createWorkerLoop({ device: new FakeDevice(), worker: {} }),
    /requires a worker pipeline/
  );
});

test("createWorkerLoop tick dispatches worker and job pipelines", () => {
  const device = new FakeDevice();
  let tickCount = 0;
  const loop = createWorkerLoop({
    device,
    worker: {
      pipeline: { id: "worker" },
      bindGroups: [null, { id: "worker-bg" }],
      workgroups: [2, 1, 1],
    },
    jobs: [
      {
        pipeline: { id: "job" },
        bindGroups: [{ id: "job-bg" }],
        workgroupCount: [3, 1, 1],
      },
    ],
    onTick() {
      tickCount += 1;
    },
  });

  loop.tick();

  const pass = device.encoders[0].pass;
  assert.equal(pass.pipelines.length, 2);
  assert.deepEqual(pass.dispatches, [
    [2, 1, 1],
    [3, 1, 1],
  ]);
  assert.deepEqual(pass.bindGroups, [
    { index: 1, group: { id: "worker-bg" } },
    { index: 0, group: { id: "job-bg" } },
  ]);
  assert.equal(device.submissions, 1);
  assert.equal(tickCount, 1);
  assert.equal(pass.ended, true);
});

test("createWorkerLoop computes worker dispatch from maxJobs and workgroupSize", () => {
  const device = new FakeDevice();
  const loop = createWorkerLoop({
    device,
    worker: { pipeline: { id: "worker" } },
    maxJobsPerDispatch: 130,
    workgroupSize: 64,
  });

  loop.tick();
  assert.deepEqual(device.encoders[0].pass.dispatches[0], [3, 1, 1]);
});

test("createWorkerLoop reports workgroup validation errors", () => {
  const device = new FakeDevice();
  const badMaxJobs = createWorkerLoop({
    device,
    worker: { pipeline: { id: "worker" } },
    maxJobsPerDispatch: 0,
  });
  assert.throws(() => badMaxJobs.tick(), /maxJobsPerDispatch must be a positive number/);

  const badWorkerGroups = createWorkerLoop({
    device: new FakeDevice(),
    worker: { pipeline: { id: "worker" }, workgroups: {} },
  });
  assert.throws(() => badWorkerGroups.tick(), /Invalid workgroup count for worker/);

  const missingJobGroups = createWorkerLoop({
    device: new FakeDevice(),
    worker: { pipeline: { id: "worker" }, workgroups: [1, 1, 1] },
    jobs: [{ pipeline: { id: "job" } }],
  });
  assert.throws(() => missingJobGroups.tick(), /requires a workgroup count/);
});

test("createWorkerLoop uses onError callback instead of throwing", () => {
  const errors = [];
  const loop = createWorkerLoop({
    device: new FakeDevice(),
    worker: { pipeline: { id: "worker" }, workgroups: [1, 1, 1] },
    jobs: [{ bindGroups: [] }],
    onError(error) {
      errors.push(error.message);
    },
  });

  loop.tick();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Job pipeline missing/);
});

test("createWorkerLoop start/stop uses timeout scheduler when RAF is unavailable", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;

  const timeouts = [];
  const cleared = [];
  globalThis.requestAnimationFrame = undefined;
  globalThis.cancelAnimationFrame = undefined;
  globalThis.setTimeout = (_callback, delay) => {
    timeouts.push(delay);
    return 101;
  };
  globalThis.clearTimeout = (handle) => {
    cleared.push(handle);
  };

  try {
    const loop = createWorkerLoop({
      device: new FakeDevice(),
      worker: { pipeline: { id: "worker" }, workgroups: [1, 1, 1] },
    });

    loop.stop();
    assert.equal(loop.running, false);
    loop.start();
    loop.start();
    assert.equal(loop.running, true);
    loop.stop();
    loop.stop();
    assert.equal(loop.running, false);
    assert.deepEqual(timeouts, [0]);
    assert.deepEqual(cleared, [101]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  }
});

test("createWorkerLoop uses requestAnimationFrame when available", () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const canceled = [];
  globalThis.requestAnimationFrame = () => 77;
  globalThis.cancelAnimationFrame = (handle) => {
    canceled.push(handle);
  };
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};

  try {
    const loop = createWorkerLoop({
      device: new FakeDevice(),
      worker: { pipeline: { id: "worker" }, workgroups: [1, 1, 1] },
    });
    loop.start();
    loop.stop();
    assert.deepEqual(canceled, [77]);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("createWorkerLoop schedules fixed-rate ticks when rateHz is set", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;

  const delays = [];
  globalThis.requestAnimationFrame = undefined;
  globalThis.cancelAnimationFrame = undefined;
  globalThis.setTimeout = (_callback, delay) => {
    delays.push(delay);
    return 202;
  };
  globalThis.clearTimeout = () => {};

  try {
    const loop = createWorkerLoop({
      device: new FakeDevice(),
      worker: { pipeline: { id: "worker" }, workgroups: [1, 1, 1] },
      rateHz: 20,
    });
    loop.start();
    loop.stop();
    assert.equal(delays[0], 50);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  }
});
