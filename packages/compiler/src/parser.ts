import type {
  Action,
  BeliefExpr,
  BindingValue,
  ChoiceExpr,
  CompareOp,
  Declaration,
  FlowDecl,
  Guard,
  ImportDecl,
  LabelOperand,
  LetBinding,
  MockBeliefs,
  MockEntry,
  MockValue,
  Program,
  RouteDecl,
  ScoreExpr,
  Span,
  TestDecl,
  TestItem,
  TypeDecl,
} from "./ast.ts";
import { BelError, BelParseError, positionAt } from "./ast.ts";
import { matchBracket, scanRaw } from "./scanner.ts";

const IDENT_PART = /[A-Za-z0-9_$]/;
const IDENT_START = /[A-Za-z_]/;

/**
 * Parse bel source into a syntax tree.
 *
 * The grammar is small enough that a hand-written recursive descent parser
 * beats a generator here: the hard part is lexical (indentation, raw
 * TypeScript islands), and that lives in `scanner.ts`, which a generator
 * could not reach without predicates and shared mutable state.
 */
export function parseBel(source: string): Program {
  return new Parser(source).parseProgram();
}

class Parser {
  private i = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  parseProgram(): Program {
    const body: Declaration[] = [];
    for (;;) {
      this.skipBlankLines();
      if (this.eof) break;
      body.push(this.declaration());
    }
    return { kind: "Program", body };
  }

  // -- declarations ---------------------------------------------------------

  private declaration(): Declaration {
    if (this.atKeyword("import")) return this.importDecl();
    if (this.atKeyword("type") || this.atKeyword("interface")) return this.typeDecl();
    if (this.atKeyword("mock")) return this.mockBeliefs();
    if (this.atKeyword("test")) return this.testDecl();
    if (this.atKeyword("route")) return this.routeDecl();
    if (this.atKeyword("export") || this.atKeyword("flow")) return this.flowDecl();
    this.fail("expected a declaration");
  }

  private importDecl(): ImportDecl {
    const start = this.i;
    const end = this.consumeRaw();
    return { kind: "ImportDecl", raw: this.source.slice(start, end), span: { start, end } };
  }

  private typeDecl(): TypeDecl {
    const start = this.i;
    const end = this.consumeRaw();
    return { kind: "TypeDecl", raw: this.source.slice(start, end), span: { start, end } };
  }

  /** Consume a line of raw TypeScript, following any brackets it opens. */
  private consumeRaw(): number {
    const end = scanRaw(this.source, this.i);
    this.i = end;
    this.expectEndOfLine();
    return end;
  }

  private flowDecl(): FlowDecl {
    const start = this.i;
    const exported = this.eat("export");
    if (exported) this.skipSpaces();
    this.expectKeyword("flow");
    this.skipSpaces();
    const name = this.ident();
    this.skipSpaces();
    const params = this.rawBrackets("(", "parameter list");
    this.skipSpaces();
    this.expect(":", "a return type: `flow name(params): Type`");
    this.skipSpaces();
    const returnType = this.toEndOfLine();
    if (returnType === "") this.fail("expected a return type");
    this.expectEndOfLine();

    const bindings = this.letBindings();
    const guards = this.guardList(null);
    return {
      kind: "FlowDecl",
      exported,
      name,
      params,
      returnType,
      bindings,
      guards,
      span: this.span(start),
    };
  }

  private letBindings(): LetBinding[] {
    const bindings: LetBinding[] = [];
    for (;;) {
      this.skipBlankLines();
      if (this.eof) break;
      const start = this.i;
      const indent = this.readIndent();
      if (indent === "") break;
      this.i = start + indent.length;
      if (!this.atKeyword("let")) {
        this.i = start;
        break;
      }
      this.expectKeyword("let");
      this.skipSpaces();
      const name = this.ident();
      this.skipSpaces();
      this.expect("=");
      this.skipSpaces();
      const value: BindingValue = this.atKeyword("score")
        ? this.scoreExpr()
        : this.atKeyword("choice")
          ? this.choiceExpr()
          : this.beliefExpr();
      this.expectEndOfLine();
      bindings.push({ kind: "LetBinding", name, value, span: this.span(start) });
    }
    return bindings;
  }

