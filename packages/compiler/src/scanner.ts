/**
 * Bracket matching and raw region scanning for the TypeScript islands
 * embedded in bel source.
 *
 * A naive brace counter is wrong as soon as a brace appears inside a string,
 * a template literal interpolation, or a comment, so both entry points below
 * drive one shared token skipper that knows those regions.
 *
 * Regex literals are recognised with the usual "is a value expected here?"
 * heuristic: a `/` starts a regex after an operator, an opening bracket or a
 * keyword, and is division after anything else. The heuristic is right in
 * practice but is not a lexer; see RFC 0001, "Known ceilings".
 */

export type ScanResult =
  | { ok: true; end: number }
  | { ok: false; reason: "not-a-bracket" | "unterminated" | "mismatch"; at: number };

type BracketKind = "brace" | "paren" | "bracket";

type Frame = { kind: BracketKind | "template"; open: number };

/** The last code token, used only to decide whether a `/` starts a regex. */
type Prev = { char: string; word: string };

const OPENERS: Record<string, BracketKind | undefined> = {
  "{": "brace",
  "(": "paren",
  "[": "bracket",
};

const CLOSERS: Record<string, BracketKind | undefined> = {
  "}": "brace",
  ")": "paren",
  "]": "bracket",
};

/** A regex may follow these, because a value is expected next. */
const REGEX_PRECEDING_CHARS = new Set("(,=:[!&|?{};+-*%~^<>");

/** A regex may follow these keywords, because a value is expected next. */
const REGEX_PRECEDING_WORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "typeof",
  "void",
  "yield",
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/**
 * Find the end of the region opened by the bracket at `openOffset`.
 *
 * Returns the offset just past the matching closer, or why it could not be
 * found. `at` is the offset of the offending character (the opener for an
 * unterminated region).
 */
export function matchBracket(source: string, openOffset: number): ScanResult {
  const kind = OPENERS[source[openOffset] ?? ""];
  if (kind === undefined) return { ok: false, reason: "not-a-bracket", at: openOffset };

  const stack: Frame[] = [{ kind, open: openOffset }];
  const prev: Prev = { char: "", word: "" };
  let i = openOffset + 1;

  while (i < source.length) {
    const top = stack[stack.length - 1] as Frame;
    const c = source[i] as string;

    if (top.kind !== "template") {
      const closer = CLOSERS[c];
      if (closer !== undefined) {
        if (closer !== top.kind) return { ok: false, reason: "mismatch", at: i };
        stack.pop();
        i += 1;
        if (stack.length === 0) return { ok: true, end: i };
        setPrev(prev, c);
        continue;
      }
    }

    i = skipUnit(source, i, stack, prev);
  }

  return { ok: false, reason: "unterminated", at: openOffset };
}

/**
 * Find the end of a raw TypeScript region: everything up to the end of the
 * current line, extended over any line the region's brackets stay open
 * through. Used for `import` / `type` declarations, whose bodies are passed
 * through untouched.
 *
 * The returned offset excludes the terminating newline.
 */
export function scanRaw(source: string, start: number): number {
  const stack: Frame[] = [];
  const prev: Prev = { char: "", word: "" };
  let i = start;

  while (i < source.length) {
    if (source[i] === "\n" && stack.length === 0) return i;
    i = skipUnit(source, i, stack, prev);
  }

  return source.length;
}

function setPrev(prev: Prev, char: string, word = ""): void {
  prev.char = char;
  prev.word = word;
}

/**
 * Advance past one token: a comment, a string, a regex, a bracket, a word, or
 * a single character. Template literal mode short-circuits everything, so the
 * characters that mean something in code are plain text inside a template.
 */
function skipUnit(source: string, i: number, stack: Frame[], prev: Prev): number {
  const top = stack[stack.length - 1];
  const c = source[i] as string;

  if (top?.kind === "template") {
    if (c === "\\") return i + 2;
    if (c === "`") {
      stack.pop();
      setPrev(prev, "`");
      return i + 1;
    }
    if (c === "$" && source[i + 1] === "{") {
      stack.push({ kind: "brace", open: i + 1 });
      setPrev(prev, "");
      return i + 2;
    }
    return i + 1;
  }

  if (c === "/" && source[i + 1] === "/") {
    const stop = source.indexOf("\n", i);
    return stop === -1 ? source.length : stop;
  }
  if (c === "/" && source[i + 1] === "*") {
    const stop = source.indexOf("*/", i + 2);
    return stop === -1 ? source.length : stop + 2;
  }
  if (c === "/" && startsRegex(prev)) {
    const stop = skipRegex(source, i);
    if (stop !== -1) {
      setPrev(prev, "/");
      return stop;
    }
  }
  if (c === '"' || c === "'") {
    setPrev(prev, c);
    return skipString(source, i);
  }
  if (c === "`") {
    stack.push({ kind: "template", open: i });
    return i + 1;
  }

  const opener = OPENERS[c];
  if (opener !== undefined) {
    stack.push({ kind: opener, open: i });
    setPrev(prev, c);
    return i + 1;
  }

  if (CLOSERS[c] !== undefined) {
    stack.pop();
    setPrev(prev, c);
    return i + 1;
  }

  if (/\s/.test(c)) return i + 1;

  if (IDENT_START.test(c)) {
    let j = i;
    while (j < source.length && IDENT_PART.test(source[j] as string)) j += 1;
    setPrev(prev, source[j - 1] as string, source.slice(i, j));
    return j;
  }

  setPrev(prev, c);
  return i + 1;
}

function startsRegex(prev: Prev): boolean {
  if (prev.char === "") return true;
  if (prev.word !== "" && REGEX_PRECEDING_WORDS.has(prev.word)) return true;
  return REGEX_PRECEDING_CHARS.has(prev.char);
}

/**
 * Skip a regex literal starting at `i`. Returns -1 when the `/` cannot be one
 * — a regex does not span lines, so a newline before the closing `/` means
 * this was division.
 */
function skipRegex(source: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < source.length) {
    const c = source[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "\n") return -1;
    if (inClass) {
      if (c === "]") inClass = false;
      j += 1;
      continue;
    }
    if (c === "[") {
      inClass = true;
      j += 1;
      continue;
    }
    if (c === "/") {
      j += 1;
      while (j < source.length && /[a-z]/i.test(source[j] as string)) j += 1;
      return j;
    }
    j += 1;
  }
  return -1;
}

/** Skip a quoted string starting at `i`. An unterminated string stops at the newline. */
function skipString(source: string, i: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length) {
    const c = source[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === "\n") return j;
    j += 1;
  }
  return source.length;
}
