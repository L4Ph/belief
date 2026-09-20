import { expect, test } from "vite-plus/test";
import { BelError } from "../src/ast.ts";
import { generate } from "../src/codegen.ts";
import { parseBel } from "../src/parser.ts";

function compile(source: string): string {
  return generate(parseBel(source), { source });
}

test("the RFC's compilation example generates the documented output", () => {
  const source = `export flow support(t: Ticket): Action
  let urgency = score "how urgent is this?" in low | medium | high | human

  urgency >= high -> escalate(t)
  "the user is angry" & "the user asks for a refund" @ 0.7 -> refund(t)
  _ -> reply("could you tell me more?")
`;
  expect(compile(source)).toBe(`// @generated from bel source. Do not edit.
import { __bel } from "@bel/runtime";

export async function support(t: Ticket): Promise<Action> {
  const $b = await __bel.evaluate(
    [
      { id: "0", type: "score", text: "how urgent is this?", rubric: ["low", "medium", "high", "human"] },
      { id: "1", type: "noul", text: "the user is angry" },
      { id: "2", type: "noul", text: "the user asks for a refund" },
    ],
    t,
  );
  if (__bel.det(__bel.number($b[0]) >= 2) >= 0.5) {
    __bel.mark("support", 0);
    return escalate(t);
  }
  if (__bel.composeAnd($b[1], $b[2]) >= 0.7) {
    __bel.mark("support", 1);
    return refund(t);
  }
  __bel.mark("support", 2);
  return reply("could you tell me more?");
}
`);
});

test("a nested guard list becomes nested ifs and keeps typed imports intact", () => {
  const output = compile(`import { refund } from "./actions.ts"

flow triage(t: Ticket): Action
  "the user is angry" ->
    guards {
      "wants money back" -> refund(t)
      _ -> reply("ok")
    }
  _ -> reply("ok")
`);
  expect(output).toContain(`import { refund } from "./actions.ts"`);
  expect(output).toContain(`  if (__bel.number($b[0]) >= 0.5) {
    __bel.mark("triage", 0);
    if (__bel.number($b[1]) >= 0.5) {
      return refund(t);
    }
    return reply("ok");
  }
  __bel.mark("triage", 1);
  return reply("ok");`);
});

test("an action island reads only the bindings it mentions", () => {
  const output = compile(`flow f(t: Ticket): Action
  let urgency = score "how urgent?" in low | high

  "x" -> {
    const level = urgency
    return escalate(t, level)
  }
  _ -> reply("ok")
`);
  expect(output).toContain("  const urgency = __bel.number($b[0]);");
  expect(output).toContain(`  if (__bel.number($b[1]) >= 0.5) {
    __bel.mark("f", 0);`);
  expect(output).toContain(`    {
      const level = urgency
      return escalate(t, level)
    }`);
});

test("a binding used only by guards is not emitted as a local", () => {
  const output = compile(`flow f(t: Ticket): Action
  let urgency = score "how urgent?" in low | high

  urgency >= high -> escalate(t)
  _ -> reply("ok")
`);
  expect(output).not.toContain("const urgency");
});

test("identical questions are asked once", () => {
  const output = compile(`flow f(t: Ticket): Action
  "the user is angry" -> reply("a")
  "the user is angry" & "and impatient" -> reply("b")
  _ -> reply("c")
`);
  expect(output.match(/type: "noul", text: "the user is angry"/g)).toHaveLength(1);
  expect(output).toContain("__bel.composeAnd($b[0], $b[1])");
});

test("mock and test declarations never change the production output", () => {
  const production = `flow f(t: Ticket): Action
  "x" -> reply("a")
  _ -> reply("b")
`;
  const withTests = `${production}
mock beliefs
  "x" => 0.9

test "a name"
  assert f(t) is Reply("b")
`;
  expect(compile(withTests)).toBe(compile(production));
});