  private scoreExpr(): ScoreExpr {
    const start = this.i;
    this.expectKeyword("score");
    this.skipSpaces();
    const text = this.string();
    this.skipSpaces();
    this.expectKeyword("in");
    const rubric = this.labelList();
    return { kind: "ScoreExpr", text, rubric, span: this.span(start) };
  }

  private choiceExpr(): ChoiceExpr {
    const start = this.i;
    this.expectKeyword("choice");
    this.skipSpaces();
    const text = this.string();
    this.skipSpaces();
    this.expectKeyword("in");
    const rubric = this.labelList();
    return { kind: "ChoiceExpr", text, rubric, span: this.span(start) };
  }

  /** `low | medium | high` — the rubric of a score or choice question. */
  private labelList(): string[] {
    this.skipSpaces();
    const labels = [this.ident()];
    while (this.eatSeparated("|")) labels.push(this.ident());
    return labels;
  }

  // -- guards ---------------------------------------------------------------

  /**
   * A guard list is delimited by indentation: every guard line carries the
   * same prefix, taken from the first one. `prefix` is supplied when the
   * caller already knows it; `null` means "learn it from the first guard".
   */
  private guardList(prefix: string | null): Guard[] {
    const guards: Guard[] = [];
    let indent = prefix;
    for (;;) {
      this.skipBlankLines();
      if (this.eof) break;
      const start = this.i;
      const here = this.readIndent();
      if (here === "") break;
      if (indent === null) indent = here;
      if (here !== indent) {
        // A guard list ends at column 0 or at the `}` that closes `guards {`.
        // Anything else indented differently is a mistake worth reporting.
        if (here !== "" && this.source[start + here.length] !== "}") {
          throw this.error("mixed indentation in a guard list", "indent-mixed", start);
        }
        break;
      }
      this.i = start + here.length;
      guards.push(this.guard(start));
    }
    if (guards.length === 0) this.fail("expected at least one guard");
    return guards;
  }

  private guard(start: number): Guard {
    let condition: BeliefExpr | null = null;
    if (this.at("_") && !IDENT_PART.test(this.source[this.i + 1] ?? "")) {
      this.i += 1;
    } else {
      condition = this.beliefExpr();
    }
    this.skipSpaces();
    const threshold = this.threshold();
    this.skipSpaces();
    this.expect("->", "`->` after a guard condition");
    this.skipSpaces();
    const action = this.action();
    this.expectEndOfLine();
    return { kind: "Guard", condition, threshold, action, span: this.span(start) };
  }

  private threshold(): number | null {
    if (!this.at("@")) return null;
    const at = this.i;
    this.i += 1;
    this.skipSpaces();
    const value = this.number();
    if (value < 0 || value > 1) {
      throw this.error("a threshold must be between 0 and 1", "bad-threshold", at);
    }
    return value;
  }

  private action(): Action {
    const start = this.i;
    this.skipSpaces();

    if (this.atKeyword("guards") && this.braceFollows("guards")) return this.guardsAction(start);

    // Only `guards { … }` may start on the line after `->`; a line island has
    // to begin on the guard's own line.
    if (this.eof || this.source[this.i] === "\n") {
      const save = this.i;
      this.expectEndOfLine();
      this.skipBlankLines();
      const indent = this.readIndent();
      this.i += indent.length;
      if (this.atKeyword("guards") && this.braceFollows("guards")) return this.guardsAction(start);
      this.i = save;
      this.fail("expected an action after `->`", start);
    }

    if (this.at("{")) {
      const found = matchBracket(this.source, this.i);
      if (!found.ok) this.fail(`unterminated action block (${found.reason})`, found.at);
      const text = this.source.slice(this.i, found.end);
      this.i = found.end;
      return { kind: "Island", text, span: this.span(start) };
    }

    const text = this.toEndOfLine();
    if (text === "") this.fail("expected an action after `->`", start);
    return { kind: "Island", text, span: this.span(start) };
  }

