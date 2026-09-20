import { basename } from "node:path";
import type { FlowDecl, Guard, MockEntry, MockValue, Program, TestDecl, TestItem } from "./ast.ts";
import { BelError, positionAt } from "./ast.ts";
import { findNonErasable } from "./erasable.ts";
import { collectQuestions, questionKey } from "./questions.ts";
import type { QuestionSpec } from "./questions.ts";
import { quote, readsName, splitTopLevel } from "./text.ts";

export type TestGenOptions = {
  /** The `.bel` file's path, used to import the compiled module next to it. */
  fileName: string;
  /** The original source, for positions on generated errors. */
  source: string;
  andStrategy?: "mul" | "conjoin";
  runtime?: string;
  testkit?: string;
  testModule?: string;
};

/**
 * Compile a bel module's tests to a vitest file.
 *
 * The mock table is a static, checkable claim: the compiler knows every
 * question each flow asks, so a table that misses one — or carries an entry
 * nothing asks — fails here rather than at run time.
 */
export function generateTests(program: Program, options: TestGenOptions): string | null {
  const tests = program.body.filter(
    (decl): decl is TestDecl => decl.kind === "Test" || decl.kind === "TestSnapshot",
  );
  if (tests.length === 0) return null;

  return new TestFileEmitter(program, tests, options).emit();
}

class TestFileEmitter {
  private readonly flows = new Map<string, FlowDecl>();
  private readonly mocks: MockEntry[];
  private readonly usedQuestions = new Set<string>();
  private needsExpect = false;
  private needsFloor = false;
  private usesMock = false;
  private usesCassette = false;

  private readonly options: TestGenOptions;
  private readonly program: Program;
  private readonly tests: TestDecl[];

  constructor(program: Program, tests: TestDecl[], options: TestGenOptions) {
    this.options = options;
    this.program = program;
    this.tests = tests;
    for (const decl of program.body) {
      if (decl.kind === "FlowDecl") this.flows.set(decl.name, decl);
    }
    const mockBlocks = program.body.filter((decl) => decl.kind === "MockBeliefs");
    const first = mockBlocks[0];
    this.mocks = first?.kind === "MockBeliefs" ? first.entries : [];
    if (mockBlocks.length > 1) {
      throw this.error(
        "a file has one `mock beliefs` table",
        "duplicate-mocks",
        first?.span.start ?? 0,
      );
    }
  }

  emit(): string {
    const bodies = this.tests.map((decl) => this.emitTest(decl));
    if (this.usesMock) this.checkUnusedMocks();
    const flowNames = new Set<string>();
    for (const decl of this.tests) {
      for (const name of this.flowsMentioned(flatten(decl.items))) flowNames.add(name);
    }

    const header = ["// @generated from bel source. Do not edit."];
    const imports: string[] = [];
    if (this.needsExpect) imports.push("expect", "test");
    else imports.push("test");
    header.push(
      `import { ${imports.join(", ")} } from ${quote(this.options.testModule ?? "vite-plus/test")};`,
    );

    const runtimeImports = ["configureBel", "resetBel"];
    if (this.needsFloor) runtimeImports.push("__bel");
    header.push(
      `import { ${runtimeImports.join(", ")} } from ${quote(this.options.runtime ?? "@bel/runtime")};`,
    );

    const testkitImports: string[] = [];
    if (this.usesMock) testkitImports.push("createMockRuntime");
    if (this.usesCassette) testkitImports.push("createCassetteRuntime");
    if (testkitImports.length > 0) {
      header.push(
        `import { ${testkitImports.join(", ")} } from ${quote(this.options.testkit ?? "@bel/testkit")};`,
      );
    }

    const body = this.tests.map((decl) => flatten(decl.items)).join("\n");
    const passthrough = this.program.body
      .map((decl) => {
        if (decl.kind === "TypeDecl") return decl.raw;
        if (decl.kind === "ImportDecl") return filterImport(decl.raw, body);
        return "";
      })
      .filter((raw) => raw !== "");
    if (passthrough.length > 0) header.push("", ...passthrough);

    if (flowNames.size > 0) {
      const module = `./${basename(this.options.fileName)}.ts`;
      header.push("", `import { ${[...flowNames].sort().join(", ")} } from ${quote(module)};`);
    }

    return `${[...header, "", ...bodies].join("\n")}\n`;
  }

