import { afterEach, expect, test } from "vite-plus/test";
import { configureBel, resetBel } from "@bel/runtime";
import type { Evaluation, Question } from "@bel/runtime";
import { createMockRuntime } from "@bel/testkit";
import { createApp, routeQuestion, type BelRoute } from "../src/index.ts";

afterEach(() => resetBel());

/** Answers from a table keyed by description; the keys of `probabilities` are descriptions. */
function jev(probabilities: Record<string, number>) {
  configureBel(
    createMockRuntime(
      Object.fromEntries(
        Object.entries(probabilities).map(([description, value]) => [
          routeQuestion(description),
          value,
        ]),
      ),
    ),
  );
}

const DOCS = "a visitor asking for the docs";
const PRICING = "a visitor asking for pricing";

/** A runtime that records the state Jev was given, and answers `value` to everything. */
function capture(value: number) {
  const seen: { headers?: Record<string, string> } = {};
  configureBel({
    evaluate: async (questions: Question[], state: unknown): Promise<Evaluation[]> => {
      seen.headers = (state as { headers: Record<string, string> }).headers;
      return questions.map((question) => ({
        id: question.id,
        type: "noul",
        text: question.text,
        value,
        confidence: 0.5,
      }));
    },
  });
  return seen;
}

const table = (extra: BelRoute[] = []): BelRoute[] => [
  { description: DOCS, handler: (c) => c.text("docs") },
  { description: PRICING, handler: (c) => c.text("pricing") },
  { path: "/health", handler: (c) => c.text("ok") },
  { fallback: (c) => c.text(`nothing matched ${c.get("jev")?.route ?? "anything"}`, 404) },
  ...extra,
];

test("a table becomes an app: descriptions and paths answer", async () => {
  jev({ [DOCS]: 0.01, [PRICING]: 0.9 });
  const app = createApp(table());
  expect(await (await app.request("/anything")).text()).toBe("pricing");
  expect(await (await app.request("/health")).text()).toBe("ok");
});

test("nothing over the threshold reaches the fallback", async () => {
  jev({ [DOCS]: 0.01, [PRICING]: 0.01 });
  const missed = await createApp(table()).request("/anything");
  expect(missed.status).toBe(404);
  expect(await missed.text()).toBe("nothing matched anything");
});

test("the first description over the threshold wins, not the highest", async () => {
  jev({ [DOCS]: 0.6, [PRICING]: 0.99 });
  expect(await (await createApp(table()).request("/")).text()).toBe("docs");
});

test("a per-route threshold beats the app default, in both directions", async () => {
  jev({ [DOCS]: 0.6, [PRICING]: 0.6 });
  const strict: BelRoute[] = [
    { description: DOCS, threshold: 0.9, handler: (c) => c.text("docs") },
    { description: PRICING, handler: (c) => c.text("pricing") },
  ];
  // docs is first but under its own 0.9, so the next route over 0.5 answers.
  expect(await (await createApp(strict).request("/")).text()).toBe("pricing");
  // With the app default raised, pricing (0.6) no longer qualifies.
  const missed = await createApp(strict, { threshold: 0.7 }).request("/");
  expect(missed.status).toBe(404);
});

test("a path route answers without asking", async () => {
  configureBel({
    evaluate: async () => {
      throw new Error("a path route must not ask the model");
    },
  });
  const app = createApp(table());
  expect(await (await app.request("/health")).text()).toBe("ok");
});

test("the handler sees the decision", async () => {
  jev({ [DOCS]: 0.8 });
  const routes: BelRoute[] = [{ description: DOCS, handler: (c) => c.json(c.get("jev")) }];
  const body = (await (await createApp(routes).request("/")).json()) as {
    route: string;
    confidence: number;
  };
  expect(body.route).toBe(DOCS);
  expect(body.confidence).toBe(0.8);
});

test("sensitive headers are redacted, and the handler still sees the real value", async () => {
  const seen = capture(0.9);
  const routes: BelRoute[] = [
    { description: DOCS, handler: (c) => c.text(c.req.header("Authorization") ?? "") },
  ];
  const response = await createApp(routes).request("/", {
    headers: { Authorization: "Bearer secret", Cookie: "session=secret", Accept: "text/html" },
  });
  expect(seen.headers).toEqual({
    authorization: "[redacted]",
    cookie: "[redacted]",
    accept: "text/html",
  });
  expect(await response.text()).toBe("Bearer secret");
});

test("redactHeaders adds to the defaults instead of replacing them", async () => {
  const seen = capture(0.9);
  const app = createApp([{ description: DOCS, handler: (c) => c.text("ok") }], {
    redactHeaders: ["X-Internal"],
  });
  await app.request("/", {
    headers: { "X-Internal": "topsecret", Authorization: "Bearer secret", Accept: "text/html" },
  });
  expect(seen.headers).toEqual({
    "x-internal": "[redacted]",
    authorization: "[redacted]",
    accept: "text/html",
  });
});

test("only textual bodies are shown to Jev", async () => {
  const bodies: Record<string, string | undefined> = {};
  configureBel({
    evaluate: async (questions: Question[], state: unknown): Promise<Evaluation[]> => {
      const seen = state as { headers: Record<string, string>; body?: string };
      bodies[seen.headers["content-type"] as string] = seen.body;
      return questions.map((question) => ({
        id: question.id,
        type: "noul",
        text: question.text,
        value: 0.01,
        confidence: 0.5,
      }));
    },
  });
  const app = createApp([{ description: DOCS, handler: (c) => c.text("ok") }]);
  const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  for (const contentType of [
    "Application/JSON; charset=utf-8",
    "application/ld+json",
    "image/svg+xml",
    "application/x-www-form-urlencoded",
    xlsx,
    "application/octet-stream",
  ]) {
    await app.request("/", {
      method: "POST",
      body: "hello",
      headers: { "Content-Type": contentType },
    });
  }
  expect(bodies).toEqual({
    "Application/JSON; charset=utf-8": "hello",
    "application/ld+json": "hello",
    "image/svg+xml": "hello",
    "application/x-www-form-urlencoded": "hello",
    [xlsx]: `[5 bytes of ${xlsx}]`,
    "application/octet-stream": "[5 bytes of application/octet-stream]",
  });
});

test("a handler can still read the body, even a binary one", async () => {
  jev({ [DOCS]: 0.9 });
  const app = createApp([
    { description: DOCS, handler: async (c) => c.body(await c.req.arrayBuffer()) },
  ]);
  const bytes = new Uint8Array([0xff, 0xd8, 0x00, 0xfe, 0x80]);
  const binary = await app.request("/upload", {
    method: "POST",
    body: bytes,
    headers: { "Content-Type": "image/jpeg" },
  });
  expect(new Uint8Array(await binary.arrayBuffer())).toEqual(bytes);
});
