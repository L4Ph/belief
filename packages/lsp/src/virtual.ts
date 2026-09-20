import { parseBel } from "@bel/compiler";
import type { FlowDecl, Guard, Program, TestItem } from "@bel/compiler";

/**
 * A TypeScript view of a bel file, for a TypeScript language server.
 *
 * bel is mostly TypeScript already, so the islands are handed over as they
 * are. What has to be built is the context around them: the imports and type
 * declarations of the module, and one function per flow for the islands to sit
 * in, so that `t` and `urgency` are names with types rather than errors.
 *
 * Positions are the whole problem. Nothing here preserves line numbers — the
 * islands are concatenated in source order — so every region of copied text
 * records where it came from. Mapping an offset is then one subtraction
 * inside the region that contains it, with no global transform to get wrong.
 */
export type Region = {
  /** The same text, as offsets into the bel source and into the virtual file. */
  belStart: number;
  belEnd: number;
  virtualStart: number;
  virtualEnd: number;
};

export type VirtualDocument = {
  text: string;
  regions: Region[];
};

/** Build the TypeScript view, or null if the source does not parse. */
export function buildVirtualDocument(source: string): VirtualDocument | null {
  let program: Program;
  try {
    program = parseBel(source);
  } catch {
    // A file that does not parse has no stable islands to hand over.
    return null;
  }

  const builder = new Builder(source);
  builder.pushLine("// Generated from a bel file for the TypeScript language server. Do not edit.");

  // The module's own TypeScript, which bel only carries. Each declaration is
  // copied whole, so a name inside it can be hovered as easily as an island.
  for (const decl of program.body) {
    if (decl.kind !== "ImportDecl" && decl.kind !== "TypeDecl") continue;
    builder.copy(decl.span.start, decl.span.end);
    builder.push("\n");
  }

  const flows = program.body.filter((decl): decl is FlowDecl => decl.kind === "FlowDecl");
  for (const flow of flows) builder.flow(flow);

  // Each test body is its own scope: two tests may declare the same fixture,
  // and putting them in one function would turn that into a redeclaration.
  const tests = program.body.filter((decl) => decl.kind === "Test" || decl.kind === "TestSnapshot");
  tests.forEach((decl, index) => {
    if (decl.kind !== "Test" && decl.kind !== "TestSnapshot") return;
    builder.push(`async function $test${index}(): Promise<void> {\n`);
    for (const item of flatten(decl.items)) builder.testLine(item);
    builder.push("}\n");
  });

  return { text: builder.toString(), regions: builder.regions };
}

/** Where an offset in the bel source sits in the virtual file, if anywhere. */
export function toVirtualOffset(document: VirtualDocument, belOffset: number): number | null {
  for (const region of document.regions) {
    if (belOffset >= region.belStart && belOffset < region.belEnd) {
      return region.virtualStart + (belOffset - region.belStart);
    }
  }
  return null;
}

/** Where an offset in the virtual file sits in the bel source, if anywhere. */
export function toBelOffset(document: VirtualDocument, virtualOffset: number): number | null {
  for (const region of document.regions) {
    if (virtualOffset >= region.virtualStart && virtualOffset < region.virtualEnd) {
      return region.belStart + (virtualOffset - region.virtualStart);
    }
  }
  return null;
}

/** A TypeScript view of the bel source, written one piece at a time. */
class Builder {
  readonly regions: Region[] = [];
  private readonly parts: string[] = [];
  private readonly source: string;
  private length = 0;

  constructor(source: string) {
    this.source = source;
  }

  toString(): string {
    return this.parts.join("");
  }

  /** Copy a range of the bel source into the virtual file, and remember how to get back. */
  copy(belStart: number, belEnd: number): void {
    const text = this.source.slice(belStart, belEnd);
    this.regions.push({
      belStart,
      belEnd,
      virtualStart: this.length,
      virtualEnd: this.length + text.length,
    });
    this.push(text);
  }

  push(text: string): void {
    this.parts.push(text);
    this.length += text.length;
  }

  pushLine(text: string): void {
    this.push(`${text}\n`);
  }

  flow(flow: FlowDecl): void {
    // The signature is copied rather than rebuilt, so `Ticket` in it is a
    // position the TypeScript server can be asked about.
    this.push("export async function ");
    this.copyAt(flow.name, flow.span.start);
    this.copyAt(flow.params, flow.span.start);
    this.push(": Promise<");
    this.copyAt(flow.returnType, flow.span.start + flow.params.length);
    this.push("> {\n");

    for (const binding of flow.bindings) {
      // The bindings are values from the model. Declaring them is what makes
      // the islands type check: a score is a number, a choice is an option.
      const zero = binding.value.kind === "ChoiceExpr" ? '""' : "0";
      this.pushLine(`  const ${binding.name} = ${zero};`);
    }
    for (const guard of guardsOf(flow)) {
      if (guard.action.kind === "GuardList") continue;
      this.action(guard.action.span.start, guard.action.span.end, guard.action.text);
    }
    this.push("}\n");
  }

  /** Copy a fragment, locating it in the source from `after`. */
  private copyAt(text: string, after: number): void {
    const at = this.source.indexOf(text, after);
    if (at === -1) {
      this.push(text);
      return;
    }
    this.copy(at, at + text.length);
  }

  /**
   * An island, as a statement.
   *
   * A block island already is one; an expression island needs a semicolon,
   * which is appended outside the copied region so the mapping stays exact.
   */
  action(belStart: number, belEnd: number, text: string): void {
    this.copy(belStart, belEnd);
    if (!text.startsWith("{")) this.push(";");
    this.push("\n");
  }

  /**
   * A line of a test body.
   *
   * `name = value` and `assert subject is Pattern` are bel sugar, so the
   * TypeScript in them is copied and the sugar around it is dropped: what can
   * be hovered is what could be type checked.
   */
  testLine(item: TestItem & { kind: "Line" }): void {
    const text = item.text;
    const binding = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?![=>])\s*/.exec(text);
    if (binding !== null) {
      this.push(`  const ${binding[1]} = `);
      this.copyLine(item, binding[0].length, text.length);
      this.push(";\n");
      return;
    }
    const assertion = /^assert\s+/.exec(text);
    if (assertion !== null) {
      const is = text.lastIndexOf(" is ");
      if (is === -1) {
        this.push(`  `);
        this.copyLine(item, assertion[0].length, text.length);
        this.push(";\n");
        return;
      }
      this.push("  ");
      this.copyLine(item, assertion[0].length, is);
      this.push(";\n");
      return;
    }
    // `with confidence_floor n` and anything else bel-specific is not TypeScript.
  }

  private copyLine(item: TestItem & { kind: "Line" }, from: number, to: number): void {
    if (to <= from) return;
    this.copy(item.span.start + from, item.span.start + to);
  }
}

function guardsOf(flow: FlowDecl): Guard[] {
  const all: Guard[] = [];
  const walk = (guards: Guard[]): void => {
    for (const guard of guards) {
      all.push(guard);
      if (guard.action.kind === "GuardList") walk(guard.action.guards);
    }
  };
  walk(flow.guards);
  return all;
}

function flatten(items: TestItem[]): (TestItem & { kind: "Line" })[] {
  const lines: (TestItem & { kind: "Line" })[] = [];
  for (const item of items) {
    if (item.kind === "Line") lines.push(item);
    else if (item.kind === "Floor") lines.push(...flatten(item.items));
  }
  return lines;
}
