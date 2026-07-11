// Flat ESLint config for Community Screen.
// Targets browser globals provided by Foundry VTT at runtime.

import js from "@eslint/js";
import globals from "globals";

const foundryGlobals = {
  // Core Foundry / browser-runtime globals available inside the VTT.
  game: "readonly",
  ui: "readonly",
  canvas: "readonly",
  CONFIG: "readonly",
  CONST: "readonly",
  Hooks: "readonly",
  foundry: "readonly",
  fromUuid: "readonly",
  fromUuidSync: "readonly",
  Handlebars: "readonly",
  Roll: "readonly",
  // Module-side globals.
  socketlib: "readonly",
  libWrapper: "readonly",
  Sequencer: "readonly",
  // PIXI (v7 in Foundry v14).
  PIXI: "readonly",
};

export default [
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...foundryGlobals,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "warn",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
    },
  },
  {
    files: ["scripts/lib/logger.mjs"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Unit tests run under plain Node via `node --test`, but the harness
    // installs a mocked Foundry environment on `globalThis` and a jsdom
    // preload supplies the browser DOM globals (document/HTMLElement/Event/
    // window/requestAnimationFrame). Allow Node + browser + the Foundry
    // globals the mock provides so assertions can reference them if needed.
    // console is fine in test output.
    files: ["test/**/*.mjs", "test-setup/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...foundryGlobals,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "prefer-const": "warn",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "no-console": "off",
    },
  },
  {
    ignores: ["node_modules/**", "dist/**", "*.min.js"],
  },
];
