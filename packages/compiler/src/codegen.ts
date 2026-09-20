import type {
  Action,
  BeliefExpr,
  ChoiceExpr,
  FlowDecl,
  Guard,
  LabelOperand,
  LetBinding,
  Program,
  ScoreExpr,
} from "./ast.ts";
import { BelError, positionAt } from "./ast.ts";
import type { QuestionSpec } from "./questions.ts";
import { collectQuestions, conjoinedText, questionKey } from "./questions.ts";
import { quote, readsName, splitTopLevel } from "./text.ts";

export type GenerateOptions = {
  /** The module the generated code imports the runtime singleton from. */
  runtime?: string;
  /** The original source, used to report positions on generated errors. */
  source?: string;
  /**
   * How `&` is evaluated.
   *
   * `mul` multiplies the operands, assuming they are independent. `conjoin`
   * asks the model for the conjunction as one question instead, which is more
   * accurate for correlated statements at the cost of an extra question.
   *
   * This is a compile-time choice, not a runtime one: `conjoin` changes the
   * set of questions a flow asks, and the whole point of preflight collecting
   * them statically is that the set is knowable before the program runs.
   */
  andStrategy?: "mul" | "conjoin";
};

type Question =
  | { id: string; type: "noul"; text: string }
  | { id: string; type: "score"; text: string; rubric: string[] }
  | { id: string; type: "choice"; text: string; rubric: string[] };

const DEFAULT_THRESHOLD = 0.5;

/**
 * Compile a parsed bel module to TypeScript.
 *
 * Test and mock declarations are dropped here and nowhere else, which is what
 * makes "tests never change the production output" a property of one function.
 */
export function generate(program: Program, options: GenerateOptions = {}): string {
  const runtime = options.runtime ?? "@bel/runtime";
  const andStrategy = options.andStrategy ?? "mul";
  return new Emitter(runtime, options.source, andStrategy).program(program);
}

class Emitter {
  private readonly out: string[] = [];
  private readonly runtime: string;
  private readonly source: string | undefined;
  private readonly andStrategy: "mul" | "conjoin";

  constructor(runtime: string, source: string | undefined, andStrategy: "mul" | "conjoin") {
    this.runtime = runtime;
    this.source = source;
    this.andStrategy = andStrategy;
  }

  program(program: Program): string {
    this.out.push("// @generated from bel source. Do not edit.");
    this.out.push(`import { __bel } from ${quote(this.runtime)};`);

    for (const decl of program.body) {
      switch (decl.kind) {
        case "ImportDecl":
        case "TypeDecl":
          this.out.push("");
          this.out.push(decl.raw);
          break;
        case "FlowDecl":
          this.out.push("");
          this.out.push(new FlowEmitter(decl, this.source, this.andStrategy).emit());
          break;
        case "RouteDecl":
          throw new BelError(
            "`route` is not implemented in bel v0 (see RFC 0001, Future work)",
            "route-not-implemented",
            this.where(decl.span.start),
          );
        case "MockBeliefs":
        case "Test":
        case "TestSnapshot":
          break;
      }
    }

    return `${this.out.join("\n")}\n`;
  }

  private where(offset: number) {
    return this.source === undefined ? undefined : positionAt(this.source, offset);
  }
}

class FlowEmitter {
  private readonly questions: Question[] = [];
  private readonly questionIndex = new Map<string, number>();
  /** Bindings an action island reads, in emission order. */
  private readonly islandBindings = new Set<string>();
  private readonly visiting = new Set<string>();

  private readonly flow: FlowDecl;
  private readonly source: string | undefined;
  private readonly andStrategy: "mul" | "conjoin";

  constructor(flow: FlowDecl, source: string | undefined, andStrategy: "mul" | "conjoin") {
    this.flow = flow;
    this.source = source;
    this.andStrategy = andStrategy;
  }

