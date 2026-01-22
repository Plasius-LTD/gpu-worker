import { loadQueueWgsl } from "@plasius/gpu-lock-free-queue";

export const workerWgslUrl = new URL("./worker.wgsl", import.meta.url);

export async function loadWorkerWgsl() {
  const response = await fetch(workerWgslUrl);
  return response.text();
}

export async function assembleWorkerWgsl(workerWgsl) {
  const queueWgsl = await loadQueueWgsl();
  const body = workerWgsl ?? (await loadWorkerWgsl());
  return `${queueWgsl}\n\n${body}`;
}
