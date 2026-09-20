import { expect, test } from "vite-plus/test";
import { createJevRuntime } from "../src/jev.ts";
import type { Question } from "../src/types.ts";

const QUESTIONS: Question[] = [
  { id: "0", type: "noul", text: "the user is angry" },
  { id: "1", type: "score", text: "how urgent?", rubric: ["low", "medium", "high", "human"] },
  { id: "2", type: "choice", text: "what do they want?", rubric: ["refund", "info"] },
];

/** The shape the service actually returned for the probe that designed this. */
const ANSWER = {
  model: "jev-1.13.0",
  answers: {
    "0": { type: "noul", noul: 0.86 },
    "1": {
      type: "score",
      score: 1.97,
      confidence: 0.87,
      legend: { "0": "low", "1": "medium", "2": "high", "3": "human" },
      probabilities: { "0": 0, "1": 0.07, "2": 0.88, "3": 0.05 },
    },
    "2": {
      type: "choice",
      choice: "refund",
      confidence: 1,
      probabilities: { info: 0, refund: 1 },
    },
  },
};

function stubFetch(payload: unknown, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push({
      url: target,
      body: JSON.parse(typeof init?.body === "string" ? init.body : "null"),
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

test("questions are sent in the service's shape", async () => {
  const { calls, fetchImpl } = stubFetch(ANSWER);
  const runtime = createJevRuntime({ apiKey: "k", fetch: fetchImpl });
  await runtime.evaluate(QUESTIONS, { message: "hi" });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
  expect(calls[0]?.body).toEqual({
    model: "jev-latest",
    state: { message: "hi" },
    questions: {
      "0": { type: "noul", instructions: "the user is angry" },
      "1": {
        type: "score",
        instructions: "how urgent?",
        criteria: ["low", "medium", "high", "human"],
      },
      "2": {
        type: "choice",
        instructions: "what do they want?",
        criteria: { refund: "refund", info: "info" },
      },
    },
  });
});

test("a noul keeps its probability and gets the language's confidence", async () => {
  const runtime = createJevRuntime({ apiKey: "k", fetch: stubFetch(ANSWER).fetchImpl });
  const [noul] = await runtime.evaluate(QUESTIONS, {});
  expect(noul).toEqual({
    id: "0",
    type: "noul",
    text: "the user is angry",
    value: 0.86,
    confidence: 0.72,
  });
});

test("a score is the argmax level, not the raw float", async () => {
  const runtime = createJevRuntime({ apiKey: "k", fetch: stubFetch(ANSWER).fetchImpl });
  const [, score] = await runtime.evaluate(QUESTIONS, {});
  expect(score).toEqual({
    id: "1",
    type: "score",
    text: "how urgent?",
    value: 2,
    confidence: 0.87,
    raw: 1.97,
    probs: [0, 0.07, 0.88, 0.05],
  });
});

test("a choice keeps the option name and its distribution", async () => {
  const runtime = createJevRuntime({ apiKey: "k", fetch: stubFetch(ANSWER).fetchImpl });
  const [, , choice] = await runtime.evaluate(QUESTIONS, {});
  expect(choice).toEqual({
    id: "2",
    type: "choice",
    text: "what do they want?",
    value: "refund",
    confidence: 1,
    probs: { info: 0, refund: 1 },
  });
});

test("the resolved model is reported", async () => {
  const runtime = createJevRuntime({ apiKey: "k", fetch: stubFetch(ANSWER).fetchImpl });
  expect(runtime.resolvedModel()).toBeNull();
  await runtime.evaluate(QUESTIONS, {});
  expect(runtime.resolvedModel()).toBe("jev-1.13.0");
});

test("an overloaded service is retried", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls < 3) return new Response("{}", { status: 529 });
    return new Response(JSON.stringify(ANSWER), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  const runtime = createJevRuntime({ apiKey: "k", fetch: fetchImpl, retries: 3 });
  const evaluations = await runtime.evaluate(QUESTIONS, {});
  expect(calls).toBe(3);
  expect(evaluations).toHaveLength(3);
});

test("a missing answer is an error", async () => {
  const runtime = createJevRuntime({
    apiKey: "k",
    fetch: stubFetch({ model: "m", answers: {} }).fetchImpl,
  });
  await expect(runtime.evaluate(QUESTIONS, {})).rejects.toThrow(/did not answer/);
});

test("an error status is reported with its body", async () => {
  const runtime = createJevRuntime({
    apiKey: "k",
    fetch: stubFetch({ error: "nope" }, 500).fetchImpl,
  });
  await expect(runtime.evaluate(QUESTIONS, {})).rejects.toThrow(/returned 500/);
});

test("a missing api key is an error", async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const runtime = createJevRuntime({ fetch: stubFetch(ANSWER).fetchImpl });
    await expect(runtime.evaluate(QUESTIONS, {})).rejects.toThrow(/TYPESAFE_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
  }
});

test("the TYPE_SAFE_API_KEY spelling is accepted too", async () => {
  const previous = process.env.TYPE_SAFE_API_KEY;
  process.env.TYPE_SAFE_API_KEY = "k";
  try {
    const runtime = createJevRuntime({ fetch: stubFetch(ANSWER).fetchImpl });
    await expect(runtime.evaluate(QUESTIONS, {})).resolves.toHaveLength(3);
  } finally {
    if (previous === undefined) delete process.env.TYPE_SAFE_API_KEY;
    else process.env.TYPE_SAFE_API_KEY = previous;
  }
});