  emit(): string {
    this.collect();
    this.check();

    const lines: string[] = [];
    const exported = this.flow.exported ? "export " : "";
    lines.push(
      `${exported}async function ${this.flow.name}${this.flow.params}: Promise<${this.flow.returnType}> {`,
    );

    if (this.questions.length > 0) {
      lines.push("  const $b = await __bel.evaluate(");
      lines.push("    [");
      for (const question of this.questions) lines.push(`      ${questionSource(question)},`);
      lines.push("    ],");
      lines.push(`    ${this.stateExpression()},`);
      lines.push("  );");
    }

    for (const name of this.islandBindings) {
      lines.push(`  const ${name} = ${this.resolve(name, "value")};`);
    }

    lines.push(this.emitGuards(this.flow.guards, 1, true));
    lines.push("}");
    return lines.join("\n");
  }

  // -- checks ------------------------------------------------------------

  private check(): void {
    const catchAll = this.flow.guards.findIndex((guard) => guard.condition === null);
    if (catchAll !== -1 && catchAll !== this.flow.guards.length - 1) {
      const after = this.flow.guards[catchAll + 1] as Guard;
      throw new BelError(
        `a guard after the catch-all \`_\` can never fire`,
        "unreachable-guard",
        this.where(after.span.start),
      );
    }
    if (catchAll === -1 && !/\bundefined\b/.test(this.flow.returnType)) {
      throw new BelError(
        `flow \`${this.flow.name}\` has no \`_\` guard, but its return type (\`${this.flow.returnType}\`) does not include \`undefined\``,
        "missing-fallback",
        this.where(this.flow.span.start),
      );
    }
  }

  // -- collection ---------------------------------------------------------

  private collect(): void {
    for (const spec of collectQuestions(this.flow, this.andStrategy)) this.addQuestion(spec);
    this.walkGuards(this.flow.guards, (guard) => {
      if (guard.condition !== null) this.collectComparisons(guard.condition);
    });
    this.walkGuards(this.flow.guards, (guard) => this.collectIslandReads(guard));
  }

  private walkGuards(guards: Guard[], visit: (guard: Guard) => void): void {
    for (const guard of guards) {
      visit(guard);
      if (guard.action.kind === "GuardList") this.walkGuards(guard.action.guards, visit);
    }
  }

  /** A level comparison names its rubric level; that label has to be checked. */
  private collectComparisons(node: BeliefExpr): void {
    if (node.kind === "And" || node.kind === "Or") {
      for (const operand of node.operands) this.collectComparisons(operand);
      return;
    }
    if (node.kind === "Not") {
      this.collectComparisons(node.operand);
      return;
    }
    if (node.kind === "Comparison" && node.operand.kind === "Label") {
      this.labelLiteral(node.name, node.operand.name, node.span.start);
    }
  }

  private collectIslandReads(guard: Guard): void {
    if (guard.action.kind === "GuardList") return;
    const text = guard.action.text;
    for (const binding of this.flow.bindings) {
      if (readsName(text, binding.name)) this.islandBindings.add(binding.name);
    }
  }

  private addQuestion(spec: QuestionSpec): void {
    const key = questionKey(spec);
    if (this.questionIndex.has(key)) return;
    const id = String(this.questions.length);
    this.questionIndex.set(key, this.questions.length);
    this.questions.push({ ...spec, id } as Question);
  }

  // -- guards -------------------------------------------------------------

  /** `mark` records the taken guard for the trace; only the flow's own level does that. */
  private emitGuards(guards: Guard[], depth: number, mark: boolean): string {
    const pad = "  ".repeat(depth);
    const lines: string[] = [];
    guards.forEach((guard, index) => {
      const markLine = (indent: string) =>
        `${indent}__bel.mark(${quote(this.flow.name)}, ${index});`;
      if (guard.condition === null) {
        if (mark) lines.push(markLine(pad));
        lines.push(this.emitAction(guard.action, depth));
        return;
      }
      const threshold = guard.threshold ?? DEFAULT_THRESHOLD;
      lines.push(`${pad}if (${this.value(guard.condition)} >= ${threshold}) {`);
      if (mark) lines.push(markLine(`${pad}  `));
      lines.push(this.emitAction(guard.action, depth + 1));
      lines.push(`${pad}}`);
    });
    return lines.join("\n");
  }

