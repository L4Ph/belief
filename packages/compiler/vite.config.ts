import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // The CLI is a second entry point; `bin` in package.json cannot be inferred.
    entry: ["src/index.ts", "src/bin.ts"],
    deps: { resolveDepSubpath: true },
    dts: {
      generator: "tsgo",
    },
    // `exports: true` also rewrites `bin` in package.json, and it named the CLI
    // after the package instead of `bel`. Both fields are declared by hand.
    exports: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
