import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  // The examples commit what the compiler produced, so the two stay comparable
  // byte for byte; formatting an artifact would only make the diff noisy.
  fmt: {
    ignorePatterns: [
      "**/*.bel.ts",
      "**/*.bel.test.ts",
      // A tree-sitter grammar: generated C, and a grammar.js the toolchain owns.
      "editors/**",
    ],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/*.bel.ts", "**/*.bel.test.ts", "editors/**"],
  },
  run: {
    // A package script is opaque to the task runner, so caching one replays a
    // run that did not happen: `demo` and `live` call a paid API, and `test`
    // would report a suite it never ran. Tasks, which vp can hash properly,
    // keep the default.
    cache: { scripts: false, tasks: true },
  },
});
