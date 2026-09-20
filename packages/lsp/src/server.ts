import { BelError, compile, generateTests, parseBel } from "@bel/compiler";
import type { BeliefExpr, FlowDecl } from "@bel/compiler";
import {
  ERROR_SEVERITY,
  lineOffsetToPosition,
  lineRange,
  offsetAt,
  type Diagnostic,
  type Message,
  type Position,
} from "./protocol.ts";
import {
  buildVirtualDocument,
  toBelOffset,
  toVirtualOffset,
  type VirtualDocument,
} from "./virtual.ts";
import type { TypeScriptClient } from "./typescript.ts";
import type { Range } from "./protocol.ts";
import { wordWithOffset } from "./word.ts";

const SOURCE = "bel";

/** What bel needs of a TypeScript client, so a test can stand in for one. */
export type TypeScriptBridge = Pick<
  TypeScriptClient,
  "start" | "open" | "change" | "close" | "request" | "dispose"
>;

export type BelServerOptions = {
  /**
   * Build the TypeScript client for the islands, once the workspace is known.
   * Optional: without one bel answers for what bel knows and nothing more.
   */
  createTypescript?: (
    rootUri: string | null,
    onDiagnostics: (uri: string, diagnostics: unknown[]) => void,
  ) => TypeScriptBridge | null;
};

/** The virtual file a bel file is handed to the TypeScript server as. */
const PREVIEW = ".preview.ts";

export function previewUriOf(belUri: string): string {
  return `${belUri}${PREVIEW}`;
}

export function belUriOf(previewUri: string): string | null {
  return previewUri.endsWith(PREVIEW) ? previewUri.slice(0, -PREVIEW.length) : null;
}

/** A `file://` URI as a path. */
export function pathOf(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}

/**
 * A language server with no more machinery than the compiler already provides:
 * every request re-runs the compiler on the document as it stands and turns the
 * diagnostic it raises — if any — into a message.
 *
 * One diagnostic at a time is a real limit: the compiler stops at the first
 * error. A list of errors is a compiler change, not a server one.
 */
export class BelServer {
  /**
   * Where to send a message that nothing asked for. TypeScript diagnostics
   * arrive when they arrive, and the editor has to hear about them.
   */
  onMessage: ((message: Message) => void) | null = null;

  private readonly documents = new Map<string, string>();
  /** The TypeScript view of each document, when it has one. */
  private readonly previews = new Map<string, VirtualDocument | null>();
  /** The last TypeScript diagnostics, already mapped back to bel coordinates. */
  private readonly typescriptDiagnostics = new Map<string, Diagnostic[]>();
  private readonly versions = new Map<string, number>();
  private readonly options: BelServerOptions;
  private typescript: TypeScriptBridge | null = null;

  constructor(options: BelServerOptions = {}) {
    this.options = options;
  }

  /** Handle one message. Returns the messages to send back, in order. */
  async handle(message: Message): Promise<Message[]> {
    const params = message.params as never as Record<string, unknown> | undefined;
    switch (message.method) {
      case "initialize": {
        const root =
          (params?.["rootUri"] as string | null | undefined) ??
          (params?.["workspaceFolders"] as { uri: string }[] | undefined)?.[0]?.uri ??
          null;
        const typescript = this.options.createTypescript?.(root, (uri, diagnostics) => {
          this.receiveTypeScriptDiagnostics(uri, diagnostics);
        });
        if (typescript !== null && typescript !== undefined) {
          this.typescript = typescript;
          // Starting is asynchronous: the reply does not wait for TypeScript.
          typescript.start();
        }
        return [this.reply(message, capabilities())];
      }
      case "initialized":
        return [];
      case "shutdown":
        this.typescript?.dispose();
        this.typescript = null;
        return [this.reply(message, null)];
      case "exit":
        return [];
      case "textDocument/didOpen":
        return this.didOpen(params);
      case "textDocument/didChange":
        return this.didChange(params);
      case "textDocument/didClose":
        return this.didClose(params);
      case "textDocument/hover":
        return [this.reply(message, await this.hover(params))];
      case "textDocument/definition":
        return [this.reply(message, await this.forward(params, "textDocument/definition"))];
      case "textDocument/completion":
        return [this.reply(message, await this.completion(params))];
      default:
        return message.id === undefined ? [] : [this.reply(message, null)];
    }
  }

  private reply(message: Message, result: unknown): Message {
    return { jsonrpc: "2.0", id: message.id ?? null, result };
  }

  private didOpen(params: Record<string, unknown> | undefined): Message[] {
    const document = params?.["textDocument"] as { uri: string; text: string } | undefined;
    if (document === undefined) return [];
    this.documents.set(document.uri, document.text);
    this.syncPreview(document.uri, document.text);
    return [this.publish(document.uri, document.text)];
  }