  private testStart = 0;

  private emitTest(decl: TestDecl): string {
    this.testStart = decl.span.start;
    const record = findRecord(decl.items);
    const useCassette = decl.kind === "TestSnapshot" || record !== null;
    if (useCassette && record === null) {
      throw this.error(
        `\`test.snapshot "${decl.name}"\` needs a \`record "<path>"\` line to know where the answers live`,
        "test-without-answers",
        decl.span.start,
      );
    }
    if (!useCassette && this.mocks.length === 0) {
      throw this.error(
        `\`test "${decl.name}"\` has no answers: add a \`mock beliefs\` table or make it a \`test.snapshot\``,
        "test-without-answers",
        decl.span.start,
      );
    }

    if (useCassette) this.usesCassette = true;
    else {
      this.usesMock = true;
      this.checkCoverage(decl);
    }

    const body = this.emitItems(decl.items, "    ");
    const setup = useCassette
      ? [
          `  configureBel(`,
          `    createCassetteRuntime({ path: new URL(${quote(record?.path as string)}, import.meta.url) }),`,
          `  );`,
        ]
      : [
          "  configureBel(",
          "    createMockRuntime({",
          ...this.mocks.map(
            (entry) => `      ${quote(entry.question)}: ${mockValueSource(entry.value)},`,
          ),
          "    }),",
          "  );",
        ];

    return [
      `test(${quote(decl.name)}, async () => {`,
      ...setup,
      "  try {",
      ...body,
      "  } finally {",
      "    resetBel();",
      "  }",
      "});",
      "",
    ].join("\n");
  }

  private emitItems(items: TestItem[], pad: string): string[] {
    const lines: string[] = [];
    for (const item of items) {
      if (item.kind === "Record") continue;
      if (item.kind === "Floor") {
        this.needsFloor = true;
        lines.push(`${pad}const $floor = __bel.floor;`);
        lines.push(`${pad}__bel.floor = ${item.value};`);
        lines.push(`${pad}try {`);
        lines.push(...this.emitItems(item.items, `${pad}  `));
        lines.push(`${pad}} finally {`);
        lines.push(`${pad}  __bel.floor = $floor;`);
        lines.push(`${pad}}`);
        continue;
      }
      lines.push(...this.lowerLine(item.text, pad));
    }
    return lines;
  }

  private lowerLine(text: string, pad: string): string[] {
    const issue = findNonErasable(text);
    if (issue !== null) {
      throw this.error(
        `${issue.what} has a runtime value, and bel tests run by stripping types; ${issue.fix}`,
        "non-erasable-syntax",
        this.testStart,
      );
    }

    const assertion = /^assert\s+(.+?)\s+is\s+(.+)$/.exec(text);
    if (assertion !== null)
      return this.lowerAssertion(assertion[1] as string, (assertion[2] as string).trim(), pad);

    const binding = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?![=>])\s*(.+)$/.exec(text);
    if (binding !== null) return [`${pad}const ${binding[1]} = ${binding[2]};`];

