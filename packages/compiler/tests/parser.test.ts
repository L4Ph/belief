import { expect, test } from "vite-plus/test";
import { BelError } from "../src/ast.ts";
import type { FlowDecl } from "../src/ast.ts";
import { parseBel } from "../src/parser.ts";

function firstFlow(src: string): FlowDecl {
  const decl = parseBel(src).body[0];
  if (decl?.kind !== "FlowDecl") throw new Error(`expected a flow, got ${decl?.kind}`);
  return decl;
}

test("the RFC's compilation example parses", () => {
  const flow = firstFlow(`export flow support(t: Ticket): Action
  let urgency = score "how urgent is this?" in low | medium | high | human

  urgency >= high -> escalate(t)
  "the user is angry" & "the user asks for a refund" @ 0.7 -> refund(t)
  _ -> reply("could you tell me more?")
`);

  expect(flow.exported).toBe(true);
  expect(flow.name).toBe("support");
  expect(flow.params).toBe("(t: Ticket)");
  expect(flow.returnType).toBe("Action");

  expect(flow.bindings).toHaveLength(1);
  expect(flow.bindings[0]?.name).toBe("urgency");
  expect(flow.bindings[0]?.value).toMatchObject({
    kind: "ScoreExpr",
    text: "how urgent is this?",
    rubric: ["low", "medium", "high", "human"],
  });

  expect(flow.guards).toHaveLength(3);
  expect(flow.guards[0]?.condition).toMatchObject({
    kind: "Comparison",
    name: "urgency",
    operator: ">=",
    operand: { kind: "Label", name: "high" },
  });
  expect(flow.guards[0]?.threshold).toBeNull();
  expect(flow.guards[0]?.action).toMatchObject({ kind: "Island", text: "escalate(t)" });

  expect(flow.guards[1]?.threshold).toBe(0.7);
  expect(flow.guards[1]?.condition).toMatchObject({
    kind: "And",
    operands: [
      { kind: "BeliefLiteral", text: "the user is angry" },
      { kind: "BeliefLiteral", text: "the user asks for a refund" },
    ],
  });

  expect(flow.guards[2]?.condition).toBeNull();
});

test("a choice binding and a numeric level comparison", () => {
  const flow = firstFlow(`flow triage(t: Ticket): Action
  let intent = choice "what does the user want?" in refund | info

  intent == refund -> refund(t)
  urgency >= 2 -> escalate(t)
  _ -> reply("ok")
`);
  expect(flow.bindings[0]?.value).toMatchObject({
    kind: "ChoiceExpr",
    text: "what does the user want?",
    rubric: ["refund", "info"],
  });
  expect(flow.guards[0]?.condition).toMatchObject({
    kind: "Comparison",
    name: "intent",
    operator: "==",
    operand: { kind: "Label", name: "refund" },
  });
  expect(flow.guards[1]?.condition).toMatchObject({
    kind: "Comparison",
    name: "urgency",
    operator: ">=",
    operand: { kind: "Level", value: 2 },
  });
});

test("nested guard lists start on the line after the arrow", () => {
  const flow = firstFlow(`flow support(t: Ticket): Action
  "the user is angry" ->
    guards {
      "how urgent is this?" -> escalate(t)
      _ -> refund(t)
    }
  _ -> reply("ok")
`);

  expect(flow.guards).toHaveLength(2);
  const action = flow.guards[0]?.action;
  expect(action?.kind).toBe("GuardList");
  if (action?.kind !== "GuardList") throw new Error("expected a guard list");
  expect(action.guards).toHaveLength(2);
  expect(action.guards[0]?.action).toMatchObject({ kind: "Island", text: "escalate(t)" });
  expect(flow.guards[1]?.condition).toBeNull();
});

