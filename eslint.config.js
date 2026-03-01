import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        __IMPORT_META_URL__: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
];
