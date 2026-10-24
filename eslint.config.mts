import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "coverage/**",
      "eslint.config.mts",
      "esbuild.config.mjs",
      "version-bump.mjs",
      "scripts/**",
      "vitest.config.ts",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // The searchable settings API requires Obsidian 1.13; Siden still
      // supports 1.7.2 through the classic PluginSettingTab API.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Marginalia Bona", "Marginalia", "Siden", "Markdown", "AI", "Pi", "Codex"],
          acronyms: ["PDF"],
        },
      ],
    },
  },
]);