test("nested guard lists may also start on the guard's own line", () => {
  const flow = firstFlow(`flow support(t: Ticket): Action
  "the user is angry" -> guards {
    "how urgent is this?" -> escalate(t)
    _ -> refund(t)
  }
  _ -> reply("ok")
`);
  expect(flow.guards[0]?.action.kind).toBe("GuardList");
  expect(flow.guards[1]?.condition).toBeNull();
});

test("an action block keeps braces that live inside strings and comments", () => {
  const flow = firstFlow(`flow f(t: Ticket): Action
  "x" -> {
    // }}
    return c.json({ error: "}" }, 404)
  }
  _ -> reply("ok")
`);
  expect(flow.guards[0]?.action).toMatchObject({
    kind: "Island",
    text: `{\n    // }}\n    return c.json({ error: "}" }, 404)\n  }`,
  });
});

test("belief operators bind as ~ then & then |", () => {
  const flow = firstFlow(`flow f(t: Ticket): Action
  ~"a" & "b" | "c" -> reply("a")
  _ -> reply("b")
`);
  expect(flow.guards[0]?.condition).toMatchObject({
    kind: "Or",
    operands: [
      { kind: "And", operands: [{ kind: "Not" }, { kind: "BeliefLiteral", text: "b" }] },
      { kind: "BeliefLiteral", text: "c" },
    ],
  });
});

test("parentheses override the belief operators", () => {
  const flow = firstFlow(`flow f(t: Ticket): Action
  ~("a" & "b") -> reply("a")
  _ -> reply("b")
`);
  expect(flow.guards[0]?.condition).toMatchObject({
    kind: "Not",
    operand: { kind: "And" },
  });
});

test("`_foo` is an identifier, not the catch-all", () => {
  const flow = firstFlow(`flow f(t: Ticket): Action
  _foo -> reply("a")
  _ -> reply("b")
`);
  expect(flow.guards[0]?.condition).toMatchObject({ kind: "BeliefRef", name: "_foo" });
  expect(flow.guards[1]?.condition).toBeNull();
});

test("import and type declarations are kept as raw text, across lines", () => {
  const program = parseBel(`import {
  escalate,
  refund,
} from "./actions.ts"

type Ticket = {
  message: string
}

flow f(t: Ticket): Action
  _ -> reply("ok")
`);
  expect(program.body[0]).toMatchObject({
    kind: "ImportDecl",
    raw: `import {\n  escalate,\n  refund,\n} from "./actions.ts"`,
  });
  expect(program.body[1]).toMatchObject({
    kind: "TypeDecl",
    raw: `type Ticket = {\n  message: string\n}`,
  });
  expect(program.body[2]?.kind).toBe("FlowDecl");
});

test("mock beliefs accept levels, raw scores, choices and object overrides", () => {
  const program = parseBel(`mock beliefs
  "the user is angry" => 0.9
  "how urgent is this?" => 2
  "how urgent is this? (raw)" => 1.97
  "what does the user want?" => "refund"
  "with detail" => { score: 1.97, level: 2, confidence: 0.9 }

test "a name"
  assert support(t) is Explain("x")
`);
  expect(program.body[0]).toMatchObject({
    kind: "MockBeliefs",
    entries: [
      { question: "the user is angry", value: { kind: "Scalar", value: 0.9 } },
      { question: "how urgent is this?", value: { kind: "Scalar", value: 2 } },
      { question: "how urgent is this? (raw)", value: { kind: "Scalar", value: 1.97 } },
      { question: "what does the user want?", value: { kind: "Scalar", value: "refund" } },
      {
        question: "with detail",
        value: {
          kind: "Object",
          fields: { score: 1.97, level: 2, confidence: 0.9 },
        },
      },
    ],
  });
});

