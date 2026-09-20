import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { findNonErasable } from "../src/erasable.ts";

test("plain TypeScript has nothing to report", () => {
  expect(findNonErasable("const x = 1;\nreturn reply(x)")).toBeNull();
  expect(findNonErasable("{ const r = await refund(t)\n  return r }")).toBeNull();
});

test("a parameter property inside a block is reported", () => {
  expect(
    findNonErasable("class A {\n  constructor(private readonly x: number) {}\n}"),
  ).toMatchObject({ what: "a parameter property" });
});

test("an enum is reported with a fix", () => {
  const issue = findNonErasable("enum Kind {\n  A,\n}");
  expect(issue).toMatchObject({ what: "an enum" });
  expect(issue?.fix).toContain("union of string literals");
});

test("a namespace is reported", () => {
  expect(findNonErasable("namespace Outer {\n  export const x = 1\n}")).toMatchObject({
    what: "a namespace",
  });
});

test("import equals is reported", () => {
  expect(findNonErasable("import fs = require('node:fs')")).toMatchObject({
    what: "an `import =`",
  });
});

test("a parameter property is reported", () => {
  const issue = findNonErasable("class A {\n  constructor(public name: string) {}\n}");
  expect(issue).toMatchObject({ what: "a parameter property" });
});

test("declaring the field and assigning it is fine", () => {
  expect(
    findNonErasable(
      "class A {\n  name: string\n  constructor(name: string) { this.name = name }\n}",
    ),
  ).toBeNull();
});

test("a mention in a comment or a string is not a declaration", () => {
  expect(findNonErasable('// enum Kind {}\nconst s = "enum Kind {}"')).toBeNull();
  expect(findNonErasable("const label = 'namespace';\nreturn label")).toBeNull();
});

test("the issue carries an offset", () => {
  expect(findNonErasable("const a = 1\nenum Kind { A }")?.at).toBe(12);
});

test("a constructor with a nested call is still checked", () => {
  const issue = findNonErasable("class A {\n  constructor(readonly x = f(1, 2)) {}\n}");
  expect(issue).toMatchObject({ what: "a parameter property" });
});

/**
 * The compiler's own source has to stay erasable: running it from source with
 * `node src/index.ts` is how the package is used during development, and Node
 * refuses parameter properties, enums and namespaces. A parameter property in
 * this package slipped through twice.
 */
test("every compiler source file loads under node's type stripping", () => {
  const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  expect(() => execFileSync(process.execPath, [entry], { stdio: "pipe" })).not.toThrow();
});
