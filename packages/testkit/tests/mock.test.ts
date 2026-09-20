import { expect, test } from "vite-plus/test";
import { createMockRuntime } from "../src/mock.ts";
import type { Question } from "@bel/runtime";

const QUESTIONS: Question[] = [
  { id: "0", type: "noul", text: "angry" },
  { id: "1", type: "score", text: "urgent", rubric: ["low", "medium", "high", "human"] },
  { id: "2", type: "choice", text: "intent", rubric: ["refund", "info"] },
];

test("an integer score mock is a level, answered with certainty", async () => {
  const runtime = createMockRuntime({ urgent: 2 });
  const [evaluation] = await runtime.evaluate([QUESTIONS[1] as Question], {});
  expect(evaluation).toMatchObject({ value: 2, confidence: 1, raw: 2, probs: [0, 0, 1, 0] });
});

test("a decimal score mock is the raw answer", async () => {
  const runtime = createMockRuntime({ urgent: 1.97 });
  const [evaluation] = await runtime.evaluate([QUESTIONS[1] as Question], {});
  expect(evaluation).toMatchObject({ value: 2, raw: 1.97 });
  expect((evaluation as { confidence: number }).confidence).toBeCloseTo(0.97);
});

test("an object mock overrides every field", async () => {
  const runtime = createMockRuntime({ urgent: { score: 1.97, level: 1, confidence: 0.4 } });
  const [evaluation] = await runtime.evaluate([QUESTIONS[1] as Question], {});
  expect(evaluation).toMatchObject({ value: 1, confidence: 0.4, raw: 1.97 });
});

test("a noul mock gets the language's confidence", async () => {
  const runtime = createMockRuntime({ angry: 0.9 });
  const [evaluation] = await runtime.evaluate([QUESTIONS[0] as Question], {});
  expect(evaluation).toMatchObject({ value: 0.9, confidence: expect.closeTo(0.8) });
});

test("an unmocked question fails instead of defaulting", async () => {
  const runtime = createMockRuntime({});
  await expect(runtime.evaluate([QUESTIONS[0] as Question], {})).rejects.toThrow(/no mock for/);
});

test("an out-of-range level is rejected", async () => {
  const runtime = createMockRuntime({ urgent: 9 });
  await expect(runtime.evaluate([QUESTIONS[1] as Question], {})).rejects.toThrow(/outside/);
});

test("an unknown choice is rejected", async () => {
  const runtime = createMockRuntime({ intent: "shrug" });
  await expect(runtime.evaluate([QUESTIONS[2] as Question], {})).rejects.toThrow(/not one of/);
});