test("a belief alias expands to the expression it names", () => {
  const output = compile(`flow f(t: Ticket): Action
  let frustrated = "is angry" | "is unhappy"

  frustrated -> reply("a")
  _ -> reply("b")
`);
  expect(output).toContain("__bel.composeOr($b[0], $b[1])");
});

test("a cyclic alias is reported", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  let a = b
  let b = a

  _ -> reply("b")
`),
  ).toThrow(/defined in terms of itself/);
});

test("an unbound name is reported", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  missing -> reply("a")
  _ -> reply("b")
`),
  ).toThrow(/`missing` is not bound/);
});

test("an unknown rubric level is reported", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  let urgency = score "how urgent?" in low | high

  urgency >= urgent -> reply("a")
  _ -> reply("b")
`),
  ).toThrow(/not one of the levels \[low, high\]/);
});

test("comparing against a plain belief is reported", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  let angry = "is angry"

  angry >= high -> reply("a")
  _ -> reply("b")
`),
  ).toThrow(/is a belief, not a score or choice/);
});

test("a missing catch-all is reported when the return type is not optional", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  "x" -> reply("a")
`),
  ).toThrow(/has no `_` guard/);
});

test("a return type that allows undefined needs no catch-all", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action | undefined
  "x" -> reply("a")
`),
  ).not.toThrow();
});

test("a guard after the catch-all is reported", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  _ -> reply("a")
  "x" -> reply("b")
`),
  ).toThrow(/after the catch-all/);
});

test("route is rejected with a clear error", () => {
  expect(() => compile(`route "refunds" (c: Context) -> refund(c)\n`)).toThrow(
    /`route` is not implemented in bel v0/,
  );
});

test("errors carry the diagnostic code and a position", () => {
  try {
    compile(`flow f(t: Ticket): Action\n  "x" -> reply("a")\n`);
    throw new Error("expected a BelError");
  } catch (error) {
    if (!(error instanceof BelError)) throw error;
    expect(error.code).toBe("missing-fallback");
    expect(error.position?.line).toBe(1);
    expect(error.format("f.bel")).toMatch(/^f\.bel:1:\d+: missing-fallback: /);
  }
});

test("the conjoin strategy asks for the conjunction as one question", () => {
  const source = `flow f(t: Ticket): Action
  "the user is angry" & "asks for a refund" @ 0.7 -> refund(t)
  _ -> reply("ok")
`;
  const output = generate(parseBel(source), { source, andStrategy: "conjoin" });
  expect(output).toContain(
    `{ id: "2", type: "noul", text: "the user is angry and asks for a refund" }`,
  );
  expect(output).toContain("if (__bel.number($b[2]) >= 0.7) {");
  expect(output).not.toContain("composeAnd");
});

test("conjoin falls back to multiplication for operand shapes it cannot phrase", () => {
  const source = `flow f(t: Ticket): Action
  ~"a" & "b" -> reply("a")
  _ -> reply("b")
`;
  const output = generate(parseBel(source), { source, andStrategy: "conjoin" });
  expect(output).toContain("__bel.composeAnd(__bel.negate($b[0]), $b[1])");
});

test("a score used as a bare belief is reported", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  let urgency = score "how urgent?" in low | high

  urgency -> reply("a")
  _ -> reply("b")
`),
  ).toThrow(/is a score; compare it with one of its levels/);
});

test("an enum in an action island is rejected", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  "x" -> {
    enum Kind { A }
    return reply("a")
  }
  _ -> reply("b")
`),
  ).toThrow(/an enum has a runtime value/);
});

test("a parameter property in an action island is rejected", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  "x" -> reply(String(new (class { constructor(public n: number) {} })(1)))
  _ -> reply("b")
`),
  ).toThrow(/a parameter property has a runtime value/);
});

test("plain block islands are accepted", () => {
  expect(() =>
    compile(`flow f(t: Ticket): Action
  "x" -> {
    const kind: "a" | "b" = "a"
    return reply(kind)
  }
  _ -> reply("b")
`),
  ).not.toThrow();
});