    return [`${pad}${text}`];
  }

  /**
   * `assert x is Name(a, _)` becomes a discriminant check plus a comparison per
   * non-wildcard argument. Nothing compares the whole value, so a wildcard
   * really does mean "any argument", including `undefined`.
   */
  private lowerAssertion(subject: string, pattern: string, pad: string): string[] {
    this.needsExpect = true;
    const lines = [`${pad}const $actual = ${subject};`];

    if (pattern === "_") {
      lines.push(`${pad}expect($actual).not.toBeUndefined();`);
      return lines;
    }

    const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/.exec(pattern);
    lines.push(`${pad}expect($actual?.type).toBe(${quote(call?.[1] ?? pattern)});`);
    if (call === null) return lines;

    const args = splitTopLevel(call[2] as string)
      .map((arg) => arg.trim())
      .filter((arg) => arg !== "");
    lines.push(`${pad}expect($actual?.args).toHaveLength(${args.length});`);
    args.forEach((arg, index) => {
      if (arg === "_") return;
      lines.push(`${pad}expect($actual?.args?.[${index}]).toEqual(${arg});`);
    });
    return lines;
  }

  /** Every question the flows this test calls will ask, checked against the table. */
  private checkCoverage(decl: TestDecl): void {
    const questions = this.questionsOf(this.flowsMentioned(flatten(decl.items)));
    for (const question of questions) {
      this.usedQuestions.add(questionKey(question));
      if (this.mocks.some((entry) => entry.question === question.text)) continue;
      throw this.error(
        `\`test "${decl.name}"\` reaches a flow that asks \`${question.text}\`, which \`mock beliefs\` does not list`,
        "mock-missing-question",
        decl.span.start,
      );
    }
  }

  /** Checks the table has no leftovers. Runs once every test has been seen. */
  private checkUnusedMocks(): void {
    for (const entry of this.mocks) {
      if (entry.question === "") continue;
      const used = [...this.usedQuestions].some((key) => key.endsWith(`\u0000${entry.question}`));
      if (!used) {
        throw this.error(
          `\`mock beliefs\` lists \`${entry.question}\`, which no test reaches`,
          "mock-unused-entry",
          entry.span.start,
        );
      }
    }
  }

  /** The questions of a set of flows, following calls made from action islands. */
  private questionsOf(names: Set<string>): QuestionSpec[] {
    const seen = new Set<string>();
    const questions: QuestionSpec[] = [];
    const keys = new Set<string>();

    const visit = (name: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const flow = this.flows.get(name);
      if (flow === undefined) return;
      for (const question of collectQuestions(flow, this.options.andStrategy ?? "mul")) {
        if (keys.has(questionKey(question))) continue;
        keys.add(questionKey(question));
        questions.push(question);
      }
      for (const called of this.flowsMentioned(islandsOf(flow))) visit(called);
    };

    for (const name of names) visit(name);
    return questions;
  }

  private flowsMentioned(text: string): Set<string> {
    const names = new Set<string>();
    for (const name of this.flows.keys()) {
      if (readsName(text, name)) names.add(name);
    }
    return names;
  }

  private error(message: string, code: string, at: number): BelError {
    return new BelError(message, code, positionAt(this.options.source, at));
  }
}

function flatten(items: TestItem[]): string {
  return items
    .flatMap((item) =>
      item.kind === "Line" ? [item.text] : item.kind === "Floor" ? flatten(item.items) : [],
    )
    .join("\n");
}

function findRecord(items: TestItem[]): { path: string } | null {
  for (const item of items) {
    if (item.kind === "Record") return { path: item.path };
    if (item.kind === "Floor") {
      const nested = findRecord(item.items);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function islandsOf(flow: FlowDecl): string {
  const parts: string[] = [];
  const walk = (guards: Guard[]): void => {
    for (const guard of guards) {
      if (guard.action.kind === "GuardList") walk(guard.action.guards);
      else parts.push(guard.action.text);
    }
  };
  walk(flow.guards);
  return parts.join("\n");
}

/** `import { a, type B } from "x"` with only the names the test body mentions. */
function filterImport(raw: string, body: string): string {
  const named = /^import\s*\{([^}]*)\}\s*from\s*(["'][^"']*["'])\s*$/.exec(raw.trim());
  // A default import or a side-effect import is not ours to trim.
  if (named === null) return raw;
  const kept = (named[1] as string)
    .split(",")
    .map((specifier) => specifier.trim())
    .filter((specifier) => {
      const name = /^(?:type\s+)?([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(specifier);
      return name !== null && readsName(body, name[1] as string);
    });
  return kept.length === 0 ? "" : `import { ${kept.join(", ")} } from ${named[2]};`;
}

function mockValueSource(value: MockValue): string {
  if (value.kind === "Scalar")
    return typeof value.value === "string" ? quote(value.value) : String(value.value);
  const fields = Object.entries(value.fields).map(([key, field]) =>
    typeof field === "string" ? `${key}: ${quote(field)}` : `${key}: ${field}`,
  );
  return `{ ${fields.join(", ")} }`;
}
