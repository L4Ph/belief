import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { main } from "../src/cli.ts";

const SOURCE = `flow f(t: Ticket): Action
  "the user is angry" -> reply("a")
  _ -> reply("b")
`;

function run(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(["node", "bel", ...argv], {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { code, out: out.join(""), err: err.join("") };
}

function withSource(source = SOURCE): string {
  const dir = mkdtempSync(join(tmpdir(), "bel-cli-"));
  writeFileSync(join(dir, "f.bel"), source);
  return dir;
}

test("build writes <name>.bel.ts next to the source", () => {
  const dir = withSource();
  const result = run(["build", join(dir, "f.bel")]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("f.bel.ts");
  const generated = readFileSync(join(dir, "f.bel.ts"), "utf8");
  expect(generated).toContain("async function f");
});

test("--out-dir redirects the output", () => {
  const dir = withSource();
  const result = run(["build", "--out-dir", join(dir, "out"), join(dir, "f.bel")]);
  expect(result.code).toBe(0);
  expect(existsSync(join(dir, "out", "f.bel.ts"))).toBe(true);
  expect(existsSync(join(dir, "f.bel.ts"))).toBe(false);
});

test("--conjoin switches the composition strategy", () => {
  const dir = withSource(`flow f(t: Ticket): Action
  "a" & "b" -> reply("a")
  _ -> reply("b")
`);
  run(["build", "--conjoin", join(dir, "f.bel")]);
  const generated = readFileSync(join(dir, "f.bel.ts"), "utf8");
  expect(generated).toContain(`text: "a and b"`);
  expect(generated).not.toContain("composeAnd");
});

test("a diagnostic is printed with its file, position and code", () => {
  const dir = withSource(`flow f(t: Ticket)\n  _ -> reply("b")\n`);
  const result = run(["build", join(dir, "f.bel")]);
  expect(result.code).toBe(1);
  expect(result.err).toMatch(/f\.bel:1:\d+: parse-error: /);
  expect(existsSync(join(dir, "f.bel.ts"))).toBe(false);
});

test("a missing file is reported without a stack trace", () => {
  const result = run(["build", "/nonexistent/nope.bel"]);
  expect(result.code).toBe(1);
  expect(result.err).toContain("/nonexistent/nope.bel");
});

test("no arguments prints usage and fails", () => {
  const result = run([]);
  expect(result.code).toBe(1);
  expect(result.err).toContain("Usage:");
});

test("--help prints usage and succeeds", () => {
  const result = run(["--help"]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("Usage:");
});

test("an unknown option fails", () => {
  const result = run(["build", "--nope", "f.bel"]);
  expect(result.code).toBe(1);
  expect(result.err).toContain("unknown option");
});
