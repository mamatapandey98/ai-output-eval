import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "runs/", "07-results/runs/", ".cache/", "01-ground-truth-annotation/app/"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