  /** A block island runs as written; an expression island is returned. */
  private emitAction(action: Action, depth: number): string {
    if (action.kind === "GuardList") return this.emitGuards(action.guards, depth, false);
    if (action.text.startsWith("{")) return reindentBlock(action.text, depth);
    return `${"  ".repeat(depth)}return ${action.text};`;
  }

  // -- expressions --------------------------------------------------------

  /** A belief value: a number a guard can threshold. */
  private value(node: BeliefExpr): string {
    this.checkIsBelief(node);
    switch (node.kind) {
      case "BeliefLiteral":
        return `__bel.number(${this.referenceByText(node.text)})`;
      case "BeliefRef":
        return this.resolve(node.name, "value");
      case "Comparison":
        return this.comparison(node.name, node.operator, node.operand, node.span.start);
      case "And": {
        const conjoined =
          this.andStrategy === "conjoin" ? conjoinedText(this.flow, node.operands) : null;
        if (conjoined !== null) return `__bel.number(${this.referenceByText(conjoined)})`;
        return `__bel.composeAnd(${node.operands.map((o) => this.operand(o)).join(", ")})`;
      }
      case "Or":
        return `__bel.composeOr(${node.operands.map((o) => this.operand(o)).join(", ")})`;
      case "Not":
        return `__bel.negate(${this.operand(node.operand)})`;
    }
  }

  /**
   * The same expression in operand position: a bare question stays an
   * `Evaluation` so the runtime can still see its text, while a composite has
   * already collapsed to a number.
   */
  private operand(node: BeliefExpr): string {
    if (node.kind === "BeliefLiteral") return this.referenceByText(node.text);
    if (node.kind === "BeliefRef") {
      this.checkIsBelief(node);
      return this.resolve(node.name, "operand");
    }
    return this.value(node);
  }

  private comparison(name: string, operator: string, operand: LabelOperand, at: number): string {
    const right =
      operand.kind === "Level" ? String(operand.value) : this.labelLiteral(name, operand.name, at);
    return `__bel.det(${this.resolve(name, "value")} ${operator} ${right})`;
  }

  /** A `score` or `choice` is not a belief; only a comparison gives it a 0/1 reading. */
  private checkIsBelief(node: BeliefExpr): void {
    if (node.kind !== "BeliefRef") return;
    const value = this.lookup(node.name).value;
    if (value.kind !== "ScoreExpr" && value.kind !== "ChoiceExpr") return;
    const kind = value.kind === "ScoreExpr" ? "score" : "choice";
    throw new BelError(
      `\`${node.name}\` is a ${kind}; compare it with one of its levels`,
      "bad-comparison",
      this.where(node.span.start),
    );
  }

  /** Resolve a bound name into an expression, expanding aliases of composite beliefs. */
  private resolve(name: string, mode: "value" | "operand"): string {
    const binding = this.lookup(name);
    if (binding.value.kind === "ScoreExpr" || binding.value.kind === "ChoiceExpr") {
      const reference = this.referenceFor(binding.value);
      if (mode === "operand") return reference;
      // A score is a number; a choice is an option name.
      return binding.value.kind === "ScoreExpr"
        ? `__bel.number(${reference})`
        : `${reference}.value`;
    }
    if (binding.value.kind === "BeliefLiteral") {
      const reference = this.referenceByText(binding.value.text);
      return mode === "value" ? `__bel.number(${reference})` : reference;
    }
    if (this.visiting.has(name)) {
      throw new BelError(
        `\`${name}\` is defined in terms of itself`,
        "cyclic-belief",
        this.where(binding.span.start),
      );
    }
    this.visiting.add(name);
    try {
      return mode === "value" ? this.value(binding.value) : this.operand(binding.value);
    } finally {
      this.visiting.delete(name);
    }
  }

