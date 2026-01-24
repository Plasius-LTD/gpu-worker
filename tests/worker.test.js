import { test } from "node:test";
import assert from "node:assert/strict";
import { loadQueueWgsl } from "@plasius/gpu-lock-free-queue";

const originalImportMetaUrl = globalThis.__IMPORT_META_URL__;
globalThis.__IMPORT_META_URL__ = new URL("../src/index.js", import.meta.url);
const { workerWgslUrl, loadWorkerWgsl, assembleWorkerWgsl } = await import(
  "../src/index.js"
);
if (typeof originalImportMetaUrl === "undefined") {
  delete globalThis.__IMPORT_META_URL__;
} else {
  globalThis.__IMPORT_META_URL__ = originalImportMetaUrl;
}

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
