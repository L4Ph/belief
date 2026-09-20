import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/bin.ts"],
    deps: { resolveDepSubpath: true },
    dts: { generator: "tsgo" },
    // Declared by hand, the way the compiler package does it.
    exports: false,
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
});
