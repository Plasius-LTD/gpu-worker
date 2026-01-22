import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: {
      args: ["--enable-unsafe-webgpu"],
    },
  },
});
