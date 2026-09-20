import type { BeliefExpr, FlowDecl, Guard } from "./ast.ts";

/** A question a flow asks, before it is given an id. */
export type QuestionSpec =
  | { type: "noul"; text: string }
  | { type: "score"; text: string; rubric: string[] }
  | { type: "choice"; text: string; rubric: string[] };

/** Questions are deduplicated by kind and text: the same words, the same answer. */
export function questionKey(spec: QuestionSpec): string {
  return `${spec.type}\u0000${spec.text}`;
}

/**
 * Every question a flow asks, in source order — its `let` bindings first, then
 * the guards depth first.
 *
 * This is the static list preflight depends on: the model is consulted exactly
 * where this function looked, and nowhere else.
 */
export function collectQuestions(flow: FlowDecl, andStrategy: "mul" | "conjoin"): QuestionSpec[] {
  const collector = new Collector(flow, andStrategy);
  collector.run();
  return collector.questions;
}

class Collector {
  readonly questions: QuestionSpec[] = [];
  private readonly seen = new Set<string>();

  private readonly flow: FlowDecl;
  private readonly andStrategy: "mul" | "conjoin";

  constructor(flow: FlowDecl, andStrategy: "mul" | "conjoin") {
    this.flow = flow;
    this.andStrategy = andStrategy;
  }

  run(): void {
    for (const binding of this.flow.bindings) {
      const value = binding.value;
      if (value.kind === "ScoreExpr")
        this.add({ type: "score", text: value.text, rubric: value.rubric });
      else if (value.kind === "ChoiceExpr")
        this.add({ type: "choice", text: value.text, rubric: value.rubric });
      else this.literals(value);
    }

    for (const guard of this.guards()) {
      if (guard.condition === null) continue;
      this.literals(guard.condition);
      this.conjunctions(guard.condition);
    }
  }

  /** Every guard, including those nested inside a `guards { … }` action. */
  private guards(): Guard[] {
    const all: Guard[] = [];
    const walk = (guards: Guard[]): void => {
      for (const guard of guards) {
        all.push(guard);
        if (guard.action.kind === "GuardList") walk(guard.action.guards);
      }
    };
    walk(this.flow.guards);
    return all;
  }

  private add(spec: QuestionSpec): void {
    const key = questionKey(spec);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.questions.push(spec);
  }

  private literals(node: BeliefExpr): void {
    if (node.kind === "BeliefLiteral") {
      this.add({ type: "noul", text: node.text });
      return;
    }
    if (node.kind === "And" || node.kind === "Or") {
      for (const operand of node.operands) this.literals(operand);
      return;
    }
    if (node.kind === "Not") this.literals(node.operand);
  }

  /**
   * In `conjoin` mode a conjunction becomes a question of its own. Its
   * operands stay in the batch too: they may be read elsewhere, and dropping
   * them would need a use analysis to save a few tokens of input.
   */
  private conjunctions(node: BeliefExpr): void {
    if (this.andStrategy !== "conjoin") return;
    if (node.kind === "And") {
      const text = conjoinedText(this.flow, node.operands);
      if (text !== null) this.add({ type: "noul", text });
      for (const operand of node.operands) this.conjunctions(operand);
      return;
    }
    if (node.kind === "Or") {
      for (const operand of node.operands) this.conjunctions(operand);
      return;
    }
    if (node.kind === "Not") this.conjunctions(node.operand);
  }
}

/** The question `conjoin` would ask for a conjunction, or null if it cannot be phrased. */
export function conjoinedText(flow: FlowDecl, operands: BeliefExpr[]): string | null {
  const texts: string[] = [];
  for (const operand of operands) {
    const text = literalText(flow, operand);
    if (text === null) return null;
    texts.push(text);
  }
  return texts.join(" and ");
}

/** The question text a node stands for, when it stands for exactly one. */
export function literalText(flow: FlowDecl, node: BeliefExpr): string | null {
  if (node.kind === "BeliefLiteral") return node.text;
  if (node.kind !== "BeliefRef") return null;
  const binding = flow.bindings.find((candidate) => candidate.name === node.name);
  return binding?.value.kind === "BeliefLiteral" ? binding.value.text : null;
}