  private guardsAction(start: number): Action {
    this.expectKeyword("guards");
    this.skipSpaces();
    this.expect("{");
    this.expectEndOfLine();
    const guards = this.guardList(null);
    this.skipBlankLines();
    this.skipSpaces();
    this.expect("}", "`}` to close `guards {`");
    return { kind: "GuardList", guards, span: this.span(start) };
  }

  private braceFollows(keyword: string): boolean {
    let j = this.i + keyword.length;
    while (this.source[j] === " " || this.source[j] === "\t") j += 1;
    return this.source[j] === "{";
  }

  // -- belief expressions ---------------------------------------------------

  private beliefExpr(): BeliefExpr {
    return this.beliefOr();
  }

  private beliefOr(): BeliefExpr {
    const start = this.i;
    const head = this.beliefAnd();
    const operands = [head];
    while (this.eatSeparated("|")) operands.push(this.beliefAnd());
    return operands.length === 1 ? head : { kind: "Or", operands, span: this.span(start) };
  }

  private beliefAnd(): BeliefExpr {
    const start = this.i;
    const head = this.beliefUnary();
    const operands = [head];
    while (this.eatSeparated("&")) operands.push(this.beliefUnary());
    return operands.length === 1 ? head : { kind: "And", operands, span: this.span(start) };
  }

  private beliefUnary(): BeliefExpr {
    const start = this.i;

    if (this.at("~")) {
      this.i += 1;
      this.skipSpaces();
      return { kind: "Not", operand: this.beliefUnary(), span: this.span(start) };
    }

    if (this.at("(")) {
      this.i += 1;
      this.skipSpaces();
      const inner = this.beliefExpr();
      this.skipSpaces();
      this.expect(")");
      return inner;
    }

    if (this.at('"')) {
      const text = this.string();
      return { kind: "BeliefLiteral", text, span: this.span(start) };
    }

    const name = this.ident();
    const save = this.i;
    this.skipSpaces();
    const operator = this.comparisonOperator();
    if (operator === null) {
      this.i = save;
      return { kind: "BeliefRef", name, span: this.span(start) };
    }
    this.skipSpaces();
    const operand = this.labelOperand();
    return { kind: "Comparison", name, operator, operand, span: this.span(start) };
  }

  private comparisonOperator(): CompareOp | null {
    for (const op of [">=", "<=", "==", ">", "<"] as const) {
      if (this.eat(op)) return op;
    }
    return null;
  }

  private labelOperand(): LabelOperand {
    const c = this.source[this.i];
    if (c !== undefined && /[0-9]/.test(c)) return { kind: "Level", value: this.number() };
    return { kind: "Label", name: this.ident() };
  }

  // -- routes ---------------------------------------------------------------

  private routeDecl(): RouteDecl {
    const start = this.i;
    this.expectKeyword("route");
    this.skipSpaces();
    let target: RouteDecl["target"];
    if (this.at("_") && !IDENT_PART.test(this.source[this.i + 1] ?? "")) {
      this.i += 1;
      target = { kind: "CatchAll", text: null };
    } else {
      const text = this.string();
      target = { kind: text.startsWith("/") ? "Path" : "Belief", text };
    }
    this.skipSpaces();
    const threshold = this.threshold();
    this.skipSpaces();
    const params = this.rawBrackets("(", "parameter list");
    this.skipSpaces();
    this.expect("->", "`->` after a route");
    this.skipSpaces();
    const action = this.action();
    this.expectEndOfLine();
    return { kind: "RouteDecl", target, threshold, params, action, span: this.span(start) };
  }

  // -- tests ----------------------------------------------------------------

  private mockBeliefs(): MockBeliefs {
    const start = this.i;
    this.expectKeyword("mock");
    this.skipSpaces();
    this.expectKeyword("beliefs");
    this.expectEndOfLine();

    const entries: MockEntry[] = [];
    for (;;) {
      this.skipBlankLines();
      if (this.eof) break;
      const lineStart = this.i;
      const indent = this.readIndent();
      if (indent === "") break;
      this.i = lineStart + indent.length;
      entries.push(this.mockEntry(lineStart));
    }
    if (entries.length === 0) this.fail("expected at least one mock entry");
    return { kind: "MockBeliefs", entries, span: this.span(start) };
  }

