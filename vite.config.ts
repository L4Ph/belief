import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  // The examples commit what the compiler produced, so the two stay comparable
  // byte for byte; formatting an artifact would only make the diff noisy.
  fmt: {
    ignorePatterns: ["**/*.bel.ts", "**/*.bel.test.ts"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/*.bel.ts", "**/*.bel.test.ts"],
  },
  run: {
    cache: true,
  },
});
