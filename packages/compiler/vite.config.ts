import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // The CLI is a second entry point; `bin` in package.json cannot be inferred.
    entry: ["src/index.ts", "src/bin.ts"],
    deps: { resolveDepSubpath: true },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