  private didChange(params: Record<string, unknown> | undefined): Message[] {
    const document = params?.["textDocument"] as { uri: string; version?: number } | undefined;
    const changes = params?.["contentChanges"] as { text: string }[] | undefined;
    const text = changes?.at(-1)?.text;
    if (document === undefined || text === undefined) return [];
    this.documents.set(document.uri, text);
    if (document.version !== undefined) this.versions.set(document.uri, document.version);
    this.syncPreview(document.uri, text);
    return [this.publish(document.uri, text)];
  }

  private didClose(params: Record<string, unknown> | undefined): Message[] {
    const document = params?.["textDocument"] as { uri: string } | undefined;
    if (document === undefined) return [];
    this.documents.delete(document.uri);
    this.previews.delete(document.uri);
    this.typescriptDiagnostics.delete(document.uri);
    this.typescript?.close(previewUriOf(document.uri));
    return [this.publish(document.uri, "", [])];
  }

  /** Hand the islands to the TypeScript server, or take them back. */
  private syncPreview(uri: string, text: string): void {
    const typescript = this.typescript;
    if (typescript === null) return;

    const preview = buildVirtualDocument(text);
    this.previews.set(uri, preview);
    const previewUri = previewUriOf(uri);
    if (preview === null) {
      typescript.close(previewUri);
      return;
    }
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    if (version === 1) typescript.open(previewUri, preview.text);
    else typescript.change(previewUri, preview.text, version);

    // TypeScript 7 answers diagnostics when asked rather than pushing them,
    // so asking is part of handing over a document.
    void typescript
      .request("textDocument/diagnostic", { textDocument: { uri: previewUri } })
      .then((result) => {
        const items = (result as { items?: unknown[] } | null)?.items;
        if (Array.isArray(items)) this.receiveTypeScriptDiagnostics(previewUri, items);
      })
      .catch((error: unknown) => {
        this.onMessage?.({
          jsonrpc: "2.0",
          method: "window/logMessage",
          params: {
            type: 2,
            message: `bel: could not read TypeScript diagnostics: ${String(error)}`,
          },
        });
      });
  }

  /** Ask the TypeScript server the same question, in its coordinates. */
  private async forward(
    params: Record<string, unknown> | undefined,
    method: string,
  ): Promise<unknown> {
    const where = this.at(params);
    const typescript = this.typescript;
    if (where === null || typescript === null) return null;
    const preview = this.previews.get(where.uri);
    if (preview === null || preview === undefined) return null;
    const offset = toVirtualOffset(preview, where.offset);
    if (offset === null) return null;
    const result = await typescript.request(method, {
      textDocument: { uri: previewUriOf(where.uri) },
      position: lineOffsetToPosition(preview.text, offset),
    });
    return this.mapResult(preview, where.uri, result);
  }

  /** Locations come back in the virtual file; move them onto the bel file. */
  private mapResult(preview: VirtualDocument, uri: string, result: unknown): unknown {
    if (result === null || typeof result !== "object") return result;
    const belText = this.documents.get(uri) ?? "";
    if (Array.isArray(result)) {
      return result
        .map((item) => this.mapResult(preview, uri, item))
        .filter((item) => item !== null);
    }
    const location = result as { uri?: string; range?: unknown; textEdit?: { range?: unknown } };
    if (location.uri === previewUriOf(uri)) {
      const range = this.mapRange(preview, belText, location.range);
      return range === null ? null : { ...location, uri, range };
    }
    // A hover's range has no uri, and it is what the editor underlines.
    if (
      location.uri === undefined &&
      location.range !== undefined &&
      location.textEdit === undefined
    ) {
      const range = this.mapRange(preview, belText, location.range);
      return range === null ? result : { ...location, range };
    }
    // A completion's edit is against the virtual file, which the editor has
    // never heard of; dropping it is better than applying it in the wrong place.
    if (location.textEdit !== undefined) return { ...location, textEdit: undefined };
    return result;
  }

  private mapRange(preview: VirtualDocument, belText: string, range: unknown): Range | null {
    const typed = range as { start?: Position; end?: Position } | undefined;
    if (typed?.start === undefined || typed.end === undefined) return null;
    const start = toBelOffset(preview, offsetAt(preview.text, typed.start));
    const end = toBelOffset(preview, offsetAt(preview.text, typed.end));
    if (start === null || end === null) return null;
    return {
      start: lineOffsetToPosition(belText, start),
      end: lineOffsetToPosition(belText, Math.max(start, end)),
    };
  }

