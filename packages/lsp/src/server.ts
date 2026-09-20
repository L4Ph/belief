import { BelError, compile, generateTests, parseBel } from "@bel/compiler";
import type { BeliefExpr, FlowDecl } from "@bel/compiler";
import {
  ERROR_SEVERITY,
  lineRange,
  offsetAt,
  type Diagnostic,
  type Message,
  type Position,
} from "./protocol.ts";
import { wordWithOffset } from "./word.ts";

const SOURCE = "bel";

/**
 * A language server with no more machinery than the compiler already provides:
 * every request re-runs the compiler on the document as it stands and turns the
 * diagnostic it raises — if any — into a message.
 *
 * One diagnostic at a time is a real limit: the compiler stops at the first
 * error. A list of errors is a compiler change, not a server one.
 */
export class BelServer {
  private readonly documents = new Map<string, string>();

  /** Handle one message. Returns the messages to send back, in order. */
  handle(message: Message): Message[] {
    const params = message.params as never as Record<string, unknown> | undefined;
    switch (message.method) {
      case "initialize":
        return [this.reply(message, capabilities())];
      case "initialized":
        return [];
      case "shutdown":
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
        return [this.reply(message, this.hover(params))];
      case "textDocument/completion":
        return [this.reply(message, this.completion(params))];
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
    return [this.publish(document.uri, document.text)];
  }

  private didChange(params: Record<string, unknown> | undefined): Message[] {
    const document = params?.["textDocument"] as { uri: string } | undefined;
    const changes = params?.["contentChanges"] as { text: string }[] | undefined;
    const text = changes?.at(-1)?.text;
    if (document === undefined || text === undefined) return [];
    this.documents.set(document.uri, text);
    return [this.publish(document.uri, text)];
  }

  private didClose(params: Record<string, unknown> | undefined): Message[] {
    const document = params?.["textDocument"] as { uri: string } | undefined;
    if (document === undefined) return [];
    this.documents.delete(document.uri);
    return [this.publish(document.uri, "", [])];
  }

  /** Compile the document and report whatever the compiler objects to. */
  private publish(uri: string, text: string, diagnostics?: Diagnostic[]): Message {
    return {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, diagnostics: diagnostics ?? this.diagnostics(uri, text) },
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

  /** What the thing under the cursor is: a flow, or the binding it names. */
  private hover(params: Record<string, unknown> | undefined): unknown {
    const where = this.at(params);
    if (where === null) return null;
    const program = safeParse(where.text);
    if (program === null) return null;

    const name = wordWithOffset(where.text, where.offset)?.word;
    if (name === undefined) return null;

    for (const decl of program.body) {
      if (decl.kind !== "FlowDecl") continue;
      if (decl.name === name) {
        return markdown(
          `\`\`\`bel\nflow ${decl.name}${decl.params}: ${decl.returnType}\n\`\`\``,
          decl.bindings.length + decl.guards.length > 0
            ? `${decl.bindings.length} binding(s), ${decl.guards.length} guard(s)`
            : undefined,
        );
      }
      const binding = decl.bindings.find((candidate) => candidate.name === name);
      if (binding !== undefined) {
        return markdown(
          `\`\`\`bel\nlet ${binding.name} = ${describeBinding(binding.value)}\n\`\`\``,
          questionOf(binding.value),
        );
      }
    }
    return null;
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

  private at(params: Record<string, unknown> | undefined): { text: string; offset: number } | null {
    const document = params?.["textDocument"] as { uri: string } | undefined;
    const position = params?.["position"] as Position | undefined;
    if (document === undefined || position === undefined) return null;
    const text = this.documents.get(document.uri);
    if (text === undefined) return null;
    return { text, offset: offsetAt(text, position) };
  }
}

function capabilities(): unknown {
  return {
    capabilities: {
      // The document is recompiled whole on every change; incremental ranges
      // would only save a string copy.
      textDocumentSync: 1,
      hoverProvider: true,
      completionProvider: { triggerCharacters: [">", "<", "="] },
    },
    serverInfo: { name: "bel", version: "0.0.0" },
  };
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
