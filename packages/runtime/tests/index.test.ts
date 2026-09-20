import { expect, test } from "vite-plus/test";
import { noulConfidence } from "../src/index.ts";

test("noulConfidence is 0 at p=0.5 and 1 at the extremes", () => {
  expect(noulConfidence(0.5)).toBe(0);
  expect(noulConfidence(1)).toBe(1);
  expect(noulConfidence(0)).toBe(1);
});

test("noulConfidence on the measured probe value", () => {
  expect(noulConfidence(0.86)).toBeCloseTo(0.72);
});