  /** Diagnostics from the TypeScript server, moved onto the bel file. */
  receiveTypeScriptDiagnostics(uri: string, diagnostics: unknown[]): void {
    const belUri = belUriOf(uri);
    if (belUri === null) return;
    const preview = this.previews.get(belUri);
    if (preview === null || preview === undefined) return;

    const mapped: Diagnostic[] = [];
    for (const item of diagnostics) {
      const diagnostic = item as {
        range?: { start: Position; end: Position };
        message?: string;
        code?: unknown;
        severity?: number;
      };
      if (diagnostic.range === undefined) continue;
      const start = toBelOffset(preview, offsetAt(preview.text, diagnostic.range.start));
      const end = toBelOffset(preview, offsetAt(preview.text, diagnostic.range.end));
      // A diagnostic in the synthetic context, rather than in an island, has
      // nowhere to point in the bel file, and is not the author's problem.
      if (start === null || end === null || end < start) continue;
      mapped.push({
        range: lineRange(this.documents.get(belUri) ?? "", start),
        severity: severityOf(diagnostic.severity),
        code:
          typeof diagnostic.code === "string" || typeof diagnostic.code === "number"
            ? String(diagnostic.code)
            : "typescript",
        source: "typescript",
        message: diagnostic.message ?? "",
      });
    }
    this.typescriptDiagnostics.set(belUri, mapped);
    this.onMessage?.(this.publish(belUri, this.documents.get(belUri) ?? ""));
  }

  /** Compile the document and report whatever the compiler objects to. */
  private publish(uri: string, text: string, diagnostics?: Diagnostic[]): Message {
    const merged = diagnostics ?? [
      ...this.diagnostics(uri, text),
      ...(this.typescriptDiagnostics.get(uri) ?? []),
    ];
    return {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, diagnostics: merged },
    };
  }

  private diagnostics(uri: string, text: string): Diagnostic[] {
    try {
      const program = parseBel(text);
      compile(text);
      generateTests(program, { source: text, fileName: uri });
      return [];
    } catch (error) {
      if (!(error instanceof BelError)) throw error;
      const position = error.position;
      return [
        {
          range: lineRange(text, position?.offset ?? 0),
          severity: ERROR_SEVERITY,
          code: error.code,
          source: SOURCE,
          message: error.message,
        },
      ];
    }
  }

  /**
   * What the thing under the cursor is.
   *
   * TypeScript inside an island is out of reach: Zed runs a language server
   * per buffer, and an injected region is syntax only, so no `tsc` will answer
   * for a name in there. What can be answered is everything bel itself knows —
   * the flow, the binding and its type, a rubric level, and the question a
   * string asks.
   */
  private async hover(params: Record<string, unknown> | undefined): Promise<unknown> {
    const where = this.at(params);
    if (where === null) return null;
    const program = safeParse(where.text);
    if (program === null) return null;
    const flows = program.body.filter((decl): decl is FlowDecl => decl.kind === "FlowDecl");

    // A string in a score, a choice or a guard is a question.
    for (const decl of flows) {
      for (const binding of decl.bindings) {
        const value = binding.value;
        if (value.kind !== "ScoreExpr" && value.kind !== "ChoiceExpr") continue;
        const quoted = `"${value.text}"`;
        const at = where.text.indexOf(quoted, value.span.start);
        if (at !== -1 && where.offset >= at && where.offset <= at + quoted.length) {
          return markdown(
            `**${value.kind === "ScoreExpr" ? "score" : "choice"}** — ${quoted}`,
            `asked by \`${binding.name}\` in \`${decl.name}\`\n\nlevels: ${value.rubric.join(" → ")}`,
          );
        }
      }
    }

    const name = wordWithOffset(where.text, where.offset)?.word;
    if (name === undefined) return null;

    for (const decl of flows) {
      if (decl.name === name) {
        const guards = decl.guards.length;
        const bindings = decl.bindings.length;
        return markdown(
          `\`\`\`bel\nflow ${decl.name}${decl.params}: ${decl.returnType}\n\`\`\``,
          `${bindings} binding(s), ${guards} guard(s)`,
        );
      }
      const binding = decl.bindings.find((candidate) => candidate.name === name);
      if (binding !== undefined) {
        return markdown(
          `\`\`\`bel\nlet ${binding.name}: ${belType(binding.value)} = ${describeBinding(binding.value)}\n\`\`\``,
          questionOf(binding.value),
        );
      }
      for (const candidate of decl.bindings) {
        const value = candidate.value;
        if (value.kind !== "ScoreExpr" && value.kind !== "ChoiceExpr") continue;
        const index = value.rubric.indexOf(name);
        if (index === -1) continue;
        return markdown(
          `**${name}** — ${
            value.kind === "ScoreExpr" ? `level ${index} of ${value.rubric.length}` : "an option"
          }`,
          `from \`${candidate.name}\` = ${value.kind === "ScoreExpr" ? "score" : "choice"} ${JSON.stringify(value.text)}`,
        );
      }
    }
    // Nothing bel knows; the islands are TypeScript's business.
    return this.forward(params, "textDocument/hover");
  }

  /**
   * After a comparison operator, the levels of the score or choice on the left
   * are what can come next — and they are the part of the language nobody
   * remembers.
   */
  private completion(params: Record<string, unknown> | undefined): unknown {
    const where = this.at(params);
    if (where === null) return null;
    const lineStart = where.text.lastIndexOf("\n", Math.max(0, where.offset - 1)) + 1;
    const before = where.text.slice(lineStart, where.offset);
    const comparison = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:>=|<=|>|<|==)\s*[A-Za-z0-9_]*$/.exec(before);
    if (comparison === null) return null;

    const program = safeParse(where.text);
    if (program === null) return null;
    for (const decl of program.body) {
      if (decl.kind !== "FlowDecl") continue;
      const value = decl.bindings.find((candidate) => candidate.name === comparison[1])?.value;
      if (value?.kind !== "ScoreExpr" && value?.kind !== "ChoiceExpr") continue;
      const question = value.text;
      const score = value.kind === "ScoreExpr";
      return {
        isIncomplete: false,
        items: value.rubric.map((label, index) => ({
          label,
          kind: 12,
          detail: score ? `level ${index} of ${question}` : `option of ${question}`,
        })),
      };
    }
    return null;
  }

  private at(
    params: Record<string, unknown> | undefined,
  ): { uri: string; text: string; offset: number } | null {
    const document = params?.["textDocument"] as { uri: string } | undefined;
    const position = params?.["position"] as Position | undefined;
    if (document === undefined || position === undefined) return null;
    const text = this.documents.get(document.uri);
    if (text === undefined) return null;
    return { uri: document.uri, text, offset: offsetAt(text, position) };
  }
}

