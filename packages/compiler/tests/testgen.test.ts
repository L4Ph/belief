import { expect, test } from "vite-plus/test";
import { BelError } from "../src/ast.ts";
import { parseBel } from "../src/parser.ts";
import { generateTests } from "../src/testgen.ts";

function generate(source: string): string | null {
  return generateTests(parseBel(source), { source, fileName: "support.bel" });
}

const FLOW = `import { escalate, refund, reply, type Action, type Ticket } from "./actions.ts"

export flow support(t: Ticket): Action
  let urgency = score "how urgent is this?" in low | medium | high | human

  urgency >= high -> escalate(t)
  "the user is angry" -> refund(t)
  _ -> reply("could you tell me more?")
`;

test("a file with no tests generates nothing", () => {
  expect(generate(FLOW)).toBeNull();
});

test("a mock test installs the table and lowers the assertion", () => {
  const output = generate(`${FLOW}
mock beliefs
  "how urgent is this?" => 1
  "the user is angry" => 0.9

test "an angry user is refunded"
  action = await support(fakeTicket)
  assert action is Refund(_)
`);
  expect(output).toContain(`import { expect, test } from "vite-plus/test";`);
  expect(output).toContain(`import { configureBel, resetBel } from "@bel/runtime";`);
  expect(output).toContain(`import { createMockRuntime } from "@bel/testkit";`);
  expect(output).toContain(`import { support } from "./support.bel.ts";`);
  expect(output).toContain(`createMockRuntime({
      "how urgent is this?": 1,
      "the user is angry": 0.9,
    })`);
  expect(output).toContain("const action = await support(fakeTicket);");
  expect(output).toContain(`expect($actual?.type).toBe("Refund");`);
  expect(output).toContain(`expect($actual?.args).toHaveLength(1);`);
  expect(output).not.toContain("args?.[0]");
});

test("a concrete argument is compared", () => {
  const output = generate(`${FLOW}
mock beliefs
  "how urgent is this?" => 3
  "the user is angry" => 0.9

test "names the reason"
  assert (await support(fakeTicket)) is Explain("refund window has passed")
`);
  expect(output).toContain(`expect($actual?.args?.[0]).toEqual("refund window has passed");`);
});

test("`is _` only checks that something came back", () => {
  const output = generate(`${FLOW}
mock beliefs
  "how urgent is this?" => 3
  "the user is angry" => 0.9

test "anything"
  assert (await support(fakeTicket)) is _
`);
  expect(output).toContain("expect($actual).not.toBeUndefined();");
});

test("a confidence floor block restores the previous floor", () => {
  const output = generate(`${FLOW}
mock beliefs
  "how urgent is this?" => 1
  "the user is angry" => 0.9

test "unsure decisions"
  with confidence_floor 0.6
    assert (await support(fakeTicket)) is _
`);
  expect(output).toContain("const $floor = __bel.floor;");
  expect(output).toContain("__bel.floor = 0.6;");
  expect(output).toContain("__bel.floor = $floor;");
  expect(output).toContain(`import { configureBel, resetBel, __bel } from "@bel/runtime";`);
});

test("a snapshot test installs a cassette", () => {
  const output = generate(`${FLOW}
test.snapshot "production behaviour"
  record "cassettes/support.v1.json"
  assert (await support(fakeTicket)) is _
`);
  expect(output).toContain(
    `createCassetteRuntime({ path: new URL("cassettes/support.v1.json", import.meta.url) })`,
  );
  expect(output).not.toContain("createMockRuntime");
});

test("a flow called from an action island is followed", () => {
  const output = generate(`flow inner(t: Ticket): Action
  "whether it is cold" -> reply("cold")
  _ -> reply("warm")

flow outer(t: Ticket): Action
  "whether the user is angry" -> inner(t)
  _ -> reply("ok")

mock beliefs
  "whether the user is angry" => 0.9
  "whether it is cold" => 0.2

test "outer reaches inner"
  assert (await outer(fakeTicket)) is Reply("cold")
`);
  expect(output).toContain(`createMockRuntime({
      "whether the user is angry": 0.9,
      "whether it is cold": 0.2,
    })`);
});

test("a question with no mock entry is reported", () => {
  expect(() =>
    generate(`${FLOW}
mock beliefs
  "how urgent is this?" => 1

test "angry"
  assert (await support(fakeTicket)) is _
`),
  ).toThrow(/mock beliefs` does not list/);
});

test("a mock entry no test reaches is reported", () => {
  expect(() =>
    generate(`${FLOW}
mock beliefs
  "how urgent is this?" => 1
  "the user is angry" => 0.9
  "nobody asks this" => 0.5

test "angry"
  assert (await support(fakeTicket)) is _
`),
  ).toThrow(/which no test reaches/);
});

test("a test with no answers is reported", () => {
  expect(() =>
    generate(`${FLOW}
test "angry"
  assert (await support(fakeTicket)) is _
`),
  ).toThrow(/has no answers/);
});

test("a snapshot without a recording path is reported", () => {
  expect(() =>
    generate(`${FLOW}
test.snapshot "production"
  assert (await support(fakeTicket)) is _
`),
  ).toThrow(/needs a `record/);
});

test("diagnostics carry their codes", () => {
  try {
    generate(`${FLOW}
test "angry"
  assert (await support(fakeTicket)) is _
`);
    throw new Error("expected a BelError");
  } catch (error) {
    if (!(error instanceof BelError)) throw error;
    expect(error.code).toBe("test-without-answers");
  }
});