  private mockEntry(start: number): MockEntry {
    const question = this.string();
    this.skipSpaces();
    this.expect("=>", "`=>` after a mocked question");
    this.skipSpaces();
    const value = this.mockValue();
    this.expectEndOfLine();
    return { question, value, span: this.span(start) };
  }

  private mockValue(): MockValue {
    if (this.at("{")) {
      const fields: Record<string, number | string> = {};
      this.i += 1;
      for (;;) {
        this.skipSpaces();
        if (this.eat("}")) break;
        const key = this.ident();
        this.skipSpaces();
        this.expect(":");
        this.skipSpaces();
        const value = this.mockValue();
        if (value.kind !== "Scalar") this.fail("a mock field must be a number or a string");
        fields[key] = value.value;
        this.skipSpaces();
        this.eat(",");
      }
      return { kind: "Object", fields };
    }
    if (this.at('"')) return { kind: "Scalar", value: this.string() };
    return { kind: "Scalar", value: this.number() };
  }

  private testDecl(): TestDecl {
    const start = this.i;
    this.expectKeyword("test");
    let kind: TestDecl["kind"] = "Test";
    if (this.eat(".snapshot")) kind = "TestSnapshot";
    this.skipSpaces();
    const name = this.string();
    this.expectEndOfLine();
    const items = this.testItems(null);
    if (items.length === 0) this.fail("expected at least one line in the test body");
    return { kind, name, items, span: this.span(start) };
  }

  /**
   * The body of a test, as a tree of lines.
   *
   * `parent` is the indentation of the enclosing `with` block, if any: every
   * item has to be more indented than that, and all items at one level share
   * the indentation of the first.
   */
  private testItems(parent: string | null): TestItem[] {
    const items: TestItem[] = [];
    let base: string | null = null;

    for (;;) {
      // Only truly blank lines are skipped here: a comment is a line of the
      // test, and belongs in the generated file too.
      this.skipBlankLinesOnly();
      if (this.eof) break;
      const lineStart = this.i;
      const indent = this.readIndent();
      if (indent === "") break;
      if (parent !== null && !(indent.startsWith(parent) && indent.length > parent.length)) break;
      base ??= indent;
      if (!indent.startsWith(base)) break;

      const text = this.source.slice(lineStart + base.length, this.lineEnd(lineStart));
      this.i = this.lineEnd(lineStart);
      this.expectEndOfLine();

      const floor = /^with\s+confidence_floor\s+([0-9]+(?:\.[0-9]+)?)\s*$/.exec(text);
      if (floor !== null) {
        items.push({ kind: "Floor", value: Number(floor[1]), items: this.testItems(indent) });
        continue;
      }

      const record = /^record\s+"([^"]*)"\s*$/.exec(text);
      if (record !== null) {
        items.push({ kind: "Record", path: record[1] as string });
        continue;
      }

