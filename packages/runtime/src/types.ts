/** The runtime contract the generated code depends on. See RFC 0001, §10. */

export type Question =
  | { id: string; type: "noul"; text: string }
  | { id: string; type: "score"; text: string; rubric: string[] }
  | { id: string; type: "choice"; text: string; rubric: string[] };

export type Evaluation =
  | { id: string; type: "noul"; text: string; value: number; confidence: number }
  | {
      id: string;
      type: "score";
      text: string;
      value: number;
      confidence: number;
      /** The model's raw (non-integer) answer, kept for calibration work. */
      raw: number;
      probs: number[];
    }
  | {
      id: string;
      type: "choice";
      text: string;
      value: string;
      confidence: number;
      probs: Record<string, number>;
    };

/** A transport: where the probabilities come from. */
export interface BelRuntime {
  evaluate(questions: Question[], state: unknown): Promise<Evaluation[]>;
}

export type TraceEvaluation = {
  id: string;
  text: string;
  value: number | string;
  confidence: number;
};

export type Trace = {
  flow: string;
  evaluations: TraceEvaluation[];
  /** Index of the guard that fired at the flow's own level. */
  takenGuard: number;
};

/**
 * Confidence of a `noul` evaluation.
 *
 * TypeSafe Jev answers a `noul` with a probability only, so bel defines
 * confidence as the normalised distance from 0.5.
 */
export function noulConfidence(p: number): number {
  return Math.abs(p - 0.5) * 2;
}