test("a test block captures its lines, floor blocks and cassette", () => {
  const program = parseBel(`test.snapshot "production behaviour"
  record "cassettes/support.v1.json"
  with confidence_floor 0.6
    assert support(t) is Escalate(_)
  action = support(t)
`);
  expect(program.body[0]).toMatchObject({
    kind: "TestSnapshot",
    name: "production behaviour",
    items: [
      { kind: "Record", path: "cassettes/support.v1.json" },
      {
        kind: "Floor",
        value: 0.6,
        items: [{ kind: "Line", text: "assert support(t) is Escalate(_)" }],
      },
      { kind: "Line", text: "action = support(t)" },
    ],
  });
});

test("routes are parsed, including path routes and the catch-all", () => {
  const program = parseBel(`route "refund and cancellation" @ 0.6 (c: Context) -> refund(c)
route "/health" (c: Context) -> c.json({ ok: true })
route _ (c: Context) -> c.json({ error: "unrouted" }, 404)
`);
  expect(program.body[0]).toMatchObject({
    kind: "RouteDecl",
    target: { kind: "Belief", text: "refund and cancellation" },
    threshold: 0.6,
    params: "(c: Context)",
    action: { kind: "Island", text: "refund(c)" },
  });
  expect(program.body[1]).toMatchObject({ target: { kind: "Path", text: "/health" } });
  expect(program.body[2]).toMatchObject({ target: { kind: "CatchAll", text: null } });
});

test("a missing return type is rejected", () => {
  expect(() => parseBel(`flow f(t: Ticket)\n  _ -> reply("ok")\n`)).toThrow(BelError);
});

test("a threshold outside 0..1 is rejected", () => {
  expect(() => parseBel(`flow f(t: Ticket): Action\n  "x" @ 1.5 -> reply("ok")\n`)).toThrow(
    /between 0 and 1/,
  );
});

test("spaces and tabs mixed in one guard list is rejected", () => {
  const source = `flow f(t: Ticket): Action\n  "a" -> reply("a")\n\t"b" -> reply("b")\n`;
  expect(() => parseBel(source)).toThrow(/mixed indentation/);
});

test("an unterminated action block is rejected", () => {
  expect(() => parseBel(`flow f(t: Ticket): Action\n  "x" -> {\n    return 1\n`)).toThrow(
    /unterminated action block/,
  );
});

test("diagnostics carry a line and column", () => {
  try {
    parseBel(`flow f(t: Ticket): Action\n  "x" ->\n`);
    throw new Error("expected a diagnostic");
  } catch (error) {
    if (!(error instanceof BelError)) throw error;
    expect(error.code).toBe("parse-error");
    expect(error.position?.line).toBe(2);
    expect(error.position?.column).toBeGreaterThan(1);
  }
});

test("an interface declaration is kept as raw text", () => {
  const program = parseBel(`interface Ticket {
  message: string
}

flow f(t: Ticket): Action
  _ -> reply("ok")
`);
  expect(program.body[0]).toMatchObject({
    kind: "TypeDecl",
    raw: `interface Ticket {\n  message: string\n}`,
  });
});

test("comparing a belief literal with a number is a syntax error", () => {
  expect(() => parseBel(`flow f(t: Ticket): Action\n  "x" > 0.8 -> reply("ok")\n`)).toThrow(
    /expected `->`/,
  );
});

test("a number must start with a digit", () => {
  expect(() => parseBel(`flow f(t: Ticket): Action\n  "x" @ .5 -> reply("ok")\n`)).toThrow(
    /expected a number/,
  );
});

test("threshold and indentation diagnostics carry their own codes", () => {
  const cases: [string, string][] = [
    [`flow f(t: Ticket): Action\n  "x" @ 1.5 -> reply("ok")\n`, "bad-threshold"],
    [`flow f(t: Ticket): Action\n  "a" -> reply("a")\n\t"b" -> reply("b")\n`, "indent-mixed"],
  ];
  for (const [source, code] of cases) {
    try {
      parseBel(source);
      throw new Error(`expected a ${code} error`);
    } catch (error) {
      if (!(error instanceof BelError)) throw error;
      expect(error.code).toBe(code);
    }
  }
});
