import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { compile } from "../src/compile.ts";
import { parseBel } from "../src/parser.ts";
import { generateTests } from "../src/testgen.ts";

const ROOT = fileURLToPath(new URL("../../../examples", import.meta.url));

/**
 * The examples commit their generated output so that someone reading the
 * repository sees the `.bel` and the TypeScript it becomes side by side. That
 * only stays true if something checks it: this is that something.
 */
function examples(): { name: string; file: string }[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(ROOT, entry.name))
        .filter((file) => file.endsWith(".bel"))
        .map((file) => ({ name: entry.name, file: join(ROOT, entry.name, file) })),
    );
}

test("there are examples to check", () => {
  expect(examples().length).toBeGreaterThanOrEqual(4);
});

for (const { name, file } of examples()) {
  const source = readFileSync(file, "utf8");

  test(`${name}: the committed module is what the compiler produces`, () => {
    expect(compile(source)).toBe(readFileSync(`${file}.ts`, "utf8"));
  });

  test(`${name}: the committed tests are what the compiler produces`, () => {
    const generated = generateTests(parseBel(source), { source, fileName: file });
    // A module with nothing to test commits no test file, and never a stale one.
    if (generated === null) {
      expect(existsSync(`${file}.test.ts`)).toBe(false);
      return;
    }
    expect(generated).toBe(readFileSync(`${file}.test.ts`, "utf8"));
  });
}
