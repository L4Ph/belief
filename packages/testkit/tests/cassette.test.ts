import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import type { BelRuntime, Evaluation, Question } from "@bel/runtime";
import { createCassetteRuntime, readCassette } from "../src/cassette.ts";

const QUESTIONS: Question[] = [{ id: "0", type: "noul", text: "angry" }];

function answers(value: number): BelRuntime {
  return {
    async evaluate(questions: Question[]): Promise<Evaluation[]> {
      return questions.map((question) => ({
        id: question.id,
        type: "noul" as const,
        text: question.text,
        value,
        confidence: 0.5,
      }));
    },
  };
}

function tempCassette(): string {
  return join(mkdtempSync(join(tmpdir(), "bel-cassette-")), "support.v1.json");
}

test("recording writes the answer, the questions and the model", async () => {
  const path = tempCassette();
  const runtime = createCassetteRuntime({ path, record: true, transport: answers(0.9) });
  const evaluations = await runtime.evaluate(QUESTIONS, { message: "hi" });
  expect(evaluations[0]).toMatchObject({ value: 0.9 });

  const file = JSON.parse(readFileSync(path, "utf8"));
  expect(file.version).toBe(1);
  expect(file.model).toBe("jev-latest");
  expect(Object.keys(file.entries)).toHaveLength(1);
  expect(readCassette(path).entries).toBe(1);
});

test("replay returns the recorded answer without a transport", async () => {
  const path = tempCassette();
  await createCassetteRuntime({ path, record: true, transport: answers(0.9) }).evaluate(QUESTIONS, {
    message: "hi",
  });

  const replayed = await createCassetteRuntime({ path }).evaluate(QUESTIONS, { message: "hi" });
  expect(replayed[0]).toMatchObject({ value: 0.9 });
});

test("a different state is a different recording", async () => {
  const path = tempCassette();
  await createCassetteRuntime({ path, record: true, transport: answers(0.9) }).evaluate(QUESTIONS, {
    message: "hi",
  });

  const missing = createCassetteRuntime({ path });
  await expect(missing.evaluate(QUESTIONS, { message: "other" })).rejects.toThrow(
    /no recording for this request/,
  );
});

test("key order in the state does not change the key", async () => {
  const path = tempCassette();
  await createCassetteRuntime({ path, record: true, transport: answers(0.4) }).evaluate(QUESTIONS, {
    a: 1,
    b: 2,
  });
  const replayed = await createCassetteRuntime({ path }).evaluate(QUESTIONS, { b: 2, a: 1 });
  expect(replayed[0]).toMatchObject({ value: 0.4 });
});

test("recording twice does not duplicate the entry", async () => {
  const path = tempCassette();
  const options = { path, record: true, transport: answers(0.9) };
  await createCassetteRuntime(options).evaluate(QUESTIONS, {});
  await createCassetteRuntime(options).evaluate(QUESTIONS, {});
  expect(readCassette(path).entries).toBe(1);
});

test("a missing cassette is empty rather than an error", () => {
  expect(readCassette(tempCassette())).toEqual({ model: null, entries: 0 });
});

test("a malformed cassette is reported", async () => {
  const path = tempCassette();
  writeFileSync(path, "[]");
  expect(() => readCassette(path)).not.toThrow();
  await expect(createCassetteRuntime({ path }).evaluate(QUESTIONS, {})).rejects.toThrow(
    /no recording/,
  );
});
