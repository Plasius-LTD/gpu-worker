import { defineConfig } from "tsup";

const sharedConfig = {
  entry: ["src/index.js"],
  target: "es2022",
  sourcemap: true,
};

export default defineConfig([
  {
    ...sharedConfig,
    format: ["esm"],
    clean: true,
    dts: false,
    esbuildOptions(options) {
      options.define = {
        ...(options.define ?? {}),
        __IMPORT_META_URL__: "import.meta.url",
      };
    },
  },
  {
    ...sharedConfig,
    format: ["cjs"],
    clean: false,
    dts: false,
    esbuildOptions(options) {
      options.define = {
        ...(options.define ?? {}),
        __IMPORT_META_URL__: "undefined",
      };
    },
  },
]);
