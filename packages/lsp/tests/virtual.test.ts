import { expect, test } from "vite-plus/test";
import { buildVirtualDocument, toBelOffset, toVirtualOffset } from "../src/virtual.ts";

const SOURCE = `import { escalate, refund, reply, type Action, type Ticket } from "./actions.ts"

type Note = { text: string }

export flow support(t: Ticket): Action
  let urgency = score "how urgent?" in low | high

  urgency >= high -> escalate(t)
  "the user is angry" -> {
    const level = urgency >= 2 ? "high" : "low"
    return reply(level)
  }
  _ -> reply("ok")

test "a ticket"
  ticket = { text: "hello" } as Ticket
  assert (await support(ticket)) is Reply(_)
`;

function document() {
  const built = buildVirtualDocument(SOURCE);
  if (built === null) throw new Error("expected a virtual document");
  return built;
}

test("the module's own TypeScript is handed over as it is", () => {
  const built = document();
  expect(built.text).toContain(
    `import { escalate, refund, reply, type Action, type Ticket } from "./actions.ts"\n`,
  );
  expect(built.text).toContain("type Note = { text: string }");
});

test("each flow becomes a function with its bindings declared", () => {
  const built = document();
  expect(built.text).toContain("export async function support(t: Ticket): Promise<Action> {");
  expect(built.text).toContain("const urgency = 0;");
});

test("an expression island becomes a statement, a block island stays one", () => {
  const built = document();
  expect(built.text).toContain("escalate(t);");
  expect(built.text).toContain(
    `{\n    const level = urgency >= 2 ? "high" : "low"\n    return reply(level)\n  }`,
  );
});

test("bel sugar in a test body is dropped and its TypeScript kept", () => {
  const built = document();
  expect(built.text).toContain(`const ticket = { text: "hello" } as Ticket;`);
  expect(built.text).toContain("  (await support(ticket));");
  expect(built.text).not.toContain("assert");
});

test("offsets inside an expression island map both ways", () => {
  const built = document();
  const bel = SOURCE.indexOf("escalate(t)");
  const virtual = toVirtualOffset(built, bel);
  if (virtual === null) throw new Error("expected a mapping");
  expect(built.text.slice(virtual, virtual + 8)).toBe("escalate");
  expect(toBelOffset(built, virtual)).toBe(bel);
});

test("offsets inside a block island map both ways", () => {
  const built = document();
  const bel = SOURCE.indexOf('"high" : "low"');
  const virtual = toVirtualOffset(built, bel);
  if (virtual === null) throw new Error("expected a mapping");
  expect(built.text.slice(virtual, virtual + 6)).toBe('"high"');
  expect(toBelOffset(built, virtual)).toBe(bel);
});

test("offsets inside the module's own TypeScript map both ways", () => {
  const built = document();
  const bel = SOURCE.indexOf("type Note");
  const virtual = toVirtualOffset(built, bel);
  if (virtual === null) throw new Error("expected a mapping");
  expect(built.text.slice(virtual, virtual + 9)).toBe("type Note");
  expect(toBelOffset(built, virtual)).toBe(bel);
});

test("offsets in bel text have no counterpart", () => {
  const built = document();
  // the guard condition itself is not TypeScript
  expect(toVirtualOffset(built, SOURCE.indexOf("urgency >= high"))).toBeNull();
});

test("a source that does not parse has no virtual document", () => {
  expect(buildVirtualDocument('flow f(t: Ticket)\n  _ -> reply("ok")\n')).toBeNull();
});

test("the signature is a position the server can be asked about", () => {
  const built = document();
  const bel = SOURCE.indexOf("(t: Ticket)");
  const virtual = toVirtualOffset(built, bel);
  if (virtual === null) throw new Error("expected a mapping");
  expect(built.text.slice(virtual, virtual + 11)).toBe("(t: Ticket)");
  expect(built.text.slice(virtual + 4, virtual + 10)).toBe("Ticket");
});

test("every region maps back to itself", () => {
  const built = document();
  for (const region of built.regions) {
    expect(toVirtualOffset(built, region.belStart)).toBe(region.virtualStart);
    expect(toBelOffset(built, region.virtualStart)).toBe(region.belStart);
  }
});
