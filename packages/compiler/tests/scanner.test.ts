import { expect, test } from "vite-plus/test";
import { matchBracket, scanRaw } from "../src/scanner.ts";

/** Convenience: the end offset of the bracket that opens at the first `{` or `(`. */
function end(src: string): number {
  const open = src.search(/[{(]/);
  const result = matchBracket(src, open);
  if (!result.ok) throw new Error(`unterminated: expected ok, got ${result.reason}`);
  return result.end;
}

test("plain braces", () => {
  expect(end("{ a }")).toBe(5);
});

test("nested braces", () => {
  expect(end("{ { } }")).toBe(7);
});

test("nested parens and brackets", () => {
  expect(end("{ f({ a: [1, 2] }) }")).toBe(20);
  expect(end("(a(b))")).toBe(6);
});

test("braces inside double and single quoted strings", () => {
  expect(end(`{ "}" }`)).toBe(7);
  expect(end(`{ '}' }`)).toBe(7);
  expect(end(`{ "\\"}" }`)).toBe(9);
  expect(end(`{ '\\'}' }`)).toBe(9);
});

test("braces inside a line comment", () => {
  expect(end("{ // }\n }")).toBe(9);
});

test("braces inside a block comment", () => {
  expect(end("{ /* } { */ }")).toBe(13);
});

test("braces inside a template literal", () => {
  expect(end("{ `}` }")).toBe(7);
});

test("interpolation inside a template literal", () => {
  expect(end("{ `${ { a: 1 } }` }")).toBe(19);
  expect(end("{ `a${ `b${c}d` }e` }")).toBe(21);
});

test("escaped backtick and interpolation", () => {
  expect(end("{ `\\`${ x }` }")).toBe(14);
});

test("a regex literal with a brace", () => {
  expect(end("{ /}/.test(x) }")).toBe(15);
});

test("a regex literal after an operator", () => {
  expect(end("{ a && /}/.test(x) }")).toBe(20);
});

test("division is not a regex", () => {
  expect(end("{ a / b }")).toBe(9);
  expect(end("{ a /b/ c }")).toBe(11);
});

test("regex after a keyword", () => {
  expect(end("{ return /}/.test(x) }")).toBe(22);
});

test("objects and arrays as arguments are skipped correctly", () => {
  expect(end(`{ c.json({ error: "}" }, 404) }`)).toBe(31);
});

test("unterminated input reports the opening offset", () => {
  const result = matchBracket("{ a", 0);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.reason).toBe("unterminated");
  expect(result.at).toBe(0);
});

test("a mismatched closer is an error", () => {
  const result = matchBracket("{ ( }", 0);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.reason).toBe("mismatch");
});

test("the opening offset must be a bracket", () => {
  const result = matchBracket("abc", 1);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.reason).toBe("not-a-bracket");
});

test("scanRaw stops at the end of a line", () => {
  const src = `import { a } from "x"\nnext`;
  expect(src.slice(0, scanRaw(src, 0))).toBe(`import { a } from "x"`);
});

test("scanRaw follows brackets across lines", () => {
  const src = `import {\n  a,\n  b,\n} from "x"\nnext`;
  expect(src.slice(0, scanRaw(src, 0))).toBe(`import {\n  a,\n  b,\n} from "x"`);
});

test("scanRaw on a multi-line type declaration", () => {
  const src = `type Ticket = {\n  message: string\n}\nflow f(t: Ticket): Action\n`;
  expect(src.slice(0, scanRaw(src, 0))).toBe(`type Ticket = {\n  message: string\n}`);
});

test("scanRaw ignores brackets inside strings and comments", () => {
  const src = `type A = "{" // }\ntype B = 1`;
  expect(src.slice(0, scanRaw(src, 0))).toBe(`type A = "{" // }`);
});

test("scanRaw runs to EOF when a bracket never closes", () => {
  const src = `type A = {\n  x: string`;
  expect(scanRaw(src, 0)).toBe(src.length);
});