  /**
   * A level comparison inlines its literal: an index for a `score`, the option
   * name for a `choice`. Emitting a named constant instead would shadow any
   * import of the same name for the whole flow body, and an island cannot tell
   * a label read from a function call.
   */
  private labelLiteral(bindingName: string, label: string, at: number): string {
    const { binding, index } = this.resolveLabel(bindingName, label, at);
    return binding.kind === "ChoiceExpr" ? quote(label) : String(index);
  }

  private resolveLabel(
    bindingName: string,
    label: string,
    at: number,
  ): { binding: ScoreExpr | ChoiceExpr; index: number } {
    const value = this.lookup(bindingName).value;
    if (value.kind !== "ScoreExpr" && value.kind !== "ChoiceExpr") {
      throw new BelError(
        `\`${bindingName}\` is a belief, not a score or choice; it has no levels to compare`,
        "bad-comparison",
        this.where(at),
      );
    }
    const index = value.rubric.indexOf(label);
    if (index === -1) {
      throw new BelError(
        `\`${label}\` is not one of the levels [${value.rubric.join(", ")}] of \`${bindingName}\``,
        "unknown-label",
        this.where(at),
      );
    }
    return { binding: value, index };
  }

  private lookup(name: string): LetBinding {
    const binding = this.flow.bindings.find((candidate) => candidate.name === name);
    if (binding === undefined) {
      throw new BelError(
        `\`${name}\` is not bound in flow \`${this.flow.name}\``,
        "unknown-belief",
        this.where(this.flow.span.start),
      );
    }
    return binding;
  }

  private referenceFor(binding: ScoreExpr | ChoiceExpr): string {
    const type = binding.kind === "ScoreExpr" ? "score" : "choice";
    return `$b[${this.indexOf(type, binding.text)}]`;
  }

  private referenceByText(text: string): string {
    return `$b[${this.indexOf("noul", text)}]`;
  }

  private indexOf(type: Question["type"], text: string): number {
    const index = this.questionIndex.get(`${type}\u0000${text}`);
    if (index === undefined) {
      throw new BelError(`internal: no question collected for \`${text}\``, "internal");
    }
    return index;
  }

  /** The value a belief is evaluated against: the flow's arguments. */
  private stateExpression(): string {
    const names = parameterNames(this.flow.params);
    if (names === null) {
      throw new BelError(
        "only plain parameters can be a belief state; name the value rather than destructuring it",
        "unsupported-parameter",
        this.where(this.flow.span.start),
      );
    }
    if (names.length === 0) return "undefined";
    if (names.length === 1) return names[0] as string;
    return `{ ${names.join(", ")} }`;
  }

  private where(offset: number) {
    return this.source === undefined ? undefined : positionAt(this.source, offset);
  }
}

function questionSource(question: Question): string {
  const parts = [
    `id: ${quote(question.id)}`,
    `type: ${quote(question.type)}`,
    `text: ${quote(question.text)}`,
  ];
  if (question.type !== "noul") parts.push(`rubric: [${question.rubric.map(quote).join(", ")}]`);
  return `{ ${parts.join(", ")} }`;
}

/** `(t: Ticket)` -> `["t"]`, `()` -> `[]`, `({ a }: T)` -> `null`. */
function parameterNames(params: string): string[] | null {
  const inner = params.slice(1, -1).trim();
  if (inner === "") return [];

  const names: string[] = [];
  for (const part of splitTopLevel(inner)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?::|\?|$)/.exec(part.trim());
    if (match === null) return null;
    names.push(match[1] as string);
  }
  return names;
}

/** Split on commas that are not inside brackets. */
/** Re-indent a `{ … }` block to sit at `depth`, keeping its relative indentation. */
function reindentBlock(text: string, depth: number): string {
  const pad = "  ".repeat(depth);
  const lines = text.split("\n");
  const indents = lines
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  const floor = indents.length > 0 ? Math.min(...indents) : 0;
  return lines
    .map((line, index) => {
      if (line.trim() === "") return "";
      if (index === 0) return `${pad}${line}`;
      return `${pad}${line.slice(floor)}`;
    })
    .join("\n");
}
