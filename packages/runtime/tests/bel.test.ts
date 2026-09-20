import { expect, test } from "vite-plus/test";
import { __bel, configureBel, resetBel, trace } from "../src/bel.ts";
import type { BelRuntime, Evaluation, Question } from "../src/types.ts";

function stubRuntime(values: number[]): BelRuntime & { calls: number } {
  const runtime = {
    calls: 0,
    async evaluate(questions: Question[]): Promise<Evaluation[]> {
      runtime.calls += 1;
      return questions.map((question, index) => {
        const value = values[index] ?? 0;
        return {
          id: question.id,
          type: "noul" as const,
          text: question.text,
          value,
          confidence: Math.abs(value - 0.5) * 2,
        };
      });
    },
  };
  return runtime;
}

const QUESTIONS: Question[] = [
  { id: "0", type: "noul", text: "a" },
  { id: "1", type: "noul", text: "b" },
];

test("composition is the arithmetic from the RFC", () => {
  expect(__bel.composeAnd(0.5, 0.5)).toBe(0.25);
  expect(__bel.composeOr(0.5, 0.5)).toBe(0.75);
  expect(__bel.negate(0.3)).toBeCloseTo(0.7);
  expect(__bel.det(true)).toBe(1);
  expect(__bel.det(false)).toBe(0);
});

test("composition accepts an evaluation as an operand", async () => {
  const runtime = stubRuntime([0.8, 0.5]);
  configureBel(runtime);
  const [a, b] = await __bel.evaluate(QUESTIONS, {});
  if (a === undefined || b === undefined) throw new Error("expected two evaluations");
  expect(__bel.composeAnd(a, b)).toBeCloseTo(0.4);
  expect(__bel.composeOr(a, b)).toBeCloseTo(0.9);
  expect(__bel.composeAnd(a, 0.5)).toBeCloseTo(0.4);
});

test("a confidence floor turns an unsure evaluation into nothing", async () => {
  configureBel({ runtime: stubRuntime([0.55, 0.9]) });
  __bel.floor = 0.6;
  const [unsure, sure] = await __bel.evaluate(QUESTIONS, {});
  expect(unsure?.value).toBe(0);
  expect(sure?.value).toBe(0.9);
  __bel.floor = 0;
});

test("the floor is read at evaluation time, not at configuration time", async () => {
  configureBel({ runtime: stubRuntime([0.55]) });
  __bel.floor = 0.9;
  const [evaluation] = await __bel.evaluate([QUESTIONS[0] as Question], {});
  expect(evaluation?.value).toBe(0);
  __bel.floor = 0;
});

test("a trace records the questions and the guard that fired", async () => {
  const runtime = stubRuntime([0.8, 0.5]);
  configureBel(runtime);
  await __bel.evaluate(QUESTIONS, {});
  __bel.mark("f", 1);
  expect(trace()).toEqual([
    {
      flow: "f",
      evaluations: [
        { id: "0", text: "a", value: 0.8, confidence: expect.closeTo(0.6) },
        { id: "1", text: "b", value: 0.5, confidence: 0 },
      ],
      takenGuard: 1,
    },
  ]);
});

test("the trace buffer is bounded", async () => {
  configureBel({ runtime: stubRuntime([0.5]), traceLimit: 2 });
  for (const flow of ["a", "b", "c"]) {
    await __bel.evaluate([QUESTIONS[0] as Question], {});
    __bel.mark(flow, 0);
  }
  expect(trace().map((entry) => entry.flow)).toEqual(["b", "c"]);
});

test("a flow with no questions still traces which guard fired", () => {
  configureBel(stubRuntime([]));
  __bel.mark("empty", 0);
  expect(trace().at(-1)).toEqual({ flow: "empty", evaluations: [], takenGuard: 0 });
});

test("resetBel restores the defaults", async () => {
  const runtime = stubRuntime([0.1]);
  configureBel(runtime);
  await __bel.evaluate(QUESTIONS, {});
  __bel.mark("f", 0);
  resetBel();
  expect(trace()).toEqual([]);
  expect(__bel.floor).toBe(0);
});