function severityOf(severity: number | undefined): 1 | 2 | 3 | 4 {
  return severity === 2 ? 2 : severity === 3 ? 3 : severity === 4 ? 4 : 1;
}

function capabilities(): unknown {
  return {
    capabilities: {
      // The document is recompiled whole on every change; incremental ranges
      // would only save a string copy.
      textDocumentSync: 1,
      hoverProvider: true,
      definitionProvider: true,
      completionProvider: { triggerCharacters: [">", "<", "=", "."] },
    },
    serverInfo: { name: "bel", version: "0.0.0" },
  };
}

/** The bel type of a binding, which is as much as the language itself knows. */
function belType(value: { kind: string } & Record<string, unknown>): string {
  switch (value.kind) {
    case "ScoreExpr":
      return `score<${(value["rubric"] as string[]).length}>`;
    case "ChoiceExpr":
      return `choice<${(value["rubric"] as string[]).join(" | ")}>`;
    default:
      return "belief";
  }
}

function markdown(value: string, detail?: string): unknown {
  const body = detail === undefined ? value : `${value}\n\n${detail}`;
  return { contents: { kind: "markdown", value: body } };
}

function describeBinding(value: { kind: string } & Record<string, unknown>): string {
  switch (value.kind) {
    case "ScoreExpr":
      return `score ${JSON.stringify(value["text"])} in ${(value["rubric"] as string[]).join(" | ")}`;
    case "ChoiceExpr":
      return `choice ${JSON.stringify(value["text"])} in ${(value["rubric"] as string[]).join(" | ")}`;
    default:
      return describeBelief(value as never as BeliefExpr);
  }
}

function describeBelief(node: BeliefExpr): string {
  switch (node.kind) {
    case "BeliefLiteral":
      return JSON.stringify(node.text);
    case "BeliefRef":
      return node.name;
    case "Not":
      return `~${describeBelief(node.operand)}`;
    case "And":
      return node.operands.map(describeBelief).join(" & ");
    case "Or":
      return node.operands.map(describeBelief).join(" | ");
    case "Comparison":
      return `${node.name} ${node.operator} ${node.operand.kind === "Level" ? node.operand.value : node.operand.name}`;
  }
}

/** The question a binding asks, if it asks one. */
function questionOf(value: { kind: string } & Record<string, unknown>): string | undefined {
  if (value.kind === "ScoreExpr" || value.kind === "ChoiceExpr") {
    return `asks the model: “${String(value["text"])}”`;
  }
  return undefined;
}

function safeParse(text: string): ReturnType<typeof parseBel> | null {
  try {
    return parseBel(text);
  } catch {
    return null;
  }
}

export type { FlowDecl };
