import { expect, test } from "vite-plus/test";
import { NAME } from "../src/index.ts";

test("testkit module loads", () => {
  expect(NAME).toBe("@bel/testkit");
});
