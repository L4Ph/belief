import { expect, test } from "vite-plus/test";
import { NAME } from "../src/index.ts";

test("compiler module loads", () => {
  expect(NAME).toBe("@bel/compiler");
});
