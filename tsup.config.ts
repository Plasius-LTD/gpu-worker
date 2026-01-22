import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.js"],
  format: ["esm", "cjs"],
  target: "es2022",
  sourcemap: true,
  clean: true,
  dts: false,
});