      items.push({ kind: "Line", text });
    }

    return items;
  }

  // -- cursor ---------------------------------------------------------------

  private get eof(): boolean {
    return this.i >= this.source.length;
  }

  private at(text: string): boolean {
    return this.source.startsWith(text, this.i);
  }

  private eat(text: string): boolean {
    if (!this.at(text)) return false;
    this.i += text.length;
    return true;
  }

  /**
   * Consume a separator that may be surrounded by spaces. Restores the cursor
   * when the separator is absent, so callers can test for it in a loop head.
   */
  private eatSeparated(separator: string): boolean {
    const save = this.i;
    this.skipSpaces();
    if (!this.eat(separator)) {
      this.i = save;
      return false;
    }
    this.skipSpaces();
    return true;
  }

  private expect(text: string, what = `\`${text}\``): void {
    if (!this.eat(text)) this.fail(`expected ${what}`);
  }

  private fail(message: string, at = this.i): never {
    throw new BelParseError(message, positionAt(this.source, at));
  }

  /** A diagnostic that is not a syntax error, but that the parser can already see. */
  private error(message: string, code: string, at = this.i): BelError {
    return new BelError(message, code, positionAt(this.source, at));
  }

  private skipSpaces(): void {
    while (!this.eof && (this.source[this.i] === " " || this.source[this.i] === "\t")) this.i += 1;
  }

  private expectEndOfLine(): void {
    this.skipSpaces();
    this.skipLineComment();
    if (this.eof) return;
    if (this.source[this.i] !== "\n") this.fail("expected end of line");
    this.i += 1;
  }

  /** A `//` comment runs to the end of the line. `/* … *\/` is not supported in v0. */
  private skipLineComment(): void {
    if (!this.at("//")) return;
    this.i = this.lineEnd(this.i);
  }

  /** Advance past lines that hold nothing at all. */
  private skipBlankLinesOnly(): void {
    while (!this.eof) {
      const save = this.i;
      this.skipSpaces();
      if (this.eof) return;
      if (this.source[this.i] !== "\n") {
        this.i = save;
        return;
      }
      this.i += 1;
    }
  }

  /**
   * Advance past blank lines and comment-only lines; the cursor ends at the
   * start of a line with content, or at EOF.
   */
  private skipBlankLines(): void {
    while (!this.eof) {
      const save = this.i;
      this.skipSpaces();
      if (this.eof) return;
      if (this.source[this.i] === "\n" || this.at("//")) {
        this.i = this.lineEnd(this.i);
        if (this.eof) return;
        this.i += 1;
        continue;
      }
      this.i = save;
      return;
    }
  }

  /** The indentation of the line the cursor sits at the start of. */
  private readIndent(): string {
    let j = this.i;
    while (j < this.source.length && (this.source[j] === " " || this.source[j] === "\t")) j += 1;
    return this.source.slice(this.i, j);
  }

  private atKeyword(word: string): boolean {
    if (!this.at(word)) return false;
    return !IDENT_PART.test(this.source[this.i + word.length] ?? "");
  }

  private expectKeyword(word: string): void {
    if (!this.atKeyword(word)) this.fail(`expected \`${word}\``);
    this.i += word.length;
  }

  private ident(): string {
    const start = this.i;
    const first = this.source[this.i] ?? "";
    if (!IDENT_START.test(first)) this.fail("expected an identifier");
    let j = this.i + 1;
    while (j < this.source.length && IDENT_PART.test(this.source[j] as string)) j += 1;
    this.i = j;
    return this.source.slice(start, j);
  }

  private number(): number {
    const start = this.i;
    if (!/[0-9]/.test(this.source[this.i] ?? "")) this.fail("expected a number");
    let j = this.i;
    while (j < this.source.length && /[0-9]/.test(this.source[j] as string)) j += 1;
    if (this.source[j] === ".") {
      j += 1;
      while (j < this.source.length && /[0-9]/.test(this.source[j] as string)) j += 1;
    }
    this.i = j;
    return Number(this.source.slice(start, j));
  }

  private string(): string {
    this.expect('"', "a string");
    let out = "";
    while (!this.eof) {
      const c = this.source[this.i] as string;
      if (c === "\\") {
        const next = this.source[this.i + 1];
        if (next !== "\\" && next !== '"') this.fail('only \\\\ and \\" escapes are supported');
        out += next;
        this.i += 2;
        continue;
      }
      if (c === '"') {
        this.i += 1;
        return out;
      }
      if (c === "\n") this.fail("unterminated string");
      out += c;
      this.i += 1;
    }
    this.fail("unterminated string");
  }

  /** Raw text between two matching brackets, including them. */
  private rawBrackets(open: string, what: string): string {
    if (!this.at(open)) this.fail(`expected \`${open}\` (${what})`);
    const found = matchBracket(this.source, this.i);
    if (!found.ok) this.fail(`unterminated ${what}`, found.at);
    const text = this.source.slice(this.i, found.end);
    this.i = found.end;
    return text;
  }

  private lineEnd(from: number): number {
    const stop = this.source.indexOf("\n", from);
    return stop === -1 ? this.source.length : stop;
  }

  private toEndOfLine(): string {
    const end = this.lineEnd(this.i);
    const text = this.source.slice(this.i, end).trimEnd();
    this.i = end;
    return text;
  }

  private span(start: number): Span {
    return { start, end: this.i };
  }
}
