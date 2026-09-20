/** The syntax tree produced by the parser. Positions are offsets into the source. */

export type Span = { start: number; end: number };

export type Position = { offset: number; line: number; column: number };

export type Program = { kind: "Program"; body: Declaration[] };

export type Declaration = ImportDecl | TypeDecl | FlowDecl | RouteDecl | MockBeliefs | TestDecl;

/** `import …` — passed through to the output untouched. */
export type ImportDecl = { kind: "ImportDecl"; raw: string; span: Span };

/** `type …` / `interface …` — passed through to the output untouched. */
export type TypeDecl = { kind: "TypeDecl"; raw: string; span: Span };

export type FlowDecl = {
  kind: "FlowDecl";
  exported: boolean;
  name: string;
  /** Raw parameter list including the parentheses, e.g. `(t: Ticket)`. */
  params: string;
  returnType: string;
  bindings: LetBinding[];
  guards: Guard[];
  span: Span;
};

export type LetBinding = {
  kind: "LetBinding";
  name: string;
  value: BindingValue;
  span: Span;
};

export type BindingValue = BeliefExpr | ScoreExpr | ChoiceExpr;

/** `score "…" in low | medium | high` */
export type ScoreExpr = { kind: "ScoreExpr"; text: string; rubric: string[]; span: Span };

/** `choice "…" in refund | info` */
export type ChoiceExpr = { kind: "ChoiceExpr"; text: string; rubric: string[]; span: Span };

export type Guard = {
  kind: "Guard";
  /** `null` for the catch-all `_`. */
  condition: BeliefExpr | null;
  /** The `@ n` threshold, or `null` to use the default of 0.5. */
  threshold: number | null;
  action: Action;
  span: Span;
};

export type Action =
  | { kind: "Island"; text: string; span: Span }
  | { kind: "GuardList"; guards: Guard[]; span: Span };

export type BeliefExpr =
  | { kind: "BeliefLiteral"; text: string; span: Span }
  | { kind: "BeliefRef"; name: string; span: Span }
  | { kind: "Comparison"; name: string; operator: CompareOp; operand: LabelOperand; span: Span }
  | { kind: "And"; operands: BeliefExpr[]; span: Span }
  | { kind: "Or"; operands: BeliefExpr[]; span: Span }
  | { kind: "Not"; operand: BeliefExpr; span: Span };

export type CompareOp = ">=" | ">" | "<" | "<=" | "==";

export type LabelOperand = { kind: "Label"; name: string } | { kind: "Level"; value: number };

/**
 * `route` is parsed so that it produces a clear "not implemented" error rather
 * than a syntax error. See RFC 0001, "Future work".
 */
export type RouteDecl = {
  kind: "RouteDecl";
  target: { kind: "Path" | "Belief" | "CatchAll"; text: string | null };
  threshold: number | null;
  params: string;
  action: Action;
  span: Span;
};

export type MockBeliefs = { kind: "MockBeliefs"; entries: MockEntry[]; span: Span };

export type MockEntry = { question: string; value: MockValue; span: Span };

export type MockValue =
  | { kind: "Scalar"; value: number | string }
  | { kind: "Object"; fields: Record<string, number | string> };

export type TestDecl = {
  kind: "Test" | "TestSnapshot";
  name: string;
  /** `with confidence_floor n` */
  floor: number | null;
  /** `record "path"` */
  cassette: string | null;
  /** Body lines, raw, with their indentation stripped of the block's own prefix. */
  lines: string[];
  span: Span;
};

export class BelError extends Error {
  readonly code: string;
  readonly position: Position | undefined;

  constructor(message: string, code: string, position?: Position) {
    super(message);
    this.name = "BelError";
    this.code = code;
    this.position = position;
  }

  /** `path:line:column: code: message`, dropping the parts that are unknown. */
  format(path?: string): string {
    const where = [path, this.position?.line, this.position?.column]
      .filter((part) => part !== undefined)
      .join(":");
    return where === ""
      ? `${this.code}: ${this.message}`
      : `${where}: ${this.code}: ${this.message}`;
  }
}

export class BelParseError extends BelError {
  constructor(message: string, position: Position) {
    super(message, "parse-error", position);
    this.name = "BelParseError";
  }
}

/** Resolve an offset into a 1-based line and column. */
export function positionAt(source: string, offset: number): Position {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { offset, line, column: offset - lineStart + 1 };
}
