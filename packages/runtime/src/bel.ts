import { createJevRuntime } from "./jev.ts";
import { noulConfidence } from "./types.ts";
import type { BelRuntime, Evaluation, Question, Trace, TraceEvaluation } from "./types.ts";

export type BelConfig = {
  runtime: BelRuntime;
  /**
   * Evaluations whose confidence is below this are treated as not holding.
   * `with confidence_floor n` sets it around a block. Test-only.
   */
  floor?: number;
  /** How many traces the ring buffer keeps. */
  traceLimit?: number;
};

/** The default number of traces kept. */
const DEFAULT_TRACE_LIMIT = 64;

let config: BelConfig | null = null;
let pending: TraceEvaluation[] | null = null;
const traces: Trace[] = [];

function active(): BelConfig {
  // The live runtime is built on first use, so importing the module without an
  // API key is fine; only evaluating a belief needs one.
  config ??= { runtime: createJevRuntime() };
  return config;
}

/** Point the runtime at something else. Tests call this with a mock or cassette. */
export function configureBel(next: BelRuntime | BelConfig): void {
  config = "evaluate" in next ? { runtime: next } : { ...next };
}

/** Drop the configured runtime and the recorded traces. Tests only. */
export function resetBel(): void {
  config = null;
  pending = null;
  traces.length = 0;
}

export function trace(): Trace[] {
  return [...traces];
}

function numeric(operand: number | Evaluation): number {
  if (typeof operand === "number") return operand;
  if (typeof operand.value !== "number") {
    throw new Error(`\`${operand.text}\` is a choice; compare it with one of its options instead`);
  }
  return operand.value;
}

/**
 * An evaluation whose confidence is below the floor is treated as not holding:
 * a belief becomes 0, a score becomes its lowest level, and a choice becomes an
 * option name that matches nothing.
 */
function applyFloor(evaluation: Evaluation, floor: number): Evaluation {
  if (evaluation.confidence >= floor) return evaluation;
  switch (evaluation.type) {
    case "noul":
    case "score":
      return { ...evaluation, value: 0 };
    case "choice":
      return { ...evaluation, value: "" };
  }
}

function recordEvaluation(evaluation: Evaluation): TraceEvaluation {
  return {
    id: evaluation.id,
    text: evaluation.text,
    value: evaluation.value,
    confidence: evaluation.confidence,
  };
}

/**
 * The surface the generated code calls.
 *
 * Composition lives here rather than in each runtime: it is the same
 * arithmetic for a live model, a mock and a cassette, and keeping it in one
 * place is what makes the independence assumption of `&` a single decision.
 */
export const __bel = {
  async evaluate(questions: Question[], state: unknown): Promise<Evaluation[]> {
    const current = active();
    const evaluations = await current.runtime.evaluate(questions, state);
    const floor = current.floor ?? 0;
    const floored =
      floor === 0 ? evaluations : evaluations.map((evaluation) => applyFloor(evaluation, floor));
    pending = floored.map(recordEvaluation);
    return floored;
  },

  /** `a & b` — independent composition. */
  composeAnd(...operands: (number | Evaluation)[]): number {
    return operands.reduce<number>((product, operand) => product * numeric(operand), 1);
  },

  /** `a | b`. */
  composeOr(...operands: (number | Evaluation)[]): number {
    return operands.reduce<number>((union, operand) => {
      const value = numeric(operand);
      return union + value - union * value;
    }, 0);
  },

  /** `~a`. */
  negate(operand: number | Evaluation): number {
    return 1 - numeric(operand);
  },

  /** A comparison between a resolved level and a literal: a deterministic 0/1 belief. */
  det(holds: boolean): number {
    return holds ? 1 : 0;
  },

  /** Record which guard fired, completing the trace opened by `evaluate`. */
  mark(flow: string, guard: number): void {
    const limit = active().traceLimit ?? DEFAULT_TRACE_LIMIT;
    traces.push({ flow, evaluations: pending ?? [], takenGuard: guard });
    pending = null;
    if (traces.length > limit) traces.shift();
  },

  get floor(): number {
    return active().floor ?? 0;
  },

  set floor(value: number) {
    active().floor = value;
  },
};

export { noulConfidence };
