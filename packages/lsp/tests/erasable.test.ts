import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

/**
 * The language server runs from source during development, and Node refuses
 * parameter properties, enums and namespaces. The compiler package has the
 * same guard; this one has caught a parameter property too.
 */
test("every source file loads under node's type stripping", () => {
  const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  expect(() => execFileSync(process.execPath, [entry], { stdio: "pipe" })).not.toThrow();
});
