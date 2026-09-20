import { expect, test } from "vite-plus/test";
import { parseBel } from "../src/index.ts";

test("the package exposes the parser", () => {
  const program = parseBel(`flow f(t: Ticket): Action\n  _ -> reply("ok")\n`);
  expect(program.body[0]?.kind).toBe("FlowDecl");
});

test("the package exposes the compiler and the test generator", async () => {
  const api = await import("../src/index.ts");
  expect(typeof api.generate).toBe("function");
  expect(typeof api.generateTests).toBe("function");
});
