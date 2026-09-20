import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

/**
 * The compiler's own source has to stay erasable: running it from source with
 * `node src/index.ts` is how the package is used during development, and Node
 * refuses parameter properties, enums and namespaces. A parameter property in
 * this package already slipped through once.
 */
test("every compiler source file loads under node's type stripping", () => {
  const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  expect(() => execFileSync(process.execPath, [entry], { stdio: "pipe" })).not.toThrow();
});
