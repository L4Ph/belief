import { noulConfidence } from "@bel/runtime";
import type { BelRuntime, Evaluation, Question } from "@bel/runtime";

export type MockValue =
  | number
  | string
  /** `{ score: 1.97, level: 2, confidence: 0.9 }` — specify whatever the bare forms cannot. */
  | { score?: number; level?: number; confidence?: number };

export type MockTable = Record<string, MockValue>;

/**
 * A runtime that answers from a table instead of a model.
 *
 * The key is a question's text, and the meaning of a value follows from the
 * question's type in the bel source:
 *
 * - `noul`: a probability, `0.9`
 * - `score`: an integer is a rubric level (`2`, answered with certainty); a
 *   decimal is the model's raw answer (`1.97`), from which the level is
 *   `round(1.97) = 2` and confidence is `1 - |1.97 - 2| = 0.97`
 * - `choice`: an option name, `"refund"`
 *
 * A question the table does not mention is an error, not a default: an
 * un-mocked belief would make the test pass for the wrong reason.
 */
export function createMockRuntime(table: MockTable): BelRuntime {
  return {
    async evaluate(questions: Question[]): Promise<Evaluation[]> {
      return questions.map((question) => {
        const mock = table[question.text];
        if (mock === undefined) {
          throw new Error(
            `no mock for \`${question.text}\`; add it to \`mock beliefs\` or drop the question`,
          );
        }
        switch (question.type) {
          case "noul":
            return noul(question, mock);
          case "score":
            return score(question, mock);
          case "choice":
            return choice(question, mock);
        }
      });
    },
  };
}

function noul(question: Question & { type: "noul" }, mock: MockValue): Evaluation {
  const value = typeof mock === "number" ? mock : undefined;
  if (value === undefined) {
    throw new Error(`mock for \`${question.text}\` must be a probability`);
  }
  return {
    id: question.id,
    type: "noul",
    text: question.text,
    value,
    confidence: noulConfidence(value),
  };
}

function score(question: Question & { type: "score" }, mock: MockValue): Evaluation {
  const levels = question.rubric.length;
  const explicit = typeof mock === "object" ? mock : {};
  const raw = explicit.score ?? (typeof mock === "number" ? mock : undefined);
  if (raw === undefined) throw new Error(`mock for \`${question.text}\` must be a number`);

  const level = explicit.level ?? (Number.isInteger(raw) ? raw : Math.round(raw));
  if (level < 0 || level >= levels) {
    throw new Error(`mock for \`${question.text}\` is level ${level}, outside [0, ${levels - 1}]`);
  }
  const confidence = explicit.confidence ?? 1 - Math.abs(raw - level);
  const probs = Array.from({ length: levels }, (_, index) => (index === level ? confidence : 0));
  return {
    id: question.id,
    type: "score",
    text: question.text,
    value: level,
    confidence,
    raw,
    probs,
  };
}

function choice(question: Question & { type: "choice" }, mock: MockValue): Evaluation {
  if (typeof mock !== "string") {
    throw new Error(`mock for \`${question.text}\` must be one of ${question.rubric.join(", ")}`);
  }
  if (!question.rubric.includes(mock)) {
    throw new Error(
      `mock for \`${question.text}\` is \`${mock}\`, not one of [${question.rubric.join(", ")}]`,
    );
  }
  return {
    id: question.id,
    type: "choice",
    text: question.text,
    value: mock,
    confidence: 1,
    probs: Object.fromEntries(question.rubric.map((name) => [name, name === mock ? 1 : 0])),
  };
}
