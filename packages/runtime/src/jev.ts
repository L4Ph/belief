import { noulConfidence } from "./types.ts";
import type { BelRuntime, Evaluation, Question } from "./types.ts";

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

export type JevOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Total attempts, including the first. */
  retries?: number;
  timeoutMs?: number;
};

export type JevRuntime = BelRuntime & {
  /** The concrete model the service resolved `jev-latest` to, once it has answered. */
  resolvedModel(): string | null;
};

/**
 * The live TypeSafe System One transport.
 *
 * Configuration is read from `TYPESAFE_API_KEY`, `BEL_MODEL` and `BEL_API_URL`
 * when the caller does not pass them. `model: "jev-latest"` is an alias; the
 * response reports the resolved build, which cassettes record so that a model
 * upgrade shows up as a diff rather than as a silently changed replay.
 */
export function createJevRuntime(options: JevOptions = {}): JevRuntime {
  const doFetch = options.fetch ?? globalThis.fetch;
  let resolved: string | null = null;

  return {
    resolvedModel: () => resolved,

    async evaluate(questions: Question[], state: unknown): Promise<Evaluation[]> {
      if (questions.length === 0) return [];

      const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
      if (apiKey === undefined || apiKey === "") {
        throw new Error(
          "TYPESAFE_API_KEY is not set. Set it, or configure another runtime with configureBel().",
        );
      }

      const model = options.model ?? process.env.BEL_MODEL ?? DEFAULT_MODEL;
      const baseUrl = options.baseUrl ?? process.env.BEL_API_URL ?? DEFAULT_BASE_URL;
      const body = JSON.stringify({ model, state, questions: jevQuestions(questions) });
      const attempts = options.retries ?? DEFAULT_RETRIES;

      let lastError: unknown = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const response = await doFetch(baseUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });

        if (response.status === 429 || response.status === 529) {
          lastError = new Error(`TypeSafe is overloaded (${response.status})`);
          await sleep(400 * (attempt + 1));
          continue;
        }

        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            `TypeSafe returned ${response.status}: ${truncate(JSON.stringify(payload))}`,
          );
        }

        resolved = stringField(payload, "model") ?? resolved;
        return questions.map((question) => readAnswer(question, payload));
      }

      throw lastError ?? new Error("TypeSafe is overloaded");
    },
  };
}

/** bel's question shape, in the shape the service expects. */
function jevQuestions(questions: Question[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const question of questions) {
    if (question.type === "noul") {
      out[question.id] = { type: "noul", instructions: question.text };
      continue;
    }
    out[question.id] = {
      type: question.type,
      instructions: question.text,
      criteria:
        question.type === "score"
          ? question.rubric
          : Object.fromEntries(question.rubric.map((name) => [name, name])),
    };
  }
  return out;
}

function readAnswer(question: Question, payload: unknown): Evaluation {
  const answers = objectField(payload, "answers");
  const answer = answers?.[question.id];
  if (answer === undefined) {
    throw new Error(`TypeSafe did not answer \`${question.text}\``);
  }
  const record = answer as Record<string, unknown>;
  const confidence = numberField(record, "confidence");

  if (question.type === "noul") {
    const value = numberField(record, "noul");
    if (value === null) throw new Error(`TypeSafe answered \`${question.text}\` without a noul`);
    return {
      id: question.id,
      type: "noul",
      text: question.text,
      value,
      confidence: noulConfidence(value),
    };
  }

  if (question.type === "score") {
    const raw = numberField(record, "score");
    const probs = levelProbabilities(record, question.rubric.length);
    const mass = probs.reduce((sum, p) => sum + p, 0);
    if (raw === null && mass === 0) {
      throw new Error(`TypeSafe answered \`${question.text}\` without a score`);
    }
    const value = mass > 0 ? argmax(probs) : Math.round(raw as number);
    return {
      id: question.id,
      type: "score",
      text: question.text,
      value,
      // Without a distribution there is nothing to be confident about.
      confidence: confidence ?? probs[value] ?? 0,
      raw: raw ?? value,
      probs,
    };
  }

  const probabilities = stringProbabilities(record);
  const choice = stringField(record, "choice") ?? argmaxKey(probabilities);
  if (choice === null) throw new Error(`TypeSafe answered \`${question.text}\` without a choice`);
  return {
    id: question.id,
    type: "choice",
    text: question.text,
    value: choice,
    confidence: confidence ?? probabilities[choice] ?? 0,
    probs: probabilities,
  };
}

/** `probabilities: {"0": 0.07, …}` -> `[0, 0.07, …]`, in rubric order. */
function levelProbabilities(answer: Record<string, unknown>, levels: number): number[] {
  const source = objectField(answer, "probabilities") ?? {};
  return Array.from({ length: levels }, (_, index) => numberField(source, String(index)) ?? 0);
}

function stringProbabilities(answer: Record<string, unknown>): Record<string, number> {
  const source = objectField(answer, "probabilities") ?? {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

function argmax(values: number[]): number {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index] as number) > (values[best] as number)) best = index;
  }
  return best;
}

function argmaxKey(values: Record<string, number>): string | null {
  let best: string | null = null;
  for (const [key, value] of Object.entries(values)) {
    if (best === null || value > (values[best] as number)) best = key;
  }
  return best;
}

function objectField(source: unknown, key: string): Record<string, unknown> | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function numberField(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" ? value : null;
}

function stringField(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
