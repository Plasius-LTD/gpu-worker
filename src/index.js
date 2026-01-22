import { loadQueueWgsl } from "@plasius/gpu-lock-free-queue";

export const workerWgslUrl = (() => {
  if (typeof __IMPORT_META_URL__ !== "undefined") {
    return new URL("./worker.wgsl", __IMPORT_META_URL__);
  }
  if (typeof __filename !== "undefined" && typeof require !== "undefined") {
    const { pathToFileURL } = require("node:url");
    return new URL("./worker.wgsl", pathToFileURL(__filename));
  }
  const base =
    typeof process !== "undefined" && process.cwd
      ? `file://${process.cwd()}/`
      : "file:///";
  return new URL("./worker.wgsl", base);
})();

export async function loadWorkerWgsl() {
  const response = await fetch(workerWgslUrl);
  return response.text();
}

export async function assembleWorkerWgsl(workerWgsl) {
  const queueWgsl = await loadQueueWgsl();
  const body = workerWgsl ?? (await loadWorkerWgsl());
  return `${queueWgsl}\n\n${body}`;
}
