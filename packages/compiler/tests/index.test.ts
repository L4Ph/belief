import { expect, test } from "vite-plus/test";
import { parseBel } from "../src/index.ts";

test("the package exposes the parser", () => {
  const program = parseBel(`flow f(t: Ticket): Action\n  _ -> reply("ok")\n`);
  expect(program.body[0]?.kind).toBe("FlowDecl");
});
