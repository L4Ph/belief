/** Just enough of the Language Server Protocol to be a server. */

export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };

export type Diagnostic = {
  range: Range;
  severity: 1 | 2 | 3 | 4;
  code?: string;
  source?: string;
  message: string;
};

export type Message = {
  jsonrpc?: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

export const ERROR_SEVERITY = 1;

/** The offset a position refers to, in UTF-16 code units — which is what a JS string index is. */
export function offsetAt(text: string, position: Position): number {
  let line = 0;
  let offset = 0;
  while (line < position.line && offset < text.length) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
    line += 1;
  }
  return Math.min(offset + position.character, text.length);
}

/** A range covering one line, for a diagnostic that points at a character. */
export function lineRange(text: string, offset: number): Range {
  const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const end = lineEnd === -1 ? text.length : lineEnd;
  const start = lineOffsetToPosition(text, lineStart);
  return { start: start, end: lineOffsetToPosition(text, end) };
}

export function lineOffsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}
